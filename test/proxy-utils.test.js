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
        <link rel="preload" as="image" imagesrcset="/hero.png 1x, /hero@2x.png 2x" integrity="sha256-demo">
        <style>.hero { background-image: url("/inline-bg.png"); }</style>
        <script type="importmap">
          {
            "imports": {
              "#app": "/assets/app.js"
            },
            "scopes": {
              "https://example.com/start": {
                "#scoped": "/assets/scoped.js"
              }
            }
          }
        </script>
      </head>
      <body style="background-image: url('/body-bg.png')">
        <a href="/docs">Docs</a>
        <img src="/hero.png" srcset="/hero.png 1x, /hero@2x.png 2x">
        <div data-src="/lazy.png"></div>
        <form action="/submit"></form>
      </body>
    </html>
  `;

  const rewritten = rewriteHtml(html, "https://example.com/start");

  assert.match(rewritten, /href="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fdocs"/);
  assert.match(rewritten, /src="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero\.png"/);
  assert.match(rewritten, /srcset="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero\.png 1x, \/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero%402x\.png 2x"/);
  assert.match(rewritten, /imagesrcset="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero\.png 1x, \/proxy\?url=https%3A%2F%2Fexample\.com%2Fhero%402x\.png 2x"/);
  assert.match(rewritten, /action="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fsubmit"/);
  assert.match(rewritten, /data-src="\/proxy\?url=https%3A%2F%2Fexample\.com%2Flazy\.png"/);
  assert.match(rewritten, /content="0;url=\/proxy\?url=https%3A%2F%2Fexample\.com%2Fnext"/);
  assert.match(rewritten, /background-image: url\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Finline-bg\.png"\)/);
  assert.match(rewritten, /style="background-image: url\(&quot;\/proxy\?url=https%3A%2F%2Fexample\.com%2Fbody-bg\.png&quot;\)"/);
  assert.match(rewritten, /"#app": "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fassets%2Fapp\.js"/);
  assert.match(rewritten, /"\/proxy\?url=https%3A%2F%2Fexample\.com%2Fstart"/);
  assert.doesNotMatch(rewritten, /integrity=/);
});

test("rewriteHtml keeps top-targeted navigation inside the proxy iframe", () => {
  const html = '<a href="/challenge" target="_top">Verify</a><form action="/submit" target="_parent"></form>';
  const rewritten = rewriteHtml(html, "https://example.com/start");

  assert.match(rewritten, /target="_self"/);
});

test("rewriteCss and rewriteJs keep asset fetches inside the proxy", () => {
  const css = '@import "/styles/site.css"; .hero { background-image: url("../img/hero.png"); }';
  const js = `
    import workerUrl from "/workers/main.js";
    export { helper } from "/modules/helper.js";
    import("/modules/dynamic.js");
    new Worker("/workers/background.js");
    navigator.serviceWorker.register("/sw.js", { scope: "/scope/" });
    importScripts("/vendor/a.js", "/vendor/b.js");
    new EventSource("/events/live");
  `;

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
    /import workerUrl from "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fworkers%2Fmain\.js"/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /export \{ helper \} from "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fmodules%2Fhelper\.js"/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /import\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fmodules%2Fdynamic\.js"\)/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /new Worker\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fworkers%2Fbackground\.js"/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /navigator\.serviceWorker\.register\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fsw\.js"/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /importScripts\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvendor%2Fa\.js", "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvendor%2Fb\.js"\)/
  );
  assert.match(
    rewriteJs(js, "https://example.com/app/client.js"),
    /new EventSource\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fevents%2Flive"\)/
  );
  assert.doesNotMatch(rewriteJs('export default "/logo.png";', "https://example.com/app/client.js"), /proxy\?url=/);
});

test("buildFrameHelperScript and sanitizeProxyHeaders lock down iframe integration behavior", () => {
  const helper = buildFrameHelperScript("https://example.com/inside");
  const headers = sanitizeProxyHeaders({
    "content-security-policy":
      "default-src 'self'; frame-ancestors 'none'; sandbox allow-scripts; report-uri /csp; report-to csp-endpoint; navigate-to 'self'; object-src 'none'",
    "content-security-policy-report-only": "default-src 'self'",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000",
    "content-length": "123",
  });

  assert.match(helper, new RegExp(FRAME_EVENT_SOURCE));
  assert.match(helper, /https:\/\/example\.com\/inside/);
  assert.match(helper, /window\.fetch = function/);
  assert.match(helper, /XMLHttpRequest\.prototype\.open/);
  assert.match(helper, /window\.Worker = function/);
  assert.match(helper, /navigator\.serviceWorker\.register = function/);
  assert.match(helper, /rewriteNodeTree\(document\)/);
  assert.ok(!("x-frame-options" in headers));
  assert.ok(!("strict-transport-security" in headers));
  assert.ok(!("content-length" in headers));
  assert.ok(!("content-security-policy-report-only" in headers));
  assert.equal(headers["content-security-policy"].replace(/\s+/g, " ").trim(), "default-src 'self'; object-src 'none'");
});
