(async () => {
  const message = document.getElementById('message');
  const status = document.getElementById('status');
  const testButton = document.getElementById('test');

  const set = (text, tone) => { message.textContent = text; message.className = tone || ''; };
  const note = html => { status.innerHTML = html; };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const url = tab?.url || '';

  const platform = /^https:\/\/(?:[^/]+\.)?exness\.com\//i.test(url) ? 'Exness'
    : /^https:\/\/(?:[^/]+\.)?xm\.com\//i.test(url) ? 'XM'
      : /^https:\/\/(?:[^/]+\.)?tradingview\.com\//i.test(url) ? 'TradingView'
        : '';

  const capture = await chrome.runtime.sendMessage({ type: 'capture-status' }).catch(() => ({}));
  const { pendingExnessTrade } = await chrome.storage.local.get('pendingExnessTrade').catch(() => ({}));

  if (!capture || capture.hasAllUrls !== true) {
    set('Screenshot access is not active.', 'bad');
    note('Open <code>chrome://extensions</code>, press <b>Reload</b> on TradeLog Pro, then refresh the trading tab. '
      + 'This build captures screenshots on its own — no toolbar click is needed.');
  } else if (!platform) {
    set('Screenshot access is ready.', 'ok');
    note('Open your Exness trading terminal, then use <b>＋ Log trade</b> next to the chart.');
  } else {
    set(`Screenshot access is ready on ${platform}.`, 'ok');
    note('Click <b>＋ Log trade</b> at the bottom-right, or double-click the <b>Long Position</b> / <b>Short Position</b> tool. '
      + 'The panel opens instantly — type or paste the values, drag the panel anywhere, and retake the screenshot if you need to.');
  }

  if (pendingExnessTrade) {
    status.innerHTML += '<br><br><span class="warn">One trade is still waiting for the journal.</span> '
      + 'Open or reload the TradeLog tab once and it will import.';
  }

  testButton.onclick = async () => {
    set('Testing screenshot…', 'warn');
    const result = await chrome.runtime.sendMessage({ type: 'capture-visible-tab' }).catch(error => ({ error: error.message }));
    if (result?.screenshot) {
      set('Screenshot works.', 'ok');
      note(`Captured ${Math.round(result.screenshot.length / 1024)} KB from this tab. You can log a trade now.`);
    } else {
      set('Screenshot failed.', 'bad');
      note(String(result?.error || 'Chrome returned no image.'));
    }
  };
})();
