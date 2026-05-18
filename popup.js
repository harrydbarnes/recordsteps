/**
 * @fileoverview Popup UI for the Record Steps extension.
 * Keeps legacy JSON export intact while adding agent-friendly exports.
 */

let isRecording = false;
let isPaused = false;
let startTime = null;
let currentActions = [];
let currentSession = null;

function preferActions(actions, clicks) {
  return Array.isArray(actions) && actions.length > 0 ? actions : (clicks || actions || []);
}

const startBtn = document.getElementById('startBtn');
const newBtn = document.getElementById('newBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const status = document.getElementById('status');
const clickCount = document.getElementById('clickCount');
const durationEl = document.getElementById('duration');
const currentUrl = document.getElementById('currentUrl');
const lastAction = document.getElementById('lastAction');
const typeCounts = document.getElementById('typeCounts');
const storageWarning = document.getElementById('storageWarning');
const loggingLevelSelect = document.getElementById('loggingLevel');
const loggingDescription = document.getElementById('loggingDescription');
const exportFormat = document.getElementById('exportFormat');
const goalInput = document.getElementById('goalInput');
const redactTypedText = document.getElementById('redactTypedText');
const redactPageText = document.getElementById('redactPageText');
const includeDebugAttributes = document.getElementById('includeDebugAttributes');

const LOGGING_DESCRIPTIONS = {
  [LOGGING_LEVELS.MINIMAL]: 'Records clicks, typing, and navigation. Best for clean test scripts.',
  [LOGGING_LEVELS.STANDARD]: 'Adds focus events. Useful for tracking field entry order.',
  [LOGGING_LEVELS.DETAILED]: 'Adds functional state changes (disabled, checked, hidden). Good for logic debugging.',
  [LOGGING_LEVELS.VERBOSE]: 'Records ALL attribute changes (including styles/classes). Use for deep UI debugging.'
};

document.addEventListener('DOMContentLoaded', loadState);

loggingLevelSelect.addEventListener('change', () => {
  const level = parseInt(loggingLevelSelect.value, 10);
  chrome.storage.local.set({ loggingLevel: level });
  updateDescription(level);
});

exportFormat.addEventListener('change', () => {
  chrome.storage.local.set({ exportFormat: exportFormat.value });
});

goalInput.addEventListener('input', () => {
  chrome.storage.local.set({ recordingGoal: goalInput.value });
});

[redactTypedText, redactPageText, includeDebugAttributes].forEach(input => {
  input.addEventListener('change', savePrivacyOptions);
});

startBtn.addEventListener('click', () => sendRecordingMessage('startRecording'));
newBtn.addEventListener('click', () => {
  if (currentActions.length > 0 && !confirm('Start a new recording and clear current actions?')) return;
  sendRecordingMessage('startNewRecording');
});
pauseBtn.addEventListener('click', () => sendRecordingMessage('pauseRecording'));
resumeBtn.addEventListener('click', () => sendRecordingMessage('resumeRecording'));
stopBtn.addEventListener('click', () => sendRecordingMessage('stopRecording'));

downloadBtn.addEventListener('click', () => {
  const exportData = buildSelectedExport();
  if (!exportData) return;
  const blob = new Blob([exportData.content], { type: exportData.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportData.filename;
  a.click();
  URL.revokeObjectURL(url);
});

copyBtn.addEventListener('click', async () => {
  const exportData = buildSelectedExport();
  if (!exportData) return;
  try {
    await navigator.clipboard.writeText(exportData.content);
    copyBtn.textContent = 'Copied';
    setTimeout(() => copyBtn.textContent = 'Copy Export', 1200);
  } catch (e) {
    alert('Could not copy export to clipboard.');
  }
});

clearBtn.addEventListener('click', () => {
  if (confirm('Clear all recorded actions?')) {
    chrome.storage.local.set({ clicks: [], actions: [], storageWarning: null }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error clearing data:', chrome.runtime.lastError);
      } else {
        currentActions = [];
        updateStats();
      }
    });
  }
});

function loadState() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    console.error('Chrome storage API not available');
    updateUI();
    updateStats();
    return;
  }

  chrome.storage.local.get([
    'isRecording',
    'isPaused',
    'startTime',
    'clicks',
    'actions',
    'loggingLevel',
    'recordingSession',
    'recordingGoal',
    'exportFormat',
    'privacyOptions',
    'storageWarning'
  ], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading state:', chrome.runtime.lastError);
      return;
    }
    isRecording = result.isRecording || false;
    isPaused = result.isPaused || false;
    startTime = result.startTime || null;
    currentActions = preferActions(result.actions, result.clicks);
    currentSession = result.recordingSession || null;

    const savedLevel = result.loggingLevel ?? LOGGING_LEVELS.MINIMAL;
    loggingLevelSelect.value = savedLevel;
    updateDescription(savedLevel);
    goalInput.value = result.recordingGoal || '';
    exportFormat.value = result.exportFormat || 'legacy';

    const privacy = {
      redactTypedText: true,
      redactPageText: true,
      includeDebugAttributes: false,
      ...(result.privacyOptions || {})
    };
    redactTypedText.checked = privacy.redactTypedText;
    redactPageText.checked = privacy.redactPageText;
    includeDebugAttributes.checked = privacy.includeDebugAttributes;
    updateStorageWarning(result.storageWarning);

    updateUI();
    updateStats();
  });
}

function sendRecordingMessage(action) {
  chrome.runtime.sendMessage({ action }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      console.error(`Failed to ${action}:`, chrome.runtime.lastError?.message || response?.error);
      loadState();
    }
  });
}

function savePrivacyOptions() {
  chrome.storage.local.set({
    privacyOptions: {
      redactTypedText: redactTypedText.checked,
      redactPageText: redactPageText.checked,
      includeDebugAttributes: includeDebugAttributes.checked
    }
  });
}

function updateDescription(level) {
  loggingDescription.textContent = LOGGING_DESCRIPTIONS[level] || LOGGING_DESCRIPTIONS[LOGGING_LEVELS.MINIMAL];
}

function updateUI() {
  if (isRecording && isPaused) {
    status.textContent = 'Paused';
    status.className = 'paused';
  } else if (isRecording) {
    status.textContent = 'Recording...';
    status.className = 'recording';
  } else {
    status.textContent = 'Ready to Record';
    status.className = 'idle';
  }

  startBtn.disabled = isRecording;
  newBtn.disabled = false;
  pauseBtn.disabled = !isRecording || isPaused;
  resumeBtn.disabled = !isRecording || !isPaused;
  stopBtn.disabled = !isRecording;
  loggingLevelSelect.disabled = isRecording;
}

function updateStats() {
  const flattened = flattenActions(currentActions);
  clickCount.textContent = `Actions recorded: ${flattened.length}`;
  updateDuration();

  const last = flattened[flattened.length - 1];
  lastAction.textContent = `Last action: ${last ? describeAction(last) : '-'}`;
  currentUrl.textContent = `URL: ${last?.url || currentSession?.sourceUrl || '-'}`;

  const counts = flattened.reduce((acc, action) => {
    acc[action.type] = (acc[action.type] || 0) + 1;
    return acc;
  }, {});
  typeCounts.textContent = `Types: ${Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(', ') || '-'}`;
}

function updateDuration() {
  const flattened = flattenActions(currentActions);
  const durationMs = isRecording && startTime
    ? Date.now() - startTime
    : (currentSession?.durationMs || flattened[flattened.length - 1]?.relativeTime || 0);
  durationEl.textContent = `Duration: ${Math.round(durationMs / 1000)}s`;
}

function updateStorageWarning(message) {
  storageWarning.hidden = !message;
  storageWarning.textContent = message || '';
}

function flattenActions(actions) {
  return (actions || []).flatMap(action => {
    if (action.type === 'batchAttributeChange') {
      return action.changes.map(change => ({
        type: 'attributeChange',
        relativeTime: action.relativeTime,
        element: change.element,
        attributeName: change.attributeName,
        oldValue: change.oldValue,
        newValue: change.newValue,
        url: action.url,
        frameId: action.frameId,
        tabId: action.tabId,
        frameUrl: action.frameUrl,
        sessionId: action.sessionId
      }));
    }
    return action;
  });
}

function buildLegacyExport(actions = currentActions) {
  const flattened = flattenActions(actions);
  return {
    recording: flattened,
    totalActions: flattened.length,
    duration: flattened.length > 0 ? flattened[flattened.length - 1].relativeTime : 0,
    recordedAt: new Date().toISOString()
  };
}

function buildAutomationExport() {
  const legacy = buildLegacyExport();
  const session = {
    sessionId: currentSession?.sessionId || `session-${Date.now()}`,
    startedAt: currentSession?.startedAt || null,
    endedAt: currentSession?.endedAt || (isRecording ? null : new Date().toISOString()),
    durationMs: currentSession?.durationMs || legacy.duration,
    sourceUrl: currentSession?.sourceUrl || legacy.recording[0]?.url || null,
    browser: currentSession?.browser || 'Chrome',
    extensionVersion: currentSession?.extensionVersion || chrome.runtime.getManifest().version,
    goal: goalInput.value.trim() || null
  };

  const steps = legacy.recording.map((action, index) => normalizeStep(action, index + 1));
  return {
    schemaVersion: 1,
    session,
    steps,
    legacy,
    debug: {
      totalRawActions: currentActions.length,
      generatedAt: new Date().toISOString()
    }
  };
}

function normalizeStep(action, id) {
  const target = action.element ? {
    selector: action.element.selector,
    automationSelector: action.element.automationSelector || action.element.selector,
    selectorCandidates: action.element.selectorCandidates || [],
    selectorConfidence: action.element.selectorConfidence ?? null,
    selectorReason: action.element.selectorReason || null,
    shadowDOMPath: action.element.shadowDOMPath || [],
    tagName: action.element.tagName || null,
    text: action.element.textContent || null,
    role: action.element.role || null,
    ariaLabel: action.element.ariaLabel || null
  } : null;

  return {
    id,
    type: action.type,
    timeMs: action.relativeTime || 0,
    url: action.url || action.frameUrl || null,
    frame: {
      frameId: action.frameId ?? null,
      tabId: action.tabId ?? null,
      frameUrl: action.frameUrl || null
    },
    target,
    input: buildInputPayload(action),
    waitHint: action.waitHint || inferWaitHint(action),
    notes: describeAction(action),
    confidence: target?.selectorConfidence ?? null
  };
}

function buildInputPayload(action) {
  if (action.type === 'inputSequence') {
    return {
      finalValue: action.finalValue,
      events: action.events
    };
  }
  if (['keyDown', 'paste', 'change'].includes(action.type)) {
    return {
      key: action.key,
      code: action.code,
      value: action.value,
      pastedText: action.pastedText,
      checked: action.checked
    };
  }
  if (action.type === 'scroll') {
    return {
      scrollX: action.scrollX || 0,
      scrollY: action.scrollY || 0
    };
  }
  return null;
}

function inferWaitHint(action) {
  if (action.type === 'pageLoad') return 'Wait for the page to finish loading.';
  if (action.type === 'click' || action.type === 'submit') return 'If the UI changes, wait for the next visible state before continuing.';
  if (action.type === 'attributeChange') return `Wait for ${action.attributeName} to become ${JSON.stringify(action.newValue)}.`;
  return null;
}

function describeAction(action) {
  const selector = action.element?.selector || action.url || '';
  if (action.type === 'inputSequence') return `type into ${selector}`;
  if (action.type === 'keyDown') return `press ${action.key || action.code || 'key'} on ${selector}`;
  if (action.type === 'pageLoad') return `open ${action.url}`;
  if (action.type === 'attributeChange') return `observe ${action.attributeName} change on ${selector}`;
  if (action.type === 'scroll') return `scroll to ${action.scrollX || 0}, ${action.scrollY || 0}`;
  return `${action.type} ${selector}`.trim();
}

function buildMarkdownExport() {
  const automation = buildAutomationExport();
  const lines = [
    '# Browser Automation Recording',
    '',
    `Goal: ${automation.session.goal || 'Not provided'}`,
    `Source URL: ${automation.session.sourceUrl || 'Unknown'}`,
    `Duration: ${Math.round((automation.session.durationMs || 0) / 1000)}s`,
    '',
    '## Steps'
  ];

  automation.steps.forEach(step => {
    const target = step.target?.selector ? ` Target: \`${step.target.selector}\`.` : '';
    const confidence = step.confidence != null ? ` Confidence: ${Math.round(step.confidence * 100)}%.` : '';
    lines.push(`${step.id}. ${step.notes}.${target}${confidence}`);
    if (step.waitHint) lines.push(`   Wait hint: ${step.waitHint}`);
  });

  lines.push('', '## Raw Automation JSON', '', '```json', JSON.stringify(automation, null, 2), '```');
  return lines.join('\n');
}

function buildPlaywrightExport() {
  const automation = buildAutomationExport();
  const lines = [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('recorded workflow', async ({ page }) => {"
  ];

  const firstUrl = automation.session.sourceUrl || automation.steps.find(step => step.url)?.url;
  if (firstUrl) lines.push(`  await page.goto(${JSON.stringify(firstUrl)});`);

  automation.steps.forEach(step => {
    if (step.type === 'pageLoad' && step.url && step.url !== firstUrl) {
      lines.push(`  await page.goto(${JSON.stringify(step.url)});`);
      return;
    }

    const locator = playwrightLocator(step.target);
    if (step.type === 'click' && locator) lines.push(`  await ${locator}.click();`);
    if (step.type === 'dblclick' && locator) lines.push(`  await ${locator}.dblclick();`);
    if (step.type === 'contextmenu' && locator) lines.push(`  await ${locator}.click({ button: 'right' });`);
    if (step.type === 'inputSequence' && locator && step.input?.finalValue !== '[REDACTED]') {
      lines.push(`  await ${locator}.fill(${JSON.stringify(step.input.finalValue || '')});`);
    }
    if (step.type === 'keyDown' && step.input?.key) lines.push(`  await page.keyboard.press(${JSON.stringify(step.input.key)});`);
    if (step.type === 'change' && locator && step.input?.value != null && step.input.value !== '[REDACTED]') {
      lines.push(`  await ${locator}.fill(${JSON.stringify(String(step.input.value))});`);
    }
    if (step.type === 'scroll') lines.push(`  await page.evaluate(() => window.scrollTo(${step.input?.scrollX || 0}, ${step.input?.scrollY || 0}));`);
    if (step.waitHint) lines.push(`  // ${step.waitHint}`);
  });

  lines.push('});', '');
  return lines.join('\n');
}

function playwrightLocator(target) {
  if (!target) return null;
  const roleCandidate = (target.selectorCandidates || []).find(candidate => candidate.type === 'role');
  if (roleCandidate) {
    const match = roleCandidate.selector.match(/^role=([^;]+); name=(.*)$/);
    if (match) return `page.getByRole(${JSON.stringify(match[1])}, { name: ${JSON.stringify(match[2])} })`;
  }
  if (target.selector) return `page.locator(${JSON.stringify(target.selector)})`;
  return null;
}

function buildSelectedExport() {
  if (currentActions.length === 0) {
    alert('No actions recorded yet!');
    return null;
  }

  const format = exportFormat.value;
  const timestamp = Date.now();
  if (format === 'automation') {
    return {
      content: JSON.stringify(buildAutomationExport(), null, 2),
      filename: `record-steps-automation-${timestamp}.json`,
      mimeType: 'application/json'
    };
  }
  if (format === 'markdown') {
    return {
      content: buildMarkdownExport(),
      filename: `record-steps-prompt-${timestamp}.md`,
      mimeType: 'text/markdown'
    };
  }
  if (format === 'playwright') {
    return {
      content: buildPlaywrightExport(),
      filename: `record-steps-playwright-${timestamp}.ts`,
      mimeType: 'text/plain'
    };
  }
  return {
    content: JSON.stringify(buildLegacyExport(), null, 2),
    filename: `click-recording-${timestamp}.json`,
    mimeType: 'application/json'
  };
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.clicks || changes.actions) {
      currentActions = preferActions(changes.actions?.newValue, changes.clicks?.newValue);
      updateStats();
    }
    if (changes.isRecording) isRecording = changes.isRecording.newValue;
    if (changes.isPaused) isPaused = changes.isPaused.newValue;
    if (changes.startTime) startTime = changes.startTime.newValue || null;
    if (changes.recordingSession) currentSession = changes.recordingSession.newValue || null;
    if (changes.storageWarning) updateStorageWarning(changes.storageWarning.newValue);
    updateUI();
  });
}

setInterval(() => {
  if (isRecording) updateDuration();
}, 1000);
