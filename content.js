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

// Get comprehensive element information
function getElementInfo(element) {
  const info = {
    tagName: element.tagName,
    id: element.id || null,
    className: element.className || null,
    classList: element.classList ? Array.from(element.classList) : [],
    selector: getSelector(element),
    attributes: {},
    text: element.textContent?.trim().substring(0, 200) || null,
    innerText: element.innerText?.trim().substring(0, 200) || null,
    value: element.value || null,
    href: element.href || null,
    src: element.src || null,
    alt: element.alt || null,
    title: element.title || null,
    type: element.type || null,
    name: element.name || null,
    placeholder: element.placeholder || null,
    role: element.getAttribute('role') || null,
    ariaLabel: element.getAttribute('aria-label') || null,
    dataAttributes: {}
  };
  
  // Capture all standard attributes
  if (element.attributes) {
    for (let attr of element.attributes) {
      info.attributes[attr.name] = attr.value;
      
      // Capture data-* attributes separately for easy access
      if (attr.name.startsWith('data-')) {
        info.dataAttributes[attr.name] = attr.value;
      }
    }
  }
  
  // Get computed styles that might be useful
  const computedStyle = window.getComputedStyle(element);
  info.styles = {
    display: computedStyle.display,
    visibility: computedStyle.visibility,
    position: computedStyle.position,
    zIndex: computedStyle.zIndex
  };
  
  // Get element dimensions and position
  const rect = element.getBoundingClientRect();
  info.boundingBox = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom
  };
  
  // Get parent information for context
  if (element.parentElement) {
    info.parent = {
      tagName: element.parentElement.tagName,
      id: element.parentElement.id || null,
      className: element.parentElement.className || null,
      selector: getSelector(element.parentElement)
    };
  }
  
  // For form elements, capture form context
  if (element.form) {
    info.form = {
      id: element.form.id || null,
      name: element.form.name || null,
      action: element.form.action || null,
      method: element.form.method || null
    };
  }
  
  return info;
}
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

// Save action to storage
function saveAction(actionData) {
  chrome.storage.local.get(['clicks'], (result) => {
    const clicks = result.clicks || [];
    clicks.push(actionData);
    chrome.storage.local.set({ clicks });
  });
}

// Show visual feedback
function showFeedback(x, y, color = '#ff0000') {
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: fixed;
    top: ${y - 10}px;
    left: ${x - 10}px;
    width: 20px;
    height: 20px;
    border: 3px solid ${color};
    border-radius: 50%;
    pointer-events: none;
    z-index: 999999;
    animation: pulse 0.5s ease-out;
  `;
  
  if (!document.getElementById('recorder-style')) {
    const style = document.createElement('style');
    style.id = 'recorder-style';
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); opacity: 1; }
        100% { transform: scale(2); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(indicator);
  
  setTimeout(() => {
    indicator.remove();
  }, 500);
}

// Record click event
document.addEventListener('click', (e) => {
  if (!isRecording) return;
  
  const clickData = {
    type: 'click',
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
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
  
  saveAction(clickData);
  showFeedback(e.clientX, e.clientY, '#ff0000');
}, true);

// Record keyboard input (typing)
document.addEventListener('input', (e) => {
  if (!isRecording) return;
  
  const inputData = {
    type: 'input',
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
    inputType: e.inputType,
    data: e.data,
    value: e.target.value,
    url: window.location.href
  };
  
  saveAction(inputData);
  
  // Get element position for feedback
  const rect = e.target.getBoundingClientRect();
  showFeedback(rect.left + 10, rect.top + 10, '#00ff00');
}, true);

// Record paste events
document.addEventListener('paste', (e) => {
  if (!isRecording) return;
  
  const pasteData = {
    type: 'paste',
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
    pastedText: e.clipboardData?.getData('text') || null,
    url: window.location.href
  };
  
  saveAction(pasteData);
  
  // Get element position for feedback
  const rect = e.target.getBoundingClientRect();
  showFeedback(rect.left + 10, rect.top + 10, '#0000ff');
}, true);

// Record keydown for special keys (Enter, Tab, etc.)
document.addEventListener('keydown', (e) => {
  if (!isRecording) return;
  
  // Only record special keys, not regular typing (that's handled by 'input' event)
  const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  
  if (specialKeys.includes(e.key)) {
    const keyData = {
      type: 'keypress',
      timestamp: Date.now(),
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: getElementInfo(e.target),
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      url: window.location.href
    };
    
    saveAction(keyData);
    
    // Get element position for feedback
    const rect = e.target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#ffff00');
  }
}, true);
