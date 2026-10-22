/* Loads the real content scripts in a DOM with a mocked chrome API and exercises
 * the floating manual panel. Skipped when jsdom is not installed.
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

function fakeChrome({ screenshot = 'data:image/jpeg;base64,AAAA', failCapture = false } = {}) {
  const store = {};
  return {
    __store: store,
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      onMessage: { addListener(fn) { store.__listener = fn; } },
      sendMessage: async message => {
        if (message.type === 'capture-visible-tab') {
          return failCapture ? { error: 'Chrome said no.' } : { screenshot };
        }
        if (message.type === 'save-trade-to-journal') {
          store.__saved = message.trade;
          return { ok: true, delivered: true };
        }
        if (message.type === 'open-trade-panel') { store.__relayed = message; return { ok: true }; }
        return { ok: true };
      }
    },
    storage: {
      local: {
        get: async key => {
          const keys = Array.isArray(key) ? key : [key];
          const out = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        },
        set: async patch => Object.assign(store, patch),
        remove: async () => {}
      }
    }
  };
}

async function mount(options = {}, html = '<body><div id="chart"></div></body>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://my.exness.com/pa/trading/accounts' });
  const { window } = dom;
  window.chrome = fakeChrome(options);
  // jsdom does not decode images: fail fast so the compression fallback does
  // not stall the panel.
  window.Image = class { set src(_v) { setTimeout(() => this.onerror && this.onerror(), 0); } };
  window.eval(read('lot-math.js'));
  window.eval(read('exness.js'));

  const host = window.document.getElementById('tlx-shadow-host');
  assert.ok(host, 'shadow host mounted in the top frame');
  return { window, shadow: host.shadowRoot };
}

async function openPanel(options = {}, html) {
  const mounted = await mount(options, html);
  mounted.shadow.querySelector('.tlx-launch').click();

  const deadline = Date.now() + 3000;
  while (!mounted.shadow.querySelector('.tlx-panel') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const panel = mounted.shadow.querySelector('.tlx-panel');
  assert.ok(panel, 'panel opened');
  return { ...mounted, panel };
}

const field = (panel, id) => panel.querySelector('#' + id);

function setValue(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function completeBasics(window, panel) {
  setValue(window, field(panel, 'tlx-symbol'), 'EUR/USD');
  setValue(window, field(panel, 'tlx-entry'), '1.0850');
  setValue(window, field(panel, 'tlx-sl'), '1.0830');
  setValue(window, field(panel, 'tlx-tp'), '1.0910');
  setValue(window, field(panel, 'tlx-lots'), '0.10');
  field(panel, 'tlx-outcome').value = 'win';
}

/* ---------------------------------------------------------------- the panel */

domTest('the launcher opens a floating panel in a shadow root', async () => {
  const { window, shadow, panel } = await openPanel();

  assert.equal(window.document.querySelector('.tlx-panel'), null, 'not in the page DOM');
  assert.equal(panel.getRootNode().host.id, 'tlx-shadow-host');
  assert.equal(shadow.querySelector('.tlx-overlay'), null, 'no full-screen backdrop');
  assert.equal(panel.parentNode, shadow, 'panel is a direct child of the shadow root');
  assert.ok(panel.style.left && panel.style.top, 'positioned explicitly so it can float');
});

domTest('panel opens empty: nothing is read from the page', async () => {
  const { shadow, panel } = await openPanel({}, `<body>
    <label for="vol">Volume</label><input id="vol" value="0.10">
    <label for="entry">Entry price</label><input id="entry" value="1.0850">
  </body>`);

  assert.equal(field(panel, 'tlx-entry').value, '');
  assert.equal(field(panel, 'tlx-sl').value, '');
  assert.equal(field(panel, 'tlx-tp').value, '');
  assert.equal(field(panel, 'tlx-lots').value, '');
  assert.equal(shadow.querySelector('#tlx-point-value').placeholder, 'Auto');
});

domTest('the screenshot is shown and can be retaken', async () => {
  const { panel } = await openPanel();
  assert.ok(panel.querySelector('#tlx-shot-slot img'), 'captured image in the preview');

  panel.querySelector('#tlx-retake').click();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(panel.querySelector('#tlx-shot-slot img'), 'still there after retake');
  assert.equal(panel.querySelector('#tlx-retake').textContent, 'Retake screenshot');
});

domTest('a failed capture is reported and can be replaced by a URL', async () => {
  const { window, panel } = await openPanel({ failCapture: true });

  assert.match(field(panel, 'tlx-error').textContent, /Chrome said no/);
  assert.match(panel.querySelector('#tlx-shot-slot').textContent, /No screenshot yet/i);

  panel.querySelector('#tlx-use-url').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(field(panel, 'tlx-url-row').hidden, false, 'url row revealed');

  field(panel, 'tlx-url').value = 'https://i.imgur.com/chart.png';
  panel.querySelector('#tlx-url-apply').click();

  assert.ok(panel.querySelector('#tlx-shot-slot img'), 'URL rendered in the preview');
  assert.ok(panel.querySelector('#tlx-shot-slot img').src.includes('imgur'));
});

domTest('a bad screenshot URL is rejected with a reason', async () => {
  const { panel } = await openPanel();
  panel.querySelector('#tlx-use-url').click();
  field(panel, 'tlx-url').value = 'not-a-url';
  panel.querySelector('#tlx-url-apply').click();
  assert.match(field(panel, 'tlx-error').textContent, /does not look like a link/i);
});

domTest('pasted broker values are cleaned into plain numbers', async () => {
  const { window, panel } = await openPanel();

  setValue(window, field(panel, 'tlx-entry'), '$1.084,20');
  assert.equal(field(panel, 'tlx-entry').value, '1084.2');

  setValue(window, field(panel, 'tlx-lots'), '0.10 lots');
  assert.equal(field(panel, 'tlx-lots').value, '0.1');
});

domTest('the lot calculator suggests a size and can fill the field', async () => {
  const { window, panel } = await openPanel();

  setValue(window, field(panel, 'tlx-symbol'), 'EUR/USD');
  setValue(window, field(panel, 'tlx-entry'), '1.0850');
  setValue(window, field(panel, 'tlx-sl'), '1.0830');
  setValue(window, field(panel, 'tlx-balance'), '10000');
  setValue(window, field(panel, 'tlx-risk-pct'), '1');

  // Contract value is derived for EUR/USD automatically.
  assert.equal(Number(field(panel, 'tlx-point-value').value), 100000);
  assert.equal(field(panel, 'tlx-recommended-lot').textContent, '0.5');
  assert.equal(field(panel, 'tlx-risk-budget').textContent, '100.00');

  panel.querySelector('#tlx-apply-lot').click();
  assert.equal(field(panel, 'tlx-lots').value, '0.5');
});

domTest('switching instrument re-derives the contract value', async () => {
  const { window, panel } = await openPanel();

  setValue(window, field(panel, 'tlx-symbol'), 'EUR/USD');
  assert.equal(Number(field(panel, 'tlx-point-value').value), 100000);

  setValue(window, field(panel, 'tlx-symbol'), 'XAU/USD');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(Number(field(panel, 'tlx-point-value').value), 100);
  assert.match(panel.querySelector('#tlx-pv-badge').textContent, /assumed/i);
});

/* ----------------------------------------------------------------- sending */

domTest('a reviewed trade is sent with the screenshot attached', async () => {
  const { window, panel } = await openPanel();
  completeBasics(window, panel);
  panel.querySelector('#tlx-send').click();
  await new Promise(resolve => setTimeout(resolve, 80));

  const saved = window.chrome.__store.__saved;
  assert.ok(saved, 'trade posted to the worker');
  assert.equal(saved.symbol, 'EUR/USD');
  assert.equal(saved.dir, 'buy');
  assert.equal(saved.entry, 1.085);
  assert.equal(saved.sl, 1.083);
  assert.equal(saved.tp, 1.091);
  assert.equal(saved.lots, 0.1);
  assert.equal(saved.outcome, 'win');
  assert.ok(saved.screenshot.startsWith('data:image'));
  assert.equal(saved.screenshotUrl, '');
  assert.ok(Math.abs(saved.rewardRisk - 3) < 1e-9, '20 pip stop, 60 pip target = 3R');
});

domTest('a screenshot URL travels as screenshotUrl with no inline image', async () => {
  const { window, panel } = await openPanel({ failCapture: true });
  completeBasics(window, panel);

  panel.querySelector('#tlx-use-url').click();
  field(panel, 'tlx-url').value = 'https://i.imgur.com/chart.png';
  panel.querySelector('#tlx-url-apply').click();
  field(panel, 'tlx-error').textContent = '';

  panel.querySelector('#tlx-send').click();
  await new Promise(resolve => setTimeout(resolve, 80));

  const saved = window.chrome.__store.__saved;
  assert.equal(saved.screenshot, '');
  assert.equal(saved.screenshotUrl, 'https://i.imgur.com/chart.png');
});

domTest('send is blocked with a reason when the trade is incomplete', async () => {
  const { window, panel } = await openPanel();
  setValue(window, field(panel, 'tlx-symbol'), 'EUR/USD');
  panel.querySelector('#tlx-send').click();
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.match(field(panel, 'tlx-error').textContent, /Entry, stop loss and take profit/i);
  assert.equal(window.chrome.__store.__saved, undefined);
});

domTest('send is blocked when stop and target are on the wrong side', async () => {
  const { window, panel } = await openPanel();
  completeBasics(window, panel);
  setValue(window, field(panel, 'tlx-sl'), '1.0900'); // above entry on a long
  panel.querySelector('#tlx-send').click();
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.match(field(panel, 'tlx-error').textContent, /stop must be below entry/i);
  assert.equal(window.chrome.__store.__saved, undefined);
});

domTest('send is blocked without a screenshot or a URL', async () => {
  const { window, panel } = await openPanel({ failCapture: true });
  completeBasics(window, panel);
  field(panel, 'tlx-error').textContent = '';
  panel.querySelector('#tlx-send').click();
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.match(field(panel, 'tlx-error').textContent, /Add a screenshot/i);
  assert.equal(window.chrome.__store.__saved, undefined);
});

domTest('a missing journal tag never blocks the send', async () => {
  const { window, panel } = await openPanel();
  completeBasics(window, panel);
  // exec / bias / mgmt / session / emotion / entry type all left empty.
  panel.querySelector('#tlx-send').click();
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.ok(window.chrome.__store.__saved, 'still sent');
  assert.equal(window.chrome.__store.__saved.exec, '');
});

/* ------------------------------------------------------------- behaving well */

domTest('the panel remembers what you type for next time', async () => {
  const { window, panel } = await openPanel();
  completeBasics(window, panel);
  setValue(window, field(panel, 'tlx-balance'), '2500');
  panel.querySelector('#tlx-cancel').click();
  await new Promise(resolve => setTimeout(resolve, 20));

  const stored = window.chrome.__store.tlxLastUsed;
  assert.equal(stored.symbol, 'EUR/USD');
  assert.equal(stored.lots, '0.1');
  assert.equal(stored.balance, '2500');
});

domTest('opening twice does not stack panels', async () => {
  const { window, shadow, panel } = await openPanel();
  shadow.querySelector('.tlx-launch').click();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(shadow.querySelectorAll('.tlx-panel').length, 1);
  assert.equal(shadow.querySelectorAll('.tlx-panel')[0], panel);
});

domTest('Escape closes the panel without sending', async () => {
  const { window, panel } = await openPanel();
  panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(panel.isConnected, false);
  assert.equal(window.chrome.__store.__saved, undefined);
});

domTest('a double-click on Long Position opens the panel as a short... long', async () => {
  const { window, shadow } = await mount();
  const target = window.document.createElement('button');
  target.textContent = 'Long Position';
  window.document.body.append(target);

  target.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const deadline = Date.now() + 2000;
  while (!shadow.querySelector('.tlx-panel') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  const panel = shadow.querySelector('.tlx-panel');
  assert.ok(panel, 'panel opened from the double-click');
  assert.equal(panel.querySelector('#tlx-dir').value, 'buy');
});

domTest('the panel can be dragged by its header and remembers where it was left', async () => {
  const { window, panel } = await openPanel();
  const head = panel.querySelector('#tlx-head');

  // jsdom has no layout engine, so give the panel a fixed box to drag from.
  panel.getBoundingClientRect = () => ({ left: 300, top: 100, width: 430, height: 400, right: 730, bottom: 500, x: 300, y: 100 });

  const pointer = (type, x, y) => head.dispatchEvent(new window.MouseEvent(type, {
    bubbles: true, clientX: x, clientY: y, pointerId: 1
  }));

  pointer('pointerdown', 320, 110);
  pointer('pointermove', 420, 210);
  pointer('pointerup', 420, 210);
  await new Promise(resolve => setTimeout(resolve, 20));

  // Moved 100px right and 100px down from its 300/100 box.
  assert.equal(panel.style.left, '400px');
  assert.equal(panel.style.top, '200px');

  const saved = window.chrome.__store.tlxPanelPosition;
  assert.ok(saved, 'position persisted');
  assert.equal(window.document.querySelector('.tlx-panel'), null);
  assert.equal(panel.getRootNode().host.id, 'tlx-shadow-host');
});

domTest('a dragged position is reused the next time the panel opens', async () => {
  const first = await openPanel();
  const head = first.panel.querySelector('#tlx-head');
  first.panel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 430, height: 400, right: 530, bottom: 500, x: 100, y: 100 });
  const pointer = (type, x, y) => head.dispatchEvent(new first.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  pointer('pointerdown', 110, 110);
  pointer('pointermove', 160, 140);
  pointer('pointerup', 160, 140);
  await new Promise(resolve => setTimeout(resolve, 20));

  const stored = first.window.chrome.__store.tlxPanelPosition;
  assert.ok(stored);

  // Re-open in the same extension context with the stored position present.
  first.panel.querySelector('.tlx-close').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  first.shadow.querySelector('.tlx-launch').click();

  const deadline = Date.now() + 2000;
  while (!first.shadow.querySelector('.tlx-panel') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const reopened = first.shadow.querySelector('.tlx-panel');
  assert.equal(reopened.style.left, stored.left + 'px');
  assert.equal(reopened.style.top, stored.top + 'px');
});
