let isRecording = false;
let startTime = null;

// Initialize from storage and record page load if necessary
chrome.storage.local.get(['isRecording', 'startTime'], (result) => {
  isRecording = result.isRecording || false;
  startTime = result.startTime || null;

  // If we are recording, this script injection is the result of a navigation.
  // Therefore, we should record the page load event.
  if (isRecording) {
    const loadData = {
      type: 'pageLoad',
      relativeTime: startTime ? Date.now() - startTime : 0,
      url: window.location.href,
      title: document.title,
    };
    saveAction(loadData);
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

// Get Shadow DOM path
function getShadowDOMPath(element) {
  const path = [];
  let current = element;

  // Only generate a path if the element is inside a shadow root.
  if (current.getRootNode() instanceof ShadowRoot) {
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const selector = getSelector(current);
      path.unshift(selector);

      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        current = root.host;
      } else {
        // We've emerged from the shadow DOM world.
        break;
      }
    }
  }
  
  return path;
}

// Get comprehensive element information
function getElementInfo(element) {
  const info = {
    selector: getSelector(element),
    shadowDOMPath: getShadowDOMPath(element),
    id: element.id || null,
    value: element.value || null,
    title: element.title || null,
    dataAttributes: {}
  };

  // Capture data-* attributes for easy access
  if (element.attributes) {
    for (let attr of element.attributes) {
      if (attr.name.startsWith('data-')) {
        info.dataAttributes[attr.name] = attr.value;
      }
    }
  }
  
  return info;
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
  
  const elementInfo = getElementInfo(e.target);
  
  const clickData = {
    type: 'click',
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: elementInfo,
    url: window.location.href
  };
  
  saveAction(clickData);
  showFeedback(e.clientX, e.clientY, '#ff0000');
}, true);

// Record focus events to detect when input fields appear
document.addEventListener('focus', (e) => {
  if (!isRecording) return;
  
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    const elementInfo = getElementInfo(e.target);
    
    const focusData = {
      type: 'focus',
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: elementInfo,
      url: window.location.href
    };
    
    saveAction(focusData);
    
    const rect = e.target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#00ffff');
  }
}, true);

// Record keyboard input (typing)
document.addEventListener('input', (e) => {
  if (!isRecording) return;
  
  const inputData = {
    type: 'input',
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
    inputType: e.inputType,
    data: e.data,
    value: e.target.value,
    url: window.location.href
  };
  
  saveAction(inputData);
  
  const rect = e.target.getBoundingClientRect();
  showFeedback(rect.left + 10, rect.top + 10, '#00ff00');
}, true);

// Record paste events
document.addEventListener('paste', (e) => {
  if (!isRecording) return;
  
  const pasteData = {
    type: 'paste',
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
    pastedText: e.clipboardData?.getData('text') || null,
    url: window.location.href
  };
  
  saveAction(pasteData);
  
  const rect = e.target.getBoundingClientRect();
  showFeedback(rect.left + 10, rect.top + 10, '#0000ff');
}, true);

// Record keydown for special keys
document.addEventListener('keydown', (e) => {
  if (!isRecording) return;
  
  const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  
  if (specialKeys.includes(e.key)) {
    const keyData = {
      type: 'keypress',
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
    
    const rect = e.target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#ffff00');
  }
}, true);

// Monitor for attribute changes (like toggle switches or button states)
const observer = new MutationObserver((mutations) => {
  if (!isRecording) return;
  
  mutations.forEach((mutation) => {
    if (mutation.type === 'attributes') {
      const mutationData = {
        type: 'attributeChange',
        relativeTime: startTime ? Date.now() - startTime : 0,
        element: getElementInfo(mutation.target),
        attributeName: mutation.attributeName,
        oldValue: mutation.oldValue,
        newValue: mutation.target.getAttribute(mutation.attributeName),
        url: window.location.href
      };
      
      saveAction(mutationData);
    }
  });
});

// Start observing the document for attribute changes
observer.observe(document.body, {
  attributes: true,
  attributeOldValue: true,
  subtree: true,
  attributeFilter: ['class', 'disabled', 'aria-checked', 'data-state', 'aria-disabled']
});
