/* The journal-side receiver (journal-patch/tradelog-import.js) must turn an
 * extension trade into a row that reads as closed, not as an open position.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../journal-patch/tradelog-import.js');

const gold = {
  externalId: 'tlx-1',
  symbol: 'XAU/USD',
  dir: 'sell',
  entry: 4120.586,
  sl: 4123.12,
  tp: 4117.995,
  lots: 0.02,
  pointValue: 100,
  date: '2026-10-08T09:00:00.000Z',
  outcome: 'win',
  exec: 'VHB + Engulf Trigger',
  bias: 'Continuation'
};

test('a winning short is journalled with its money and R', () => {
  const row = TL.compute({ ...gold, exit: 4117.995, closedAt: '2026-10-08T09:25:00.000Z' });

  assert.equal(row.exit, 4117.995);
  assert.equal(row.status, 'Full TP');
  assert.ok(Math.abs(row.pnl - 5.18) < 0.01, `P&L ${row.pnl} should be +$5.18`);
  assert.ok(Math.abs(row.r - 1) < 0.03, `R ${row.r} should be about +1R`);
  assert.equal(row.durationMinutes, 25);
  assert.equal(row.outcome, 'win');
  assert.equal(row.management, 'Full TP');
});

test('a stop-out is negative money and −1R', () => {
  const row = TL.compute({ ...gold, exit: 4123.12, outcome: 'loss' });

  assert.equal(row.status, 'Stop Loss');
  assert.ok(row.pnl < 0);
  assert.ok(Math.abs(row.r + 1) < 0.02, `R ${row.r} should be about −1R`);
  assert.equal(row.management, 'Stop Loss Hit');
});

test('an exit at entry reads as break even and $0.00', () => {
  const row = TL.compute({ ...gold, exit: 4120.586, outcome: 'be' });
  assert.equal(row.status, 'Break Even');
  assert.equal(row.pnl, 0);
  assert.equal(row.management, 'Moved to BE');
});

test('any other exit is a manual close', () => {
  const row = TL.compute({ ...gold, exit: 4119.5, outcome: 'win' });
  assert.equal(row.status, 'Manual Close');
  assert.ok(row.pnl > 0);
  assert.equal(row.management, 'Manual Close');
});

test('without an exit the trade stays open, whatever the outcome says', () => {
  const row = TL.compute({ ...gold, exit: 0, outcome: 'win' });
  assert.equal(row.status, 'Open');
  assert.equal(row.exit, 0);
  assert.equal(row.pnl, 0);
  assert.equal(row.r, 0);
  assert.equal(row.durationMinutes, 0);
  assert.equal(row.outcome, 'pending', 'the badge is corrected to match the row');
});

test('a pending outcome ignores an exit that was typed anyway', () => {
  const row = TL.compute({ ...gold, exit: 4117.995, outcome: 'pending' });
  assert.equal(row.status, 'Open');
  assert.equal(row.pnl, 0);
});

test('a broker-supplied P&L is never overwritten', () => {
  const row = TL.compute({ ...gold, exit: 4117.995, pnl: -99.5, r: -3.1 });
  assert.equal(row.pnl, -99.5);
  assert.equal(row.r, -3.1);
});

test('the contract value can be inferred from the risk that was sent', () => {
  // riskAmount 5.06 over a 2.534 stop on 0.02 lots => 100 per 1.0 per lot.
  const row = TL.compute({
    ...gold, pointValue: undefined, riskAmount: 5.068, exit: 4117.995
  });
  assert.ok(Math.abs(row.pointValue - 100) < 0.01, `inferred ${row.pointValue}`);
  assert.ok(Math.abs(row.pnl - 5.18) < 0.02);
});

test('an unknown instrument (no point value, no risk) still journals, at zero money', () => {
  const row = TL.compute({
    externalId: 'tlx-2', symbol: 'GER40', dir: 'buy', entry: 19000, sl: 18900, tp: 19200,
    exit: 19100, lots: 1, date: '2026-10-08T09:00:00.000Z', outcome: 'win'
  });
  assert.equal(row.exit, 19100);
  assert.equal(row.status, 'Manual Close');
  assert.equal(row.pnl, 0, 'no honest way to price it without a contract value');
  assert.equal(row.outcome, 'win');
});

test('field aliases from other senders are understood', () => {
  const row = TL.compute({
    externalId: 'tlx-3', symbol: 'EUR/USD', direction: 'short',
    entryPrice: 1.0850, stopLoss: 1.0870, takeProfit: 1.0790,
    exitPrice: 1.0790, lotSize: 0.5, pointValue: 100000,
    openedAt: '2026-10-08T09:00:00.000Z', closedAt: '2026-10-08T13:00:00.000Z'
  });
  assert.equal(row.pnl, 300, '50 pips x 0.5 lots x $10/pip');
  assert.equal(row.r, 3);
  assert.equal(row.durationMinutes, 240);
  assert.equal(row.status, 'Full TP');
  assert.equal(row.dir, 'sell');
});

/* ------------------------------------------------------------ the handshake */

function fakeWindow() {
  const listeners = [];
  const posted = [];
  const scope = {
    location: { origin: 'https://journal.test' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    removeEventListener: (type, fn) => {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    postMessage: (data, target) => posted.push({ data, target })
  };
  // `source` defaults to the page itself; pass another object to fake a frame.
  scope.fire = (data, source) => listeners.forEach(fn => fn({ source: source === undefined ? scope : source, data }));
  scope.posted = posted;
  return scope;
}

test('an import is stored and acknowledged with its requestId', async () => {
  const win = fakeWindow();
  const stored = [];
  TL.install({ window: win, onImport: trade => stored.push(trade) });

  win.fire({ source: TL.SOURCE_OUT, type: 'import-trade', requestId: 'req-1', trade: gold });

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'Open', 'this trade had no exit');
  assert.deepEqual(win.posted, [{
    data: { source: TL.SOURCE_IN, type: 'import-result', requestId: 'req-1', ok: true },
    target: 'https://journal.test'
  }]);
});

test('a trade already in the journal is acknowledged but not stored twice', async () => {
  const win = fakeWindow();
  let calls = 0;
  TL.install({ window: win, onImport: () => { calls += 1; } });

  const message = { source: TL.SOURCE_OUT, type: 'import-trade', requestId: 'req-1', trade: gold };
  win.fire(message);
  win.fire({ ...message, requestId: 'req-2' });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(calls, 1, 'the retry from the bridge is not a second trade');
  assert.equal(win.posted.length, 2);
  assert.equal(win.posted[1].data.ok, true);
});

test('a failing store does not ack, so the extension retries', async () => {
  const win = fakeWindow();
  const quiet = console.error;
  console.error = () => {};
  TL.install({ window: win, onImport: () => { throw new Error('storage full'); } });

  win.fire({ source: TL.SOURCE_OUT, type: 'import-trade', requestId: 'req-9', trade: gold });
  await new Promise(resolve => setTimeout(resolve, 20));
  console.error = quiet;

  assert.equal(win.posted.length, 1);
  assert.equal(win.posted[0].data.ok, false);
});

test('another site cannot post a trade in through the bridge', async () => {
  const win = fakeWindow();
  let calls = 0;
  TL.install({ window: win, onImport: () => { calls += 1; } });

  // Same shape, but the event did not come from this window.
  win.fire({ source: TL.SOURCE_OUT, type: 'import-trade', requestId: 'x', trade: gold }, {});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 0);
});
