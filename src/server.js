import express from "express";
import compression from "compression";
import cors from "cors";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const PROXY_PATH = "/proxy";

/** Resolve url against base and return absolute href, or null if skip. */
function resolveProxyUrl(urlStr, baseUrl) {
  const s = (urlStr || "").trim();
  if (!s || s.startsWith("javascript:") || s.startsWith("data:") || s.startsWith("mailto:") || s.startsWith("blob:") || s === "#") return null;
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(s, base);
    return resolved.href;
  } catch {
    return null;
  }
}

/** Fix doubled Google search URLs (e.g. q=hi/search?q=hi -> q=hi). */
function normalizeGoogleSearchUrl(href) {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("google.com") || u.pathname !== "/search") return href;
    const q = u.searchParams.get("q");
    if (!q || !q.includes("/search?q=")) return href;
    u.searchParams.set("q", q.slice(0, q.indexOf("/search?q=")));
    return u.href;
  } catch {
    return href;
  }
}

/** Rewrite a single URL for proxy; returns null if skip. */
function toProxyAttr(resolved) {
  return resolved ? `${PROXY_PATH}?url=${encodeURIComponent(resolved)}` : null;
}

/** Rewrite HTML: href, src, action, formaction, and srcset go through proxy. */
function rewriteHtml(html, baseUrl) {
  const rewriteAttr = (match, attr, value) => {
    let resolved = resolveProxyUrl(value, baseUrl);
    if (resolved) resolved = normalizeGoogleSearchUrl(resolved);
    const proxy = toProxyAttr(resolved);
    return proxy ? `${attr}="${proxy}"` : match;
  };

  let out = html
    .replace(/\s(href)=(["'])([^"']*)\2/gi, (m, attr, q, v) => rewriteAttr(m, attr, v) || m)
    .replace(/\s(src)=(["'])([^"']*)\2/gi, (m, attr, q, v) => rewriteAttr(m, attr, v) || m)
    .replace(/\s(action)=(["'])([^"']*)\2/gi, (m, attr, q, v) => rewriteAttr(m, attr, v) || m)
    .replace(/\s(formaction)=(["'])([^"']*)\2/gi, (m, attr, q, v) => rewriteAttr(m, attr, v) || m);

  // srcset: "url1 1x, url2 2x" -> rewrite each URL
  out = out.replace(/\s(srcset)=(["'])([^"']+)\2/gi, (match, attr, q, value) => {
    const parts = value.split(/,\s*/).map((part) => {
      const u = part.trim().split(/\s+/)[0];
      let resolved = resolveProxyUrl(u, baseUrl);
      if (resolved) resolved = normalizeGoogleSearchUrl(resolved);
      const proxy = toProxyAttr(resolved);
      if (!proxy) return part;
      return part.replace(u, proxy);
    });
    return `${attr}=${q}${parts.join(", ")}${q}`;
  });

  return out;
}

/** Rewrite CSS: url(...) and @import to go through proxy. */
function rewriteCss(css, baseUrl) {
  try {
    const base = new URL(baseUrl);
    const proxyUrl = (u) => {
      const resolved = new URL(u, base);
      return `${PROXY_PATH}?url=${encodeURIComponent(resolved.href)}`;
    };
    let out = css
      .replace(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, (_, u) => `url("${proxyUrl(u.trim())}")`)
      .replace(/@import\s+["']([^"']+)["']/g, (_, u) => `@import "${proxyUrl(u.trim())}"`);
    return out;
  } catch {
    return css;
  }
}

/** Rewrite JS: quoted paths like "/path" or '/api' to proxy URLs so fetch/XMLHttpRequest work. */
function rewriteJs(js, baseUrl) {
  try {
    const base = new URL(baseUrl);
    return js.replace(/(["'])(\/(?!\/)[^"'\s]*)\1/g, (_, quote, pathStr) => {
      try {
        const resolved = new URL(pathStr, base);
        return `${quote}${PROXY_PATH}?url=${encodeURIComponent(resolved.href)}${quote}`;
      } catch {
        return _ + pathStr + _;
      }
    });
  } catch {
    return js;
  }
}

/** Cache-Control for static assets (CSS, JS, fonts, images). */
const ASSET_CACHE = "public, max-age=3600";

app.use(compression({ level: 6 }));
app.use(cors());
app.use(morgan("dev"));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  PROXY_PATH,
  (req, res, next) => {
    let target = req.query.url;
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Missing ?url= param" });
    }
    target = normalizeGoogleSearchUrl(target);
    try {
      new URL(target);
    } catch {
      return res.status(400).json({ error: "Invalid url param" });
    }
    req.plutoniumTarget = target;
    next();
  },
  (req, res, next) => {
    const target = req.plutoniumTarget;
    return createProxyMiddleware({
      target,
      changeOrigin: true,
      followRedirects: true,
      secure: false,
      selfHandleResponse: true,
      logger: console,
      onProxyReq(proxyReq, reqInner) {
        const ua =
          reqInner.headers["user-agent"] ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        proxyReq.setHeader("user-agent", ua);
        const clientIp = reqInner.headers["x-forwarded-for"]?.split(",")[0]?.trim() || reqInner.socket?.remoteAddress || "";
        if (clientIp) {
          proxyReq.setHeader("x-forwarded-for", clientIp);
          proxyReq.setHeader("x-real-ip", clientIp);
        }
        if (!proxyReq.getHeader("accept")) {
          proxyReq.setHeader(
            "accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          );
        }
        if (!proxyReq.getHeader("accept-language")) {
          proxyReq.setHeader("accept-language", "en-US,en;q=0.9");
        }
        const ref = reqInner.headers["referer"] || reqInner.headers["referrer"];
        if (ref) proxyReq.setHeader("referer", ref);
      },
      onProxyRes(proxyRes, reqInner, res) {
        const headers = { ...proxyRes.headers };
        delete headers["x-frame-options"];
        delete headers["strict-transport-security"];
        const cspHeader = headers["content-security-policy"] || headers["Content-Security-Policy"];
        if (cspHeader && typeof cspHeader === "string") {
          const cleaned = cspHeader.replace(/frame-ancestors[^;]*;?/gi, "").trim();
          if (cleaned) headers["content-security-policy"] = cleaned;
          else delete headers["content-security-policy"];
          delete headers["Content-Security-Policy"];
        }

        const contentType = (headers["content-type"] || headers["Content-Type"] || "") + "";
        const targetUrl = reqInner.plutoniumTarget || (typeof reqInner.query?.url === "string" ? reqInner.query.url : "");
        const needsRewrite =
          contentType.includes("text/html") ||
          contentType.includes("text/css") ||
          contentType.includes("application/javascript") ||
          contentType.includes("text/javascript");

        if (!needsRewrite) {
          delete headers["content-length"];
          if (
            contentType.includes("image/") ||
            contentType.includes("font/") ||
            contentType.includes("application/font") ||
            contentType.includes("video/")
          ) {
            headers["cache-control"] = ASSET_CACHE;
          }
          res.writeHead(proxyRes.statusCode || 200, headers);
          proxyRes.pipe(res);
          return;
        }

        const chunks = [];
        const encoding = (headers["content-encoding"] || "").toLowerCase();
        const stream =
          encoding === "gzip"
            ? proxyRes.pipe(zlib.createGunzip())
            : encoding === "br"
              ? proxyRes.pipe(zlib.createBrotliDecompress())
              : encoding === "deflate"
                ? proxyRes.pipe(zlib.createInflate())
                : proxyRes;
        stream.on("error", () => {
          delete headers["content-encoding"];
          res.writeHead(502, headers);
          res.end("Proxy decompression error");
        });
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          const buffer = Buffer.concat(chunks);
          delete headers["content-encoding"];
          delete headers["Content-Encoding"];

          if (contentType.includes("text/html")) {
            let body = buffer.toString("utf8");
            body = rewriteHtml(body, targetUrl);

            const helperScript = `
<script>
(function () {
  try { Object.defineProperty(window, "top", { get: function () { return window; } }); } catch (e) {}
  window.__plutonium = window.__plutonium || {};
  window.__plutonium.originalUrl = ${JSON.stringify(targetUrl || "")};
})();\n</script>`;
            if (body.includes("</head>")) body = body.replace("</head>", helperScript + "</head>");
            else if (body.includes("</body>")) body = body.replace("</body>", helperScript + "</body>");
            else body += helperScript;

            delete headers["content-length"];
            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(body);
            return;
          }

          if (contentType.includes("text/css")) {
            let body = buffer.toString("utf8");
            body = rewriteCss(body, targetUrl);
            headers["cache-control"] = ASSET_CACHE;
            delete headers["content-length"];
            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(body);
            return;
          }

          if (
            contentType.includes("application/javascript") ||
            contentType.includes("text/javascript")
          ) {
            let body = buffer.toString("utf8");
            body = rewriteJs(body, targetUrl);
            headers["cache-control"] = ASSET_CACHE;
            delete headers["content-length"];
            res.writeHead(proxyRes.statusCode || 200, headers);
            res.end(body);
            return;
          }

          delete headers["content-length"];
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(buffer);
        });
      },
      pathRewrite: (pathReq) => {
        const urlObj = new URL(target);
        return urlObj.pathname + urlObj.search;
      },
    })(req, res, next);
  }
);

app.listen(PORT, () => {
  console.log(`Plutonium Proxy listening on http://localhost:${PORT}`);
});

