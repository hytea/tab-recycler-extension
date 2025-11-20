# Tab Recycler Extension

This extension recycles old, unused tabs when you open a new one.

## Installation

1. Open Chrome or Edge.
2. Navigate to `chrome://extensions` or `edge://extensions`.
3. Enable "Developer mode" (toggle in top right or bottom left).
4. Click "Load unpacked".
5. Select this folder (`.../GitHub/tab-recycler-extension`).

## How it works

- When you open a new tab (Ctrl+T or Click), the extension checks your other tabs.
- If it finds a tab that hasn't been used for **more than 1 hour**, it will:
    1. Switch to that tab.
    2. Navigate it to the New Tab page.
    3. Close the tab you just opened.
- If no such tab exists, it behaves like a normal New Tab page.

## Testing

To test without waiting 1 hour:
1. Open `newtab.js`.
2. Uncomment `const RECYCLE_THRESHOLD_MS = 10 * 1000;` (10 seconds).
3. Comment out the 1 hour line.
4. Reload the extension in the extensions page.
