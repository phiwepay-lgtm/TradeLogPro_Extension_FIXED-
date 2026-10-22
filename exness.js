(() => {
  if (window.__tradeLogExnessInstalled) return;
  window.__tradeLogExnessInstalled = true;

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

  const symbols = [
    'EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','AUD/NZD',
    'BTC/USD','ETH/USD','XRP/USD','NAS100','SPX','US30','GER40','XAU/USD','XAG/USD'
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const visible = el => {
    if (!el) return false;
    try {
      const rects = el.getClientRects?.();
      return !!(rects && rects.length) && getComputedStyle(el).visibility !== 'hidden';
    } catch {
      return false;
    }
  };

  function deepAll(selector, root = document) {
    const found = [...root.querySelectorAll(selector)];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) found.push(...deepAll(selector, node.shadowRoot));
    }
    return found;
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return '';
    const text = String(value).replace(/,/g, '').trim();
    if (!text) return '';
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return '';
    const num = Number(match[0]);
    return Number.isFinite(num) && num > 0 ? num : '';
  }

  function readableText(el) {
    const values = [
      el?.getAttribute?.('aria-label'),
      el?.getAttribute?.('placeholder'),
      el?.getAttribute?.('title'),
      el?.getAttribute?.('data-testid'),
      el?.getAttribute?.('name'),
      el?.closest?.('label')?.innerText,
      el?.closest?.('div')?.innerText,
      el?.closest?.('section')?.innerText,
      el?.parentElement?.innerText
    ];
    return values.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function matchAny(text, patterns) {
    const hay = String(text || '').toLowerCase();
    return patterns.some(p => new RegExp(p, 'i').test(hay));
  }

  function nearestMeaningfulText(el) {
    let node = el;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const txt = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length < 200) return txt;
    }
    return '';
  }

  function detectSymbolFromText() {
    const text = (document.body?.innerText || '').toUpperCase();
    const normalized = text.replace(/[\s._-]/g, '');
    for (const s of symbols) {
      const compact = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (normalized.includes(compact)) return s;
    }
    return '';
  }

  function symbolFromPage() {
    const title = document.title || '';
    const titleText = title.toUpperCase().replace(/[\s._-]/g, '');

    for (const s of symbols) {
      const compact = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (titleText.includes(compact)) return s;
    }

    return detectSymbolFromText();
  }

  function collectFields() {
    const inputs = deepAll('input, textarea, select, [contenteditable="true"], [role="spinbutton"]')
      .filter(el => visible(el) && (el.tagName !== 'INPUT' || el.type !== 'hidden'));

    const fields = { entry: [], lots: [], sl: [], tp: [], balance: [], riskPct: [], price: [] };

    for (const input of inputs) {
      const label = readableText(input) || nearestMeaningfulText(input);
      const raw = input.tagName === 'INPUT' || input.tagName === 'TEXTAREA' || input.tagName === 'SELECT'
        ? (input.value ?? '')
        : (input.textContent ?? '');

      const value = toNumber(raw);
      if (!label || value === '') continue;

      const push = key => fields[key].push({ value, label, input });

      const isLots = matchAny(label, ['lot', 'lots', 'volume', 'size']) && !matchAny(label, ['risk', 'balance', 'equity']);
      const isEntry = matchAny(label, ['entry', 'open price', 'open']) && !matchAny(label, ['stop', 'take', 'profit']);
      const isSl = matchAny(label, ['stop', 'sl', 'loss']) && !matchAny(label, ['take', 'profit']);
      const isTp = matchAny(label, ['take', 'profit', 'tp']) && !matchAny(label, ['stop', 'loss']);
      const isBalance = matchAny(label, ['account balance', 'balance', 'equity', 'account size']);
      const isRisk = matchAny(label, ['risk per trade', 'risk%', 'risk %', 'risk percent', 'risk']);
      const isPrice = matchAny(label, ['price']) && !matchAny(label, ['entry', 'stop', 'take', 'profit']);

      if (isLots) push('lots');
      if (isEntry) push('entry');
      if (isSl) push('sl');
      if (isTp) push('tp');
      if (isBalance) push('balance');
      if (isRisk) push('riskPct');
      if (isPrice) push('price');
    }

    return fields;
  }

  function detectDirection(fallback) {
    const pressed = deepAll('[aria-pressed="true"], [aria-selected="true"], [data-active="true"]')
      .map(el => norm((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || el.textContent)))
      .join(' ');

    if (/\bshort\b/.test(pressed) && !/\blong\b/.test(pressed)) return 'sell';
    if (/\blong\b/.test(pressed) && !/\bshort\b/.test(pressed)) return 'buy';

    const headings = deepAll('h1,h2,h3,[role="heading"],span,div')
      .filter(el => visible(el) && /^(long|short)\s+position$/.test(norm(el.innerText || el.textContent)));

    for (const h of headings) {
      let node = h;
      for (let d = 0; node && d < 8; d++, node = node.parentElement) {
        const text = norm(node.innerText || node.textContent);
        if (deepAll('input', node).filter(visible).length >= 2 && /lot/.test(text) && /entry/.test(text)) {
          return /short/.test(norm(h.textContent)) ? 'sell' : 'buy';
        }
      }
    }

    return fallback || '';
  }

  function readToolDetails(direction) {
    const fields = collectFields();
    const first = list => (list.length ? list[0].value : '');

    const resolvedDirection = direction || detectDirection('') || 'buy';

    const entry = first(fields.entry);
    let sl = first(fields.sl);
    let tp = first(fields.tp);

    for (const item of fields.price) {
      const price = item.value;
      if (entry === '' || price === entry) continue;

      if (resolvedDirection === 'buy') {
        if (price > entry && tp === '') tp = price;
        if (price < entry && sl === '') sl = price;
      } else {
        if (price < entry && tp === '') tp = price;
        if (price > entry && sl === '') sl = price;
      }
    }

    const pageText = document.body?.innerText || '';
    const amountMatch = pageText.match(/\bstop\b[\s\S]{0,180}?\bamount\s*:?\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)/i);
    const stopAmount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0;
    const lots = first(fields.lots);
    const balance = first(fields.balance);
    const distance = entry !== '' && sl !== '' ? Math.abs(entry - sl) : 0;
    const pointValue = balance && stopAmount && distance && lots
      ? Math.abs(balance - stopAmount) / (distance * lots)
      : 0;

    return {
      direction: resolvedDirection,
      entry,
      sl,
      tp,
      lots,
      balance,
      riskPercent: first(fields.riskPct),
      pointValue,
      lotInput: fields.lots[0]?.input
    };
  }

  function compressShot(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.76));
      };
      img.onerror = () => resolve(dataUrl);
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
      #tlx-modal{width:min(660px,97vw);max-height:96vh;overflow:auto;background:#131722;border:1px solid #39445d;border-radius:14px;padding:18px;box-shadow:0 20px 80px #000b}
      #tlx-modal h2{font-size:18px;margin:0 0 5px} #tlx-modal p{color:#aeb8cc;font-size:11px;line-height:1.45;margin:4px 0 10px}
      #tlx-modal img{width:100%;max-height:190px;object-fit:contain;background:#080b12;border-radius:8px;margin:4px 0 9px}
      #tlx-modal .tlx-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 10px}
      #tlx-modal label{display:block;color:#aeb8cc;font-size:10px;margin:7px 0 3px}
      #tlx-modal input,#tlx-modal select{box-sizing:border-box;width:100%;padding:8px;border:1px solid #343b4c;border-radius:7px;background:#1c2230;color:#fff;font:12px system-ui}
      #tlx-modal input[readonly]{color:#aeb8cc}
      #tlx-modal .tlx-meta{color:#84a9ff;font-size:10px;margin:6px 0}
      #tlx-modal .tlx-risk{margin:10px 0;padding:11px;background:#101a2a;border:1px solid #34445f;border-radius:10px}
      #tlx-modal .tlx-risk h3{font-size:13px;margin:0 0 6px;color:#9db8ff}
      #tlx-modal .tlx-risk-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      #tlx-modal .tlx-risk-output{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:9px 0;color:#c5cee0;font-size:11px}
      #tlx-modal .tlx-risk-output b{font-size:13px;color:#a4f0c7}
      #tlx-modal .tlx-apply{background:#243551;color:#e7edff;border:1px solid #536b91!important;padding:7px 10px!important}
      #tlx-modal .tlx-actions{display:flex;gap:8px;margin-top:12px} #tlx-modal button{border:0;border-radius:8px;padding:10px 14px;font:600 12px system-ui;cursor:pointer}
      #tlx-modal .tlx-save{flex:1;background:linear-gradient(90deg,#3264ff,#754cff);color:#fff} #tlx-modal .tlx-cancel{background:#252c3b;color:#ddd}
      #tlx-modal .tlx-error{color:#ff7d8e;min-height:15px;font-size:11px;margin-top:5px}
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

  async function openTrade(direction = '') {
    if ($('#tlx-overlay')) return;

    await new Promise(resolve => setTimeout(resolve, 180));
    const detected = readToolDetails(direction);
    const symbol = symbolFromPage();

    let riskPointSymbol = symbol;
    let riskPointKey = riskPointSymbol ? `riskPointValue:${riskPointSymbol}` : '';

    const savedRisk = riskPointKey ? await chrome.storage.local.get(riskPointKey).catch(() => ({})) : {};
    const pointValue = detected.pointValue || (riskPointKey ? Number(savedRisk[riskPointKey]) : 0) || '';

    const capture = await chrome.runtime.sendMessage({ type: 'capture-visible-tab' }).catch(error => ({ error: error.message }));
    const screenshot = capture?.screenshot ? await compressShot(capture.screenshot) : '';

    const now = new Date();
    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'tlx-overlay';
    overlay.innerHTML = `
      <section id="tlx-modal" role="dialog" aria-modal="true" aria-label="Review trade details">
        <h2>Log Exness trade</h2>
        <p>Trade values are read from the open order panel where available. Confirm every value before saving.</p>
        ${screenshot ? `<img src="${screenshot}" alt="Trade chart capture">` : `<div class="tlx-error">Screenshot unavailable. Click the TradeLog toolbar icon on this tab once, close its popup, then reopen this form. If it still fails, open chrome://extensions &gt; TradeLog Pro &gt; Details &gt; Site access and allow the site, then reload the extension.</div>`}
        <div class="tlx-grid">
          <div><label for="tlx-symbol">Instrument</label><input id="tlx-symbol" value=""></div>
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

        <section class="tlx-risk" aria-label="Prop firm risk auto engine">
          <h3>Prop Firm Risk Auto Engine</h3>
          <div class="tlx-risk-grid">
            <div><label for="tlx-balance">Account balance</label><input id="tlx-balance" type="number" min="0" step="any" placeholder="Auto-detect / enter"></div>
            <div><label for="tlx-risk-pct">Risk per trade (%)</label><input id="tlx-risk-pct" type="number" min="0" max="100" step="0.01" placeholder="Auto-detect / enter"></div>
            <div><label for="tlx-point-value">Money per 1.0 price move / lot</label><input id="tlx-point-value" type="number" min="0" step="any" placeholder="Auto-detect / enter"></div>
            <div><label for="tlx-lot-step">Lot increment</label><input id="tlx-lot-step" type="number" min="0.0001" step="any" value="0.01"></div>
          </div>
          <div class="tlx-risk-output"><span>Risk budget <b id="tlx-risk-budget">—</b></span><span>Recommended max lot <b id="tlx-recommended-lot">—</b></span></div>
          <button class="tlx-apply" type="button">Use recommended lot in trade tool</button>
          <div class="tlx-meta" id="tlx-risk-note">Uses the active trade panel balance/risk and stop amount where available. Verify all account rules and contract values.</div>
        </section>

        <div class="tlx-meta">Date/time is captured from your computer clock. Lot size and prices are detected from the active trade panel when exposed.</div>
        <div class="tlx-error" aria-live="polite">${capture?.error && !screenshot ? ('Chrome needs temporary access to this tab. Click the extension toolbar icon, then retry. (' + capture.error + ')') : ''}</div>

        <div class="tlx-actions">
          <button class="tlx-cancel" type="button">Cancel</button>
          <button class="tlx-save" type="button">Send to TradeLog</button>
        </div>
      </section>
    `;

    document.body.append(overlay);

    $('#tlx-symbol', overlay).value = symbol;
    $('#tlx-dir', overlay).value = detected.direction || 'buy';
    $('#tlx-date', overlay).value = localDateTime(now);
    $('#tlx-lots', overlay).value = detected.lots || '';
    $('#tlx-entry', overlay).value = detected.entry || '';
    $('#tlx-sl', overlay).value = detected.sl || '';
    $('#tlx-tp', overlay).value = detected.tp || '';
    $('#tlx-balance', overlay).value = detected.balance || '';
    $('#tlx-risk-pct', overlay).value = detected.riskPercent || '';
    $('#tlx-point-value', overlay).value = pointValue || '';

    $('#tlx-risk-note', overlay).textContent = detected.pointValue
      ? 'Contract value inferred from the current stop amount; verify against the symbol and account.'
      : pointValue ? 'Using your saved per-symbol contract value; verify it matches the active instrument.'
      : 'Enter the instrument value per 1.0 price move per lot if the active trade panel does not expose a stop amount. No generic contract assumptions are used.';

    $('#tlx-risk-note', overlay).textContent += ' Per-trade sizing only; prop-firm daily/max drawdown rules vary and are not assumed.';

    const riskCalculation = () => {
      const balance = Number($('#tlx-balance', overlay).value);
      const riskPercent = Number($('#tlx-risk-pct', overlay).value);
      const pv = Number($('#tlx-point-value', overlay).value);
      const step = Number($('#tlx-lot-step', overlay).value);
      const entry = Number($('#tlx-entry', overlay).value);
      const sl = Number($('#tlx-sl', overlay).value);
      const stopDistance = Math.abs(entry - sl);
      const riskAmount = balance * riskPercent / 100;
      const rawLots = stopDistance > 0 && pv > 0 ? riskAmount / (stopDistance * pv) : 0;
      const suggestedLots = balance > 0 && riskPercent > 0 && riskPercent <= 100 && pv > 0 && stopDistance > 0 && step > 0
        ? +(Math.floor(rawLots / step + 1e-9) * step).toFixed(8)
        : 0;

      $('#tlx-risk-budget', overlay).textContent = riskAmount > 0 && riskPercent <= 100 ? riskAmount.toFixed(2) : '—';
      $('#tlx-recommended-lot', overlay).textContent = suggestedLots > 0 ? String(Number(suggestedLots.toFixed(4))) : '—';

      return { balance, riskPercent, pv, step, entry, sl, stopDistance, riskAmount, suggestedLots };
    };

    ['tlx-balance', 'tlx-risk-pct', 'tlx-point-value', 'tlx-lot-step', 'tlx-entry', 'tlx-sl'].forEach(id => {
      $('#' + id, overlay).addEventListener('input', riskCalculation);
    });

    $('#tlx-point-value', overlay).addEventListener('change', event => {
      const value = Number(event.target.value);
      if (riskPointKey && value > 0) chrome.storage.local.set({ [riskPointKey]: value });
      $('#tlx-risk-note', overlay).textContent = 'Saved as the per-symbol point value; confirm it matches this instrument and account. Per-trade sizing only; prop-firm daily/max drawdown rules vary.';
    });

    $('#tlx-symbol', overlay).addEventListener('change', async event => {
      const nextSymbol = event.target.value.trim();
      if (nextSymbol === riskPointSymbol) return;

      riskPointSymbol = nextSymbol;
      riskPointKey = riskPointSymbol ? `riskPointValue:${riskPointSymbol}` : '';

      const saved = riskPointKey ? await chrome.storage.local.get(riskPointKey).catch(() => ({})) : {};
      $('#tlx-point-value', overlay).value = detected.pointValue && nextSymbol === symbol
        ? detected.pointValue
        : (riskPointKey ? Number(saved[riskPointKey]) || '' : '');

      $('#tlx-risk-note', overlay).textContent = detected.pointValue && nextSymbol === symbol
        ? 'Contract value inferred from the current stop amount; confirm it matches the symbol.'
        : riskPointKey && saved[riskPointKey]
          ? 'Using saved per-symbol contract value; verify it matches the active instrument.'
          : 'Point value cleared because the instrument changed. Enter/confirm money per 1.0 price move per lot.';

      riskCalculation();
    });

    riskCalculation();

    $('.tlx-apply', overlay).onclick = () => {
      const risk = riskCalculation();
      const err = $('.tlx-error', overlay);
      err.textContent = '';

      if (!risk.suggestedLots) {
        err.textContent = 'Cannot calculate yet. Check account balance, risk %, stop distance, point value and lot increment.';
        return;
      }

      const recommended = String(risk.suggestedLots);
      $('#tlx-lots', overlay).value = recommended;

      if (detected.lotInput?.isConnected) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(detected.lotInput, recommended);
        else detected.lotInput.value = recommended;

        detected.lotInput.dispatchEvent(new Event('input', { bubbles: true }));
        detected.lotInput.dispatchEvent(new Event('change', { bubbles: true }));

        $('#tlx-risk-note', overlay).textContent = 'Suggested size copied to the active trade tool. This does not place an order.';
      } else {
        $('#tlx-risk-note', overlay).textContent = 'Suggested size copied here. Enter the same size in the active trade tool; this does not place an order.';
      }
    };

    $('.tlx-cancel', overlay).onclick = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });

    $('.tlx-save', overlay).onclick = async () => {
      const err = $('.tlx-error', overlay);
      err.textContent = '';

      const dateInput = $('#tlx-date', overlay).value;
      const trade = {
        externalId: crypto.randomUUID(),
        symbol: $('#tlx-symbol', overlay).value.trim(),
        dir: $('#tlx-dir', overlay).value,
        entry: Number($('#tlx-entry', overlay).value),
        sl: Number($('#tlx-sl', overlay).value),
        tp: Number($('#tlx-tp', overlay).value),
        lots: Number($('#tlx-lots', overlay).value),
        date: dateInput ? new Date(dateInput).toISOString() : now.toISOString(),
        exec: $('#tlx-exec', overlay).value,
        bias: $('#tlx-bias', overlay).value,
        mgmt: $('#tlx-mgmt', overlay).value,
        sess: $('#tlx-session', overlay).value,
        emotion: $('#tlx-emotion', overlay).value,
        outcome: $('#tlx-outcome', overlay).value,
        entryType: $('#tlx-type', overlay).value,
        screenshot
      };

      const risk = riskCalculation();
      trade.riskTargetPercent = risk.riskPercent;
      trade.riskBudget = risk.riskAmount;
      trade.riskAmount = trade.lots * risk.stopDistance * risk.pv;
      trade.riskPercent = risk.balance > 0 ? trade.riskAmount / risk.balance * 100 : 0;
      trade.pointValue = risk.pv;
      trade.suggestedLots = risk.suggestedLots;

      if (!screenshot) {
        err.textContent = 'Screenshot is required. Click the TradeLog toolbar icon on this tab to grant temporary access, then reopen the form.';
        return;
      }

      if (!trade.symbol || !trade.entry || !trade.sl || !trade.tp || !trade.lots) {
        err.textContent = 'Check the instrument, lot size, entry, stop loss and take profit. Correct any values the active panel did not expose.';
        return;
      }

      if (!risk.suggestedLots) {
        err.textContent = 'Risk size cannot be verified. Enter account balance, risk %, and the instrument value per 1.0 price move per lot.';
        return;
      }

      if (trade.lots > risk.suggestedLots + Math.max(1e-8, risk.step * 1e-5)) {
        err.textContent = `Current lot (${trade.lots}) exceeds the risk-engine maximum (${risk.suggestedLots}). Apply the recommendation or lower the lot size.`;
        return;
      }

      if (!trade.exec || !trade.bias || !trade.mgmt || !trade.sess || !trade.emotion || !trade.outcome || !trade.entryType) {
        err.textContent = 'Choose execution type, setup, management, session, emotion, outcome and entry type.';
        return;
      }

      const result = await chrome.runtime.sendMessage({ type: 'save-trade-to-journal', trade }).catch(error => ({ error: error.message }));
      if (result?.error) {
        err.textContent = `Could not send trade: ${result.error}`;
        return;
      }

      overlay.remove();
      showToast(result?.opened ? 'Trade sent. TradeLog Pro opened in a new tab.' : 'Trade sent to TradeLog Pro.');
    };
  }

  function showToast(text) {
    const toast = document.createElement('div');
    toast.textContent = text;
    toast.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:72px;background:#18243a;color:#fff;border:1px solid #445779;border-radius:9px;padding:12px 15px;font:13px system-ui;box-shadow:0 6px 24px #0008';
    document.body.append(toast);
    setTimeout(() => toast.remove(), 5000);
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