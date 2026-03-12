import express from "express";
import cors from "cors";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan("dev"));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  "/proxy",
  (req, res, next) => {
    const target = req.query.url;
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Missing ?url= param" });
    }
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
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
        proxyReq.setHeader("user-agent", ua);
        if (!proxyReq.getHeader("accept")) {
          proxyReq.setHeader(
            "accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          );
        }
        if (!proxyReq.getHeader("accept-language")) {
          proxyReq.setHeader("accept-language", "en-US,en;q=0.9");
        }
      },
      onProxyRes(proxyRes, reqInner, res) {
        // Strip frame-blocking headers.
        if (proxyRes.headers["x-frame-options"]) {
          delete proxyRes.headers["x-frame-options"];
        }
        const cspHeader =
          proxyRes.headers["content-security-policy"] ||
          proxyRes.headers["Content-Security-Policy"];
        if (cspHeader && typeof cspHeader === "string") {
          const cleaned = cspHeader.replace(/frame-ancestors[^;]*;?/gi, "");
          proxyRes.headers["content-security-policy"] = cleaned;
          delete proxyRes.headers["Content-Security-Policy"];
        }

        const chunks = [];
        proxyRes.on("data", (chunk) => {
          chunks.push(chunk);
        });

        proxyRes.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const contentType =
            (proxyRes.headers["content-type"] ||
              proxyRes.headers["Content-Type"] ||
              "") + "";

          // Basic HTML rewriting: inject a small helper script for future JS hooks.
          if (contentType.includes("text/html")) {
            let body = buffer.toString("utf8");
            const targetUrl =
              reqInner.plutoniumTarget ||
              (typeof reqInner.query?.url === "string"
                ? reqInner.query.url
                : "");

            const helperScript = `
<script>
(function () {
  try {
    // Prevent simple frame-busting that relies on window.top checks.
    Object.defineProperty(window, "top", { get: function () { return window; } });
  } catch (e) {}
  window.__plutonium = window.__plutonium || {};
  window.__plutonium.originalUrl = ${JSON.stringify(targetUrl || "")};
})();\n</script>`;

            if (body.includes("</head>")) {
              body = body.replace("</head>", helperScript + "</head>");
            } else if (body.includes("</body>")) {
              body = body.replace("</body>", helperScript + "</body>");
            } else {
              body += helperScript;
            }

            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            res.end(body);
            return;
          }

          // Non-HTML: just pass through untouched.
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
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

