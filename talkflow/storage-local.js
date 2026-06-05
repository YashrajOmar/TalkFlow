// TalkFlow Local Storage Manager (IndexedDB v2)
// Handles structured local storage for chunks, manifests, sessions, and cards

const DB_NAME = "TalkFlowDB";
const DB_VERSION = 2;

let db = null;

/**
 * Initializes the database. Performs upgrades to version 2 if necessary.
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Store analyzed sessions (from v1)
      if (!database.objectStoreNames.contains("sessions")) {
        database.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
      }
      
      // Store practice flashcards (from v1)
      if (!database.objectStoreNames.contains("practice_cards")) {
        database.createObjectStore("practice_cards", { keyPath: "id", autoIncrement: true });
      }

      // v2 store: recording chunks for crash recovery & long files
      if (!database.objectStoreNames.contains("recording_chunks")) {
        const chunkStore = database.createObjectStore("recording_chunks", { keyPath: "id", autoIncrement: true });
        chunkStore.createIndex("sessionId", "sessionId", { unique: false });
      }

      // v2 store: active session manifests
      if (!database.objectStoreNames.contains("active_sessions")) {
        database.createObjectStore("active_sessions", { keyPath: "sessionId" });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      console.error("[TalkFlow DB] Open error:", event.target.error);
      reject(event.target.error);
    };
  });
}

// ── RECORDING CHUNKS ─────────────────────────────────────────────────────────

export function saveChunk(chunk) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["recording_chunks"], "readwrite");
    const store = transaction.objectStore("recording_chunks");
    const request = store.add(chunk);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function getChunksForSession(sessionId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["recording_chunks"], "readonly");
    const store = transaction.objectStore("recording_chunks");
    const index = store.index("sessionId");
    const request = index.getAll(sessionId);
    request.onsuccess = (e) => {
      const chunks = e.target.result || [];
      // Enforce order
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      resolve(chunks);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

export function deleteChunksForSession(sessionId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["recording_chunks"], "readwrite");
    const store = transaction.objectStore("recording_chunks");
    const index = store.index("sessionId");
    const request = index.openCursor(sessionId);

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

// ── ACTIVE SESSIONS ──────────────────────────────────────────────────────────

export function saveActiveSession(manifest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["active_sessions"], "readwrite");
    const store = transaction.objectStore("active_sessions");
    const request = store.put(manifest);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

export function getActiveSession(sessionId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["active_sessions"], "readonly");
    const store = transaction.objectStore("active_sessions");
    const request = store.get(sessionId);
    request.onsuccess = (e) => resolve(e.target.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function getAllActiveSessions() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["active_sessions"], "readonly");
    const store = transaction.objectStore("active_sessions");
    const request = store.getAll();
    request.onsuccess = (e) => resolve(e.target.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function deleteActiveSession(sessionId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["active_sessions"], "readwrite");
    const store = transaction.objectStore("active_sessions");
    const request = store.delete(sessionId);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// ── FINALIZED SESSIONS ────────────────────────────────────────────────────────

export function saveSession(sessionData) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions"], "readwrite");
    const store = transaction.objectStore("sessions");
    const request = store.add(sessionData);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function getSessions() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions"], "readonly");
    const store = transaction.objectStore("sessions");
    const request = store.getAll();
    request.onsuccess = (e) => resolve(e.target.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function deleteSession(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions"], "readwrite");
    const store = transaction.objectStore("sessions");
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// ── PRACTICE DECK ────────────────────────────────────────────────────────────

export function savePracticeCard(cardData) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["practice_cards"], "readwrite");
    const store = transaction.objectStore("practice_cards");
    
    const indexRequest = store.openCursor();
    let isDuplicate = false;

    indexRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.original.trim().toLowerCase() === cardData.original.trim().toLowerCase()) {
          isDuplicate = true;
          resolve(cursor.value.id);
          return;
        }
        cursor.continue();
      } else {
        if (!isDuplicate) {
          const addRequest = store.add(cardData);
          addRequest.onsuccess = (e) => resolve(e.target.result);
          addRequest.onerror = (e) => reject(e.target.error);
        }
      }
    };
  });
}

export function getPracticeCards() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["practice_cards"], "readonly");
    const store = transaction.objectStore("practice_cards");
    const request = store.getAll();
    request.onsuccess = (e) => resolve(e.target.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function updatePracticeCardStats(id, score) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["practice_cards"], "readwrite");
    const store = transaction.objectStore("practice_cards");
    const getRequest = store.get(id);

    getRequest.onsuccess = (event) => {
      const card = event.target.result;
      if (card) {
        card.attempts = (card.attempts || 0) + 1;
        card.lastScore = score;
        card.lastAttemptDate = new Date().toISOString();
        if (score >= 80) {
          card.mastered = true;
        }
        
        const updateRequest = store.put(card);
        updateRequest.onsuccess = () => resolve(card);
        updateRequest.onerror = (e) => reject(e.target.error);
      } else {
        reject(new Error("Card not found"));
      }
    };
    getRequest.onerror = (event) => reject(event.target.error);
  });
}

// ── OVERWRITING (DRIVE SYNC / IMPORTS) ──────────────────────────────────────

export function overwriteSessions(sessions) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions"], "readwrite");
    const store = transaction.objectStore("sessions");
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      if (sessions.length === 0) {
        resolve();
        return;
      }
      let count = 0;
      sessions.forEach(s => {
        const addReq = store.add(s);
        addReq.onsuccess = () => {
          count++;
          if (count === sessions.length) resolve();
        };
        addReq.onerror = (e) => reject(e.target.error);
      });
    };
    clearReq.onerror = (e) => reject(e.target.error);
  });
}

export function overwritePracticeCards(cards) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["practice_cards"], "readwrite");
    const store = transaction.objectStore("practice_cards");
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      if (cards.length === 0) {
        resolve();
        return;
      }
      let count = 0;
      cards.forEach(c => {
        const addReq = store.add(c);
        addReq.onsuccess = () => {
          count++;
          if (count === cards.length) resolve();
        };
        addReq.onerror = (e) => reject(e.target.error);
      });
    };
    clearReq.onerror = (e) => reject(e.target.error);
  });
}
