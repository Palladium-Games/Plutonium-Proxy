import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";

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
          </head>
          <body>
            <a href="/docs">Docs</a>
            <img src="/hero.png">
          </body>
        </html>
      `);
      return;
    }

    if (req.url === "/styles/site.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end('.hero { background: url("/hero.png"); }');
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
      res.end('fetch("/api/data");');
      return;
    }

    if (req.url === "/hero.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([137, 80, 78, 71]));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
}

test("proxy responds with rewritten HTML instead of hanging", async (t) => {
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
  assert.match(body, /window\.__plutoniumFrameBridgeInstalled/);
});

test("proxy rewrites CSS and JavaScript assets", async (t) => {
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
  const jsResponse = await fetch(`${proxyBaseUrl}/proxy?url=${encodeURIComponent(`${upstreamBaseUrl}/app.js`)}`);

  assert.equal(cssResponse.status, 200);
  assert.equal(jsResponse.status, 200);
  assert.match(await cssResponse.text(), /\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fhero\.png/);
  assert.match(await jsResponse.text(), /fetch\("\/proxy\?url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fapi%2Fdata"\)/);
});

test("proxy handles HEAD requests and bad inputs cleanly", async (t) => {
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
