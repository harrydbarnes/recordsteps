/**
 * @fileoverview Content script for the Record Steps extension.
 * This script is injected into web pages to record user interactions.
 * It captures events like clicks, keyboard inputs, and focus changes,
 * collects detailed information about the target elements, and sends
 * the data to the background script for storage.
 */

/**
 * @description An Immediately Invoked Function Expression (IIFE) that serves
 * as the main entry point for the content script. It initializes state,
 * sets up all event listeners, and handles communication with the background script.
 * The async nature allows for top-level await during state initialization.
 */
(async () => {
  // --- State Initialization ---
  let isRecording = false;
  let startTime = null;
  let eventSequence = [];
  let lastInputElement = null;

  /**
   * Initializes the script's state by fetching the current recording status
   * and start time from chrome.storage.
   */
  try {
    const result = await chrome.storage.local.get(['isRecording', 'startTime']);
    isRecording = result.isRecording || false;
    startTime = result.startTime || null;
  } catch (e) {
    console.error(`Error initializing content script state: ${e.message}`);
    return; // Stop execution if we can't get the initial state.
  }

  // --- Utility Functions ---

  /**
   * Generates a unique and stable CSS selector for a given HTML element.
   * It prioritizes IDs, then unique class names, and falls back to a path
   * of tag names and nth-of-type pseudo-classes.
   * @param {HTMLElement} element The element to generate a selector for.
   * @returns {string} A CSS selector string.
   */
  function getSelector(element) {
    if (element.id) {
      const idSelector = `#${CSS.escape(element.id)}`;
      try {
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      } catch(e) {
        console.warn('Invalid ID selector generated, falling back to path:', idSelector, e);
      }
    }
    if (element.className) {
      const className = (typeof element.className === 'string') ? element.className : (element.className.baseVal || '');
      const classes = className.trim().split(/\s+/).map(c => `.${CSS.escape(c)}`).join('');
      if (classes) {
        const selector = `${element.tagName.toLowerCase()}${classes}`;
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (e) {
          console.warn('Invalid class selector generated, falling back to path:', selector, e);
        }
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

  /**
   * Generates an array of CSS selectors representing the path through
   * nested Shadow DOMs to reach a target element.
   * @param {HTMLElement} element The element to trace the shadow path for.
   * @returns {string[]} An array of selectors for shadow hosts, from the outermost to the innermost.
   */
  function getShadowDOMPath(element) {
    const path = [];
    let current = element;
    // Ascend from the element's location
    while (current && current.parentElement) {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        // We are in a shadow DOM, so get the host and add its selector to the path
        path.unshift(getSelector(root.host));
        current = root.host;
      } else {
        // We've reached the light DOM
        break;
      }
    }
    return path;
  }

  /**
   * Collects a comprehensive set of properties from an HTML element.
   * This includes its selector, dimensions, attributes, and computed styles.
   * @param {HTMLElement} element The element to inspect.
   * @returns {object | null} An object containing detailed information about the element, or null if the element is invalid.
   */
  /**
   * Returns a masked value for an element if it is a sensitive field,
   * otherwise returns the actual value. It ensures that undefined values
   * are returned as null for data consistency.
   * @param {HTMLElement} element The element to get the value from.
   * @returns {string | null} The masked or actual value.
   */
  const sensitiveKeywords = /password|secret|token|key|creditcard|cvc|ssn|socialsecuritynumber|card[_-]number|account[_-]number/i;

  function isElementSensitive(element) {
    if (!element) return false;
    return element.type === 'password' ||
      (element.name && sensitiveKeywords.test(element.name)) ||
      (element.id && sensitiveKeywords.test(element.id)) ||
      (element.placeholder && sensitiveKeywords.test(element.placeholder)) ||
      (element.getAttribute('aria-label') && sensitiveKeywords.test(element.getAttribute('aria-label')));
  }

  function getMaskedValue(element) {
    if (!element) return null;
    if (isElementSensitive(element)) {
      return '********';
    }
    return element.value !== undefined ? element.value : null;
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
      value: getMaskedValue(element),
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

  /**
   * Sends a recorded action to the background script for storage.
   * @param {object} actionData The data object representing the user action.
   */
  function saveAction(actionData) {
    chrome.runtime.sendMessage({ action: 'recordAction', data: actionData }, response => {
      if (chrome.runtime.lastError || (response && !response.success)) {
        console.error(`Error saving action: ${chrome.runtime.lastError?.message || response?.error}`);
      }
    });
  }

  /**
   * Processes and saves the sequence of keyboard events for the last focused input element.
   * This is called when the input element loses focus (blur) or another element is focused.
   */
  function flushInputEvents() {
    if (lastInputElement && eventSequence.length > 0) {
      const sequenceData = {
        type: 'inputSequence',
        relativeTime: eventSequence[0].relativeTime,
        element: getElementInfo(lastInputElement),
        events: eventSequence,
        finalValue: getMaskedValue(lastInputElement),
        url: window.location.href,
      };
      saveAction(sequenceData);
    }
    eventSequence = [];
  }

  /**
   * Displays a visual feedback indicator on the page at the specified coordinates.
   * This is used to show the user where an event was recorded.
   * @param {number} x The horizontal coordinate.
   * @param {number} y The vertical coordinate.
   * @param {string} [color='#ff0000'] The color of the indicator.
   */
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

  /**
   * Handles click events on the document.
   * @param {MouseEvent} e The mouse event object.
   */
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

  /**
   * Handles focus events on the document, targeting input-like elements.
   * @param {FocusEvent} e The focus event object.
   */
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

  /**
   * Handles blur events on any element. If the blurred element is the one
   * we are tracking for input, it flushes (saves) the collected event sequence.
   * @param {FocusEvent} e The focus event object.
   */
  function handleBlur(e) {
    if (!isRecording || e.target !== lastInputElement) return;
    flushInputEvents();
    lastInputElement = null;
  }

  /**
   * Handles keydown events. It groups events for the currently focused input
   * or records special key presses on other elements.
   * @param {KeyboardEvent} e The keyboard event object.
   */
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

  /**
   * Handles the `input` event, which fires when the value of an `<input>`,
   * `<select>`, or `<textarea>` element has been changed. Adds the event
   * to the current sequence for the focused element.
   * @param {InputEvent} e The input event object.
   */
  function handleInput(e) {
    if (!isRecording || e.target !== lastInputElement) return;
    const isSensitive = isElementSensitive(e.target);
    const value = isSensitive ? '********' : e.target.value;
    const data = isSensitive ? null : e.data;
    eventSequence.push({ type: 'input', relativeTime: startTime ? Date.now() - startTime : 0, inputType: e.inputType, data: data, value: value });
  }

  /**
   * Handles the `paste` event. It captures the pasted text and either adds
   * it to the current input sequence or records it as a standalone event
   * if the target is not a tracked input field.
   * @param {ClipboardEvent} e The clipboard event object.
   */
  function handlePaste(e) {
    if (!isRecording) return;
    const eventTime = startTime ? Date.now() - startTime : 0;
    const pastedText = e.clipboardData?.getData('text') || null;

    if (e.target === lastInputElement) {
      // If paste happens on the focused input, only add it to the sequence.
      eventSequence.push({ type: 'paste', relativeTime: eventTime, pastedText: pastedText });
    } else {
      // If paste happens elsewhere, save it as a standalone event.
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

  /**
   * A MutationObserver to watch for changes to specific element attributes.
   * This is useful for capturing state changes that don't trigger other events,
   * such as a button becoming enabled or a class name changing.
   * @param {MutationRecord[]} mutations An array of mutation records provided by the observer.
   * @param {MutationObserver} observer The observer instance.
   */
  const observer = new MutationObserver((mutations) => {
    if (!isRecording) return;
    mutations.forEach((mutation) => {
      // We are only interested in attribute changes.
      if (mutation.type === 'attributes') {
        saveAction({
          type: 'attributeChange',
          relativeTime: startTime ? Date.now() - startTime : 0,
          element: getElementInfo(mutation.target),
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue,
          newValue: mutation.target.getAttribute(mutation.attributeName),
          url: window.location.href
        });
      }
    });
  });

  // Attach all event listeners using capturing to ensure they are caught early.
  document.addEventListener('click', handleClick, true);
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('blur', handleBlur, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('paste', handlePaste, true);
  observer.observe(document.body, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ['class', 'disabled', 'aria-checked', 'data-state', 'aria-disabled'] });

  /**
   * Listens for changes in chrome.storage to keep the content script's state
   * (isRecording, startTime) in sync with the rest of the extension.
   * @param {object} changes Object describing the changes.
   * @param {string} namespace The storage area ('local' or 'sync') that changed.
   */
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isRecording) isRecording = !!changes.isRecording.newValue;
      if (changes.startTime) startTime = changes.startTime.newValue || null;
    }
  });

  /**
   * On initial script injection, if recording is already active,
   * log a 'pageLoad' event to mark the entry point.
   */
  if (isRecording) {
    saveAction({ type: 'pageLoad', relativeTime: startTime ? Date.now() - startTime : 0, url: window.location.href, title: document.title });
  }

})();