# Plutonium Proxy User Guide

## Purpose

Plutonium is a local browser shell that loads remote pages through `/proxy?url=...` so the page can be embedded inside the app's iframe. The shell adds tabs, an address bar, smooth transitions, and keyboard shortcuts while the server rewrites HTML, CSS, and JavaScript links to keep navigation inside the app.

## Start The App

1. Install dependencies with `npm install`.
2. Start the proxy with `npm run dev`.
3. Open `http://localhost:3000`.

## Everyday Browsing

- Type a URL such as `example.com` to open a site directly.
- Type plain text to run a Google search.
- Click into the address bar to get smart suggestions from open tabs, saved bookmarks, recent visits, and browser actions.
- Use `+` to open a new tab and `x` to close the current tab.
- Pin a tab from the tab strip or by typing `pin tab` into the omnibox to keep it anchored at the front.
- Plutonium restores your last open tabs after a reload, so your session comes back automatically.
- Modern sites with inline styles, inline ES modules, import maps, workers, service worker registration, manifests, SVG assets, source-map-linked CSS or JavaScript, bundler-style `import.meta.url` assets, and text media playlists now have broader compatibility support than earlier builds.
- Challenge-heavy pages now show a `Focus Mode` handoff that opens the same Plutonium session in a full browser tab when an embedded flow needs more room.
- Watch the tab pulse and top progress bar during page loads.
- Empty tabs open a minimal Plutonium homescreen with the current time, saved bookmarks, recent visits, recently closed tabs, and a customizable background.
- The shell now loads multiple frontend CSS and JavaScript assets instead of one giant inline page, so browser-style UI updates are easier to evolve.

## Homescreen

- Click `Customize` on a new tab to set a background image URL.
- Add bookmarks with a name and URL, or remove existing ones with the `×` button.
- Use the `Continue` and `Recently Closed` panels to jump back into recent pages without opening the omnibox first.
- Homescreen settings and browser session state are saved locally in your browser.

## Keyboard Shortcuts

- `Ctrl+T` or `Cmd+T`: new tab
- `Ctrl+Shift+T` or `Cmd+Shift+T`: reopen the most recently closed tab
- `Ctrl+W` or `Cmd+W`: close tab
- `Ctrl+Shift+D` or `Cmd+Shift+D`: duplicate the current tab
- `Ctrl+L` or `Cmd+L`: focus the address bar
- `Ctrl+R` or `Cmd+R`: reload
- `Ctrl+Tab` / `Ctrl+Shift+Tab`: cycle tabs
- `Alt+Left` / `Alt+Right`: back and forward
- `Alt+D`: focus the address bar

## Troubleshooting

- If a page does not load, confirm the target URL works directly in a browser first.
- Some sites may still resist iframe embedding or aggressive script rewriting.
- Plutonium improves browser-side web asset compatibility; it does not add a native Python runtime for websites, because mainstream sites like YouTube ship JavaScript, CSS, media manifests, and video chunks to browsers instead.
- Verification-heavy sites now stay in the same Plutonium session, and the shell can hand them off into `Focus Mode` when a full top-level tab is more reliable.
- Run `npm test` to verify the local proxy behavior after any change.
