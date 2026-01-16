/**
 * @fileoverview Content script for the Record Steps extension.
 * Now supports configurable logging levels (0-3).
 */

(async () => {
  // --- State Initialization ---
  let isRecording = false;
  let startTime = null;
  let eventSequence = [];
  let lastInputElement = null;

  // 0=Minimal, 1=Standard, 2=Detailed, 3=Verbose
  let loggingLevel = 0;

  try {
    const result = await chrome.storage.local.get(['isRecording', 'startTime', 'loggingLevel']);
    isRecording = result.isRecording || false;
    startTime = result.startTime || null;
    // Default to 0 (Minimal) if not set
    loggingLevel = parseInt(result.loggingLevel, 10);
    if (isNaN(loggingLevel)) loggingLevel = 0;
  } catch (e) {
    console.error(`Error initializing content script state: ${e.message}`);
    return;
  }

  // --- Utility Functions ---

  function getSelector(element) {
    if (element.id) {
      const idSelector = `#${CSS.escape(element.id)}`;
      try {
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      } catch(e) { /* ignore */ }
    }
    if (element.className) {
      const className = (typeof element.className === 'string') ? element.className : (element.className.baseVal || '');
      const classes = className.trim().split(/\s+/).map(c => `.${CSS.escape(c)}`).join('');
      if (classes) {
        const selector = `${element.tagName.toLowerCase()}${classes}`;
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (e) { /* ignore */ }
      }
    }
    let path = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
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
    while (current && current.parentElement) {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        path.unshift(getSelector(root.host));
        current = root.host;
      } else {
        break;
      }
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
      className: (typeof element.className === 'string') ? element.className : (element.className.baseVal || ''),
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
      if (chrome.runtime.lastError || (response && !response.success)) {
        console.error(`Error saving action: ${chrome.runtime.lastError?.message || response?.error}`);
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
    // Log focus if recording AND (input element OR Level 1+ Standard Logging)
    if (!isRecording) return;

    // Always track inputs for typing sequences regardless of level
    const isInput = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (!isInput && loggingLevel < 1) return; // Skip non-inputs on Minimal level

    if (lastInputElement && lastInputElement !== target) {
      flushInputEvents();
    }

    if (isInput) lastInputElement = target;
    eventSequence = [];

    // Only save the Focus event itself if Level >= 1
    if (loggingLevel >= 1) {
      const focusData = {
        type: 'focus',
        relativeTime: startTime ? Date.now() - startTime : 0,
        element: getElementInfo(target),
        url: window.location.href
      };
      saveAction(focusData);
    }

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
      const keyData = { type: 'keyDown', relativeTime: eventTime, element: getElementInfo(e.target), key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, url: window.location.href };
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
    const eventTime = startTime ? Date.now() - startTime : 0;
    const pastedText = e.clipboardData?.getData('text') || null;

    if (e.target === lastInputElement) {
      eventSequence.push({ type: 'paste', relativeTime: eventTime, pastedText: pastedText });
    } else {
      const pasteData = {
        type: 'paste',
        relativeTime: eventTime,
        element: getElementInfo(e.target),
        pastedText: pastedText,
        url: window.location.href
      };
      saveAction(pasteData);
    }
    const rect = e.target.getBoundingClientRect();
    showFeedback(rect.left + 10, rect.top + 10, '#0000ff');
  }

  // --- Mutation Observer for Attributes (Level 2 & 3) ---

  let attributeChangeTimeout = null;
  let attributeChangeBuffer = [];

  const observer = new MutationObserver((mutations) => {
    // If Minimal (0) or Standard (1), do NOT record attribute changes.
    if (!isRecording || loggingLevel < 2) return;

    clearTimeout(attributeChangeTimeout);

    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        const attrName = mutation.attributeName;

        // LEVEL 2 FILTER:
        // If Level is 'Detailed' (2), skip noisy attributes like class, style, width, height.
        if (loggingLevel === 2) {
          if (['class', 'style', 'width', 'height', 'hidden'].includes(attrName)) return;
        }

        const newValue = mutation.target.getAttribute(attrName);
        if (mutation.oldValue !== newValue) {
          attributeChangeBuffer.push({
            element: getElementInfo(mutation.target),
            attributeName: attrName,
            oldValue: mutation.oldValue,
            newValue: newValue,
          });
        }
      }
    });

    attributeChangeTimeout = setTimeout(() => {
      if (!isRecording || loggingLevel < 2) {
        attributeChangeBuffer = [];
        return;
      }
      if (attributeChangeBuffer.length > 0) {
        saveAction({
          type: 'batchAttributeChange',
          relativeTime: startTime ? Date.now() - startTime : 0,
          changes: attributeChangeBuffer,
          url: window.location.href
        });
        attributeChangeBuffer = [];
      }
    }, 200);
  });

  document.addEventListener('click', handleClick, true);
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('blur', handleBlur, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('paste', handlePaste, true);

  // Observe everything initially; filtering happens inside the callback
  observer.observe(document.body, {
    attributes: true,
    attributeOldValue: true,
    subtree: true
    // We remove 'attributeFilter' here to allow the dynamic logic inside the observer
    // to decide what to keep based on loggingLevel.
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isRecording) isRecording = !!changes.isRecording.newValue;
      if (changes.startTime) startTime = changes.startTime.newValue || null;
      // Update logging level dynamically
      if (changes.loggingLevel) {
        loggingLevel = parseInt(changes.loggingLevel.newValue, 10);
        if (isNaN(loggingLevel)) loggingLevel = 0;
      }
    }
  });

  if (isRecording) {
    saveAction({ type: 'pageLoad', relativeTime: startTime ? Date.now() - startTime : 0, url: window.location.href, title: document.title });
  }

})();
