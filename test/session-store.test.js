import assert from "node:assert/strict";
import test from "node:test";

import {
  loadBrowserState,
  rememberClosedTab,
  rememberVisit,
  saveBrowserState,
  snapshotTabs,
} from "../public/scripts/session-store.js";

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

test("session store saves and restores normalized browser state", () => {
  const storage = createStorage();

  saveBrowserState(
    {
      tabs: [
        {
          id: "t1",
          title: "Example",
          url: "https://example.com",
          displayUrl: "example.com",
          isSearch: false,
          pinned: true,
          historyEntries: ["https://example.com", "javascript:alert(1)"],
          historyIndex: 9,
          mode: "web",
        },
        {
          id: "t2",
          title: "Blank",
          url: "",
          displayUrl: "",
          isSearch: false,
          pinned: false,
          historyEntries: [],
          historyIndex: -1,
          mode: "home",
        },
      ],
      activeTabId: "t1",
      recentVisits: [{ url: "https://example.com/docs", title: "Docs", lastVisitedAt: 11 }],
      closedTabs: [
        {
          title: "Support",
          url: "https://support.example.com",
          displayUrl: "support.example.com",
          isSearch: false,
          pinned: true,
          historyEntries: ["https://support.example.com"],
          historyIndex: 0,
          mode: "web",
          closedAt: 88,
        },
      ],
    },
    storage
  );

  const restored = loadBrowserState(storage);
  assert.equal(restored.activeTabId, "t1");
  assert.equal(restored.tabs.length, 2);
  assert.deepEqual(restored.tabs[0], {
    id: "t1",
    title: "Example",
    url: "https://example.com/",
    displayUrl: "example.com",
    isSearch: false,
    pinned: true,
    historyEntries: ["https://example.com/"],
    historyIndex: 0,
    mode: "web",
  });
  assert.equal(restored.tabs[1].mode, "home");
  assert.equal(restored.recentVisits[0].url, "https://example.com/docs");
  assert.equal(restored.closedTabs[0].closedAt, 88);
});

test("session store snapshots tabs and keeps recent visits deduplicated", () => {
  const snapshot = snapshotTabs([
    {
      id: "t-search",
      title: "Search",
      url: "https://www.google.com/search?q=plutonium",
      displayUrl: "plutonium",
      isSearch: true,
      pinned: true,
      historyEntries: ["https://www.google.com/search?q=plutonium"],
      historyIndex: 0,
      mode: "web",
      dom: {},
    },
  ]);

  assert.deepEqual(snapshot[0], {
    id: "t-search",
    title: "Search",
    url: "https://www.google.com/search?q=plutonium",
    displayUrl: "plutonium",
    isSearch: true,
    pinned: true,
    historyEntries: ["https://www.google.com/search?q=plutonium"],
    historyIndex: 0,
    mode: "web",
  });

  const seededVisits = Array.from({ length: 20 }, (_, index) => ({
    url: `https://example${index}.com/`,
    title: `Example ${index}`,
    lastVisitedAt: index,
  }));
  const nextVisits = rememberVisit(seededVisits, {
    url: "https://example5.com",
    title: "Example Five Updated",
    displayUrl: "example5.com",
    lastVisitedAt: 999,
  });

  assert.equal(nextVisits.length, 18);
  assert.equal(nextVisits[0].url, "https://example5.com/");
  assert.equal(nextVisits[0].title, "Example Five Updated");
  assert.equal(nextVisits.filter((visit) => visit.url === "https://example5.com/").length, 1);
});

test("session store limits and deduplicates recently closed tabs", () => {
  const seededClosedTabs = Array.from({ length: 12 }, (_, index) => ({
    title: `Closed ${index}`,
    url: `https://closed${index}.example.com/`,
    displayUrl: `closed${index}.example.com`,
    isSearch: false,
    historyEntries: [`https://closed${index}.example.com/`],
    historyIndex: 0,
    mode: "web",
    closedAt: index,
  }));

  const nextClosedTabs = rememberClosedTab(seededClosedTabs, {
    title: "Closed 4",
    url: "https://closed4.example.com",
    displayUrl: "closed4.example.com",
    isSearch: false,
    pinned: true,
    historyEntries: ["https://closed4.example.com"],
    historyIndex: 0,
    mode: "web",
    closedAt: 1234,
  });

  assert.equal(nextClosedTabs.length, 12);
  assert.equal(nextClosedTabs[0].url, "https://closed4.example.com/");
  assert.equal(nextClosedTabs[0].closedAt, 1234);
  assert.equal(nextClosedTabs[0].pinned, true);
  assert.equal(nextClosedTabs.filter((tab) => tab.url === "https://closed4.example.com/").length, 1);
});
