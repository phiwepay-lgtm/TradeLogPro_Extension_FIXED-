/* Unit tests for trade-detect.js — run with `node --test tests/`.
 * Pure helpers need no dependencies; DOM tests are skipped when jsdom is
 * not installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../trade-detect.js');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch { /* optional */ }
const domTest = JSDOM ? test : test.skip;

/* ------------------------------------------------------------------ numbers */

test('parseNumber handles plain and grouped prices', () => {
  assert.equal(D.parseNumber('1.0842'), 1.0842);
  assert.equal(D.parseNumber('1,084.20'), 1084.2);
  assert.equal(D.parseNumber('$1,234.56'), 1234.56);
  assert.equal(D.parseNumber('0.10'), 0.1);
  assert.equal(D.parseNumber('  '), null);
  assert.equal(D.parseNumber('abc'), null);
});

test('parseNumber handles European formatting', () => {
  assert.equal(D.parseNumber('1.234,56'), 1234.56);
  assert.equal(D.parseNumber('1 234,56'), 1234.56);
  assert.equal(D.parseNumber('1,0842'), 1.0842); // decimal comma, 4 places
  assert.equal(D.parseNumber('1,084'), 1084);    // thousands group
});

test('parseNumber keeps signs', () => {
  assert.equal(D.parseNumber('-25.00'), -25);
  assert.equal(D.parseNumber('−25,00'), -25);
  assert.equal(D.parseNumber('(25.00)'), -25);
  assert.equal(D.parseNumber('-$18.40'), -18.4);
});

test('parsePositive rejects zero and negatives', () => {
  assert.equal(D.parsePositive('0'), null);
  assert.equal(D.parsePositive('-5'), null);
  assert.equal(D.parsePositive('12.5'), 12.5);
});

/* ------------------------------------------------------- label classification */

test('classifyLabel separates stop, target, entry, size and balance', () => {
  assert.deepEqual(D.classifyLabel('Stop Loss'), ['sl']);
  assert.deepEqual(D.classifyLabel('SL (price)'), ['sl']);
  assert.deepEqual(D.classifyLabel('Take Profit'), ['tp']);
  assert.deepEqual(D.classifyLabel('TP'), ['tp']);
  assert.deepEqual(D.classifyLabel('Volume (lots)'), ['lots']);
  assert.deepEqual(D.classifyLabel('Account balance'), ['balance']);
});

test('classifyLabel does not mistake balance for lot size', () => {
  const roles = D.classifyLabel('Account size');
  assert.deepEqual(roles, ['balance']);
  assert.ok(!roles.includes('lots'));
});

test('classifyLabel needs a real percent for risk', () => {
  assert.deepEqual(D.classifyLabel('Risk %'), ['riskPct']);
  assert.deepEqual(D.classifyLabel('Risk per trade (%)'), ['riskPct']);
  // A money risk figure must not be read as a percentage.
  assert.ok(!D.classifyLabel('Risk amount $25').includes('riskPct'));
});

test('classifyLabel treats SL/TP in one label as ambiguous', () => {
  const roles = D.classifyLabel('SL/TP');
  assert.ok(!roles.includes('sl'));
  assert.ok(!roles.includes('tp'));
});

/* -------------------------------------------------------------- lot sizing */

test('recommendLots sizes a forex trade', () => {
  // $10,000 account, 1% risk = $100. 20 pip stop (0.0020) on EUR/USD:
  // 100 / (0.0020 * 100000) = 0.5 lots.
  const result = D.recommendLots({
    balance: 10000, riskPercent: 1, pointValue: 100000,
    entry: 1.0850, sl: 1.0830, step: 0.01
  });
  assert.equal(result.ok, true);
  assert.equal(result.suggested, 0.5);
  assert.equal(result.riskAmount, 100);
  assert.ok(Math.abs(result.stopDistance - 0.002) < 1e-12);
  assert.ok(Math.abs(result.riskAtSuggested - 100) < 1e-9);
});

test('recommendLots floors to the lot increment', () => {
  // 100 / (0.0020 * 100000) = 0.5 -> but risk 0.75% gives 0.375 -> 0.37
  const result = D.recommendLots({
    balance: 10000, riskPercent: 0.75, pointValue: 100000,
    entry: 1.0850, sl: 1.0830, step: 0.01
  });
  assert.equal(result.ok, true);
  assert.equal(result.suggested, 0.37);
});

test('recommendLots works for gold', () => {
  // $100 risk, $5 stop distance, $100 per 1.0 move per lot -> 0.2 lots
  const result = D.recommendLots({
    balance: 10000, riskPercent: 1, pointValue: 100,
    entry: 2400, sl: 2395, step: 0.01
  });
  assert.equal(result.suggested, 0.2);
});

test('recommendLots rejects unusable input instead of returning nonsense', () => {
  const noStop = D.recommendLots({ balance: 10000, riskPercent: 1, pointValue: 100000, entry: 1.085, sl: 1.085, step: 0.01 });
  assert.equal(noStop.ok, false);
  assert.match(noStop.reason, /identical/i);

  const noPointValue = D.recommendLots({ balance: 10000, riskPercent: 1, pointValue: 0, entry: 1.085, sl: 1.083, step: 0.01 });
  assert.equal(noPointValue.ok, false);

  const tooTight = D.recommendLots({ balance: 100, riskPercent: 0.1, pointValue: 100000, entry: 1.085, sl: 1.0005, step: 0.01 });
  assert.equal(tooTight.ok, false);
  assert.match(tooTight.reason, /below the 0.01 increment/i);

  const badRisk = D.recommendLots({ balance: 10000, riskPercent: 150, pointValue: 100000, entry: 1.085, sl: 1.083, step: 0.01 });
  assert.equal(badRisk.ok, false);
});

test('recommendLots caps at the broker maximum', () => {
  const result = D.recommendLots({
    balance: 100000, riskPercent: 2, pointValue: 100000,
    entry: 1.0850, sl: 1.0830, step: 0.01, maxLots: 5
  });
  assert.equal(result.suggested, 5);
});

/* ------------------------------------------------------- contract values */

test('pointValueFor knows USD-quoted majors exactly', () => {
  const pv = D.pointValueFor('EUR/USD');
  assert.equal(pv.value, 100000);
  assert.equal(pv.assumed, false);
});

test('pointValueFor derives USD-base pairs from price', () => {
  const pv = D.pointValueFor('USD/JPY', 150);
  assert.ok(Math.abs(pv.value - 100000 / 150) < 1e-9);

  const noPrice = D.pointValueFor('USD/JPY');
  assert.equal(noPrice.value, null);
  assert.equal(noPrice.source, 'needs-price');
});

test('pointValueFor marks metals as an assumption', () => {
  const gold = D.pointValueFor('XAU/USD');
  assert.equal(gold.value, 100);
  assert.equal(gold.assumed, true);
});

test('pointValueFor refuses to guess unknown instruments', () => {
  assert.equal(D.pointValueFor('NAS100').value, null);
  assert.equal(D.pointValueFor('').value, null);
});

test('normaliseSymbol maps compact broker names', () => {
  assert.equal(D.normaliseSymbol('eurusd'), 'EUR/USD');
  assert.equal(D.normaliseSymbol('XAUUSD'), 'XAU/USD');
  assert.equal(D.normaliseSymbol('BTC/USD'), 'BTC/USD');
  assert.equal(D.normaliseSymbol(''), '');
});

/* ------------------------------------------------------------------- DOM */

domTest('collectFields reads a typical order ticket', () => {
  const { document } = new JSDOM(`<body>
    <div class="ticket">
      <label for="vol">Volume (lots)</label><input id="vol" value="0.10">
      <label for="sl">Stop Loss</label><input id="sl" value="1.0842">
      <label for="tp">Take Profit</label><input id="tp" value="1.0910">
    </div>
    <div class="acct"><span>Account balance</span><input aria-label="Account balance" value="5,000.00"></div>
    <div class="risk"><label for="rp">Risk %</label><input id="rp" value="1.5"></div>
  </body>`).window;

  const { fields } = D.collectFields(document);
  const picked = D.resolveTrade(fields, 'buy', 'EUR/USD');

  assert.equal(picked.lots, 0.1);
  assert.equal(picked.sl, 1.0842);
  assert.equal(picked.tp, 1.0910);
  assert.equal(picked.balance, 5000);
  assert.equal(picked.riskPercent, 1.5);
  // Nothing labelled "entry" -> no inventing one.
  assert.equal(picked.entry, null);
});

domTest('a stop-loss money readout is not used as the stop price', () => {
  const { document } = new JSDOM(`<body>
    <div>
      <label for="sl">Stop Loss</label><input id="sl" value="1.0842">
      <span>Stop loss: -$18.40</span>
      <label for="lots">Volume</label><input id="lots" value="0.10">
      <label for="entry">Entry price</label><input id="entry" value="1.0850">
    </div>
  </body>`).window;

  const { fields } = D.collectFields(document);
  const picked = D.resolveTrade(fields, 'buy', 'EUR/USD');

  assert.equal(picked.sl, 1.0842);
  // The text node is not a control, so nothing is picked up automatically and
  // the stop price is never replaced by the money figure.
  assert.equal(picked.stopAmount, null);
  assert.ok(!fields.sl.some(item => item.value === 18.4));

  // The panel can pass a scoped text amount explicitly instead.
  const withText = D.resolveTrade(fields, 'buy', 'EUR/USD', { textAmount: 18.4 });
  assert.equal(withText.stopAmount, 18.4);
});

domTest('point value is measured from the ticket when the loss is exposed', () => {
  const { document } = new JSDOM(`<body>
    <label for="lots">Volume</label><input id="lots" value="0.50">
    <label for="entry">Entry</label><input id="entry" value="1.0850">
    <label for="sl">SL</label><input id="sl" value="1.0830">
    <label for="loss">Stop loss amount</label><input id="loss" value="-$100.00">
  </body>`).window;

  const { fields } = D.collectFields(document);
  const picked = D.resolveTrade(fields, 'buy', 'EUR/USD');

  assert.equal(picked.stopAmount, 100);
  assert.equal(picked.pointValueSource, 'measured');
  // 100 / (0.0020 * 0.5) = 100,000
  assert.ok(Math.abs(picked.pointValue - 100000) < 1e-6);
});

domTest('hidden and empty controls are ignored, empties are reported', () => {
  const { document } = new JSDOM(`<body>
    <label for="e">Entry price</label><input id="e" value="">
    <label for="h">Stop Loss</label><input id="h" value="1.2" style="display:none">
    <label for="v">Volume</label><input id="v" value="0.2">
  </body>`).window;

  const { fields, empty } = D.collectFields(document);
  assert.equal(fields.sl.length, 0);
  assert.equal(D.best(fields.lots).value, 0.2);
  assert.ok(empty.some(item => /entry/i.test(item.label)));
});

domTest('direction-relative inference fills SL/TP from generic price fields', () => {
  const { document } = new JSDOM(`<body>
    <label for="e">Entry price</label><input id="e" value="1.0850">
    <label for="p1">Quote 1</label><input id="p1" value="1.0830">
    <label for="p2">Quote 2</label><input id="p2" value="1.0900">
  </body>`).window;

  const buy = D.resolveTrade(D.collectFields(document).fields, 'buy', 'EUR/USD');
  assert.equal(buy.sl, 1.0830);
  assert.equal(buy.tp, 1.0900);

  const sell = D.resolveTrade(D.collectFields(document).fields, 'sell', 'EUR/USD');
  assert.equal(sell.sl, 1.0900);
  assert.equal(sell.tp, 1.0830);
});

domTest('describeDetection names what was found', () => {
  const { document } = new JSDOM(`<body>
    <label for="v">Volume</label><input id="v" value="0.2">
    <label for="s">Stop Loss</label><input id="s" value="1.0830">
  </body>`).window;
  const picked = D.resolveTrade(D.collectFields(document).fields, 'buy', 'EUR/USD');
  const text = D.describeDetection(picked);
  assert.match(text, /lots 0\.2/);
  assert.match(text, /SL 1\.083/);
});
