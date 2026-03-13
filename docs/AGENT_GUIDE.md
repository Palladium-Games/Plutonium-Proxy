# Plutonium Proxy Agent Guide

## Architecture

- [`src/app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/app.js) builds the Express app and owns proxy middleware setup, validation, upstream response handling, and server start helpers.
- [`src/proxy-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/proxy-utils.js) contains the reusable rewrite helpers, header sanitation logic, and the injected iframe bridge script.
- [`src/upstream-cookies.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/upstream-cookies.js) keeps upstream cookies in a server-side session jar keyed by the local proxy session cookie so verification pages and logins can persist.
- [`public/index.html`](/Users/sethpang/Coding/Plutonium%20Proxy/public/index.html) is now a lightweight shell that loads the browser UI from external CSS and ES modules.
- [`public/styles/`](/Users/sethpang/Coding/Plutonium%20Proxy/public/styles) contains the split stylesheet stack for tokens, shell layout, homescreen visuals, and motion.
- [`public/scripts/`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts) contains the split frontend module graph for configuration, helpers, homescreen storage/rendering, and tab orchestration.

## Core Flow

1. The shell navigates an iframe to `/proxy?url=<target>`.
2. [`src/app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/app.js) validates the target, maps local headers back to the upstream origin, proxies the request upstream, and decides whether the response must be streamed or buffered.
3. [`src/upstream-cookies.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/upstream-cookies.js) captures upstream `Set-Cookie` headers and replays matching cookies on later requests for the same local browser session.
4. [`src/proxy-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/proxy-utils.js) rewrites navigational URLs back through the proxy and injects the bridge script into HTML responses.
5. The injected bridge rewrites programmatic navigations and fetch/XHR requests, then posts `loading`, `title`, and `commit` messages to the shell so the UI stays synchronized with in-page navigation.

## Verification

- `npm test`: run the full automated suite.
- `npm run build`: alias for the green verification pass used by this project.

## Change Checklist

- Keep proxy route changes covered by tests in [`test/app.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/app.test.js).
- Keep rewrite helper changes covered by tests in [`test/proxy-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/proxy-utils.test.js).
- Keep cookie/session changes covered by tests in [`test/upstream-cookies.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/upstream-cookies.test.js).
- Keep frontend helper/storage changes covered by tests in [`test/browser-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/browser-utils.test.js).
- Preserve the iframe bridge event contract unless the shell and injected helper are updated together.
- Empty-tab changes should preserve the homescreen/bookmark/localStorage behavior across [`public/scripts/home-view.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/home-view.js) and [`public/scripts/home-settings.js`](/Users/sethpang/Coding/Plutonium%20Proxy/public/scripts/home-settings.js).
