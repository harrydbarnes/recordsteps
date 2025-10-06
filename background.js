// Initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    clicks: []
  });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        try {
          // Try to inject the content script if it's not already there
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['content.js']
          });
        } catch (error) {
          console.log('Content script already injected or injection failed:', error);
        }
        
        // Send the start recording message
        chrome.tabs.sendMessage(tabs[0].id, { action: 'startRecording' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Error sending message:', chrome.runtime.lastError);
          }
        });
      }
    });
  } else if (message.action === 'stopRecording') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Error sending message:', chrome.runtime.lastError);
          }
        });
      }
    });
  }
  
  sendResponse({ success: true });
  return true;
});

// --- New Section for Web Navigation Tracking ---

// Listen for successful page loads (navigation completion)
chrome.webNavigation.onCompleted.addListener((details) => {
  // details.frameId === 0 ensures we only track the main frame (not iframes)
  // details.url.startsWith('http') filters out chrome://, about:, etc.
  if (details.frameId === 0 && details.url.startsWith('http')) {
    // Check local storage to see if recording is currently active
    chrome.storage.local.get('isRecording', (result) => {
      if (result.isRecording) {
        // Send a message to the content script in the loaded tab to record the load event
        chrome.tabs.sendMessage(details.tabId, {
          action: 'pageLoad',
          url: details.url
        }, (response) => {
          if (chrome.runtime.lastError) {
            // This is expected if content.js hasn't been injected yet for this specific tab,
            // but the pageLoad action will be handled by content.js upon future injection.
            console.log('Error sending pageLoad message:', chrome.runtime.lastError);
          }
        });
      }
    });
  }
});
