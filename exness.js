(() => {
  if (window.__tradeLogExnessInstalled) return;
  window.__tradeLogExnessInstalled = true;

  const M = window.TLXMath || null;
  const isTopFrame = (() => { try { return window.top === window; } catch { return false; } })();

  const symbols = (M && M.SYMBOLS) || ['EUR/USD', 'XAU/USD', 'GBP/USD', 'USD/JPY', 'NAS100', 'BTC/USD'];

  const executionTypes = [
    'VHB + Engulf Trigger',
    'VLB + Engulf Trigger',
    'VLB 1:2 (Scalp)',
    'VHB 1:2 (Scalp)'
  ];
  const biases = ['Continuation', 'Reversal', 'Range'];
  const managementTypes = ['Full TP', 'Partial + BE', 'Moved to BE', 'Trailed Stop', 'Manual Close', 'Stop Loss Hit', 'Time Exit'];
  const sessions = [
    { value: 'asian', label: 'Asian' },
    { value: 'london', label: 'London' },
    { value: 'new-york', label: 'New York' },
    { value: 'overlap', label: 'LDN/NY Overlap' }
  ];
  const emotions = ['😎 Confident', '😌 Calm', '😰 Fearful', '🤑 Greedy', '😫 FOMO', '😤 Revenge', '🧘 Patient', '😬 Anxious'];
  const entryTypes = [
    'BT 0.382',
    'FTB 0.382',
    'Open Play VHB or VLB',
    'Open Reversal Play VHB or VLB',
    'Scalp m5 HA VHB or VLB'
  ];

  const LAST_USED_KEY = 'tlxLastUsed';
  const POSITION_KEY = 'tlxPanelPosition';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* ----------------------------------------------------------- messaging */

  const STALE = 'TradeLog Pro was reloaded, so this page lost its connection to the extension. '
    + 'Refresh this tab (F5) and the button will work again.';

  function extensionAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  async function send(message) {
    if (!extensionAlive()) return { error: STALE, stale: true };
    try {
      const reply = await chrome.runtime.sendMessage(message);
      return reply || {};
    } catch (error) {
      const text = String(error?.message || error);
      if (/context invalidated|message port closed|receiving end does not exist/i.test(text)) {
        return { error: STALE, stale: true };
      }
      return { error: text };
    }
  }

  /* ------------------------------------------------------------- helpers */

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function localDateTime(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function newId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* fall through */ }
    return 'tlx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function selectOptions(values, placeholder) {
    return `<option value="">${placeholder}</option>${values.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item : item.label;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('')}`;
  }

  /** Screenshot URL check: http(s) links and data: images only. */
  function normaliseScreenshotUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) return { url: '', error: '' };
    if (/^data:image\//i.test(text)) return { url: text, error: '' };
    try {
      const parsed = new URL(text);
      if (!/^https?:$/.test(parsed.protocol)) return { url: '', error: 'Use an http(s) link or a data: image.' };
      return { url: parsed.href, error: '' };
    } catch {
      return { url: '', error: 'That does not look like a link.' };
    }
  }

  /**
   * Downscale the screenshot to keep the journal payload small.
   * Always settles: if the image never decodes we fall back to the raw capture.
   */
  function compressShot(dataUrl) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(dataUrl), 2000);

      let img;
      try { img = new Image(); } catch { return finish(dataUrl); }

      img.onload = () => {
        try {
          const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.76));
        } catch {
          finish(dataUrl);
        }
      };
      img.onerror = () => finish(dataUrl);
      img.src = dataUrl;
    });
  }

  /* ------------------------------------------------------------ shadow UI */

  /**
   * A floating card in an open shadow root on the top frame. Shadow DOM keeps
   * the terminal's stylesheet away from the inputs (that is what previously
   * made typing impossible), and `all: initial` on the host stops inheritance.
   * There is no backdrop: the chart underneath stays clickable.
   */
  const STYLE = `
    :host{all:initial}
    .tlx-launch{position:fixed;right:18px;bottom:18px;z-index:2;border:0;border-radius:999px;padding:12px 17px;background:#385bff;color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 5px 24px #0008;cursor:pointer;pointer-events:auto}
    .tlx-launch:hover{background:#4a6bff}

    .tlx-panel{position:fixed;z-index:10;width:min(430px,calc(100vw - 24px));max-height:min(88vh,860px);display:flex;flex-direction:column;
      background:#131722;border:1px solid #39445d;border-radius:14px;box-shadow:0 20px 60px #000c;
      font:13px/1.45 system-ui,sans-serif;color:#eef2ff;pointer-events:auto;overflow:hidden}
    .tlx-panel *{box-sizing:border-box}

    .tlx-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#182034;border-bottom:1px solid #2b3550;cursor:grab;user-select:none;touch-action:none}
    .tlx-head.dragging{cursor:grabbing}
    .tlx-title{font:600 13px/1.2 system-ui,sans-serif;color:#fff;flex:1}
    .tlx-grip{color:#6f7f9c;font-size:11px;letter-spacing:1px}
    .tlx-close{border:0;background:#243049;color:#c9d7f2;border-radius:7px;width:24px;height:24px;cursor:pointer;font:600 14px/1 system-ui;padding:0}
    .tlx-close:hover{background:#33405c}

    .tlx-body{padding:12px;overflow:auto}
    .tlx-panel label{display:block;color:#aeb8cc;font-size:10px;margin:0 0 3px}
    .tlx-row{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}
    .tlx-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 10px}
    .tlx-field{margin-bottom:8px;min-width:0}
    .tlx-input-wrap{display:flex;gap:4px}
    .tlx-panel input,.tlx-panel select{display:block;width:100%;min-width:0;padding:8px;border:1px solid #343b4c;border-radius:7px;
      background:#1c2230;color:#fff;font:12px/1.4 system-ui,sans-serif;pointer-events:auto;user-select:text}
    .tlx-panel input:focus,.tlx-panel select:focus{outline:2px solid #4d7cff;outline-offset:1px;border-color:#4d7cff}
    .tlx-panel input[readonly]{color:#93a1bb}
    .tlx-paste{flex:0 0 auto;border:1px solid #3a4763;background:#233149;color:#c9d7f2;border-radius:7px;padding:0 8px;cursor:pointer;font:600 11px/1 system-ui}
    .tlx-paste:hover{background:#2c3d5b}

    .tlx-shot{border:1px solid #2b3550;border-radius:10px;padding:8px;margin-bottom:10px;background:#0f1725}
    .tlx-shot img{width:100%;max-height:150px;object-fit:contain;border-radius:7px;background:#080b12;display:block}
    .tlx-shot-empty{color:#8798b5;font-size:11px;padding:14px 8px;text-align:center;line-height:1.5}
    .tlx-shot-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .tlx-url-row{display:flex;gap:4px;margin-top:8px}

    .tlx-btn{border:0;border-radius:8px;padding:8px 11px;font:600 11.5px/1.2 system-ui,sans-serif;cursor:pointer;color:#e7edff;background:#243551;border:1px solid #3d4d6b}
    .tlx-btn:hover{background:#2c3f5f}
    .tlx-btn[disabled]{opacity:.5;cursor:default}

    .tlx-tags{margin-top:6px;border-top:1px solid #232c42;padding-top:8px}
    .tlx-tags summary{cursor:pointer;color:#9db8ff;font:600 11px/1.4 system-ui;padding:3px 0;list-style:none}
    .tlx-tags summary::-webkit-details-marker{display:none}
    .tlx-tags summary::before{content:'▸ ';color:#6f7f9c}
    .tlx-tags[open] summary::before{content:'▾ '}

    .tlx-risk{margin-top:8px;padding:10px;background:#101a2a;border:1px solid #2d3d57;border-radius:10px}
    .tlx-risk h3{font-size:11.5px;margin:0 0 7px;color:#9db8ff;font-weight:600}
    .tlx-risk .tlx-row-3{margin-bottom:6px}
    .tlx-out{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:#c5cee0;font-size:11px;margin:6px 0}
    .tlx-out b{color:#a4f0c7}
    .tlx-badge{display:inline-block;padding:1px 6px;border-radius:999px;font-size:9px;margin-left:4px;background:#3a2f12;color:#ffcb76;border:1px solid #6b5520}

    .tlx-foot{padding:10px 12px;border-top:1px solid #232c42;background:#101724}
    .tlx-error{color:#ff7d8e;font-size:11px;min-height:14px;margin-bottom:6px}
    .tlx-hint{color:#7f8ea8;font-size:10px;margin-bottom:7px}
    .tlx-actions{display:flex;gap:8px}
    .tlx-send{flex:1;background:linear-gradient(90deg,#3264ff,#754cff);color:#fff;border:0;border-radius:8px;padding:10px;font:600 12.5px/1.2 system-ui;cursor:pointer}
    .tlx-send:hover{filter:brightness(1.08)}
    .tlx-cancel{background:#252c3b;color:#ddd;border:0;border-radius:8px;padding:10px 14px;font:600 12px/1.2 system-ui;cursor:pointer}

    .tlx-toast{position:fixed;right:18px;bottom:74px;max-width:320px;background:#18243a;color:#fff;border:1px solid #445779;border-radius:9px;padding:11px 14px;font:12.5px/1.45 system-ui;box-shadow:0 6px 24px #0008;pointer-events:auto}
    @media(max-width:420px){.tlx-row,.tlx-row-3{grid-template-columns:1fr 1fr}}
  `;

  let ui = null;
  let panel = null;

  function ensureUi() {
    if (!isTopFrame) return null;
    if (ui && ui.host.isConnected) return ui;

    const host = document.createElement('div');
    host.id = 'tlx-shadow-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    (document.body || document.documentElement).append(host);

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.append(style);

    ui = { host, root };
    return ui;
  }

  function renderLauncher() {
    const context = ensureUi();
    if (!context) return;
    if ($('.tlx-launch', context.root)) return;

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'tlx-launch';
    launcher.textContent = '＋ Log trade';
    launcher.title = 'Open the TradeLog Pro panel (drag it anywhere)';
    launcher.addEventListener('click', () => openPanel(''));
    context.root.append(launcher);
  }

  function showToast(text) {
    const context = ensureUi();
    if (!context) return;
    const toast = document.createElement('div');
    toast.className = 'tlx-toast';
    toast.textContent = text;
    context.root.append(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  /* ---------------------------------------------------------- clipboard */

  /**
   * Clipboard reads are only allowed with a user gesture and, on some pages,
   * an explicit permission. Always resolve: the caller shows the fallback hint
   * ("press Ctrl+V") when this returns null.
   */
  async function readClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) return text;
      }
    } catch { /* denied */ }
    return null;
  }

  /* --------------------------------------------------------------- panel */

  async function openPanel(direction) {
    if (!isTopFrame) {
      await send({ type: 'open-trade-panel', direction: direction || '' });
      return;
    }

    const context = ensureUi();
    if (!context) return;
    if (panel && panel.isConnected) return;

    const stored = await chrome.storage.local.get([LAST_USED_KEY, POSITION_KEY]).catch(() => ({}));
    const lastUsed = stored?.[LAST_USED_KEY] || {};
    const savedPosition = stored?.[POSITION_KEY] || null;

    const now = new Date();
    let screenshot = '';
    let screenshotUrl = '';

    const capture = await send({ type: 'capture-visible-tab' });
    if (capture?.screenshot) screenshot = await compressShot(capture.screenshot);
    const captureError = capture?.error || '';

    const element = document.createElement('section');
    element.className = 'tlx-panel';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', 'Log a trade');
    element.innerHTML = `
      <header class="tlx-head" id="tlx-head">
        <span class="tlx-grip">⣿</span>
        <span class="tlx-title">Log trade</span>
        <button class="tlx-close" type="button" title="Close" aria-label="Close">×</button>
      </header>

      <div class="tlx-body">
        <div class="tlx-shot">
          <div id="tlx-shot-slot"></div>
          <div class="tlx-shot-actions">
            <button class="tlx-btn" type="button" id="tlx-retake">Retake screenshot</button>
            <button class="tlx-btn" type="button" id="tlx-use-url">Paste image URL</button>
            <button class="tlx-btn" type="button" id="tlx-clear-shot">Remove</button>
          </div>
          <div class="tlx-url-row" id="tlx-url-row" hidden>
            <input id="tlx-url" type="url" placeholder="https://…/chart.png" spellcheck="false">
            <button class="tlx-btn" type="button" id="tlx-url-apply">Use</button>
          </div>
        </div>

        <div class="tlx-row">
          <div class="tlx-field">
            <label for="tlx-symbol">Instrument</label>
            <input id="tlx-symbol" list="tlx-symbols" placeholder="EUR/USD" spellcheck="false">
            <datalist id="tlx-symbols">${symbols.map(item => `<option value="${item}"></option>`).join('')}</datalist>
          </div>
          <div class="tlx-field">
            <label for="tlx-dir">Direction</label>
            <select id="tlx-dir"><option value="buy">Long</option><option value="sell">Short</option></select>
          </div>
        </div>

        <div class="tlx-row">
          <div class="tlx-field">
            <label for="tlx-entry">Entry price</label>
            <div class="tlx-input-wrap">
              <input id="tlx-entry" inputmode="decimal" placeholder="Type or paste" spellcheck="false">
              <button class="tlx-paste" type="button" data-target="tlx-entry" title="Paste from clipboard">Paste</button>
            </div>
          </div>
          <div class="tlx-field">
            <label for="tlx-sl">Stop loss</label>
            <div class="tlx-input-wrap">
              <input id="tlx-sl" inputmode="decimal" placeholder="Type or paste" spellcheck="false">
              <button class="tlx-paste" type="button" data-target="tlx-sl" title="Paste from clipboard">Paste</button>
            </div>
          </div>
        </div>

        <div class="tlx-row">
          <div class="tlx-field">
            <label for="tlx-tp">Take profit</label>
            <div class="tlx-input-wrap">
              <input id="tlx-tp" inputmode="decimal" placeholder="Type or paste" spellcheck="false">
              <button class="tlx-paste" type="button" data-target="tlx-tp" title="Paste from clipboard">Paste</button>
            </div>
          </div>
          <div class="tlx-field">
            <label for="tlx-lots">Lot size</label>
            <div class="tlx-input-wrap">
              <input id="tlx-lots" inputmode="decimal" placeholder="Type or paste" spellcheck="false">
              <button class="tlx-paste" type="button" data-target="tlx-lots" title="Paste from clipboard">Paste</button>
            </div>
          </div>
        </div>

        <div class="tlx-row">
          <div class="tlx-field">
            <label for="tlx-date">Trade date &amp; time</label>
            <input id="tlx-date" type="datetime-local">
          </div>
          <div class="tlx-field">
            <label for="tlx-outcome">Outcome</label>
            <select id="tlx-outcome">${selectOptions([{ value: 'win', label: 'Win' }, { value: 'loss', label: 'Loss' }, { value: 'be', label: 'Break even' }, { value: 'pending', label: 'Open / pending' }], 'Select outcome…')}</select>
          </div>
        </div>

        <details class="tlx-tags" id="tlx-tags">
          <summary>Journal tags (optional)</summary>
          <div class="tlx-row">
            <div class="tlx-field">
              <label for="tlx-exec">Execution type</label>
              <select id="tlx-exec">${selectOptions(executionTypes, '—')}</select>
            </div>
            <div class="tlx-field">
              <label for="tlx-bias">Setup</label>
              <select id="tlx-bias">${selectOptions(biases, '—')}</select>
            </div>
          </div>
          <div class="tlx-row">
            <div class="tlx-field">
              <label for="tlx-mgmt">Trade management</label>
              <select id="tlx-mgmt">${selectOptions(managementTypes, '—')}</select>
            </div>
            <div class="tlx-field">
              <label for="tlx-session">Session</label>
              <select id="tlx-session">${selectOptions(sessions, '—')}</select>
            </div>
          </div>
          <div class="tlx-row">
            <div class="tlx-field">
              <label for="tlx-emotion">Emotion</label>
              <select id="tlx-emotion">${selectOptions(emotions, '—')}</select>
            </div>
            <div class="tlx-field">
              <label for="tlx-type">Entry type</label>
              <select id="tlx-type">${selectOptions(entryTypes, '—')}</select>
            </div>
          </div>
        </details>

        <section class="tlx-risk" aria-label="Lot size calculator">
          <h3>Lot size calculator <span style="color:#7f8ea8;font-weight:400">(optional)</span></h3>
          <div class="tlx-row-3">
            <div class="tlx-field">
              <label for="tlx-balance">Balance</label>
              <input id="tlx-balance" inputmode="decimal" placeholder="Account">
            </div>
            <div class="tlx-field">
              <label for="tlx-risk-pct">Risk %</label>
              <input id="tlx-risk-pct" inputmode="decimal" placeholder="1">
            </div>
            <div class="tlx-field">
              <label for="tlx-point-value">Per 1.0 / lot <span id="tlx-pv-badge"></span></label>
              <input id="tlx-point-value" inputmode="decimal" placeholder="Auto">
            </div>
          </div>
          <div class="tlx-out">
            <span>Risk budget <b id="tlx-risk-budget">—</b></span>
            <span>Suggested lot <b id="tlx-recommended-lot">—</b></span>
          </div>
          <div class="tlx-actions">
            <button class="tlx-btn" type="button" id="tlx-apply-lot">Use suggested lot</button>
          </div>
          <div class="tlx-hint" id="tlx-risk-note"></div>
        </section>
      </div>

      <footer class="tlx-foot">
        <div class="tlx-error" id="tlx-error" aria-live="polite"></div>
        <div class="tlx-hint" id="tlx-hint"></div>
        <div class="tlx-actions">
          <button class="tlx-send" type="button" id="tlx-send">Send to TradeLog</button>
          <button class="tlx-cancel" type="button" id="tlx-cancel">Cancel</button>
        </div>
      </footer>
    `;

    context.root.append(element);
    panel = element;

    const field = id => $('#' + id, element);
    const errorBox = field('tlx-error');
    const hint = field('tlx-hint');

    const close = () => {
      saveLastUsed();
      element.remove();
      panel = null;
    };

    /* ------------------------------------------------------------ position */

    const place = position => {
      const width = 430;
      const maxLeft = Math.max(8, window.innerWidth - width - 12);
      const maxTop = Math.max(8, window.innerHeight - 180);
      let left = position && Number.isFinite(position.left) ? position.left : window.innerWidth - width - 24;
      let top = position && Number.isFinite(position.top) ? position.top : 80;
      left = Math.min(Math.max(8, left), maxLeft);
      top = Math.min(Math.max(8, top), maxTop);
      element.style.left = left + 'px';
      element.style.top = top + 'px';
    };

    place(savedPosition);

    const head = field('tlx-head');
    let dragStart = null;
    let pendingPosition = null;

    head.addEventListener('pointerdown', event => {
      if (event.target.closest('.tlx-close')) return;
      const rect = element.getBoundingClientRect();
      dragStart = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      head.classList.add('dragging');
      try { head.setPointerCapture(event.pointerId); } catch { /* older engines */ }
      event.preventDefault();
    });

    head.addEventListener('pointermove', event => {
      if (!dragStart) return;
      const left = dragStart.left + (event.clientX - dragStart.x);
      const top = dragStart.top + (event.clientY - dragStart.y);
      place({ left, top });
      // Read back what place() actually applied (clamped to the viewport) rather
      // than offsetLeft, which depends on layout.
      pendingPosition = { left: parseFloat(element.style.left) || 0, top: parseFloat(element.style.top) || 0 };
    });

    const endDrag = () => {
      if (!dragStart) return;
      dragStart = null;
      head.classList.remove('dragging');
      if (pendingPosition) chrome.storage.local.set({ [POSITION_KEY]: pendingPosition }).catch(() => {});
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);

    /* ----------------------------------------------------------- screenshot */

    const shotSlot = field('tlx-shot-slot');
    const urlRow = field('tlx-url-row');
    const urlInput = field('tlx-url');

    const renderShot = () => {
      const source = screenshot || screenshotUrl;
      if (source) {
        shotSlot.innerHTML = `<img src="${escapeHtml(source)}" alt="Trade screenshot">`;
      } else {
        shotSlot.innerHTML = '<div class="tlx-shot-empty">No screenshot yet.<br>Retake it, or paste an image link.</div>';
      }
      field('tlx-clear-shot').disabled = !source;
    };

    const retake = async () => {
      const button = field('tlx-retake');
      button.disabled = true;
      button.textContent = 'Capturing…';
      const fresh = await send({ type: 'capture-visible-tab' });
      button.disabled = false;
      button.textContent = 'Retake screenshot';

      if (fresh?.screenshot) {
        screenshot = await compressShot(fresh.screenshot);
        screenshotUrl = '';
        renderShot();
        errorBox.textContent = '';
      } else {
        errorBox.textContent = `Could not capture: ${fresh?.error || 'Chrome returned no image.'}`;
      }
    };

    field('tlx-retake').addEventListener('click', retake);

    field('tlx-use-url').addEventListener('click', async () => {
      urlRow.hidden = !urlRow.hidden;
      if (urlRow.hidden) return;
      urlInput.focus();
      // Offer the clipboard if it holds a link, rather than making them paste twice.
      const text = await readClipboard();
      if (text && !urlInput.value) {
        const parsed = normaliseScreenshotUrl(text);
        if (parsed.url) urlInput.value = parsed.url;
      }
    });

    field('tlx-url-apply').addEventListener('click', () => {
      const parsed = normaliseScreenshotUrl(urlInput.value);
      if (parsed.error) {
        errorBox.textContent = parsed.error;
        return;
      }
      errorBox.textContent = '';
      if (parsed.url) {
        screenshotUrl = parsed.url;
        screenshot = '';
        renderShot();
        urlRow.hidden = true;
      }
    });

    field('tlx-clear-shot').addEventListener('click', () => {
      screenshot = '';
      screenshotUrl = '';
      urlInput.value = '';
      renderShot();
    });

    renderShot();
    if (captureError && !screenshot) errorBox.textContent = `Screenshot unavailable: ${captureError}`;

    /* ----------------------------------------------------------- prefill */

    field('tlx-dir').value = direction === 'sell' ? 'sell' : 'buy';
    field('tlx-date').value = localDateTime(now);
    field('tlx-symbol').value = lastUsed.symbol || '';
    field('tlx-lots').value = lastUsed.lots || '';
    field('tlx-balance').value = lastUsed.balance || '';
    field('tlx-risk-pct').value = lastUsed.riskPercent || '';
    field('tlx-outcome').value = lastUsed.outcome || '';
    field('tlx-exec').value = lastUsed.exec || '';
    field('tlx-bias').value = lastUsed.bias || '';
    field('tlx-mgmt').value = lastUsed.mgmt || '';
    field('tlx-session').value = lastUsed.sess || '';
    field('tlx-emotion').value = lastUsed.emotion || '';
    field('tlx-type').value = lastUsed.entryType || '';

    /* ----------------------------------------------------------- numbers */

    /**
     * Pasted broker values arrive as "1.0842", "$1,084.20" or "0.10 lots".
     * Clean them as they arrive rather than rejecting the paste.
     */
    const cleanField = input => {
      if (!M) return;
      const raw = input.value;
      if (!raw) return;
      const parsed = M.parseNumber(raw);
      if (parsed === null || parsed === 0) return;
      // Keep sign only where a sign is meaningful (none of these fields are negative).
      const cleaned = Math.abs(parsed);
      input.value = String(cleaned);
      recalculate();
    };

    ['tlx-entry', 'tlx-sl', 'tlx-tp', 'tlx-lots', 'tlx-balance', 'tlx-risk-pct', 'tlx-point-value'].forEach(id => {
      const input = field(id);
      input.addEventListener('paste', () => setTimeout(() => cleanField(input), 0));
      input.addEventListener('change', () => cleanField(input));
      input.addEventListener('blur', () => cleanField(input));
    });

    element.querySelectorAll('.tlx-paste').forEach(button => {
      button.addEventListener('click', async () => {
        const target = field(button.dataset.target);
        if (!target) return;
        const text = await readClipboard();
        if (text === null) {
          target.focus();
          target.select();
          hint.textContent = 'Clipboard is blocked on this site — press Ctrl+V (⌘V on Mac) in the focused field.';
          return;
        }
        target.value = text;
        cleanField(target);
        target.focus();
        hint.textContent = '';
      });
    });

    /* -------------------------------------------------------- calculator */

    let pointAssumed = false;

    const recalculate = () => {
      const entry = Number(field('tlx-entry').value);
      const sl = Number(field('tlx-sl').value);
      const balance = Number(field('tlx-balance').value);
      const riskPercent = Number(field('tlx-risk-pct').value);

      // Contract value: whatever is typed, else the instrument's model.
      let pv = Number(field('tlx-point-value').value);
      if (!(pv > 0) && M) {
        const model = M.pointValueFor(field('tlx-symbol').value, entry);
        if (model.value) {
          pv = model.value;
          field('tlx-point-value').value = Number(model.value.toFixed(6));
          pointAssumed = !!model.assumed;
          field('tlx-risk-note').textContent = model.note || '';
        }
      }
      field('tlx-pv-badge').innerHTML = pointAssumed ? '<span class="tlx-badge">assumed</span>' : '';

      if (!M) return { ok: false, reason: '', riskAmount: 0, stopDistance: 0, raw: 0, suggested: 0 };

      const result = M.recommendLots({
        balance, riskPercent, pointValue: pv, entry, sl,
        step: 0.01
      });

      field('tlx-risk-budget').textContent = result.riskAmount > 0 ? result.riskAmount.toFixed(2) : '—';
      field('tlx-recommended-lot').textContent = result.suggested > 0 ? String(Number(result.suggested.toFixed(4))) : '—';
      field('tlx-apply-lot').disabled = !result.suggested;

      if (!pointAssumed && field('tlx-risk-note').textContent === '' && result.reason) {
        field('tlx-risk-note').textContent = result.reason;
      }

      return result;
    };

    ['tlx-entry', 'tlx-sl', 'tlx-tp', 'tlx-lots', 'tlx-balance', 'tlx-risk-pct', 'tlx-point-value'].forEach(id => {
      field(id).addEventListener('input', recalculate);
    });

    field('tlx-symbol').addEventListener('change', () => {
      // Re-derive the contract value for the new instrument.
      field('tlx-point-value').value = '';
      field('tlx-risk-note').textContent = '';
      recalculate();
    });

    field('tlx-apply-lot').addEventListener('click', () => {
      const result = recalculate();
      if (!result.suggested) {
        errorBox.textContent = result.reason || 'Fill the balance, risk % and stop distance first.';
        return;
      }
      errorBox.textContent = '';
      field('tlx-lots').value = String(result.suggested);
    });

    recalculate();

    /* ------------------------------------------------------------ savings */

    function saveLastUsed() {
      const patch = {
        symbol: field('tlx-symbol').value.trim(),
        lots: field('tlx-lots').value,
        balance: field('tlx-balance').value,
        riskPercent: field('tlx-risk-pct').value,
        outcome: field('tlx-outcome').value,
        exec: field('tlx-exec').value,
        bias: field('tlx-bias').value,
        mgmt: field('tlx-mgmt').value,
        sess: field('tlx-session').value,
        emotion: field('tlx-emotion').value,
        entryType: field('tlx-type').value
      };
      chrome.storage.local.set({ [LAST_USED_KEY]: patch }).catch(() => {});
    }

    /* ---------------------------------------------------------------- send */

    field('tlx-cancel').addEventListener('click', close);
    element.querySelector('.tlx-close').addEventListener('click', close);

    // The terminal binds global hotkeys; keep typing inside the panel. Escape
    // is handled in the same capture listener so nothing can swallow it first.
    ['keydown', 'keyup', 'keypress'].forEach(type => {
      element.addEventListener(type, event => {
        if (type === 'keydown' && event.key === 'Escape') {
          close();
          return;
        }
        event.stopPropagation();
      }, true);
    });

    field('tlx-send').addEventListener('click', async () => {
      errorBox.textContent = '';
      hint.textContent = '';

      const number = id => {
        const parsed = M ? M.parseNumber(field(id).value) : Number(field(id).value);
        return parsed === null || Number.isNaN(parsed) ? 0 : Math.abs(parsed);
      };

      const directionValue = field('tlx-dir').value;
      const trade = {
        externalId: newId(),
        symbol: (M ? M.normaliseSymbol(field('tlx-symbol').value) : field('tlx-symbol').value.trim()),
        dir: directionValue,
        entry: number('tlx-entry'),
        sl: number('tlx-sl'),
        tp: number('tlx-tp'),
        lots: number('tlx-lots'),
        date: field('tlx-date').value ? new Date(field('tlx-date').value).toISOString() : now.toISOString(),
        exec: field('tlx-exec').value,
        bias: field('tlx-bias').value,
        mgmt: field('tlx-mgmt').value,
        sess: field('tlx-session').value,
        emotion: field('tlx-emotion').value,
        outcome: field('tlx-outcome').value,
        entryType: field('tlx-type').value,
        screenshot,
        screenshotUrl
      };

      if (!trade.symbol) {
        errorBox.textContent = 'Enter the instrument.';
        return;
      }
      if (!trade.entry || !trade.sl || !trade.tp) {
        errorBox.textContent = 'Entry, stop loss and take profit are required.';
        return;
      }
      if (!trade.lots) {
        errorBox.textContent = 'Enter the lot size (or use the calculator above).';
        return;
      }

      const wrongSide = directionValue === 'buy'
        ? !(trade.sl < trade.entry && trade.tp > trade.entry)
        : !(trade.sl > trade.entry && trade.tp < trade.entry);
      if (wrongSide) {
        errorBox.textContent = `For a ${directionValue === 'buy' ? 'long' : 'short'}, the stop must be `
          + `${directionValue === 'buy' ? 'below' : 'above'} entry and the target `
          + `${directionValue === 'buy' ? 'above' : 'below'} it. Check the direction.`;
        return;
      }

      if (!trade.screenshot && !trade.screenshotUrl) {
        errorBox.textContent = 'Add a screenshot: press Retake, or paste an image URL.';
        return;
      }
      if (!trade.outcome) {
        errorBox.textContent = 'Choose the trade outcome.';
        return;
      }

      // Calculator numbers travel with the trade when they exist, but never block it.
      const pv = Number(field('tlx-point-value').value) || 0;
      const rr = M ? M.rewardRisk(trade) : null;
      trade.rewardRisk = rr === null ? null : Number(rr.toFixed(3));
      trade.pointValue = pv;
      trade.riskAmount = M ? (M.riskFor({ lots: trade.lots, entry: trade.entry, sl: trade.sl, pointValue: pv }) || 0) : 0;
      const balance = Number(field('tlx-balance').value) || 0;
      trade.riskPercent = balance > 0 ? trade.riskAmount / balance * 100 : 0;
      trade.riskTargetPercent = Number(field('tlx-risk-pct').value) || 0;
      trade.riskBudget = balance > 0 ? balance * trade.riskTargetPercent / 100 : 0;

      saveLastUsed();

      const result = await send({ type: 'save-trade-to-journal', trade });
      if (result?.stale) {
        errorBox.textContent = result.error;
        return;
      }
      if (result?.error) {
        errorBox.textContent = `Could not send trade: ${result.error}`;
        return;
      }

      element.remove();
      panel = null;
      if (result?.opened) showToast('Trade sent. TradeLog Pro opened in a new tab.');
      else if (result?.delivered === false) showToast(result.reason || 'Trade saved; the journal tab will pick it up on reload.');
      else showToast('Trade sent to TradeLog Pro.');
    });
  }

  /* ----------------------------------------------------------------- boot */

  if (isTopFrame) renderLauncher();

  // Double-click on a Long/Short Position label still opens the panel — now as a
  // shortcut only, with the direction preselected. Nothing is read from the page.
  const directionFromTarget = target => {
    let node = target;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const ownText = node.innerText !== undefined ? node.innerText : node.textContent;
      const label = [ownText, node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.getAttribute?.('data-tooltip')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (/\b(long|short)\s+position\b/.test(label)) {
        return /\blong\s+position\b/.test(label) ? 'buy' : 'sell';
      }
    }
    return '';
  };

  document.addEventListener('dblclick', event => {
    const direction = directionFromTarget(event.target);
    if (direction) openPanel(direction);
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'open-trade-panel' || !isTopFrame) return false;
    openPanel(message.direction || '');
    sendResponse?.({ ok: true });
    return false;
  });
})();
