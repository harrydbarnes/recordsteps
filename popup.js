let isRecording = false;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const status = document.getElementById('status');
const clickCount = document.getElementById('clickCount');

// Load state on popup open
chrome.storage.local.get(['isRecording', 'clicks'], (result) => {
  isRecording = result.isRecording || false;
  updateUI();
  updateClickCount(result.clicks || []);
});

startBtn.addEventListener('click', () => {
  isRecording = true;
  chrome.storage.local.set({ isRecording: true });
  chrome.runtime.sendMessage({ action: 'startRecording' });
  updateUI();
});

stopBtn.addEventListener('click', () => {
  isRecording = false;
  chrome.storage.local.set({ isRecording: false });
  chrome.runtime.sendMessage({ action: 'stopRecording' });
  updateUI();
});

downloadBtn.addEventListener('click', () => {
  chrome.storage.local.get(['clicks'], (result) => {
    const clicks = result.clicks || [];
    if (clicks.length === 0) {
      alert('No clicks recorded yet!');
      return;
    }
    
    const data = {
      recording: clicks,
      totalClicks: clicks.length,
      duration: clicks.length > 0 ? clicks[clicks.length - 1].timestamp - clicks[0].timestamp : 0,
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
  if (confirm('Clear all recorded clicks?')) {
    chrome.storage.local.set({ clicks: [] });
    updateClickCount([]);
  }
});

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

function updateClickCount(clicks) {
  clickCount.textContent = `Clicks recorded: ${clicks.length}`;
}

// Listen for updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.clicks) {
    updateClickCount(changes.clicks.newValue || []);
  }
  if (changes.isRecording) {
    isRecording = changes.isRecording.newValue;
    updateUI();
  }
});
