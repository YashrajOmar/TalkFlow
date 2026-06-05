// TalkFlow Manual Backup and Export Utility
// Allows local-first users to backup their sessions to JSON files and restore them

import { 
  getSessions, 
  getPracticeCards, 
  overwriteSessions, 
  overwritePracticeCards 
} from './storage-local.js';

import { 
  mergeSessions, 
  mergePracticeCards 
} from './storage-drive.js';

/**
 * Trigger browser download of TalkFlow JSON backup
 */
export async function exportData() {
  try {
    const sessions = await getSessions();
    const cards = await getPracticeCards();

    const backupObject = {
      version: 2,
      exportedAt: new Date().toISOString(),
      sessions: sessions,
      practiceCards: cards
    };

    const dataStr = JSON.stringify(backupObject, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 10);
    const filename = `talkflow-backup-${timestamp}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { success: true, filename };
  } catch (err) {
    console.error("[TalkFlow Export] Failed to export:", err);
    throw new Error(`Data export failed: ${err.message}`);
  }
}

/**
 * Import a JSON backup file and merge it with current IndexedDB data.
 * @param {File} file - Selected JSON backup file
 */
export function importData(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file selected for import."));
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        
        // Basic format check
        if (!json || (!Array.isArray(json.sessions) && !Array.isArray(json.practiceCards))) {
          throw new Error("Invalid file format. Ensure you upload a valid TalkFlow JSON backup file.");
        }

        const localSessions = await getSessions();
        const localCards = await getPracticeCards();

        const importSessions = json.sessions || [];
        const importCards = json.practiceCards || [];

        // Merge datasets
        const { merged: mergedSessions, conflicts: sessionsConflict } = mergeSessions(localSessions, importSessions);
        const mergedCards = mergePracticeCards(localCards, importCards);

        // Overwrite database
        await overwriteSessions(mergedSessions);
        await overwritePracticeCards(mergedCards);

        resolve({
          success: true,
          sessionsCount: mergedSessions.length,
          cardsCount: mergedCards.length,
          conflictsDetected: sessionsConflict
        });
      } catch (err) {
        console.error("[TalkFlow Import] Failed to parse/import:", err);
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read the selected file."));
    };

    reader.readAsText(file);
  });
}
