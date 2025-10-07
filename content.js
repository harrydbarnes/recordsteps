(async () => {
  // --- State Initialization ---
  let isRecording = false;
  let startTime = null;
  let eventSequence = [];
  let lastInputElement = null;

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
    return;
  }

  // --- Utility Functions ---

  function getSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.className) {
      const classes = String(element.className).trim().split(/\s+/).join('.');
      if (classes) {
        const selector = `${element.tagName.toLowerCase()}.${classes}`;
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (e) { /* Invalid selector */ }
      }
    }
    let path = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      } else {
        let sibling = current, nth = 1;
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

  function getShadowDOMPath(element) {
    const path = [];
    let current = element;
    if (!current || !(current.getRootNode() instanceof ShadowRoot)) return path;
    while (current && current.getRootNode() instanceof ShadowRoot) {
      path.unshift(getSelector(current));
      current = current.getRootNode().host;
    }
    return path;
  }

  function getElementInfo(element) {
    if (!element) return null;
    const computedStyle = window.getComputedStyle(element);
    const boundingBox = element.getBoundingClientRect();
    const info = {
      selector: getSelector(element),
      shadowDOMPath: getShadowDOMPath(element),
      tagName: element.tagName,
      className: element.className,
      id: element.id || null,
      textContent: element.textContent ? element.textContent.trim().substring(0, 200) : null,
      value: element.value !== undefined ? element.value : null,
      href: element.href || null,
      src: element.src || null,
      alt: element.alt || null,
      title: element.title || null,
      role: element.getAttribute('role') || null,
      ariaLabel: element.getAttribute('aria-label') || null,
      dataAttributes: {},
      style: {
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        width: boundingBox.width,
        height: boundingBox.height,
        top: boundingBox.top,
        left: boundingBox.left,
      },
      parentElement: element.parentElement ? getSelector(element.parentElement) : null,
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

  function saveAction(actionData) {
    chrome.runtime.sendMessage({ action: 'recordAction', data: actionData }, response => {
      if (chrome.runtime.lastError) {
        console.error(`Error saving action: ${chrome.runtime.lastError.message}`);
      }
    });
  }

  function flushInputEvents() {
    if (lastInputElement && eventSequence.length > 0) {
      const sequenceData = {
        type: 'inputSequence',
        relativeTime: eventSequence[0].relativeTime,
        element: getElementInfo(lastInputElement),
        events: eventSequence,
        finalValue: lastInputElement.value,
        url: window.location.href,
      };
      saveAction(sequenceData);
    }
    eventSequence = [];
  }

  function showFeedback(x, y, color = '#ff0000') {
    const indicator = document.createElement('div');
    indicator.style.cssText = `position:fixed;top:${y-10}px;left:${x-10}px;width:20px;height:20px;border:3px solid ${color};border-radius:50%;pointer-events:none;z-index:999999;animation:pulse .5s ease-out;`;
    if (!document.getElementById('recorder-style')) {
      const style = document.createElement('style');
      style.id = 'recorder-style';
      style.textContent = `@keyframes pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2);opacity:0}}`;
      document.head.appendChild(style);
    }
    document.body.appendChild(indicator);
    setTimeout(() => indicator.remove(), 500);
  }

  // --- Event Listeners ---

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

  function handleFocus(e) {
    const target = e.target;
    if (!isRecording || !(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (lastInputElement && lastInputElement !== target) {
      flushInputEvents();
    }
    lastInputElement = target;
    eventSequence = [];
    const focusData = {
      type: 'focus',
      relativeTime: startTime ? Date.now() - startTime : 0,
      element: getElementInfo(target),
      url: window.location.href
    };
    saveAction(focusData);
    const rect = target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#00ffff');
  }

  function handleBlur(e) {
    if (!isRecording || e.target !== lastInputElement) return;
    flushInputEvents();
    lastInputElement = null;
  }

  function handleKeydown(e) {
    if (!isRecording) return;
    const eventTime = startTime ? Date.now() - startTime : 0;

    if (e.target === lastInputElement) {
      eventSequence.push({ type: 'keydown', relativeTime: eventTime, key: e.key, code: e.code });
      return;
    }

    const specialKeys = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'];
    if (specialKeys.includes(e.key)) {
      const keyData = { type: 'keypress', relativeTime: eventTime, element: getElementInfo(e.target), key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, url: window.location.href };
      saveAction(keyData);
      const rect = e.target.getBoundingClientRect();
      showFeedback(rect.left + 10, rect.top + 10, '#ffff00');
    }
  }

  function handleInput(e) {
    if (!isRecording || e.target !== lastInputElement) return;
    eventSequence.push({ type: 'input', relativeTime: startTime ? Date.now() - startTime : 0, inputType: e.inputType, data: e.data, value: e.target.value });
  }

  function handlePaste(e) {
    if (!isRecording) return;
    const pasteData = { type: 'paste', relativeTime: startTime ? Date.now() - startTime : 0, element: getElementInfo(e.target), pastedText: e.clipboardData?.getData('text') || null, url: window.location.href };
    saveAction(pasteData);
    if (e.target === lastInputElement) {
      eventSequence.push({ type: 'paste', relativeTime: pasteData.relativeTime, pastedText: pasteData.pastedText });
    }
    const rect = e.target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#0000ff');
  }

  const observer = new MutationObserver((mutations) => {
    if (!isRecording) return;
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        saveAction({ type: 'attributeChange', relativeTime: startTime ? Date.now() - startTime : 0, element: getElementInfo(mutation.target), attributeName: mutation.attributeName, oldValue: mutation.oldValue, newValue: mutation.target.getAttribute(mutation.attributeName), url: window.location.href });
      }
    });
  });

  // Attach all event listeners
  document.addEventListener('click', handleClick, true);
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('blur', handleBlur, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('paste', handlePaste, true);
  observer.observe(document.body, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ['class', 'disabled', 'aria-checked', 'data-state', 'aria-disabled'] });

  // --- State Synchronization ---
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isRecording) isRecording = !!changes.isRecording.newValue;
      if (changes.startTime) startTime = changes.startTime.newValue || null;
    }
  });

  // --- Initial Action ---
  if (isRecording) {
    saveAction({ type: 'pageLoad', relativeTime: startTime ? Date.now() - startTime : 0, url: window.location.href, title: document.title });
  }

})();