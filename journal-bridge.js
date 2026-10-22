(() => {
  /* Hands the pending trade to the journal page.
   *
   * Contract with the journal site (unchanged):
   *   page <- { source: 'tradelog-exness-extension', type: 'import-trade', requestId, trade }
   *   page -> { source: 'tradelog-journal', type: 'import-result', requestId, ok }
   */
  const SOURCE_OUT = 'tradelog-exness-extension';
  const SOURCE_IN = 'tradelog-journal';
  const ACK_TIMEOUT = 6000;
  const MAX_ATTEMPTS = 3;

  const handled = new Set();
  const inFlight = new Set();

  const alive = () => {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch { return false; }
  };

  function ask(message) {
    return new Promise(resolve => {
      if (!alive()) return resolve(null);
      try {
        chrome.runtime.sendMessage(message, reply => {
          void chrome.runtime.lastError; // the worker may be restarting
          resolve(reply || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function tell(message) {
    if (!alive()) return;
    try { chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError); } catch { /* stale */ }
  }

  function post(trade, requestId) {
    return new Promise(resolve => {
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onResult);
        resolve(ok);
      };

      const onResult = event => {
        const message = event.data;
        if (event.source !== window) return;
        if (message?.source !== SOURCE_IN || message.type !== 'import-result') return;
        if (message.requestId !== requestId) return;
        finish(!!message.ok);
      };

      const timer = setTimeout(() => finish(false), ACK_TIMEOUT);
      window.addEventListener('message', onResult);
      // Target this origin only: the trade payload never leaks to embedded frames.
      window.postMessage({ source: SOURCE_OUT, type: 'import-trade', requestId, trade }, window.location.origin);
    });
  }

  async function deliver(trade) {
    if (!trade?.externalId) return;
    if (handled.has(trade.externalId) || inFlight.has(trade.externalId)) return;

    inFlight.add(trade.externalId);
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const requestId = `${trade.externalId}-${attempt}-${Date.now()}`;
        const ok = await post(trade, requestId);
        if (ok) {
          handled.add(trade.externalId);
          tell({ type: 'trade-imported' }); // clears the stored pending trade
          return;
        }
        if (!alive()) return;
        // The page may still be booting; back off and try again.
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    } finally {
      inFlight.delete(trade.externalId);
    }
  }

  async function pullPending() {
    const reply = await ask({ type: 'get-pending-trade' });
    if (reply?.trade) deliver(reply.trade);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'deliver-pending-trade') {
      pullPending().finally(() => sendResponse?.({ ok: true }));
      return true;
    }
    return false;
  });

  pullPending();

  // Coming back from another tab (or the bfcache) should not need a reload.
  window.addEventListener('pageshow', pullPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullPending();
  });
})();
