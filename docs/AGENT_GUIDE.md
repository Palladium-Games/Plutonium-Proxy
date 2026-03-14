# Plutonium Proxy Agent Guide

## Architecture

- [`src/app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/app.js) builds the Express app and owns proxy middleware setup, validation, upstream response handling, and server start helpers.
- [`src/proxy-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/proxy-utils.js) contains the reusable rewrite helpers, header sanitation logic, and the injected iframe bridge script.
- [`src/upstream-cookies.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/upstream-cookies.js) keeps upstream cookies in a server-side session jar keyed by the local proxy session cookie so verification pages and logins can persist.
- [`public/index.html`](/Users/sethpang/Coding/Plutonium%20Proxy/public/index.html) is now a lightweight shell that loads the browser UI from external CSS and ES modules.
- [`public/styles/`](/Users/sethpang/Coding/Plutonium%20Proxy/public/styles) contains the split stylesheet stack for tokens, shell layout, homescreen visuals, and motion.
- [`public/scripts/session-store.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/session-store.js) owns browser session persistence for tabs, pinned state, recent visits, and recently closed tabs.
- [`public/scripts/suggestion-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/suggestion-utils.js) builds the omnibox suggestion model from bookmarks, open tabs, history, and action shortcuts.
- [`public/scripts/browser-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/browser-utils.js) also exposes challenge heuristics and the top-level focus-mode URL helper used for embedded verification handoff.
- [`public/scripts/tab-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/tab-utils.js) contains stable ordering helpers for pinned vs. regular tabs in the shell.
- [`public/scripts/`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts) contains the split frontend module graph for configuration, helpers, storage, homescreen rendering, suggestion ranking, and tab orchestration.

## Core Flow

1. The shell navigates an iframe to `/proxy?url=<target>`.
2. [`src/app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/app.js) validates the target, maps local headers back to the upstream origin, proxies the request upstream, and decides whether the response must be streamed or buffered.
3. [`src/upstream-cookies.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/upstream-cookies.js) captures upstream `Set-Cookie` headers and replays matching cookies on later requests for the same local browser session.
4. [`src/proxy-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/proxy-utils.js) rewrites navigational URLs back through the proxy, handles inline CSS/import-map/module/worker compatibility fixes plus manifests, SVG markup, source-map-linked assets, bundler `import.meta.url` asset patterns, and text media playlists, and injects the bridge script into HTML responses.
5. The injected bridge rewrites programmatic navigations plus fetch/XHR/EventSource/Worker/service-worker registration requests, then posts `loading`, `title`, and `commit` messages to the shell so the UI stays synchronized with in-page navigation.
6. [`public/scripts/plutonium-app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/plutonium-app.js) restores the last browser session, keeps pinned/recent/closed tab state synchronized to local storage, and powers omnibox suggestions plus duplicate/reopen/pin shortcuts.

## Verification

- `npm test`: run the full automated suite.
- `npm run build`: alias for the green verification pass used by this project.

## Change Checklist

- Keep proxy route changes covered by tests in [`test/app.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/app.test.js).
- Keep rewrite helper changes covered by tests in [`test/proxy-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/proxy-utils.test.js).
- Keep cookie/session changes covered by tests in [`test/upstream-cookies.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/upstream-cookies.test.js).
- Keep frontend helper/storage changes covered by tests in [`test/browser-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/browser-utils.test.js).
- Keep session persistence changes covered by tests in [`test/session-store.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/session-store.test.js).
- Keep omnibox ranking/action changes covered by tests in [`test/suggestion-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/suggestion-utils.test.js).
- Keep pinned-tab ordering behavior covered by tests in [`test/tab-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/tab-utils.test.js).
- Preserve the iframe bridge event contract unless the shell and injected helper are updated together.
- Empty-tab changes should preserve the homescreen/bookmark/localStorage behavior across [`public/scripts/home-view.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/home-view.js) and [`public/scripts/home-settings.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/home-settings.js).
