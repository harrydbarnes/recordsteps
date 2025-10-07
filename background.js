// Initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    clicks: []
  });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use an IIFE to handle async logic and respond to the message.
  (async () => {
    if (message.action === 'startRecording') {
      try {
        // Set recording state and inject the content script.
        await chrome.storage.local.set({ isRecording: true, startTime: Date.now(), clicks: [] });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
          });
        }
        sendResponse({ success: true });
      } catch (e) {
        console.error(`Error starting recording: ${e.message}`);
        sendResponse({ success: false, error: e.message });
      }
    } else if (message.action === 'stopRecording') {
      try {
        // Clear recording state.
        await chrome.storage.local.set({ isRecording: false });
        await chrome.storage.local.remove('startTime');
        sendResponse({ success: true });
      } catch (e) {
        console.error(`Error stopping recording: ${e.message}`);
        sendResponse({ success: false, error: e.message });
      }
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});

// --- New Section for Web Navigation Tracking ---

// Listen for successful page loads (navigation completion)
chrome.webNavigation.onCompleted.addListener((details) => {
  // details.frameId === 0 ensures we only track the main frame (not iframes)
  // details.url.startsWith('http') filters out chrome://, about:, etc.
  if (details.frameId === 0 && details.url.startsWith('http')) {
    // Check local storage to see if recording is currently active
    chrome.storage.local.get('isRecording', (result) => {
      if (chrome.runtime.lastError) {
        console.error(`Error getting recording state: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (result.isRecording) {
        // Use an async IIFE to handle the injection
        (async () => {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: details.tabId },
              files: ['content.js'],
            });
          } catch (e) {
            // This can happen if the script is already injected, which is fine.
            console.log(`Could not inject script in tab ${details.tabId}: ${e.message}`);
          }
        })();
      }
    });
  }
});
