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

function fakeChrome() {
  const store = {};
  return {
    __store: store,
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: async message => {
        if (message.type === 'capture-visible-tab') return { screenshot: 'data:image/jpeg;base64,AAAA' };
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

async function openPanel(html, { title = 'Exness Terminal' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://my.exness.com/pa/trading/accounts' });
  const { window } = dom;
  window.chrome = fakeChrome();
  // jsdom does not decode images; fail fast so the panel does not wait on the
  // compression fallback timer.
  window.Image = class { set src(_value) { setTimeout(() => this.onerror && this.onerror(), 0); } };
  window.document.title = title;
  window.eval(read('trade-detect.js'));
  window.eval(read('exness.js'));

  window.document.getElementById('tlx-launch').click();

  const deadline = Date.now() + 3000;
  while (!window.document.getElementById('tlx-overlay') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const overlay = window.document.getElementById('tlx-overlay');
  assert.ok(overlay, 'review panel opened');
  return { window, overlay };
}

const field = (overlay, id) => overlay.querySelector('#' + id);

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

domTest('a ticket without labels reports nothing instead of inventing values', async () => {
  const { overlay } = await openPanel(`<body>
    <div><input value="1.0850"><input value="0.10"></div>
  </body>`);

  assert.equal(field(overlay, 'tlx-lots').value, '');
  assert.equal(field(overlay, 'tlx-entry').value, '');
  assert.match(overlay.querySelector('#tlx-detected').textContent, /nothing labelled/i);
});

domTest('sending blocks when the risk engine cannot size the trade', async () => {
  const { overlay, window } = await openPanel(`<body>
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
  assert.equal(window.document.getElementById('tlx-overlay'), overlay, 'panel stays open');
});

domTest('changing the instrument re-derives the contract value', async () => {
  const { overlay } = await openPanel(`<body>
    <label for="vol">Volume</label><input id="vol" value="0.10">
    <label for="entry">Entry</label><input id="entry" value="1.0850">
    <label for="sl">SL</label><input id="sl" value="1.0830">
    <label for="tp">TP</label><input id="tp" value="1.0910">
  </body>`, { title: 'EUR/USD · Exness' });

  assert.equal(Number(field(overlay, 'tlx-point-value').value), 100000);

  const symbolInput = field(overlay, 'tlx-symbol');
  symbolInput.value = 'XAU/USD';
  symbolInput.dispatchEvent(new overlay.ownerDocument.defaultView.Event('change', { bubbles: true }));
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

  const Event = window.Event;
  const choose = (id, value) => {
    const el = field(overlay, id);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
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
  assert.equal(window.document.getElementById('tlx-overlay'), null, 'panel closed');
});
