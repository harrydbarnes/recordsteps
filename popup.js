/**
 * @fileoverview Script for the popup UI of the Record Steps extension.
 * Updated to handle 4-level logging state.
 */

let isRecording = false;

// DOM element references
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const status = document.getElementById('status');
const clickCount = document.getElementById('clickCount');
const loggingLevelSelect = document.getElementById('loggingLevel'); // New Select Element

document.addEventListener('DOMContentLoaded', () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    // Fetch 'loggingLevel' instead of 'verboseLogging'
    chrome.storage.local.get(['isRecording', 'clicks', 'loggingLevel'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading state:', chrome.runtime.lastError);
        return;
      }
      isRecording = result.isRecording || false;

      // Set dropdown value (Default to 0)
      const savedLevel = result.loggingLevel !== undefined ? result.loggingLevel : 0;
      loggingLevelSelect.value = savedLevel;

      updateUI();
      updateClickCount(result.clicks || []);
    });
  } else {
    console.error('Chrome storage API not available');
    updateUI();
    updateClickCount([]);
  }
});

// Listener for the new dropdown
loggingLevelSelect.addEventListener('change', () => {
  const level = parseInt(loggingLevelSelect.value, 10);
  chrome.storage.local.set({ loggingLevel: level });
});

startBtn.addEventListener('click', () => {
  isRecording = true;
  updateUI();
  chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      isRecording = false;
      updateUI();
    }
  });
});

stopBtn.addEventListener('click', () => {
  isRecording = false;
  updateUI();
  chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      isRecording = true;
      updateUI();
    }
  });
});

downloadBtn.addEventListener('click', () => {
  chrome.storage.local.get(['clicks'], (result) => {
    // ... (Keep existing download logic exactly the same)
    if (chrome.runtime.lastError) return;
    const clicks = result.clicks || [];
    if (clicks.length === 0) {
      alert('No actions recorded yet!');
      return;
    }
    
    // Helper to flatten batch changes
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

clearBtn.addEventListener('click', () => {
  if (confirm('Clear all recorded actions?')) {
    chrome.storage.local.set({ clicks: [] }, () => {
        updateClickCount([]);
    });
  }
});

function updateUI() {
  if (isRecording) {
    status.textContent = 'Recording...';
    status.className = 'recording';
    startBtn.disabled = true;
    stopBtn.disabled = false;
    loggingLevelSelect.disabled = true; // Lock settings while recording
  } else {
    status.textContent = 'Ready to Record';
    status.className = 'idle';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    loggingLevelSelect.disabled = false;
  }
}

function updateClickCount(clicks) {
  const count = clicks.reduce((acc, action) => {
    if (action.type === 'batchAttributeChange') {
      return acc + action.changes.length;
    }
    return acc + 1;
  }, 0);
  clickCount.textContent = `Actions recorded: ${count}`;
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.clicks) updateClickCount(changes.clicks.newValue || []);
    if (changes.isRecording) {
      isRecording = changes.isRecording.newValue;
      updateUI();
    }
  });
}
