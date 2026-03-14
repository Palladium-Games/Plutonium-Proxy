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
  rewriteManifestJson,
  rewriteTextPlaylist,
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
        <script type="module">
          import "/modules/inline.js";
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
  assert.match(rewritten, /import "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fmodules%2Finline\.js"/);
  assert.doesNotMatch(rewritten, /integrity=/);
});

test("rewriteHtml keeps top-targeted navigation inside the proxy iframe", () => {
  const html = '<a href="/challenge" target="_top">Verify</a><form action="/submit" target="_parent"></form>';
  const rewritten = rewriteHtml(html, "https://example.com/start");

  assert.match(rewritten, /target="_self"/);
});

test("rewriteCss and rewriteJs keep asset fetches inside the proxy", () => {
  const css = `
    @import "/styles/site.css";
    @import url("/styles/theme.css");
    .hero { background-image: url("../img/hero.png"); }
    /*# sourceMappingURL=main.css.map */
  `;
  const js = `
    import workerUrl from "/workers/main.js";
    export { helper } from "/modules/helper.js";
    import("/modules/dynamic.js");
    const chunkUrl = new URL("./chunks/player.js", import.meta.url);
    new Worker("/workers/background.js");
    navigator.serviceWorker.register("/sw.js", { scope: "/scope/" });
    importScripts("/vendor/a.js", "/vendor/b.js");
    new EventSource("/events/live");
    //# sourceMappingURL=client.js.map
  `;

  const rewrittenCss = rewriteCss(css, "https://example.com/app/main.css");
  const rewrittenJs = rewriteJs(js, "https://example.com/app/client.js");

  assert.match(
    rewrittenCss,
    /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fstyles%2Fsite\.css/
  );
  assert.match(
    rewrittenCss,
    /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fstyles%2Ftheme\.css/
  );
  assert.match(
    rewrittenCss,
    /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fimg%2Fhero\.png/
  );
  assert.match(
    rewrittenCss,
    /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fapp%2Fmain\.css\.map/
  );
  assert.match(
    rewrittenJs,
    /import workerUrl from "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fworkers%2Fmain\.js"/
  );
  assert.match(
    rewrittenJs,
    /export \{ helper \} from "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fmodules%2Fhelper\.js"/
  );
  assert.match(
    rewrittenJs,
    /import\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fmodules%2Fdynamic\.js"\)/
  );
  assert.match(
    rewrittenJs,
    /new URL\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fapp%2Fchunks%2Fplayer\.js", import\.meta\.url\)/
  );
  assert.match(
    rewrittenJs,
    /new Worker\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fworkers%2Fbackground\.js"/
  );
  assert.match(
    rewrittenJs,
    /navigator\.serviceWorker\.register\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fsw\.js"/
  );
  assert.match(
    rewrittenJs,
    /importScripts\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvendor%2Fa\.js", "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvendor%2Fb\.js"\)/
  );
  assert.match(
    rewrittenJs,
    /new EventSource\("\/proxy\?url=https%3A%2F%2Fexample\.com%2Fevents%2Flive"\)/
  );
  assert.match(
    rewrittenJs,
    /\/\/# sourceMappingURL=\/proxy\?url=https%3A%2F%2Fexample\.com%2Fapp%2Fclient\.js\.map/
  );
  assert.doesNotMatch(rewriteJs('export default "/logo.png";', "https://example.com/app/client.js"), /proxy\?url=/);
});

test("rewriteManifestJson and SVG-style hrefs keep metadata assets proxied", () => {
  const manifest = JSON.stringify({
    start_url: "/start",
    scope: "/app/",
    icons: [{ src: "/icons/app-192.png" }],
    shortcuts: [{ url: "/shortcuts/inbox", icons: [{ src: "/icons/inbox.png" }] }],
    share_target: { action: "/share" },
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="/sprite.svg#mark"></use></svg>';

  const rewrittenManifest = rewriteManifestJson(manifest, "https://example.com/app/site.webmanifest");
  const rewrittenSvg = rewriteHtml(svg, "https://example.com/app/logo.svg");

  assert.match(rewrittenManifest, /"start_url": "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fstart"/);
  assert.match(rewrittenManifest, /"scope": "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fapp%2F"/);
  assert.match(rewrittenManifest, /"src": "\/proxy\?url=https%3A%2F%2Fexample\.com%2Ficons%2Fapp-192\.png"/);
  assert.match(rewrittenManifest, /"url": "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fshortcuts%2Finbox"/);
  assert.match(rewrittenManifest, /"action": "\/proxy\?url=https%3A%2F%2Fexample\.com%2Fshare"/);
  assert.match(rewrittenSvg, /xlink:href="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fsprite\.svg%23mark"/);
});

test("rewriteTextPlaylist keeps media playlist segments inside the proxy", () => {
  const playlist = `
#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.000,
segment-1.ts
#EXT-X-KEY:METHOD=AES-128,URI="keys/main.key"
  `;

  const rewritten = rewriteTextPlaylist(playlist, "https://example.com/video/master.m3u8");

  assert.match(rewritten, /URI="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvideo%2Finit\.mp4"/);
  assert.match(rewritten, /\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvideo%2Fsegment-1\.ts/);
  assert.match(rewritten, /URI="\/proxy\?url=https%3A%2F%2Fexample\.com%2Fvideo%2Fkeys%2Fmain\.key"/);
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
