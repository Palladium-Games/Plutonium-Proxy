import { FRAME_EVENT_SOURCE } from "./config.js";
import {
  challengeLikely,
  escapeHtml,
  getFocusModeHref,
  getDisplayedValue,
  getProtocolBadge,
  nextId,
  parseNavigationTarget,
  proxiedSrc,
  tabTitleFromUrl,
} from "./browser-utils.js";
import { loadHomeSettings, saveHomeSettings } from "./home-settings.js";
import { createHomescreen, renderHomescreen } from "./home-view.js";
import { loadBrowserState, rememberClosedTab, rememberVisit, saveBrowserState, snapshotTabs } from "./session-store.js";
import { buildOmniboxSuggestions } from "./suggestion-utils.js";

const tabStrip = document.getElementById("tab-strip");
const tabPanes = document.getElementById("tab-panes");
const chromeContent = document.getElementById("chrome-content");
const challengeBanner = document.getElementById("challenge-banner");
const challengeBannerText = document.getElementById("challenge-banner-text");
const challengeFocusBtn = document.getElementById("challenge-focus-btn");
const omnibox = document.getElementById("chrome-omnibox");
const omniboxPanel = document.getElementById("omnibox-panel");
const form = document.getElementById("proxy-form");
const input = document.getElementById("url-input");
const protoSpan = document.getElementById("omnibox-proto");
const reloadBtn = document.getElementById("reload-btn");
const backBtn = document.getElementById("back-btn");
const forwardBtn = document.getElementById("forward-btn");
const newTabBtn = document.getElementById("new-tab-btn");

const restoredBrowserState = loadBrowserState();

let tabs = [];
let activeTabId = "";
let recentVisits = restoredBrowserState.recentVisits.slice();
let closedTabs = restoredBrowserState.closedTabs.slice();
let homeSettings = loadHomeSettings();
let clockTimerId = 0;
let stateSaveTimerId = 0;
let omniboxSuggestions = [];
let omniboxSelectionIndex = -1;

function getHomeSettings() {
  return homeSettings;
}

function setHomeSettings(updater) {
  homeSettings = typeof updater === "function" ? updater(homeSettings) : updater;
  saveHomeSettings(homeSettings);
  renderAllHomescreens();
  refreshOmniboxSuggestions({ preserveSelection: true });
}

function ensureClockTicker() {
  if (clockTimerId) {
    return;
  }

  clockTimerId = window.setInterval(() => {
    renderAllHomescreens();
  }, 1000);
}

function getTab(id) {
  return tabs.find((tab) => tab.id === id);
}

function getTabByWindow(sourceWindow) {
  return tabs.find((tab) => tab.frame?.contentWindow === sourceWindow) || null;
}

function getActiveTab() {
  return activeTabId ? getTab(activeTabId) : null;
}

function renderAllHomescreens() {
  tabs.forEach((tab) => renderHomescreen(tab, { getHomeSettings }));
}

function readFrameTargetUrl(frame) {
  try {
    const current = new URL(frame.contentWindow?.location?.href || "", window.location.origin);
    return current.searchParams.get("url") || "";
  } catch {
    return "";
  }
}

function syncTabHistory(tab, url) {
  if (!url) {
    return;
  }

  const current = tab.historyEntries[tab.historyIndex];
  if (current === url) {
    return;
  }

  const previous = tab.historyEntries[tab.historyIndex - 1];
  const next = tab.historyEntries[tab.historyIndex + 1];
  if (previous === url) {
    tab.historyIndex -= 1;
    return;
  }

  if (next === url) {
    tab.historyIndex += 1;
    return;
  }

  const historyEntries = tab.historyEntries.slice(0, tab.historyIndex + 1);
  historyEntries.push(url);
  tab.historyEntries = historyEntries;
  tab.historyIndex = historyEntries.length - 1;
}

function queueBrowserStateSave() {
  if (stateSaveTimerId) {
    window.clearTimeout(stateSaveTimerId);
  }

  stateSaveTimerId = window.setTimeout(() => {
    persistBrowserState();
  }, 60);
}

function persistBrowserState() {
  if (stateSaveTimerId) {
    window.clearTimeout(stateSaveTimerId);
    stateSaveTimerId = 0;
  }

  saveBrowserState({
    tabs: snapshotTabs(tabs).filter(Boolean),
    activeTabId,
    recentVisits,
    closedTabs,
  });
}

function rememberRecentVisitForTab(tab, url = tab?.url) {
  if (!tab || !url) {
    return;
  }

  recentVisits = rememberVisit(recentVisits, {
    url,
    title: tab.title,
    displayUrl: tab.isSearch ? tab.displayUrl : url,
    isSearch: tab.isSearch,
    lastVisitedAt: Date.now(),
  });
  refreshOmniboxSuggestions({ preserveSelection: true });
  queueBrowserStateSave();
}

function rememberRecentlyClosedTab(tab) {
  const snapshot = snapshotTabs([tab]).filter(Boolean)[0];
  if (!snapshot) {
    return;
  }

  closedTabs = rememberClosedTab(closedTabs, {
    ...snapshot,
    closedAt: Date.now(),
  });
  refreshOmniboxSuggestions({ preserveSelection: true });
  queueBrowserStateSave();
}

function renderTab(tab) {
  if (!tab?.dom) {
    return;
  }

  tab.dom.querySelector(".chrome-tab-title").textContent = tab.title;
  tab.dom.classList.toggle("loading", Boolean(tab.loading));
}

function setTabLoading(tab, loading) {
  if (!tab) {
    return;
  }

  tab.loading = loading;
  tab.pane?.setAttribute("aria-busy", loading ? "true" : "false");
  renderTab(tab);
  if (tab.id === activeTabId) {
    chromeContent.classList.toggle("loading", loading);
  }
  updateControls();
}

function setTabTitle(tab, nextTitle) {
  if (!tab) {
    return;
  }

  tab.title = nextTitle && nextTitle.trim() ? nextTitle.trim() : tabTitleFromUrl(tab.url);
  renderTab(tab);
  renderHomescreen(tab, { getHomeSettings });
  updateControls();
}

function updateAddressBar(tab = getActiveTab()) {
  input.value = getDisplayedValue(tab);
  protoSpan.textContent = getProtocolBadge(tab);
}

function updateChallengeAssist(tab = getActiveTab()) {
  if (!challengeBanner || !challengeBannerText || !challengeFocusBtn) {
    return;
  }

  const focusHref = getFocusModeHref(tab);
  const showAssist = Boolean(tab && challengeLikely(tab) && focusHref);
  challengeBanner.hidden = !showAssist;

  if (!showAssist) {
    challengeFocusBtn.disabled = true;
    challengeFocusBtn.dataset.focusHref = "";
    return;
  }

  challengeFocusBtn.disabled = false;
  challengeFocusBtn.dataset.focusHref = focusHref;

  const host = tab?.url ? tabTitleFromUrl(tab.url) : "this page";
  challengeBannerText.textContent =
    `Some verification flows on ${host} work more reliably in a full browser tab. ` +
    `Focus Mode opens the same Plutonium session without the embedded shell.`;
}

function openFocusMode(tab = getActiveTab()) {
  const focusHref = getFocusModeHref(tab);
  if (!focusHref) {
    return;
  }

  window.open(focusHref, "_blank", "noopener");
}

function updateControls() {
  const tab = getActiveTab();
  const canReload = Boolean(tab?.mode === "web" && (tab.url || tab?.frame?.src));
  const canGoBack = Boolean(tab && tab.historyIndex > 0 && !tab.loading);
  const canGoForward = Boolean(tab && tab.historyIndex < tab.historyEntries.length - 1 && !tab.loading);

  reloadBtn.disabled = !canReload;
  backBtn.disabled = !canGoBack;
  forwardBtn.disabled = !canGoForward;
  chromeContent.classList.toggle("loading", Boolean(tab?.loading));
  updateChallengeAssist(tab);
}

function renderTabActive() {
  tabStrip.querySelectorAll(".chrome-tab").forEach((element) => {
    element.classList.toggle("active", element.dataset.tabId === activeTabId);
  });

  tabPanes.querySelectorAll(".tab-pane").forEach((element) => {
    const active = element.dataset.tabId === activeTabId;
    element.classList.toggle("active", active);
    element.setAttribute("aria-hidden", active ? "false" : "true");
  });

  updateControls();
}

function switchTab(id) {
  if (!id || !getTab(id)) {
    return;
  }

  activeTabId = id;
  queueBrowserStateSave();
  requestAnimationFrame(() => {
    renderTabActive();
    updateAddressBar(getTab(id));
    getTab(id)?.dom?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    refreshOmniboxSuggestions({ preserveSelection: true });
  });
}

function createTab(id = nextId(), options = {}) {
  const historyEntries = Array.isArray(options.historyEntries)
    ? options.historyEntries.filter((entry) => typeof entry === "string")
    : options.url
      ? [options.url]
      : [];
  const historyIndex =
    historyEntries.length > 0
      ? clampIndex(Number.isInteger(options.historyIndex) ? options.historyIndex : historyEntries.length - 1, historyEntries.length)
      : -1;
  const mode = options.mode === "home" || (!options.url && historyEntries.length === 0) ? "home" : "web";
  const currentUrl = mode === "web" ? options.url || historyEntries[historyIndex] || "" : "";
  const tab = {
    id,
    title: options.title ?? tabTitleFromUrl(currentUrl),
    url: currentUrl,
    displayUrl: options.displayUrl ?? "",
    isSearch: Boolean(options.isSearch),
    loading: mode === "web" && Boolean(currentUrl),
    historyEntries,
    historyIndex,
    mode,
  };
  tabs.push(tab);

  const tabEl = document.createElement("div");
  tabEl.className = `chrome-tab${activeTabId === id ? " active" : ""}`;
  tabEl.dataset.tabId = id;
  tabEl.innerHTML = `
    <div class="chrome-tab-favicon"></div>
    <span class="chrome-tab-title">${escapeHtml(tab.title)}</span>
    <button type="button" class="chrome-tab-close" aria-label="Close tab">×</button>
  `;
  tabEl.querySelector(".chrome-tab-close").addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(id);
  });
  tabEl.addEventListener("click", (event) => {
    if (!event.target.classList.contains("chrome-tab-close")) {
      switchTab(id);
    }
  });
  tabStrip.appendChild(tabEl);
  tab.dom = tabEl;

  const pane = document.createElement("div");
  pane.className = `tab-pane${activeTabId === id ? " active" : ""}`;
  pane.dataset.tabId = id;
  pane.setAttribute("aria-busy", tab.loading ? "true" : "false");

  const home = createHomescreen(tab, {
    getHomeSettings,
    setHomeSettings,
    navigateInTab,
  });
  pane.appendChild(home);
  ensureClockTicker();

  const iframe = document.createElement("iframe");
  iframe.title = "Page content";
  iframe.loading = "eager";
  iframe.sandbox =
    "allow-same-origin allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-modals allow-downloads allow-storage-access-by-user-activation allow-top-navigation-by-user-activation";
  iframe.src = tab.url ? proxiedSrc(tab.url) : "about:blank";
  iframe.classList.toggle("is-hidden", mode === "home");
  pane.appendChild(iframe);
  tabPanes.appendChild(pane);

  tab.pane = pane;
  tab.frame = iframe;
  renderTab(tab);
  syncPaneMode(tab);

  iframe.addEventListener("load", () => {
    handleFrameLoad(id);
  });

  queueBrowserStateSave();
  return tab;
}

function applyCommittedUrl(tab, url, nextTitle = "") {
  if (!tab || !url) {
    return;
  }

  const preserveSearchDisplay = tab.isSearch && tab.url === url;
  tab.mode = "web";
  tab.url = url;
  if (!preserveSearchDisplay) {
    tab.isSearch = false;
    tab.displayUrl = "";
  }
  syncTabHistory(tab, url);
  syncPaneMode(tab);
  if (nextTitle) {
    setTabTitle(tab, nextTitle);
  } else {
    renderHomescreen(tab, { getHomeSettings });
    renderTab(tab);
  }
  if (tab.id === activeTabId) {
    updateAddressBar(tab);
  }
  rememberRecentVisitForTab(tab, url);
}

function handleFrameLoad(id) {
  const tab = getTab(id);
  if (!tab) {
    return;
  }

  const decodedTarget = readFrameTargetUrl(tab.frame);
  if (decodedTarget) {
    try {
      applyCommittedUrl(tab, decodedTarget, tab.frame.contentDocument?.title || tabTitleFromUrl(decodedTarget));
    } catch {
      applyCommittedUrl(tab, decodedTarget, tabTitleFromUrl(decodedTarget));
    }
  }

  syncPaneMode(tab);
  setTabLoading(tab, false);
  if (tab.id === activeTabId) {
    updateAddressBar(tab);
  }
  queueBrowserStateSave();
}

function closeTab(id, { recordClosed = true } = {}) {
  const currentIndex = tabs.findIndex((tab) => tab.id === id);
  if (currentIndex === -1) {
    return;
  }

  const tab = tabs[currentIndex];
  if (recordClosed) {
    rememberRecentlyClosedTab(tab);
  }

  let done = false;
  const onDone = () => {
    if (done) {
      return;
    }
    done = true;

    tab.dom?.remove();
    tab.pane?.remove();
    tabs.splice(currentIndex, 1);

    if (tabs.length === 0) {
      activeTabId = "";
      const freshTab = createTab(nextId());
      switchTab(freshTab.id);
      return;
    }

    if (activeTabId === id) {
      const nextTab = tabs[Math.min(currentIndex, tabs.length - 1)];
      switchTab(nextTab.id);
    } else {
      renderTabActive();
      queueBrowserStateSave();
    }

    refreshOmniboxSuggestions({ preserveSelection: true });
  };

  tab.dom?.classList.add("closing");
  if (tab.dom) {
    tab.dom.addEventListener("transitionend", onDone, { once: true });
    window.setTimeout(onDone, 200);
  } else {
    onDone();
  }
}

function navigate(raw) {
  const tab = getActiveTab();
  const target = parseNavigationTarget(raw);
  if (!tab || !target) {
    return;
  }

  navigateInTab(tab, target.finalUrl, target);
}

function navigateInTab(tab, rawUrl, parsedTarget) {
  const target = parsedTarget || parseNavigationTarget(rawUrl);
  if (!tab || !target) {
    return;
  }

  tab.mode = "web";
  tab.url = target.finalUrl;
  tab.displayUrl = target.displayUrl;
  tab.isSearch = target.isSearch;
  syncTabHistory(tab, target.finalUrl);
  setTabTitle(tab, target.title);
  syncPaneMode(tab);
  updateAddressBar(tab);
  setTabLoading(tab, true);
  tab.frame.src = proxiedSrc(target.finalUrl);
  closeOmniboxPanel();
  queueBrowserStateSave();
}

function syncPaneMode(tab) {
  if (!tab?.home || !tab?.frame) {
    return;
  }

  const showHome = tab.mode !== "web";
  tab.home.classList.toggle("hidden", !showHome);
  tab.frame.classList.toggle("is-hidden", showHome);
  renderHomescreen(tab, { getHomeSettings });
}

function stepHistory(direction) {
  const tab = getActiveTab();
  if (!tab || tab.loading) {
    return;
  }

  const targetIndex = tab.historyIndex + direction;
  if (targetIndex < 0 || targetIndex >= tab.historyEntries.length) {
    return;
  }

  setTabLoading(tab, true);
  try {
    if (direction < 0) {
      tab.frame.contentWindow?.history?.back();
    } else {
      tab.frame.contentWindow?.history?.forward();
    }
  } catch {
    const targetUrl = tab.historyEntries[targetIndex];
    tab.historyIndex = targetIndex;
    tab.mode = "web";
    tab.url = targetUrl;
    tab.isSearch = false;
    tab.displayUrl = "";
    syncPaneMode(tab);
    updateAddressBar(tab);
    tab.frame.src = proxiedSrc(targetUrl);
    queueBrowserStateSave();
  }
}

function openNewTab() {
  const tab = createTab(nextId());
  switchTab(tab.id);
  updateAddressBar(tab);
  input.focus();
  input.select();
  refreshOmniboxSuggestions({ preserveSelection: false });
  return tab;
}

function duplicateTab(sourceTab = getActiveTab()) {
  if (!sourceTab) {
    return null;
  }

  const snapshot = snapshotTabs([sourceTab]).filter(Boolean)[0];
  if (!snapshot) {
    return null;
  }

  const duplicate = createTab(nextId(), snapshot);
  switchTab(duplicate.id);
  return duplicate;
}

function reopenClosedTab() {
  const [mostRecent, ...rest] = closedTabs;
  if (!mostRecent) {
    return null;
  }

  closedTabs = rest;
  const reopened = createTab(nextId(), mostRecent);
  switchTab(reopened.id);
  refreshOmniboxSuggestions({ preserveSelection: true });
  queueBrowserStateSave();
  return reopened;
}

function closeOmniboxPanel() {
  omniboxSuggestions = [];
  omniboxSelectionIndex = -1;
  omnibox.classList.remove("open");
  omnibox.setAttribute("aria-expanded", "false");
  omniboxPanel.hidden = true;
  omniboxPanel.innerHTML = "";
}

function renderOmniboxSuggestions() {
  if (!omniboxSuggestions.length) {
    closeOmniboxPanel();
    return;
  }

  omnibox.classList.add("open");
  omnibox.setAttribute("aria-expanded", "true");
  omniboxPanel.hidden = false;
  omniboxPanel.innerHTML = omniboxSuggestions
    .map((suggestion, index) => {
      const selected = index === omniboxSelectionIndex;
      return `
        <button
          type="button"
          class="omnibox-suggestion${selected ? " is-selected" : ""}"
          data-suggestion-index="${index}"
          aria-selected="${selected ? "true" : "false"}"
        >
          <span class="omnibox-suggestion-badge kind-${escapeHtml(suggestion.kind)}">${escapeHtml(suggestion.badge)}</span>
          <span class="omnibox-suggestion-copy">
            <span class="omnibox-suggestion-label">${escapeHtml(suggestion.label)}</span>
            <span class="omnibox-suggestion-description">${escapeHtml(suggestion.description || "")}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function refreshOmniboxSuggestions({ preserveSelection = false } = {}) {
  if (document.activeElement !== input && omniboxPanel.hidden) {
    return;
  }

  omniboxSuggestions = buildOmniboxSuggestions({
    rawValue: input.value,
    bookmarks: homeSettings.bookmarks,
    recentVisits,
    openTabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      displayUrl: tab.displayUrl,
      isSearch: tab.isSearch,
    })),
    activeTabId,
    hasClosedTabs: closedTabs.length > 0,
    includeDuplicate: Boolean(getActiveTab()),
  });

  if (!omniboxSuggestions.length) {
    closeOmniboxPanel();
    return;
  }

  omniboxSelectionIndex =
    preserveSelection && omniboxSelectionIndex >= 0 && omniboxSelectionIndex < omniboxSuggestions.length
      ? omniboxSelectionIndex
      : 0;
  renderOmniboxSuggestions();
}

function moveOmniboxSelection(direction) {
  if (!omniboxSuggestions.length) {
    refreshOmniboxSuggestions();
    return;
  }

  omniboxSelectionIndex =
    omniboxSelectionIndex < 0
      ? 0
      : (omniboxSelectionIndex + direction + omniboxSuggestions.length) % omniboxSuggestions.length;
  renderOmniboxSuggestions();

  const selected = omniboxPanel.querySelector(`[data-suggestion-index="${omniboxSelectionIndex}"]`);
  selected?.scrollIntoView({ block: "nearest" });
}

function executeOmniboxAction(action) {
  if (action === "new-tab") {
    openNewTab();
    return;
  }

  if (action === "duplicate-tab") {
    duplicateTab();
    return;
  }

  if (action === "reopen-closed-tab") {
    reopenClosedTab();
  }
}

function executeSuggestion(suggestion) {
  if (!suggestion) {
    return;
  }

  closeOmniboxPanel();

  if (suggestion.kind === "action") {
    executeOmniboxAction(suggestion.action);
    return;
  }

  if (suggestion.kind === "tab") {
    switchTab(suggestion.tabId);
    return;
  }

  const tab = getActiveTab();
  if (!tab || !suggestion.finalUrl) {
    return;
  }

  navigateInTab(tab, suggestion.finalUrl, {
    finalUrl: suggestion.finalUrl,
    displayUrl: suggestion.displayUrl || suggestion.finalUrl,
    isSearch: Boolean(suggestion.isSearch),
    title: suggestion.title || tabTitleFromUrl(suggestion.finalUrl),
  });
}

function clampIndex(index, length) {
  return Math.min(Math.max(index, 0), length - 1);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (omniboxSuggestions[omniboxSelectionIndex]) {
    executeSuggestion(omniboxSuggestions[omniboxSelectionIndex]);
    return;
  }
  closeOmniboxPanel();
  navigate(input.value);
});

input.addEventListener("focus", () => {
  refreshOmniboxSuggestions({ preserveSelection: false });
});

input.addEventListener("input", () => {
  refreshOmniboxSuggestions({ preserveSelection: false });
});

input.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (document.activeElement !== input) {
      closeOmniboxPanel();
    }
  }, 0);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveOmniboxSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveOmniboxSelection(-1);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeOmniboxPanel();
  }
});

omniboxPanel.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

omniboxPanel.addEventListener("click", (event) => {
  const suggestionButton = event.target.closest("[data-suggestion-index]");
  if (!suggestionButton) {
    return;
  }

  const suggestion = omniboxSuggestions[Number(suggestionButton.dataset.suggestionIndex)];
  executeSuggestion(suggestion);
});

challengeFocusBtn?.addEventListener("click", () => {
  openFocusMode();
});

reloadBtn.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.mode !== "web") {
    return;
  }

  setTabLoading(tab, true);
  try {
    tab.frame.contentWindow?.location?.reload();
  } catch {
    tab.frame.src = tab.url ? proxiedSrc(tab.url) : tab.frame.src;
  }
});

backBtn.addEventListener("click", () => {
  stepHistory(-1);
});

forwardBtn.addEventListener("click", () => {
  stepHistory(1);
});

newTabBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openNewTab();
});

window.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.source !== FRAME_EVENT_SOURCE) {
    return;
  }

  const tab = getTabByWindow(event.source);
  if (!tab) {
    return;
  }

  if (data.kind === "loading") {
    setTabLoading(tab, true);
    return;
  }

  if (data.kind === "commit" && typeof data.url === "string" && /^https?:/i.test(data.url)) {
    applyCommittedUrl(tab, data.url, typeof data.title === "string" ? data.title : "");
    setTabLoading(tab, false);
    return;
  }

  if (typeof data.title === "string" && data.title.trim()) {
    setTabTitle(tab, data.title);
    queueBrowserStateSave();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();

    if (key === "t" && event.shiftKey) {
      event.preventDefault();
      reopenClosedTab();
      return;
    }

    if (key === "d" && event.shiftKey) {
      event.preventDefault();
      duplicateTab();
      return;
    }

    if (key === "t") {
      event.preventDefault();
      openNewTab();
      return;
    }

    if (key === "w") {
      event.preventDefault();
      const tab = getActiveTab();
      if (tab) {
        closeTab(tab.id);
      }
      return;
    }

    if (key === "r") {
      event.preventDefault();
      reloadBtn.click();
      return;
    }

    if (key === "l") {
      event.preventDefault();
      input.focus();
      input.select();
      refreshOmniboxSuggestions({ preserveSelection: false });
      return;
    }

    if (key === "tab" && tabs.length > 1) {
      event.preventDefault();
      const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
      const nextIndex =
        event.shiftKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
      switchTab(tabs[nextIndex].id);
      return;
    }
  }

  if (event.altKey) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      backBtn.click();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      forwardBtn.click();
      return;
    }

    if (event.key === "d") {
      event.preventDefault();
      input.focus();
      input.select();
      refreshOmniboxSuggestions({ preserveSelection: false });
    }
  }
});

function restoreBrowserSession() {
  const restoredTabs = restoredBrowserState.tabs.length ? restoredBrowserState.tabs : [];
  if (restoredTabs.length) {
    restoredTabs.forEach((tab) => {
      createTab(tab.id || nextId(), tab);
    });
  } else {
    createTab(nextId());
  }

  const initialTabId =
    restoredBrowserState.activeTabId && getTab(restoredBrowserState.activeTabId)
      ? restoredBrowserState.activeTabId
      : tabs[0]?.id || "";
  if (initialTabId) {
    switchTab(initialTabId);
  }
}

restoreBrowserSession();
window.addEventListener("pagehide", persistBrowserState);
window.addEventListener("beforeunload", persistBrowserState);
