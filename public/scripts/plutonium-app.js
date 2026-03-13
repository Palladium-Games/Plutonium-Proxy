import { FRAME_EVENT_SOURCE } from "./config.js";
import {
  escapeHtml,
  getDisplayedValue,
  getProtocolBadge,
  nextId,
  parseNavigationTarget,
  proxiedSrc,
  tabTitleFromUrl,
} from "./browser-utils.js";
import { loadHomeSettings, saveHomeSettings } from "./home-settings.js";
import { createHomescreen, renderHomescreen } from "./home-view.js";

const tabStrip = document.getElementById("tab-strip");
const tabPanes = document.getElementById("tab-panes");
const chromeContent = document.getElementById("chrome-content");
const form = document.getElementById("proxy-form");
const input = document.getElementById("url-input");
const protoSpan = document.getElementById("omnibox-proto");
const reloadBtn = document.getElementById("reload-btn");
const backBtn = document.getElementById("back-btn");
const forwardBtn = document.getElementById("forward-btn");
const newTabBtn = document.getElementById("new-tab-btn");

let tabs = [];
let activeTabId = null;
let homeSettings = loadHomeSettings();
let clockTimerId = null;

function getHomeSettings() {
  return homeSettings;
}

function setHomeSettings(updater) {
  homeSettings = typeof updater === "function" ? updater(homeSettings) : updater;
  saveHomeSettings(homeSettings);
  renderAllHomescreens();
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

function updateControls() {
  const tab = getActiveTab();
  const canReload = Boolean(tab?.mode === "web" && (tab.url || tab?.frame?.src));
  const canGoBack = Boolean(tab && tab.historyIndex > 0 && !tab.loading);
  const canGoForward = Boolean(tab && tab.historyIndex < tab.historyEntries.length - 1 && !tab.loading);

  reloadBtn.disabled = !canReload;
  backBtn.disabled = !canGoBack;
  forwardBtn.disabled = !canGoForward;
  chromeContent.classList.toggle("loading", Boolean(tab?.loading));
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
  activeTabId = id;
  requestAnimationFrame(() => {
    renderTabActive();
    updateAddressBar(getTab(id));
    getTab(id)?.dom?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  });
}

function createTab(id = nextId(), options = {}) {
  const hasUrl = Boolean(options.url);
  const tab = {
    id,
    title: options.title ?? "New Tab",
    url: options.url ?? "",
    displayUrl: options.displayUrl ?? "",
    isSearch: options.isSearch ?? false,
    loading: hasUrl,
    historyEntries: hasUrl ? [options.url] : [],
    historyIndex: hasUrl ? 0 : -1,
    mode: hasUrl ? "web" : "home",
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
    "allow-same-origin allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-modals allow-downloads allow-storage-access-by-user-activation";
  iframe.src = tab.url ? proxiedSrc(tab.url) : "about:blank";
  iframe.classList.toggle("is-hidden", !hasUrl);
  pane.appendChild(iframe);
  tabPanes.appendChild(pane);

  tab.pane = pane;
  tab.frame = iframe;
  renderTab(tab);
  syncPaneMode(tab);

  iframe.addEventListener("load", () => {
    handleFrameLoad(id);
  });

  return tab;
}

function handleFrameLoad(id) {
  const tab = getTab(id);
  if (!tab) {
    return;
  }

  const decodedTarget = readFrameTargetUrl(tab.frame);
  if (decodedTarget) {
    tab.mode = "web";
    tab.url = decodedTarget;
    tab.isSearch = false;
    tab.displayUrl = "";
    syncTabHistory(tab, decodedTarget);
    try {
      setTabTitle(tab, tab.frame.contentDocument?.title || tabTitleFromUrl(decodedTarget));
    } catch {
      setTabTitle(tab, tabTitleFromUrl(decodedTarget));
    }
  }

  syncPaneMode(tab);
  setTabLoading(tab, false);
  if (tab.id === activeTabId) {
    updateAddressBar(tab);
  }
}

function closeTab(id) {
  const currentIndex = tabs.findIndex((tab) => tab.id === id);
  if (currentIndex === -1) {
    return;
  }

  const tab = tabs[currentIndex];
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
      activeTabId = null;
      createTab(nextId());
      switchTab(tabs[0].id);
      return;
    }

    if (activeTabId === id) {
      const nextTab = tabs[Math.min(currentIndex, tabs.length - 1)];
      switchTab(nextTab.id);
    } else {
      renderTabActive();
    }
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
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  navigate(input.value);
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
  const id = nextId();
  createTab(id);
  switchTab(id);
  input.value = "";
  protoSpan.textContent = "";
  input.focus();
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

  if (typeof data.title === "string" && data.title.trim()) {
    setTabTitle(tab, data.title);
  }

  if (data.kind === "commit" && typeof data.url === "string" && /^https?:/i.test(data.url)) {
    tab.mode = "web";
    tab.url = data.url;
    tab.isSearch = false;
    tab.displayUrl = "";
    syncTabHistory(tab, data.url);
    syncPaneMode(tab);
    setTabLoading(tab, false);
    if (tab.id === activeTabId) {
      updateAddressBar(tab);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey) {
    if (event.key === "t") {
      event.preventDefault();
      newTabBtn.click();
      return;
    }

    if (event.key === "w") {
      event.preventDefault();
      const tab = getActiveTab();
      if (tab) {
        closeTab(tab.id);
      }
      return;
    }

    if (event.key === "r") {
      event.preventDefault();
      reloadBtn.click();
      return;
    }

    if (event.key === "l") {
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }

    if (event.key === "Tab" && tabs.length > 1) {
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
    }
  }
});

document.getElementById("chrome-omnibox")?.addEventListener("click", (event) => {
  if (event.target !== input) {
    input.focus();
  }
});

createTab(nextId());
switchTab(tabs[0].id);
