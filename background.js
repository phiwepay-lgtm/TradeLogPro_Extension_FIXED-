/* The journal host, most preferred first. Keep this list in sync with the
 * journal host_permissions and content-script matches in manifest.json —
 * tests/config.test.js fails if they drift apart.
 *
 * Both older hosts (trading-journa.vercel.app and
 * indexhtml-glt-main-royak-kings-circle.vercel.app) are deleted deployments
 * that now return DEPLOYMENT_NOT_FOUND, so they are gone from this list. */
const JOURNAL_URLS = [
  'https://indexhtml-olive-delta.vercel.app/'
];

/** Map Chrome's raw capture errors onto something actionable. */
function explainCaptureError(raw, extra = {}) {
  const why = String(raw || 'unknown error');

  if (/all_urls|activeTab/i.test(why)) {
    return {
      code: 'permission',
      error: 'Screenshot blocked: Chrome requires "<all_urls>" access. Open chrome://extensions, ' +
        'press Reload on TradeLog Pro, then reopen this form. No toolbar click is needed.'
    };
  }
  if (/active window|not in the active|no active web contents/i.test(why)) {
    return {
      code: 'inactive-tab',
      error: 'Screenshot blocked: the Exness tab is not the active tab of its window. ' +
        'Click the Exness tab once, then reopen this form.'
    };
  }
  if (/chrome:\/\/|cannot be scripted|restricted/i.test(why)) {
    return { code: 'restricted', error: `Screenshot blocked: Chrome protects this page (${why}).` };
  }
  if (/MAX_CAPTURE_VISIBLE_TAB|quota|too many/i.test(why)) {
    return { code: 'throttled', error: 'Chrome throttled screenshots. Wait a moment and try again.' };
  }
  return {
    code: 'unknown',
    error: `Screenshot failed (${why})${extra.hasAllUrls === false ? ' — the extension is missing <all_urls> access; reload it at chrome://extensions.' : '.'}`
  };
}


async function captureVisibleTab(sender) {
  const tab = sender?.tab;

  if (tab?.id) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (current && current.active === false) {
      return explainCaptureError('not in the active window');
    }
  }

  const windowId = typeof tab?.windowId === 'number' ? tab.windowId : chrome.windows.WINDOW_ID_CURRENT;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 });
    return { screenshot: dataUrl };
  } catch (error) {
    // One retry: the compositor occasionally is not ready right after paint.
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 });
      return { screenshot: dataUrl };
    } catch (retryError) {
      let hasAllUrls = null;
      try {
        hasAllUrls = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      } catch { /* permissions API unavailable */ }
      return explainCaptureError(retryError?.message || error?.message, { hasAllUrls });
    }
  }
}

async function deliverPendingTrade() {
  const { pendingExnessTrade } = await chrome.storage.local.get('pendingExnessTrade');
  if (!pendingExnessTrade) return { ok: true, delivered: false, reason: 'nothing pending' };

  const tabs = await chrome.tabs.query({ url: JOURNAL_URLS.map(url => url + '*') });
  const existing = tabs[0];

  if (!existing?.id) {
    await chrome.tabs.create({ url: JOURNAL_URLS[0] });
    return { ok: true, opened: true, delivered: false };
  }

  try {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === 'number') await chrome.windows.update(existing.windowId, { focused: true });
  } catch { /* the journal tab may be in a window we cannot focus */ }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await chrome.tabs.sendMessage(existing.id, { type: 'deliver-pending-trade' });
      return { ok: true, opened: false, delivered: true };
    } catch {
      // The bridge is not listening yet (tab still loading, or the extension
      // was reloaded after the page opened). Wait, then try again.
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  return {
    ok: true,
    opened: false,
    delivered: false,
    reason: 'The journal tab did not answer. Reload that tab once so the bridge picks up the saved trade.'
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'capture-visible-tab') {
    captureVisibleTab(sender).then(sendResponse).catch(error => sendResponse({ error: String(error?.message || error), code: 'unknown' }));
    return true;
  }


  if (message?.type === 'open-trade-panel') {
    // Raised by a child frame (the chart tool) and answered by the top frame,
    // which is the only document allowed to render the review panel.
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: 'open-trade-panel', direction: message.direction || '' },
        { frameId: 0 },
        () => void chrome.runtime.lastError
      );
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'capture-status') {
    (async () => {
      const origins = { origins: ['<all_urls>'] };
      const hasAllUrls = await chrome.permissions.contains(origins).catch(() => false);
      sendResponse({ hasAllUrls });
    })();
    return true;
  }

  if (message?.type === 'save-trade-to-journal') {
    (async () => {
      await chrome.storage.local.set({ pendingExnessTrade: message.trade });
      const result = await deliverPendingTrade();
      sendResponse({ ...result, opened: !!result.opened });
    })().catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'get-pending-trade') {
    chrome.storage.local.get('pendingExnessTrade', result => sendResponse({ trade: result.pendingExnessTrade || null }));
    return true;
  }

  if (message?.type === 'trade-imported') {
    chrome.storage.local.remove('pendingExnessTrade', () => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
