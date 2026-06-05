// Background Service Worker for TalkFlow Chrome Extension

// Enable the side panel when clicking the extension icon
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting side panel behavior:", error));
});

// Listener for messages if tab capture or other coordinates are needed in future
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") {
    sendResponse({ status: "ok", extensionId: chrome.runtime.id });
  }
  return true;
});
