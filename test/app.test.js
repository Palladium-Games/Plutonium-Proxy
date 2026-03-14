import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { resetUpstreamCookieStores } from "../src/upstream-cookies.js";

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createUpstreamServer() {
  return http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
        "x-frame-options": "DENY",
      });
      res.end(`
        <!doctype html>
        <html>
          <head>
            <title>Example Home</title>
            <link rel="manifest" href="/site.webmanifest">
            <link rel="preload" as="image" imagesrcset="/hero.png 1x, /hero@2x.png 2x" integrity="sha256-demo">
            <style>.hero { background-image: url("/panel.png"); }</style>
            <script type="importmap">
              {
                "imports": {
                  "#app": "/assets/app.js"
                }
              }
            </script>
            <script type="module">
              import "/inline-module.js";
            </script>
          </head>
          <body style="background-image: url('/wallpaper.png')">
            <a href="/docs">Docs</a>
            <img src="/hero.png">
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/styles/site.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(`
        @import url("/styles/theme.css");
        .hero { background: url("/hero.png"); }
        /*# sourceMappingURL=site.css.map */
      `);
      return;
    }

    if (req.url === "/styles/theme.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(".theme { color: #fff; }");
      return;
    }

    if (req.url === "/styles/legacy.css") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end('.legacy { background: url("/legacy-bg.png"); }');
      return;
    }

    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/docs" });
      res.end();
      return;
    }

    if (req.url === "/docs") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`
        <!doctype html>
        <html>
          <head>
            <title>Docs Page</title>
          </head>
          <body>
            <p>Redirect landed successfully.</p>
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      res.end(`
        import "/module.js";
        new Worker("/worker.js");
        navigator.serviceWorker.register("/sw.js", { scope: "/scope/" });
        //# sourceMappingURL=app.js.map
      `);
      return;
    }

    if (req.url === "/player.mjs") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end('const playerChunk = new URL("./chunks/player.js", import.meta.url);');
      return;
    }

    if (req.url === "/video/master.m3u8") {
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl; charset=utf-8" });
      res.end(`
#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.000,
segment-1.ts
      `);
      return;
    }

    if (req.url === "/site.webmanifest") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          name: "Example App",
          start_url: "/launch",
          scope: "/",
          icons: [{ src: "/icons/app-192.png" }],
          shortcuts: [{ name: "Inbox", url: "/inbox" }],
        })
      );
      return;
    }

    if (req.url === "/logo.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" });
      res.end(`
        <svg xmlns="http://www.w3.org/2000/svg">
          <style>.logo { mask: url("/mask.svg"); }</style>
          <use xlink:href="/sprite.svg#wordmark"></use>
        </svg>
      `);
      return;
    }

    if (req.url === "/hero.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([137, 80, 78, 71]));
      return;
    }

    if (req.url === "/cookie-start") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": ["challenge=passed; Path=/; HttpOnly"],
      });
      res.end("<html><body>challenge cookie issued</body></html>");
      return;
    }

    if (req.url === "/cookie-check") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          cookie: req.headers.cookie || "",
          origin: req.headers.origin || "",
          referer: req.headers.referer || "",
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
}

test("proxy responds with rewritten HTML instead of hanging", async (t) => {
  resetUpstreamCookieStores();
  const upstream = createUpstreamServer();
  const upstreamBaseUrl = await listen(upstream);
  t.after(() => close(upstream));

  const app = createApp({ enableRequestLogging: false, logger: silentLogger });
  const proxyServer = app.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  t.after(() => close(proxyServer));

  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
  const response = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/`)}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), null);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);

  const body = await response.text();
  assert.match(body, /href="\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fdocs"/);
  assert.match(body, /src="\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fhero\.png"/);
  assert.match(body, /imagesrcset="\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fhero\.png 1x, \/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fhero%402x\.png 2x"/);
  assert.match(body, /background-image: url\("\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fpanel\.png"\)/);
  assert.match(body, /"#app": "\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fassets%2Fapp\.js"/);
  assert.match(body, /href="\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fsite\.webmanifest"/);
  assert.match(body, /import "\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Finline-module\.js"/);
  assert.doesNotMatch(body, /integrity=/);
  assert.match(body, /window\.__plutoniumFrameBridgeInstalled/);
});

test("proxy rewrites CSS, JavaScript, manifest, SVG, and media playlist assets", async (t) => {
  resetUpstreamCookieStores();
  const upstream = createUpstreamServer();
  const upstreamBaseUrl = await listen(upstream);
  t.after(() => close(upstream));

  const app = createApp({ enableRequestLogging: false, logger: silentLogger });
  const proxyServer = app.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  t.after(() => close(proxyServer));

  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
  const cssResponse = await fetch(
    `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/styles/site.css`)}`
  );
  const legacyCssResponse = await fetch(
    `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/styles/legacy.css`)}`
  );
  const jsResponse = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/app.js`)}`);
  const mjsResponse = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/player.mjs`)}`);
  const manifestResponse = await fetch(
    `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/site.webmanifest`)}`
  );
  const svgResponse = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/logo.svg`)}`);
  const playlistResponse = await fetch(
    `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/video/master.m3u8`)}`
  );

  assert.equal(cssResponse.status, 200);
  assert.equal(legacyCssResponse.status, 200);
  assert.equal(jsResponse.status, 200);
  assert.equal(mjsResponse.status, 200);
  assert.equal(manifestResponse.status, 200);
  assert.equal(svgResponse.status, 200);
  assert.equal(playlistResponse.status, 200);
  const cssBody = await cssResponse.text();
  assert.match(cssBody, /\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fstyles%2Ftheme\.css/);
  assert.match(cssBody, /\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fhero\.png/);
  assert.match(cssBody, /\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fstyles%2Fsite\.css\.map/);
  assert.match(await legacyCssResponse.text(), /\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Flegacy-bg\.png/);
  const jsBody = await jsResponse.text();
  assert.match(jsBody, /import "\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fmodule\.js"/);
  assert.match(jsBody, /new Worker\("\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fworker\.js"/);
  assert.match(jsBody, /navigator\.serviceWorker\.register\("\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fsw\.js"/);
  assert.match(jsBody, /\/\/# sourceMappingURL=\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fapp\.js\.map/);
  assert.match(
    await mjsResponse.text(),
    /new URL\("\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fchunks%2Fplayer\.js", import\.meta\.url\)/
  );
  const manifestBody = await manifestResponse.text();
  assert.match(manifestBody, /"start_url": "\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Flaunch"/);
  assert.match(manifestBody, /"src": "\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Ficons%2Fapp-192\.png"/);
  const svgBody = await svgResponse.text();
  assert.match(svgBody, /mask: url\("\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fmask\.svg"\)/);
  assert.match(svgBody, /xlink:href="\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fsprite\.svg%23wordmark"/);
  const playlistBody = await playlistResponse.text();
  assert.match(playlistBody, /URI="\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fvideo%2Finit\.mp4"/);
  assert.match(playlistBody, /\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fvideo%2Fsegment-1\.ts/);
});

test("proxy handles HEAD requests and bad inputs cleanly", async (t) => {
  resetUpstreamCookieStores();
  const upstream = createUpstreamServer();
  const upstreamBaseUrl = await listen(upstream);
  t.after(() => close(upstream));

  const app = createApp({ enableRequestLogging: false, logger: silentLogger });
  const proxyServer = app.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  t.after(() => close(proxyServer));

  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;

  const headResponse = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/`)}`, {
    method: "HEAD",
  });
  const missingResponse = await fetch(`${proxyBaseUrl}/proxy`);
  const invalidResponse = await fetch(`${proxyBaseUrl}/proxy?url=not-a-url`);

  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");
  assert.equal(missingResponse.status, 400);
  assert.equal(invalidResponse.status, 400);
});

test("proxy follows upstream redirects without crashing the server", async (t) => {
  resetUpstreamCookieStores();
  const upstream = createUpstreamServer();
  const upstreamBaseUrl = await listen(upstream);
  t.after(() => close(upstream));

  const app = createApp({ enableRequestLogging: false, logger: silentLogger });
  const proxyServer = app.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  t.after(() => close(proxyServer));

  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
  const response = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/redirect`)}`);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /Redirect landed successfully/);
});

test("proxy persists upstream cookies and remaps local origin headers", async (t) => {
  resetUpstreamCookieStores();
  const upstream = createUpstreamServer();
  const upstreamBaseUrl = await listen(upstream);
  t.after(() => close(upstream));

  const app = createApp({ enableRequestLogging: false, logger: silentLogger });
  const proxyServer = app.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  t.after(() => close(proxyServer));

  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
  const cookieStartResponse = await fetch(
    `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/cookie-start`)}`
  );
  const sessionCookie = (cookieStartResponse.headers.get("set-cookie") || "").split(";")[0];

  assert.match(sessionCookie, /plutonium_session=/);
  assert.ok(!sessionCookie.includes("challenge=passed"));

  await cookieStartResponse.text();

  const cookieCheckResponse = await fetch(
    `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/cookie-check`)}`,
    {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        origin: proxyBaseUrl,
        referer: `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/cookie-start`)}`,
      },
    }
  );

  const payload = await cookieCheckResponse.json();
  assert.match(payload.cookie, /challenge=passed/);
  assert.equal(payload.origin, upstreamBaseUrl);
  assert.equal(payload.referer, `${upstreamBaseUrl}/cookie-start`);
});

test("proxy enforces a weekly link limit per session", async (t) => {
  resetUpstreamCookieStores();
  const upstream = createUpstreamServer();
  const upstreamBaseUrl = await listen(upstream);
  t.after(() => close(upstream));

  const app = createApp({ enableRequestLogging: false, logger: silentLogger });
  const proxyServer = app.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  t.after(() => close(proxyServer));

  const proxyBaseUrl = `http://127.0.0.1:${proxyServer.address().port}`;
  const proxyUrl = `${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/`)}`;

  const navigationHeaders = {
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    accept: "text/html",
  };
  const first = await fetch(proxyUrl, { headers: navigationHeaders });
  const sessionCookie = (first.headers.get("set-cookie") || "").split(";")[0];
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-plutonium-link-remaining"), "1");

  const second = await fetch(proxyUrl, { headers: { ...navigationHeaders, cookie: sessionCookie } });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-plutonium-link-remaining"), "0");

  const third = await fetch(proxyUrl, { headers: { ...navigationHeaders, cookie: sessionCookie } });
  assert.equal(third.status, 429);
  const payload = await third.json();
  assert.match(payload.error, /Weekly link limit reached/i);
});
