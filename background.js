const JOURNAL_URLS = [
  'https://trading-journa.vercel.app/',
  'https://indexhtml-glt-main-royak-kings-circle.vercel.app/'
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'capture-visible-tab') {
    const windowId = typeof sender.tab?.windowId === 'number'
      ? sender.tab.windowId
      : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 }, dataUrl => {
      const failure = chrome.runtime.lastError;
      if (failure) {
        const why = String(failure.message || failure);
        const permissionHint = /permission|activeTab|not be permitted/i.test(why)
          ? ' Fix: open chrome://extensions > TradeLog Pro > Details > Site access, allow the Exness site (or "On all sites"), reload the extension, and retry. Clicking the toolbar icon once on the Exness tab also grants temporary access.'
          : ' Keep the Exness tab visible in its window (not minimized) and retry.';
        sendResponse({ error: `Screenshot blocked by Chrome (${why}).${permissionHint}` });
      } else {
        sendResponse({ screenshot: dataUrl });
      }
    });
    return true;
  }

  if (message?.type === 'save-trade-to-journal') {
    (async () => {
      await chrome.storage.local.set({ pendingExnessTrade: message.trade });
      const tabs = await chrome.tabs.query({ url: JOURNAL_URLS.map(url => url + '*') });
      let tab = tabs[0];
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        chrome.tabs.sendMessage(tab.id, { type: 'deliver-pending-trade' }, () => void chrome.runtime.lastError);
      } else {
        tab = await chrome.tabs.create({ url: JOURNAL_URLS[0] });
      }
      sendResponse({ ok: true, opened: !tabs.length });
    })().catch(error => sendResponse({ error: error.message }));
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
});