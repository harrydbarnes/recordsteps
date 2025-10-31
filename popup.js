/**
 * @fileoverview Script for the popup UI of the Record Steps extension.
 * It handles user interactions with the popup, such as starting/stopping
 * recording, downloading data, and clearing the recording. It also
 * keeps the UI in sync with the extension's state stored in chrome.storage.
 */

/**
 * The current recording state, mirrored from chrome.storage for immediate UI updates.
 * @type {boolean}
 */
let isRecording = false;

// DOM element references
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const status = document.getElementById('status');
const clickCount = document.getElementById('clickCount');
const verboseLogging = document.getElementById('verboseLogging');

/**
 * Adds a listener for the DOMContentLoaded event to initialize the popup's state and UI.
 * It fetches the current recording status and the recorded actions from chrome.storage
 * to ensure the popup accurately reflects the extension's state upon opening.
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['isRecording', 'clicks', 'verboseLogging'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading state:', chrome.runtime.lastError);
        return;
      }
      isRecording = result.isRecording || false;
      verboseLogging.checked = result.verboseLogging || false;
      updateUI();
      updateClickCount(result.clicks || []);
    });
  } else {
    console.error('Chrome storage API not available');
    // Set a default state if the API is unavailable (e.g., in a test environment)
    updateUI();
    updateClickCount([]);
  }
});

verboseLogging.addEventListener('change', () => {
  chrome.storage.local.set({ verboseLogging: verboseLogging.checked });
});

/**
 * Handles the click event for the "Start Recording" button.
 * It optimistically updates the UI and sends a message to the background
 * script to begin the recording process.
 * @listens click
 */
startBtn.addEventListener('click', () => {
  // Optimistically update UI for responsiveness
  isRecording = true;
  updateUI();

  chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
    // But revert the UI if the background script reports a failure
    if (chrome.runtime.lastError || (response && !response.success)) {
      console.error('Failed to start recording:', chrome.runtime.lastError?.message || response?.error);
      isRecording = false; // Revert state
      updateUI();
    }
  });
});

/**
 * Handles the click event for the "Stop Recording" button.
 * It optimistically updates the UI and sends a message to the background
 * script to end the recording process.
 * @listens click
 */
stopBtn.addEventListener('click', () => {
  // Optimistically update UI
  isRecording = false;
  updateUI();

  chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
    // Revert UI on failure
    if (chrome.runtime.lastError || (response && !response.success)) {
      console.error('Failed to stop recording:', chrome.runtime.lastError?.message || response?.error);
      isRecording = true; // Revert state
      updateUI();
    }
  });
});

/**
 * Handles the click event for the "Download Recording" button.
 * It retrieves the recorded actions from storage, formats them into a
 * JSON object, and triggers a download.
 * @listens click
 */
downloadBtn.addEventListener('click', () => {
  chrome.storage.local.get(['clicks'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading clicks:', chrome.runtime.lastError);
      alert('Error loading recorded data');
      return;
    }
    
    const clicks = result.clicks || [];
    if (clicks.length === 0) {
      alert('No actions recorded yet!');
      return;
    }
    
    const flattenedClicks = clicks.flatMap(action => {
      if (action.type === 'batchAttributeChange') {
        return action.changes.map(change => ({
          type: 'attributeChange',
          relativeTime: action.relativeTime,
          element: change.element,
          attributeName: change.attributeName,
          oldValue: change.oldValue,
          newValue: change.newValue
        }));
      }
      return action;
    });

    const data = {
      recording: flattenedClicks,
      totalActions: flattenedClicks.length,
      duration: flattenedClicks.length > 0 ? flattenedClicks[flattenedClicks.length - 1].relativeTime : 0,
      recordedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `click-recording-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

/**
 * Handles the click event for the "Clear Recording" button.
 * It prompts the user for confirmation before clearing all recorded actions from storage.
 * @listens click
 */
clearBtn.addEventListener('click', () => {
  if (confirm('Clear all recorded actions?')) {
    chrome.storage.local.set({ clicks: [] }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing data:', chrome.runtime.lastError);
      } else {
        updateClickCount([]);
      }
    });
  }
});

/**
 * Updates the popup's UI elements based on the current recording state.
 * This includes enabling/disabling buttons and changing the status text.
 */
function updateUI() {
  if (isRecording) {
    status.textContent = 'Recording...';
    status.className = 'recording';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    status.textContent = 'Ready to Record';
    status.className = 'idle';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

/**
 * Updates the displayed count of recorded actions.
 * @param {Array<object>} clicks The array of recorded click/action objects.
 */
function updateClickCount(clicks) {
  const count = clicks.reduce((acc, action) => {
    if (action.type === 'batchAttributeChange') {
      return acc + action.changes.length;
    }
    return acc + 1;
  }, 0);
  clickCount.textContent = `Actions recorded: ${count}`;
}

/**
 * Adds a listener for changes in chrome.storage. This ensures the popup's UI
 * stays synchronized with the authoritative state managed by the background script.
 * For example, if recording is stopped from another context, the UI will update accordingly.
 * @listens chrome.storage.onChanged
 * @param {object} changes - An object where keys are the names of items that changed.
 * @param {string} namespace - The name of the storage area ('local' or 'sync') that changed.
 */
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    
    // If the 'clicks' array changes, update the displayed count.
    if (changes.clicks) {
      updateClickCount(changes.clicks.newValue || []);
    }
    // If the 'isRecording' flag changes, update the entire UI.
    if (changes.isRecording) {
      isRecording = changes.isRecording.newValue;
      updateUI();
    }
  });
}
