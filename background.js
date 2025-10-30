/**
 * @fileoverview The background script (service worker) for the Record Steps extension.
 * It manages the extension's state, handles script injection, and processes data
 * sent from the content script and popup.
 */

/**
 * Initializes the extension's storage when it's installed or updated.
 * Sets the default recording state and an empty array for clicks.
 * @listens chrome.runtime.onInstalled
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    clicks: []
  });
});

/**
 * A Promise-based lock to ensure that 'recordAction' messages are processed serially.
 * This prevents race conditions where multiple actions might try to update the
 * 'clicks' array in storage simultaneously, which could lead to data loss.
 * @type {Promise<void>}
 */
let recordActionLock = Promise.resolve();

/**
 * Handles incoming messages from other parts of the extension, like the popup or content scripts.
 * It routes messages to the appropriate logic based on the `message.action`.
 * @listens chrome.runtime.onMessage
 * @param {object} message The message sent by the calling script.
 * @param {string} message.action The type of action to perform.
 * @param {*} [message.data] Any data associated with the action.
 * @param {chrome.runtime.MessageSender} sender Information about the script that sent the message.
 * @param {function(object): void} sendResponse Function to call to send a response.
 * @returns {boolean} Returns `true` to indicate that `sendResponse` will be called asynchronously.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /**
   * @description An Immediately Invoked Function Expression (IIFE) to handle
   * asynchronous message processing. This allows the use of `async/await`
   * syntax within the synchronous listener.
   */
  (async () => {
    // Handles the 'startRecording' action. Injects the content script into the
    // active tab, sets the recording state, and stores the start time.
    if (message.action === 'startRecording') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          // Inject the content script into all frames individually for robustness.
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          for (const frame of frames) {
            // Skip frames where script injection is likely to fail or not useful.
            if (!frame.url || !frame.url.startsWith('http')) {
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
    // Handles the 'stopRecording' action. Resets the recording state and removes the start time.
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
    // Handles the 'recordAction' action. Appends a new action's data to the 'clicks'
    // array in storage. Uses a lock to prevent race conditions.
    } else if (message.action === 'recordAction') {
      const writeOperation = async () => {
        const { clicks } = await chrome.storage.local.get('clicks');
        const newClicks = [...(clicks || []), message.data];
        await chrome.storage.local.set({ clicks: newClicks });
      };

      // Chain the new write operation onto the lock.
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

/**
 * Listens for navigation events, specifically when a page or frame has finished loading.
 * If recording is active, it injects the content script into the newly loaded frame.
 * This ensures that recording continues seamlessly across page navigations.
 * @listens chrome.webNavigation.onCompleted
 * @param {object} details Information about the navigation event.
 * @param {number} details.tabId The ID of the tab where the navigation occurred.
 * @param {number} details.frameId The ID of the frame that has completed loading.
 * @param {string} details.url The URL of the loaded frame.
 */
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
    console.error(`Error during webNavigation.onCompleted for tab ${details.tabId}: ${e.message}`);
  }
});