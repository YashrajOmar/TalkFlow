// TalkFlow Background Service Worker  v2.1
// Handles: side panel, native messaging bridge, server readiness with polling
//
// Key changes from v2.0:
// - ensureReady uses a POLLING loop for model_downloading stage (non-blocking)
// - _sendToNativeHost uses 30s timeout (fast actions only — no blocking pulls)
// - _pollUntilReady polls pollReady every 3s, up to 10 minutes total
// - Unregistered native host error is explicitly mapped to companion_not_installed
// - getDiagnostics reports ffmpeg_bundled from server /diagnostics

const NATIVE_HOST = "com.talkflow.local";
const HEALTH_URL  = "http://127.0.0.1:8765/health";
const DIAG_URL    = "http://127.0.0.1:8765/diagnostics";

// Maximum time to wait for model download (10 min = 600s)
const MODEL_POLL_TIMEOUT_MS  = 10 * 60 * 1000;
// Interval between pollReady calls during model download
const MODEL_POLL_INTERVAL_MS = 3000;
// Timeout for individual native host round-trips (all actions except long pulls)
const NM_ROUNDTRIP_TIMEOUT_MS = 30000;

// ── Side panel ────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[TalkFlow] Side panel error:", err));
});

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "ping") {
    sendResponse({ status: "ok", extensionId: chrome.runtime.id });
    return false;
  }

  // Quick HTTP health check (no native host needed)
  if (request.action === "checkServerHealth") {
    fetch(HEALTH_URL, { method: "GET", signal: AbortSignal.timeout(2500) })
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => sendResponse({ online: true, health: data }))
      .catch(() => sendResponse({ online: false }));
    return true;
  }

  // Full readiness check — starts server, polls through model download
  if (request.action === "ensureReady") {
    _ensureReadyWithPolling()
      .then(result => sendResponse(result))
      .catch(err   => sendResponse(_mapNativeHostError(err)));
    return true;
  }

  // Poll for current readiness state (called during model_downloading)
  if (request.action === "pollReady") {
    _sendToNativeHost({ action: "pollReady" })
      .then(result => sendResponse(result))
      .catch(err   => sendResponse(_mapNativeHostError(err)));
    return true;
  }

  // Simple server start (legacy compatibility)
  if (request.action === "requestServerStart") {
    _sendToNativeHost({ action: "startServer" })
      .then(result => sendResponse({ ok: result.serverRunning, ...result }))
      .catch(err   => sendResponse(_mapNativeHostError(err)));
    return true;
  }

  // Fetch /diagnostics (direct HTTP first, native host fallback)
  if (request.action === "getDiagnostics") {
    fetch(DIAG_URL, { method: "GET", signal: AbortSignal.timeout(5000) })
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => sendResponse({ ok: true, data }))
      .catch(() => {
        _sendToNativeHost({ action: "diagnostics" })
          .then(result => sendResponse(result))
          .catch(err   => sendResponse({ ok: false, error: err.message }));
      });
    return true;
  }

  return true;
});

// ── ensureReady with polling loop ─────────────────────────────────────────────

/**
 * Full readiness flow:
 *   1. Call ensureReady on native host — fast for normal cases.
 *   2. If result.stage === "model_downloading", enter polling loop:
 *      - Call pollReady every MODEL_POLL_INTERVAL_MS
 *      - Forward progress to the app via chrome.runtime.sendMessage
 *   3. Resolve with final ok=true or a specific failure stage.
 *
 * @returns {Promise<Object>} Final readiness result
 */
async function _ensureReadyWithPolling() {
  // Step 1: initial ensureReady (starts server if needed, checks all deps)
  let result;
  try {
    result = await _sendToNativeHost({ action: "ensureReady" });
  } catch (err) {
    return _mapNativeHostError(err);
  }

  // If not downloading, return immediately (success or hard failure)
  if (result.stage !== "model_downloading") {
    return result;
  }

  // Step 2: polling loop for model download
  console.log("[TalkFlow] Model download in progress — entering poll loop");
  const deadline = Date.now() + MODEL_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await _sleep(MODEL_POLL_INTERVAL_MS);

    let poll;
    try {
      poll = await _sendToNativeHost({ action: "pollReady" });
    } catch (err) {
      // Native host disconnect during poll — return the error
      return _mapNativeHostError(err);
    }

    // Broadcast progress to the side panel (app.js listens for this)
    _broadcastProgress(poll);

    if (poll.ok) {
      console.log("[TalkFlow] Model download complete — ready ✅");
      return poll;
    }

    if (poll.stage !== "model_downloading") {
      // Unexpected terminal failure during download
      console.warn("[TalkFlow] Poll returned non-downloading failure:", poll.stage);
      return poll;
    }

    console.log(
      `[TalkFlow] Model downloading… ${poll.pull_elapsed_seconds ?? "?"}s elapsed`
    );
  }

  // Timeout expired
  return {
    ok: false,
    stage: "model_pull_timeout",
    message: "The AI model download is taking longer than 10 minutes.",
    fix: `Open a terminal and run: ollama pull ${result.model || "llama3.2:3b"}`,
  };
}

/**
 * Broadcast a progress update to the side panel.
 * app.js can add a listener for "readiness_progress" messages.
 */
function _broadcastProgress(poll) {
  chrome.runtime.sendMessage({
    action: "readiness_progress",
    stage: poll.stage,
    message: poll.message,
    pull_elapsed_seconds: poll.pull_elapsed_seconds ?? null,
  }).catch(() => { /* side panel may not be open */ });
}

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Map a native host connection error to a structured companion_not_installed
 * result if the host is not registered, or a generic error otherwise.
 *
 * @param {Error} err - Error thrown by _sendToNativeHost
 */
function _mapNativeHostError(err) {
  const msg = err?.message || String(err);

  // Detect "native host not registered" across Chrome versions
  const notRegistered =
    err?.noHost ||
    msg.includes("not registered") ||
    msg.includes("not found") ||
    msg.includes("cannot be found") ||
    msg.includes("Specified native messaging host not found") ||
    msg.includes("Access to the specified native messaging host is forbidden");

  if (notRegistered) {
    return {
      ok: false,
      stage: "companion_not_installed",
      message: "TalkFlow Companion is not installed or the browser bridge is not registered.",
      fix: "Download TalkFlow Companion from github.com/YashrajOmar/TalkFlow/releases and run install_native_host_windows.bat.",
      noHost: true,
    };
  }

  return {
    ok: false,
    stage: "native_host_error",
    message: `Native messaging error: ${msg}`,
    fix: "Restart TalkFlow Companion. If the problem persists, reinstall it.",
    noHost: false,
  };
}

// ── Native Messaging helper ───────────────────────────────────────────────────

/**
 * Open a native messaging port, send one message, await one reply.
 *
 * Timeout is intentionally SHORT (30s) because:
 *   - Long-running operations (model pull) now happen in background threads
 *   - Polling is done by the caller (_ensureReadyWithPolling)
 *   - A hung native host at 30s is a genuine error, not "still working"
 *
 * @param {Object} message - JSON message to send
 * @param {number} timeoutMs - ms to wait (default: 30s)
 */
function _sendToNativeHost(message, timeoutMs = NM_ROUNDTRIP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      // synchronous failure = host definitely not registered
      console.warn("[TalkFlow] connectNative threw:", err.message);
      return reject(Object.assign(new Error(err.message), { noHost: true }));
    }

    const timer = setTimeout(() => {
      try { port.disconnect(); } catch (_) {}
      reject(new Error(`Native host did not respond within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      // chrome.runtime.lastError MUST be read inside this listener
      const errMsg =
        chrome.runtime.lastError?.message || "Native host disconnected unexpectedly";

      const noHost =
        errMsg.includes("not registered") ||
        errMsg.includes("not found") ||
        errMsg.includes("cannot be found") ||
        errMsg.includes("Specified native messaging host not found") ||
        errMsg.includes("Access to the specified native messaging host is forbidden");

      const err = Object.assign(new Error(errMsg), { noHost });
      reject(err);
    });

    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch (_) {}
      resolve(msg);
    });

    port.postMessage(message);
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
