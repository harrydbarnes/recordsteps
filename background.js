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
    } else if (message.action === 'recordAction') {
      try {
        // Get the current clicks, add the new one, and save it back.
        const { clicks } = await chrome.storage.local.get('clicks');
        const newClicks = [...(clicks || []), message.data];
        await chrome.storage.local.set({ clicks: newClicks });
        sendResponse({ success: true });
      } catch (e) {
        console.error(`Error recording action: ${e.message}`);
        sendResponse({ success: false, error: e.message });
      }
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
