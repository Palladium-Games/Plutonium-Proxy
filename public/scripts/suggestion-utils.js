import { parseNavigationTarget, tabTitleFromUrl } from "./browser-utils.js";

const MAX_SUGGESTIONS = 8;

const OMNIBOX_ACTIONS = [
  {
    action: "reopen-closed-tab",
    label: "Reopen closed tab",
    description: "Bring back the tab you closed most recently",
    keywords: "reopen closed restore undo recently closed tab",
  },
  {
    action: "duplicate-tab",
    label: "Duplicate current tab",
    description: "Clone the current page into a fresh tab",
    keywords: "duplicate copy clone current tab page",
  },
  {
    action: "new-tab",
    label: "Open new tab",
    description: "Start with a fresh Plutonium tab",
    keywords: "new blank start fresh open tab",
  },
];

/**
 * Build a ranked omnibox suggestion list from browser state.
 *
 * @param {object} options Suggestion options.
 * @param {string} options.rawValue Current omnibox input value.
 * @param {Array<{name: string, url: string}>} [options.bookmarks] Homescreen bookmarks.
 * @param {Array<{url: string, title: string, displayUrl?: string, isSearch?: boolean}>} [options.recentVisits] Recent visit list.
 * @param {Array<{id: string, title: string, url: string, displayUrl?: string, isSearch?: boolean}>} [options.openTabs] Open tab list.
 * @param {string} [options.activeTabId] Active tab identifier.
 * @param {boolean} [options.hasClosedTabs] Whether a closed tab can be reopened.
 * @param {boolean} [options.includeDuplicate] Whether the duplicate-tab action should be offered.
 * @returns {Array<object>} Render-ready suggestion descriptors.
 */
export function buildOmniboxSuggestions({
  rawValue,
  bookmarks = [],
  recentVisits = [],
  openTabs = [],
  activeTabId = "",
  hasClosedTabs = false,
  includeDuplicate = true,
}) {
  const trimmed = `${rawValue || ""}`.trim();
  const query = trimmed.toLowerCase();
  const suggestions = [];
  const seen = new Set();

  /**
   * Insert a suggestion if it is unique.
   *
   * @param {object | null | undefined} suggestion Candidate suggestion.
   * @param {string} key Deduplication key.
   * @returns {void}
   */
  function pushSuggestion(suggestion, key) {
    if (!suggestion || seen.has(key) || suggestions.length >= MAX_SUGGESTIONS) {
      return;
    }
    seen.add(key);
    suggestions.push(suggestion);
  }

  if (trimmed) {
    const target = parseNavigationTarget(trimmed);
    pushSuggestion(
      {
        kind: "navigate",
        badge: target?.isSearch ? "Search" : "Go",
        label: target?.isSearch ? `Search Google for "${trimmed}"` : `Open ${simplifyUrl(target?.finalUrl || trimmed)}`,
        description: target?.finalUrl || trimmed,
        finalUrl: target?.finalUrl || "",
        displayUrl: target?.displayUrl || trimmed,
        isSearch: Boolean(target?.isSearch),
        title: target?.title || tabTitleFromUrl(target?.finalUrl || ""),
      },
      `navigate:${target?.finalUrl || trimmed}`
    );
  }

  openTabs
    .filter((tab) => tab?.id && tab.id !== activeTabId && matchesQuery(query, `${tab.title || ""} ${tab.url || ""} ${tab.displayUrl || ""}`))
    .slice(0, trimmed ? 3 : 2)
    .forEach((tab) => {
      pushSuggestion(
        {
          kind: "tab",
          badge: "Tab",
          label: tab.title || tabTitleFromUrl(tab.url || ""),
          description: tab.displayUrl || simplifyUrl(tab.url || "New Tab"),
          tabId: tab.id,
        },
        `tab:${tab.id}`
      );
    });

  bookmarks
    .filter((bookmark) => matchesQuery(query, `${bookmark?.name || ""} ${bookmark?.url || ""}`))
    .slice(0, trimmed ? 3 : 4)
    .forEach((bookmark) => {
      pushSuggestion(
        {
          kind: "bookmark",
          badge: "Bookmark",
          label: bookmark.name,
          description: simplifyUrl(bookmark.url),
          finalUrl: bookmark.url,
          displayUrl: bookmark.url,
          isSearch: false,
          title: bookmark.name,
        },
        `destination:${bookmark.url}`
      );
    });

  recentVisits
    .filter((visit) => matchesQuery(query, `${visit?.title || ""} ${visit?.url || ""} ${visit?.displayUrl || ""}`))
    .slice(0, trimmed ? 4 : 3)
    .forEach((visit) => {
      pushSuggestion(
        {
          kind: "history",
          badge: "Recent",
          label: visit.title || tabTitleFromUrl(visit.url),
          description: visit.displayUrl || simplifyUrl(visit.url),
          finalUrl: visit.url,
          displayUrl: visit.displayUrl || visit.url,
          isSearch: Boolean(visit.isSearch),
          title: visit.title || tabTitleFromUrl(visit.url),
        },
        `destination:${visit.url}`
      );
    });

  OMNIBOX_ACTIONS.filter((action) => {
    if (action.action === "reopen-closed-tab" && !hasClosedTabs) {
      return false;
    }

    if (action.action === "duplicate-tab" && !includeDuplicate) {
      return false;
    }

    return !query || matchesQuery(query, `${action.label} ${action.description} ${action.keywords}`) || suggestions.length < 6;
  }).forEach((action) => {
    pushSuggestion(
      {
        kind: "action",
        badge: "Action",
        label: action.label,
        description: action.description,
        action: action.action,
      },
      `action:${action.action}`
    );
  });

  return suggestions;
}

/**
 * Determine whether a suggestion source matches the current query.
 *
 * @param {string} query Lower-cased omnibox query.
 * @param {string} text Searchable source text.
 * @returns {boolean} `true` when the source matches.
 */
function matchesQuery(query, text) {
  if (!query) {
    return true;
  }

  return `${text || ""}`.toLowerCase().includes(query);
}

/**
 * Convert a full URL into a compact display value.
 *
 * @param {string} value Candidate URL.
 * @returns {string} Compact display value.
 */
function simplifyUrl(value) {
  return `${value || ""}`.replace(/^\w+:\/\//, "");
}
