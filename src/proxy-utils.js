/**
 * Shared proxy helpers for URL normalization, response rewriting, and iframe
 * synchronization between the proxied page and the browser shell.
 */

export const PROXY_PATH = "/proxy";
export const ASSET_CACHE = "public, max-age=3600";
export const FRAME_EVENT_SOURCE = "plutonium-frame";

const SKIPPED_PROTOCOLS = ["javascript:", "data:", "mailto:", "blob:"];

/**
 * Resolve an upstream URL and convert it into the local proxy route.
 *
 * @param {string | undefined | null} rawUrl Candidate upstream URL.
 * @param {string} baseUrl Absolute page URL used for resolution.
 * @returns {string | null} Proxied route or `null` when the URL should be left untouched.
 */
function toProxiedResolvedUrl(rawUrl, baseUrl) {
  let resolved = resolveProxyUrl(rawUrl, baseUrl);
  if (resolved) {
    resolved = normalizeGoogleSearchUrl(resolved);
  }

  return toProxyAttr(resolved);
}

/**
 * Rewrite a srcset-style attribute value into proxied URLs.
 *
 * @param {string} value Raw srcset value.
 * @param {string} baseUrl Current upstream page URL.
 * @returns {string} Rewritten srcset value.
 */
function rewriteSrcsetValue(value, baseUrl) {
  return value
    .split(/,\s*/)
    .map((part) => {
      const [rawUrl, ...descriptorParts] = part.trim().split(/\s+/);
      const proxyValue = toProxiedResolvedUrl(rawUrl, baseUrl);
      if (!proxyValue) {
        return part;
      }

      return [proxyValue, ...descriptorParts].join(" ").trim();
    })
    .join(", ");
}

/**
 * Escape an HTML attribute value after inline CSS rewriting.
 *
 * @param {string} value Rewritten attribute value.
 * @param {'"' | "'"} quote Quote character that will wrap the value.
 * @returns {string} Safe attribute text.
 */
function escapeAttributeValue(value, quote) {
  if (quote === '"') {
    return value.replace(/"/g, "&quot;");
  }

  return value.replace(/'/g, "&#39;");
}

/**
 * Rewrite an import map payload so module URLs stay inside the local browser shell.
 *
 * @param {string} scriptBody Raw import map JSON.
 * @param {string} baseUrl Current upstream page URL.
 * @returns {string} Rewritten import map JSON.
 */
function rewriteImportMapJson(scriptBody, baseUrl) {
  try {
    const parsed = JSON.parse(scriptBody);

    if (parsed.imports && typeof parsed.imports === "object") {
      for (const key of Object.keys(parsed.imports)) {
        if (typeof parsed.imports[key] === "string") {
          parsed.imports[key] = toProxiedResolvedUrl(parsed.imports[key], baseUrl) || parsed.imports[key];
        }
      }
    }

    if (parsed.scopes && typeof parsed.scopes === "object") {
      const rewrittenScopes = {};
      for (const scopeKey of Object.keys(parsed.scopes)) {
        const rewrittenScopeKey = toProxiedResolvedUrl(scopeKey, baseUrl) || scopeKey;
        const scopeImports = parsed.scopes[scopeKey];
        if (!scopeImports || typeof scopeImports !== "object") {
          rewrittenScopes[rewrittenScopeKey] = scopeImports;
          continue;
        }

        rewrittenScopes[rewrittenScopeKey] = {};
        for (const importKey of Object.keys(scopeImports)) {
          const importTarget = scopeImports[importKey];
          rewrittenScopes[rewrittenScopeKey][importKey] =
            typeof importTarget === "string"
              ? toProxiedResolvedUrl(importTarget, baseUrl) || importTarget
              : importTarget;
        }
      }

      parsed.scopes = rewrittenScopes;
    }

    return JSON.stringify(parsed, null, 2);
  } catch {
    return scriptBody;
  }
}

/**
 * Rewrite a web app manifest so entry points and icon URLs stay inside the local browser shell.
 *
 * @param {string} manifestJson Raw manifest JSON.
 * @param {string} baseUrl Current upstream page URL.
 * @returns {string} Rewritten manifest JSON.
 */
export function rewriteManifestJson(manifestJson, baseUrl) {
  try {
    const parsed = JSON.parse(manifestJson);

    rewriteJsonUrlField(parsed, "start_url", baseUrl);
    rewriteJsonUrlField(parsed, "scope", baseUrl);
    rewriteJsonUrlField(parsed, "id", baseUrl);

    rewriteJsonUrlArray(parsed.icons, "src", baseUrl);
    rewriteJsonUrlArray(parsed.screenshots, "src", baseUrl);

    if (Array.isArray(parsed.shortcuts)) {
      parsed.shortcuts.forEach((shortcut) => {
        rewriteJsonUrlField(shortcut, "url", baseUrl);
        rewriteJsonUrlArray(shortcut?.icons, "src", baseUrl);
      });
    }

    if (Array.isArray(parsed.protocol_handlers)) {
      parsed.protocol_handlers.forEach((handler) => {
        rewriteJsonUrlField(handler, "url", baseUrl);
      });
    }

    if (Array.isArray(parsed.file_handlers)) {
      parsed.file_handlers.forEach((handler) => {
        rewriteJsonUrlField(handler, "action", baseUrl);
      });
    }

    if (parsed.share_target && typeof parsed.share_target === "object") {
      rewriteJsonUrlField(parsed.share_target, "action", baseUrl);
    }

    return JSON.stringify(parsed, null, 2);
  } catch {
    return manifestJson;
  }
}

/**
 * Rewrite one URL field inside a JSON object when present.
 *
 * @param {Record<string, unknown> | null | undefined} object Candidate object.
 * @param {string} fieldName Target field name.
 * @param {string} baseUrl Current upstream page URL.
 * @returns {void}
 */
function rewriteJsonUrlField(object, fieldName, baseUrl) {
  if (!object || typeof object !== "object" || typeof object[fieldName] !== "string") {
    return;
  }

  object[fieldName] = toProxiedResolvedUrl(object[fieldName], baseUrl) || object[fieldName];
}

/**
 * Rewrite one URL field across a JSON object array.
 *
 * @param {unknown} items Candidate object array.
 * @param {string} fieldName Target field name.
 * @param {string} baseUrl Current upstream page URL.
 * @returns {void}
 */
function rewriteJsonUrlArray(items, fieldName, baseUrl) {
  if (!Array.isArray(items)) {
    return;
  }

  items.forEach((item) => rewriteJsonUrlField(item, fieldName, baseUrl));
}

/**
 * Resolve a URL-like value against a base URL.
 *
 * @param {string | undefined | null} urlStr Raw attribute value from HTML/CSS/JS.
 * @param {string} baseUrl Absolute page URL used for resolution.
 * @returns {string | null} The absolute URL or `null` when it should not be proxied.
 */
export function resolveProxyUrl(urlStr, baseUrl) {
  const trimmed = `${urlStr || ""}`.trim();
  if (!trimmed || trimmed === "#" || SKIPPED_PROTOCOLS.some((protocol) => trimmed.startsWith(protocol))) {
    return null;
  }

  try {
    return new URL(trimmed, new URL(baseUrl)).href;
  } catch {
    return null;
  }
}

/**
 * Normalize malformed Google search URLs produced by repeated proxy rewrites.
 *
 * @param {string} href Candidate URL.
 * @returns {string} A cleaned URL when normalization is possible.
 */
export function normalizeGoogleSearchUrl(href) {
  try {
    const url = new URL(href);
    if (!url.hostname.endsWith("google.com") || url.pathname !== "/search") {
      return href;
    }

    const query = url.searchParams.get("q");
    if (!query || !query.includes("/search?q=")) {
      return href;
    }

    url.searchParams.set("q", query.slice(0, query.indexOf("/search?q=")));
    return url.href;
  } catch {
    return href;
  }
}

/**
 * Convert an absolute URL into a proxied route.
 *
 * @param {string | null} resolvedUrl Absolute URL to proxy.
 * @returns {string | null} Proxied route or `null` when no URL should be emitted.
 */
export function toProxyAttr(resolvedUrl) {
  return resolvedUrl ? `${PROXY_PATH}?url=${encodeURIComponent(resolvedUrl)}` : null;
}

/**
 * Extract the real target URL from an in-app proxy URL.
 *
 * @param {string | undefined | null} locationUrl Browser location or Referer header.
 * @returns {string | null} The decoded target URL when available.
 */
export function extractTargetUrl(locationUrl) {
  if (!locationUrl) {
    return null;
  }

  try {
    const current = new URL(locationUrl);
    if (!current.pathname.endsWith(PROXY_PATH)) {
      return null;
    }

    const target = current.searchParams.get("url");
    return target ? normalizeGoogleSearchUrl(target) : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite HTML attributes so downstream navigation stays inside the proxy.
 *
 * @param {string} html Raw upstream HTML.
 * @param {string} baseUrl Current upstream page URL.
 * @returns {string} Rewritten HTML.
 */
export function rewriteHtml(html, baseUrl) {
  const rewriteAttr = (match, attr, quote, value) => {
    if (`${value}`.trim().startsWith(`${PROXY_PATH}?url=`)) {
      return match;
    }

    const proxyValue = toProxiedResolvedUrl(value, baseUrl);
    return proxyValue ? ` ${attr}=${quote}${proxyValue}${quote}` : match;
  };

  let rewritten = html
    .replace(/\s(href)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(src)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(xlink:href)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(action)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(formaction)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(data-src|data-href|data-action|data-poster)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(poster)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(integrity)=(["'])[^"']*\2/gi, "")
    .replace(/\s(target)=(["'])(_top|_parent)\2/gi, ' target=$2_self$2');

  rewritten = rewritten.replace(/\s(srcset|imagesrcset|data-srcset)=(["'])([^"']+)\2/gi, (match, attr, quote, value) => {
    return ` ${attr}=${quote}${rewriteSrcsetValue(value, baseUrl)}${quote}`;
  });

  rewritten = rewritten.replace(/\s(style)=(["'])([\s\S]*?)\2/gi, (match, attr, quote, value) => {
    return ` ${attr}=${quote}${escapeAttributeValue(rewriteCss(value, baseUrl), quote)}${quote}`;
  });

  rewritten = rewritten.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, cssText) => {
    return `<style${attrs}>${rewriteCss(cssText, baseUrl)}</style>`;
  });

  rewritten = rewritten.replace(
    /<script\b([^>]*)type=(["'])importmap\2([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, beforeType, quote, afterType, scriptBody) => {
      return `<script${beforeType}type=${quote}importmap${quote}${afterType}>${rewriteImportMapJson(scriptBody, baseUrl)}</script>`;
    }
  );

  rewritten = rewritten.replace(
    /<script\b([^>]*)type=(["'])module\2([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, beforeType, quote, afterType, scriptBody) => {
      const attrs = `${beforeType}${afterType}`.toLowerCase();
      if (/\ssrc=/.test(attrs)) {
        return match;
      }
      return `<script${beforeType}type=${quote}module${quote}${afterType}>${rewriteJs(scriptBody, baseUrl)}</script>`;
    }
  );

  rewritten = rewritten.replace(/\scontent=(["'])([^"']+)\1/gi, (match, quote, value) => {
    const metaRefresh = value.match(/^(\d+\s*;\s*url=)(.+)$/i);
    if (!metaRefresh) {
      return match;
    }

    const proxyValue = toProxiedResolvedUrl(metaRefresh[2], baseUrl);
    return proxyValue ? ` content=${quote}${metaRefresh[1]}${proxyValue}${quote}` : match;
  });

  return rewritten;
}

/**
 * Rewrite CSS asset references so imports and `url(...)` requests stay proxied.
 *
 * @param {string} css Raw upstream CSS.
 * @param {string} baseUrl Current upstream CSS URL.
 * @returns {string} Rewritten CSS.
 */
export function rewriteCss(css, baseUrl) {
  try {
    return css
      .replace(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/g, (match, rawUrl) => {
        if (`${rawUrl}`.trim().startsWith(`${PROXY_PATH}?url=`)) {
          return match;
        }

        const proxyValue = toProxiedResolvedUrl(rawUrl.trim(), baseUrl);
        return proxyValue ? `@import url("${proxyValue}")` : match;
      })
      .replace(/@import\s+["']([^"']+)["']/g, (match, rawUrl) => {
        if (`${rawUrl}`.trim().startsWith(`${PROXY_PATH}?url=`)) {
          return match;
        }

        const proxyValue = toProxiedResolvedUrl(rawUrl.trim(), baseUrl);
        return proxyValue ? `@import "${proxyValue}"` : match;
      })
      .replace(/\/\*[#@]\s*sourceMappingURL=([^*\s]+)\s*\*\//g, (match, rawUrl) => {
        const proxyValue = toProxiedResolvedUrl(rawUrl.trim(), baseUrl);
        return proxyValue ? `/*# sourceMappingURL=${proxyValue} */` : match;
      })
      .replace(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, (match, rawUrl) => {
        if (`${rawUrl}`.trim().startsWith(`${PROXY_PATH}?url=`)) {
          return match;
        }

        const proxyValue = toProxiedResolvedUrl(rawUrl.trim(), baseUrl);
        return proxyValue ? `url("${proxyValue}")` : match;
      });
  } catch {
    return css;
  }
}

/**
 * Rewrite HLS-style text playlists so segment and map URLs stay inside the
 * proxy, which helps media-heavy sites keep loading video chunks in-session.
 *
 * @param {string} playlist Raw text playlist.
 * @param {string} baseUrl Current upstream playlist URL.
 * @returns {string} Rewritten playlist text.
 */
export function rewriteTextPlaylist(playlist, baseUrl) {
  try {
    return playlist
      .split(/\r?\n/)
      .map((line) => rewritePlaylistLine(line, baseUrl))
      .join("\n");
  } catch {
    return playlist;
  }
}

/**
 * Rewrite one playlist line or HLS tag in-place.
 *
 * @param {string} line Raw playlist line.
 * @param {string} baseUrl Current upstream playlist URL.
 * @returns {string} Rewritten line.
 */
function rewritePlaylistLine(line, baseUrl) {
  const trimmed = `${line || ""}`.trim();
  if (!trimmed) {
    return line;
  }

  if (trimmed.startsWith("#")) {
    return line.replace(/\bURI=(["']?)([^"',\s]+)\1/g, (match, quote, rawUrl) => {
      const proxyValue = toProxiedResolvedUrl(rawUrl, baseUrl);
      if (!proxyValue) {
        return match;
      }

      const safeQuote = quote || '"';
      return `URI=${safeQuote}${proxyValue}${safeQuote}`;
    });
  }

  const proxyValue = toProxiedResolvedUrl(trimmed, baseUrl);
  if (!proxyValue) {
    return line;
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] || "";
  return `${leadingWhitespace}${proxyValue}${trailingWhitespace}`;
}

/**
 * Rewrite root-relative JavaScript string literals so common fetch/XHR calls
 * continue to flow through the proxy.
 *
 * @param {string} js Raw upstream JavaScript.
 * @param {string} baseUrl Current upstream script URL.
 * @returns {string} Rewritten JavaScript.
 */
export function rewriteJs(js, baseUrl) {
  try {
    return js
      .replace(/(\bimport\s+)(["'])([^"']+)\2/g, (match, prefix, quote, specifier) => {
        const proxyValue = toProxiedResolvedUrl(specifier, baseUrl);
        return proxyValue ? `${prefix}${quote}${proxyValue}${quote}` : match;
      })
      .replace(/(\bimport\b[\s\S]*?\bfrom\s*)(["'])([^"']+)\2/g, (match, prefix, quote, specifier) => {
        const proxyValue = toProxiedResolvedUrl(specifier, baseUrl);
        return proxyValue ? `${prefix}${quote}${proxyValue}${quote}` : match;
      })
      .replace(/(\bexport\b[\s\S]*?\bfrom\s*)(["'])([^"']+)\2/g, (match, prefix, quote, specifier) => {
        const proxyValue = toProxiedResolvedUrl(specifier, baseUrl);
        return proxyValue ? `${prefix}${quote}${proxyValue}${quote}` : match;
      })
      .replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g, (match, prefix, quote, specifier, suffix) => {
        const proxyValue = toProxiedResolvedUrl(specifier, baseUrl);
        return proxyValue ? `${prefix}${quote}${proxyValue}${quote}${suffix}` : match;
      })
      .replace(/(\bnew\s+URL\s*\(\s*)(["'])([^"']+)\2(\s*,\s*import\.meta\.url\s*\))/g, (match, prefix, quote, requestUrl, suffix) => {
        const proxyValue = toProxiedResolvedUrl(requestUrl, baseUrl);
        return proxyValue ? `${prefix}${quote}${proxyValue}${quote}${suffix}` : match;
      })
      .replace(
        /(\bnew\s+(?:Worker|SharedWorker|EventSource)\s*\(\s*)(["'])([^"']+)\2/g,
        (match, prefix, quote, requestUrl) => {
          const proxyValue = toProxiedResolvedUrl(requestUrl, baseUrl);
          return proxyValue ? `${prefix}${quote}${proxyValue}${quote}` : match;
        }
      )
      .replace(
        /(\bnavigator\.serviceWorker\.register\s*\(\s*)(["'])([^"']+)\2/g,
        (match, prefix, quote, requestUrl) => {
          const proxyValue = toProxiedResolvedUrl(requestUrl, baseUrl);
          return proxyValue ? `${prefix}${quote}${proxyValue}${quote}` : match;
        }
      )
      .replace(/\bimportScripts\s*\(([^)]*)\)/g, (match, argsText) => {
        const rewrittenArgs = argsText.replace(/(["'])([^"']+)\1/g, (argMatch, quote, requestUrl) => {
          const proxyValue = toProxiedResolvedUrl(requestUrl, baseUrl);
          return proxyValue ? `${quote}${proxyValue}${quote}` : argMatch;
        });
        return `importScripts(${rewrittenArgs})`;
      })
      .replace(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/g, (match, rawUrl) => {
        const proxyValue = toProxiedResolvedUrl(rawUrl.trim(), baseUrl);
        return proxyValue ? `//# sourceMappingURL=${proxyValue}` : match;
      })
      .replace(/\/\*[#@]\s*sourceMappingURL=([^*\s]+)\s*\*\//g, (match, rawUrl) => {
        const proxyValue = toProxiedResolvedUrl(rawUrl.trim(), baseUrl);
        return proxyValue ? `/*# sourceMappingURL=${proxyValue} */` : match;
      });
  } catch {
    return js;
  }
}

/**
 * Remove or soften upstream headers that interfere with iframe rendering.
 *
 * @param {import("http").IncomingHttpHeaders} sourceHeaders Upstream headers.
 * @returns {Record<string, string | string[]>} Sanitized headers.
 */
export function sanitizeProxyHeaders(sourceHeaders = {}) {
  const headers = { ...sourceHeaders };

  delete headers["x-frame-options"];
  delete headers["strict-transport-security"];
  delete headers["content-encoding"];
  delete headers["transfer-encoding"];
  delete headers["content-length"];

  const contentSecurityPolicy = headers["content-security-policy"];
  if (typeof contentSecurityPolicy === "string") {
    const cleaned = contentSecurityPolicy
      .replace(/frame-ancestors[^;]*;?/gi, "")
      .replace(/report-uri[^;]*;?/gi, "")
      .replace(/report-to[^;]*;?/gi, "")
      .replace(/sandbox[^;]*;?/gi, "")
      .replace(/navigate-to[^;]*;?/gi, "")
      .trim();
    if (cleaned) {
      headers["content-security-policy"] = cleaned;
    } else {
      delete headers["content-security-policy"];
    }
  }

  delete headers["content-security-policy-report-only"];

  return headers;
}

/**
 * Determine whether a response body must be buffered and rewritten.
 *
 * @param {string} contentType Upstream content-type header.
 * @returns {boolean} `true` when the body should be rewritten.
 */
export function isRewriteableContentType(contentType) {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/css") ||
    contentType.includes("application/manifest+json") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl") ||
    contentType.includes("image/svg+xml") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/x-javascript") ||
    contentType.includes("application/ecmascript") ||
    contentType.includes("text/javascript1.8") ||
    contentType.includes("text/ecmascript") ||
    contentType.includes("text/javascript")
  );
}

/**
 * Determine whether a response should receive a short shared cache header.
 *
 * @param {string} contentType Upstream content-type header.
 * @returns {boolean} `true` when the response is a static asset.
 */
export function isCacheableAssetContentType(contentType) {
  return (
    contentType.includes("text/css") ||
    contentType.includes("text/vtt") ||
    contentType.includes("application/javascript") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/manifest+json") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl") ||
    contentType.includes("application/wasm") ||
    contentType.includes("application/json") ||
    contentType.includes("image/svg+xml") ||
    contentType.includes("image/") ||
    contentType.includes("font/") ||
    contentType.includes("application/font") ||
    contentType.includes("application/xml") ||
    contentType.includes("text/xml") ||
    contentType.includes("audio/") ||
    contentType.includes("video/")
  );
}

/**
 * Build the injected helper script that keeps the shell in sync with iframe
 * navigation and loading state.
 *
 * @param {string} targetUrl Current upstream page URL.
 * @returns {string} HTML snippet containing the helper script.
 */
export function buildFrameHelperScript(targetUrl) {
  const safeTargetUrl = JSON.stringify(targetUrl || "");

  return `
<script>
(function () {
  if (window.__plutoniumFrameBridgeInstalled) return;
  window.__plutoniumFrameBridgeInstalled = true;

  var SOURCE = ${JSON.stringify(FRAME_EVENT_SOURCE)};
  var ORIGINAL_URL = ${safeTargetUrl};
  var PROXY_PATH = ${JSON.stringify(PROXY_PATH)};

  function readTargetUrl() {
    try {
      var current = new URL(window.location.href);
      return current.searchParams.get("url") || ORIGINAL_URL || window.location.href;
    } catch (error) {
      return ORIGINAL_URL || window.location.href;
    }
  }

  function post(kind, extra) {
    try {
      window.parent.postMessage(Object.assign({
        source: SOURCE,
        kind: kind,
        url: readTargetUrl(),
        title: document.title || ""
      }, extra || {}), "*");
    } catch (error) {}
  }

  function commit() {
    post("commit", { readyState: document.readyState });
  }

  function loading() {
    post("loading", { readyState: document.readyState });
  }

  function resolveUpstreamUrl(rawUrl) {
    if (rawUrl == null || rawUrl === "") {
      return "";
    }

    var text = String(rawUrl).trim();
    if (!text || text === "#" || /^javascript:/i.test(text) || /^data:/i.test(text) || /^blob:/i.test(text) || /^mailto:/i.test(text)) {
      return "";
    }

    try {
      var proxiedCandidate = new URL(text, window.location.origin);
      if (proxiedCandidate.pathname === PROXY_PATH && proxiedCandidate.searchParams.get("url")) {
        return proxiedCandidate.searchParams.get("url");
      }
    } catch (error) {}

    try {
      return new URL(text, readTargetUrl()).href;
    } catch (error) {
      return "";
    }
  }

  function toProxyUrl(rawUrl) {
    var resolved = resolveUpstreamUrl(rawUrl);
    return resolved ? PROXY_PATH + "?url=" + encodeURIComponent(resolved) : "";
  }

  function normalizeTarget(element) {
    if (!element || typeof element.getAttribute !== "function" || typeof element.setAttribute !== "function") {
      return;
    }

    var target = (element.getAttribute("target") || "").toLowerCase();
    if (target === "_top" || target === "_parent") {
      element.setAttribute("target", "_self");
    }
  }

  function rewriteAnchor(anchor) {
    if (!anchor || typeof anchor.getAttribute !== "function") {
      return;
    }

    normalizeTarget(anchor);
    var href = anchor.getAttribute("href");
    var proxiedHref = toProxyUrl(href);
    if (proxiedHref) {
      anchor.setAttribute("href", proxiedHref);
    }
  }

  function rewriteForm(form) {
    if (!form || typeof form.getAttribute !== "function") {
      return;
    }

    normalizeTarget(form);
    var action = form.getAttribute("action") || readTargetUrl();
    var proxiedAction = toProxyUrl(action);
    if (proxiedAction) {
      form.setAttribute("action", proxiedAction);
    }
  }

  function rewriteNodeTree(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return;
    }

    if (typeof root.matches === "function") {
      if (root.matches("a[href]")) {
        rewriteAnchor(root);
      }
      if (root.matches("form[action], form[target]")) {
        rewriteForm(root);
      }
      if (root.matches("[srcset]")) {
        var rootSrcset = root.getAttribute("srcset");
        if (rootSrcset) {
          var rootSrcsetParts = rootSrcset.split(/,\s*/).map(function (part) {
            var tokens = part.trim().split(/\s+/);
            var proxied = toProxyUrl(tokens[0]);
            return proxied ? [proxied].concat(tokens.slice(1)).join(" ").trim() : part;
          });
          root.setAttribute("srcset", rootSrcsetParts.join(", "));
        }
      }
      if (root.matches("[imagesrcset]")) {
        var rootImageSrcset = root.getAttribute("imagesrcset");
        if (rootImageSrcset) {
          var rootImageParts = rootImageSrcset.split(/,\s*/).map(function (part) {
            var tokens = part.trim().split(/\s+/);
            var proxied = toProxyUrl(tokens[0]);
            return proxied ? [proxied].concat(tokens.slice(1)).join(" ").trim() : part;
          });
          root.setAttribute("imagesrcset", rootImageParts.join(", "));
        }
      }
    }

    root.querySelectorAll("a[href]").forEach(rewriteAnchor);
    root.querySelectorAll("form[action], form[target]").forEach(rewriteForm);

    root.querySelectorAll("[srcset]").forEach(function (element) {
      var srcset = element.getAttribute("srcset");
      if (srcset) {
        var parts = srcset.split(/,\s*/).map(function (part) {
          var tokens = part.trim().split(/\s+/);
          var proxied = toProxyUrl(tokens[0]);
          return proxied ? [proxied].concat(tokens.slice(1)).join(" ").trim() : part;
        });
        element.setAttribute("srcset", parts.join(", "));
      }
    });

    root.querySelectorAll("[imagesrcset]").forEach(function (element) {
      var imageSrcset = element.getAttribute("imagesrcset");
      if (imageSrcset) {
        var imageParts = imageSrcset.split(/,\s*/).map(function (part) {
          var tokens = part.trim().split(/\s+/);
          var proxied = toProxyUrl(tokens[0]);
          return proxied ? [proxied].concat(tokens.slice(1)).join(" ").trim() : part;
        });
        element.setAttribute("imagesrcset", imageParts.join(", "));
      }
    });
  }

  try {
    Object.defineProperty(window, "top", {
      get: function () {
        return window;
      }
    });
  } catch (error) {}

  ["pushState", "replaceState"].forEach(function (methodName) {
    var original = window.history[methodName];
    if (typeof original !== "function") return;

    window.history[methodName] = function () {
      if (arguments.length >= 3 && arguments[2]) {
        var proxiedHistoryUrl = toProxyUrl(arguments[2]);
        if (proxiedHistoryUrl) {
          arguments[2] = proxiedHistoryUrl;
        }
      }
      var result = original.apply(this, arguments);
      Promise.resolve().then(commit);
      return result;
    };
  });

  try {
    var locationProto = Object.getPrototypeOf(window.location);
    if (locationProto && typeof locationProto.assign === "function") {
      var originalAssign = locationProto.assign;
      locationProto.assign = function (nextUrl) {
        return originalAssign.call(this, toProxyUrl(nextUrl) || nextUrl);
      };
    }
    if (locationProto && typeof locationProto.replace === "function") {
      var originalReplace = locationProto.replace;
      locationProto.replace = function (nextUrl) {
        return originalReplace.call(this, toProxyUrl(nextUrl) || nextUrl);
      };
    }
  } catch (error) {}

  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof Request !== "undefined" && input instanceof Request) {
          var rewrittenRequestUrl = toProxyUrl(input.url);
          if (rewrittenRequestUrl) {
            return originalFetch(new Request(rewrittenRequestUrl, input), init);
          }
        }

        var rawInput = input && typeof input === "object" && "href" in input ? input.href : input;
        var rewrittenUrl = toProxyUrl(rawInput);
        if (rewrittenUrl) {
          return originalFetch(rewrittenUrl, init);
        }
      } catch (error) {}

      return originalFetch(input, init);
    };
  }

  if (typeof window.EventSource === "function") {
    var OriginalEventSource = window.EventSource;
    window.EventSource = function (requestUrl, eventSourceInitDict) {
      return new OriginalEventSource(toProxyUrl(requestUrl) || requestUrl, eventSourceInitDict);
    };
    window.EventSource.prototype = OriginalEventSource.prototype;
  }

  if (typeof window.Worker === "function") {
    var OriginalWorker = window.Worker;
    window.Worker = function (requestUrl, options) {
      return new OriginalWorker(toProxyUrl(requestUrl) || requestUrl, options);
    };
    window.Worker.prototype = OriginalWorker.prototype;
  }

  if (typeof window.SharedWorker === "function") {
    var OriginalSharedWorker = window.SharedWorker;
    window.SharedWorker = function (requestUrl, options) {
      return new OriginalSharedWorker(toProxyUrl(requestUrl) || requestUrl, options);
    };
    window.SharedWorker.prototype = OriginalSharedWorker.prototype;
  }

  if (navigator && navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
    var originalRegisterServiceWorker = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (scriptUrl, options) {
      var nextOptions = options;
      if (options && typeof options === "object" && options.scope) {
        nextOptions = Object.assign({}, options, {
          scope: toProxyUrl(options.scope) || options.scope
        });
      }

      return originalRegisterServiceWorker(toProxyUrl(scriptUrl) || scriptUrl, nextOptions);
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var originalXhrOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, requestUrl) {
      var proxiedUrl = toProxyUrl(requestUrl);
      arguments[1] = proxiedUrl || requestUrl;
      return originalXhrOpen.apply(this, arguments);
    };
  }

  if (navigator && typeof navigator.sendBeacon === "function") {
    var originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (requestUrl, data) {
      return originalSendBeacon(toProxyUrl(requestUrl) || requestUrl, data);
    };
  }

  if (typeof window.open === "function") {
    var originalOpen = window.open.bind(window);
    window.open = function (requestUrl, target, features) {
      var proxiedUrl = toProxyUrl(requestUrl);
      return originalOpen(proxiedUrl || requestUrl, target, features);
    };
  }

  if (window.MutationObserver) {
    var titleObserver = new MutationObserver(function () {
      post("title");
    });
    var titleElement = document.querySelector("title") || document.head;
    if (titleElement) {
      titleObserver.observe(titleElement, { childList: true, subtree: true, characterData: true });
    }

    var rewriteObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(function (node) {
            if (node && node.nodeType === 1) {
              rewriteNodeTree(node);
            }
          });
        }

        if (mutation.type === "attributes" && mutation.target && mutation.target.nodeType === 1) {
          rewriteNodeTree(mutation.target);
        }
      });
    });
    rewriteObserver.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href", "src", "srcset", "imagesrcset", "action", "target"]
    });
  }

  rewriteNodeTree(document);

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    var anchor = target.closest("a[href]");
    if (!anchor) return;
    var href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    rewriteAnchor(anchor);
    loading();
  }, true);

  document.addEventListener("submit", function (event) {
    rewriteForm(event.target);
    loading();
  }, true);
  window.addEventListener("hashchange", commit);
  window.addEventListener("popstate", commit);
  window.addEventListener("pageshow", commit);
  window.addEventListener("load", commit);
  document.addEventListener("readystatechange", function () {
    if (document.readyState === "interactive") {
      post("title");
    }
    if (document.readyState === "complete") {
      commit();
    }
  });

  commit();
})();
</script>`;
}

/**
 * Inject the iframe synchronization script into an HTML document.
 *
 * @param {string} html Rewritten upstream HTML.
 * @param {string} targetUrl Current upstream page URL.
 * @returns {string} HTML with the helper script inserted.
 */
export function injectFrameHelper(html, targetUrl) {
  const helperScript = buildFrameHelperScript(targetUrl);

  if (html.includes("window.__plutoniumFrameBridgeInstalled")) {
    return html;
  }

  if (html.includes("</head>")) {
    return html.replace("</head>", `${helperScript}</head>`);
  }

  if (html.includes("</body>")) {
    return html.replace("</body>", `${helperScript}</body>`);
  }

  return `${html}${helperScript}`;
}
