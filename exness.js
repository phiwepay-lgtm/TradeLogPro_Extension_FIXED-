(() => {
  if (window.__tradeLogExnessInstalled) return;
  window.__tradeLogExnessInstalled = true;

  const D = window.TLXDetect || null;

  const entryTypes = [
    'BT 0.382',
    'FTB 0.382',
    'Open Play VHB or VLB',
    'Open Reversal Play VHB or VLB',
    'Scalp m5 HA VHB or VLB'
  ];

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

  const symbols = (D && D.SYMBOLS) || [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/NZD',
    'BTC/USD', 'ETH/USD', 'XRP/USD', 'NAS100', 'SPX', 'US30', 'GER40', 'XAU/USD', 'XAG/USD'
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* ----------------------------------------------------------- messaging */

  const STALE = 'TradeLog Pro was reloaded, so this page lost its connection to the extension. '
    + 'Refresh this tab (F5) and the button will work again.';

  function extensionAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  /** sendMessage that never throws and reports a stale context explicitly. */
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

  /* ------------------------------------------------------------- detection */

  function visible(el) {
    return D ? D.isVisible(el) : !!(el && el.getClientRects && el.getClientRects().length);
  }

  function detectDirection(fallback) {
    const pressed = [...document.querySelectorAll('[aria-pressed="true"], [aria-selected="true"], [data-active="true"]')]
      .map(el => norm((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || el.textContent)))
      .join(' ');

    if (/\bshort\b/.test(pressed) && !/\blong\b/.test(pressed)) return 'sell';
    if (/\blong\b/.test(pressed) && !/\bshort\b/.test(pressed)) return 'buy';

    const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"],span,div')]
      .filter(el => visible(el) && /^(long|short)\s+position$/.test(norm(el.innerText || el.textContent)));

    for (const heading of headings) {
      let node = heading;
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        const text = norm(node.innerText || node.textContent);
        if (node.querySelectorAll('input').length >= 2 && /lot/.test(text) && /entry/.test(text)) {
          return /short/.test(norm(heading.textContent)) ? 'sell' : 'buy';
        }
      }
    }

    return fallback || '';
  }

  function symbolFromPage() {
    const titleSymbol = D ? D.symbolFromText(document.title) : '';
    if (titleSymbol) return titleSymbol;

    const heading = [...document.querySelectorAll('h1,h2,h3,[role="heading"],[data-symbol]')]
      .map(el => (el.getAttribute && el.getAttribute('data-symbol')) || el.innerText || el.textContent || '')
      .join(' ');
    const headingSymbol = D ? D.symbolFromText(heading) : '';
    if (headingSymbol) return headingSymbol;

    return D ? D.symbolFromText(document.body?.innerText || '') : '';
  }

  /** Money at risk printed in the ticket, e.g. "Stop loss: -$18.40". */
  function scrapeTextAmount() {
    if (!D) return null;
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const patterns = [
      /\b(?:stop\s*-?\s*loss|sl)\b[^$€£¥\d]{0,24}(-?[$€£¥]\s?\d[\d.,]*)/i,
      /\b(?:risk|amount\s+at\s+risk|loss)\b[^$€£¥\d]{0,24}(-?[$€£¥]\s?\d[\d.,]*)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = D.parseNumber(match[1]);
      if (value && Math.abs(value) > 0) return Math.abs(value);
    }
    return null;
  }

  function scanPanel(direction) {
    const empty = { fields: { entry: [], sl: [], tp: [], lots: [], balance: [], riskPct: [], amount: [], price: [] }, empty: [], scanned: 0 };
    const scan = D ? D.collectFields(document) : empty;
    const symbol = symbolFromPage();
    const dir = direction || detectDirection('');

    const resolved = D
      ? D.resolveTrade(scan.fields, dir, symbol, { textAmount: scrapeTextAmount() })
      : {
        direction: dir, entry: null, sl: null, tp: null, lots: null, balance: null, riskPercent: null,
        stopAmount: null, distance: null, pointValue: null, pointValueSource: 'none',
        pointValueAssumed: false, pointValueNote: '', sources: {}, lotInput: null
      };

    return { resolved, fields: scan.fields, empty: scan.empty, scanned: scan.scanned, symbol };
  }

  function riskKeyFor(symbol) {
    const key = D ? D.normaliseSymbol(symbol) : String(symbol || '').toUpperCase();
    return key ? 'riskPointValue:' + key : '';
  }

  async function savedPointValue(symbol) {
    const key = riskKeyFor(symbol);
    if (!key) return null;
    const stored = await chrome.storage.local.get(key).catch(() => ({}));
    const value = Number(stored[key]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** Order: measured in the ticket, then your saved value, then the model. */
  async function choosePointValue(resolved, symbol) {
    if (resolved.pointValueSource === 'measured' && resolved.pointValue > 0) {
      return { value: resolved.pointValue, source: 'measured', assumed: false, note: resolved.pointValueNote };
    }
    const saved = await savedPointValue(symbol);
    if (saved) {
      return { value: saved, source: 'saved', assumed: false, note: 'Saved value for this instrument. Confirm it still matches your contract specification.' };
    }
    const model = D
      ? D.pointValueFor(symbol, resolved.entry)
      : { value: null, source: 'none', assumed: false, note: '' };
    return { value: model.value, source: model.source, assumed: model.assumed, note: model.note };
  }

  /* ------------------------------------------------------------- utilities */

  /**
   * Downscale the screenshot to keep the journal payload small.
   * Always settles: if the image never decodes we fall back to the raw capture
   * rather than leaving the panel waiting forever.
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

  function localDateTime(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function injectStyles() {
    if ($('#tlx-styles')) return;
    const style = document.createElement('style');
    style.id = 'tlx-styles';
    style.textContent = `
      #tlx-launch{position:fixed;z-index:2147483646;right:18px;bottom:18px;border:0;border-radius:999px;padding:12px 17px;background:#385bff;color:#fff;font:600 13px system-ui;box-shadow:0 5px 24px #0008;cursor:pointer}
      #tlx-overlay{position:fixed;inset:0;z-index:2147483647;background:#060914c9;display:grid;place-items:center;padding:12px;font:14px system-ui;color:#f3f5ff}
      #tlx-modal{width:min(680px,97vw);max-height:96vh;overflow:auto;background:#131722;border:1px solid #39445d;border-radius:14px;padding:18px;box-shadow:0 20px 80px #000b}
      #tlx-modal h2{font-size:18px;margin:0 0 5px} #tlx-modal p{color:#aeb8cc;font-size:11px;line-height:1.45;margin:4px 0 10px}
      #tlx-modal img{width:100%;max-height:190px;object-fit:contain;background:#080b12;border-radius:8px;margin:4px 0 9px}
      #tlx-modal .tlx-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 10px}
      #tlx-modal label{display:block;color:#aeb8cc;font-size:10px;margin:7px 0 3px}
      #tlx-modal input,#tlx-modal select{box-sizing:border-box;width:100%;padding:8px;border:1px solid #343b4c;border-radius:7px;background:#1c2230;color:#fff;font:12px system-ui}
      #tlx-modal input[readonly]{color:#aeb8cc}
      #tlx-modal .tlx-detected{margin:8px 0;padding:8px 10px;border-radius:8px;background:#0f1725;border:1px dashed #35435c;color:#9fb2d4;font:10.5px/1.5 system-ui;word-break:break-word}
      #tlx-modal .tlx-detected b{color:#c9d7f2}
      #tlx-modal .tlx-meta{color:#84a9ff;font-size:10px;margin:6px 0}
      #tlx-modal .tlx-risk{margin:10px 0;padding:11px;background:#101a2a;border:1px solid #34445f;border-radius:10px}
      #tlx-modal .tlx-risk h3{font-size:13px;margin:0 0 6px;color:#9db8ff}
      #tlx-modal .tlx-risk-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      #tlx-modal .tlx-risk-output{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:9px 0;color:#c5cee0;font-size:11px}
      #tlx-modal .tlx-risk-output b{font-size:13px;color:#a4f0c7}
      #tlx-modal .tlx-risk-buttons{display:flex;gap:8px;flex-wrap:wrap}
      #tlx-modal .tlx-apply,#tlx-modal .tlx-rescan{background:#243551;color:#e7edff;border:1px solid #536b91!important;padding:7px 10px!important;font-size:11px}
      #tlx-modal .tlx-actions{display:flex;gap:8px;margin-top:12px} #tlx-modal button{border:0;border-radius:8px;padding:10px 14px;font:600 12px system-ui;cursor:pointer}
      #tlx-modal .tlx-save{flex:1;background:linear-gradient(90deg,#3264ff,#754cff);color:#fff} #tlx-modal .tlx-cancel{background:#252c3b;color:#ddd}
      #tlx-modal .tlx-error{color:#ff7d8e;min-height:15px;font-size:11px;margin-top:5px}
      #tlx-modal .tlx-warn{color:#ffcb76;font-size:10.5px;margin:4px 0}
      #tlx-modal .tlx-badge{display:inline-block;padding:1px 6px;border-radius:999px;font-size:9px;margin-left:4px;background:#3a2f12;color:#ffcb76;border:1px solid #6b5520}
      @media(max-width:560px){#tlx-modal .tlx-grid{grid-template-columns:1fr 1fr}#tlx-modal .tlx-risk-grid{grid-template-columns:1fr 1fr}#tlx-modal{padding:14px}}
    `;
    document.documentElement.append(style);
  }

  function selectOptions(values, placeholder) {
    return `<option value="">${placeholder}</option>${values.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item : item.label;
      return `<option value="${value}">${label}</option>`;
    }).join('')}`;
  }

  /** crypto.randomUUID is missing in some embedded webviews; always return an id. */
  function newId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* fall through */ }
    return 'tlx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  /* ------------------------------------------------------------- the panel */

  async function openTrade(direction = '') {
    if ($('#tlx-overlay')) return;

    await sleep(150);

    let scan = scanPanel(direction);
    let symbol = scan.symbol;
    let point = await choosePointValue(scan.resolved, symbol);
    let resolved = scan.resolved;

    const capture = await send({ type: 'capture-visible-tab' });
    const screenshot = capture?.screenshot ? await compressShot(capture.screenshot) : '';

    const now = new Date();
    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'tlx-overlay';
    overlay.innerHTML = `
      <section id="tlx-modal" role="dialog" aria-modal="true" aria-label="Review trade details">
        <h2>Log Exness trade</h2>
        <p>Values are read from the open order panel. Everything below stays editable — confirm it, then send.</p>
        ${screenshot ? `<img src="${screenshot}" alt="Trade chart capture">` : `<div class="tlx-error">Screenshot unavailable. ${escapeHtml(capture?.error || 'Chrome did not return an image.')}</div>`}
        <div class="tlx-detected" id="tlx-detected"></div>

        <div class="tlx-grid">
          <div><label for="tlx-symbol">Instrument</label><input id="tlx-symbol" list="tlx-symbols"></div>
          <div><label for="tlx-dir">Direction</label><select id="tlx-dir"><option value="buy">Long</option><option value="sell">Short</option></select></div>
          <div><label for="tlx-date">Trade date &amp; time (auto-captured)</label><input id="tlx-date" type="datetime-local" readonly></div>
          <div><label for="tlx-lots">Lot size</label><input id="tlx-lots" type="number" min="0" step="any" placeholder="Auto-detect / enter"></div>
          <div><label for="tlx-entry">Entry price</label><input id="tlx-entry" type="number" step="any" placeholder="Auto-detect / enter"></div>
          <div><label for="tlx-sl">Stop loss</label><input id="tlx-sl" type="number" step="any" placeholder="Auto-detect / enter"></div>
          <div><label for="tlx-tp">Take profit</label><input id="tlx-tp" type="number" step="any" placeholder="Auto-detect / enter"></div>
          <div><label for="tlx-exec">Execution type</label><select id="tlx-exec">${selectOptions(executionTypes, 'Select execution…')}</select></div>
          <div><label for="tlx-bias">Continuation / Reversal / Range</label><select id="tlx-bias">${selectOptions(biases, 'Select setup…')}</select></div>
          <div><label for="tlx-mgmt">Trade management</label><select id="tlx-mgmt">${selectOptions(managementTypes, 'Select management…')}</select></div>
          <div><label for="tlx-session">Session</label><select id="tlx-session">${selectOptions(sessions, 'Select session…')}</select></div>
          <div><label for="tlx-emotion">Emotion</label><select id="tlx-emotion">${selectOptions(emotions, 'Select emotion…')}</select></div>
          <div><label for="tlx-outcome">Outcome</label><select id="tlx-outcome">${selectOptions([{ value: 'win', label: 'Win' }, { value: 'loss', label: 'Loss' }, { value: 'be', label: 'Break even' }, { value: 'pending', label: 'Open / pending' }], 'Select outcome…')}</select></div>
          <div><label for="tlx-type">Entry type</label><select id="tlx-type">${selectOptions(entryTypes, 'Select entry type…')}</select></div>
        </div>
        <datalist id="tlx-symbols">${symbols.map(item => `<option value="${item}"></option>`).join('')}</datalist>

        <section class="tlx-risk" aria-label="Prop firm risk auto engine">
          <h3>Prop Firm Risk Auto Engine</h3>
          <div class="tlx-risk-grid">
            <div><label for="tlx-balance">Account balance</label><input id="tlx-balance" type="number" min="0" step="any" placeholder="Auto-detect / enter"></div>
            <div><label for="tlx-risk-pct">Risk per trade (%)</label><input id="tlx-risk-pct" type="number" min="0" max="100" step="0.01" placeholder="Auto-detect / enter"></div>
            <div><label for="tlx-point-value">Money per 1.0 price move / lot <span id="tlx-pv-badge"></span></label><input id="tlx-point-value" type="number" min="0" step="any" placeholder="Auto-detect / enter"></div>
            <div><label for="tlx-lot-step">Lot increment</label><input id="tlx-lot-step" type="number" min="0.0001" step="any" value="0.01"></div>
          </div>
          <div class="tlx-risk-output"><span>Risk budget <b id="tlx-risk-budget">—</b></span><span>Recommended max lot <b id="tlx-recommended-lot">—</b></span></div>
          <div class="tlx-risk-buttons">
            <button class="tlx-apply" type="button">Use recommended lot in trade tool</button>
            <button class="tlx-rescan" type="button">Rescan order panel</button>
          </div>
          <div class="tlx-meta" id="tlx-risk-note"></div>
          <div class="tlx-warn" id="tlx-risk-warn"></div>
        </section>

        <div class="tlx-meta">Date/time comes from your computer clock. Per-trade sizing only; prop-firm daily and maximum drawdown rules are not assumed.</div>
        <div class="tlx-error" aria-live="polite" id="tlx-form-error"></div>

        <div class="tlx-actions">
          <button class="tlx-cancel" type="button">Cancel</button>
          <button class="tlx-save" type="button">Send to TradeLog</button>
        </div>
      </section>
    `;

    document.body.append(overlay);

    const field = id => $('#' + id, overlay);

    const riskCalculation = () => {
      const balance = Number(field('tlx-balance').value);
      const riskPercent = Number(field('tlx-risk-pct').value);
      const pointValue = Number(field('tlx-point-value').value);
      const step = Number(field('tlx-lot-step').value);
      const entry = Number(field('tlx-entry').value);
      const sl = Number(field('tlx-sl').value);

      const result = D
        ? D.recommendLots({ balance, riskPercent, pointValue, entry, sl, step })
        : { ok: false, reason: 'Detection module failed to load.', riskAmount: 0, stopDistance: 0, raw: 0, suggested: 0, riskAtSuggested: 0 };

      field('tlx-risk-budget').textContent = result.riskAmount > 0 ? result.riskAmount.toFixed(2) : '—';
      field('tlx-recommended-lot').textContent = result.suggested > 0 ? String(Number(result.suggested.toFixed(4))) : '—';
      field('tlx-risk-warn').textContent = result.ok ? '' : (result.reason || '');

      return result;
    };

    const refreshSummary = () => {
      const bits = [];
      const summary = D ? D.describeDetection(resolved) : '';
      if (summary) bits.push(`<b>Detected:</b> ${escapeHtml(summary)}`);
      else bits.push('<b>Detected:</b> nothing labelled — enter the values by hand.');

      const pv = Number(field('tlx-point-value').value);
      if (pv > 0) {
        const sourceText = point.source === 'measured' ? 'measured from this ticket'
          : point.source === 'saved' ? 'your saved value'
          : point.assumed ? 'typical contract size' : 'contract size';
        bits.push(`<b>Contract value:</b> ${pv} per 1.0 move per lot (${escapeHtml(sourceText)})`);
      }
      bits.push(`<b>Scanned:</b> ${scan.scanned} controls${scan.empty.length ? `, ${scan.empty.length} labelled but empty` : ''}`);
      field('tlx-detected').innerHTML = bits.join('<br>');

      field('tlx-pv-badge').innerHTML = point.assumed ? '<span class="tlx-badge">assumed</span>' : '';
      field('tlx-risk-note').textContent = point.note || 'Enter the instrument value per 1.0 price move per lot.';
    };

    const fill = () => {
      field('tlx-symbol').value = symbol || '';
      field('tlx-dir').value = resolved.direction || 'buy';
      field('tlx-date').value = localDateTime(now);
      field('tlx-lots').value = resolved.lots ?? '';
      field('tlx-entry').value = resolved.entry ?? '';
      field('tlx-sl').value = resolved.sl ?? '';
      field('tlx-tp').value = resolved.tp ?? '';
      field('tlx-balance').value = resolved.balance ?? '';
      field('tlx-risk-pct').value = resolved.riskPercent ?? '';
      field('tlx-point-value').value = point.value ? Number(Number(point.value).toFixed(8)) : '';
    };

    fill();
    refreshSummary();
    riskCalculation();

    ['tlx-balance', 'tlx-risk-pct', 'tlx-point-value', 'tlx-lot-step', 'tlx-entry', 'tlx-sl'].forEach(id => {
      field(id).addEventListener('input', riskCalculation);
    });

    field('tlx-point-value').addEventListener('change', async event => {
      const value = Number(event.target.value);
      const key = riskKeyFor(field('tlx-symbol').value);
      if (key && value > 0) await chrome.storage.local.set({ [key]: value }).catch(() => {});
      point = { value, source: 'saved', assumed: false, note: 'Saved for this instrument. Confirm it matches your account contract specification.' };
      refreshSummary();
      riskCalculation();
    });

    field('tlx-symbol').addEventListener('change', async () => {
      symbol = field('tlx-symbol').value.trim();
      const fresh = await choosePointValue({ ...resolved, pointValue: null, pointValueSource: 'none' }, symbol);
      point = fresh;
      field('tlx-point-value').value = fresh.value ? Number(Number(fresh.value).toFixed(8)) : '';
      refreshSummary();
      riskCalculation();
    });

    $('.tlx-rescan', overlay).onclick = async () => {
      scan = scanPanel(field('tlx-dir').value === 'sell' ? 'sell' : 'buy');
      resolved = scan.resolved;
      symbol = scan.symbol || field('tlx-symbol').value.trim();
      point = await choosePointValue(resolved, symbol);
      fill();
      refreshSummary();
      riskCalculation();
      field('tlx-form-error').textContent = '';
    };

    $('.tlx-apply', overlay).onclick = () => {
      const risk = riskCalculation();
      const error = field('tlx-form-error');
      error.textContent = '';

      if (!risk.ok) {
        error.textContent = 'Cannot size the trade yet. ' + (risk.reason || 'Check the risk inputs.');
        return;
      }

      const recommended = String(risk.suggested);
      field('tlx-lots').value = recommended;

      const lotInput = resolved.lotInput;
      if (lotInput && lotInput.isConnected) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(lotInput, recommended);
        else lotInput.value = recommended;
        lotInput.dispatchEvent(new Event('input', { bubbles: true }));
        lotInput.dispatchEvent(new Event('change', { bubbles: true }));
        field('tlx-risk-note').textContent = 'Suggested size copied to the active trade tool. No order is placed.';
      } else {
        field('tlx-risk-note').textContent = 'Suggested size copied here. Type the same size in the trade tool; no order is placed.';
      }
    };

    $('.tlx-cancel', overlay).onclick = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });

    $('.tlx-save', overlay).onclick = async () => {
      const error = field('tlx-form-error');
      error.textContent = '';

      const risk = riskCalculation();
      const direction = field('tlx-dir').value;
      const dateInput = field('tlx-date').value;

      const trade = {
        externalId: newId(),
        symbol: field('tlx-symbol').value.trim(),
        dir: direction,
        entry: Number(field('tlx-entry').value),
        sl: Number(field('tlx-sl').value),
        tp: Number(field('tlx-tp').value),
        lots: Number(field('tlx-lots').value),
        date: dateInput ? new Date(dateInput).toISOString() : now.toISOString(),
        exec: field('tlx-exec').value,
        bias: field('tlx-bias').value,
        mgmt: field('tlx-mgmt').value,
        sess: field('tlx-session').value,
        emotion: field('tlx-emotion').value,
        outcome: field('tlx-outcome').value,
        entryType: field('tlx-type').value,
        screenshot
      };

      trade.riskTargetPercent = Number(field('tlx-risk-pct').value) || 0;
      trade.riskBudget = risk.riskAmount;
      trade.riskAmount = trade.lots * risk.stopDistance * Number(field('tlx-point-value').value || 0);
      trade.riskPercent = Number(field('tlx-balance').value) > 0
        ? trade.riskAmount / Number(field('tlx-balance').value) * 100
        : 0;
      trade.pointValue = Number(field('tlx-point-value').value) || 0;
      trade.suggestedLots = risk.suggested;

      if (!screenshot) {
        error.textContent = `Screenshot is required. ${capture?.error || 'Chrome did not return an image.'}`;
        return;
      }

      if (!trade.symbol || !trade.entry || !trade.sl || !trade.tp || !trade.lots) {
        error.textContent = 'Check the instrument, lot size, entry, stop loss and take profit. Anything the panel did not expose has to be typed in.';
        return;
      }

      if (!risk.ok) {
        error.textContent = 'Risk size cannot be verified. ' + (risk.reason || 'Enter the balance, risk % and contract value.');
        return;
      }

      const wrongSide = direction === 'buy'
        ? !(trade.sl < trade.entry && trade.tp > trade.entry)
        : !(trade.sl > trade.entry && trade.tp < trade.entry);
      if (wrongSide) {
        error.textContent = `Stop loss and take profit sit on the wrong side for a ${direction === 'buy' ? 'long' : 'short'} trade. Fix them, or switch the direction.`;
        return;
      }

      if (trade.lots > risk.suggested + Math.max(1e-8, Number(field('tlx-lot-step').value) * 1e-5)) {
        error.textContent = `Current lot (${trade.lots}) exceeds the risk-engine maximum (${risk.suggested}). Apply the recommendation or lower the size.`;
        return;
      }

      if (!trade.exec || !trade.bias || !trade.mgmt || !trade.sess || !trade.emotion || !trade.outcome || !trade.entryType) {
        error.textContent = 'Choose execution type, setup, management, session, emotion, outcome and entry type.';
        return;
      }

      const result = await send({ type: 'save-trade-to-journal', trade });
      if (result?.stale) {
        error.textContent = result.error;
        return;
      }
      if (result?.error) {
        error.textContent = `Could not send trade: ${result.error}`;
        return;
      }

      overlay.remove();
      if (result?.opened) showToast('Trade sent. TradeLog Pro opened in a new tab.');
      else if (result?.delivered === false) showToast(result.reason || 'Trade saved; the journal tab will pick it up on reload.');
      else showToast('Trade sent to TradeLog Pro.');
    };
  }

  function showToast(text) {
    const toast = document.createElement('div');
    toast.textContent = text;
    toast.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:72px;max-width:340px;background:#18243a;color:#fff;border:1px solid #445779;border-radius:9px;padding:12px 15px;font:13px system-ui;box-shadow:0 6px 24px #0008';
    document.body.append(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function directionFromTarget(target) {
    let node = target;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const label = [node.innerText, node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.getAttribute?.('data-tooltip')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/\s+/g, ' ');

      if (/\b(long|short)\s+position\b/.test(label)) {
        return /\blong\s+position\b/.test(label) ? 'buy' : 'sell';
      }
    }
    return '';
  }

  injectStyles();

  const launcher = document.createElement('button');
  launcher.id = 'tlx-launch';
  launcher.type = 'button';
  launcher.textContent = '＋ Log trade';
  launcher.onclick = () => openTrade();
  document.body.append(launcher);

  document.addEventListener('dblclick', event => {
    const direction = directionFromTarget(event.target);
    if (direction) openTrade(direction);
  }, true);
})();
