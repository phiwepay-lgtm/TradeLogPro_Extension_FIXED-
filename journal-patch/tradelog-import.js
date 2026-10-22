/* TradeLog Pro — journal-side receiver for trades sent by the Chrome extension.
 *
 * The extension cannot make a trade *look* closed on its own: the journal paints
 * exit "-", P&L "+$0.00", R "0R" and status "Open" unless the row it stores has
 * an exit. This file is the other half of the fix, for the journal app
 * (`indexhtml-olive-delta.vercel.app`), which lives outside the extension repo.
 *
 * It is dependency-free and does two things:
 *   1. `compute(trade)` — normalise a trade and work out exit, status, P&L and R.
 *   2. `install({ onImport })` — listen for `import-trade`, hand the normalised
 *      trade to your journal, and post the `import-result` ack the extension's
 *      journal-bridge.js is waiting for.
 *
 * See docs/JOURNAL-SIDE.md for the three lines to add to the journal page.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TLJournalImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SOURCE_OUT = 'tradelog-exness-extension';
  const SOURCE_IN = 'tradelog-journal';

  /** First number-ish value among the given keys, as a positive number. */
  function pick(trade, keys) {
    for (const key of keys) {
      const value = trade?.[key];
      if (value === null || value === undefined || value === '') continue;
      const number = Number(String(value).replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(number) && number !== 0) return Math.abs(number);
    }
    return 0;
  }

  /** Money per 1.0 price move per lot: sent by the panel, else inferred. */
  function pointValueOf(trade) {
    const explicit = pick(trade, ['pointValue', 'contractSize', 'pipValue']);
    if (explicit > 0) return explicit;

    // riskAmount = |entry - sl| * lots * pointValue, so it can be inverted.
    const riskAmount = pick(trade, ['riskAmount']);
    const distance = Math.abs(pick(trade, ['entry', 'entryPrice']) - pick(trade, ['sl', 'stop', 'stopLoss']));
    const lots = pick(trade, ['lots', 'lotSize', 'volume']);
    if (riskAmount > 0 && distance > 0 && lots > 0) return riskAmount / (distance * lots);

    return 0;
  }

  /** Close reason from where price actually left the trade. */
  function statusOf({ exit, entry, sl, tp, open }) {
    if (open || !exit || !entry) return 'Open';
    const stopDistance = Math.abs(entry - sl);
    const tolerance = stopDistance > 0 ? stopDistance * 0.15 : 0;
    const near = (a, b) => tolerance > 0 && Math.abs(a - b) <= tolerance;
    if (near(exit, entry)) return 'Break Even';
    if (sl && near(exit, sl)) return 'Stop Loss';
    if (tp && near(exit, tp)) return 'Full TP';
    return 'Manual Close';
  }

  const MANAGEMENT_FOR = {
    'Break Even': 'Moved to BE',
    'Stop Loss': 'Stop Loss Hit',
    'Full TP': 'Full TP',
    'Manual Close': 'Manual Close',
    Open: ''
  };

  /**
   * Turn an extension trade into the row the journal should store.
   * Every derived value yields to anything the trade already carries, so a
   * broker-sourced P&L is never overwritten by this arithmetic.
   */
  function compute(trade) {
    if (!trade || typeof trade !== 'object') return null;

    const entry = pick(trade, ['entry', 'entryPrice']);
    const sl = pick(trade, ['sl', 'stop', 'stopLoss']);
    const tp = pick(trade, ['tp', 'target', 'takeProfit']);
    const exit = pick(trade, ['exit', 'exitPrice', 'closePrice']);
    const lots = pick(trade, ['lots', 'lotSize', 'volume']);
    const dir = String(trade.dir || trade.direction || 'buy').toLowerCase();
    const outcome = String(trade.outcome || '').toLowerCase();

    const open = !exit || outcome === 'pending' || outcome === 'open';
    const pointValue = pointValueOf(trade);
    const sign = dir === 'sell' || dir === 'short' ? -1 : 1;

    const riskAmount = entry && sl && lots && pointValue
      ? Math.abs(entry - sl) * pointValue * lots
      : 0;

    let pnl = Number(trade.pnl ?? trade.profit ?? 0);
    if (!Number.isFinite(pnl)) pnl = 0;
    if (!open && pnl === 0 && entry && lots && pointValue) {
      pnl = (exit - entry) * sign * lots * pointValue;
      pnl = Number(pnl.toFixed(2));
    }
    if (open) pnl = 0;

    let r = Number(trade.r ?? trade.rr ?? trade.rMultiple ?? 0);
    if (!Number.isFinite(r)) r = 0;
    if (!open && r === 0 && riskAmount > 0) r = Number((pnl / riskAmount).toFixed(3));
    if (open) r = 0;

    const openedAt = trade.date || trade.openedAt || trade.createdAt || '';
    const closedAt = trade.closedAt || trade.exitAt || '';
    let durationMinutes = Number(trade.durationMinutes ?? trade.duration ?? 0);
    if (!Number.isFinite(durationMinutes)) durationMinutes = 0;
    if (!durationMinutes && openedAt && closedAt) {
      const span = (new Date(closedAt) - new Date(openedAt)) / 60000;
      if (Number.isFinite(span) && span > 0) durationMinutes = Math.round(span);
    }
    if (open) durationMinutes = 0;

    const status = open ? 'Open' : statusOf({ exit, entry, sl, tp });
    const management = trade.management || trade.mgmt || MANAGEMENT_FOR[status] || '';

    return {
      ...trade,
      // Stored shape the journal's table reads.
      entry,
      sl,
      tp,
      exit: open ? 0 : exit,
      lots,
      dir: sign < 0 ? 'sell' : 'buy',
      date: openedAt,
      closedAt: open ? '' : closedAt,
      status,
      pnl,
      r,
      durationMinutes,
      management,
      pointValue,
      riskAmount,
      // Outcome kept in step with the numbers, so the badge agrees with the row.
      outcome: open ? 'pending' : outcome || (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be'),
      importedFrom: 'extension'
    };
  }

  /**
   * Listen for trades from journal-bridge.js.
   *
   * `onImport(trade)` must persist the trade and return a promise (or a value);
   * if it throws, no ack is posted and the extension retries.
   * `isDuplicate(externalId)` should return true for trades already stored.
   */
  function install({ onImport, isDuplicate, window: win, timeoutMs = 10000 } = {}) {
    const scope = win || (typeof window !== 'undefined' ? window : null);
    if (!scope || typeof onImport !== 'function') {
      throw new Error('TLJournalImport.install needs a window and an onImport function.');
    }

    const seen = new Set();

    const handler = async event => {
      if (event.source !== scope) return;
      const message = event.data;
      if (!message || message.source !== SOURCE_OUT || message.type !== 'import-trade') return;

      const { requestId, trade } = message;
      const normalised = compute(trade);
      let ok = false;

      if (normalised) {
        const id = normalised.externalId || normalised.id || '';
        const duplicate = (id && seen.has(id)) || (id && typeof isDuplicate === 'function' && isDuplicate(id));
        if (duplicate) {
          ok = true; // already stored: acknowledge, do not double up
        } else {
          // Remember the id *before* awaiting: the bridge retries every 500ms,
          // and a slow store must not turn one trade into two rows.
          if (id) seen.add(id);
          try {
            await onImport(normalised);
            ok = true;
          } catch (error) {
            console.error('[TradeLog] import failed', error);
            if (id) seen.delete(id); // a real failure must be retryable
            ok = false;
          }
        }
      }

      scope.postMessage({ source: SOURCE_IN, type: 'import-result', requestId, ok }, scope.location.origin);
    };

    scope.addEventListener('message', handler);
    return {
      handle: handler,
      stop: () => scope.removeEventListener('message', handler)
    };
  }

  return { compute, install, statusOf, MANAGEMENT_FOR, SOURCE_OUT, SOURCE_IN };
});
