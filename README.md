# TradeLog Pro for Exness (Chrome extension)

A Manifest V3 unpacked Chrome extension that adds a **＋ Log trade** button to Exness
pages, and opens the same review panel when you double-click a control labelled
**Long Position** or **Short Position**. It records the setup and screenshot; it never
submits, changes, or closes an order in Exness.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open the Exness terminal at `https://my.exness.com/pa/trading/accounts`.

**After any code update:** press **Reload** on the extension card, then **refresh the
Exness tab**. The content script runs once per page load, so a reload alone leaves the
old copy running in already-open tabs (that is what the "extension was reloaded, refresh
this tab" message means).

## Screenshots and permissions

Chrome only allows `tabs.captureVisibleTab()` when the extension has either an
`activeTab` grant (which lasts only until the tab navigates, and needs a toolbar-icon
click) **or** a host permission whose pattern is literally `<all_urls>`. A narrow pattern
such as `https://*.exness.com/*` is *not* enough — this is why earlier builds demanded a
toolbar click and then silently stopped working after a page reload.

This build declares `<all_urls>` in `host_permissions`, so screenshots work immediately
after reloading the extension, with no icon clicking. Content scripts are still injected
only on Exness, XM, TradingView, and the TradeLog hosts, so no other site is touched.

If a capture still fails:

- Open the toolbar popup and press **Test screenshot**. It reports the exact Chrome error.
- Check `chrome://extensions` → TradeLog Pro → **Details** → **Site access** is
  **On all sites**. Setting it to "On click" revokes the host permission, including
  `<all_urls>`, and capture will fail again.
- The Exness tab must be the active tab of its window (not minimised, not in the
  background).

## What the panel detects

The panel scans the visible page — including iframes and open shadow roots — for labelled
controls and fills in whatever it can prove:

| Field | Recognised labels (examples) |
| --- | --- |
| Lot size | Volume, Lots, Lot size, Quantity, Qty, Size |
| Entry | Entry, Entry price, Open/Opening price, Market price, Execution price |
| Stop loss | Stop Loss, SL, Stop |
| Take profit | Take Profit, TP |
| Balance | Account balance, Balance, Equity, Account size |
| Risk % | Risk %, Risk per trade, Risk percent |
| Stop amount | any money figure next to the stop (`-$18.40`, `25.00 USD`) |

Details that matter:

- Labels are read from `aria-labelledby`, `aria-label`, `<label for>`, wrapping labels,
  placeholders, `name`/`id`/`data-*` hooks, and short nearby text — never from a whole
  panel container, which used to mislabel every control.
- A currency figure next to the stop is treated as **money at risk**, never as the stop
  price.
- Empty and hidden controls are reported but not used, so nothing is invented.
- Every field stays editable, and the panel prints a **Detected:** line naming the label
  each value came from, plus how many controls it scanned. If a value is missing there,
  the terminal is not exposing it and you type it in yourself.

## Lot sizing

`Recommended max lot` = `balance × risk% ÷ (|entry − SL| × money per 1.0 move per lot)`,
floored to the lot increment.

The "money per 1.0 price move per lot" value is resolved in this order:

1. **Measured from the ticket** — when the tool shows the loss at stop together with
   size and prices, the contract value is derived exactly.
2. **Your saved value** for that instrument (saved when you edit the field).
3. **Contract-size model** — exact for USD-quoted majors (100,000 units per lot) and
   USD-base pairs (100,000 ÷ price), and marked **assumed** for XAU/USD (100 oz) and
   XAG/USD (5,000 oz) because broker contract sizes vary. Correct any field carrying the
   `assumed` badge against your account's contract specification.

Indices and crypto have no built-in value: enter it once and it is remembered per
instrument. Per-trade sizing only — prop-firm daily and maximum drawdown rules are not
assumed.

## Journal handoff

`Send to TradeLog` stores the trade in `chrome.storage.local`, activates an open journal
tab, and posts it to the page. `journal-bridge.js` retries for a few seconds while the
page boots, clears the stored trade only after the page acknowledges it, and retries again
when the tab becomes visible. The journal site itself must contain the import receiver in
its `index.html`.

Recognised journal hosts: `https://trading-journa.vercel.app/` and
`https://indexhtml-glt-main-royak-kings-circle.vercel.app/`. For another host, add it to
`manifest.json` (host permissions and content-script matches) and to `JOURNAL_URLS` in
`background.js`.

## Tests

```bash
npm install          # jsdom, for the DOM tests
npm test
```

`tests/detect.test.js` covers number parsing, label classification, contract values and
lot sizing. `tests/panel.test.js` loads the real content scripts into a DOM with a mocked
`chrome` API and checks the panel fills from a ticket and refuses to send an unsized
trade. Without `jsdom` installed the DOM tests are skipped rather than failing.

## Notes and limits

- The screenshot is the visible viewport as a compressed JPEG.
- Chart canvases usually do not expose drawing values to page scripts, so entry/SL/TP may
  need confirming — that is by design rather than guessed.
- The journal import creates a trade with P&L zero and R zero; it records the setup, not
  a broker-confirmed result.
