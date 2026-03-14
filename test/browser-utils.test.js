import assert from "node:assert/strict";
import test from "node:test";
import {
  challengeLikely,
  escapeHtml,
  formatRecency,
  getFocusModeHref,
  getDisplayedValue,
  getProtocolBadge,
  normalizeBookmark,
  parseNavigationTarget,
} from "../public/scripts/browser-utils.js";
import { loadHomeSettings, saveHomeSettings } from "../public/scripts/home-settings.js";

test("browser utilities normalize bookmarks and escape display text", () => {
  assert.deepEqual(normalizeBookmark({ name: "YouTube", url: "youtube.com", accent: "yt" }), {
    name: "YouTube",
    url: "https://youtube.com/",
    accent: "YT",
  });
  assert.equal(normalizeBookmark({ name: "", url: "https://example.com" }), null);
  assert.equal(escapeHtml('<unsafe & "quoted">'), "&lt;unsafe &amp; &quot;quoted&quot;&gt;");
  assert.equal(formatRecency(5_000, 15_000), "Just now");
  assert.equal(formatRecency(0, 5 * 60 * 1000), "5m ago");
  assert.equal(formatRecency(0, 2 * 60 * 60 * 1000), "2h ago");
  assert.equal(formatRecency(0, 3 * 24 * 60 * 60 * 1000), "3d ago");
});

test("browser utilities parse omnibox input and present tab chrome values", () => {
  assert.deepEqual(parseNavigationTarget("example.com"), {
    finalUrl: "https://example.com/",
    displayUrl: "https://example.com/",
    isSearch: false,
    title: "example.com",
  });
  assert.deepEqual(parseNavigationTarget("best proxy ever"), {
    finalUrl: "https://www.google.com/search?q=best%20proxy%20ever",
    displayUrl: "best proxy ever",
    isSearch: true,
    title: "Search",
  });
  assert.equal(getDisplayedValue({ isSearch: false, url: "https://example.com/path" }), "example.com/path");
  assert.equal(getDisplayedValue({ isSearch: true, displayUrl: "cats" }), "cats");
  assert.equal(getProtocolBadge({ isSearch: false, url: "https://example.com/" }), "https://");
});

test("browser utilities flag challenge-like pages", () => {
  assert.equal(challengeLikely({ title: "Attention Required! | Cloudflare", url: "https://example.com" }), true);
  assert.equal(challengeLikely({ title: "Example Domain", url: "https://example.com" }), false);
  assert.equal(getFocusModeHref({ mode: "web", url: "https://example.com/challenge" }), "/proxy?url=https%3A%2F%2Fexample.com%2Fchallenge");
  assert.equal(getFocusModeHref({ mode: "home", url: "https://example.com/challenge" }), "");
});

test("home settings load and save through a storage-like interface", () => {
  const store = new Map();
  const storage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };

  const defaults = loadHomeSettings(storage);
  assert.equal(defaults.backgroundUrl, "");
  assert.ok(defaults.bookmarks.length >= 1);

  saveHomeSettings(
    {
      backgroundUrl: "https://images.example.com/bg.jpg",
      bookmarks: [{ name: "Docs", url: "https://example.com/docs", accent: "DC" }],
    },
    storage
  );

  assert.deepEqual(loadHomeSettings(storage), {
    backgroundUrl: "https://images.example.com/bg.jpg",
    bookmarks: [{ name: "Docs", url: "https://example.com/docs", accent: "DC" }],
  });
});
