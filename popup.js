/**
 * @fileoverview Script for the popup UI of the Record Steps extension.
 * It handles user interactions with the popup using Material Web Components,
 * such as starting/stopping recording, downloading data, and clearing the recording.
 * It also keeps the UI in sync with the extension's state stored in chrome.storage.
 */

// --- State ---
let isRecording = false;
let startBtn, stopBtn, downloadBtn, clearBtn, statusContainer, statusIcon, statusText, clickCount, confirmDialog;

/**
 * Adds a listener for the DOMContentLoaded event to initialize the popup's state and UI.
 * It fetches the current recording status and the recorded actions from chrome.storage
 * to ensure the popup accurately reflects the extension's state upon opening.
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
  // --- Element Initialization ---
  startBtn = document.getElementById('startBtn');
  stopBtn = document.getElementById('stopBtn');
  downloadBtn = document.getElementById('downloadBtn');
  clearBtn = document.getElementById('clearBtn');
  statusContainer = document.getElementById('status');
  statusIcon = statusContainer ? statusContainer.querySelector('.icon') : null;
  statusText = statusContainer ? statusContainer.querySelector('.text') : null;
  clickCount = document.getElementById('clickCount');
  confirmDialog = document.getElementById('confirmDialog');

  // --- Initial State and UI Setup ---
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['isRecording', 'clicks'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading state:', chrome.runtime.lastError);
        showErrorStatus('Could not load state.');
        return;
      }
      isRecording = result.isRecording || false;
      updateUI();
      updateClickCount(result.clicks || []);
    });
  } else {
    console.error('Chrome storage API not available');
    updateUI();
    updateClickCount([]);
  }

  // --- Event Listeners ---
  if (startBtn) {
    startBtn.addEventListener('click', handleStartRecording);
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', handleStopRecording);
  }
  if (downloadBtn) {
    downloadBtn.addEventListener('click', handleDownload);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => confirmDialog && confirmDialog.show());
  }
  if (confirmDialog) {
    confirmDialog.addEventListener('close', handleDialogClose);
  }
});

// --- Event Handlers ---

function handleStartRecording() {
  isRecording = true;
  updateUI();
  chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      console.error('Failed to start recording:', chrome.runtime.lastError?.message || response?.error);
      isRecording = false; // Revert state
      updateUI();
    }
  });
}

function handleStopRecording() {
  isRecording = false;
  updateUI();
  chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      console.error('Failed to stop recording:', chrome.runtime.lastError?.message || response?.error);
      isRecording = true; // Revert state
      updateUI();
    }
  });
}

function handleDownload() {
  chrome.storage.local.get(['clicks'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading clicks:', chrome.runtime.lastError);
      showErrorStatus('Could not load recording.');
      return;
    }
    const clicks = result.clicks || [];
    if (clicks.length === 0) return;

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
    const safeDate = data.recordedAt.replace(/:/g, '-');
    a.download = `recording-${safeDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function handleDialogClose(e) {
  if (e.target.returnValue === 'clear') {
    chrome.storage.local.set({ clicks: [] }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing data:', chrome.runtime.lastError);
      } else {
        updateClickCount([]);
      }
    });
  }
}

// --- UI Update Functions ---

function showErrorStatus(message) {
  if (!statusContainer) return;
  statusContainer.className = 'status-container error';
  if (statusIcon) statusIcon.textContent = 'error';
  if (statusText) statusText.textContent = message;
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  if (downloadBtn) downloadBtn.disabled = true;
  if (clearBtn) clearBtn.disabled = true;
}

function updateUI() {
  if (!statusContainer) return;
  if (isRecording) {
    statusContainer.className = 'status-container recording';
    if (statusIcon) statusIcon.textContent = 'pause_circle';
    if (statusText) statusText.textContent = 'Recording...';
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
  } else {
    statusContainer.className = 'status-container idle';
    if (statusIcon) statusIcon.textContent = 'radio_button_checked';
    if (statusText) statusText.textContent = 'Ready to Record';
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
}

function updateClickCount(clicks) {
  if (!clickCount) return;
  const count = clicks ? clicks.length : 0;
  clickCount.textContent = `Actions recorded: ${count}`;
  const hasActions = count > 0;
  if (downloadBtn) downloadBtn.disabled = !hasActions;
  if (clearBtn) clearBtn.disabled = !hasActions;
}

// --- Storage Change Listener ---
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