/* Configuration consistency checks.
 *
 * The journal host lives in three places that must agree:
 *   - JOURNAL_URLS in background.js   (which tab to open / look for)
 *   - host_permissions in manifest.json (may the extension talk to it)
 *   - content_scripts matches           (may journal-bridge.js run there)
 *
 * If they drift, the failure is silent and confusing: the trade is stored, a
 * tab opens, and either the page 404s or the bridge never runs. That is exactly
 * what happened when the journal moved host, so it is now a test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function journalUrls() {
  const match = background.match(/const JOURNAL_URLS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'JOURNAL_URLS found in background.js');
  return [...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]);
}

const originPattern = url => `https://${new URL(url).host}/*`;

const journalScript = manifest.content_scripts.find(script => script.js.includes('journal-bridge.js'));

test('JOURNAL_URLS is a non-empty list of https origins', () => {
  const urls = journalUrls();
  assert.ok(urls.length > 0, 'at least one journal host');
  for (const url of urls) {
    assert.equal(new URL(url).protocol, 'https:', `${url} must be https`);
    assert.ok(url.endsWith('/'), `${url} should end with /`);
  }
});

test('every journal URL is reachable from the extension', () => {
  for (const url of journalUrls()) {
    const pattern = originPattern(url);
    assert.ok(
      manifest.host_permissions.includes(pattern),
      `${pattern} is missing from host_permissions`
    );
    assert.ok(
      journalScript && journalScript.matches.includes(pattern),
      `${pattern} is missing from the journal-bridge content_scripts matches`
    );
  }
});

test('no journal host is left in the manifest that the extension will not use', () => {
  const urls = new Set(journalUrls().map(originPattern));
  for (const pattern of journalScript.matches) {
    assert.ok(urls.has(pattern), `${pattern} is in the manifest but not in JOURNAL_URLS`);
  }
});

test('the dead deployments are gone', () => {
  // Both of these returned DEPLOYMENT_NOT_FOUND; opening them produced a 404.
  const dead = ['trading-journa.vercel.app', 'indexhtml-glt-main-royak-kings-circle.vercel.app'];
  const haystack = [
    background,
    JSON.stringify(manifest.host_permissions),
    JSON.stringify(journalScript.matches)
  ].join('\n');

  for (const host of dead) {
    // Allowed inside comments only, never as a live URL/pattern.
    const live = new RegExp(`'https://${host.replace(/\./g, '\\.')}/?'`);
    const pattern = new RegExp(`"https://${host.replace(/\./g, '\\.')}/\\*"`);
    assert.equal(live.test(haystack), false, `${host} must not appear as a JOURNAL_URL`);
    assert.equal(pattern.test(haystack), false, `${host} must not appear in host_permissions or matches`);
  }
});

test('content scripts point at files that exist', () => {
  for (const script of manifest.content_scripts) {
    for (const file of script.js) {
      assert.ok(fs.existsSync(path.join(root, file)), `${file} is referenced but missing`);
    }
  }
  assert.ok(fs.existsSync(path.join(root, manifest.background.service_worker)), 'service worker exists');
});

test('the trade payload keys the journal expects are still sent', () => {
  // Guards against a rename in exness.js quietly breaking the journal import.
  const content = fs.readFileSync(path.join(root, 'exness.js'), 'utf8');
  // `exit`, `pnl`, `r` and `status` are what stop the journal from drawing an
  // imported trade as an open position.
  for (const key of ['externalId', 'symbol', 'dir', 'entry', 'sl', 'tp', 'exit', 'lots', 'date',
    'exec', 'bias', 'mgmt', 'sess', 'emotion', 'outcome', 'entryType', 'screenshot',
    'pnl', 'r', 'status', 'closedAt', 'durationMinutes']) {
    assert.match(content, new RegExp(`\\b${key}:`), `trade payload should include ${key}`);
  }
});
