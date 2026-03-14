import { CLOCK_FORMATTER, DATE_FORMATTER } from "./config.js";

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Create a unique tab identifier.
 *
 * @returns {string} Tab identifier.
 */
export function nextId() {
  return `t${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Escape unsafe HTML characters for template insertion.
 *
 * @param {string} value Raw text value.
 * @returns {string} Escaped text.
 */
export function escapeHtml(value) {
  return `${value ?? ""}`.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Convert an absolute URL into the local proxy route.
 *
 * @param {string} url Upstream URL.
 * @returns {string} Proxied route.
 */
export function proxiedSrc(url) {
  return `/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Build the top-level focus-mode URL for a web tab.
 *
 * @param {{mode?: string, url?: string} | null | undefined} tab Current tab.
 * @returns {string} Top-level proxied URL, or an empty string when focus mode is unavailable.
 */
export function getFocusModeHref(tab) {
  if (!tab || tab.mode !== "web" || !tab.url) {
    return "";
  }

  return proxiedSrc(tab.url);
}

/**
 * Normalize user-entered bookmark data.
 *
 * @param {{name?: string, url?: string, accent?: string} | undefined | null} bookmark Bookmark candidate.
 * @returns {{name: string, url: string, accent: string} | null} Normalized bookmark or `null`.
 */
export function normalizeBookmark(bookmark) {
  const name = `${bookmark?.name || ""}`.trim();
  const url = `${bookmark?.url || ""}`.trim();
  if (!name || !url) {
    return null;
  }

  try {
    const normalizedUrl = new URL(url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`);
    return {
      name,
      url: normalizedUrl.href,
      accent: `${bookmark?.accent || name.slice(0, 2)}`.trim().slice(0, 2).toUpperCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Format the homescreen clock.
 *
 * @param {Date} [now] Time value.
 * @returns {string} Formatted clock text.
 */
export function formatTime(now = new Date()) {
  return CLOCK_FORMATTER.format(now);
}

/**
 * Format the homescreen date.
 *
 * @param {Date} [now] Time value.
 * @returns {string} Formatted date text.
 */
export function formatDate(now = new Date()) {
  return DATE_FORMATTER.format(now);
}

/**
 * Format a timestamp as a short recency label for homescreen activity lists.
 *
 * @param {number} timestamp Unix time in milliseconds.
 * @param {number} [now=Date.now()] Current time in milliseconds.
 * @returns {string} Compact relative-time label.
 */
export function formatRecency(timestamp, now = Date.now()) {
  const safeTimestamp = Number.isFinite(timestamp) ? Number(timestamp) : 0;
  const delta = Math.max(0, now - safeTimestamp);

  if (delta < MINUTE_MS) {
    return "Just now";
  }

  if (delta < HOUR_MS) {
    return `${Math.max(1, Math.round(delta / MINUTE_MS))}m ago`;
  }

  if (delta < DAY_MS) {
    return `${Math.max(1, Math.round(delta / HOUR_MS))}h ago`;
  }

  return `${Math.max(1, Math.round(delta / DAY_MS))}d ago`;
}

/**
 * Heuristic for challenge-heavy pages.
 *
 * @param {{title?: string, url?: string} | null | undefined} tab Tab descriptor.
 * @returns {boolean} `true` when the current page looks verification-heavy.
 */
export function challengeLikely(tab) {
  const text = `${tab?.title || ""} ${tab?.url || ""}`.toLowerCase();
  return /captcha|verify|challenge|just a moment|attention required|cloudflare|human/i.test(text);
}

/**
 * Derive a tab title from a URL.
 *
 * @param {string} url Candidate URL.
 * @returns {string} Hostname-like tab title.
 */
export function tabTitleFromUrl(url) {
  if (!url) {
    return "New Tab";
  }

  try {
    return new URL(url).hostname || "New Tab";
  } catch {
    return url.length > 30 ? `${url.slice(0, 30)}…` : url || "New Tab";
  }
}

/**
 * Determine the text shown in the omnibox.
 *
 * @param {{isSearch?: boolean, displayUrl?: string, url?: string} | null | undefined} tab Current tab.
 * @returns {string} Omnibox text.
 */
export function getDisplayedValue(tab) {
  if (!tab) {
    return "";
  }

  return tab.isSearch ? tab.displayUrl : `${tab.url || ""}`.replace(/^\w+:\/\//, "");
}

/**
 * Determine the protocol badge shown ahead of the omnibox.
 *
 * @param {{isSearch?: boolean, url?: string} | null | undefined} tab Current tab.
 * @returns {string} Protocol badge text.
 */
export function getProtocolBadge(tab) {
  if (!tab || tab.isSearch || !tab.url) {
    return "";
  }

  if (tab.url.startsWith("https://")) {
    return "https://";
  }

  if (tab.url.startsWith("http://")) {
    return "http://";
  }

  return "";
}

/**
 * Determine whether the input looks like a URL instead of a search query.
 *
 * @param {string} value User-entered text.
 * @returns {boolean} `true` when the value resembles a URL.
 */
export function looksLikeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  try {
    const withScheme = /^\w+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const candidate = new URL(withScheme);
    return Boolean(candidate.hostname && candidate.hostname.includes("."));
  } catch {
    return false;
  }
}

/**
 * Convert omnibox input into a concrete navigation target.
 *
 * @param {string} raw Raw omnibox input.
 * @returns {{finalUrl: string, displayUrl: string, isSearch: boolean, title: string} | null} Parsed target.
 */
export function parseNavigationTarget(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (looksLikeUrl(trimmed)) {
    const withScheme =
      trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;

    try {
      const target = new URL(withScheme);
      return {
        finalUrl: target.href,
        displayUrl: target.href,
        isSearch: false,
        title: target.hostname || "New Tab",
      };
    } catch {}
  }

  return {
    finalUrl: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
    displayUrl: trimmed,
    isSearch: true,
    title: "Search",
  };
}
