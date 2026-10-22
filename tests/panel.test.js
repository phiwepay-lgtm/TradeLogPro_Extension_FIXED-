/* Loads the real content scripts in a DOM with a mocked chrome API and checks
 * that the review panel fills itself from an Exness-style order ticket.
 * Skipped when jsdom is not installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch { /* optional */ }
const domTest = JSDOM ? test : test.skip;

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

/**
 * Mock worker. `otherFrames` simulates the Exness terminal's iframes: the
 * background answers scan-tab with what chrome.scripting would collect.
 */
function fakeChrome(otherFrames = []) {
  const store = {};
  return {
    __store: store,
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      onMessage: { addListener() {} },
      sendMessage: async message => {
        if (message.type === 'capture-visible-tab') return { screenshot: 'data:image/jpeg;base64,AAAA' };
        if (message.type === 'scan-tab') return { frames: otherFrames };
        if (message.type === 'apply-lot') { store.__lotApplied = message.value; return { applied: 1 }; }
        if (message.type === 'save-trade-to-journal') { store.__saved = message.trade; return { ok: true, delivered: true }; }
        return { ok: true };
      }
    },
    storage: {
      local: {
        get: async key => (key in store ? { [key]: store[key] } : {}),
        set: async patch => Object.assign(store, patch),
        remove: async () => {}
      }
    }
  };
}

async function openPanel(html, { title = 'Exness Terminal', otherFrames = [] } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://my.exness.com/pa/trading/accounts' });
  const { window } = dom;
  window.chrome = fakeChrome(otherFrames);
  // jsdom does not decode images; fail fast so the panel does not wait on the
  // compression fallback timer.
  window.Image = class { set src(_value) { setTimeout(() => this.onerror && this.onerror(), 0); } };
  window.document.title = title;
  window.eval(read('trade-detect.js'));
  window.eval(read('exness.js'));

  const host = window.document.getElementById('tlx-shadow-host');
  assert.ok(host, 'shadow host mounted in the top frame');
  const shadow = host.shadowRoot;
  shadow.querySelector('.tlx-launch').click();

  const deadline = Date.now() + 3000;
  while (!shadow.querySelector('.tlx-overlay') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const overlay = shadow.querySelector('.tlx-overlay');
  assert.ok(overlay, 'review panel opened');
  return { window, overlay, shadow };
}

const field = (overlay, id) => overlay.querySelector('#' + id);

domTest('the panel is rendered in a shadow root, not the page DOM', async () => {
  const { window, overlay } = await openPanel(`<body></body>`);
  assert.equal(window.document.querySelector('.tlx-overlay'), null, 'not in the page DOM');
  assert.ok(overlay.getRootNode().host.id === 'tlx-shadow-host', 'rooted in the shadow host');
  assert.equal(window.document.getElementById('tlx-lots'), null, 'page cannot see the fields');
});

domTest('the panel fills itself from a labelled order ticket', async () => {
  const { overlay } = await openPanel(`<body>
    <div class="ticket">
      <label for="vol">Volume (lots)</label><input id="vol" value="0.10">
      <label for="entry">Entry price</label><input id="entry" value="1.0850">
      <label for="sl">Stop Loss</label><input id="sl" value="1.0830">
      <label for="tp">Take Profit</label><input id="tp" value="1.0910">
    </div>
    <div class="acct"><label for="bal">Account balance</label><input id="bal" value="5,000.00"></div>
    <div class="risk"><label for="rp">Risk per trade (%)</label><input id="rp" value="1"></div>
  </body>`, { title: 'EUR/USD · Exness Terminal' });

  assert.equal(Number(field(overlay, 'tlx-lots').value), 0.1);
  assert.equal(Number(field(overlay, 'tlx-entry').value), 1.085);
  assert.equal(Number(field(overlay, 'tlx-sl').value), 1.083);
  assert.equal(Number(field(overlay, 'tlx-tp').value), 1.091);
  assert.equal(Number(field(overlay, 'tlx-balance').value), 5000);
  assert.equal(Number(field(overlay, 'tlx-risk-pct').value), 1);

  // EUR/USD contract value is known, so sizing works with no manual entry:
  // $50 risk / (0.0020 * 100,000) = 0.25 lots.
  assert.equal(Number(field(overlay, 'tlx-point-value').value), 100000);
  assert.equal(field(overlay, 'tlx-recommended-lot').textContent, '0.25');
  assert.match(overlay.querySelector('#tlx-detected').textContent, /Volume/);
});

domTest('a ticket living in another frame is still detected', async () => {
  // The chart is in this document; the order ticket is in an iframe the worker
  // reached with chrome.scripting.
  const ticketFrame = {
    url: 'https://my.exness.com/widgets/order-ticket',
    scanned: 6,
    symbol: 'XAU/USD',
    direction: 'buy',
    textAmount: null,
    empty: [],
    fields: {
      lots: [{ value: 0.1, raw: '0.10', label: 'Volume', source: 'label', roles: ['lots'] }],
      entry: [{ value: 2400, raw: '2400', label: 'Entry price', source: 'label', roles: ['entry'] }],
      sl: [{ value: 2395, raw: '2395', label: 'Stop Loss', source: 'label', roles: ['sl'] }],
      tp: [{ value: 2412, raw: '2412', label: 'Take Profit', source: 'label', roles: ['tp'] }],
      balance: [{ value: 10000, raw: '10,000', label: 'Account balance', source: 'label', roles: ['balance'] }],
      riskPct: [{ value: 1, raw: '1', label: 'Risk %', source: 'label', roles: ['riskPct'] }],
      amount: [], price: []
    }
  };

  const { overlay } = await openPanel(`<body><div id="chart">chart only</div></body>`, { otherFrames: [ticketFrame] });

  assert.equal(Number(field(overlay, 'tlx-lots').value), 0.1);
  assert.equal(Number(field(overlay, 'tlx-entry').value), 2400);
  assert.equal(field(overlay, 'tlx-symbol').value, 'XAU/USD');
  assert.match(field(overlay, 'tlx-detected').textContent, /across 2 frames/);

  // Gold: $100 risk / ($5 stop * $100 per 1.0) = 0.2 lots.
  assert.equal(field(overlay, 'tlx-recommended-lot').textContent, '0.2');
});

domTest('unlabelled controls are reported, never guessed', async () => {
  const { overlay } = await openPanel(`<body>
    <div><input value="1.0850"><input value="0.10"></div>
  </body>`);

  assert.equal(field(overlay, 'tlx-lots').value, '');
  assert.equal(field(overlay, 'tlx-entry').value, '');
  const text = overlay.querySelector('#tlx-detected').textContent;
  assert.match(text, /none are labelled/i);
  assert.match(text, /2 controls/);
});

domTest('a chart-only page tells the user to open the order tool', async () => {
  // This is the "Scanned: 0 controls" case from the field report.
  const { overlay } = await openPanel(`<body><div id="chart">chart only</div></body>`);

  const text = overlay.querySelector('#tlx-detected').textContent;
  assert.match(text, /No trade panel found/i);
  assert.match(text, /Open the Long Position or Short Position tool/i);
});

domTest('sending blocks when the risk engine cannot size the trade', async () => {
  const { overlay } = await openPanel(`<body>
    <label for="vol">Volume</label><input id="vol" value="0.10">
    <label for="entry">Entry</label><input id="entry" value="1.0850">
    <label for="sl">SL</label><input id="sl" value="1.0830">
    <label for="tp">TP</label><input id="tp" value="1.0910">
  </body>`, { title: 'XAU/USD · Exness' });

  overlay.querySelector('.tlx-save').click();
  await new Promise(resolve => setTimeout(resolve, 50));

  const error = overlay.querySelector('#tlx-form-error').textContent;
  assert.match(error, /Risk size cannot be verified/);
  assert.match(error, /balance/i);
  assert.ok(overlay.isConnected, 'panel stays open');
});

domTest('changing the instrument re-derives the contract value', async () => {
  const { overlay, window } = await openPanel(`<body>
    <label for="vol">Volume</label><input id="vol" value="0.10">
    <label for="entry">Entry</label><input id="entry" value="1.0850">
    <label for="sl">SL</label><input id="sl" value="1.0830">
    <label for="tp">TP</label><input id="tp" value="1.0910">
  </body>`, { title: 'EUR/USD · Exness' });

  assert.equal(Number(field(overlay, 'tlx-point-value').value), 100000);

  const symbolInput = field(overlay, 'tlx-symbol');
  symbolInput.value = 'XAU/USD';
  symbolInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(Number(field(overlay, 'tlx-point-value').value), 100);
  assert.match(overlay.querySelector('#tlx-pv-badge').textContent, /assumed/i);
});

domTest('a fully reviewed trade is handed to the background worker', async () => {
  const { overlay, window } = await openPanel(`<body>
    <label for="vol">Volume</label><input id="vol" value="0.10">
    <label for="entry">Entry</label><input id="entry" value="1.0850">
    <label for="sl">SL</label><input id="sl" value="1.0830">
    <label for="tp">TP</label><input id="tp" value="1.0910">
    <label for="bal">Account balance</label><input id="bal" value="5000">
    <label for="rp">Risk %</label><input id="rp" value="1">
  </body>`, { title: 'EUR/USD · Exness' });

  const choose = (id, value) => {
    const el = field(overlay, id);
    el.value = value;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  choose('tlx-exec', 'VHB + Engulf Trigger');
  choose('tlx-bias', 'Continuation');
  choose('tlx-mgmt', 'Full TP');
  choose('tlx-session', 'london');
  choose('tlx-emotion', '😎 Confident');
  choose('tlx-outcome', 'win');
  choose('tlx-type', 'BT 0.382');

  overlay.querySelector('.tlx-save').click();
  await new Promise(resolve => setTimeout(resolve, 80));

  const saved = window.chrome.__store.__saved;
  assert.ok(saved, 'trade posted to the worker');
  assert.equal(saved.symbol, 'EUR/USD');
  assert.equal(saved.dir, 'buy');
  assert.equal(saved.lots, 0.1);
  assert.equal(saved.entry, 1.085);
  assert.equal(saved.sl, 1.083);
  assert.equal(saved.tp, 1.091);
  assert.equal(saved.pointValue, 100000);
  assert.equal(saved.riskBudget, 50);
  assert.ok(saved.screenshot.startsWith('data:image'));
  assert.match(saved.externalId, /\w+/);
  assert.equal(overlay.isConnected, false, 'panel closed');
});

domTest('"Use recommended lot" asks the worker to apply it in every frame', async () => {
  const { overlay, window } = await openPanel(`<body>
    <label for="vol">Volume</label><input id="vol" value="1.00">
    <label for="entry">Entry</label><input id="entry" value="1.0850">
    <label for="sl">SL</label><input id="sl" value="1.0830">
    <label for="tp">TP</label><input id="tp" value="1.0910">
    <label for="bal">Account balance</label><input id="bal" value="5000">
    <label for="rp">Risk %</label><input id="rp" value="1">
  </body>`, { title: 'EUR/USD · Exness' });

  overlay.querySelector('.tlx-apply').click();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(window.chrome.__store.__lotApplied, 0.25);
  assert.equal(field(overlay, 'tlx-lots').value, '0.25');
});
