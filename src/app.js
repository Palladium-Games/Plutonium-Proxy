import compression from "compression";
import cors from "cors";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import {
  ASSET_CACHE,
  PROXY_PATH,
  extractTargetUrl,
  injectFrameHelper,
  isCacheableAssetContentType,
  isRewriteableContentType,
  normalizeGoogleSearchUrl,
  rewriteCss,
  rewriteHtml,
  rewriteJs,
  rewriteManifestJson,
  rewriteTextPlaylist,
  sanitizeProxyHeaders,
} from "./proxy-utils.js";
import {
  attachProxySession,
  getUpstreamCookieHeader,
  storeUpstreamCookies,
} from "./upstream-cookies.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PROXY_TIMEOUT_MS = 30000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function createSilentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

/**
 * Create the Express application used by the local proxy server.
 *
 * @param {object} [options] Optional configuration overrides.
 * @param {boolean} [options.enableRequestLogging=true] Enable HTTP request logging.
 * @param {{info: Function, warn: Function, error: Function}} [options.logger=console] Logger used by the proxy middleware.
 * @param {string} [options.staticDir] Override the static public directory.
 * @returns {import("express").Express} Configured Express application.
 */
export function createApp(options = {}) {
  const {
    enableRequestLogging = true,
    logger = console,
    staticDir = path.join(__dirname, "..", "public"),
  } = options;

  const app = express();
  const proxyLogger = logger || createSilentLogger();

  app.disable("x-powered-by");
  app.use(
    compression({
      level: 4,
      threshold: 1024,
    })
  );
  app.use(cors());
  app.use(express.json());
  app.use(attachProxySession);

  if (enableRequestLogging) {
    app.use(morgan("dev"));
  }

  app.use(express.static(staticDir));

  app.use(PROXY_PATH, validateTargetUrl, createProxyMiddleware(createProxyOptions(proxyLogger)));

  return app;
}

/**
 * Start the HTTP server for interactive local development.
 *
 * @param {object} [options] Start options.
 * @param {number} [options.port=3000] TCP port for the HTTP server.
 * @returns {import("http").Server} Running HTTP server instance.
 */
export function startServer(options = {}) {
  const { port = 3000 } = options;
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Plutonium Proxy listening on http://localhost:${port}`);
  });

  return server;
}

/**
 * Validate and normalize the requested upstream target URL.
 *
 * @param {import("express").Request} req Incoming proxy request.
 * @param {import("express").Response} res Proxy response.
 * @param {import("express").NextFunction} next Express continuation.
 * @returns {void}
 */
function validateTargetUrl(req, res, next) {
  let target = req.query.url;
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Missing ?url= param" });
    return;
  }

  target = normalizeGoogleSearchUrl(target);

  try {
    new URL(target);
  } catch {
    res.status(400).json({ error: "Invalid url param" });
    return;
  }

  req.plutoniumTarget = target;
  next();
}

/**
 * Create the proxy middleware configuration.
 *
 * @param {{info: Function, warn: Function, error: Function}} logger Proxy logger.
 * @returns {import("http-proxy-middleware").Options<import("express").Request, import("express").Response>}
 */
function createProxyOptions(logger) {
  return {
    target: "http://127.0.0.1",
    changeOrigin: true,
    followRedirects: true,
    secure: false,
    selfHandleResponse: true,
    timeout: DEFAULT_PROXY_TIMEOUT_MS,
    proxyTimeout: DEFAULT_PROXY_TIMEOUT_MS,
    xfwd: true,
    logger,
    router(req) {
      return new URL(req.plutoniumTarget).origin;
    },
    pathRewrite(_path, req) {
      const url = new URL(req.plutoniumTarget);
      return `${url.pathname}${url.search}`;
    },
    on: {
      proxyReq(proxyReq, req) {
        if (proxyReq.headersSent) {
          return;
        }

        setProxyHeader(proxyReq, "user-agent", req.headers["user-agent"] || DEFAULT_USER_AGENT);

        if (!proxyReq.getHeader("accept")) {
          setProxyHeader(
            proxyReq,
            "accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/css,application/javascript,text/javascript,application/json;q=0.9,application/manifest+json,application/vnd.apple.mpegurl,application/x-mpegurl,audio/mpegurl,text/vtt,image/avif,image/webp,image/apng,image/svg+xml,audio/*,video/*,*/*;q=0.8"
          );
        }

        if (!proxyReq.getHeader("accept-language")) {
          setProxyHeader(proxyReq, "accept-language", "en-US,en;q=0.9");
        }

        const forwardedFor = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
        if (forwardedFor) {
          setProxyHeader(proxyReq, "x-real-ip", forwardedFor);
        }

        const referer = extractTargetUrl(req.headers.referer) || extractTargetUrl(req.headers.referrer);
        if (referer) {
          setProxyHeader(proxyReq, "referer", referer);
        }

        const origin = mapRequestOrigin(req);
        if (origin) {
          setProxyHeader(proxyReq, "origin", origin);
        }

        const upstreamCookies = getUpstreamCookieHeader(req.plutoniumSessionId, req.plutoniumTarget);
        if (upstreamCookies) {
          setProxyHeader(proxyReq, "cookie", upstreamCookies);
        } else {
          removeProxyHeader(proxyReq, "cookie");
        }
      },
      proxyRes(proxyRes, req, res) {
        handleProxyResponse(proxyRes, req, res);
      },
      error(error, _req, res) {
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        }
        res.end(`Proxy error: ${error.message}`);
      },
    },
  };
}

/**
 * Stream or rewrite the upstream response before returning it to the browser.
 *
 * @param {import("http").IncomingMessage} proxyRes Upstream response.
 * @param {import("express").Request} req Original downstream request.
 * @param {import("express").Response} res Downstream response.
 * @returns {void}
 */
function handleProxyResponse(proxyRes, req, res) {
  const headers = sanitizeProxyHeaders(proxyRes.headers);
  const contentType = `${proxyRes.headers["content-type"] || ""}`.toLowerCase();
  const statusCode = proxyRes.statusCode || 200;
  const targetUrl = req.plutoniumTarget || "";
  const rewriteable =
    isRewriteableContentType(contentType) ||
    isStylesheetLikeResponse(contentType, targetUrl) ||
    isJavaScriptLikeResponse(contentType, targetUrl) ||
    isManifestLikeResponse(contentType, targetUrl) ||
    isPlaylistLikeResponse(contentType, targetUrl) ||
    isSvgLikeResponse(contentType, targetUrl);

  storeUpstreamCookies(req.plutoniumSessionId, targetUrl, proxyRes.headers["set-cookie"]);
  delete headers["set-cookie"];

  if (req.method === "HEAD") {
    if (isCacheableAssetContentType(contentType)) {
      headers["cache-control"] = ASSET_CACHE;
    }

    res.writeHead(statusCode, headers);
    res.end();
    return;
  }

  if (!rewriteable) {
    if (isCacheableAssetContentType(contentType)) {
      headers["cache-control"] = ASSET_CACHE;
    }

    res.writeHead(statusCode, headers);
    proxyRes.pipe(res);
    return;
  }

  const stream = decodeProxyStream(proxyRes, `${proxyRes.headers["content-encoding"] || ""}`.toLowerCase());
  const chunks = [];

  stream.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Proxy decompression error");
  });

  stream.on("end", () => {
    try {
      const buffer = Buffer.concat(chunks);
      const body = rewriteResponseBody(buffer, contentType, targetUrl);
      const payload = Buffer.from(body);

      if (isCacheableAssetContentType(contentType)) {
        headers["cache-control"] = ASSET_CACHE;
      }

      headers["content-length"] = String(Buffer.byteLength(payload));
      res.writeHead(statusCode, headers);
      res.end(payload);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end(`Proxy rewrite error: ${error.message}`);
    }
  });
}

/**
 * Convert a buffered upstream response into the body returned to the browser.
 *
 * @param {Buffer} buffer Upstream response bytes.
 * @param {string} contentType Upstream content type.
 * @param {string} targetUrl Current upstream URL.
 * @returns {string | Buffer} Rewritten body.
 */
function rewriteResponseBody(buffer, contentType, targetUrl) {
  if (contentType.includes("text/html")) {
    return injectFrameHelper(rewriteHtml(buffer.toString("utf8"), targetUrl), targetUrl);
  }

  if (isStylesheetLikeResponse(contentType, targetUrl)) {
    return rewriteCss(buffer.toString("utf8"), targetUrl);
  }

  if (isManifestLikeResponse(contentType, targetUrl)) {
    return rewriteManifestJson(buffer.toString("utf8"), targetUrl);
  }

  if (isPlaylistLikeResponse(contentType, targetUrl)) {
    return rewriteTextPlaylist(buffer.toString("utf8"), targetUrl);
  }

  if (isSvgLikeResponse(contentType, targetUrl)) {
    return rewriteHtml(buffer.toString("utf8"), targetUrl);
  }

  if (isJavaScriptLikeResponse(contentType, targetUrl)) {
    return rewriteJs(buffer.toString("utf8"), targetUrl);
  }

  return buffer;
}

/**
 * Check whether the upstream response contains JavaScript that should be rewritten.
 *
 * @param {string} contentType Upstream content type.
 * @returns {boolean} `true` when the body should be treated as JavaScript.
 */
function isJavaScriptContentType(contentType) {
  return (
    contentType.includes("application/javascript") ||
    contentType.includes("application/x-javascript") ||
    contentType.includes("application/ecmascript") ||
    contentType.includes("text/javascript1.8") ||
    contentType.includes("text/ecmascript") ||
    contentType.includes("text/javascript")
  );
}

/**
 * Check whether the response behaves like a JavaScript module or script even
 * when the server sends a generic text content type.
 *
 * @param {string} contentType Upstream content type.
 * @param {string} targetUrl Current upstream URL.
 * @returns {boolean} `true` when the body should be treated as JavaScript.
 */
function isJavaScriptLikeResponse(contentType, targetUrl) {
  return (
    isJavaScriptContentType(contentType) ||
    hasUrlExtension(targetUrl, ".js") ||
    hasUrlExtension(targetUrl, ".mjs") ||
    hasUrlExtension(targetUrl, ".cjs")
  );
}

/**
 * Check whether the response behaves like a stylesheet even when the server
 * falls back to a generic text content type.
 *
 * @param {string} contentType Upstream content type.
 * @param {string} targetUrl Current upstream URL.
 * @returns {boolean} `true` when the body should be treated as CSS.
 */
function isStylesheetLikeResponse(contentType, targetUrl) {
  return contentType.includes("text/css") || hasUrlExtension(targetUrl, ".css");
}

/**
 * Check whether the response behaves like a web manifest even when the server
 * sends a generic JSON content type.
 *
 * @param {string} contentType Upstream content type.
 * @param {string} targetUrl Current upstream URL.
 * @returns {boolean} `true` when the body should be treated as a manifest.
 */
function isManifestLikeResponse(contentType, targetUrl) {
  return contentType.includes("application/manifest+json") || hasUrlExtension(targetUrl, ".webmanifest");
}

/**
 * Check whether the response behaves like an HLS-style text playlist that
 * needs URI rewriting for proxied media playback.
 *
 * @param {string} contentType Upstream content type.
 * @param {string} targetUrl Current upstream URL.
 * @returns {boolean} `true` when the body should be treated as a text playlist.
 */
function isPlaylistLikeResponse(contentType, targetUrl) {
  return (
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl") ||
    hasUrlExtension(targetUrl, ".m3u8")
  );
}

/**
 * Check whether the response behaves like an SVG document even when the server
 * omits the ideal SVG content type.
 *
 * @param {string} contentType Upstream content type.
 * @param {string} targetUrl Current upstream URL.
 * @returns {boolean} `true` when the body should be treated as SVG markup.
 */
function isSvgLikeResponse(contentType, targetUrl) {
  return contentType.includes("image/svg+xml") || hasUrlExtension(targetUrl, ".svg");
}

/**
 * Check the upstream path extension for responses that are commonly served with
 * inconsistent content types.
 *
 * @param {string} targetUrl Current upstream URL.
 * @param {string} extension File extension including the leading dot.
 * @returns {boolean} `true` when the upstream URL ends with the given extension.
 */
function hasUrlExtension(targetUrl, extension) {
  try {
    return new URL(targetUrl).pathname.toLowerCase().endsWith(extension);
  } catch {
    return false;
  }
}

/**
 * Decode a compressed upstream stream when the response will be rewritten.
 *
 * @param {import("http").IncomingMessage} proxyRes Upstream response stream.
 * @param {string} encoding Upstream content-encoding value.
 * @returns {import("stream").Readable} Decoded stream.
 */
function decodeProxyStream(proxyRes, encoding) {
  if (encoding === "gzip") {
    return proxyRes.pipe(zlib.createGunzip());
  }

  if (encoding === "br") {
    return proxyRes.pipe(zlib.createBrotliDecompress());
  }

  if (encoding === "deflate") {
    return proxyRes.pipe(zlib.createInflate());
  }

  return proxyRes;
}

/**
 * Set a proxied request header only when the underlying request is still mutable.
 *
 * @param {import("http").ClientRequest} proxyReq Outgoing proxied request.
 * @param {string} name Header name.
 * @param {string} value Header value.
 * @returns {void}
 */
function setProxyHeader(proxyReq, name, value) {
  if (proxyReq.headersSent) {
    return;
  }

  try {
    proxyReq.setHeader(name, value);
  } catch {}
}

/**
 * Remove a proxied request header only when the underlying request is still mutable.
 *
 * @param {import("http").ClientRequest} proxyReq Outgoing proxied request.
 * @param {string} name Header name.
 * @returns {void}
 */
function removeProxyHeader(proxyReq, name) {
  if (proxyReq.headersSent) {
    return;
  }

  try {
    proxyReq.removeHeader(name);
  } catch {}
}

/**
 * Map the browser's local proxy origin to the current upstream origin.
 *
 * @param {import("express").Request} req Incoming proxy request.
 * @returns {string} Upstream origin value or an empty string when none should be sent.
 */
function mapRequestOrigin(req) {
  const rawOrigin = `${req.headers.origin || ""}`.trim();
  if (!rawOrigin) {
    return "";
  }

  const localOrigin = `${req.protocol}://${req.get("host")}`;
  if (rawOrigin !== localOrigin) {
    return rawOrigin;
  }

  try {
    return new URL(req.plutoniumTarget).origin;
  } catch {
    return "";
  }
}
