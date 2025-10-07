// Initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    clicks: []
  });
});

// Promise lock to serialize recordAction operations
let recordActionLock = Promise.resolve();

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use an IIFE to handle async logic and respond to the message.
  (async () => {
    if (message.action === 'startRecording') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          // Attempt to inject the script first. This is the most likely point of failure.
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js'],
            });
          } catch (e) {
            // If it's not an "already injected" error, we should fail the entire operation.
            if (!e.message.includes('already injected')) {
              throw e; // Re-throw to be caught by the outer catch block.
            }
            // Otherwise, it's safe to continue.
            console.log('Content script was already injected.');
          }
        }
        // ONLY after we are sure the content script is ready, we perform the state change.
        // This is non-destructive and preserves the clicks array.
        await chrome.storage.local.set({ isRecording: true, startTime: Date.now() });
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
    } else if (message.action === 'recordAction') {
      const writeOperation = async () => {
        const { clicks } = await chrome.storage.local.get('clicks');
        const newClicks = [...(clicks || []), message.data];
        await chrome.storage.local.set({ clicks: newClicks });
      };

      recordActionLock = recordActionLock.then(async () => {
        try {
          await writeOperation();
          sendResponse({ success: true });
        } catch (e) {
          console.error(`Error recording action: ${e.message}`);
          sendResponse({ success: false, error: e.message });
        }
      });
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});

// --- New Section for Web Navigation Tracking ---

// Listen for successful page loads (navigation completion)
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Filter for main frame and http/https URLs
  if (details.frameId !== 0 || !details.url.startsWith('http')) {
    return;
  }

  try {
    const { isRecording } = await chrome.storage.local.get('isRecording');
    if (isRecording) {
      // Inject the content script if recording is active.
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content.js'],
      });
    }
  } catch (e) {
    // This can happen if the script is already injected or on pages where scripting is disallowed.
    // It's not a critical error in our workflow, so we log it for debugging purposes.
    console.log(`Could not inject script in tab ${details.tabId}: ${e.message}`);
  }
});
