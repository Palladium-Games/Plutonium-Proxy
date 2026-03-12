# Plutonium Proxy Agent Guide

## Architecture

- [`src/app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/app.js) builds the Express app and owns proxy middleware setup, validation, upstream response handling, and server start helpers.
- [`src/proxy-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/proxy-utils.js) contains the reusable rewrite helpers, header sanitation logic, and the injected iframe bridge script.
- [`public/index.html`](/Users/sethpang/Coding/Plutonium%20Proxy/public/index.html) is the browser shell UI. It tracks tab state, listens for iframe navigation messages, and drives the address bar plus loading states.

## Core Flow

1. The shell navigates an iframe to `/proxy?url=<target>`.
2. [`src/app.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/app.js) validates the target, proxies the request upstream, and decides whether the response must be streamed or buffered.
3. [`src/proxy-utils.js`](/Users/sethpang/Coding/Plutonium%20Proxy/src/proxy-utils.js) rewrites navigational URLs back through the proxy and injects the bridge script into HTML responses.
4. The injected bridge posts `loading`, `title`, and `commit` messages to the shell so the UI stays synchronized with in-page navigation.

## Verification

- `npm test`: run the full automated suite.
- `npm run build`: alias for the green verification pass used by this project.

## Change Checklist

- Keep proxy route changes covered by tests in [`test/app.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/app.test.js).
- Keep rewrite helper changes covered by tests in [`test/proxy-utils.test.js`](/Users/sethpang/Coding/Plutonium%20Proxy/test/proxy-utils.test.js).
- Preserve the iframe bridge event contract unless the shell and injected helper are updated together.
