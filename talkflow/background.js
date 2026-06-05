// TalkFlow Background Service Worker
// Handles: side panel, native messaging bridge, server auto-start

const NATIVE_HOST = "com.talkflow.local";
const LOCAL_URL   = "http://127.0.0.1:8765/health";

// ── Side panel ────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[TalkFlow] Side panel error:", err));
});

// ── Message router ────────────────────────────────────────────────────────────
// Side panel sends messages here; background handles native messaging calls
// so the side panel (which is a web page) doesn't need direct NM access.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "ping") {
    sendResponse({ status: "ok", extensionId: chrome.runtime.id });
    return false;
  }

  // Check if server is reachable via HTTP
  if (request.action === "checkServerHealth") {
    fetch(LOCAL_URL, { method: "GET" })
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => sendResponse({ online: true, health: data }))
      .catch(() => sendResponse({ online: false }));
    return true; // async
  }

  // Ask native host to start the server, then poll until up
  if (request.action === "requestServerStart") {
    _startViaNaviteMessaging()
      .then(result => sendResponse(result))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  return true;
});

// ── Native Messaging helper ───────────────────────────────────────────────────

/**
 * Try to connect to the native host and ask it to start the server.
 * Returns { ok: true } if server becomes reachable, or { ok: false, error, noHost }
 */
async function _startViaNaviteMessaging() {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      console.warn("[TalkFlow] Native host not available:", err.message);
      return resolve({ ok: false, error: err.message, noHost: true });
    }

    const timeout = setTimeout(() => {
      port.disconnect();
      resolve({ ok: false, error: "Native host timed out." });
    }, 20000);

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      const err = chrome.runtime.lastError?.message || "Native host disconnected";
      if (err.includes("not registered") || err.includes("not found") || err.includes("cannot be found")) {
        resolve({ ok: false, error: err, noHost: true });
      } else {
        resolve({ ok: false, error: err });
      }
    });

    port.onMessage.addListener((msg) => {
      clearTimeout(timeout);
      port.disconnect();
      if (msg.serverRunning || msg.started) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: msg.reason || "Server did not start." });
      }
    });

    port.postMessage({ action: "startServer" });
  });
}
