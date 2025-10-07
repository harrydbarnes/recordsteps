// Initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    clicks: []
  });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRecording') {
    // First, set the recording state.
    chrome.storage.local.set({ isRecording: true, startTime: Date.now(), clicks: [] }, () => {
      // After state is set, inject the content script into the active tab.
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content.js'],
            });
          } catch (e) {
            console.log(`Could not inject script in tab ${tabs[0].id}: ${e.message}`);
          }
        }
        // Send the response after attempting injection.
        sendResponse({ success: true });
      });
    });
  } else if (message.action === 'stopRecording') {
    chrome.storage.local.set({ isRecording: false }, () => {
      chrome.storage.local.remove('startTime', () => {
        sendResponse({ success: true });
      });
    });
  }

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
    chrome.storage.local.get('isRecording', async (result) => {
      if (result.isRecording) {
        // Ensure the content script is injected before sending a message.
        try {
          await chrome.scripting.executeScript({
            target: { tabId: details.tabId },
            files: ['content.js'],
          });
        } catch (e) {
            // This can happen if the script is already injected, which is fine.
            console.log(`Could not inject script in tab ${details.tabId}: ${e.message}`);
        }

        // The content script will handle recording the page load event upon injection.
      }
    });
  }
});
