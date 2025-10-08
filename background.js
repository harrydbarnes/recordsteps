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
          // Inject the content script into all frames individually for robustness.
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          for (const frame of frames) {
            // Skip frames where script injection is likely to fail or not useful.
            if (!frame.url || frame.url.startsWith('about:') || frame.url.startsWith('chrome:')) {
              continue;
            }
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id, frameIds: [frame.frameId] },
                files: ['content.js'],
              });
            } catch (e) {
              // Log errors for frames that couldn't be injected, but don't stop the process.
              // The "already injected" message is not an error, so we can ignore it.
              if (!e.message.includes('already injected')) {
                console.warn(`Could not inject script in frame ${frame.frameId} (${frame.url}): ${e.message}`);
              }
            }
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
        // Clear recording state in parallel for efficiency.
        await Promise.all([
          chrome.storage.local.set({ isRecording: false }),
          chrome.storage.local.remove('startTime')
        ]);
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
  // Filter for http/https URLs only, but allow all frames.
  if (!details.url.startsWith('http')) {
    return;
  }

  try {
    const { isRecording } = await chrome.storage.local.get('isRecording');
    if (isRecording) {
      // Inject the content script if recording is active, targeting the specific frame that loaded.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: details.tabId, frameIds: [details.frameId] },
          files: ['content.js'],
        });
      } catch (e) {
        // The "already injected" message is not a critical error, so we can ignore it.
        if (!e.message.includes('already injected')) {
          console.warn(`Could not inject script in frame ${details.frameId} (${details.url}): ${e.message}`);
        }
      }
    }
  } catch (e) {
    // This will primarily catch errors from the storage API.
    // It's not a critical error in our workflow, so we log it for debugging purposes.
    console.log(`Error during webNavigation.onCompleted for tab ${details.tabId}: ${e.message}`);
  }
});
