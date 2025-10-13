/**
 * @fileoverview Script for the popup UI of the Record Steps extension.
 * It handles user interactions with the popup using Material Web Components,
 * such as starting/stopping recording, downloading data, and clearing the recording.
 * It also keeps the UI in sync with the extension's state stored in chrome.storage.
 */

/**
 * The current recording state, mirrored from chrome.storage for immediate UI updates.
 * @type {boolean}
 */
let isRecording = false;

// DOM element references for Material Web Components
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const statusContainer = document.getElementById('status');
const statusIcon = statusContainer.querySelector('.icon');
const statusText = statusContainer.querySelector('.text');
const clickCount = document.getElementById('clickCount');

/**
 * Adds a listener for the DOMContentLoaded event to initialize the popup's state and UI.
 * It fetches the current recording status and the recorded actions from chrome.storage
 * to ensure the popup accurately reflects the extension's state upon opening.
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['isRecording', 'clicks'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading state:', chrome.runtime.lastError);
        return;
      }
      isRecording = result.isRecording || false;
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

/**
 * Handles the click event for the "Start Recording" button.
 * It optimistically updates the UI and sends a message to the background
 * script to begin the recording process.
 * @listens click
 */
startBtn.addEventListener('click', () => {
  isRecording = true;
  updateUI();
  chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
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
  isRecording = false;
  updateUI();
  chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
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
    const data = {
      recording: clicks,
      totalActions: clicks.length,
      duration: clicks.length > 0 ? (clicks[clicks.length - 1].relativeTime - clicks[0].relativeTime) : 0,
      recordedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${new Date().toISOString()}.json`;
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
  if (confirm('Are you sure you want to clear all recorded actions?')) {
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
 * Updates the popup's UI elements based on the current recording state,
 * following Material 3 design principles.
 */
function updateUI() {
  if (isRecording) {
    statusContainer.className = 'status-container recording';
    statusIcon.textContent = 'pause_circle';
    statusText.textContent = 'Recording...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusContainer.className = 'status-container idle';
    statusIcon.textContent = 'radio_button_checked';
    statusText.textContent = 'Ready to Record';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

/**
 * Updates the displayed count of recorded actions.
 * @param {Array<object>} clicks The array of recorded click/action objects.
 */
function updateClickCount(clicks) {
  clickCount.textContent = `Actions recorded: ${clicks ? clicks.length : 0}`;
}

/**
 * Listens for changes in chrome.storage. This ensures the popup's UI
 * stays synchronized with the authoritative state managed by the background script.
 * @listens chrome.storage.onChanged
 */
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.clicks) {
      updateClickCount(changes.clicks.newValue || []);
    }
    if (changes.isRecording) {
      isRecording = !!changes.isRecording.newValue;
      updateUI();
    }
  });
}