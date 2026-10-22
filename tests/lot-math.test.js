/* Unit tests for lot-math.js — run with `npm test` or `node --test tests/`.
 * Pure helpers, no dependencies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lot-math.js');

/* ------------------------------------------------------------------ numbers */

test('parseNumber handles plain and grouped prices', () => {
  assert.equal(M.parseNumber('1.0842'), 1.0842);
  assert.equal(M.parseNumber('1,084.20'), 1084.2);
  assert.equal(M.parseNumber('$1,234.56'), 1234.56);
  assert.equal(M.parseNumber('0.10'), 0.1);
  assert.equal(M.parseNumber(''), null);
  assert.equal(M.parseNumber('abc'), null);
});

test('parseNumber handles values copied out of a broker ticket', () => {
  assert.equal(M.parseNumber('1.0842 USD'), 1.0842);
  assert.equal(M.parseNumber('0.10 lots'), 0.1);
  assert.equal(M.parseNumber('2400.50'), 2400.5);
  assert.equal(M.parseNumber('1 234,56'), 1234.56);
  assert.equal(M.parseNumber('1.234,56'), 1234.56);
});

test('parseNumber keeps signs', () => {
  assert.equal(M.parseNumber('-25.00'), -25);
  assert.equal(M.parseNumber('−25,00'), -25);
  assert.equal(M.parseNumber('(25.00)'), -25);
});

test('parsePositive rejects zero and negatives', () => {
  assert.equal(M.parsePositive('0'), null);
  assert.equal(M.parsePositive('-5'), null);
  assert.equal(M.parsePositive('12.5'), 12.5);
});

/* ------------------------------------------------------------------ symbols */

test('normaliseSymbol maps compact broker names', () => {
  assert.equal(M.normaliseSymbol('eurusd'), 'EUR/USD');
  assert.equal(M.normaliseSymbol('XAUUSD'), 'XAU/USD');
  assert.equal(M.normaliseSymbol('BTC/USD'), 'BTC/USD');
  assert.equal(M.normaliseSymbol(''), '');
  assert.equal(M.normaliseSymbol('eurusd'), 'EUR/USD');
});

/* --------------------------------------------------------- contract values */

test('pointValueFor knows USD-quoted majors exactly', () => {
  const pv = M.pointValueFor('EUR/USD');
  assert.equal(pv.value, 100000);
  assert.equal(pv.assumed, false);
});

test('pointValueFor derives USD-base pairs from price', () => {
  assert.ok(Math.abs(M.pointValueFor('USD/JPY', 150).value - 100000 / 150) < 1e-9);
  assert.equal(M.pointValueFor('USD/JPY').value, null);
});

test('pointValueFor marks metals as an assumption', () => {
  const gold = M.pointValueFor('XAU/USD');
  assert.equal(gold.value, 100);
  assert.equal(gold.assumed, true);
});

test('pointValueFor refuses to guess unknown instruments', () => {
  assert.equal(M.pointValueFor('NAS100').value, null);
  assert.equal(M.pointValueFor('').value, null);
});

/* -------------------------------------------------------------- lot sizing */

test('recommendLots sizes a forex trade', () => {
  const result = M.recommendLots({ balance: 10000, riskPercent: 1, pointValue: 100000, entry: 1.0850, sl: 1.0830, step: 0.01 });
  assert.equal(result.ok, true);
  assert.equal(result.suggested, 0.5);
  assert.equal(result.riskAmount, 100);
  assert.ok(Math.abs(result.riskAtSuggested - 100) < 1e-9);
});

test('recommendLots floors to the lot increment', () => {
  const result = M.recommendLots({ balance: 10000, riskPercent: 0.75, pointValue: 100000, entry: 1.0850, sl: 1.0830, step: 0.01 });
  assert.equal(result.suggested, 0.37);
});

test('recommendLots works for gold', () => {
  const result = M.recommendLots({ balance: 10000, riskPercent: 1, pointValue: 100, entry: 2400, sl: 2395, step: 0.01 });
  assert.equal(result.suggested, 0.2);
});

test('recommendLots rejects unusable input instead of returning nonsense', () => {
  assert.match(M.recommendLots({ balance: 10000, riskPercent: 1, pointValue: 100000, entry: 1.085, sl: 1.085, step: 0.01 }).reason, /identical/i);
  assert.equal(M.recommendLots({ balance: 10000, riskPercent: 1, pointValue: 0, entry: 1.085, sl: 1.083, step: 0.01 }).ok, false);
  assert.equal(M.recommendLots({ balance: 100, riskPercent: 0.1, pointValue: 100000, entry: 1.085, sl: 1.0005, step: 0.01 }).ok, false);
  assert.equal(M.recommendLots({ balance: 10000, riskPercent: 150, pointValue: 100000, entry: 1.085, sl: 1.083, step: 0.01 }).ok, false);
});

test('riskFor and rewardRisk describe the reviewed trade', () => {
  // 0.5 lots, 20 pip stop, $100k per 1.0 -> $100
  assert.ok(Math.abs(M.riskFor({ lots: 0.5, entry: 1.0850, sl: 1.0830, pointValue: 100000 }) - 100) < 1e-9);
  assert.equal(M.riskFor({ lots: 0, entry: 1.0850, sl: 1.0830, pointValue: 100000 }), null);

  // 20 pip stop, 40 pip target -> 2R
  assert.ok(Math.abs(M.rewardRisk({ entry: 1.0850, sl: 1.0830, tp: 1.0890 }) - 2) < 1e-9);
  assert.equal(M.rewardRisk({ entry: 1.0850, sl: 1.0850, tp: 1.0890 }), null);
  assert.equal(M.rewardRisk({ entry: 1.0850, sl: 1.0830, tp: 0 }), null);
});
