/**
 * @fileoverview The background script (service worker) for the Record Steps extension.
 * It manages the extension's state, handles script injection, and processes data
 * sent from the content script and popup.
 * Sets default logging level on install.
 */

try {
  importScripts('constants.js');
} catch (e) {
  console.error(e);
}

/**
 * Initializes the extension's storage when it's installed or updated.
 * Sets the default recording state, logging level, and an empty array for clicks.
 * @listens chrome.runtime.onInstalled
 */
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    'isRecording',
    'isPaused',
    'clicks',
    'actions',
    'recordingSession',
    'storageWarning',
    'loggingLevel'
  ]);
  await chrome.storage.local.set({
    isRecording: existing.isRecording || false,
    isPaused: existing.isPaused || false,
    clicks: existing.clicks || [],
    actions: preferActions(existing.actions, existing.clicks),
    recordingSession: existing.recordingSession || null,
    storageWarning: existing.storageWarning || null,
    loggingLevel: existing.loggingLevel ?? LOGGING_LEVELS.MINIMAL
  });
});

/**
 * A Promise-based lock to ensure that 'recordAction' messages are processed serially.
 * This prevents race conditions where multiple actions might try to update the
 * 'clicks' array in storage simultaneously, which could lead to data loss.
 * @type {Promise<void>}
 */
let recordActionLock = Promise.resolve();

function createSession(tab) {
  const now = Date.now();
  return {
    sessionId: crypto.randomUUID ? crypto.randomUUID() : `session-${now}-${Math.random().toString(16).slice(2)}`,
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    durationMs: 0,
    sourceUrl: tab?.url || null,
    browser: 'Chrome',
    extensionVersion: chrome.runtime.getManifest().version
  };
}

async function estimateRecordingSize(actions) {
  try {
    return new Blob([JSON.stringify(actions || [])]).size;
  } catch (e) {
    return 0;
  }
}

function preferActions(actions, clicks) {
  return Array.isArray(actions) && actions.length > 0 ? actions : (clicks || actions || []);
}

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
                files: ['constants.js', 'content.js'],
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
        const result = await chrome.storage.local.get(['recordingSession', 'clicks', 'actions']);
        const session = result.recordingSession?.sessionId ? result.recordingSession : createSession(tab);
        await chrome.storage.local.set({
          isRecording: true,
          isPaused: false,
          startTime: Date.now(),
          recordingSession: session,
          actions: preferActions(result.actions, result.clicks)
        });
        sendResponse({ success: true });
      } catch (e) {
        console.error(`Error starting recording: ${e.message}`);
        sendResponse({ success: false, error: e.message });
      }
    } else if (message.action === 'startNewRecording') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.storage.local.set({
          isRecording: false,
          isPaused: false,
          clicks: [],
          actions: [],
          storageWarning: null
        });
        if (tab) {
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          for (const frame of frames) {
            if (!frame.url || !frame.url.startsWith('http')) {
              continue;
            }
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id, frameIds: [frame.frameId] },
                files: ['constants.js', 'content.js'],
              });
            } catch (e) {
              if (!e.message.includes('already injected')) {
                console.warn(`Could not inject script in frame ${frame.frameId} (${frame.url}): ${e.message}`);
              }
            }
          }
        }
        await chrome.storage.local.set({
          isRecording: true,
          isPaused: false,
          clicks: [],
          actions: [],
          startTime: Date.now(),
          recordingSession: createSession(tab),
          storageWarning: null
        });
        sendResponse({ success: true });
      } catch (e) {
        console.error(`Error starting new recording: ${e.message}`);
        sendResponse({ success: false, error: e.message });
      }
    // Handles the 'stopRecording' action. Resets the recording state and removes the start time.
    } else if (message.action === 'stopRecording') {
      try {
        const { recordingSession, startTime } = await chrome.storage.local.get(['recordingSession', 'startTime']);
        const stoppedAt = Date.now();
        const completedSession = recordingSession ? {
          ...recordingSession,
          endedAt: new Date(stoppedAt).toISOString(),
          durationMs: startTime ? stoppedAt - startTime : recordingSession.durationMs || 0
        } : null;
        // Clear recording state in parallel for efficiency.
        await Promise.all([
          chrome.storage.local.set({ isRecording: false, isPaused: false, recordingSession: completedSession }),
          chrome.storage.local.remove('startTime')
        ]);
        sendResponse({ success: true });
      } catch (e) {
        console.error(`Error stopping recording: ${e.message}`);
        sendResponse({ success: false, error: e.message });
      }
    } else if (message.action === 'pauseRecording') {
      try {
        await chrome.storage.local.set({ isPaused: true });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (message.action === 'resumeRecording') {
      try {
        await chrome.storage.local.set({ isPaused: false });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    // Handles the 'recordAction' action. Appends a new action's data to the 'clicks'
    // array in storage. Uses a lock to prevent race conditions.
    } else if (message.action === 'recordAction') {
      const writeOperation = async () => {
        const { clicks, actions, recordingSession } = await chrome.storage.local.get(['clicks', 'actions', 'recordingSession']);

        // Add context to the action data
        const enrichedAction = {
          actionId: crypto.randomUUID ? crypto.randomUUID() : `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sessionId: recordingSession?.sessionId || null,
          recordedAt: new Date().toISOString(),
          ...message.data,
          frameId: sender.frameId,
          tabId: sender.tab ? sender.tab.id : null,
          frameUrl: sender.url
        };

        const newClicks = [...(clicks || []), enrichedAction];
        const newActions = [...preferActions(actions, clicks), enrichedAction];
        const estimatedSize = await estimateRecordingSize(newActions);
        const storageWarning = estimatedSize > 4 * 1024 * 1024
          ? `Recording is ${(estimatedSize / 1024 / 1024).toFixed(1)} MB and may approach Chrome storage limits.`
          : null;
        await chrome.storage.local.set({ clicks: newClicks, actions: newActions, storageWarning });
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
 * Listens for navigation events, specifically when a navigation is committed.
 * If recording is active, it injects the content script into the newly loaded frame early.
 * This ensures that recording continues seamlessly across page navigations and captures early interactions.
 * @listens chrome.webNavigation.onCommitted
 * @param {object} details Information about the navigation event.
 * @param {number} details.tabId The ID of the tab where the navigation occurred.
 * @param {number} details.frameId The ID of the frame that has completed loading.
 * @param {string} details.url The URL of the loaded frame.
 */
chrome.webNavigation.onCommitted.addListener(async (details) => {
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
          files: ['constants.js', 'content.js'],
          injectImmediately: true,
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
    console.error(`Error during webNavigation.onCommitted for tab ${details.tabId}: ${e.message}`);
  }
});
