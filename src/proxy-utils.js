/**
 * Shared proxy helpers for URL normalization, response rewriting, and iframe
 * synchronization between the proxied page and the browser shell.
 */

export const PROXY_PATH = "/proxy";
export const ASSET_CACHE = "public, max-age=3600";
export const FRAME_EVENT_SOURCE = "plutonium-frame";

const SKIPPED_PROTOCOLS = ["javascript:", "data:", "mailto:", "blob:"];

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
    let resolved = resolveProxyUrl(value, baseUrl);
    if (resolved) {
      resolved = normalizeGoogleSearchUrl(resolved);
    }

    const proxyValue = toProxyAttr(resolved);
    return proxyValue ? ` ${attr}=${quote}${proxyValue}${quote}` : match;
  };

  let rewritten = html
    .replace(/\s(href)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(src)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(action)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(formaction)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(poster)=(["'])([^"']*)\2/gi, rewriteAttr)
    .replace(/\s(target)=(["'])(_top|_parent)\2/gi, ' target=$2_self$2');

  rewritten = rewritten.replace(/\s(srcset)=(["'])([^"']+)\2/gi, (match, attr, quote, value) => {
    const parts = value.split(/,\s*/).map((part) => {
      const [rawUrl, ...descriptorParts] = part.trim().split(/\s+/);
      let resolved = resolveProxyUrl(rawUrl, baseUrl);
      if (resolved) {
        resolved = normalizeGoogleSearchUrl(resolved);
      }

      const proxyValue = toProxyAttr(resolved);
      if (!proxyValue) {
        return part;
      }

      return [proxyValue, ...descriptorParts].join(" ").trim();
    });

    return ` ${attr}=${quote}${parts.join(", ")}${quote}`;
  });

  rewritten = rewritten.replace(/\scontent=(["'])([^"']+)\1/gi, (match, quote, value) => {
    const metaRefresh = value.match(/^(\d+\s*;\s*url=)(.+)$/i);
    if (!metaRefresh) {
      return match;
    }

    let resolved = resolveProxyUrl(metaRefresh[2], baseUrl);
    if (resolved) {
      resolved = normalizeGoogleSearchUrl(resolved);
    }

    const proxyValue = toProxyAttr(resolved);
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
      .replace(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, (match, rawUrl) => {
        const proxyValue = toProxyAttr(resolveProxyUrl(rawUrl.trim(), baseUrl));
        return proxyValue ? `url("${proxyValue}")` : match;
      })
      .replace(/@import\s+["']([^"']+)["']/g, (match, rawUrl) => {
        const proxyValue = toProxyAttr(resolveProxyUrl(rawUrl.trim(), baseUrl));
        return proxyValue ? `@import "${proxyValue}"` : match;
      });
  } catch {
    return css;
  }
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
    return js.replace(/(["'])(\/(?!\/)[^"'\s]*)\1/g, (match, quote, pathValue) => {
      const proxyValue = toProxyAttr(resolveProxyUrl(pathValue, baseUrl));
      return proxyValue ? `${quote}${proxyValue}${quote}` : match;
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
    const cleaned = contentSecurityPolicy.replace(/frame-ancestors[^;]*;?/gi, "").trim();
    if (cleaned) {
      headers["content-security-policy"] = cleaned;
    } else {
      delete headers["content-security-policy"];
    }
  }

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
    contentType.includes("application/javascript") ||
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
    contentType.includes("application/javascript") ||
    contentType.includes("text/javascript") ||
    contentType.includes("image/") ||
    contentType.includes("font/") ||
    contentType.includes("application/font") ||
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
  }

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
