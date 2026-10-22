/* TradeLog Pro — trade-panel detection helpers.
 *
 * Pure, chrome-free logic so it can be unit tested with `node --test`.
 * Loaded as the first content script, exposes `globalThis.TLXDetect`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TLXDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NBSP = /[\u00a0\u2007\u2009\u202f]/g;

  /* ---------------------------------------------------------------- numbers */

  /**
   * Parse a price/size/amount that may be 1234.56, 1,234.56, 1.234,56,
   * "1 234,56", "$25.00", "−25,00", "(25.00)".
   * Returns a signed finite number, or null.
   */
  function parseNumber(raw) {
    if (raw === null || raw === undefined) return null;
    let text = String(raw).replace(NBSP, ' ').trim();
    if (!text) return null;

    const negative = /^\s*\(/.test(text) || /[-−–]/.test(text);
    let digits = text.replace(/[^\d.,]/g, '');
    if (!/\d/.test(digits)) return null;

    const dots = (digits.match(/\./g) || []).length;
    const commas = (digits.match(/,/g) || []).length;
    let decimal = '';

    if (dots && commas) {
      decimal = digits.lastIndexOf('.') > digits.lastIndexOf(',') ? '.' : ',';
    } else if (commas) {
      const parts = digits.split(',');
      // A single comma with anything other than 3 trailing digits is a decimal
      // separator ("1,0842" -> 1.0842); 3 digits reads as a thousands group.
      decimal = parts.length === 2 && parts[1].length !== 3 ? ',' : '';
    } else if (dots > 1) {
      const parts = digits.split('.');
      decimal = parts[parts.length - 1].length === 3 ? '' : '.';
    } else if (dots === 1) {
      decimal = '.';
    }

    if (decimal === '.') digits = digits.replace(/,/g, '');
    else if (decimal === ',') digits = digits.replace(/\./g, '').replace(/,/g, '.');
    else digits = digits.replace(/[.,]/g, '');

    const num = Number(digits);
    if (!Number.isFinite(num)) return null;
    return negative ? -num : num;
  }

  /** Parse a positive magnitude (prices, sizes). Zero and negatives -> null. */
  function parsePositive(raw) {
    const num = parseNumber(raw);
    return num !== null && num > 0 ? num : null;
  }

  /* ----------------------------------------------------------------- labels */

  const MAX_LABEL = 140;
  const MAX_NEARBY = 60;

  function textOf(node) {
    if (!node) return '';
    return String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function attr(el, name) {
    try { return el && el.getAttribute ? el.getAttribute(name) : null; } catch { return null; }
  }

  function clean(value, limit) {
    if (!value) return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text || text.length > (limit || MAX_LABEL)) return '';
    return text;
  }

  /**
   * Best-effort label for a control, preferring the tightest, most explicit
   * source. Returns { text, source }. `text` is the union of all usable
   * sources so classification sees things like "Volume" + "0.10".
   */
  function labelFor(el) {
    const doc = el && el.ownerDocument;
    const parts = [];
    let source = '';

    const add = (value, from, limit) => {
      const text = clean(value, limit);
      if (!text) return;
      if (!parts.some(existing => existing.toLowerCase() === text.toLowerCase())) parts.push(text);
      if (!source) source = from;
    };

    // 1. aria-labelledby -> other elements
    const labelledBy = attr(el, 'aria-labelledby');
    if (labelledBy && doc && doc.getElementById) {
      const text = labelledBy.split(/\s+/)
        .map(id => doc.getElementById(id))
        .filter(Boolean)
        .map(textOf)
        .join(' ');
      add(text, 'aria-labelledby');
    }

    // 2. aria-label / title
    add(attr(el, 'aria-label'), 'aria-label');
    add(attr(el, 'title'), 'title');

    // 3. <label for=id> or wrapping <label>
    const id = attr(el, 'id');
    if (id && doc && doc.querySelectorAll) {
      for (const label of doc.querySelectorAll('label[for]')) {
        if (attr(label, 'for') === id) { add(textOf(label), 'label', MAX_NEARBY); break; }
      }
    }
    const wrapping = el && el.closest ? el.closest('label') : null;
    if (wrapping) add(textOf(wrapping), 'label', MAX_NEARBY);

    // 4. placeholder / name / id / data-* hooks
    add(attr(el, 'placeholder'), 'placeholder', MAX_NEARBY);
    add(attr(el, 'name'), 'name', MAX_NEARBY);
    if (id) add(id, 'id', MAX_NEARBY);
    add(attr(el, 'data-testid') || attr(el, 'data-qa') || attr(el, 'data-cy') || attr(el, 'data-test'), 'data-attr', MAX_NEARBY);

    // 5. Text immediately before the input inside the same field wrapper.
    let node = el;
    for (let depth = 0; node && depth < 3 && !source; depth++, node = node.previousElementSibling) {
      add(textOf(node), 'nearby', MAX_NEARBY);
    }

    // 6. Parent's own text, but only when it is short (a field wrapper, not a
    //    whole form). This is what previously grabbed entire panels.
    const parent = el && el.parentElement;
    if (parent && !source) {
      const own = textOf(parent);
      if (own && own.length <= MAX_NEARBY) add(own, 'nearby', MAX_NEARBY);
    }

    return { text: parts.join(' · '), source: source || 'unlabelled' };
  }

  /* ----------------------------------------------------------- classification */

  const WORD = (word) => new RegExp('(^|[^a-z0-9])' + word + '([^a-z0-9]|$)', 'i');

  const RX = {
    stopLoss: [/\bstop\s*-?\s*loss\b/i, /\bstoploss\b/i, /\bs\/l\b/i, /\bsl\b/i, /\bstop\b/i],
    takeProfit: [/\btake\s*-?\s*profit\b/i, /\btakeprofit\b/i, /\bt\/p\b/i, /\btp\b/i],
    entry: [/\bentry\b/i, /\bopen(ing)?\s*price\b/i, /\bmarket\s*price\b/i, /\bexecution\s*price\b/i],
    price: [/\bprice\b/i, /\bbid\b/i, /\bask\b/i, /\bquote\b/i, /\blast\b/i],
    lots: [/\bvolume\b/i, /\blots?\b/i, /\bquantity\b/i, /\bqty\b/i, /\bsize\b/i],
    balance: [/\bbalance\b/i, /\bequity\b/i, /\baccount\s*(size|value)\b/i],
    riskPct: [
      /\brisk\b[^0-9%]{0,12}%/i,
      /\brisk\s*percent(age)?\b/i,
      /\brisk\s*per\s*trade\b/i,
      /%\s*(risk|per\s*trade)/i
    ],
    money: /[$€£¥₦₽₹]|\b(?:usd|eur|gbp|jpy|chf|aud|nzd|cad|zar|ron)\b/i
  };

  function matchAny(text, list) {
    return list.some(rx => rx.test(text));
  }

  /** A label or value that carries a currency marker. */
  function looksLikeMoney(text) {
    return RX.money.test(String(text || ''));
  }

  /**
   * Which panel roles a label implies.
   * Roles are intentionally exclusive so one control cannot pollute another
   * list: "Account size" is a balance, not a lot size.
   */
  function classifyLabel(label) {
    const text = String(label || '');
    if (!text) return [];

    const roles = [];
    const isSl = matchAny(text, RX.stopLoss);
    const isTp = matchAny(text, RX.takeProfit);

    // "SL/TP" in one label is ambiguous; don't guess a side.
    const combined = isSl && isTp;

    if (isSl && !combined) roles.push('sl');
    if (isTp && !combined) roles.push('tp');

    // Balance wins over lot size ("Account size" is money, not volume).
    if (matchAny(text, RX.balance)) {
      roles.push('balance');
    } else if (matchAny(text, RX.lots)) {
      roles.push('lots');
    }

    if (matchAny(text, RX.riskPct)) roles.push('riskPct');
    if (!isSl && !isTp && !roles.length) {
      if (matchAny(text, RX.entry)) roles.push('entry');
      else if (matchAny(text, RX.price)) roles.push('price');
    }

    return roles;
  }

  /* ------------------------------------------------------------------- DOM */

  /**
   * Visible enough to be the trade panel the user is looking at: the control
   * and none of its ancestors are display:none / visibility:hidden / opacity:0.
   * Layout-less DOMs (tests) report no client rects for everything, so an
   * empty rect list is not treated as hidden on its own.
   */
  function isVisible(el) {
    if (!el || !el.ownerDocument) return false;
    const view = el.ownerDocument.defaultView;
    if (!view || !view.getComputedStyle) return true;
    try {
      let node = el;
      for (let depth = 0; node && node.nodeType === 1 && depth < 16; depth++, node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (!style) break;
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        if (Number(style.opacity) === 0) return false;
        if (node === el.ownerDocument.body) break;
      }
      return true;
    } catch {
      return false;
    }
  }

  function deepAll(selector, root) {
    const doc = root || document;
    const found = [];
    try { found.push(...doc.querySelectorAll(selector)); } catch { /* ignore */ }
    let walker;
    try { walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT); } catch { return found; }
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) found.push(...deepAll(selector, node.shadowRoot));
    }
    return found;
  }

  function readValue(el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return el.value ?? '';
    const now = attr(el, 'aria-valuenow');
    if (now) return now;
    return el.textContent ?? '';
  }

  const SKIP_TYPES = /^(hidden|checkbox|radio|file|submit|button|image|reset|range|color|password)$/i;

  /**
   * Scan a document for labelled trade controls.
   * Returns { fields: {role: [item]}, empty: [item], scanned: n }.
   */
  function collectFields(root) {
    const doc = root && root.querySelectorAll ? root : (root && root.ownerDocument) || document;
    const nodes = deepAll(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="spinbutton"], [role="textbox"]',
      doc
    );

    const fields = { entry: [], sl: [], tp: [], lots: [], balance: [], riskPct: [], amount: [], price: [] };
    const empty = [];
    const seen = new Set();

    for (const el of nodes) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (el.tagName === 'INPUT' && SKIP_TYPES.test(el.type || '')) continue;
      if (!isVisible(el)) continue;

      const label = labelFor(el);
      if (!label.text) continue;
      let roles = classifyLabel(label.text);
      const raw = readValue(el);

      // A currency marker next to a stop means it is a money readout (the loss
      // at stop), not the stop price. Take-profit money is profit, not risk,
      // so it is dropped rather than reused.
      if (looksLikeMoney(label.text) || looksLikeMoney(raw)) {
        if (roles.includes('sl')) {
          roles = roles.filter(role => role !== 'sl' && role !== 'tp');
          roles.push('amount');
        } else if (roles.includes('tp')) {
          roles = roles.filter(role => role !== 'tp');
        } else if (!roles.includes('lots') && !roles.includes('balance') && !roles.includes('riskPct')) {
          if (/\b(stop|loss|risk|amount|sl)\b/i.test(label.text)) roles.push('amount');
        }
      }

      if (!roles.length) continue;

      const value = parseNumber(raw);
      const item = { value, raw: String(raw ?? ''), label: label.text, source: label.source, roles, input: el };

      // Keep labelled-but-empty controls so the panel can explain what it saw.
      if (value === null) { empty.push(item); continue; }

      for (const role of roles) fields[role].push(item);
    }

    return { fields, empty, scanned: seen.size };
  }

  /** Rank candidates: explicit labels first, then the shortest label. */
  function best(list, { positive = true } = {}) {
    if (!list || !list.length) return null;
    const sourceRank = { 'aria-labelledby': 0, 'aria-label': 1, label: 2, placeholder: 3, name: 4, id: 5, 'data-attr': 6, title: 7, nearby: 8, unlabelled: 9 };
    const scored = list
      .filter(item => item && (positive ? (item.value !== null && Math.abs(item.value) > 0) : item.value !== null))
      .slice()
      .sort((a, b) => {
        const ra = sourceRank[a.source] ?? 9;
        const rb = sourceRank[b.source] ?? 9;
        if (ra !== rb) return ra - rb;
        return String(a.label).length - String(b.label).length;
      });
    return scored[0] || null;
  }

  function value(list, opts) {
    const item = best(list, opts);
    return item ? item.value : null;
  }

  /* --------------------------------------------------------------- symbols */

  const SYMBOLS = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/NZD',
    'BTC/USD', 'ETH/USD', 'XRP/USD', 'NAS100', 'SPX', 'US30', 'GER40', 'XAU/USD', 'XAG/USD'
  ];

  const compact = symbol => String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /** "xauusd" -> "XAU/USD"; unknown stays as typed. */
  function normaliseSymbol(symbol) {
    const key = compact(symbol);
    if (!key) return '';
    const hit = SYMBOLS.find(s => compact(s) === key);
    return hit || String(symbol).trim().toUpperCase();
  }

  /**
   * Money per 1.0 price move per 1 standard lot, in account currency.
   * `assumed` marks values we suggest but cannot prove from the terminal.
   * Returns { value, source, assumed, note }.
   */
  function pointValueFor(symbol, price) {
    const key = compact(symbol);
    if (!key) return { value: null, source: 'none', assumed: false, note: '' };

    const usdQuote = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'];
    if (usdQuote.includes(key)) {
      return {
        value: 100000, source: 'standard-lot', assumed: false,
        note: '1 standard lot = 100,000 units quoted in USD, so 1.0 of price = $100,000.'
      };
    }

    const usdBase = ['USDJPY', 'USDCHF', 'USDCAD'];
    if (usdBase.includes(key)) {
      const p = parsePositive(price);
      if (p) {
        return {
          value: 100000 / p, source: 'standard-lot', assumed: false,
          note: `1 standard lot = 100,000 USD, so 1.0 of price = 100,000 / ${p}.`
        };
      }
      return { value: null, source: 'needs-price', assumed: false, note: 'Enter the entry price so the USD value can be derived.' };
    }

    const metals = { XAUUSD: [100, 'oz'], XAGUSD: [5000, 'oz'] };
    if (metals[key]) {
      const [units, unit] = metals[key];
      return {
        value: units, source: 'typical-contract', assumed: true,
        note: `Typical Exness contract is ${units} ${unit} per lot. Confirm this against your account's contract specification.`
      };
    }

    return { value: null, source: 'unknown', assumed: false, note: 'No built-in contract size for this instrument. Enter the value per 1.0 move per lot.' };
  }

  function symbolFromText(text, candidates) {
    const list = candidates && candidates.length ? candidates : SYMBOLS;
    const hay = String(text || '').toUpperCase().replace(/[\s._\-/]/g, '');
    if (!hay) return '';
    for (const symbol of list) {
      if (hay.includes(compact(symbol))) return symbol;
    }
    return '';
  }

  /* --------------------------------------------------------------- resolve */

  /**
   * Turn scanned fields into a draft trade.
   * direction: 'buy' | 'sell' | '' (empty = infer)
   * extra.textAmount: money at risk scraped from nearby ticket text, used only
   *   when no labelled amount control exists.
   */
  function resolveTrade(fields, direction, symbol, extra) {
    const dir = direction === 'sell' || direction === 'buy' ? direction : '';

    let entry = value(fields.entry);
    if (entry === null) entry = value(fields.price);
    const lotsItem = best(fields.lots);
    const lots = lotsItem ? lotsItem.value : null;
    const balance = value(fields.balance);
    const riskPercent = value(fields.riskPct);

    let sl = value(fields.sl);
    let tp = value(fields.tp);

    // Price fields that are neither entry nor a named SL/TP can still tell us
    // the stop/target side, but only when we know the direction.
    if (entry !== null && dir) {
      for (const item of fields.price) {
        const price = item.value;
        if (price === null || price === entry) continue;
        if (dir === 'buy') {
          if (price > entry && tp === null) tp = price;
          if (price < entry && sl === null) sl = price;
        } else {
          if (price < entry && tp === null) tp = price;
          if (price > entry && sl === null) sl = price;
        }
      }
    }

    // Money at risk, when the ticket states it.
    let stopAmount = null;
    let stopAmountNote = '';
    const amountItem = best(fields.amount);
    const textAmount = extra && Number(extra.textAmount) > 0 ? Math.abs(Number(extra.textAmount)) : null;
    if (amountItem && amountItem.value !== null) {
      const abs = Math.abs(amountItem.value);
      if (balance !== null && abs >= balance * 0.5) {
        // Looks like the balance after the stop, not the loss itself.
        stopAmount = Math.max(0, balance - abs);
        stopAmountNote = 'read as the post-stop balance';
      } else {
        stopAmount = abs;
        stopAmountNote = 'read as the loss at stop';
      }
    } else if (textAmount) {
      // The ticket often prints the loss as text rather than an input.
      stopAmount = textAmount;
      stopAmountNote = 'found as text next to the stop';
    }

    const distance = entry !== null && sl !== null ? Math.abs(entry - sl) : null;

    // 1) measured from the ticket, 2) contract-size model, 3) nothing.
    let pointValue = null;
    let pointValueSource = 'none';
    let assumed = false;
    let pointValueNote = '';

    if (stopAmount && distance && lots) {
      pointValue = stopAmount / (distance * lots);
      pointValueSource = 'measured';
      pointValueNote = 'Measured from the tool: stop loss amount / (price distance × lots).';
    } else {
      const model = pointValueFor(symbol, entry);
      pointValue = model.value;
      pointValueSource = model.source;
      assumed = model.assumed;
      pointValueNote = model.note;
    }

    return {
      direction: dir,
      entry, sl, tp, lots, balance, riskPercent,
      stopAmount, stopAmountNote,
      distance,
      pointValue,
      pointValueSource,
      pointValueAssumed: assumed,
      pointValueNote,
      sources: {
        entry: best(fields.entry)?.label || best(fields.price)?.label || '',
        sl: best(fields.sl)?.label || '',
        tp: best(fields.tp)?.label || '',
        lots: lotsItem?.label || '',
        balance: best(fields.balance)?.label || '',
        riskPercent: best(fields.riskPct)?.label || '',
        amount: amountItem?.label || (textAmount ? 'ticket text' : '')
      },
      lotInput: lotsItem?.input || null
    };
  }

  /** Human-readable "what we picked up" summary for the review panel. */
  function describeDetection(resolved) {
    const bits = [];
    const push = (name, val, source) => {
      if (val === null || val === undefined || val === '') return;
      bits.push(`${name} ${val}${source ? ` (${source})` : ''}`);
    };
    push('lots', resolved.lots, resolved.sources.lots);
    push('entry', resolved.entry, resolved.sources.entry);
    push('SL', resolved.sl, resolved.sources.sl);
    push('TP', resolved.tp, resolved.sources.tp);
    push('balance', resolved.balance, resolved.sources.balance);
    push('risk %', resolved.riskPercent, resolved.sources.riskPercent);
    push('stop amount', resolved.stopAmount, resolved.sources.amount);
    return bits.join(' · ');
  }

  /* ------------------------------------------------------------ lot sizing */

  /**
   * Lot size for a fixed per-trade risk.
   * Returns { ok, reason, riskAmount, stopDistance, raw, suggested, riskAtSuggested }.
   */
  function recommendLots({ balance, riskPercent, pointValue, entry, sl, step, maxLots }) {
    const fail = reason => ({ ok: false, reason, riskAmount: 0, stopDistance: 0, raw: 0, suggested: 0, riskAtSuggested: 0 });

    const b = Number(balance);
    const rp = Number(riskPercent);
    const pv = Number(pointValue);
    const e = Number(entry);
    const s = Number(sl);
    const inc = Number(step);
    const max = Number(maxLots) > 0 ? Number(maxLots) : Infinity;

    if (!(b > 0)) return fail('Enter the account balance.');
    if (!(rp > 0) || rp > 100) return fail('Enter a risk per trade between 0 and 100%.');
    if (!(pv > 0)) return fail('Enter the value per 1.0 price move for one lot.');
    if (!(Number.isFinite(e) && Number.isFinite(s) && e > 0 && s > 0)) return fail('Enter both the entry and the stop loss price.');
    if (e === s) return fail('Entry and stop loss are identical, so the stop distance is zero.');
    if (!(inc > 0)) return fail('Enter a lot increment greater than zero.');

    const stopDistance = Math.abs(e - s);
    const riskAmount = b * rp / 100;
    const raw = riskAmount / (stopDistance * pv);

    if (!Number.isFinite(raw) || raw <= 0) return fail('The stop distance or contract value is too small to size a trade.');

    let suggested = Math.floor(raw / inc + 1e-9) * inc;
    if (suggested > max) suggested = Math.floor(max / inc + 1e-9) * inc;

    return {
      ok: suggested > 0,
      reason: suggested > 0
        ? ''
        : `Risk budget of ${riskAmount.toFixed(2)} only allows ${raw.toFixed(4)} lots, below the ${inc} increment.`,
      riskAmount,
      stopDistance,
      raw,
      suggested: Number(suggested.toFixed(8)),
      riskAtSuggested: suggested * stopDistance * pv
    };
  }

  return {
    parseNumber,
    parsePositive,
    labelFor,
    classifyLabel,
    looksLikeMoney,
    collectFields,
    isVisible,
    deepAll,
    best,
    normaliseSymbol,
    pointValueFor,
    symbolFromText,
    resolveTrade,
    describeDetection,
    recommendLots,
    SYMBOLS
  };
});
