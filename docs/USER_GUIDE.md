# Plutonium Proxy User Guide

## Purpose

Plutonium Proxy is a local browser shell that loads remote pages through `/proxy?url=...` so the page can be embedded inside the app's iframe. The shell adds tabs, an address bar, smooth transitions, and keyboard shortcuts while the server rewrites HTML, CSS, and JavaScript links to keep navigation inside the proxy.

## Start The App

1. Install dependencies with `npm install`.
2. Start the proxy with `npm run dev`.
3. Open `http://localhost:3000`.

## Everyday Browsing

- Type a URL such as `example.com` to open a site directly.
- Type plain text to run a Google search.
- Use `+` to open a new tab and `x` to close the current tab.
- Watch the tab pulse and top progress bar during page loads.
- Empty tabs open a Plutonium homescreen with the current time, saved bookmarks, and a customizable background.
- The shell now loads multiple frontend CSS and JavaScript assets instead of one giant inline page, so browser-style UI updates are easier to evolve.

## Homescreen

- Click `Customize` on a new tab to set a background image URL.
- Add bookmarks with a name and URL, or remove existing ones with the `×` button.
- Homescreen settings are saved locally in your browser.

## Keyboard Shortcuts

- `Ctrl+T` or `Cmd+T`: new tab
- `Ctrl+W` or `Cmd+W`: close tab
- `Ctrl+L` or `Cmd+L`: focus the address bar
- `Ctrl+R` or `Cmd+R`: reload
- `Ctrl+Tab` / `Ctrl+Shift+Tab`: cycle tabs
- `Alt+Left` / `Alt+Right`: back and forward
- `Alt+D`: focus the address bar

## Troubleshooting

- If a page does not load, confirm the target URL works directly in a browser first.
- Some sites may still resist iframe embedding or aggressive script rewriting.
- Verification-heavy sites now stay in the same proxied session, but some providers may still block iframe-based flows on their side.
- Run `npm test` to verify the local proxy behavior after any change.
