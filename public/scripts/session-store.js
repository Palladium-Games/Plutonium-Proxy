import { BROWSER_STATE_STORAGE_KEY } from "./config.js";
import { tabTitleFromUrl } from "./browser-utils.js";

const MAX_RECENT_VISITS = 18;
const MAX_CLOSED_TABS = 12;

/**
 * Load saved browser state from local storage.
 *
 * @param {Storage | undefined} [storage] Browser storage implementation.
 * @returns {{
 *   tabs: Array<{
 *     id?: string,
 *     title: string,
 *     url: string,
 *     displayUrl: string,
 *     isSearch: boolean,
 *     pinned: boolean,
 *     historyEntries: string[],
 *     historyIndex: number,
 *     mode: "home" | "web"
 *   }>,
 *   activeTabId: string,
 *   recentVisits: Array<{url: string, title: string, displayUrl: string, isSearch: boolean, lastVisitedAt: number}>,
 *   closedTabs: Array<{
 *     title: string,
 *     url: string,
 *     displayUrl: string,
 *     isSearch: boolean,
 *     pinned: boolean,
 *     historyEntries: string[],
 *     historyIndex: number,
 *     mode: "home" | "web",
 *     closedAt: number
 *   }>
 * }} Normalized browser state.
 */
export function loadBrowserState(storage = globalThis.localStorage) {
  if (!storage) {
    return createEmptyBrowserState();
  }

  try {
    const parsed = JSON.parse(storage.getItem(BROWSER_STATE_STORAGE_KEY) || "{}");
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.map((tab) => normalizeTabState(tab)).filter(Boolean) : [];
    const activeTabId =
      typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : "";

    return {
      tabs,
      activeTabId,
      recentVisits: normalizeRecentVisits(parsed.recentVisits),
      closedTabs: normalizeClosedTabs(parsed.closedTabs),
    };
  } catch {
    return createEmptyBrowserState();
  }
}

/**
 * Save the current browser state into local storage.
 *
 * @param {object} state Browser state snapshot.
 * @param {Storage | undefined} [storage] Browser storage implementation.
 * @returns {void}
 */
export function saveBrowserState(state, storage = globalThis.localStorage) {
  if (!storage) {
    return;
  }

  storage.setItem(
    BROWSER_STATE_STORAGE_KEY,
    JSON.stringify({
      tabs: Array.isArray(state?.tabs) ? state.tabs.map((tab) => snapshotTab(tab)).filter(Boolean) : [],
      activeTabId: typeof state?.activeTabId === "string" ? state.activeTabId : "",
      recentVisits: normalizeRecentVisits(state?.recentVisits),
      closedTabs: normalizeClosedTabs(state?.closedTabs),
    })
  );
}

/**
 * Convert live tab state into a serializable tab snapshot list.
 *
 * @param {Array<object>} tabs Current live tabs.
 * @returns {Array<object>} Serializable tab snapshots.
 */
export function snapshotTabs(tabs) {
  return Array.isArray(tabs) ? tabs.map((tab) => snapshotTab(tab)).filter(Boolean) : [];
}

/**
 * Insert a recent visit at the front of the visit list.
 *
 * @param {Array<object>} recentVisits Existing recent visit entries.
 * @param {{url?: string, title?: string, displayUrl?: string, isSearch?: boolean, lastVisitedAt?: number}} visit Candidate visit.
 * @returns {Array<object>} Updated recent visit list.
 */
export function rememberVisit(recentVisits, visit) {
  const normalized = normalizeVisit(visit);
  if (!normalized) {
    return normalizeRecentVisits(recentVisits);
  }

  const next = [normalized];
  normalizeRecentVisits(recentVisits)
    .filter((entry) => entry.url !== normalized.url)
    .slice(0, MAX_RECENT_VISITS - 1)
    .forEach((entry) => next.push(entry));
  return next;
}

/**
 * Insert a recently closed tab at the front of the closed-tab list.
 *
 * @param {Array<object>} closedTabs Existing closed-tab entries.
 * @param {object} tab Candidate closed tab state.
 * @returns {Array<object>} Updated closed-tab list.
 */
export function rememberClosedTab(closedTabs, tab) {
  const normalized = normalizeClosedTab(tab);
  if (!normalized) {
    return normalizeClosedTabs(closedTabs);
  }

  const next = [normalized];
  normalizeClosedTabs(closedTabs)
    .filter((entry) => !(entry.url === normalized.url && entry.title === normalized.title))
    .slice(0, MAX_CLOSED_TABS - 1)
    .forEach((entry) => next.push(entry));
  return next;
}

/**
 * Create a clean empty browser state payload.
 *
 * @returns {{tabs: object[], activeTabId: string, recentVisits: object[], closedTabs: object[]}} Empty state.
 */
export function createEmptyBrowserState() {
  return {
    tabs: [],
    activeTabId: "",
    recentVisits: [],
    closedTabs: [],
  };
}

/**
 * Convert a live tab into a serializable tab snapshot.
 *
 * @param {object} tab Current tab state.
 * @returns {object | null} Serializable tab snapshot.
 */
function snapshotTab(tab) {
  const normalized = normalizeTabState(tab);
  if (!normalized) {
    return null;
  }

  return {
    id: normalized.id,
    title: normalized.title,
    url: normalized.url,
    displayUrl: normalized.displayUrl,
    isSearch: normalized.isSearch,
    pinned: normalized.pinned,
    historyEntries: normalized.historyEntries.slice(),
    historyIndex: normalized.historyIndex,
    mode: normalized.mode,
  };
}

/**
 * Normalize a tab-like object for persistence and restore.
 *
 * @param {object} candidate Candidate tab payload.
 * @returns {object | null} Normalized tab state.
 */
function normalizeTabState(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const id = typeof candidate.id === "string" ? candidate.id : undefined;
  const rawHistoryEntries = Array.isArray(candidate.historyEntries)
    ? candidate.historyEntries.map((entry) => normalizeUrl(entry)).filter(Boolean)
    : [];
  const url = normalizeUrl(candidate.url) || rawHistoryEntries[rawHistoryEntries.length - 1] || "";
  const mode = candidate.mode === "home" || !url ? "home" : "web";
  const historyEntries =
    rawHistoryEntries.length > 0
      ? rawHistoryEntries
      : url && mode === "web"
        ? [url]
        : [];
  const historyIndex =
    historyEntries.length === 0
      ? -1
      : clampIndex(Number.isInteger(candidate.historyIndex) ? candidate.historyIndex : historyEntries.length - 1, historyEntries.length);
  const title = `${candidate.title || ""}`.trim() || tabTitleFromUrl(url);

  return {
    ...(id ? { id } : {}),
    title,
    url: mode === "web" ? url : "",
    displayUrl: typeof candidate.displayUrl === "string" ? candidate.displayUrl : "",
    isSearch: Boolean(candidate.isSearch),
    pinned: Boolean(candidate.pinned),
    historyEntries,
    historyIndex,
    mode,
  };
}

/**
 * Normalize a recent-visit collection.
 *
 * @param {unknown} visits Candidate recent visit list.
 * @returns {Array<{url: string, title: string, displayUrl: string, isSearch: boolean, lastVisitedAt: number}>} Normalized visit list.
 */
function normalizeRecentVisits(visits) {
  if (!Array.isArray(visits)) {
    return [];
  }

  const seen = new Set();
  const next = [];

  for (const visit of visits) {
    const normalized = normalizeVisit(visit);
    if (!normalized || seen.has(normalized.url)) {
      continue;
    }
    seen.add(normalized.url);
    next.push(normalized);
    if (next.length >= MAX_RECENT_VISITS) {
      break;
    }
  }

  return next;
}

/**
 * Normalize a recently closed tab collection.
 *
 * @param {unknown} closedTabs Candidate closed-tab list.
 * @returns {Array<object>} Normalized closed-tab list.
 */
function normalizeClosedTabs(closedTabs) {
  if (!Array.isArray(closedTabs)) {
    return [];
  }

  const next = [];
  for (const closedTab of closedTabs) {
    const normalized = normalizeClosedTab(closedTab);
    if (!normalized) {
      continue;
    }
    next.push(normalized);
    if (next.length >= MAX_CLOSED_TABS) {
      break;
    }
  }
  return next;
}

/**
 * Normalize a recent visit entry.
 *
 * @param {unknown} visit Candidate visit.
 * @returns {{url: string, title: string, displayUrl: string, isSearch: boolean, lastVisitedAt: number} | null} Normalized visit.
 */
function normalizeVisit(visit) {
  if (!visit || typeof visit !== "object") {
    return null;
  }

  const url = normalizeUrl(visit.url);
  if (!url) {
    return null;
  }

  const title = `${visit.title || ""}`.trim() || tabTitleFromUrl(url);
  return {
    url,
    title,
    displayUrl: typeof visit.displayUrl === "string" ? visit.displayUrl : "",
    isSearch: Boolean(visit.isSearch),
    lastVisitedAt: Number.isFinite(visit.lastVisitedAt) ? Number(visit.lastVisitedAt) : 0,
  };
}

/**
 * Normalize a recently closed tab entry.
 *
 * @param {unknown} tab Candidate tab.
 * @returns {object | null} Normalized closed tab.
 */
function normalizeClosedTab(tab) {
  const normalized = normalizeTabState(tab);
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    closedAt: Number.isFinite(tab.closedAt) ? Number(tab.closedAt) : 0,
  };
}

/**
 * Normalize URL-like input to an absolute HTTP(S) URL.
 *
 * @param {unknown} value Candidate URL.
 * @returns {string} Normalized URL or an empty string.
 */
function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const normalized = new URL(value);
    return /^https?:$/i.test(normalized.protocol) ? normalized.href : "";
  } catch {
    return "";
  }
}

/**
 * Clamp a history index into the range supported by the entry array.
 *
 * @param {number} index Candidate history index.
 * @param {number} length History entry count.
 * @returns {number} Safe index.
 */
function clampIndex(index, length) {
  return Math.min(Math.max(index, 0), length - 1);
}
