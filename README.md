# TradeLog Pro for Exness (Chrome extension MVP)

A Manifest V3 unpacked Chrome extension that adds a **＋ Log Exness trade** button on Exness pages. It also opens its review panel when the user double-clicks a control clearly labeled **Long Position** or **Short Position**. It does not submit, change, or close orders in Exness.

## Install locally

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Choose **Load unpacked** and select this `chrome-extension` folder.
3. Open/reload the Exness terminal at `https://my.exness.com/pa/trading/accounts`.
4. Use **＋ Log Exness trade**, or double-click the terminal's **Long Position** / **Short Position** drawing tool.
5. Review the captured viewport screenshot and detected instrument/prices. Correct entry, SL, and TP if needed, then choose outcome and entry type and select **Send to TradeLog**.
6. The extension opens the configured TradeLog Pro site or switches to its tab. The imported entry is stored in that site's existing browser-local journal and appears in Trade History with its screenshot.

## Configuration

The extension recognizes both known TradeLog URLs: `https://trading-journa.vercel.app/` and `https://indexhtml-glt-main-royak-kings-circle.vercel.app/`. It will use a journal tab already open at either URL (important because browser-local journal data belongs to that exact origin); otherwise it opens the canonical `trading-journa.vercel.app` URL. If you use another host, add it to the host permissions and content-script matches in `manifest.json`, and to `JOURNAL_URLS` in `background.js`, then reload the extension.

The journal website must contain the extension import receiver added in the root `index.html`; deploy that version first.

## Detection notes

- Screenshot capture is the currently visible terminal viewport, saved as a compressed JPEG. If it fails, the form now shows Chrome's exact error; the usual cause is the extension's "Site access" being set to "On click" in chrome://extensions, which downgrades capture to temporary per-tab access.
- The extension tries to find prices from visible inputs and text labelled Entry, SL/Stop Loss, or TP/Take Profit. Some chart canvases do not expose their drawing values to page scripts. In those cases the fields are intentionally left for review instead of inventing values.
- Detection runs in all frames (the Exness terminal can live inside an iframe), pierces Shadow DOM, matches inputs by label/aria-label/placeholder (including contenteditable fields), and infers Long/Short from the open tool dialog or its active state instead of assuming Long. Detection stays best-effort and editable: always confirm the captured values and screenshot before saving.
- Trade outcomes and entry types are required. The journal import creates a trade with P&L zero and R marked zero initially; it records the setup/screenshot, not an execution result or broker-confirmed P&L.
- The extension has site access only for Exness and the configured TradeLog Vercel host. It uses the `tabs` permission to capture the visible Exness tab and stores a temporary pending import in `chrome.storage.local` until the journal confirms receipt.