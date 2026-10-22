# Wiring the fix into the journal (the other half)

The extension now sends where a trade closed, but the journal still has to store (or
compute) the result. Two places are involved and both live in the **journal app**
(`https://indexhtml-olive-delta.vercel.app/`), which is not in this repository.

- **A. Its import receiver** — the `message` listener that answers `import-trade`.
  Without it, new trades keep arriving without an exit.
- **B. Its trade table / row renderer** — it must show a stored `exit`, `pnl` and `r`
  rather than falling back to `—`, `+$0.00`, `0R`, `Open`.

`journal-patch/tradelog-import.js` in this repo does both halves of the data work and is
unit-tested. Drop it into the journal's `index.html` (or a `<script src>` next to it).

## 1. Load it

```html
<script src="/tradelog-import.js"></script>
```

## 2. Answer the extension

Find the existing listener in the journal's `index.html` — it looks roughly like this:

```js
window.addEventListener('message', event => {
  if (event.data?.type !== 'import-trade') return;
  const trade = event.data.trade;
  addTrade({ /* …whatever it does today… */ });
  window.postMessage({ source: 'tradelog-journal', type: 'import-result',
                       requestId: event.data.requestId, ok: true }, location.origin);
});
```

Replace it with one call. `onImport` is whatever already saves a trade in your app
(`addTrade`, `store.push`, a fetch to your backend — any of them):

```js
TLJournalImport.install({
  // Persist the normalised trade. Return a promise if the save is async.
  onImport: trade => addTrade(trade),

  // Optional: stop a second copy of a trade you already have.
  isDuplicate: externalId => trades.some(t => t.externalId === externalId)
});
```

`compute()` fills in the fields the table reads, in the shape the older, broker-imported
rows already use:

| field | meaning |
|---|---|
| `exit` | close price (the thing that makes a row read as closed) |
| `status` | `Full TP` · `Stop Loss` · `Break Even` · `Manual Close` · `Open` |
| `pnl` | money result, derived from `exit − entry` × lots × contract value |
| `r` | result in risk multiples |
| `durationMinutes` | how long the trade was open |
| `management` | management tag, filled from where price exited when blank |

It never overwrites a P&L or R that a trade already carries, so anything imported from a
broker keeps its own numbers.

## 3. Show it in the table

Where a row is built today, prefer the stored result and only fall back when it is absent:

```js
const exit = trade.exit || null;
const pnl  = trade.exit ? Number(trade.pnl || 0) : null;
const r    = trade.exit ? Number(trade.r || 0)   : null;
const dur  = trade.durationMinutes ? formatDuration(trade.durationMinutes) : '—';
const status = trade.exit ? (trade.status || 'Closed') : 'Open';

// exit cell
exit ? exit.toFixed(3) : '—'
// P&L cell — the bug: this used to fall back to +$0.00 for closed trades
pnl === null ? '—' : `${pnl < 0 ? '-' : '+'}$${Math.abs(pnl).toFixed(2)}`
// R cell
r === null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`
```

Two details that make the difference between "$0.00 / Open" and a real row:

1. Test **`trade.exit`**, not `trade.pnl`. A genuine break-even has `pnl === 0` and must
   still render as `Break Even`, not as an open position.
2. Keep the row's `outcome`/badge in step with the numbers — `compute()` already rewrites
   an outcome of `win` with no exit to `pending`.

## 4. Rows logged before this fix

Those trades were sent without an exit, so no arithmetic can recover them — there is
nothing recorded about where price left. They have to be corrected by hand (edit the
trade and add the exit), or re-imported from the broker statement. Anything logged from
now on carries the exit.

## How the handshake behaves

`journal-bridge.js` (in the extension) retries three times, 500 ms apart, and only clears
the stored trade once the page answers `{ source: 'tradelog-journal', type: 'import-result',
requestId, ok: true }`. `TLJournalImport.install` posts exactly that, and:

- de-duplicates on `externalId`, including a retry that arrives while the first save is
  still in flight — so a slow store cannot create two identical rows;
- does **not** acknowledge when the save throws, so the extension retries and the trade is
  not silently lost;
- ignores messages that did not come from the journal's own window.

## Verifying it

```bash
npm test          # 61 tests, including tests/journal-patch.test.js
```

or paste this into the journal's console and the arithmetic is printed for a sample trade:

```js
console.log(TLJournalImport.compute({
  externalId: 'demo', symbol: 'XAU/USD', dir: 'sell',
  entry: 4120.586, sl: 4123.12, tp: 4117.995, exit: 4117.995,
  lots: 0.02, pointValue: 100, date: '2026-10-08T09:00:00Z', closedAt: '2026-10-08T09:25:00Z'
}));
// { exit: 4117.995, status: 'Full TP', pnl: 5.18, r: 1.022, durationMinutes: 25, … }
```
