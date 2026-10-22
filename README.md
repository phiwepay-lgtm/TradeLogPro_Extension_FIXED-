# TradeLog Pro for Exness (Chrome extension)

A Manifest V3 unpacked Chrome extension that opens a **floating trade panel** on Exness
pages, so a chart screenshot and its numbers can be sent to the TradeLog Pro journal in a
few seconds. It never submits, changes, or closes an order in Exness.

**Nothing is read from the terminal.** Earlier versions tried to auto-detect the order
ticket; that was removed in 2.0.0. You type or paste the values yourself, which is
predictable and works regardless of how the terminal is built.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open the Exness terminal at `https://my.exness.com/pa/trading/accounts`.

**After any update:** press **Reload** on the extension card, then **refresh the Exness
tab**. The content script runs once per page load, so a reload alone leaves the old copy
running in already-open tabs.

## Logging a trade

Click **＋ Log trade** (bottom-right) or double-click a control labelled **Long Position**
/ **Short Position**. The panel opens immediately with the screenshot already taken.

**Every panel opens clean.** Nothing is carried over from the previous trade — no
instrument, prices, size, balance, tags, outcome or screenshot. The only values set when
it opens are the direction (Long, or your choice from a double-click) and the current date
and time. The single thing remembered is where you dragged the panel to.

1. **Instrument / direction** — type or pick the instrument; direction comes from the
   double-click when you use it, otherwise Long.
2. **Entry, Stop loss, Take profit, Lot size** — type, or press **Paste** to pull the value
   from the clipboard. Anything you paste is cleaned up: `$1,084.20`, `1.084,2`,
   `1.0842 USD` and `0.10 lots` all become plain numbers.
3. **Screenshot** — captured from the visible viewport when the panel opens.
   - **Retake screenshot** — grabs the current view again, so you can pan the chart and
     re-shoot without closing the panel.
   - **Paste image URL** — uses a link instead of an inline image (handy for large charts).
   - **Remove** — clears it; you then need a retake or a URL before sending.
4. **Outcome** is required; **Journal tags** (execution, setup, management, session,
   emotion, entry type) sit in a collapsed section and never block a send.
5. **Send to TradeLog** — the panel closes and the trade goes to the journal.

The panel is draggable by its header, floats above the chart without blocking it, and
remembers where you left it. `Esc` closes it.

## Lot size calculator (optional)

`Suggested lot` = `balance × risk% ÷ (|entry − stop| × money per 1.0 move per lot)`,
floored to the 0.01 increment. It is a convenience only — it never blocks sending.

"Money per 1.0 price move per lot" comes from what you type, or from the instrument:

- USD-quoted majors (EUR/USD, GBP/USD, AUD/USD, NZD/USD): 100,000 exact.
- USD-base pairs (USD/JPY, USD/CHF, USD/CAD): 100,000 ÷ entry price.
- XAU/USD (100 oz) and XAG/USD (5,000 oz): marked **assumed** — check your account's
  contract specification.
- Indices and crypto: no guess. Enter the value once and it is used as typed.

## Permissions

- `storage` — remembers only the panel's drag position, plus the pending trade that is
  waiting for the journal. No trade values are ever stored.
- `activeTab` — used by the toolbar popup's **Test screenshot** button.
- `<all_urls>` — required by `tabs.captureVisibleTab()`. Chrome only allows capture with
  either an `activeTab` grant (which dies when the tab navigates) or a host pattern that is
  literally `<all_urls>`; a narrow pattern like `https://*.exness.com/*` is not enough.
  Content scripts are still injected only on Exness, XM, TradingView, and the TradeLog
  hosts, so no other site is touched.

If capture fails, open the popup and press **Test screenshot** for the exact error. Also
check `chrome://extensions` → Details → **Site access** is *On all sites*; "On click"
revokes `<all_urls>`.

## Journal handoff

`Send to TradeLog` stores the trade in `chrome.storage.local`, activates an open journal
tab, and posts it to the page. The trade carries `screenshot` (a data URL) and
`screenshotUrl` (a link, when you used one) — whichever the journal prefers.
`journal-bridge.js` retries while the page boots, clears the stored trade only after the
page acknowledges it, and retries again when the tab becomes visible.

The journal host is `https://indexhtml-olive-delta.vercel.app/`. The two older hosts this
extension used to point at (`trading-journa.vercel.app` and
`indexhtml-glt-main-royak-kings-circle.vercel.app`) are deleted Vercel deployments that
return `DEPLOYMENT_NOT_FOUND`, so sending a trade there opened a 404 and the import never
happened.

**Changing hosts?** Three places must agree, or the failure is silent:

1. `JOURNAL_URLS` in `background.js`
2. `host_permissions` in `manifest.json`
3. the `journal-bridge.js` entry in `content_scripts[].matches`

`tests/config.test.js` fails if they drift apart, so run `npm test` after editing any of
them. The journal's own `index.html` must also contain the import receiver.

## Tests

```bash
npm install     # jsdom, for the DOM tests
npm test
```

`tests/config.test.js` guards the journal wiring: every `JOURNAL_URLS` entry must appear in
both `host_permissions` and the content-script matches, no dead hosts may linger, and the
trade payload still carries the keys the journal expects. `tests/lot-math.test.js` covers
pasted-number parsing, instrument contract values and lot
sizing. `tests/panel.test.js` loads the real content scripts into a DOM with a mocked
`chrome` API and checks the panel floats in a shadow root, opens with **no values from the
previous trade** (both after closing and after sending), cleans pasted values, retakes the
screenshot, accepts an image URL, drags and remembers only its position, and validates
before sending. Without `jsdom` the DOM tests are skipped rather than failing.

## Notes and limits

- The screenshot is the visible viewport, compressed to JPEG.
- The journal import creates a trade with P&L zero and R zero; it records the setup, not a
  broker-confirmed result.
- Because nothing is read from the terminal, a typo in a pasted price is yours to catch —
  the panel only checks that entry, stop and target sit on the correct sides of each other.
