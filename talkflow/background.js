// TalkFlow Background Service Worker  v2.0
// Handles: side panel, native messaging bridge, server auto-start + ensureReady

const NATIVE_HOST = "com.talkflow.local";
const HEALTH_URL  = "http://127.0.0.1:8765/health";
const DIAG_URL    = "http://127.0.0.1:8765/diagnostics";

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

  // Full readiness check via native host (ensureReady action)
  if (request.action === "ensureReady") {
    _sendToNativeHost({ action: "ensureReady" })
      .then(result => sendResponse(result))
      .catch(err  => sendResponse({ ok: false, error: err.message, noHost: true }));
    return true;
  }

  // Simple server start (legacy, kept for compatibility)
  if (request.action === "requestServerStart") {
    _sendToNativeHost({ action: "startServer" })
      .then(result => sendResponse({ ok: result.serverRunning, ...result }))
      .catch(err  => sendResponse({ ok: false, error: err.message, noHost: true }));
    return true;
  }

  // Fetch /diagnostics from native host (which proxies to server)
  if (request.action === "getDiagnostics") {
    // Try direct HTTP first (fast if server is running)
    fetch(DIAG_URL, { method: "GET", signal: AbortSignal.timeout(5000) })
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => sendResponse({ ok: true, data }))
      .catch(() => {
        // Fall back to native host proxy
        _sendToNativeHost({ action: "diagnostics" })
          .then(result => sendResponse(result))
          .catch(err   => sendResponse({ ok: false, error: err.message }));
      });
    return true;
  }

  return true;
});

// ── Native Messaging helper ───────────────────────────────────────────────────

/**
 * Open a native messaging port, send one message, await one reply.
 * Resolves with the reply object, or rejects with { noHost: true } if
 * the native host is not registered.
 *
 * @param {Object} message - JSON message to send
 * @param {number} timeoutMs - ms to wait for reply (default: 90s for model pull)
 */
function _sendToNativeHost(message, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      console.warn("[TalkFlow] Native host connect error:", err.message);
      return reject(Object.assign(new Error(err.message), { noHost: true }));
    }

    const timer = setTimeout(() => {
      try { port.disconnect(); } catch (_) {}
      reject(new Error("Native host timed out after " + (timeoutMs / 1000) + "s."));
    }, timeoutMs);

    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const errMsg = chrome.runtime.lastError?.message || "Native host disconnected unexpectedly";
      const noHost = errMsg.includes("not registered") ||
                     errMsg.includes("not found") ||
                     errMsg.includes("cannot be found") ||
                     errMsg.includes("Specified native messaging host not found");
      const err = Object.assign(new Error(errMsg), { noHost });
      reject(err);
    });

    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      port.disconnect();
      resolve(msg);
    });

    port.postMessage(message);
  });
}
