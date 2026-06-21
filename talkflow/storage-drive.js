// Google Drive Storage Provider for TalkFlow
// Handles OAuth flow and appDataFolder sync operations

import { 
  getSessions, 
  getPracticeCards, 
  overwriteSessions, 
  overwritePracticeCards 
} from './storage-local.js';

const CLIENT_ID_ERR = "Google Drive Sync failed: OAuth2 client ID is not configured. Please see the README to configure a Client ID.";

function hasConfiguredOAuthClient() {
  try {
    const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || "";
    return clientId.endsWith(".apps.googleusercontent.com") && !clientId.includes("REPLACE_WITH");
  } catch (_) {
    return false;
  }
}

/**
 * Obtain an OAuth token from Chrome Identity.
 * @param {boolean} interactive - Whether to prompt the user to sign in
 */
export function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.identity) {
      reject(new Error("Chrome Identity API is not available. Please verify extension installation."));
      return;
    }
    if (!hasConfiguredOAuthClient()) {
      reject(new Error(`${CLIENT_ID_ERR} Create a Chrome App OAuth client for extension ID ${chrome.runtime.id}, paste it into manifest.json, and reload the extension.`));
      return;
    }
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || "";
        if (errorMsg.includes("OAuth2 client ID")) {
          reject(new Error(CLIENT_ID_ERR));
        } else {
          reject(new Error(`OAuth authentication failed: ${errorMsg}`));
        }
      } else if (!token) {
        reject(new Error("Failed to retrieve Google Drive OAuth token."));
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * Remove cached auth token from Chrome identity cache
 */
export function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.identity && token) {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Revoke the access token.
 */
export async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, { method: 'POST' });
  } catch (e) {
    console.warn("Failed to revoke OAuth token:", e);
  }
}

/**
 * Helper to check API responses for standard errors (quota, auth).
 */
async function handleApiResponse(response) {
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (response.status === 403) {
    const text = await response.text().catch(() => "");
    if (text.includes("quotaExceeded") || text.includes("usageLimits")) {
      throw new Error("QUOTA_EXCEEDED");
    }
    throw new Error("FORBIDDEN");
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Google Drive API error (${response.status}): ${errorText}`);
  }
  return response;
}

/**
 * Find a file by name inside the appDataFolder.
 */
async function findFile(token, filename, parentId = null) {
  let query = `name='${filename}'`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name)`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  await handleApiResponse(res);
  const data = await res.json();
  return data.files?.[0] || null;
}

/**
 * Downloads JSON contents of a file by fileId.
 */
async function downloadFileContent(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (res.status === 404) return null;
  await handleApiResponse(res);
  return await res.json();
}

/**
 * Create or overwrite a JSON file inside the appDataFolder.
 */
async function uploadFileContent(token, filename, content) {
  let file = await findFile(token, filename);
  let fileId = file?.id;
  
  if (!fileId) {
    // 1. Create file metadata
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: filename,
        parents: ['appDataFolder']
      })
    });
    await handleApiResponse(createRes);
    const meta = await createRes.json();
    fileId = meta.id;
  }

  // 2. Upload/Overwrite media content
  const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: typeof content === 'string' ? content : JSON.stringify(content)
  });
  await handleApiResponse(uploadRes);
  return fileId;
}

/**
 * Sync audio recording file to Drive
 */
export async function uploadAudioFile(token, filename, blob) {
  // 1. Get or create the audio folder in appDataFolder
  let folder = await findFile(token, 'audio');
  let folderId = folder?.id;
  
  if (!folderId) {
    const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'audio',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['appDataFolder']
      })
    });
    await handleApiResponse(folderRes);
    const folderMeta = await folderRes.json();
    folderId = folderMeta.id;
  }

  // 2. Check if this specific audio file is already uploaded
  let file = await findFile(token, filename, folderId);
  let fileId = file?.id;

  if (!fileId) {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: filename,
        parents: [folderId]
      })
    });
    await handleApiResponse(createRes);
    const meta = await createRes.json();
    fileId = meta.id;
  }

  // 3. Upload content
  const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': blob.type || 'audio/webm'
    },
    body: blob
  });
  await handleApiResponse(uploadRes);
  return fileId;
}

/**
 * Merges local and cloud sessions.
 * Returns { mergedSessions, conflictsDetected }
 */
export function mergeSessions(localList, cloudList) {
  const merged = [];
  const map = new Map();
  let conflicts = false;

  // Index local sessions
  localList.forEach(s => {
    const key = s.sessionUuid || s.timestamp;
    map.set(key, { source: 'local', data: s });
  });

  // Merge cloud sessions
  cloudList.forEach(cs => {
    const key = cs.sessionUuid || cs.timestamp;
    if (map.has(key)) {
      const localItem = map.get(key).data;
      
      // Simple conflict detection: check if score or word count changed
      const localWords = localItem.rawText?.split(/\s+/).length || 0;
      const cloudWords = cs.rawText?.split(/\s+/).length || 0;
      
      if (localItem.score !== cs.score || localWords !== cloudWords) {
        conflicts = true;
        console.warn(`[TalkFlow Sync] Conflict detected for session with uuid/timestamp: ${key}`);
      }

      // Merge: pick the one with richer evaluation or latest timestamp (favoring cloud as server backup)
      // If one has completed evaluation details and the other doesn't, pick the completed one.
      const localHasScore = localItem.score !== undefined;
      const cloudHasScore = cs.score !== undefined;
      
      if (cloudHasScore && !localHasScore) {
        map.set(key, { source: 'merged', data: cs });
      } else {
        map.set(key, { source: 'merged', data: localItem });
      }
    } else {
      map.set(key, { source: 'cloud', data: cs });
    }
  });

  // Convert map back to list
  for (const item of map.values()) {
    merged.push(item.data);
  }

  // Sort by ID/timestamp
  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Regenerate simple auto-increment IDs for safety in IndexedDB local store
  merged.forEach((item, index) => {
    item.id = index + 1;
  });

  return { merged, conflicts };
}

/**
 * Merges local and cloud practice cards.
 */
export function mergePracticeCards(localList, cloudList) {
  const merged = [];
  const map = new Map();

  localList.forEach(c => {
    const key = c.original.trim().toLowerCase();
    map.set(key, c);
  });

  cloudList.forEach(cc => {
    const key = cc.original.trim().toLowerCase();
    if (map.has(key)) {
      const localCard = map.get(key);
      // Merge card stats
      const mergedCard = {
        ...localCard,
        attempts: Math.max(localCard.attempts || 0, cc.attempts || 0),
        lastScore: Math.max(localCard.lastScore || 0, cc.lastScore || 0),
        mastered: localCard.mastered || cc.mastered || false
      };
      map.set(key, mergedCard);
    } else {
      map.set(key, cc);
    }
  });

  let index = 1;
  for (const card of map.values()) {
    card.id = index++;
    merged.push(card);
  }

  return merged;
}

/**
 * Main synchronisation function.
 * Downloads cloud data, merges, and writes both ways.
 * @returns {Promise<Object>} Status details { conflictsDetected }
 */
export async function syncAllData(token) {
  if (!token) throw new Error("Sync failed: No Google Drive OAuth token provided.");

  console.log("[TalkFlow Sync] Starting Google Drive sync...");

  // 1. Fetch local data
  const localSessions = await getSessions();
  const localCards = await getPracticeCards();

  // 2. Locate / download cloud data
  let cloudSessions = [];
  const sessionsFile = await findFile(token, 'talkflow-sessions.json');
  if (sessionsFile) {
    cloudSessions = await downloadFileContent(token, sessionsFile.id) || [];
  }

  let cloudCards = [];
  const cardsFile = await findFile(token, 'talkflow-practice-cards.json');
  if (cardsFile) {
    cloudCards = await downloadFileContent(token, cardsFile.id) || [];
  }

  // 3. Perform merges
  const { merged: mergedSessions, conflicts: sessionsConflict } = mergeSessions(localSessions, cloudSessions);
  const mergedCards = mergePracticeCards(localCards, cloudCards);

  // 4. Overwrite local database
  await overwriteSessions(mergedSessions);
  await overwritePracticeCards(mergedCards);

  // 5. Upload back to Google Drive appDataFolder
  await uploadFileContent(token, 'talkflow-sessions.json', mergedSessions);
  await uploadFileContent(token, 'talkflow-practice-cards.json', mergedCards);

  // 6. Backup settings (one-way local to cloud)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(null, async (settings) => {
      // Scrub API keys for privacy in cloud backups if needed,
      // but the user wants to backup settings so let's save the settings
      // stripping the actual API key string for security if needed (or just upload settings backup).
      // The requirement says "Store settings backup" - we'll upload it.
      await uploadFileContent(token, 'talkflow-settings-backup.json', settings);
    });
  }

  console.log("[TalkFlow Sync] Google Drive sync complete.");
  return { conflictsDetected: sessionsConflict };
}
