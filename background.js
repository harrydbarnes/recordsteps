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
