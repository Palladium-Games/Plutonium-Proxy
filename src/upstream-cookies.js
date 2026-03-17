import crypto from "node:crypto";

const SESSION_COOKIE_NAME = "plutonium_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const WEEKLY_LINK_LIMIT = 2;
const sessionStores = new Map();

/**
 * Attach a stable local session identifier so proxied upstream cookies can be
 * stored server-side per browser session.
 *
 * @param {import("express").Request} req Incoming request.
 * @param {import("express").Response} res Outgoing response.
 * @param {import("express").NextFunction} next Express continuation.
 * @returns {void}
 */
export function attachProxySession(req, res, next) {
  const cookies = parseRequestCookieHeader(req.headers.cookie);
  let sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    res.cookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: "/",
    });
  }

  req.plutoniumSessionId = sessionId;
  touchSessionStore(sessionId);
  next();
}

/**
 * Read the upstream cookie header that should be sent for the current target.
 *
 * @param {string | undefined} sessionId Local proxy session identifier.
 * @param {string} targetUrl Absolute upstream request URL.
 * @returns {string} Cookie header string, or an empty string when none apply.
 */
export function getUpstreamCookieHeader(sessionId, targetUrl) {
  if (!sessionId || !sessionStores.has(sessionId)) {
    return "";
  }

  const store = touchSessionStore(sessionId);
  const url = new URL(targetUrl);
  const now = Date.now();
  const matches = [];

  for (const cookie of store.values()) {
    if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
      store.delete(cookie.key);
      continue;
    }

    if (!domainMatches(url.hostname, cookie.domain, cookie.hostOnly)) {
      continue;
    }

    if (!pathMatches(url.pathname, cookie.path)) {
      continue;
    }

    if (cookie.secure && url.protocol !== "https:") {
      continue;
    }

    matches.push(cookie);
  }

  matches.sort((left, right) => {
    if (right.path.length !== left.path.length) {
      return right.path.length - left.path.length;
    }
    return left.createdAt - right.createdAt;
  });

  return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/**
 * Store upstream `Set-Cookie` headers in the server-side cookie jar.
 *
 * @param {string | undefined} sessionId Local proxy session identifier.
 * @param {string} targetUrl Absolute upstream response URL.
 * @param {string[] | string | undefined} setCookieHeaders Upstream `Set-Cookie` header values.
 * @returns {void}
 */
export function storeUpstreamCookies(sessionId, targetUrl, setCookieHeaders) {
  if (!sessionId || !setCookieHeaders) {
    return;
  }

  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const requestUrl = new URL(targetUrl);
  const store = touchSessionStore(sessionId);

  for (const header of headers) {
    const parsed = parseSetCookieHeader(header, requestUrl);
    if (!parsed) {
      continue;
    }

    if (parsed.expiresAt !== null && parsed.expiresAt <= Date.now()) {
      store.delete(parsed.key);
      continue;
    }

    store.set(parsed.key, parsed);
  }
}

/**
 * Parse a plain request `Cookie` header into a key/value map.
 *
 * @param {string | undefined} header Raw `Cookie` header.
 * @returns {Record<string, string>} Parsed cookie values.
 */
export function parseRequestCookieHeader(header) {
  if (!header) {
    return {};
  }

  return header.split(/;\s*/).reduce((cookies, part) => {
    if (!part) {
      return cookies;
    }

    const equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) {
      return cookies;
    }

    const name = part.slice(0, equalsIndex).trim();
    const value = part.slice(equalsIndex + 1).trim();
    if (name) {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

/**
 * Reset the in-memory cookie stores. Intended for automated tests.
 *
 * @returns {void}
 */
export function resetUpstreamCookieStores() {
  sessionStores.clear();
}

/**
 * Return the local proxy session cookie name.
 *
 * @returns {string} The cookie name.
 */
export function getProxySessionCookieName() {
  return SESSION_COOKIE_NAME;
}

/**
 * Ensure the session cookie store exists and is marked as recently used.
 *
 * @param {string} sessionId Local proxy session identifier.
 * @returns {Map<string, UpstreamCookie>} Cookie store for the session.
 */
function touchSessionStore(sessionId) {
  const existing = sessionStores.get(sessionId);
  if (existing) {
    existing.lastSeenAt = Date.now();
    return existing.cookies;
  }

  const entry = {
    lastSeenAt: Date.now(),
    cookies: new Map(),
    linkUsage: {
      weekKey: getWeekKey(Date.now()),
      count: 0,
    },
  };
  sessionStores.set(sessionId, entry);
  pruneExpiredSessions();
  return entry.cookies;
}

function getWeekKey(timestamp) {
  const date = new Date(timestamp);
  const day = date.getDay(); // 0=Sunday
  const diff = (day + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function getSessionEntry(sessionId) {
  if (!sessionId) {
    return null;
  }
  return sessionStores.get(sessionId) || null;
}

function ensureWeekUsage(entry) {
  const now = Date.now();
  const weekKey = getWeekKey(now);
  if (!entry.linkUsage || entry.linkUsage.weekKey !== weekKey) {
    entry.linkUsage = {
      weekKey,
      count: 0,
    };
  }
  return entry.linkUsage;
}

export function consumeLinkQuota(sessionId) {
  const entry = getSessionEntry(sessionId);
  if (!entry) {
    return { allowed: true, remaining: WEEKLY_LINK_LIMIT, limit: WEEKLY_LINK_LIMIT };
  }

  const usage = ensureWeekUsage(entry);
  if (usage.count >= WEEKLY_LINK_LIMIT) {
    return { allowed: false, remaining: 0, limit: WEEKLY_LINK_LIMIT };
  }

  usage.count += 1;
  return { allowed: true, remaining: Math.max(0, WEEKLY_LINK_LIMIT - usage.count), limit: WEEKLY_LINK_LIMIT };
}

/**
 * Remove stale sessions from memory.
 *
 * @returns {void}
 */
function pruneExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_SECONDS * 1000;
  for (const [sessionId, entry] of sessionStores.entries()) {
    if (entry.lastSeenAt < cutoff) {
      sessionStores.delete(sessionId);
    }
  }
}

/**
 * Parse one upstream `Set-Cookie` header into the internal storage format.
 *
 * @param {string} header Raw `Set-Cookie` header.
 * @param {URL} requestUrl Request URL that generated the cookie.
 * @returns {UpstreamCookie | null} Parsed cookie or `null` when invalid.
 */
function parseSetCookieHeader(header, requestUrl) {
  if (!header) {
    return null;
  }

  const segments = header.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const nameValue = segments.shift();
  const equalsIndex = nameValue.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }

  const name = nameValue.slice(0, equalsIndex).trim();
  const value = nameValue.slice(equalsIndex + 1).trim();

  let domain = requestUrl.hostname.toLowerCase();
  let hostOnly = true;
  let path = defaultCookiePath(requestUrl.pathname);
  let secure = false;
  let expiresAt = null;

  for (const segment of segments) {
    const [rawKey, ...rawValueParts] = segment.split("=");
    const key = rawKey.toLowerCase();
    const attrValue = rawValueParts.join("=").trim();

    if (key === "domain" && attrValue) {
      const normalizedDomain = normalizeCookieDomain(attrValue);
      if (!domainMatches(requestUrl.hostname, normalizedDomain, false)) {
        return null;
      }
      domain = normalizedDomain;
      hostOnly = false;
      continue;
    }

    if (key === "path" && attrValue) {
      path = normalizeCookiePath(attrValue);
      continue;
    }

    if (key === "secure") {
      secure = true;
      continue;
    }

    if (key === "max-age") {
      const maxAge = Number.parseInt(attrValue, 10);
      if (Number.isFinite(maxAge)) {
        expiresAt = Date.now() + maxAge * 1000;
      }
      continue;
    }

    if (key === "expires" && attrValue && expiresAt === null) {
      const parsedDate = Date.parse(attrValue);
      if (!Number.isNaN(parsedDate)) {
        expiresAt = parsedDate;
      }
    }
  }

  return {
    key: `${domain}|${path}|${name}`,
    name,
    value,
    domain,
    path,
    secure,
    hostOnly,
    expiresAt,
    createdAt: Date.now(),
  };
}

/**
 * Normalize a cookie domain value for internal matching.
 *
 * @param {string} domain Domain attribute from `Set-Cookie`.
 * @returns {string} Normalized domain name.
 */
function normalizeCookieDomain(domain) {
  return domain.trim().replace(/^\.+/, "").toLowerCase();
}

/**
 * Normalize a cookie path value for internal matching.
 *
 * @param {string} path Cookie path attribute.
 * @returns {string} Normalized path string.
 */
function normalizeCookiePath(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Compute the default cookie path for a request URL.
 *
 * @param {string} pathname Request pathname.
 * @returns {string} Default cookie path.
 */
function defaultCookiePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const lastSlash = pathname.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "/";
  }

  return pathname.slice(0, lastSlash);
}

/**
 * Determine whether an upstream cookie matches the current hostname.
 *
 * @param {string} hostname Current request hostname.
 * @param {string} cookieDomain Stored cookie domain.
 * @param {boolean} hostOnly Whether the cookie is host-only.
 * @returns {boolean} `true` when the cookie applies.
 */
function domainMatches(hostname, cookieDomain, hostOnly) {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = cookieDomain.toLowerCase();

  if (hostOnly) {
    return normalizedHost === normalizedDomain;
  }

  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

/**
 * Determine whether an upstream cookie path matches the current pathname.
 *
 * @param {string} pathname Current request pathname.
 * @param {string} cookiePath Stored cookie path.
 * @returns {boolean} `true` when the cookie applies.
 */
function pathMatches(pathname, cookiePath) {
  if (pathname === cookiePath) {
    return true;
  }

  if (!pathname.startsWith(cookiePath)) {
    return false;
  }

  return cookiePath.endsWith("/") || pathname.charAt(cookiePath.length) === "/";
}

/**
 * @typedef {object} UpstreamCookie
 * @property {string} key Internal storage key.
 * @property {string} name Cookie name.
 * @property {string} value Cookie value.
 * @property {string} domain Cookie domain.
 * @property {string} path Cookie path.
 * @property {boolean} secure Whether the cookie is HTTPS-only.
 * @property {boolean} hostOnly Whether the cookie only applies to the exact host.
 * @property {number | null} expiresAt Absolute expiry timestamp or `null` for session cookies.
 * @property {number} createdAt Creation timestamp used for stable header ordering.
 */
