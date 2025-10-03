let isRecording = false;
let startTime = null;

// Initialize from storage
chrome.storage.local.get(['isRecording'], (result) => {
  isRecording = result.isRecording || false;
  if (isRecording) {
    startTime = Date.now();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'startRecording') {
    isRecording = true;
    startTime = Date.now();
  } else if (message.action === 'stopRecording') {
    isRecording = false;
    startTime = null;
  }
});

// Generate unique selector for element
function getSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }
  
  if (element.className) {
    const classes = element.className.trim().split(/\s+/).join('.');
    const selector = `${element.tagName.toLowerCase()}.${classes}`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }
  
  // Build path from parent
  let path = [];
  let current = element;
  
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    } else {
      let sibling = current;
      let nth = 1;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.tagName === current.tagName) nth++;
      }
      if (nth > 1) selector += `:nth-of-type(${nth})`;
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

// Record click event
document.addEventListener('click', (e) => {
  if (!isRecording) return;
  
  const clickData = {
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: {
      tagName: e.target.tagName,
      id: e.target.id || null,
      className: e.target.className || null,
      selector: getSelector(e.target),
      text: e.target.textContent?.trim().substring(0, 100) || null,
      href: e.target.href || null,
      type: e.target.type || null,
      name: e.target.name || null
    },
    position: {
      x: e.clientX,
      y: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY
    },
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    }
  };
  
  // Save to storage
  chrome.storage.local.get(['clicks'], (result) => {
    const clicks = result.clicks || [];
    clicks.push(clickData);
    chrome.storage.local.set({ clicks });
  });
  
  // Visual feedback
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: fixed;
    top: ${e.clientY - 10}px;
    left: ${e.clientX - 10}px;
    width: 20px;
    height: 20px;
    border: 3px solid #ff0000;
    border-radius: 50%;
    pointer-events: none;
    z-index: 999999;
    animation: pulse 0.5s ease-out;
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% { transform: scale(1); opacity: 1; }
      100% { transform: scale(2); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(indicator);
  
  setTimeout(() => {
    indicator.remove();
    style.remove();
  }, 500);
}, true);
