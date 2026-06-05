// TalkFlow Permission Helper
// This popup window is opened to reliably request microphone permission.
// Chrome shows getUserMedia prompts correctly in popup windows vs. side panels.

const statusEl = document.getElementById('status');

async function requestMicPermission() {
  try {
    statusEl.textContent = 'Waiting for your choice…';
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted — stop test tracks immediately
    stream.getTracks().forEach(t => t.stop());
    statusEl.textContent = '✅ Permission granted! Closing…';
    statusEl.className = 'success';
    // Notify the side panel
    try {
      chrome.runtime.sendMessage({ type: 'TALKFLOW_MIC_GRANTED' });
    } catch (e) { /* side panel may have closed */ }
    setTimeout(() => window.close(), 700);
  } catch (err) {
    console.error('Permission popup error:', err.name, err.message);
    statusEl.textContent = `❌ ${err.name}: ${err.message}`;
    statusEl.className = 'error';
    try {
      chrome.runtime.sendMessage({ type: 'TALKFLOW_MIC_DENIED', error: err.name, message: err.message });
    } catch (e) {}
    setTimeout(() => window.close(), 2500);
  }
}

requestMicPermission();
