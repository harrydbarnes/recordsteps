/**
 * @fileoverview Script for the popup UI of the Record Steps extension.
 * Updated to handle 4-level logging state with descriptive text.
 */

let isRecording = false;

// DOM element references
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const status = document.getElementById('status');
const clickCount = document.getElementById('clickCount');
const loggingLevelSelect = document.getElementById('loggingLevel');
const loggingDescription = document.getElementById('loggingDescription');

const LOGGING_DESCRIPTIONS = {
  0: "Records clicks, typing, and navigation. Best for clean test scripts.",
  1: "Adds focus events. Useful for tracking field entry order.",
  2: "Adds functional state changes (disabled, checked, hidden). Good for logic debugging.",
  3: "Records ALL attribute changes (including styles/classes). Use for deep UI debugging."
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['isRecording', 'clicks', 'loggingLevel'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading state:', chrome.runtime.lastError);
        return;
      }
      isRecording = result.isRecording || false;

      const savedLevel = result.loggingLevel !== undefined ? result.loggingLevel : 0;
      loggingLevelSelect.value = savedLevel;
      updateDescription(savedLevel);

      updateUI();
      updateClickCount(result.clicks || []);
    });
  } else {
    console.error('Chrome storage API not available');
    updateUI();
    updateClickCount([]);
  }
});

loggingLevelSelect.addEventListener('change', () => {
  const level = parseInt(loggingLevelSelect.value, 10);
  chrome.storage.local.set({ loggingLevel: level });
  updateDescription(level);
});

function updateDescription(level) {
  loggingDescription.textContent = LOGGING_DESCRIPTIONS[level] || LOGGING_DESCRIPTIONS[0];
}

startBtn.addEventListener('click', () => {
  isRecording = true;
  updateUI();
  chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      console.error('Failed to start recording:', chrome.runtime.lastError?.message || response?.error);
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
      console.error('Failed to stop recording:', chrome.runtime.lastError?.message || response?.error);
      isRecording = true;
      updateUI();
    }
  });
});

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
      if (chrome.runtime.lastError) {
        console.error('Error clearing data:', chrome.runtime.lastError);
      } else {
        updateClickCount([]);
      }
    });
  }
});

function updateUI() {
  if (isRecording) {
    status.textContent = 'Recording...';
    status.className = 'recording';
    startBtn.disabled = true;
    stopBtn.disabled = false;
    loggingLevelSelect.disabled = true;
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
