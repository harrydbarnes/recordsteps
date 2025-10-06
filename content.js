let isRecording = false;
let startTime = null;
let eventSequence = [];
let lastInputElement = null;

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
    eventSequence = [];
  } else if (message.action === 'stopRecording') {
    isRecording = false;
    startTime = null;
    eventSequence = [];
    lastInputElement = null;
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
  
  while (current) {
    const info = {
      tagName: current.tagName,
      id: current.id || null,
      selector: getSelector(current),
      hasShadowRoot: !!current.shadowRoot
    };
    
    if (current.shadowRoot) {
      info.shadowRootMode = current.shadowRoot.mode;
      info.shadowRootHTML = current.shadowRoot.innerHTML;
    }
    
    path.push(info);
    
    // Check if parent is a shadow host
    const root = current.getRootNode();
    if (root instanceof ShadowRoot) {
      current = root.host;
    } else {
      current = current.parentElement;
    }
  }
  
  return path;
}

// Get full Shadow DOM snapshot
function getShadowDOMSnapshot(element) {
  const snapshot = {
    element: element.tagName,
    id: element.id || null,
    outerHTML: element.outerHTML.substring(0, 5000), // Limit size
    shadowRoots: []
  };
  
  // Traverse and collect all shadow roots
  function traverseShadowDOM(node, depth = 0) {
    if (depth > 10) return; // Prevent infinite recursion
    
    if (node.shadowRoot) {
      const shadowInfo = {
        host: node.tagName,
        hostId: node.id || null,
        mode: node.shadowRoot.mode,
        innerHTML: node.shadowRoot.innerHTML,
        childElements: []
      };
      
      // Get all child elements in shadow root
      const children = node.shadowRoot.querySelectorAll('*');
      children.forEach(child => {
        shadowInfo.childElements.push({
          tagName: child.tagName,
          id: child.id || null,
          attributes: Array.from(child.attributes).map(attr => ({
            name: attr.name,
            value: attr.value
          }))
        });
        
        // Recurse into nested shadow roots
        if (child.shadowRoot) {
          traverseShadowDOM(child, depth + 1);
        }
      });
      
      snapshot.shadowRoots.push(shadowInfo);
    }
    
    // Check children for shadow roots
    if (node.children) {
      Array.from(node.children).forEach(child => traverseShadowDOM(child, depth));
    }
  }
  
  traverseShadowDOM(element);
  return snapshot;
}

// Get comprehensive element information
function getElementInfo(element) {
  const info = {
    tagName: element.tagName,
    id: element.id || null,
    selector: getSelector(element),
    shadowDOMPath: getShadowDOMPath(element),
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
    ariaChecked: element.getAttribute('aria-checked') || null,
    disabled: element.disabled || null,
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
  
  // Get parent information for context
  if (element.parentElement) {
    info.parent = {
      tagName: element.parentElement.tagName,
      id: element.parentElement.id || null,
      selector: getSelector(element.parentElement)
    };
    
    // Capture Shadow DOM snapshot of parent if it has shadowRoot
    if (element.parentElement.shadowRoot) {
      info.parentShadowDOMSnapshot = getShadowDOMSnapshot(element.parentElement);
    }
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
  
  // Check if element is inside a shadow root
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) {
    info.insideShadowDOM = {
      hostTagName: root.host.tagName,
      hostId: root.host.id || null,
      hostSelector: getSelector(root.host),
      shadowRootMode: root.mode
    };
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

// Track all DOM events on input elements for detailed event sequencing
const eventsToTrack = [
  'focus', 'blur', 'input', 'change', 
  'keydown', 'keypress', 'keyup',
  'beforeinput', 'textInput',
  'compositionstart', 'compositionupdate', 'compositionend'
];

function attachEventTrackers(element) {
  if (element !== lastInputElement) {
    lastInputElement = element;
    eventSequence = [];
    
    eventsToTrack.forEach(eventType => {
      element.addEventListener(eventType, (e) => {
        if (!isRecording) return;
        
        const eventInfo = {
          type: eventType,
          timestamp: Date.now(),
          relativeTime: startTime ? Date.now() - startTime : 0,
          bubbles: e.bubbles,
          cancelable: e.cancelable,
          composed: e.composed,
          defaultPrevented: e.defaultPrevented
        };
        
        // Add event-specific data
        if (e instanceof KeyboardEvent) {
          eventInfo.key = e.key;
          eventInfo.code = e.code;
          eventInfo.keyCode = e.keyCode;
          eventInfo.ctrlKey = e.ctrlKey;
          eventInfo.shiftKey = e.shiftKey;
          eventInfo.altKey = e.altKey;
          eventInfo.metaKey = e.metaKey;
        }
        
        if (e instanceof InputEvent) {
          eventInfo.inputType = e.inputType;
          eventInfo.data = e.data;
          eventInfo.dataTransfer = e.dataTransfer ? 'present' : null;
        }
        
        eventSequence.push(eventInfo);
        
        // Save event sequence snapshot periodically
        if (eventSequence.length % 5 === 0) {
          saveAction({
            type: 'eventSequence',
            timestamp: Date.now(),
            relativeTime: startTime ? Date.now() - startTime : 0,
            element: getElementInfo(element),
            events: [...eventSequence],
            currentValue: element.value,
            url: window.location.href
          });
        }
      }, true);
    });
  }
}

// Record click event
document.addEventListener('click', (e) => {
  if (!isRecording) return;
  
  const elementInfo = getElementInfo(e.target);
  
  // Capture Shadow DOM snapshot for parent if it exists
  let parentSnapshot = null;
  if (e.target.parentElement) {
    parentSnapshot = getShadowDOMSnapshot(e.target.parentElement);
  }
  
  const clickData = {
    type: 'click',
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: elementInfo,
    parentShadowDOMSnapshot: parentSnapshot,
    position: {
      x: e.clientX,
      y: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY
    },
    url: window.location.href
  };
  
  saveAction(clickData);
  showFeedback(e.clientX, e.clientY, '#ff0000');
}, true);

// Record focus events to detect when input fields appear
document.addEventListener('focus', (e) => {
  if (!isRecording) return;
  
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    // Attach detailed event trackers
    attachEventTrackers(e.target);
    
    const elementInfo = getElementInfo(e.target);
    
    // Capture comprehensive Shadow DOM snapshot
    let shadowDOMSnapshot = null;
    const root = e.target.getRootNode();
    if (root instanceof ShadowRoot) {
      shadowDOMSnapshot = getShadowDOMSnapshot(root.host);
    }
    
    const focusData = {
      type: 'focus',
      timestamp: Date.now(),
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: elementInfo,
      shadowDOMSnapshot: shadowDOMSnapshot,
      fullContext: {
        documentTitle: document.title,
        activeElement: document.activeElement?.tagName,
        url: window.location.href
      }
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
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
    inputType: e.inputType,
    data: e.data,
    value: e.target.value,
    eventSequence: [...eventSequence],
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
    timestamp: Date.now(),
    relativeTime: startTime ? Date.now() - startTime : 0,
    element: getElementInfo(e.target),
    pastedText: e.clipboardData?.getData('text') || null,
    eventSequence: [...eventSequence],
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
      timestamp: Date.now(),
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: getElementInfo(e.target),
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      eventSequence: [...eventSequence],
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
        timestamp: Date.now(),
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
