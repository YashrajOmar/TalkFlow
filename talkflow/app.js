// TalkFlow Application Logic
import { analyzeTranscript } from './gemini-api.js';
import { 
  transcribeAudioLocal, 
  transcribeAudioGemini, 
  transcribeAudioOpenAI, 
  analyzeTranscriptLocal,
  checkLocalServerHealth
} from './transcription-api.js';
import * as localStore from './storage-local.js';
import * as driveStore from './storage-drive.js';
import * as exportStore from './storage-export.js';

// Configuration Constants
const CHUNK_DURATION = 60000; // Change to 10000 (10s) for testing chunking/recovery

// Global State
let db = null;
let currentTab = "tab-dashboard";
let mediaRecorder = null;
let tabMediaRecorder = null;
let audioChunks = [];
let audioContext = null;
let audioSourceMic = null;
let audioSourceTab = null;
let audioDestination = null;
let analyserNode = null;
let canvasAnimationId = null;

let isRecording = false;
let isPaused = false;
let recordStartTime = 0;
let timerInterval = null;
let sessionDurationSeconds = 0;
let currentChunkStartSeconds = 0;
let currentChunkStartBySpeaker = { you: 0, interviewer: 0 };

let speechRecognition = null;
let rawTranscriptText = "";
let currentInterimText = "";

let selectedSessionId = null;
let activePracticeCard = null;
let practiceRecognition = null;
let isPracticeListening = false;

// Holds the last recording blob so user can download it before it's discarded.
// lastRecordingBlob is built lazily on download click to avoid RAM spikes.
// _lastChunksForDownload holds the raw chunk array for on-demand assembly.
let lastRecordingBlob = null;
let _lastChunksForDownload = [];

// Consent State
let fullInterviewConsentConfirmed = false;

// Production & Local Release State
let activeSessionId = null;
let lastSoundTime = 0;
let micAnalyser = null;
let tabAnalyser = null;
let driveToken = null;
let activeSavePromises = [];

// ----------------------------------------------------
// STORAGE API HELPERS (Supports Chrome Extension storage & LocalStorage)
// ----------------------------------------------------
function getLocalStorage(key) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || "");
      });
    } else {
      resolve(localStorage.getItem(key) || "");
    }
  });
}

function setLocalStorage(key, value) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    } else {
      localStorage.setItem(key, value);
      resolve();
    }
  });
}

function removeLocalStorage(key) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([key], () => {
        resolve();
      });
    } else {
      localStorage.removeItem(key);
      resolve();
    }
  });
}

// ----------------------------------------------------
// 1. DATABASE MANAGEMENT (IndexedDB)
// ----------------------------------------------------
const initDB = localStore.initDB;
const saveSession = localStore.saveSession;
const getSessions = localStore.getSessions;
const deleteSession = localStore.deleteSession;
const savePracticeCard = localStore.savePracticeCard;
const getPracticeCards = localStore.getPracticeCards;
const updatePracticeCardStats = localStore.updatePracticeCardStats;

// ----------------------------------------------------
// 2. TABS & VIEW CONTROLLER
// ----------------------------------------------------
function switchTab(tabId) {
  // Stop practice listening if active
  if (isPracticeListening) {
    stopPracticeListening();
  }

  // Deactivate all tabs
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  // Activate chosen tab
  const targetTab = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  
  if (targetTab && targetBtn) {
    targetTab.classList.add("active");
    targetBtn.classList.add("active");
    currentTab = tabId;
  }

  // Update header text based on tab
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  
  switch(tabId) {
    case "tab-dashboard":
      pageTitle.innerText = "Dashboard Overview";
      pageSubtitle.innerText = "Welcome back. Review your communication stats and practice sessions.";
      loadDashboard();
      break;
    case "tab-recorder":
      pageTitle.innerText = "Speech Recorder";
      pageSubtitle.innerText = "Practice speaking. Real-time feedback will be generated locally.";
      checkMicPermissionStatus();
      break;
    case "tab-analysis":
      pageTitle.innerText = "Analysis Hub";
      pageSubtitle.innerText = "Examine your vocabulary, structural mistakes, and high-impact rewrites.";
      populateAnalysisDropdown();
      break;
    case "tab-practice":
      pageTitle.innerText = "Practice Deck";
      pageSubtitle.innerText = "Review corrected cards and record verbal practice attempts to build fluency.";
      loadPracticeDeck();
      break;
    case "tab-settings":
      pageTitle.innerText = "Settings & Privacy";
      pageSubtitle.innerText = "Manage your local API credentials and storage policies.";
      loadSettings();
      break;
  }
  
  // Re-trigger Lucide icon generation for dynamic elements
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ----------------------------------------------------
// 3. TOAST MESSAGES
// ----------------------------------------------------
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let iconName = "info";
  if (type === "success") iconName = "check-circle";
  if (type === "error") iconName = "alert-circle";
  if (type === "warning") iconName = "alert-triangle";
  
  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  if (window.lucide) {
    window.lucide.createIcons();
  }
  
  setTimeout(() => {
    toast.style.animation = "toastSlideIn 0.3s reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ----------------------------------------------------
// 4. SETTINGS CONTROLLER
// ----------------------------------------------------
async function loadSettings() {
  const apiKey = await getLocalStorage("gemini_api_key");
  let model = await getLocalStorage("gemini_model") || "gemini-2.5-flash";
  if (["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"].includes(model)) {
    model = "gemini-2.5-flash";
    await setLocalStorage("gemini_model", model);
  }
  const provider = await getLocalStorage("transcription_provider") || "local";
  const analysisProvider = await getLocalStorage("analysis_provider") || "local_ollama";
  const openAIKey = await getLocalStorage("openai_api_key") || "";

  const storageProvider = await getLocalStorage("storage_provider") || "local";
  const autoSync = await getLocalStorage("drive_auto_sync") !== "false";
  const audioBackup = await getLocalStorage("drive_audio_backup") === "true";

  document.getElementById("settings-api-key").value = apiKey || "";
  document.getElementById("settings-model").value = model;
  document.getElementById("settings-transcription-provider").value = provider;
  document.getElementById("settings-analysis-provider").value = analysisProvider;
  document.getElementById("settings-openai-key").value = openAIKey;
  document.getElementById("settings-storage-provider").value = storageProvider;

  document.getElementById("check-auto-sync").checked = autoSync;
  document.getElementById("check-audio-backup").checked = audioBackup;
  document.getElementById("audio-backup-warning").style.display = audioBackup ? "block" : "none";
  document.getElementById("openai-key-group").style.display = provider === "openai" ? "block" : "none";

  toggleStorageSettingsUI(storageProvider);
  refreshDiagnostics();
  updateDriveConnectionUI();
}

async function saveSettings(e) {
  if (e) e.preventDefault();
  const apiKey = document.getElementById("settings-api-key").value.trim();
  const model = document.getElementById("settings-model").value;
  const provider = document.getElementById("settings-transcription-provider").value;
  const analysisProvider = document.getElementById("settings-analysis-provider").value;
  const openAIKey = document.getElementById("settings-openai-key").value.trim();

  const storageProvider = document.getElementById("settings-storage-provider").value;
  const autoSync = document.getElementById("check-auto-sync").checked;
  const audioBackup = document.getElementById("check-audio-backup").checked;

  await setLocalStorage("gemini_api_key", apiKey);
  await setLocalStorage("gemini_model", model);
  await setLocalStorage("transcription_provider", provider);
  await setLocalStorage("analysis_provider", analysisProvider);
  await setLocalStorage("openai_api_key", openAIKey);

  await setLocalStorage("storage_provider", storageProvider);
  await setLocalStorage("drive_auto_sync", autoSync ? "true" : "false");
  await setLocalStorage("drive_audio_backup", audioBackup ? "true" : "false");

  toggleStorageSettingsUI(storageProvider);
  if (storageProvider === "drive") {
    const token = await getLocalStorage("drive_oauth_token");
    showToast(
      token
        ? "Settings saved. Sessions will keep a local working copy and sync a private backup to Google Drive."
        : "Settings saved. Click Connect in Google Drive Sync to enable cloud backup.",
      token ? "success" : "warning"
    );
  } else {
    showToast("Settings saved successfully!", "success");
  }
}

function toggleStorageSettingsUI(provider) {
  const driveCard = document.getElementById("drive-sync-settings-card");
  const exportCard = document.getElementById("export-import-settings-card");
  if (driveCard) driveCard.style.display = provider === "drive" ? "flex" : "none";
  if (exportCard) exportCard.style.display = provider === "export" ? "flex" : "none";

  // Update the storage summary row in the Data & Privacy card
  const summaryEl = document.getElementById("storage-provider-summary");
  const badgeEl = document.getElementById("storage-provider-badge");
  if (summaryEl && badgeEl) {
    const descriptions = {
      local: {
        text: "<strong>Local Browser Storage (Default):</strong> All sessions and analysis reports are stored privately in your browser's IndexedDB. Nothing is uploaded.",
        badge: "Local", cls: "success"
      },
      drive: {
        text: "<strong>Google Drive Sync:</strong> TalkFlow keeps a local working copy for reliability and syncs a private backup to Google Drive appDataFolder when connected. Audio backup is OFF by default.",
        badge: "Drive", cls: "warning"
      },
      export: {
        text: "<strong>Export / Import JSON:</strong> Manually export your data as a local JSON file or restore from a previous backup.",
        badge: "Export", cls: "info"
      },
      dropbox: {
        text: "<strong>Dropbox (Placeholder):</strong> Dropbox sync is not yet active. Data stays local until this is implemented.",
        badge: "Dropbox", cls: "inactive"
      }
    };
    const info = descriptions[provider] || descriptions.local;
    summaryEl.innerHTML = info.text;
    badgeEl.textContent = info.badge;
    badgeEl.className = `status-badge ${info.cls}`;
  }
}

async function refreshDiagnostics() {
  const whisperStatus = document.getElementById("diag-whisper-status");
  const whisperDesc = document.getElementById("diag-whisper-desc");
  const ollamaStatus = document.getElementById("diag-ollama-status");
  const ollamaDesc = document.getElementById("diag-ollama-desc");
  const modelStatus = document.getElementById("diag-model-status");
  const modelDesc = document.getElementById("diag-model-desc");

  if (!whisperStatus || !ollamaStatus || !modelStatus) return;

  whisperStatus.className = "status-badge warning";
  whisperStatus.innerText = "Checking...";
  ollamaStatus.className = "status-badge warning";
  ollamaStatus.innerText = "Checking...";
  modelStatus.className = "status-badge warning";
  modelStatus.innerText = "Checking...";

  try {
    const health = await checkLocalServerHealth();
    
    // Whisper Status
    if (health.whisper && health.whisper.status === "ok") {
      whisperStatus.className = "status-badge success";
      whisperStatus.innerText = "Running";
      whisperDesc.innerText = `Whisper '${health.whisper.model}' loaded.`;
    } else {
      whisperStatus.className = "status-badge error";
      whisperStatus.innerText = "Error";
      whisperDesc.innerText = health.whisper?.error || "Local transcription server is degraded.";
    }

    // Ollama Status
    if (health.ollama && health.ollama.status === "ok") {
      ollamaStatus.className = "status-badge success";
      ollamaStatus.innerText = "Running";
      ollamaDesc.innerText = "Ollama connection successful.";
    } else {
      ollamaStatus.className = "status-badge error";
      ollamaStatus.innerText = "Not Running";
      ollamaDesc.innerText = health.ollama?.error || "Ollama service is unreachable.";
    }

    // Model Status
    if (health.ollama && health.ollama.model_available) {
      modelStatus.className = "status-badge success";
      modelStatus.innerText = "Available";
      modelDesc.innerText = "llama3.2:3b is pulled and ready.";
    } else {
      modelStatus.className = "status-badge error";
      modelStatus.innerText = "Missing";
      modelDesc.innerText = "llama3.2:3b not found. Pull: ollama pull llama3.2:3b";
    }
  } catch (err) {
    whisperStatus.className = "status-badge error";
    whisperStatus.innerText = "Offline";
    whisperDesc.innerText = "Local transcription server is not running.";

    ollamaStatus.className = "status-badge error";
    ollamaStatus.innerText = "Offline";
    ollamaDesc.innerText = "Start local TalkFlow server and Ollama.";

    modelStatus.className = "status-badge error";
    modelStatus.innerText = "Offline";
    modelDesc.innerText = "Run server.py and pull llama3.2:3b.";
  }
}

async function updateDriveConnectionUI() {
  const connStatus = document.getElementById("drive-conn-status");
  const btnConnect = document.getElementById("btn-connect-drive");
  const btnDisconnect = document.getElementById("btn-disconnect-drive");
  const btnSync = document.getElementById("btn-sync-now");
  const lblLastSync = document.getElementById("lbl-last-sync");

  if (!connStatus || !btnConnect || !btnDisconnect || !btnSync || !lblLastSync) return;

  const savedToken = await getLocalStorage("drive_oauth_token");
  const lastSyncTime = await getLocalStorage("drive_last_sync_time");

  if (lastSyncTime) {
    lblLastSync.innerText = `Last sync: ${new Date(lastSyncTime).toLocaleDateString()} ${new Date(lastSyncTime).toLocaleTimeString()}`;
  } else {
    lblLastSync.innerText = "Last sync: Never";
  }

  if (savedToken) {
    driveToken = savedToken;
    connStatus.innerText = "Connected";
    connStatus.className = "status-badge success";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "inline-flex";
    btnSync.disabled = false;
  } else {
    driveToken = null;
    connStatus.innerText = "Disconnected";
    connStatus.className = "status-badge error";
    btnConnect.style.display = "inline-flex";
    btnDisconnect.style.display = "none";
    btnSync.disabled = true;
  }
}

function toggleApiVisibility() {
  const apiInput = document.getElementById("settings-api-key");
  const eyeBtn = document.getElementById("btn-toggle-api-visibility");
  
  if (apiInput.type === "password") {
    apiInput.type = "text";
    eyeBtn.innerHTML = '<i data-lucide="eye-off"></i>';
  } else {
    apiInput.type = "password";
    eyeBtn.innerHTML = '<i data-lucide="eye"></i>';
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ----------------------------------------------------
// 5. DASHBOARD CONTROLLER
// ----------------------------------------------------
async function loadDashboard() {
  try {
    const sessions = await getSessions();
    const cards = await getPracticeCards();
    
    // Total practice time calculation
    let totalMinutes = 0;
    let totalMistakes = 0;
    let totalFillers = 0;
    let averageScore = 0;
    
    if (sessions.length > 0) {
      const sumScores = sessions.reduce((acc, s) => acc + (s.score || 0), 0);
      averageScore = (sumScores / sessions.length).toFixed(1);
      
      const sumSecs = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
      totalMinutes = Math.round(sumSecs / 60);
      
      totalMistakes = sessions.reduce((acc, s) => acc + (s.correctionsCount || 0), 0);
      totalFillers = sessions.reduce((acc, s) => {
        const fillers = s.fillerWords || {};
        return acc + Object.values(fillers).reduce((sum, v) => sum + v, 0);
      }, 0);
    }
    
    // Update stats UI
    document.getElementById("total-time-badge").innerText = `${totalMinutes}m`;
    document.getElementById("total-mistakes-badge").innerText = totalMistakes;
    
    document.getElementById("dash-fluency-score").innerHTML = `${averageScore}<span class="val-max">/10</span>`;
    document.getElementById("dash-total-sessions").innerText = sessions.length;
    document.getElementById("dash-filler-count").innerText = totalFillers;
    
    const masteredCount = cards.filter(c => c.mastered).length;
    document.getElementById("dash-phrases-practiced").innerText = `${masteredCount}/${cards.length}`;

    // Render Recent Sessions
    const sessionsList = document.getElementById("dashboard-sessions-list");
    sessionsList.innerHTML = "";
    
    if (sessions.length === 0) {
      sessionsList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="calendar"></i>
          <p>No recording history found.</p>
          <button class="btn btn-secondary btn-sm" id="btn-dash-start-first-dynamic">Record Your First Session</button>
        </div>
      `;
      const btnFirst = document.getElementById("btn-dash-start-first-dynamic");
      if (btnFirst) btnFirst.addEventListener("click", () => switchTab("tab-recorder"));
    } else {
      // Sort sessions newest first
      const sortedSessions = [...sessions].reverse().slice(0, 5);
      sortedSessions.forEach(session => {
        const dateStr = new Date(session.timestamp).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const durationStr = formatDuration(session.duration);
        
        const item = document.createElement("div");
        item.className = "session-item";
        item.innerHTML = `
          <div class="session-main">
            <div class="session-circle-score">${session.score}</div>
            <div class="session-info">
              <span class="session-title">Session #${session.id}</span>
              <span class="session-meta">
                <span>${dateStr}</span> • <span>${durationStr}</span> • <span>${session.mode === 'full' ? 'Full' : 'Self'}</span>
              </span>
            </div>
          </div>
          <div class="session-arrow"><i data-lucide="chevron-right"></i></div>
        `;
        item.addEventListener("click", () => {
          selectedSessionId = session.id;
          switchTab("tab-analysis");
        });
        sessionsList.appendChild(item);
      });
    }

    // Render Filler Words Pills
    const fillerContainer = document.getElementById("filler-words-frequency-container");
    fillerContainer.innerHTML = "";
    
    // Sum all filler counts
    const aggregateFillers = { um: 0, ah: 0, like: 0, youKnow: 0, actually: 0, other: 0 };
    sessions.forEach(s => {
      const f = s.fillerWords || {};
      Object.keys(aggregateFillers).forEach(k => {
        aggregateFillers[k] += (f[k] || 0);
      });
    });

    const displayKeys = [
      { key: "like", name: "like" },
      { key: "um", name: "um" },
      { key: "ah", name: "ah" },
      { key: "youKnow", name: "you know" },
      { key: "actually", name: "actually" },
      { key: "other", name: "others" }
    ];

    displayKeys.forEach(item => {
      const count = aggregateFillers[item.key];
      const pill = document.createElement("div");
      pill.className = `filler-pill ${count > 0 ? 'active' : ''}`;
      pill.innerHTML = `
        <span class="pill-val">${count}</span>
        <span class="pill-name">${item.name}</span>
      `;
      fillerContainer.appendChild(pill);
    });

    // Render Repeated Mistakes Tracker
    const mistakesList = document.getElementById("dashboard-mistakes-list");
    mistakesList.innerHTML = "";
    
    // Find mistakes occurring multiple times based on exact matches of 'original' phrasing
    const mistakesMap = {};
    sessions.forEach(s => {
      if (s.analysis && s.analysis.corrections) {
        s.analysis.corrections.forEach(c => {
          const key = c.original.trim().toLowerCase();
          if (!mistakesMap[key]) {
            mistakesMap[key] = { text: c.original, count: 0 };
          }
          mistakesMap[key].count++;
        });
      }
    });

    const sortedMistakes = Object.values(mistakesMap)
      .filter(m => m.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    if (sortedMistakes.length === 0) {
      mistakesList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="zap-off"></i>
          <p>No grammatical mistakes tracked yet.</p>
        </div>
      `;
    } else {
      sortedMistakes.forEach(m => {
        const row = document.createElement("div");
        row.className = "mistake-tag-item";
        row.innerHTML = `
          <span class="mistake-tag-name" title="${m.text}">"${truncateText(m.text, 35)}"</span>
          <span class="mistake-tag-count">${m.count}x flagged</span>
        `;
        mistakesList.appendChild(row);
      });
    }
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (err) {
    console.error("Dashboard render failed:", err);
  }
}

// ----------------------------------------------------
// 6. LIVE RECORDER CONTROLLER
// ----------------------------------------------------
async function checkMicPermissionStatus() {
  const micStatus = document.getElementById("mic-status");
  try {
    const permission = await navigator.permissions.query({ name: 'microphone' });
    updateMicStatusUI(permission.state);
    permission.onchange = () => updateMicStatusUI(permission.state);
  } catch (e) {
    // Fallback if permissions query is unsupported
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const hasMic = devices.some(d => d.kind === 'audioinput');
        updateMicStatusUI(hasMic ? "prompt" : "denied");
      })
      .catch(() => updateMicStatusUI("prompt"));
  }
}

function updateMicStatusUI(state) {
  const micStatus = document.getElementById("mic-status");
  const micFixRow = document.getElementById("mic-fix-row");
  const micRetryRow = document.getElementById("mic-retry-row");

  if (state === "granted") {
    micStatus.className = "status-badge success";
    micStatus.innerHTML = '<i data-lucide="check-circle"></i> Granted';
    if (micFixRow) micFixRow.style.display = "none";
    if (micRetryRow) micRetryRow.style.display = "none";
  } else if (state === "prompt") {
    micStatus.className = "status-badge warning";
    micStatus.innerHTML = '<i data-lucide="circle"></i> Click "Test Mic" to allow';
    if (micFixRow) micFixRow.style.display = "none";
    if (micRetryRow) micRetryRow.style.display = "none";
  } else if (state === "dismissed") {
    micStatus.className = "status-badge warning";
    micStatus.innerHTML = '<i data-lucide="alert-triangle"></i> Prompt dismissed';
    if (micFixRow) micFixRow.style.display = "none";
    if (micRetryRow) micRetryRow.style.display = "flex";
  } else {
    micStatus.className = "status-badge error";
    micStatus.innerHTML = '<i data-lucide="x-circle"></i> Blocked';
    if (micFixRow) micFixRow.style.display = "flex";
    if (micRetryRow) micRetryRow.style.display = "none";
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function openMicSettings() {
  // Open Chrome's microphone permission settings so user can unblock the extension
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
  } else {
    showToast("Go to Chrome Settings → Privacy → Site Settings → Microphone to unblock.", "info");
  }
}

function getVolumeRMS(analyser) {
  if (!analyser) return 0;
  const dataArray = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(dataArray);
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const val = (dataArray[i] - 128) / 128;
    sumSquares += val * val;
  }
  return Math.sqrt(sumSquares / dataArray.length);
}

// Visualizer Waveform Logic
function initAudioVisualizer(stream) {
  const canvas = document.getElementById("waveform-canvas");
  const ctx = canvas.getContext("2d");
  
  // Set resolution
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;

  // Create analyser from stream
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const source = audioContext.createMediaStreamSource(stream);
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024; // Reduced from 2048 — lower CPU/GPU load in side panel
  source.connect(analyserNode);

  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  lastSoundTime = Date.now();
  // Throttle to ~30 fps to reduce GPU pressure when running in the side panel.
  // At 60 fps the rAF loop was consuming a full CPU core when the IDE was open.
  let _lastDrawTs = 0;
  function draw(ts) {
    if (!isRecording && !isPaused) return;
    canvasAnimationId = requestAnimationFrame(draw);
    if (ts - _lastDrawTs < 33) return; // ~30 fps cap
    _lastDrawTs = ts;
    analyserNode.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "rgba(11, 15, 25, 0.4)"; // dark theme background color
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 3;
    // Set a glowing cyan/purple linear gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, '#6366f1'); // Indigo
    gradient.addColorStop(0.5, '#06b6d4'); // Cyan
    gradient.addColorStop(1, '#a855f7'); // Purple
    ctx.strokeStyle = gradient;
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // Volume level updates
    if (micAnalyser) {
      const micRMS = getVolumeRMS(micAnalyser);
      const micVolPercent = Math.min(100, Math.round(micRMS * 500));
      const micFill = document.getElementById("mic-volume-fill");
      if (micFill) micFill.style.width = `${micVolPercent}%`;

      // Mic silence check
      if (micRMS > 0.005) {
        lastSoundTime = Date.now();
        document.getElementById("mic-silence-warning").style.display = "none";
      } else if (Date.now() - lastSoundTime > 5000) {
        document.getElementById("mic-silence-warning").style.display = "flex";
      }
    }

    if (tabAnalyser) {
      const tabRMS = getVolumeRMS(tabAnalyser);
      const tabVolPercent = Math.min(100, Math.round(tabRMS * 500));
      const tabFill = document.getElementById("tab-volume-fill");
      if (tabFill) tabFill.style.width = `${tabVolPercent}%`;
    }
  }

  draw();
}

function handleRecordingModeChange() {
  const selectedMode = document.querySelector('input[name="recording-mode"]:checked').value;
  const tabStatusRow = document.getElementById("tab-status-row");
  
  if (selectedMode === "full") {
    fullInterviewConsentConfirmed = false;
    tabStatusRow.style.display = "flex";
    // Show consent modal
    document.getElementById("consent-modal").style.display = "flex";
  } else {
    fullInterviewConsentConfirmed = false;
    tabStatusRow.style.display = "none";
    // Reset consent checkboxes
    document.getElementById("consent-check-announce").checked = false;
    document.getElementById("consent-check-agree").checked = false;
    document.getElementById("consent-check-lawful").checked = false;
    document.getElementById("btn-consent-confirm").disabled = true;
    document.getElementById("tab-status").className = "status-badge error";
    document.getElementById("tab-status").innerHTML = '<i data-lucide="circle"></i> Waiting for consent';
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

function validateConsentCheckboxes() {
  const check1 = document.getElementById("consent-check-announce").checked;
  const check2 = document.getElementById("consent-check-agree").checked;
  const check3 = document.getElementById("consent-check-lawful").checked;
  document.getElementById("btn-consent-confirm").disabled = !(check1 && check2 && check3);
}

function cancelConsentModal() {
  fullInterviewConsentConfirmed = false;
  document.getElementById("consent-modal").style.display = "none";
  // Reset back to self recording mode
  document.getElementById("radio-mode-self").checked = true;
  handleRecordingModeChange();
}

function confirmConsentModal() {
  fullInterviewConsentConfirmed = true;
  document.getElementById("consent-modal").style.display = "none";
  const tabStatus = document.getElementById("tab-status");
  tabStatus.className = "status-badge success";
  tabStatus.innerHTML = '<i data-lucide="check-circle"></i> User Confirmed Consent';
  if (window.lucide) {
    window.lucide.createIcons();
  }
  showToast("Consent confirmation saved for this session.", "success");
}

function generateUuid() {
  return "sess_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

async function updateRecordingUIStats() {
  const modeEl = document.getElementById("rec-stat-mode");
  const chunksEl = document.getElementById("rec-stat-chunks");
  const saveEl = document.getElementById("rec-stat-save-status");
  const transEl = document.getElementById("rec-stat-transcription");
  const syncEl = document.getElementById("rec-stat-sync");
  const storageEl = document.getElementById("rec-stat-storage");

  const mode = document.querySelector('input[name="recording-mode"]:checked')?.value || "self";
  if (modeEl) modeEl.innerText = mode === "full" ? "Full Interview" : "Self Recording";

  if (!activeSessionId) {
    if (chunksEl) chunksEl.innerText = "0";
    if (storageEl) storageEl.innerText = "0 KB";
    if (saveEl) {
      saveEl.innerText = "IDLE";
      saveEl.style.color = "var(--text-muted)";
    }
    if (transEl) {
      transEl.innerText = "IDLE";
      transEl.style.color = "var(--text-muted)";
    }
    if (syncEl) {
      syncEl.innerText = "LOCAL ONLY";
      syncEl.style.color = "var(--text-muted)";
    }
    return;
  }

  try {
    const chunks = await localStore.getChunksForSession(activeSessionId);
    if (chunksEl) chunksEl.innerText = chunks.length;

    let totalBytes = 0;
    chunks.forEach(c => {
      totalBytes += c.blob?.size || 0;
    });
    const kb = (totalBytes / 1024).toFixed(1);
    if (storageEl) storageEl.innerText = `${kb} KB`;

    if (saveEl) {
      if (chunks.length > 0) {
        saveEl.innerText = "SAVED";
        saveEl.style.color = "#10b981";
      } else {
        saveEl.innerText = "IDLE";
        saveEl.style.color = "var(--text-muted)";
      }
    }
  } catch (err) {
    console.error("Failed to update recording UI stats:", err);
  }
}

// ── Server readiness gate (local mode) ────────────────────────────────────────

let _serverOfflineModalWired = false;

// Stage → human-readable message map (mirrors native_host.py stages)
const _STAGE_MESSAGES = {
  ffmpeg_missing:          "ffmpeg is not installed or not on PATH.",
  server_script_missing:   "TalkFlow server files are missing. Reinstall TalkFlow Companion.",
  server_start_failed:     "Could not start TalkFlow server. Check logs for details.",
  server_timeout:          "TalkFlow server did not respond in time. Try again or check logs.",
  whisper_error:           "Whisper transcription model failed to load.",
  ollama_missing:          "Ollama is not installed or not running.",
  model_missing:           "The AI analysis model (llama3.2:3b) is not downloaded.",
  model_downloading:       "Downloading AI model… This takes 2–5 minutes on first use. Please wait.",
  model_pull_timeout:      "Model download timed out after 10 minutes.",
  companion_not_installed: "TalkFlow Companion is not installed or the browser bridge is not registered.",
  native_host_error:       "Could not communicate with TalkFlow Companion.",
};

const _STAGE_FIXES = {
  ffmpeg_missing:          "Install TalkFlow Companion (includes bundled ffmpeg) or download ffmpeg from ffmpeg.org.",
  server_script_missing:   "Reinstall TalkFlow Companion from the GitHub releases page.",
  server_start_failed:     "Run start-talkflow-local.bat to see the error, or reinstall TalkFlow Companion.",
  server_timeout:          "Run start-talkflow-local.bat in a terminal to see detailed error output.",
  whisper_error:           "Reinstall Python dependencies: pip install -r requirements.txt, and ensure ffmpeg is on PATH.",
  ollama_missing:          "Install Ollama from ollama.com and start it, then click Retry.",
  model_missing:           "Open a terminal and run: ollama pull llama3.2:3b  (takes 2–5 minutes on first run).",
  model_downloading:       "Please wait. Do not close the browser. TalkFlow will start automatically when ready.",
  model_pull_timeout:      "Open a terminal and run: ollama pull llama3.2:3b",
  companion_not_installed: "Download and run TalkFlow Companion installer from https://github.com/YashrajOmar/TalkFlow/releases, then run install_native_host_windows.bat.",
  native_host_error:       "Restart TalkFlow Companion. If the problem persists, reinstall it.",
};

/**
 * Show an inline "Preparing TalkFlow…" status in the recorder card.
 * @param {string|null} text - Status message, or null to hide.
 */
function _updateReadinessStatus(text) {
  let el = document.getElementById("readiness-status-bar");
  if (!el) {
    // Create it lazily under the start button
    const startBtn = document.getElementById("btn-start-record");
    if (!startBtn) return;
    el = document.createElement("div");
    el.id = "readiness-status-bar";
    el.style.cssText = [
      "display:flex","align-items:center","gap:0.5rem",
      "font-size:0.8rem","color:var(--text-muted)","margin-top:0.5rem",
      "padding:0.4rem 0.8rem","background:rgba(99,102,241,0.08)",
      "border-radius:6px","border:1px solid rgba(99,102,241,0.2)"
    ].join(";");
    startBtn.parentNode.insertBefore(el, startBtn.nextSibling);
  }
  if (text === null) {
    el.style.display = "none";
    el.textContent = "";
  } else {
    el.style.display = "flex";
    el.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.2s infinite;"></span> ${text}`;
  }
}

/**
 * Update the server-offline modal with stage-specific error content.
 * @param {Object} result - ensureReady result from native host.
 */
function _updateOfflineModal(result) {
  const stage = result.stage || "unknown";
  const msg = result.message || _STAGE_MESSAGES[stage] || "TalkFlow local companion is not running.";
  const fix = result.fix   || _STAGE_FIXES[stage]    || "Start TalkFlow Companion and click Retry.";

  const msgEl = document.getElementById("server-offline-error-msg");
  const fixEl = document.getElementById("server-offline-fix-msg");
  const stageEl = document.getElementById("server-offline-stage-badge");

  if (msgEl) msgEl.textContent = msg;
  if (fixEl) fixEl.textContent = fix;
  if (stageEl) {
    stageEl.textContent = stage.replace(/_/g, " ");
    stageEl.style.display = "inline";
  }
}

/**
 * Full readiness gate using native host's ensureReady action.
 *
 * UX flow:
 *   1. Fast HTTP ping — if server already up, return immediately.
 *   2. Show inline "Preparing TalkFlow…" status.
 *   3. Subscribe to readiness_progress broadcasts (for model_downloading updates).
 *   4. Call ensureReady via background.js (polls internally for model download).
 *   5. On success → hide status bar, return true.
 *   6. On failure (hard stage) → show offline modal, return false.
 */
async function _ensureReady() {
  // 1. Fast HTTP check — server already running?
  try {
    const res = await fetch("http://127.0.0.1:8765/health", {
      method: "GET", signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      console.log("[TalkFlow] Local server already online ✅");
      return true;
    }
  } catch (_) { /* offline, continue */ }

  // 2. Show inline status
  _updateReadinessStatus("Preparing TalkFlow… (this may take up to 3 minutes on first launch)");

  // 3. Subscribe to progress events from background.js polling loop
  const progressHandler = (msg) => {
    if (msg.action !== "readiness_progress") return;
    if (msg.stage === "model_downloading") {
      const elapsed = msg.pull_elapsed_seconds
        ? ` (${msg.pull_elapsed_seconds}s elapsed)` : "";
      _updateReadinessStatus(
        `Downloading AI model${elapsed}… Please wait, do not close the browser.`
      );
    }
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  // 4. ensureReady via background → native host (handles polling loop for model pull)
  let result = null;
  try {
    result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "ensureReady" }, (r) => {
        resolve(r || { ok: false, stage: "native_host_error",
          error: chrome.runtime.lastError?.message, noHost: true });
      });
    });
  } catch (err) {
    result = { ok: false, stage: "native_host_error", error: err.message, noHost: true };
  }

  // Clean up progress listener
  chrome.runtime.onMessage.removeListener(progressHandler);

  // 5. Hide inline status
  _updateReadinessStatus(null);

  if (result?.ok) {
    console.log("[TalkFlow] ensureReady succeeded ✅");
    return true;
  }

  // 6. Show offline modal with stage-specific message
  console.warn("[TalkFlow] ensureReady failed:", result);

  // background.js now pre-maps noHost → companion_not_installed stage;
  // handle legacy case where stage is still missing
  if (!result?.stage) {
    result = {
      ...result,
      stage: result?.noHost ? "companion_not_installed" : "native_host_error",
    };
  }

  _updateOfflineModal(result);
  _wireServerOfflineModal();
  const modal = document.getElementById("server-offline-modal");
  if (modal) modal.style.display = "flex";
  if (window.lucide) window.lucide.createIcons();
  return false;
}

/** Keep old name as alias for backward compatibility. */
const _ensureLocalServerRunning = _ensureReady;

/**
 * Wire the server-offline modal buttons (idempotent — only runs once).
 */
function _wireServerOfflineModal() {
  if (_serverOfflineModalWired) return;
  _serverOfflineModalWired = true;

  const modal = document.getElementById("server-offline-modal");
  const hide = () => { if (modal) modal.style.display = "none"; };

  // Retry — re-runs the full readiness check
  document.getElementById("btn-server-retry")?.addEventListener("click", async () => {
    hide();
    const ok = await _ensureReady();
    if (ok) startRecording();
  });

  // Open setup guide — navigates to Settings → Diagnostics
  document.getElementById("btn-server-setup-guide")?.addEventListener("click", () => {
    hide();
    switchTab("tab-settings");
    setTimeout(() => {
      document.getElementById("diagnostics-card")?.scrollIntoView({ behavior: "smooth" });
    }, 300);
  });

  // Use Cloud — explicit confirmation before switching to cloud provider
  document.getElementById("btn-server-switch-cloud")?.addEventListener("click", async () => {
    await _confirmCloudSwitch(hide);
  });

  // Cancel
  document.getElementById("btn-server-offline-cancel")?.addEventListener("click", hide);
}

// ── Cloud switch with explicit privacy confirmation ────────────────────────────

/**
 * Show a privacy confirmation dialog before switching to a cloud provider.
 * The user must explicitly click "Use Cloud Now" to proceed.
 * Cancelling leaves the provider as "local" — no silent data routing.
 *
 * @param {Function} hideOfflineModal - callback to close the offline modal
 */
async function _confirmCloudSwitch(hideOfflineModal) {
  const openAIKey = await getLocalStorage("openai_api_key");
  const geminiKey = await getLocalStorage("gemini_api_key");
  const newProvider = openAIKey ? "openai" : (geminiKey ? "gemini" : null);

  const providerName = newProvider === "openai" ? "OpenAI Whisper"
                     : newProvider === "gemini"  ? "Google Gemini"
                     : null;

  // If no cloud key configured at all, send user to Settings instead
  if (!providerName) {
    hideOfflineModal();
    showToast(
      "No cloud API key configured. Add an OpenAI or Gemini key in Settings to use cloud mode.",
      "warning"
    );
    switchTab("tab-settings");
    return;
  }

  // Show the cloud-confirmation modal (wired lazily)
  const modal = document.getElementById("cloud-confirm-modal");
  const bodyEl = document.getElementById("cloud-confirm-body");

  if (bodyEl) {
    bodyEl.innerHTML = `
      <p style="margin:0 0 0.75rem; font-size:0.9rem;">
        You are about to switch to <strong>${providerName}</strong> for this session.
      </p>
      <div style="background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.25);
                  border-radius:6px; padding:0.75rem 1rem; margin-bottom:0.75rem;">
        <div style="font-size:0.72rem; font-weight:700; color:var(--text-warning);
                    letter-spacing:0.05em; margin-bottom:0.35rem;">PRIVACY NOTICE</div>
        <p style="font-size:0.82rem; color:var(--text-muted); margin:0;">
          Your audio recording and transcription will be sent to
          <strong>${providerName}</strong> servers using your configured API key.
          TalkFlow does not store this data, but ${providerName}'s privacy policy applies.
        </p>
      </div>
      <p style="font-size:0.75rem; color:var(--text-muted); margin:0;">
        To change back to local processing, go to <strong>Settings → Transcription Provider → Local (faster-whisper)</strong>.
      </p>
    `;
  }

  if (!modal) {
    // Fallback: browser confirm if modal HTML not present
    const confirmed = window.confirm(
      `Switch to ${providerName}?\n\n` +
      `Your audio will be sent to ${providerName} servers using your API key.\n\n` +
      `Click OK to continue with cloud transcription.`
    );
    if (!confirmed) return;
    await _doCloudSwitch(hideOfflineModal, newProvider);
    return;
  }

  // Wire the confirmation modal buttons (idempotent)
  const confirmBtn = document.getElementById("btn-cloud-confirm-ok");
  const cancelBtn  = document.getElementById("btn-cloud-confirm-cancel");

  const cleanup = () => { modal.style.display = "none"; };

  // Remove old listeners by cloning the buttons
  const newConfirm = confirmBtn?.cloneNode(true);
  const newCancel  = cancelBtn?.cloneNode(true);
  if (confirmBtn && newConfirm) confirmBtn.replaceWith(newConfirm);
  if (cancelBtn  && newCancel)  cancelBtn.replaceWith(newCancel);

  document.getElementById("btn-cloud-confirm-ok")?.addEventListener("click", async () => {
    cleanup();
    await _doCloudSwitch(hideOfflineModal, newProvider);
  });
  document.getElementById("btn-cloud-confirm-cancel")?.addEventListener("click", cleanup);

  modal.style.display = "flex";
  if (window.lucide) window.lucide.createIcons();
}

async function _doCloudSwitch(hideOfflineModal, newProvider) {
  hideOfflineModal();
  await setLocalStorage("transcription_provider", newProvider);
  const sel = document.getElementById("settings-transcription-provider");
  if (sel) sel.value = newProvider;
  const name = newProvider === "openai" ? "OpenAI Whisper" : "Google Gemini";
  showToast(`Switched to ${name} for this session. Change back anytime in Settings.`, "info");
  startRecording();
}

// ── Diagnostics ────────────────────────────────────────────────────────────────


/**
 * Fetch /diagnostics from server (or via native host) and show the result
 * in the diagnostics modal.
 */
async function runDiagnostics() {
  const btn = document.getElementById("btn-run-diagnostics");
  if (btn) { btn.disabled = true; btn.textContent = "Running…"; }

  let diagData = null;
  let error = null;

  // Try direct HTTP first (fast if server is running)
  try {
    const res = await fetch("http://127.0.0.1:8765/diagnostics", {
      method: "GET", signal: AbortSignal.timeout(5000)
    });
    if (res.ok) diagData = await res.json();
  } catch (_) { /* fall through */ }

  // If not available, try via background → native host
  if (!diagData) {
    try {
      const reply = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "getDiagnostics" }, resolve);
      });
      if (reply?.ok) diagData = reply.data;
      else error = reply?.error || "Server is not running";
    } catch (e) {
      error = e.message;
    }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="activity"></i> Run Diagnostics'; }
  if (window.lucide) window.lucide.createIcons();

  // Show diagnostics modal
  const modal = document.getElementById("diagnostics-modal");
  const content = document.getElementById("diagnostics-modal-content");
  if (!modal || !content) {
    showToast("Diagnostics UI not found. Reload the extension.", "error");
    return;
  }

  if (error && !diagData) {
    content.textContent = `Error: ${error}\n\nMake sure TalkFlow Local Companion is running.`;
  } else if (diagData) {
    // Format nicely
    const lines = [
      `TalkFlow Diagnostics — ${new Date().toLocaleString()}`,
      "=".repeat(56),
      "",
      `Server           : ${diagData.server || "unknown"}`,
      `Python           : ${(diagData.python || "").split(" ")[0]}`,
      `Platform         : ${diagData.platform || "unknown"}`,
      "",
      `ffmpeg available : ${diagData.ffmpeg?.available ? "✅ Yes" : "❌ No"}`,
      `ffmpeg path      : ${diagData.ffmpeg?.path || "not found"}`,
      `ffmpeg version   : ${diagData.ffmpeg?.version || "unknown"}`,
      "",
      `Whisper model    : ${diagData.whisper?.model || "unknown"}`,
      `Whisper status   : ${diagData.whisper?.status || "unknown"}`,
      `Whisper loaded   : ${diagData.whisper?.model_loaded ? "✅ Yes" : "❌ No"}`,
      `Whisper device   : ${diagData.whisper?.device || "cpu"}`,
      diagData.whisper?.error ? `Whisper error    : ${diagData.whisper.error}` : null,
      "",
      `Ollama reachable : ${diagData.ollama?.reachable ? "✅ Yes" : "❌ No"}`,
      `Target model     : ${diagData.ollama?.target_model || "llama3.2:3b"}`,
      `Model available  : ${diagData.ollama?.model_available ? "✅ Yes" : "❌ No"}`,
      `Installed models : ${(diagData.ollama?.models || []).join(", ") || "none"}`,
      diagData.ollama?.error ? `Ollama error     : ${diagData.ollama.error}` : null,
      "",
      `Server port      : ${diagData.config?.port || 8765}`,
      `Extension ID     : ${chrome.runtime.id}`,
    ].filter(l => l !== null).join("\n");

    content.textContent = lines;
  }

  modal.style.display = "flex";
  if (window.lucide) window.lucide.createIcons();
}

// ─────────────────────────────────────────────────────────────────────────────

function pauseRecording() {
  if (!isRecording || isPaused) return;
  isPaused = true;
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.requestData();
    mediaRecorder.pause();
  }
  if (tabMediaRecorder && tabMediaRecorder.state === "recording") {
    tabMediaRecorder.requestData();
    tabMediaRecorder.pause();
  }
  clearInterval(timerInterval);
  const btnPause = document.getElementById("btn-pause-record");
  if (btnPause) {
    btnPause.innerHTML = '<i data-lucide="play-circle"></i> Resume';
  }
  if (window.lucide) window.lucide.createIcons();
  showToast("Recording paused.", "info");
}

function resumeRecording() {
  if (!isRecording || !isPaused) return;
  isPaused = false;
  currentChunkStartSeconds = sessionDurationSeconds;
  currentChunkStartBySpeaker.you = sessionDurationSeconds;
  currentChunkStartBySpeaker.interviewer = sessionDurationSeconds;
  if (mediaRecorder && mediaRecorder.state === "paused") {
    mediaRecorder.resume();
  }
  if (tabMediaRecorder && tabMediaRecorder.state === "paused") {
    tabMediaRecorder.resume();
  }
  
  timerInterval = setInterval(() => {
    sessionDurationSeconds++;
    document.getElementById("recording-timer-display").innerText = formatDuration(sessionDurationSeconds);
  }, 1000);

  const btnPause = document.getElementById("btn-pause-record");
  if (btnPause) {
    btnPause.innerHTML = '<i data-lucide="pause-circle"></i> Pause';
  }
  if (window.lucide) window.lucide.createIcons();
  showToast("Recording resumed.", "success");
}

// Main Recording Loop
async function startRecording() {
  const txProvider = await getLocalStorage("transcription_provider") || "local";

  // ── Local provider: gate on server being online ────────────────────────────
  if (txProvider === "local") {
    const serverOk = await _ensureLocalServerRunning();
    if (!serverOk) return; // modal is showing; user must retry or switch
  }

  // ── Gemini provider: require API key ───────────────────────────────────────
  if (txProvider === "gemini") {
    const apiKey = await getLocalStorage("gemini_api_key");
    if (!apiKey) {
      showToast("Please configure your Gemini API Key in Settings first to use Gemini transcription.", "error");
      switchTab("tab-settings");
      return;
    }
  }

  const selectedMode = document.querySelector('input[name="recording-mode"]:checked').value;

  if (selectedMode === "full" && !fullInterviewConsentConfirmed) {
    showToast("Full Interview mode requires consent confirmation first.", "error");
    document.getElementById("consent-modal").style.display = "flex";
    return;
  }

  let mixedStream = null;
  let micStream = null;
  let displayStream = null;

  async function acquireMicStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') throw err;

      let permState = 'prompt';
      try { permState = (await navigator.permissions.query({ name: 'microphone' })).state; } catch (_) {}

      if (permState === 'denied') {
        throw new Error('Microphone is blocked in Chrome settings. Click the lock icon in the address bar → Site settings → Microphone → Allow.');
      }

      showToast("Opening permission window — click Allow when Chrome asks.", "info");
      return await new Promise((resolve, reject) => {
        const handler = (msg) => {
          if (msg.type === 'TALKFLOW_MIC_GRANTED') {
            chrome.runtime.onMessage.removeListener(handler);
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
              .then(resolve).catch(reject);
          } else if (msg.type === 'TALKFLOW_MIC_DENIED') {
            chrome.runtime.onMessage.removeListener(handler);
            reject(new Error(`Microphone permission denied (${msg.error}). Grant access via the permission popup.`));
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        chrome.windows.create({
          url: chrome.runtime.getURL('permission.html'),
          type: 'popup', width: 400, height: 300, focused: true
        });
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(handler);
          reject(new Error('Permission popup timed out. Please try again.'));
        }, 60000);
      });
    }
  }

  try {
    // 1. Acquire microphone
    showToast("Requesting microphone access...", "info");
    micStream = await acquireMicStream();
    updateMicStatusUI("granted");

    // Initialize AudioContext & Analyse node for mic
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Resume AudioContext if suspended (browser security autoplay policies)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    audioSourceMic = audioContext.createMediaStreamSource(micStream);
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 512;
    audioSourceMic.connect(micAnalyser);

    // 2. Full Interview Mode: mix tab audio
    if (selectedMode === "full") {
      try {
        showToast("Select the interview/browser tab and enable 'Share tab audio'.", "info");
        
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });

        const tabAudioTrack = displayStream?.getAudioTracks()[0];
        if (!tabAudioTrack) {
          micStream.getTracks().forEach(t => t.stop());
          displayStream?.getTracks().forEach(t => t.stop());
          showToast("No tab audio was shared. Please select a browser tab and enable Share tab audio.", "error");
          return;
        }

        audioSourceTab = audioContext.createMediaStreamSource(new MediaStream([tabAudioTrack]));
        tabAnalyser = audioContext.createAnalyser();
        tabAnalyser.fftSize = 512;
        audioSourceTab.connect(tabAnalyser);

        audioDestination = audioContext.createMediaStreamDestination();
        audioSourceMic.connect(audioDestination);
        audioSourceTab.connect(audioDestination);
        mixedStream = audioDestination.stream;
        
        const tabVolRow = document.getElementById("tab-volume-row");
        if (tabVolRow) tabVolRow.style.display = "flex";

        tabAudioTrack.onended = () => { if (isRecording) stopRecording(); };
      } catch (err) {
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        if (displayStream) displayStream.getTracks().forEach(t => t.stop());
        showToast("Full Interview mode cancelled: " + err.message, "warning");
        return;
      }
    } else {
      mixedStream = micStream;
      tabAnalyser = null;
      const tabVolRow = document.getElementById("tab-volume-row");
      if (tabVolRow) tabVolRow.style.display = "none";
    }

    // 3. Initialize or Resume Session ID & Manifest
    const wasRecovered = activeSessionId !== null;
    if (!wasRecovered) {
      activeSessionId = generateUuid();
      const storageProvider = await getLocalStorage("storage_provider") || "local";
      
      const manifest = {
        sessionId: activeSessionId,
        createdAt: new Date().toISOString(),
        mode: selectedMode,
        duration: 0,
        chunks: [],
        transcript: "",
        analysis: null,
        storageProvider: storageProvider,
        syncStatus: "local",
        status: "unfinished"
      };
      await localStore.saveActiveSession(manifest);
      await setLocalStorage("active_session_id", activeSessionId);
    }

    // Determine current chunk index in case of recovery
    const existingChunks = await localStore.getChunksForSession(activeSessionId);
    let chunkIndex = existingChunks.length;

    // 4. Setup MediaRecorders with 60s timeslices.
    // Full Interview mode records mic and tab as separate tracks so we can
    // analyze the candidate without confusing interviewer speech as mistakes.
    audioChunks = [];
    mediaRecorder = new MediaRecorder(micStream);
    
    recordStartTime = wasRecovered ? (Date.now() - (sessionDurationSeconds * 1000)) : Date.now();
    currentChunkStartSeconds = sessionDurationSeconds;
    currentChunkStartBySpeaker = {
      you: sessionDurationSeconds,
      interviewer: sessionDurationSeconds
    };

    const saveRecordedChunk = (event, speaker = "you") => {
      if (event.data && event.data.size > 0) {
        const currentChunkIndex = chunkIndex++;
        const blob = event.data;
        const startSeconds = currentChunkStartBySpeaker[speaker] ?? currentChunkStartSeconds;
        const endSeconds = Math.max(startSeconds, sessionDurationSeconds);
        currentChunkStartBySpeaker[speaker] = endSeconds;
        if (speaker === "you") currentChunkStartSeconds = endSeconds;

        // Save chunk immediately to IndexedDB
        const chunkRecord = {
          sessionId: activeSessionId,
          chunkIndex: currentChunkIndex,
          speaker,
          startTime: startSeconds,
          endTime: endSeconds,
          blob: blob,
          transcriptionStatus: "pending",
          cloudSyncStatus: "local"
        };
        
        const savePromise = localStore.saveChunk(chunkRecord)
          .then(() => {
            updateRecordingUIStats();
            // Remove promise from array when done
            activeSavePromises = activeSavePromises.filter(p => p !== savePromise);
          })
          .catch(err => {
            console.error("Failed to save chunk:", err);
            activeSavePromises = activeSavePromises.filter(p => p !== savePromise);
          });
        activeSavePromises.push(savePromise);
      }
    };
    mediaRecorder.ondataavailable = (event) => saveRecordedChunk(event, "you");

    let stoppedRecorders = 0;
    let expectedRecorderStops = 1;
    const finalizeAfterAllRecordersStop = () => {
      stoppedRecorders++;
      if (stoppedRecorders < expectedRecorderStops) return;

      // Stop all media tracks only after every recorder has emitted final data.
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (displayStream) displayStream.getTracks().forEach(t => t.stop());
      if (mixedStream) mixedStream.getTracks().forEach(t => t.stop());

      micAnalyser = null;
      tabAnalyser = null;
      analyserNode = null;
      tabMediaRecorder = null;

      // Close AudioContext to release CPU and hardware resources
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => {
          audioContext = null;
          console.log('[TalkFlow] AudioContext closed and released.');
        }).catch(err => {
          console.warn('[TalkFlow] Failed to close AudioContext:', err);
          audioContext = null;
        });
      } else {
        audioContext = null;
      }

      processRecordedAudio();
    };
    mediaRecorder.onstop = finalizeAfterAllRecordersStop;

    tabMediaRecorder = null;
    if (selectedMode === "full" && audioSourceTab) {
      const tabTrack = displayStream?.getAudioTracks()[0];
      if (tabTrack) {
        tabMediaRecorder = new MediaRecorder(new MediaStream([tabTrack]));
        tabMediaRecorder.ondataavailable = (event) => saveRecordedChunk(event, "interviewer");
        tabMediaRecorder.onstop = finalizeAfterAllRecordersStop;
        expectedRecorderStops = 2;
      }
    }

    // Timer setup — always clear any stale interval and reset to 0 first.
    // Without this, repeated recordings stack setIntervals and the timer
    // accelerates (adds N extra ticks/sec where N = number of prior recordings).
    clearInterval(timerInterval);
    timerInterval = null;
    sessionDurationSeconds = 0;
    document.getElementById("recording-timer-display").innerText = formatDuration(0);
    timerInterval = setInterval(() => {
      sessionDurationSeconds++;
      document.getElementById("recording-timer-display").innerText = formatDuration(sessionDurationSeconds);
    }, 1000);

    isRecording = true;
    isPaused = false;
    initAudioVisualizer(mixedStream);
    mediaRecorder.start(CHUNK_DURATION); // timeslices fired every CHUNK_DURATION ms
    if (tabMediaRecorder) tabMediaRecorder.start(CHUNK_DURATION);
    showToast("Recording started. Click \"End Session & Analyze\" when done.", "success");

  } catch (err) {
    console.error("Recording start failed:", err);
    const msg = err.message || err.name || 'Unknown error';
    if (err.name === 'NotFoundError' || msg.includes('Requested device not found')) {
      showToast("No microphone found. Connect a microphone and try again.", "error");
    } else {
      showToast(msg, "error");
    }
    updateMicStatusUI('denied');
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  isPaused = false;

  clearInterval(timerInterval);
  cancelAnimationFrame(canvasAnimationId);
  
  if (speechRecognition) {
    speechRecognition.onend = null;
    speechRecognition.onerror = null;
    speechRecognition.stop();
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (tabMediaRecorder && tabMediaRecorder.state !== "inactive") {
    tabMediaRecorder.stop();
  }

  document.getElementById("btn-start-record").style.display = "inline-flex";
  document.getElementById("btn-test-mic").style.display = "inline-flex";
  document.getElementById("btn-stop-record").style.display = "none";
  document.getElementById("btn-pause-record").style.display = "none";
  document.getElementById("live-stt-badge").style.display = "none";
  document.querySelector(".recorder-card").classList.remove("recording");
  
  showToast("Recording captured. Processing...", "info");
}

async function processRecordedAudio() {
  const transStatEl = document.getElementById("rec-stat-transcription");
  if (transStatEl) {
    transStatEl.innerText = "TRANSCRIBING...";
    transStatEl.style.color = "var(--warning-color)";
  }

  // Wait for all outstanding chunk writes — use allSettled so a single
  // failed IndexedDB write does not abort the entire post-recording flow.
  if (activeSavePromises && activeSavePromises.length > 0) {
    console.log("[TalkFlow] Waiting for", activeSavePromises.length, "pending chunk saves...");
    const settled = await Promise.allSettled(activeSavePromises);
    const failed = settled.filter(r => r.status === "rejected");
    if (failed.length > 0) {
      console.warn("[TalkFlow]", failed.length, "chunk save(s) failed:", failed.map(r => r.reason));
    }
  }
  activeSavePromises = [];

  // Guard: ensure we have an active session to load
  console.log("[TalkFlow] activeSessionId:", activeSessionId);
  if (!activeSessionId) {
    showToast("No active recording session found. Please start a new recording.", "error");
    if (transStatEl) { transStatEl.innerText = "IDLE"; transStatEl.style.color = "var(--text-muted)"; }
    return;
  }

  // 1. Load chunks from IndexedDB
  let chunks = [];
  try {
    chunks = await localStore.getChunksForSession(activeSessionId);
    console.log("[TalkFlow] chunks loaded:", chunks.length);
    console.log("[TalkFlow] chunk sizes:", chunks.map(c => c.blob?.size));
  } catch (err) {
    console.error("Failed to load recording chunks:", err);
    showToast("Failed to load recording chunks from database.", "error");
    return;
  }

  if (chunks.length === 0) {
    showToast("No saved audio chunks found. Recording may not have been saved correctly. Check your microphone and try again.", "error");
    if (transStatEl) { transStatEl.innerText = "FAILED"; transStatEl.style.color = "var(--danger-color)"; }
    return;
  }

  // Calculate duration if not populated (e.g. recovered session)
  if (sessionDurationSeconds === 0 && chunks.length > 0) {
    sessionDurationSeconds = chunks[chunks.length - 1].endTime;
    const timerDisplay = document.getElementById("recording-timer-display");
    if (timerDisplay) timerDisplay.innerText = formatDuration(sessionDurationSeconds);
  }

  // 2. Duration check — keep chunks available for download/debug; don't delete them
  if (sessionDurationSeconds < 10) {
    showToast("Recording is too short. Please record at least 10 seconds.", "warning");

    if (transStatEl) {
      transStatEl.innerText = "IDLE";
      transStatEl.style.color = "var(--text-muted)";
    }

    // Show the Download Recording button so user can retrieve what was captured
    const dlBtn = document.getElementById('btn-download-recording');
    if (dlBtn) dlBtn.style.display = 'inline-flex';
    // Wire blob for download on-demand (assembled lazily)
    lastRecordingBlob = null; // will be built on click
    _lastChunksForDownload = chunks;

    const box = document.getElementById("live-transcript-box");
    if (box) {
      box.innerHTML = `
        <div class="warning-box" style="padding: 1rem; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px;">
          <h4 style="color: #ef4444; margin: 0 0 0.5rem 0; font-size: 0.95rem; font-weight: bold;">Recording Too Short</h4>
          <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted);">Please record at least 10 seconds of speech before ending the session. Chunks are still available to download above.</p>
        </div>
      `;
    }
    // Do NOT delete chunks here — user can download or manually discard
    return;
  }

  // Do NOT assemble a giant Blob eagerly — for long recordings this can use
  // gigabytes of RAM. We store chunk refs and assemble on-demand at download time.
  // The download button is shown immediately; blob is built in downloadLastRecording().
  _lastChunksForDownload = chunks;
  lastRecordingBlob = null; // cleared — will be assembled on download click
  const dlBtn = document.getElementById('btn-download-recording');
  if (dlBtn) dlBtn.style.display = 'inline-flex';

  try {
    const model = await getLocalStorage("gemini_model") || "gemini-2.5-flash";
    const mode = document.querySelector('input[name="recording-mode"]:checked').value;
    const txProvider = await getLocalStorage("transcription_provider") || "local";

    console.log("[TalkFlow] Selected Transcription Provider:", txProvider);
    console.log("[TalkFlow] chunks for transcription:", chunks.length);
    console.log("[TalkFlow] Recording Duration:", sessionDurationSeconds, "seconds");

    async function transcribeBlob(blob) {
      if (txProvider === 'openai') {
        const openAIKey = await getLocalStorage("openai_api_key");
        if (!openAIKey) throw new Error('OpenAI API key is missing. Add it in Settings.');
        try {
          return await transcribeAudioOpenAI(openAIKey, blob);
        } catch (err) {
          console.warn("[TalkFlow] OpenAI transcription failed, falling back to local:", err);
          showToast("Cloud transcription failed. Falling back to local Whisper.", "warning");
          return await transcribeAudioLocal(blob);
        }
      }
      if (txProvider === 'local') {
        return await transcribeAudioLocal(blob);
      }
      const geminiKey = await getLocalStorage("gemini_api_key");
      if (!geminiKey) {
        showToast("Gemini API key is not set. Go to Settings and add your key for Gemini transcription.", "error");
        switchTab("tab-settings");
        if (transStatEl) {
          transStatEl.innerText = "FAILED";
          transStatEl.style.color = "var(--danger-color)";
        }
        throw new Error("Gemini API key missing.");
      }
      try {
        return await transcribeAudioGemini(geminiKey, blob, model);
      } catch (err) {
        console.warn("[TalkFlow] Gemini transcription failed, falling back to local:", err);
        showToast("Gemini transcription failed. Falling back to local Whisper.", "warning");
        return await transcribeAudioLocal(blob);
      }
    }

    async function transcribeChunkList(chunkList, label) {
      if (!chunkList.length) return { text: "", segments: [] };
      const segments = [];
      const shouldChunk = chunkList.length > 1 || sessionDurationSeconds >= 300;

      if (!shouldChunk) {
        const blob = new Blob(chunkList.map(c => c.blob), { type: chunkList[0]?.blob?.type || 'audio/webm' });
        showToast(`Transcribing ${label} audio...`, "info");
        const text = await transcribeBlob(blob);
        if (text?.trim()) segments.push({ speaker: label, startTime: chunkList[0].startTime || 0, text: text.trim() });
      } else {
        for (let i = 0; i < chunkList.length; i++) {
          const chunk = chunkList[i];
          const progressMsg = `Transcribing ${label} chunk ${i + 1} of ${chunkList.length}...`;
          if (transStatEl) transStatEl.innerText = progressMsg;
          showToast(progressMsg, "info");

          let chunkText = "";
          try {
            chunkText = await transcribeBlob(chunk.blob);
          } catch (chunkErr) {
            console.warn(`${label} chunk ${i} transcription failed:`, chunkErr);
            chunkText = `[Transcription failed for ${formatDuration(chunk.startTime)} - ${formatDuration(chunk.endTime)}]`;
          }
          if (chunkText?.trim()) segments.push({ speaker: label, startTime: chunk.startTime || 0, text: chunkText.trim() });
        }
      }

      return { text: segments.map(s => s.text).join(" ").trim(), segments };
    }

    let finalizedTranscript = "";
    let analysisTranscript = "";
    let transcriptSegments = [];
    
    const youChunks = chunks.filter(c => !c.speaker || c.speaker === "you");
    const interviewerChunks = chunks.filter(c => c.speaker === "interviewer");
    const youResult = await transcribeChunkList(youChunks, "You");
    analysisTranscript = youResult.text;
    transcriptSegments = [...youResult.segments];

    if (mode === "full" && interviewerChunks.length > 0) {
      const interviewerResult = await transcribeChunkList(interviewerChunks, "Interviewer");
      transcriptSegments.push(...interviewerResult.segments);
    }

    transcriptSegments.sort((a, b) => a.startTime - b.startTime);
    finalizedTranscript = transcriptSegments
      .map(s => `${s.speaker}: ${s.text}`)
      .join("\n\n")
      .trim();
    if (mode !== "full") {
      finalizedTranscript = analysisTranscript;
    }

    // Legacy mixed-audio path kept unreachable while the speaker-aware path above is active.
    if (false) {
    // Transcription Strategy: chunk-by-chunk for long recordings (>= 300s), single blob for short
    if (sessionDurationSeconds >= 300 && chunks.length > 1) {
      const textParts = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const progressMsg = `Transcribing chunk ${i + 1} of ${chunks.length}...`;
        if (transStatEl) transStatEl.innerText = progressMsg;
        showToast(progressMsg, "info");

        let chunkText = "";
        try {
          if (txProvider === 'openai') {
            const openAIKey = await getLocalStorage("openai_api_key");
            if (!openAIKey) throw new Error('OpenAI API key missing.');
            chunkText = await transcribeAudioOpenAI(openAIKey, chunk.blob);
          } else if (txProvider === 'local') {
            chunkText = await transcribeAudioLocal(chunk.blob);
          } else {
            const geminiKey = await getLocalStorage("gemini_api_key");
            if (!geminiKey) throw new Error('Gemini API key missing.');
            chunkText = await transcribeAudioGemini(geminiKey, chunk.blob, model);
          }
        } catch (chunkErr) {
          console.warn(`Chunk ${i} transcription failed:`, chunkErr);
          chunkText = `[Transcription Failed for ${formatDuration(chunk.startTime)} - ${formatDuration(chunk.endTime)}]`;
        }
        if (chunkText && chunkText.trim()) {
          textParts.push(chunkText.trim());
        }
      }
      finalizedTranscript = textParts.join(" ").trim();
    } else {
      // Short recording transcription
      // Short recordings: assemble blob only for the short case (< 300s, single chunk scenario)
      const shortBlob = new Blob(chunks.map(c => c.blob), { type: chunks[0]?.blob?.type || 'audio/webm' });
      if (txProvider === 'openai') {
        const openAIKey = await getLocalStorage("openai_api_key");
        if (!openAIKey) throw new Error('OpenAI API key is missing. Add it in Settings → Transcription Provider.');
        showToast("Transcribing with OpenAI Whisper...", "info");
        finalizedTranscript = await transcribeAudioOpenAI(openAIKey, shortBlob);
      } else if (txProvider === 'local') {
        showToast("Transcribing locally with Whisper...", "info");
        finalizedTranscript = await transcribeAudioLocal(shortBlob);
      } else {
        const geminiKey = await getLocalStorage("gemini_api_key");
        if (!geminiKey) {
          showToast("Gemini API key is not set. Go to Settings and add your key for Gemini transcription.", "error");
          switchTab("tab-settings");
          if (transStatEl) {
            transStatEl.innerText = "FAILED";
            transStatEl.style.color = "var(--danger-color)";
          }
          return;
        }
        showToast("Transcribing with Gemini (may take ~10 seconds)...", "info");
        finalizedTranscript = await transcribeAudioGemini(geminiKey, shortBlob, model);
      }
    }

    }

    if (transStatEl) {
      transStatEl.innerText = "DONE";
      transStatEl.style.color = "var(--success-color)";
    }

    if (!analysisTranscript?.trim()) {
      showToast("Audio captured, but transcription was unclear.", "warning");
      const box = document.getElementById("live-transcript-box");
      if (box) {
        box.innerHTML = `
          <div class="warning-box" style="padding: 1rem; background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.25); border-radius: 8px;">
            <h4 style="color: var(--text-warning); margin: 0 0 0.5rem 0; font-size: 0.95rem; font-weight: bold;">Unclear Audio Captured</h4>
            <p style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--text-muted);">Audio was captured, but transcription was unclear.</p>
            <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">
              <li>Try speaking closer to the mic.</li>
              <li>Check Chrome microphone input device.</li>
              <li>Use at least 10–15 seconds of full sentences.</li>
            </ul>
          </div>
        `;
      }
      return;
    }

    // Show transcript to user
    const box = document.getElementById("live-transcript-box");
    if (box) {
      if (transcriptSegments.length > 0) {
        box.innerHTML = transcriptSegments.map(segment => {
          const cls = segment.speaker === "You" ? "transcript-speaker-you" : "transcript-speaker-other";
          return `<p><span class="${cls}">${segment.speaker}:</span> ${segment.text}</p>`;
        }).join("");
      } else {
        box.innerHTML = `<p><span class="transcript-speaker-you">You:</span> ${analysisTranscript}</p>`;
      }
    }
    const wordCount = analysisTranscript.trim().split(/\s+/).filter(Boolean).length;
    document.getElementById("word-count-display").innerText =
      mode === "full" ? `${wordCount} words by you` : `${wordCount} words spoken`;

    // ── Transcript Quality Gate ──────────────────────────────────────────────
    // Threshold: 10 words minimum (raised from 5 to prevent hallucinated analysis).
    // Also check words-per-minute: fewer than 5 wpm for a long recording almost
    // always means transcription captured nothing real — the AI would hallucinate.
    const recordingMinutes = sessionDurationSeconds / 60;
    const wordsPerMinute = recordingMinutes > 0 ? wordCount / recordingMinutes : 0;
    const suspiciouslyThin = sessionDurationSeconds >= 30 && wordCount < 10;

    if (wordCount < 10 || suspiciouslyThin) {
      showToast("Transcript is too short or unclear. Please record at least 15 seconds of clear speech.", "warning");
      if (box) {
        box.innerHTML += `
          <div class="warning-box" style="margin-top: 1rem; padding: 1rem; background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.25); border-radius: 8px;">
            <h4 style="color: var(--text-warning); margin: 0 0 0.5rem 0; font-size: 0.95rem; font-weight: bold;">Transcript Too Short to Analyze</h4>
            <p style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--text-muted);">Only ${wordCount} word${wordCount === 1 ? '' : 's'} were transcribed from ${formatDuration(sessionDurationSeconds)} of audio. Analysis requires at least 10 words to avoid inaccurate feedback.</p>
            <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">
              <li>Speak clearly and close to the microphone.</li>
              <li>Check the selected microphone in Chrome settings.</li>
              <li>Record at least 15 seconds of continuous speech.</li>
              <li>If using Local Whisper, ensure the server is running.</li>
            </ul>
          </div>
        `;
      }
      // Save transcript even if too short — don't lose what was captured.
      // Only skip the analysis step.
      await localStore.deleteChunksForSession(activeSessionId);
      await localStore.deleteActiveSession(activeSessionId);
      await removeLocalStorage("active_session_id");
      activeSessionId = null;
      updateRecordingUIStats();
      return;
    }

    const analysisProvider = await getLocalStorage("analysis_provider") || "local_ollama";
    let analysis;

    async function analyzeSectionWithFallback(text, duration, sectionMode) {
      if (analysisProvider === "local_ollama") {
        return await analyzeTranscriptLocal(text, duration, sectionMode);
      }
      const geminiKey = await getLocalStorage("gemini_api_key");
      if (!geminiKey) {
        showToast("Gemini API key is not set. Falling back to local Ollama.", "warning");
        return await analyzeTranscriptLocal(text, duration, sectionMode);
      }
      try {
        return await analyzeTranscript(geminiKey, text, model);
      } catch (err) {
        console.warn("[TalkFlow] Gemini analysis failed, falling back to local Ollama:", err);
        showToast("Gemini analysis failed. Falling back to local Ollama.", "warning");
        return await analyzeTranscriptLocal(text, duration, sectionMode);
      }
    }

    const analStatEl = document.getElementById("rec-stat-transcription");
    if (analStatEl) {
      analStatEl.innerText = "ANALYZING...";
      analStatEl.style.color = "var(--warning-color)";
    }

    // Analysis Strategy: section-by-section for long transcripts (>= 1000 words), single prompt for short
    if (wordCount >= 1000) {
      const words = analysisTranscript.split(/\s+/).filter(Boolean);
      const sections = [];
      const SECTION_SIZE = 750;
      for (let i = 0; i < words.length; i += SECTION_SIZE) {
        sections.push(words.slice(i, i + SECTION_SIZE).join(" "));
      }

      const sectionAnalyses = [];
      const sectionDuration = Math.round(sessionDurationSeconds / sections.length);

      for (let i = 0; i < sections.length; i++) {
        const progressMsg = `Analyzing section ${i + 1} of ${sections.length}...`;
        if (analStatEl) analStatEl.innerText = progressMsg;
        showToast(progressMsg, "info");

        const secAnalysis = await analyzeSectionWithFallback(sections[i], sectionDuration, mode);
        sectionAnalyses.push(secAnalysis);
      }

      // Merge section analyses
      let overallScoreSum = 0;
      const allCorrections = [];
      const allFillerWords = { um: 0, ah: 0, like: 0, youKnow: 0, actually: 0, other: 0 };
      const allWeakSentences = [];
      const allReusablePhrases = [];
      const allBetterAnswers = [];
      const allSummaries = [];

      for (let i = 0; i < sectionAnalyses.length; i++) {
        const sa = sectionAnalyses[i];
        overallScoreSum += sa.overallScore || 5;

        const sectionStartTime = i * sectionDuration;
        const timestampLabel = `[${formatDuration(sectionStartTime)}]`;

        if (sa.corrections) {
          sa.corrections.forEach(c => {
            allCorrections.push({
              original: `${timestampLabel} ${c.original}`,
              corrected: c.corrected,
              strongerVersion: c.strongerVersion,
              explanation: c.explanation,
              type: c.type || 'grammar'
            });
          });
        }

        if (sa.fillerWords) {
          Object.keys(allFillerWords).forEach(k => {
            allFillerWords[k] += (sa.fillerWords[k] || 0);
          });
        }

        if (sa.weakSentences) {
          sa.weakSentences.forEach(s => allWeakSentences.push(`${timestampLabel} ${s}`));
        }

        if (sa.reusablePhrases) {
          sa.reusablePhrases.forEach(p => allReusablePhrases.push(p));
        }

        if (sa.betterAnswer) {
          allBetterAnswers.push(`Section ${i+1} (${timestampLabel}):\n${sa.betterAnswer}`);
        }

        if (sa.summary) {
          allSummaries.push(`${timestampLabel}: ${sa.summary}`);
        }
      }

      analysis = {
        overallScore: Math.round(overallScoreSum / sectionAnalyses.length),
        corrections: allCorrections,
        fillerWords: allFillerWords,
        weakSentences: allWeakSentences,
        reusablePhrases: [...new Set(allReusablePhrases)],
        betterAnswer: allBetterAnswers.join("\n\n"),
        summary: "Long Session Coaching Synthesis:\n\n" + allSummaries.join("\n\n"),
        insufficientSpeech: false
      };

    } else {
      // Single prompt analysis for shorter recordings
      showToast(
        analysisProvider === "local_ollama"
          ? "Analyzing speech locally with Ollama..."
          : "Analyzing speech with Gemini Cloud...",
        "info"
      );
      analysis = await analyzeSectionWithFallback(analysisTranscript, sessionDurationSeconds, mode);
    }

    if (analStatEl) {
      analStatEl.innerText = "DONE";
      analStatEl.style.color = "var(--success-color)";
    }

    // 4. Handle insufficientSpeech
    if (analysis.insufficientSpeech) {
      showToast("Coaching skipped. Speech sample is too brief or unclear.", "warning");
      if (box) {
        box.innerHTML += `
          <div class="warning-box" style="margin-top: 1rem; padding: 1rem; background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.25); border-radius: 8px;">
            <h4 style="color: var(--text-warning); margin: 0 0 0.5rem 0; font-size: 0.95rem; font-weight: bold;">Insufficient Speech Content</h4>
            <p style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--text-muted);">The AI reported that your speech sample was too brief or unclear to produce meaningful feedback.</p>
            <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">
              <li>Try speaking closer to the mic.</li>
              <li>Check Chrome microphone input device.</li>
              <li>Use at least 10–15 seconds of full sentences.</li>
            </ul>
          </div>
        `;
      }
      await localStore.deleteChunksForSession(activeSessionId);
      await localStore.deleteActiveSession(activeSessionId);
      await removeLocalStorage("active_session_id");
      activeSessionId = null;
      updateRecordingUIStats();
      return;
    }

    const sessionData = {
      sessionUuid: activeSessionId,
      timestamp: new Date().toISOString(),
      duration: sessionDurationSeconds,
      mode,
      score: analysis.overallScore || 5,
      correctionsCount: analysis.corrections?.length || 0,
      fillerWords: analysis.fillerWords || {},
      analysis,
      rawText: finalizedTranscript,
      analysisText: analysisTranscript
    };

    const newId = await saveSession(sessionData);
    selectedSessionId = newId;

    if (analysis.corrections?.length > 0) {
      for (const c of analysis.corrections) {
        await savePracticeCard({
          original: c.original, corrected: c.corrected,
          explanation: c.explanation, category: c.type || 'grammar',
          attempts: 0, lastScore: 0, mastered: false,
          addedDate: new Date().toISOString()
        });
      }
    }

    // Google Drive Sync if active and connected
    const storageProvider = await getLocalStorage("storage_provider") || "local";
    const autoSync = await getLocalStorage("drive_auto_sync") !== "false";
    const savedToken = await getLocalStorage("drive_oauth_token");

    const syncStatEl = document.getElementById("rec-stat-sync");

    if (storageProvider === "drive" && savedToken) {
      if (syncStatEl) {
        syncStatEl.innerText = "SYNCING...";
        syncStatEl.style.color = "var(--warning-color)";
      }

      // Audio Backup Upload if enabled — assemble blob on demand, never during recording
      const audioBackupEnabled = await getLocalStorage("drive_audio_backup") === "true";
      if (audioBackupEnabled && _lastChunksForDownload && _lastChunksForDownload.length > 0) {
        try {
          showToast("Assembling audio for Drive backup...", "info");
          const blobType = _lastChunksForDownload[0]?.blob?.type || 'audio/webm';
          const backupBlob = new Blob(_lastChunksForDownload.map(c => c.blob), { type: blobType });
          showToast("Uploading audio backup to Google Drive...", "info");
          await driveStore.uploadAudioFile(savedToken, `session_${sessionData.sessionUuid}.webm`, backupBlob);
          showToast("Audio backup uploaded successfully.", "success");
        } catch (driveErr) {
          console.error("Audio backup failed:", driveErr);
          showToast(`Audio backup failed: ${driveErr.message}`, "warning");
        }
      }

      // Sync settings / session manifests / cards
      if (autoSync) {
        try {
          showToast("Synchronising data with Google Drive...", "info");
          const syncRes = await driveStore.syncAllData(savedToken);
          await setLocalStorage("drive_last_sync_time", new Date().toISOString());
          
          if (syncStatEl) {
            syncStatEl.innerText = "SYNCED";
            syncStatEl.style.color = "var(--success-color)";
          }

          if (syncRes && syncRes.conflictsDetected) {
            showToast("Sync completed. Conflicts were detected and merged safely.", "warning");
          } else {
            showToast("Google Drive sync complete.", "success");
          }
        } catch (syncErr) {
          console.error("Drive sync failed:", syncErr);
          showToast(`Drive sync failed: ${syncErr.message}`, "error");
          if (syncStatEl) {
            syncStatEl.innerText = "FAILED";
            syncStatEl.style.color = "var(--danger-color)";
          }
        }
      } else {
        if (syncStatEl) {
          syncStatEl.innerText = "LOCAL ONLY";
          syncStatEl.style.color = "var(--text-muted)";
        }
      }
    } else {
      if (syncStatEl) {
        syncStatEl.innerText = "LOCAL ONLY";
        syncStatEl.style.color = "var(--text-muted)";
      }
    }

    // Clean up temporary chunks
    await localStore.deleteChunksForSession(activeSessionId);
    await localStore.deleteActiveSession(activeSessionId);
    await removeLocalStorage("active_session_id");
    
    // Reset state
    activeSessionId = null;
    sessionDurationSeconds = 0;
    updateRecordingUIStats();

    showToast("Analysis complete! See your results in the Analysis Hub.", "success");
    switchTab("tab-analysis");

  } catch (err) {
    console.error("Evaluation error:", err);
    showToast(`Evaluation failed: ${err.message}`, "error");
    if (transStatEl) {
      transStatEl.innerText = "FAILED";
      transStatEl.style.color = "var(--danger-color)";
    }
  }
}


// Download the last recording as a file
function downloadLastRecording() {
  // Build blob lazily if not already assembled (deferred from processRecordedAudio)
  if (!lastRecordingBlob) {
    if (_lastChunksForDownload && _lastChunksForDownload.length > 0) {
      const blobType = _lastChunksForDownload[0]?.blob?.type || 'audio/webm';
      lastRecordingBlob = new Blob(_lastChunksForDownload.map(c => c.blob), { type: blobType });
    } else {
      showToast("No recording available to download.", "warning");
      return;
    }
  }
  const ext = lastRecordingBlob.type.includes('ogg') ? 'ogg' : 'webm';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `talkflow-recording-${timestamp}.${ext}`;
  const url = URL.createObjectURL(lastRecordingBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast(`Recording saved as ${filename}`, "success");
}

// ----------------------------------------------------
// 7. ANALYSIS HUB CONTROLLER
// ----------------------------------------------------
async function populateAnalysisDropdown() {
  const select = document.getElementById("select-analysis-session");
  select.innerHTML = "";

  try {
    const sessions = await getSessions();
    if (sessions.length === 0) {
      select.innerHTML = '<option value="">No sessions analyzed yet</option>';
      document.getElementById("analysis-results-container").style.display = "none";
      document.getElementById("analysis-empty-state").style.display = "flex";
      return;
    }

    // Sort newest first
    const sorted = [...sessions].reverse();
    sorted.forEach((session, index) => {
      const date = new Date(session.timestamp).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const opt = document.createElement("option");
      opt.value = session.id;
      opt.innerText = `Session #${session.id} (${date}) - Score ${session.score}/10`;
      
      if (selectedSessionId === session.id || (!selectedSessionId && index === 0)) {
        opt.selected = true;
        selectedSessionId = session.id;
      }
      select.appendChild(opt);
    });

    loadSessionAnalysis(selectedSessionId);
  } catch (err) {
    console.error("Dropdown build failed:", err);
  }
}

async function loadSessionAnalysis(id) {
  if (!id) return;
  
  try {
    const sessions = await getSessions();
    const session = sessions.find(s => s.id === parseInt(id));
    if (!session) return;

    // Show result container, hide empty state
    document.getElementById("analysis-results-container").style.display = "grid";
    document.getElementById("analysis-empty-state").style.display = "none";

    // Set details
    const dateStr = new Date(session.timestamp).toLocaleDateString(undefined, {
      month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    document.getElementById("selected-session-info").style.display = "flex";
    document.getElementById("session-info-date").innerText = dateStr;
    document.getElementById("session-info-duration").innerText = formatDuration(session.duration);
    document.getElementById("session-info-mode").innerText = session.mode === "full" ? "Full Interview Mode" : "Self Recording";

    // Overall Score
    document.getElementById("analysis-overall-score").innerText = session.score;
    
    // Quick Badges
    document.getElementById("count-errors-badge").innerText = session.correctionsCount;
    
    const fillers = session.fillerWords || {};
    const fillerSum = Object.values(fillers).reduce((sum, v) => sum + v, 0);
    document.getElementById("count-filler-badge").innerText = fillerSum;
    
    const weakList = session.analysis.weakSentences || [];
    document.getElementById("count-phrases-badge").innerText = session.analysis.reusablePhrases?.length || 0;

    // Summary Text
    const mistakesText = session.correctionsCount === 1 ? "1 grammar correction" : `${session.correctionsCount} grammar corrections`;
    const fillersText = fillerSum === 1 ? "1 filler word" : `${fillerSum} filler words`;
    document.getElementById("analysis-session-summary").innerText = 
      `In this ${formatDuration(session.duration)} practice run, you spoke ${session.rawText.split(/\s+/).length} words. We flagged ${mistakesText} and ${fillersText}. Your overall fluency rating is ${session.score}/10.`;

    // Render Corrections Cards
    const container = document.getElementById("analysis-corrections-list");
    container.innerHTML = "";

    const corrections = session.analysis.corrections || [];
    if (corrections.length === 0) {
      container.innerHTML = `
        <div class="empty-state font-sm" style="padding: 1.5rem;">
          <i data-lucide="smile"></i>
          <p>No major grammatical errors flagged. Excellent work!</p>
        </div>
      `;
    } else {
      corrections.forEach(c => {
        const card = document.createElement("div");
        card.className = "correction-card glass";
        
        let typeBadgeClass = "badge-info";
        if (c.type === "grammar") typeBadgeClass = "badge-error";
        if (c.type === "structure") typeBadgeClass = "badge-warning";
        
        card.innerHTML = `
          <div class="correction-card-header">
            <span class="badge ${typeBadgeClass}">${c.type ? c.type.toUpperCase() : 'GRAMMAR'}</span>
            <button class="btn btn-secondary btn-sm btn-speak-correction-item">
              <i data-lucide="volume-2"></i> Speak
            </button>
          </div>
          
          <div class="correction-flow">
            <div class="flow-step spoken">
              <span class="lbl">What you said</span>
              <span class="val">"${c.original}"</span>
            </div>
            <div class="flow-step suggested">
              <span class="lbl">Better phrasing</span>
              <span class="val">"${c.corrected}"</span>
            </div>
          </div>
          
          <div class="correction-explanation">
            <i data-lucide="help-circle"></i>
            <span>${c.explanation}</span>
          </div>
        `;
        
        // Wire up small speaker inside correction card
        card.querySelector(".btn-speak-correction-item").addEventListener("click", () => {
          speakText(c.corrected);
        });

        container.appendChild(card);
      });
    }

    // Polished Answer
    document.getElementById("analysis-polished-text").innerText = session.analysis.betterAnswer || "No polished answer provided.";

    // Weak Sentences
    const weakContainer = document.getElementById("analysis-weak-sentences");
    weakContainer.innerHTML = "";
    if (weakList.length === 0) {
      weakContainer.innerHTML = '<li class="text-muted">No weak or repetitive phrasing highlighted.</li>';
    } else {
      weakList.forEach(s => {
        const li = document.createElement("li");
        li.innerText = s;
        weakContainer.appendChild(li);
      });
    }

    // Reusable Phrases
    const phrasesContainer = document.getElementById("analysis-key-phrases");
    phrasesContainer.innerHTML = "";
    const phrasesList = session.analysis.reusablePhrases || [];
    if (phrasesList.length === 0) {
      phrasesContainer.innerHTML = '<li class="text-muted">No reusable template expressions extracted.</li>';
    } else {
      phrasesList.forEach(p => {
        const li = document.createElement("li");
        li.innerText = p;
        phrasesContainer.appendChild(li);
      });
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (err) {
    console.error("Session load failed:", err);
  }
}

// ----------------------------------------------------
// 8. PRACTICE DECK & SPEECH GRADER CONTROLLER
// ----------------------------------------------------
async function loadPracticeDeck() {
  const cardsList = document.getElementById("practice-cards-selector-list");
  cardsList.innerHTML = "";

  try {
    const cards = await getPracticeCards();
    document.getElementById("practice-deck-count").innerText = `${cards.length} cards`;

    if (cards.length === 0) {
      cardsList.innerHTML = `
        <div class="empty-state font-sm">
          <i data-lucide="layers"></i>
          <p>Your correction deck is empty. Record sessions to automatically load flashcards here.</p>
        </div>
      `;
      document.getElementById("practice-arena-active").style.display = "none";
      document.getElementById("practice-arena-empty").style.display = "flex";
      return;
    }

    cards.forEach(card => {
      const btn = document.createElement("button");
      btn.className = `practice-card-select-btn ${activePracticeCard && activePracticeCard.id === card.id ? 'active' : ''}`;
      
      const scoreBadge = card.lastScore > 0 ? `<span class="badge ${card.mastered ? 'badge-success' : 'badge-warning'}">${card.lastScore}%</span>` : '<span class="badge badge-info">New</span>';
      
      btn.innerHTML = `
        <div class="btn-card-title">${card.corrected}</div>
        <div class="btn-card-subtitle">
          <span>Category: ${card.category}</span>
          ${scoreBadge}
        </div>
      `;
      
      btn.addEventListener("click", () => {
        // Toggle active button UI
        document.querySelectorAll(".practice-card-select-btn").forEach(el => el.classList.remove("active"));
        btn.classList.add("active");
        loadActivePracticeCard(card);
      });
      cardsList.appendChild(btn);
    });

    // Auto-select first card if nothing is active
    if (!activePracticeCard && cards.length > 0) {
      loadActivePracticeCard(cards[0]);
      cardsList.firstChild.classList.add("active");
    } else if (activePracticeCard) {
      // Keep active loaded
      const activeData = cards.find(c => c.id === activePracticeCard.id);
      if (activeData) loadActivePracticeCard(activeData);
    }
  } catch (err) {
    console.error("Practice deck failed to render:", err);
  }
}

function loadActivePracticeCard(card) {
  activePracticeCard = card;
  
  document.getElementById("practice-arena-active").style.display = "block";
  document.getElementById("practice-arena-empty").style.display = "none";
  
  document.getElementById("practice-card-category").innerText = card.category.toUpperCase();
  document.getElementById("practice-card-category").className = `badge ${card.category === 'grammar' ? 'badge-error' : 'badge-info'}`;
  
  const attempts = card.attempts || 0;
  const lastScore = card.lastScore || 0;
  document.getElementById("practice-card-stats").innerText = `Attempts: ${attempts} | Last Score: ${lastScore}%`;
  
  document.getElementById("practice-card-original").innerText = `"${card.original}"`;
  document.getElementById("practice-card-corrected").innerText = `"${card.corrected}"`;
  document.getElementById("practice-card-explanation").innerText = card.explanation;

  // Clear scorer UI
  document.getElementById("practice-score-container").style.display = "none";
  document.getElementById("practice-speak-transcript").innerText = "Click mic and read sentence...";
  document.getElementById("practice-mic-text").innerText = "Ready to record";
}

// Browser TTS
function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast("Text-to-speech is not supported in this browser.", "error");
    return;
  }

  // Cancel any active Speech
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Set speed
  const rateSelect = document.getElementById("tts-rate-select");
  if (rateSelect) {
    utterance.rate = parseFloat(rateSelect.value);
  }
  
  // Try to find a nice English voice
  const voices = window.speechSynthesis.getVoices();
  const enVoice = voices.find(v => v.lang.includes("en-US") && v.name.includes("Google")) || 
                  voices.find(v => v.lang.includes("en")) || 
                  voices[0];
  
  if (enVoice) {
    utterance.voice = enVoice;
  }

  window.speechSynthesis.speak(utterance);
}

// Speech practice listener — uses MediaRecorder + Gemini transcription
// (webkitSpeechRecognition fails with "network" error in Chrome extension side panels)
let practiceMediaRecorder = null;
let practiceStream = null;
let practiceAutoStopTimer = null;

async function startPracticeListening() {
  // Toggle: if already recording, stop
  if (isPracticeListening) {
    stopPracticeListening();
    return;
  }

  const micBtn = document.getElementById("btn-practice-speak");
  const micText = document.getElementById("practice-mic-text");
  const transcriptBox = document.getElementById("practice-speak-transcript");

  // Check permission first
  let micGranted = false;
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' });
    micGranted = perm.state === 'granted';
  } catch (e) { micGranted = true; }

  if (!micGranted) {
    showToast("Microphone not granted. Go to the Recorder tab and click 'Test Microphone' first.", "warning");
    return;
  }

  try {
    practiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error("Practice mic error:", err);
    if (err.name === "NotAllowedError") {
      showToast("Microphone blocked. Go to the Recorder tab and click 'Test Microphone' first.", "error");
    } else {
      showToast(`Mic error: ${err.name}`, "error");
    }
    return;
  }

  const practiceChunks = [];
  practiceMediaRecorder = new MediaRecorder(practiceStream);

  practiceMediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) practiceChunks.push(e.data);
  };

  practiceMediaRecorder.onstop = async () => {
    // Stop mic tracks
    practiceStream.getTracks().forEach(t => t.stop());
    practiceStream = null;

    micBtn.classList.remove("listening");
    micText.innerText = "Transcribing...";

    if (practiceChunks.length === 0) {
      micText.innerText = "Ready to record";
      transcriptBox.innerText = "No audio captured. Try again.";
      return;
    }

    const audioBlob = new Blob(practiceChunks, { type: practiceChunks[0]?.type || 'audio/webm' });

    try {
      const txProvider = await getLocalStorage("transcription_provider") || "local";

      let resultText;
      if (txProvider === 'openai') {
        const openAIKey = await getLocalStorage("openai_api_key");
        if (!openAIKey) throw new Error('OpenAI API key missing. Add it in Settings → Transcription Provider.');
        resultText = await transcribeAudioOpenAI(openAIKey, audioBlob);
      } else if (txProvider === 'local') {
        resultText = await transcribeAudioLocal(audioBlob);
      } else {
        const geminiKey = await getLocalStorage("gemini_api_key");
        if (!geminiKey) {
          showToast("Gemini API key missing. Set it in Settings for Gemini transcription.", "error");
          micText.innerText = "Ready to record";
          return;
        }
        const model = await getLocalStorage("gemini_model") || "gemini-2.5-flash";
        resultText = await transcribeAudioGemini(geminiKey, audioBlob, model);
      }

      transcriptBox.innerText = `"${resultText}"`;

      if (activePracticeCard) {
        const score = getWordSimilarity(activePracticeCard.corrected, resultText);
        await updatePracticeCardStats(activePracticeCard.id, score);

        const scoreContainer = document.getElementById("practice-score-container");
        const scoreNum = document.getElementById("practice-accuracy-score");
        const scoreFill = document.getElementById("practice-score-fill");
        const feedbackText = document.getElementById("practice-feedback-text");

        scoreContainer.style.display = "block";
        scoreNum.innerText = `${score}%`;
        scoreFill.style.width = `${score}%`;

        if (score >= 90) {
          feedbackText.innerText = "Perfect delivery! You nailed the correction.";
          feedbackText.className = "practice-feedback-text text-success";
        } else if (score >= 70) {
          feedbackText.innerText = "Good job! Try repeating it once more to speak it perfectly.";
          feedbackText.className = "practice-feedback-text text-cyan";
        } else {
          feedbackText.innerText = "Keep practicing! Listen to the TTS audio and repeat.";
          feedbackText.className = "practice-feedback-text text-muted";
        }

        loadPracticeDeck();
      }
    } catch (err) {
      console.error("Practice transcription error:", err);
      transcriptBox.innerText = `Transcription failed: ${err.message}`;
      showToast(`Practice transcription failed: ${err.message}`, "error");
    }

    micText.innerText = "Ready to record";
  };

  // Start recording
  isPracticeListening = true;
  practiceMediaRecorder.start();
  micBtn.classList.add("listening");
  micText.innerText = "Recording... click again to stop";
  transcriptBox.innerText = "Speak the sentence aloud now...";

  // Auto-stop after 15 seconds so users don't leave it open
  practiceAutoStopTimer = setTimeout(() => {
    if (isPracticeListening) stopPracticeListening();
  }, 15000);
}

function stopPracticeListening() {
  isPracticeListening = false;

  if (practiceAutoStopTimer) {
    clearTimeout(practiceAutoStopTimer);
    practiceAutoStopTimer = null;
  }

  const micBtn = document.getElementById("btn-practice-speak");
  const micText = document.getElementById("practice-mic-text");
  if (micBtn) micBtn.classList.remove("listening");
  if (micText) micText.innerText = "Processing...";

  if (practiceMediaRecorder && practiceMediaRecorder.state === 'recording') {
    practiceMediaRecorder.stop(); // triggers onstop which handles the rest
  } else {
    if (practiceStream) practiceStream.getTracks().forEach(t => t.stop());
    if (micText) micText.innerText = "Ready to record";
  }
}

// ----------------------------------------------------
// 9. HELPERS
// ----------------------------------------------------
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function truncateText(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// Word-level Levenshtein similarity scorer
function getWordSimilarity(correctStr, practiceStr) {
  // Strip punctuation and split to lowercased words
  const cleanStr = s => s.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();
  
  const normCorrect = cleanStr(correctStr).split(/\s+/).filter(Boolean);
  const normPractice = cleanStr(practiceStr).split(/\s+/).filter(Boolean);
  
  if (normCorrect.length === 0) return 0;
  if (normPractice.length === 0) return 0;
  
  const m = normCorrect.length;
  const n = normPractice.length;
  
  // dp table
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (normCorrect[i - 1] === normPractice[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // deletion
          dp[i][j - 1] + 1,    // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  
  const distance = dp[m][n];
  const maxLen = Math.max(m, n);
  const similarity = Math.round(((maxLen - distance) / maxLen) * 100);
  return Math.max(0, similarity);
}

// Clear Database completely
async function clearDatabase() {
  if (confirm("Are you sure you want to delete all practice history, cards, and keys? This cannot be undone.")) {
    try {
      await removeLocalStorage("gemini_api_key");
      await removeLocalStorage("gemini_model");
      
      const transaction1 = db.transaction(["sessions"], "readwrite");
      transaction1.objectStore("sessions").clear();

      const transaction2 = db.transaction(["practice_cards"], "readwrite");
      transaction2.objectStore("practice_cards").clear();

      showToast("All local records and keys cleared.", "success");
      await loadSettings();
      switchTab("tab-dashboard");
    } catch (e) {
      showToast("Failed to wipe database.", "error");
    }
  }
}

// Test Microphone — tries getUserMedia directly, records 3s to confirm real audio data,
// then plays it back to the user. Falls back to the permission popup only if needed.
async function testMicrophone() {
  const testBtn = document.getElementById('btn-test-mic');
  if (testBtn) { testBtn.disabled = true; testBtn.innerText = 'Testing…'; }

  async function doTest(stream) {
    // Record 3 seconds to verify actual audio data is produced
    return new Promise((resolve, reject) => {
      const chunks = [];
      let recorder;
      try { recorder = new MediaRecorder(stream); }
      catch (e) { reject(new Error('MediaRecorder not supported.')); return; }

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const totalBytes = chunks.reduce((s, c) => s + c.size, 0);
        const testBlob = chunks.length > 0 ? new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }) : null;
        resolve({ size: totalBytes, blob: testBlob });
      };
      recorder.start();
      setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 3000);
    });
  }

  try {
    // Attempt direct getUserMedia — works if permission was already granted
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') throw err;

      // Check hard-denied vs prompt
      let permState = 'prompt';
      try { permState = (await navigator.permissions.query({ name: 'microphone' })).state; } catch (_) {}

      if (permState === 'denied') {
        updateMicStatusUI('denied');
        showToast('Microphone is blocked. Open Chrome settings → Site settings → Microphone and set this extension to Allow.', 'error');
        return;
      }

      // Side-panel silently dismissed the prompt — open the helper popup
      showToast('Opening permission window — click Allow when Chrome asks.', 'info');
      stream = await new Promise((resolve, reject) => {
        const handler = (msg) => {
          if (msg.type === 'TALKFLOW_MIC_GRANTED') {
            chrome.runtime.onMessage.removeListener(handler);
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
              .then(resolve).catch(reject);
          } else if (msg.type === 'TALKFLOW_MIC_DENIED') {
            chrome.runtime.onMessage.removeListener(handler);
            reject(new Error(`Permission denied: ${msg.error}`));
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        chrome.windows.create({
          url: chrome.runtime.getURL('permission.html'),
          type: 'popup', width: 400, height: 300, focused: true
        });
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(handler);
          reject(new Error('Permission popup timed out.'));
        }, 60000);
      });
    }

    // Stream obtained — now actually record 3s to confirm working audio
    showToast('Microphone opened. Recording 3-second test…', 'info');
    const { size, blob } = await doTest(stream);
    updateMicStatusUI('granted');
    const sizeKB = (size / 1024).toFixed(1);

    if (size < 5120) { // under 5 KB for 3s is extremely small
      showToast(`Warning: Captured only ${sizeKB} KB. Microphone may not be capturing audio. Check your device and speak directly into it.`, 'warning');
    } else {
      showToast(`✅ Mic working — captured ${sizeKB} KB. Playing it back...`, 'success');
    }

    if (blob && size > 0) {
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.play().catch(e => console.warn('Test playback blocked or failed:', e));
    }

  } catch (err) {
    console.error('Mic test error:', err);
    updateMicStatusUI('denied');
    if (err.name === 'NotFoundError') {
      showToast('No microphone found. Connect a microphone and try again.', 'error');
    } else {
      showToast(`Microphone test failed: ${err.message}`, 'error');
    }
  } finally {
    if (testBtn) { testBtn.disabled = false; testBtn.innerText = 'Test Microphone'; }
  }
}


// ----------------------------------------------------
// 10. INITIALIZATION
// ----------------------------------------------------
async function checkSessionRecovery() {
  try {
    const activeSessions = await localStore.getAllActiveSessions();
    if (activeSessions.length > 0) {
      // We found an unfinished session
      const recoveredSession = activeSessions[0];
      const recoveredSessionId = recoveredSession.sessionId;
      
      const panel = document.getElementById("session-recovery-panel");
      if (panel) {
        panel.style.display = "flex";
      }
      
      // Wire up recover button
      const btnRecover = document.getElementById("btn-recover-session");
      if (btnRecover) {
        btnRecover.onclick = async () => {
          activeSessionId = recoveredSessionId;
          const chunks = await localStore.getChunksForSession(activeSessionId);
          if (chunks.length > 0) {
            sessionDurationSeconds = chunks[chunks.length - 1].endTime;
          } else {
            sessionDurationSeconds = 0;
          }
          
          const timerDisplay = document.getElementById("recording-timer-display");
          if (timerDisplay) timerDisplay.innerText = formatDuration(sessionDurationSeconds);
          
          updateRecordingUIStats();
          
          // Show stop button so they can analyze
          const stopBtn = document.getElementById("btn-stop-record");
          if (stopBtn) stopBtn.style.display = "inline-flex";
          
          if (panel) panel.style.display = "none";
          switchTab("tab-recorder");
          showToast("Session recovered. You can resume recording or end and analyze it now.", "success");
        };
      }
      
      // Wire up delete button
      const btnDelete = document.getElementById("btn-delete-recovered");
      if (btnDelete) {
        btnDelete.onclick = async () => {
          if (confirm("Are you sure you want to delete the unfinished recording? This cannot be undone.")) {
            await localStore.deleteChunksForSession(recoveredSessionId);
            await localStore.deleteActiveSession(recoveredSessionId);
            await removeLocalStorage("active_session_id");
            if (activeSessionId === recoveredSessionId) {
              activeSessionId = null;
              sessionDurationSeconds = 0;
            }
            if (panel) panel.style.display = "none";
            
            const stopBtn = document.getElementById("btn-stop-record");
            if (stopBtn && !isRecording) stopBtn.style.display = "none";
            
            updateRecordingUIStats();
            showToast("Unfinished recording deleted.", "info");
          }
        };
      }
    }
  } catch (err) {
    console.error("Error checking session recovery:", err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize DB
  await initDB();

  // Check for session recovery on start
  await checkSessionRecovery();
  
  // Wire up tabs
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  // Wire dashboard events
  const quickRecordBtn = document.getElementById("btn-quick-record");
  if (quickRecordBtn) {
    quickRecordBtn.addEventListener("click", () => switchTab("tab-recorder"));
  }

  // Wire recording mode selector
  document.querySelectorAll('input[name="recording-mode"]').forEach(radio => {
    radio.addEventListener("change", handleRecordingModeChange);
  });

  // Consent modal buttons
  document.getElementById("consent-check-announce").addEventListener("change", validateConsentCheckboxes);
  document.getElementById("consent-check-agree").addEventListener("change", validateConsentCheckboxes);
  document.getElementById("consent-check-lawful").addEventListener("change", validateConsentCheckboxes);
  document.getElementById("btn-consent-cancel").addEventListener("click", cancelConsentModal);
  document.getElementById("btn-consent-confirm").addEventListener("click", confirmConsentModal);

  // Copy Consent Message
  const btnCopyConsent = document.getElementById("btn-copy-consent-msg");
  if (btnCopyConsent) {
    btnCopyConsent.addEventListener("click", () => {
      const msg = "For my interview communication practice, this session may be recorded and transcribed privately. If you consent to this private recording, please let me know. Note that audio and transcripts are stored locally on my computer.";
      navigator.clipboard.writeText(msg).then(() => {
        showToast("Consent message copied to clipboard!", "success");
      }).catch(err => {
        showToast("Failed to copy message: " + err, "error");
      });
    });
  }

  // Recording controls
  document.getElementById("btn-test-mic").addEventListener("click", testMicrophone);
  document.getElementById("btn-start-record").addEventListener("click", startRecording);
  document.getElementById("btn-stop-record").addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else if (activeSessionId) {
      processRecordedAudio();
    }
  });

  // Pause/Resume recording
  const btnPauseRecord = document.getElementById("btn-pause-record");
  if (btnPauseRecord) {
    btnPauseRecord.addEventListener("click", () => {
      if (isRecording) {
        if (isPaused) {
          resumeRecording();
        } else {
          pauseRecording();
        }
      }
    });
  }

  const micSettingsBtn = document.getElementById("btn-open-mic-settings");
  if (micSettingsBtn) micSettingsBtn.addEventListener("click", openMicSettings);
  const micRetryBtn = document.getElementById("btn-retry-mic");
  if (micRetryBtn) micRetryBtn.addEventListener("click", testMicrophone);
  const dlRecBtn = document.getElementById("btn-download-recording");
  if (dlRecBtn) dlRecBtn.addEventListener("click", downloadLastRecording);

  // Settings form
  document.getElementById("form-settings").addEventListener("submit", saveSettings);
  document.getElementById("btn-toggle-api-visibility").addEventListener("click", toggleApiVisibility);
  document.getElementById("btn-clear-database").addEventListener("click", clearDatabase);

  // Show/hide OpenAI key field based on provider selection
  document.getElementById("settings-transcription-provider").addEventListener("change", (e) => {
    document.getElementById("openai-key-group").style.display =
      e.target.value === "openai" ? "block" : "none";
  });

  // Google Drive Settings Control
  const btnConnectDrive = document.getElementById("btn-connect-drive");
  if (btnConnectDrive) {
    btnConnectDrive.addEventListener("click", async () => {
      try {
        showToast("Connecting to Google Drive...", "info");
        const token = await driveStore.getAuthToken(true);
        await setLocalStorage("drive_oauth_token", token);
        await setLocalStorage("drive_last_sync_time", new Date().toISOString());
        driveToken = token;
        showToast("Google Drive connected successfully!", "success");
        updateDriveConnectionUI();
        
        // Trigger initial sync
        const syncRes = await driveStore.syncAllData(token);
        if (syncRes && syncRes.conflictsDetected) {
          showToast("Sync completed. Conflicts were detected and merged safely.", "warning");
        } else {
          showToast("Initial Google Drive sync complete.", "success");
        }
        updateDriveConnectionUI();
      } catch (err) {
        showToast(err.message, "error");
        console.error(err);
      }
    });
  }

  const btnDisconnectDrive = document.getElementById("btn-disconnect-drive");
  if (btnDisconnectDrive) {
    btnDisconnectDrive.addEventListener("click", async () => {
      if (confirm("Disconnect Google Drive? Local data will be kept, but cloud backups will stop.")) {
        try {
          const token = await getLocalStorage("drive_oauth_token");
          if (token) {
            await driveStore.revokeToken(token);
            await driveStore.removeCachedAuthToken(token);
          }
          await removeLocalStorage("drive_oauth_token");
          await removeLocalStorage("drive_last_sync_time");
          driveToken = null;
          showToast("Disconnected from Google Drive.", "info");
          updateDriveConnectionUI();
        } catch (err) {
          showToast("Failed to disconnect fully: " + err.message, "error");
        }
      }
    });
  }

  const btnSyncNow = document.getElementById("btn-sync-now");
  if (btnSyncNow) {
    btnSyncNow.addEventListener("click", async () => {
      try {
        btnSyncNow.disabled = true;
        btnSyncNow.innerHTML = '<i data-lucide="refresh-cw" class="spinning"></i> Syncing...';
        if (window.lucide) window.lucide.createIcons();

        const token = await driveStore.getAuthToken(false);
        const syncRes = await driveStore.syncAllData(token);
        await setLocalStorage("drive_last_sync_time", new Date().toISOString());

        if (syncRes && syncRes.conflictsDetected) {
          showToast("Sync completed. Conflicts were detected and merged safely.", "warning");
        } else {
          showToast("Google Drive sync complete.", "success");
        }
      } catch (err) {
        showToast("Sync failed: " + err.message, "error");
      } finally {
        btnSyncNow.disabled = false;
        btnSyncNow.innerHTML = '<i data-lucide="refresh-cw"></i> Sync Now';
        if (window.lucide) window.lucide.createIcons();
        updateDriveConnectionUI();
      }
    });
  }

  const checkAutoSync = document.getElementById("check-auto-sync");
  if (checkAutoSync) {
    checkAutoSync.addEventListener("change", async (e) => {
      await setLocalStorage("drive_auto_sync", e.target.checked ? "true" : "false");
    });
  }

  const checkAudioBackup = document.getElementById("check-audio-backup");
  if (checkAudioBackup) {
    checkAudioBackup.addEventListener("change", async (e) => {
      const warningEl = document.getElementById("audio-backup-warning");
      if (e.target.checked) {
        const confirmed = confirm("WARNING: Backing up audio uploads the raw audio of your recordings to Google Drive appDataFolder. If your recordings contain other people's voices, you must obtain consent before enabling. Enable audio backups?");
        if (confirmed) {
          await setLocalStorage("drive_audio_backup", "true");
          if (warningEl) warningEl.style.display = "block";
        } else {
          e.target.checked = false;
          await setLocalStorage("drive_audio_backup", "false");
          if (warningEl) warningEl.style.display = "none";
        }
      } else {
        await setLocalStorage("drive_audio_backup", "false");
        if (warningEl) warningEl.style.display = "none";
      }
    });
  }

  // Export / Import backups
  const btnExportJson = document.getElementById("btn-export-json");
  if (btnExportJson) {
    btnExportJson.addEventListener("click", async () => {
      try {
        const res = await exportStore.exportData();
        showToast(`Backup exported successfully as ${res.filename}!`, "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  const btnTriggerImport = document.getElementById("btn-trigger-import");
  const fileImportJson = document.getElementById("file-import-json");
  const importFileName = document.getElementById("import-file-name");
  const btnImportJson = document.getElementById("btn-import-json");

  if (btnTriggerImport && fileImportJson) {
    btnTriggerImport.addEventListener("click", () => {
      fileImportJson.click();
    });
  }

  if (fileImportJson) {
    fileImportJson.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        if (importFileName) importFileName.innerText = file.name;
        if (btnImportJson) btnImportJson.style.display = "inline-flex";
      } else {
        if (importFileName) importFileName.innerText = "No file chosen";
        if (btnImportJson) btnImportJson.style.display = "none";
      }
    });
  }

  if (btnImportJson) {
    btnImportJson.addEventListener("click", async () => {
      const file = fileImportJson.files[0];
      if (!file) return;

      try {
        btnImportJson.disabled = true;
        btnImportJson.innerText = "Importing...";
        
        const res = await exportStore.importData(file);
        showToast(`Import complete! Loaded ${res.sessionsCount} sessions and ${res.cardsCount} practice cards.`, "success");
        if (res.conflictsDetected) {
          showToast("Some conflicts were detected and merged safely.", "warning");
        }
        
        // Reset file input
        fileImportJson.value = "";
        if (importFileName) importFileName.innerText = "No file chosen";
        btnImportJson.style.display = "none";
        
        // Reload dashboard and practice
        loadDashboard();
        loadPracticeDeck();
      } catch (err) {
        showToast("Import failed: " + err.message, "error");
      } finally {
        btnImportJson.disabled = false;
        btnImportJson.innerText = "Upload & Merge Backup";
      }
    });
  }

  // Diagnostics refresh
  const btnRefreshDiag = document.getElementById("btn-refresh-diagnostics");
  if (btnRefreshDiag) {
    btnRefreshDiag.addEventListener("click", refreshDiagnostics);
  }

  const btnRunDiagnostics = document.getElementById("btn-run-diagnostics");
  if (btnRunDiagnostics) {
    btnRunDiagnostics.addEventListener("click", runDiagnostics);
  }

  const btnCopyDiagnostics = document.getElementById("btn-copy-diagnostics");
  if (btnCopyDiagnostics) {
    btnCopyDiagnostics.addEventListener("click", async () => {
      const content = document.getElementById("diagnostics-modal-content");
      try {
        await navigator.clipboard.writeText(content?.textContent || "");
        showToast("Diagnostics copied!", "success");
      } catch (err) {
        showToast(`Could not copy diagnostics: ${err.message}`, "error");
      }
    });
  }

  const btnCloseDiagnostics = document.getElementById("btn-close-diagnostics");
  if (btnCloseDiagnostics) {
    btnCloseDiagnostics.addEventListener("click", () => {
      const modal = document.getElementById("diagnostics-modal");
      if (modal) modal.style.display = "none";
    });
  }

  // Analysis session selection
  document.getElementById("select-analysis-session").addEventListener("change", (e) => {
    selectedSessionId = parseInt(e.target.value);
    loadSessionAnalysis(selectedSessionId);
  });

  document.getElementById("btn-play-better-rewrite").addEventListener("click", () => {
    const text = document.getElementById("analysis-polished-text").innerText;
    if (text) speakText(text);
  });

  // Practice tab controls
  document.getElementById("btn-tts-listen").addEventListener("click", () => {
    if (activePracticeCard) speakText(activePracticeCard.corrected);
  });
  document.getElementById("btn-practice-speak").addEventListener("click", startPracticeListening);

  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Load Dashboard initially
  loadDashboard();

  // Request microphone permission on start
  checkMicPermissionStatus();
});
