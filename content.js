/**
 * @fileoverview Content script for the Record Steps extension.
 * Now supports configurable logging levels (0-3).
 */

/**
 * @description An Immediately Invoked Function Expression (IIFE) that serves
 * as the main entry point for the content script. It initializes state,
 * sets up all event listeners, and handles communication with the background script.
 * The async nature allows for top-level await during state initialization.
 */
(async () => {
  // --- Constants ---
  const MAX_BATCH_SIZE = 50;
  const DYNAMIC_ID_MIN_DIGITS = 5;
  const DYNAMIC_ID_MAX_LENGTH = 30;
  const HOVER_DEBOUNCE_MS = 500;
  // Pre-compiled regex for sensitive data detection (case-insensitive)
  // Uses non-alphanumeric lookarounds to handle snake_case and kebab-case (e.g., api_key, card-number)
  const SENSITIVE_REGEX = /(?<![a-zA-Z0-9])(password|card|cvv|cvc|ssn|email|phone|mobile|tax|social|security|api|key|token|secret|auth|otp|pin|credit|cc)(?![a-zA-Z0-9])/i;

  // Pre-compiled regex for dynamic IDs to avoid re-creation on every call
  const dynamicIdPattern = new RegExp(`\\d{${DYNAMIC_ID_MIN_DIGITS},}`);

  // --- State Initialization ---
  let isRecording = false;
  let startTime = null;
  let eventSequence = [];
  let lastInputElement = null;

  // 0=Minimal, 1=Standard, 2=Detailed, 3=Verbose
  let loggingLevel = 0;

  /**
   * Parses the logging level to ensure it's a valid integer.
   * Defaults to 0 if invalid.
   * @param {any} level The logging level to parse.
   * @returns {number} The parsed logging level (0-3).
   */
  function parseLoggingLevel(level) {
    const parsed = parseInt(level, 10);
    if (isNaN(parsed) || parsed < LOGGING_LEVELS.MINIMAL || parsed > LOGGING_LEVELS.VERBOSE) {
      return LOGGING_LEVELS.MINIMAL; // Default to Minimal if invalid or out of range
    }
    return parsed;
  }

  try {
    const result = await chrome.storage.local.get(['isRecording', 'startTime', 'loggingLevel']);
    isRecording = result.isRecording || false;
    startTime = result.startTime || null;
    loggingLevel = parseLoggingLevel(result.loggingLevel);
  } catch (e) {
    console.error(`Error initializing content script state: ${e.message}`);
    return;
  }

  // --- Utility Functions ---

  /**
   * Checks if an element is likely to contain sensitive information.
   * @param {HTMLElement} element The element to check.
   * @returns {boolean} True if the element is sensitive, false otherwise.
   */
  function isSensitive(element) {
    if (element.type === 'password') return true;

    const attributesToCheck = ['id', 'name', 'autocomplete', 'type', 'placeholder', 'aria-label'];
    for (const attr of attributesToCheck) {
      if (element.hasAttribute(attr)) {
         const value = element.getAttribute(attr);
         if (SENSITIVE_REGEX.test(value)) {
           return true;
         }
      }
    }
    return false;
  }

  /**
   * Generates a unique and stable CSS selector for a given HTML element.
   * It prioritizes test attributes, IDs, then unique class names, and falls back to a path
   * of tag names and nth-of-type pseudo-classes.
   * @param {HTMLElement} element The element to generate a selector for.
   * @param {boolean} [skipVerification=false] If true, skips expensive uniqueness checks.
   * @returns {string} A CSS selector string.
   */
  function getSelector(element, skipVerification = false) {
    // Prioritize test attributes for stability
    const testAttributes = ['data-testid', 'data-cy', 'data-test-id', 'data-test'];
    for (const attr of testAttributes) {
      if (element.hasAttribute(attr)) {
        const value = element.getAttribute(attr);
        const selector = `[${attr}="${CSS.escape(value)}"]`;

        if (skipVerification) return selector;

        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (e) {
            // Ignore invalid selector errors
        }
      }
    }

    if (element.id) {
      // Ignore IDs that contain long numbers (dynamic) or are very long
      const isDynamic = dynamicIdPattern.test(element.id) || element.id.length > DYNAMIC_ID_MAX_LENGTH;

      if (!isDynamic) {
        const idSelector = `#${CSS.escape(element.id)}`;

        if (skipVerification) return idSelector;

        try {
          if (document.querySelectorAll(idSelector).length === 1) return idSelector;
        } catch(e) {
          if (loggingLevel >= 3) console.warn('Invalid ID selector:', idSelector, e);
        }
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
          if (loggingLevel >= 3) {
            console.warn('Invalid class selector generated, falling back to path:', selector, e);
          }
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
   * @param {boolean} [skipVerification=false] If true, skips expensive selector verification.
   * @returns {string[]} An array of selectors for shadow hosts, from the outermost to the innermost.
   */
  function getShadowDOMPath(element, skipVerification = false) {
    const path = [];
    let current = element;
    while (current && current.parentElement) {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        path.unshift(getSelector(root.host, skipVerification));
        current = root.host;
      } else {
        break;
      }
    }
    return path;
  }

  /**
   * Collects a comprehensive set of properties from an HTML element.
   * This includes its selector, dimensions, attributes, and computed styles.
   * @param {HTMLElement} element The element to inspect.
   * @param {boolean} [skipVerification=false] If true, skips expensive selector verification.
   * @returns {object | null} An object containing detailed information about the element, or null if the element is invalid.
   */
  function getElementInfo(element, skipVerification = false) {
    if (!element) return null;
    const computedStyle = window.getComputedStyle(element);
    const boundingBox = element.getBoundingClientRect();
    const info = {
      selector: getSelector(element, skipVerification),
      shadowDOMPath: getShadowDOMPath(element, skipVerification),
      tagName: element.tagName,
      className: (typeof element.className === 'string') ? element.className : (element.className.baseVal || ''),
      id: element.id || null,
      textContent: element.textContent ? element.textContent.trim().substring(0, 200) : null,
      // REDACT SENSITIVE DATA
      value: isSensitive(element) ? '[REDACTED]' : (element.value != null ? String(element.value).substring(0, 200) : null),
      href: element.href || null,
      // ADD SCROLL METADATA
      scrollX: window.scrollX,
      scrollY: window.scrollY,
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
      parentElement: element.parentElement ? getSelector(element.parentElement, skipVerification) : null,
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
      const isTargetSensitive = isSensitive(lastInputElement);
      const sequenceData = {
        type: 'inputSequence',
        relativeTime: eventSequence[0].relativeTime,
        element: getElementInfo(lastInputElement),
        events: eventSequence,
        finalValue: isTargetSensitive && lastInputElement.value ? '[REDACTED]' : lastInputElement.value,
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

    // Force save any pending typing before clicking
    flushInputEvents();

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
   * Handles focus events on the document.
   * Tracks input sequences and logs focus events if the logging level is sufficient.
   * @param {FocusEvent} e The focus event object.
   */
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
      const isTargetSensitive = isSensitive(lastInputElement);
      eventSequence.push({
        type: 'keydown',
        relativeTime: eventTime,
        key: isTargetSensitive ? '[REDACTED]' : e.key,
        code: isTargetSensitive ? '[REDACTED]' : e.code
      });
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
    const isTargetSensitive = isSensitive(lastInputElement);
    eventSequence.push({
      type: 'input',
      relativeTime: startTime ? Date.now() - startTime : 0,
      inputType: e.inputType,
      data: isTargetSensitive && e.data ? '[REDACTED]' : e.data,
      value: isTargetSensitive && e.target.value ? '[REDACTED]' : e.target.value
    });
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

    const isTargetSensitive = isSensitive(e.target);
    const safePastedText = isTargetSensitive && pastedText ? '[REDACTED]' : pastedText;

    if (e.target === lastInputElement) {
      eventSequence.push({ type: 'paste', relativeTime: eventTime, pastedText: safePastedText });
    } else {
      const pasteData = {
        type: 'paste',
        relativeTime: eventTime,
        element: getElementInfo(e.target),
        pastedText: safePastedText,
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

  /**
   * A MutationObserver to watch for changes to specific element attributes.
   * This is useful for capturing state changes that don't trigger other events,
   * such as a button becoming enabled or a class name changing.
   * @param {MutationRecord[]} mutations An array of mutation records provided by the observer.
   */
  const observer = new MutationObserver((mutations) => {
    // If Minimal (0) or Standard (1), do NOT record attribute changes.
    if (!isRecording || loggingLevel < 2) return;

    clearTimeout(attributeChangeTimeout);

    // 1. Element Cache: Avoid redundant layout calcs for the same element in this batch
    const elementCache = new Map();

    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes') {
        const attrName = mutation.attributeName;
        const newValue = mutation.target.getAttribute(attrName);

        if (mutation.oldValue !== newValue) {
          let elementInfo;

          // Check cache first
          if (elementCache.has(mutation.target)) {
            elementInfo = elementCache.get(mutation.target);
          } else {
            // 2. Optimization: Pass 'true' to skip expensive selector verification
            elementInfo = getElementInfo(mutation.target, true);
            elementCache.set(mutation.target, elementInfo);
          }

          const change = {
            element: elementInfo,
            attributeName: attrName,
            oldValue: mutation.oldValue,
            newValue: newValue,
          };

          // Use a timestamp from the first change in the batch for better timing accuracy
          if (attributeChangeBuffer.length === 0) {
            change.batchStartTime = Date.now();
          }

          attributeChangeBuffer.push(change);

          // 3. Buffer Cap: Flush immediately if buffer gets too big
          if (attributeChangeBuffer.length >= MAX_BATCH_SIZE) {
            flushAttributeBuffer();
          }
        }
      }
    });

    if (attributeChangeBuffer.length > 0) {
      attributeChangeTimeout = setTimeout(flushAttributeBuffer, 200);
    }
  });

  /**
   * Flushes the attribute change buffer to the background script.
   */
  function flushAttributeBuffer() {
    clearTimeout(attributeChangeTimeout);

    // Check if buffer is empty first. We do NOT check isRecording/loggingLevel here,
    // because if we have data in the buffer, it means it was valid when added
    // and should be saved even if recording has just stopped.
    if (attributeChangeBuffer.length === 0) {
      return;
    }

    const changesToSave = attributeChangeBuffer;
    attributeChangeBuffer = [];

    // Calculate relative time based on the first change in the batch
    const batchStartTime = changesToSave[0].batchStartTime || Date.now();
    const relativeTime = startTime ? batchStartTime - startTime : 0;

    // Clean up the temporary property from the first change object
    if (Object.hasOwn(changesToSave[0], 'batchStartTime')) {
      delete changesToSave[0].batchStartTime;
    }

    saveAction({
      type: 'batchAttributeChange',
      relativeTime: relativeTime,
      changes: changesToSave,
      url: window.location.href
    });
  }

  /**
   * Updates dynamic listeners (Observer, MouseOver) based on recording status
   * and logging level.
   * Optimizes performance by removing listeners when not needed.
   */
  function updateDynamicListeners() {
    // 1. Mutation Observer
    observer.disconnect();

    // Only connect if we are recording AND logging level is Detailed (2) or Verbose (3)
    if (isRecording && loggingLevel >= 2) {
      const observerConfig = {
        attributes: true,
        attributeOldValue: true,
        subtree: true
      };

      // For 'Detailed' level (2), use a performant whitelist filter for functional attributes.
      if (loggingLevel === 2) {
        observerConfig.attributeFilter = [
          'disabled', 'hidden', 'readonly', 'checked', 'selected',
          'aria-checked', 'aria-disabled', 'aria-expanded', 'aria-hidden',
          'aria-pressed', 'aria-selected', 'role', 'data-state', 'value'
        ];
      }

      observer.observe(document.body, observerConfig);
    }

    // 2. MouseOver Listener (Hover)
    document.removeEventListener('mouseover', handleMouseOver, true);

    // Only add if recording is active AND Logging Level is Standard (1) or higher
    if (isRecording && loggingLevel >= 1) {
      document.addEventListener('mouseover', handleMouseOver, true);
    }
  }

  // --- Hover Tracking (Debounced) ---
  let hoverTimeout;

  function handleMouseOver(e) {
    // Only record hovers if recording is active AND Logging Level is Standard (1) or higher
    if (!isRecording || loggingLevel < 1) return;

    clearTimeout(hoverTimeout);

    hoverTimeout = setTimeout(() => {
      // Double check state after the delay
      if (!isRecording) return;

      const hoverData = {
        type: 'hover',
        relativeTime: startTime ? Date.now() - startTime : 0,
        element: getElementInfo(e.target),
        url: window.location.href
      };
      saveAction(hoverData);
    }, HOVER_DEBOUNCE_MS); // threshold prevents recording accidental mouse movements
  }

  document.addEventListener('click', handleClick, true);
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('blur', handleBlur, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('paste', handlePaste, true);

  // Initialize dynamic listeners state
  updateDynamicListeners();

  /**
   * Listens for changes in chrome.storage to keep the content script's state
   * (isRecording, startTime) in sync with the rest of the extension.
   * @param {object} changes Object describing the changes.
   * @param {string} namespace The storage area ('local' or 'sync') that changed.
   */
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      let shouldUpdate = false;

      if (changes.isRecording) {
        isRecording = !!changes.isRecording.newValue;
        shouldUpdate = true;
      }

      if (changes.startTime) startTime = changes.startTime.newValue || null;

      if (changes.loggingLevel) {
        loggingLevel = parseLoggingLevel(changes.loggingLevel.newValue);
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        updateDynamicListeners();
      }
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
