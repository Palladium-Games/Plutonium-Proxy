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
  sanitizeProxyHeaders,
} from "./proxy-utils.js";

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
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
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
  const rewriteable = isRewriteableContentType(contentType);

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

  if (contentType.includes("text/css")) {
    return rewriteCss(buffer.toString("utf8"), targetUrl);
  }

  if (contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
    return rewriteJs(buffer.toString("utf8"), targetUrl);
  }

  return buffer;
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
