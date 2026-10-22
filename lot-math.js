/* TradeLog Pro — numbers and position sizing for the manual panel.
 *
 * Pure, chrome-free logic so it can be unit tested with `node --test`.
 * Loaded as the first content script, exposes `globalThis.TLXMath`.
 *
 * Note: this extension no longer scans the terminal for values. Everything is
 * typed or pasted by hand; this module only cleans up what was pasted and does
 * the lot arithmetic.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TLXMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NBSP = /[\u00a0\u2007\u2009\u202f]/g;

  /**
   * Parse a pasted price/size that may look like 1234.56, 1,234.56, 1.234,56,
   * "1 234,56", "$25.00", "-25,00", "(25.00)" or "1.0842 USD".
   * Returns a signed finite number, or null.
   */
  function parseNumber(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).replace(NBSP, ' ').trim();
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

  /** Positive magnitude only (prices, sizes). Zero and negatives -> null. */
  function parsePositive(raw) {
    const num = parseNumber(raw);
    return num !== null && num > 0 ? num : null;
  }

  /* ------------------------------------------------------------- symbols */

  const SYMBOLS = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/NZD',
    'BTC/USD', 'ETH/USD', 'XRP/USD', 'NAS100', 'SPX', 'US30', 'GER40', 'XAU/USD', 'XAG/USD'
  ];

  const compact = symbol => String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /** "xauusd" -> "XAU/USD"; anything unknown is upper-cased and left alone. */
  function normaliseSymbol(symbol) {
    const key = compact(symbol);
    if (!key) return '';
    const hit = SYMBOLS.find(s => compact(s) === key);
    return hit || String(symbol).trim().toUpperCase();
  }

  /**
   * Money per 1.0 price move per standard lot, in account currency.
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

  /** Risk in account currency for a given size, or null when it cannot be known. */
  function riskFor({ lots, entry, sl, pointValue }) {
    const size = Number(lots);
    const e = Number(entry);
    const s = Number(sl);
    const pv = Number(pointValue);
    if (!(size > 0) || !(pv > 0) || !Number.isFinite(e) || !Number.isFinite(s) || e === s) return null;
    return Math.abs(e - s) * pv * size;
  }

  /** Reward:risk for the reviewed setup, or null when incomplete. */
  function rewardRisk({ entry, sl, tp }) {
    const e = Number(entry);
    const s = Number(sl);
    const t = Number(tp);
    if (![e, s, t].every(value => Number.isFinite(value) && value > 0)) return null;
    const risk = Math.abs(e - s);
    if (!(risk > 0)) return null;
    return Math.abs(t - e) / risk;
  }

  return {
    parseNumber,
    parsePositive,
    normaliseSymbol,
    pointValueFor,
    recommendLots,
    riskFor,
    rewardRisk,
    SYMBOLS
  };
});
