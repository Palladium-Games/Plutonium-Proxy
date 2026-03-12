import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_EVENT_SOURCE,
  buildFrameHelperScript,
  extractTargetUrl,
  normalizeGoogleSearchUrl,
  rewriteCss,
  rewriteHtml,
  rewriteJs,
  sanitizeProxyHeaders,
} from "../src/proxy-utils.js";

test("normalizeGoogleSearchUrl removes duplicated nested search paths", () => {
  const malformed = "https://www.google.com/search?q=hello/search?q=hello&source=hp";

  assert.equal(
    normalizeGoogleSearchUrl(malformed),
    "https://www.google.com/search?q=hello&source=hp"
  );
});

test("extractTargetUrl decodes proxied referer values", () => {
  const target = "https://example.com/dashboard?tab=recent";
  const proxyUrl = `http://127.0.0.1:3000/proxy?url=${encodeURIComponent(target)}`;

  assert.equal(extractTargetUrl(proxyUrl), target);
  assert.equal(extractTargetUrl("https://example.com/plain"), null);
});

test("rewriteHtml proxies common attributes and meta refresh targets", () => {
  const html = `
    <html>
      <head>
        <meta http-equiv="refresh" content="0;url=/next">
      </head>
      <body>
        <a href="/docs">Docs</a>
        <img src="/hero.png" srcset="/hero.png 1x, /hero@2x.png 2x">
        <form action="/submit"></form>
      </body>
    </html>
  `;

  const rewritten = rewriteHtml(html, "https://example.com/start");

  assert.match(rewritten, /href="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fdocs"/);
  assert.match(rewritten, /src="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero\.png"/);
  assert.match(rewritten, /srcset="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero\.png 1x, \/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero%402x\.png 2x"/);
  assert.match(rewritten, /action="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fsubmit"/);
  assert.match(rewritten, /content="0;url=\/proxy\?url=https%3A%2F%2Fexample\.com%2Fnext"/);
});

test("rewriteCss and rewriteJs keep asset fetches inside the proxy", () => {
  const css = '@import "/styles/site.css"; .hero { background-image: url("../img/hero.png"); }';
  const js = 'fetch("/api/data"); const login = "/auth/login";';

  assert.match(
    rewriteCss(css, "https://example.com/app/main.css"),
    /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fstyles%2Fsite\.css/
  );
  assert.match(
    rewriteCss(css, "https://example.com/app/main.css"),
    /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fimg%2Fhero\.png/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /fetch\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fapi%2Fdata"\)/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /"\/proxy\?url=https%3A%2F%2Fexample\.com%2Fauth%2Flogin"/
  );
});

test("buildFrameHelperScript and sanitizeProxyHeaders lock down iframe integration behavior", () => {
  const helper = buildFrameHelperScript("https://example.com/inside");
  const headers = sanitizeProxyHeaders({
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000",
    "content-length": "123",
  });

  assert.match(helper, new RegExp(FRAME_EVENT_SOURCE));
  assert.match(helper, /https:\/\/example\.com\/inside/);
  assert.ok(!("x-frame-options" in headers));
  assert.ok(!("strict-transport-security" in headers));
  assert.ok(!("content-length" in headers));
  assert.equal(headers["content-security-policy"], "default-src 'self';  object-src 'none'");
});
