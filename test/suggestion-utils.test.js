import assert from "node:assert/strict";
import test from "node:test";

import { buildOmniboxSuggestions } from "../public/scripts/suggestion-utils.js";

test("omnibox suggestions blend navigation, open tabs, bookmarks, history, and actions", () => {
  const suggestions = buildOmniboxSuggestions({
    rawValue: "git",
    bookmarks: [{ name: "GitHub", url: "https://github.com/" }],
    recentVisits: [{ url: "https://gitlab.com/", title: "GitLab" }],
    openTabs: [
      { id: "active", title: "Dashboard", url: "https://example.com/dashboard" },
      { id: "docs", title: "GitHub Docs", url: "https://docs.github.com/" },
    ],
    activeTabId: "active",
    hasClosedTabs: true,
    includeDuplicate: true,
  });

  assert.equal(suggestions[0].kind, "navigate");
  assert.equal(suggestions.some((suggestion) => suggestion.kind === "tab" && suggestion.tabId === "docs"), true);
  assert.equal(suggestions.some((suggestion) => suggestion.kind === "bookmark" && suggestion.label === "GitHub"), true);
  assert.equal(suggestions.some((suggestion) => suggestion.kind === "history" && suggestion.label === "GitLab"), true);
  assert.equal(
    suggestions.some((suggestion) => suggestion.kind === "action" && suggestion.action === "reopen-closed-tab"),
    true
  );
  assert.equal(suggestions.some((suggestion) => suggestion.kind === "tab" && suggestion.tabId === "active"), false);
});

test("omnibox suggestions collapse duplicate URLs and only expose valid actions", () => {
  const suggestions = buildOmniboxSuggestions({
    rawValue: "",
    bookmarks: [{ name: "YouTube", url: "https://www.youtube.com/" }],
    recentVisits: [{ url: "https://www.youtube.com/", title: "YouTube" }],
    openTabs: [],
    activeTabId: "",
    hasClosedTabs: false,
    includeDuplicate: false,
  });

  assert.equal(suggestions.filter((suggestion) => suggestion.finalUrl === "https://www.youtube.com/").length, 1);
  assert.equal(
    suggestions.some((suggestion) => suggestion.kind === "action" && suggestion.action === "reopen-closed-tab"),
    false
  );
  assert.equal(
    suggestions.some((suggestion) => suggestion.kind === "action" && suggestion.action === "duplicate-tab"),
    false
  );
  assert.equal(suggestions.some((suggestion) => suggestion.kind === "action" && suggestion.action === "new-tab"), true);
});
