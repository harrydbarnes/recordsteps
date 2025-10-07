(async () => {
  // --- State Initialization ---
  let isRecording = false;
  let startTime = null;

  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(['isRecording', 'startTime'], (data) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(data);
      });
    });
    isRecording = result.isRecording || false;
    startTime = result.startTime || null;
  } catch (e) {
    console.error(`Error initializing content script state: ${e.message}`);
    // If we can't get the state, we shouldn't proceed.
    return;
  }

  // --- Utility Functions ---

  // Generate unique selector for element
  function getSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    if (element.className) {
      const classes = String(element.className).trim().split(/\s+/).join('.');
      if (classes) {
        const selector = `${element.tagName.toLowerCase()}.${classes}`;
        try {
            if (document.querySelectorAll(selector).length === 1) {
                return selector;
            }
        } catch (e) {
            // Invalid selector, ignore
        }
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
        while ((sibling = sibling.previousElementSibling)) {
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
    if (!current || !(current.getRootNode() instanceof ShadowRoot)) {
      return path;
    }
    while (current && current.getRootNode() instanceof ShadowRoot) {
        const selector = getSelector(current);
        path.unshift(selector);
        current = current.getRootNode().host;
    }
    return path;
  }

  // Get comprehensive element information
  function getElementInfo(element) {
    const info = {
      selector: getSelector(element),
      shadowDOMPath: getShadowDOMPath(element),
      id: element.id || null,
      value: element.value !== undefined ? element.value : null,
      title: element.title || null,
      dataAttributes: {}
    };
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
  async function saveAction(actionData) {
    try {
      const { clicks } = await new Promise((resolve, reject) => {
          chrome.storage.local.get(['clicks'], (data) => {
              if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
              resolve(data);
          });
      });
      const newClicks = [...(clicks || []), actionData];
      await new Promise((resolve, reject) => {
          chrome.storage.local.set({ clicks: newClicks }, () => {
              if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
              resolve();
          });
      });
    } catch (e) {
        console.error(`Error saving action: ${e.message}`);
    }
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
    setTimeout(() => indicator.remove(), 500);
  }

  // --- Event Listeners ---

  // Record click event
  function handleClick(e) {
    if (!isRecording) return;
    const clickData = {
      type: 'click',
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: getElementInfo(e.target),
      url: window.location.href
    };
    saveAction(clickData);
    showFeedback(e.clientX, e.clientY, '#ff0000');
  }

  // Record focus events
  function handleFocus(e) {
    if (!isRecording || !(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const focusData = {
      type: 'focus',
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: getElementInfo(e.target),
      url: window.location.href
    };
    saveAction(focusData);
    const rect = e.target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#00ffff');
  }

  // Record keyboard input
  function handleInput(e) {
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
  }

  // Record paste events
  function handlePaste(e) {
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
  }

  // Record keydown for special keys
  function handleKeydown(e) {
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
  }

  // Monitor for attribute changes
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

  // Attach all event listeners
  document.addEventListener('click', handleClick, true);
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('paste', handlePaste, true);
  document.addEventListener('keydown', handleKeydown, true);
  observer.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    subtree: true,
    attributeFilter: ['class', 'disabled', 'aria-checked', 'data-state', 'aria-disabled']
  });

  // --- State Synchronization ---

  // Listen for changes in storage to keep state synchronized
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isRecording) {
        isRecording = !!changes.isRecording.newValue;
      }
      if (changes.startTime) {
        startTime = changes.startTime.newValue || null;
      }
    }
  });

  // --- Initial Action ---

  // If recording is active on script load, it means a navigation occurred.
  // Record the page load event.
  if (isRecording) {
    const loadData = {
      type: 'pageLoad',
      relativeTime: startTime ? Date.now() - startTime : 0,
      url: window.location.href,
      title: document.title,
    };
    saveAction(loadData);
  }

})();