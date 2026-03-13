import {
  challengeLikely,
  escapeHtml,
  formatDate,
  formatTime,
  normalizeBookmark,
} from "./browser-utils.js";

/**
 * Render the homescreen for a single tab.
 *
 * @param {object} tab Tab state object.
 * @param {object} options Rendering options.
 * @param {() => {backgroundUrl: string, bookmarks: Array<{name: string, url: string, accent: string}>}} options.getHomeSettings Current settings getter.
 * @returns {void}
 */
export function renderHomescreen(tab, { getHomeSettings }) {
  if (!tab?.home) {
    return;
  }

  const homeSettings = getHomeSettings();
  const now = new Date();
  const timeNode = tab.home.querySelector("[data-role='time']");
  const dateNode = tab.home.querySelector("[data-role='date']");
  const bookmarksNode = tab.home.querySelector("[data-role='bookmarks']");
  const listNode = tab.home.querySelector("[data-role='bookmark-list']");
  const backgroundInput = tab.home.querySelector("[data-role='background-input']");
  const challengeHint = tab.home.querySelector("[data-role='challenge-hint']");

  if (timeNode) {
    timeNode.textContent = formatTime(now);
  }
  if (dateNode) {
    dateNode.textContent = formatDate(now);
  }
  if (backgroundInput) {
    backgroundInput.value = homeSettings.backgroundUrl;
  }

  if (bookmarksNode) {
    bookmarksNode.innerHTML = homeSettings.bookmarks
      .map(
        (bookmark, index) => `
          <button type="button" class="bookmark-card" data-bookmark-index="${index}">
            <span class="bookmark-icon">${escapeHtml(bookmark.accent)}</span>
            <span class="bookmark-name">${escapeHtml(bookmark.name)}</span>
            <span class="bookmark-url">${escapeHtml(new URL(bookmark.url).hostname)}</span>
          </button>
        `
      )
      .join("");
  }

  if (listNode) {
    listNode.innerHTML = homeSettings.bookmarks
      .map(
        (bookmark, index) => `
          <div class="bookmark-list-item">
            <div>
              <div class="bookmark-list-name">${escapeHtml(bookmark.name)}</div>
              <div class="bookmark-list-url">${escapeHtml(bookmark.url)}</div>
            </div>
            <button type="button" class="bookmark-delete" data-delete-bookmark="${index}" aria-label="Delete bookmark">×</button>
          </div>
        `
      )
      .join("");
  }

  if (homeSettings.backgroundUrl) {
    tab.home.classList.add("has-custom-bg");
    tab.home.style.backgroundImage =
      `linear-gradient(180deg, rgba(6, 10, 18, 0.5), rgba(6, 10, 18, 0.84)), ` +
      `url("${homeSettings.backgroundUrl.replace(/(["\\])/g, "\\$1")}")`;
  } else {
    tab.home.classList.remove("has-custom-bg");
    tab.home.style.backgroundImage = "";
  }

  if (challengeHint) {
    challengeHint.classList.toggle("visible", challengeLikely(tab));
  }
}

/**
 * Create the homescreen DOM for a tab and wire interactions.
 *
 * @param {object} tab Tab state object.
 * @param {object} options Homescreen options.
 * @param {() => {backgroundUrl: string, bookmarks: Array<{name: string, url: string, accent: string}>}} options.getHomeSettings Current settings getter.
 * @param {(updater: Function) => void} options.setHomeSettings Settings update hook.
 * @param {(tab: object, url: string) => void} options.navigateInTab Tab navigation callback.
 * @returns {HTMLDivElement} Homescreen element.
 */
export function createHomescreen(tab, options) {
  const home = document.createElement("div");
  home.className = "tab-pane-home";
  home.innerHTML = `
    <div class="home-shell">
      <div class="home-topbar">
        <button type="button" class="home-chip" data-action="toggle-customize">Customize</button>
      </div>
      <section class="home-hero">
        <div class="home-brand">Plutonium</div>
        <div class="home-time" data-role="time"></div>
        <div class="home-date" data-role="date"></div>
        <div class="home-subtitle">
          Launch into the web with your own launchpad. Keep your favorite places close, restore your last session on reload, and jump faster with a smarter omnibox that learns from your tabs and recent visits.
        </div>
        <div class="challenge-hint" data-role="challenge-hint">
          This page looks verification-heavy, but the proxy session stays with you while you browse.
        </div>
      </section>
      <section class="home-grid">
        <div class="bookmark-board">
          <h2 class="board-title">Launch Deck</h2>
          <div class="bookmark-grid" data-role="bookmarks"></div>
        </div>
        <aside class="customize-card" data-role="customize-card">
          <div>
            <h2 class="customize-title">Customize</h2>
            <div class="home-subtitle">Backgrounds, bookmarks, and live browser state are all saved locally in Plutonium.</div>
          </div>
          <div class="customize-body">
            <label class="panel-label">
              Background Image URL
              <input class="panel-input" data-role="background-input" type="url" placeholder="https://images.example.com/wallpaper.jpg" />
            </label>
            <div class="panel-row">
              <button type="button" class="panel-button primary" data-action="save-background">Apply Background</button>
              <button type="button" class="panel-button" data-action="reset-background">Reset</button>
            </div>
            <form class="panel-row" data-role="bookmark-form">
              <input class="panel-input" data-role="bookmark-name" type="text" placeholder="Bookmark name" />
              <input class="panel-input" data-role="bookmark-url" type="url" placeholder="https://example.com" />
              <button type="submit" class="panel-button primary">Add Bookmark</button>
            </form>
            <div class="bookmark-list" data-role="bookmark-list"></div>
          </div>
        </aside>
      </section>
    </div>
  `;

  home.addEventListener("click", (event) => {
    const bookmarkCard = event.target.closest("[data-bookmark-index]");
    if (bookmarkCard) {
      const bookmark = options.getHomeSettings().bookmarks[Number(bookmarkCard.dataset.bookmarkIndex)];
      if (bookmark) {
        options.navigateInTab(tab, bookmark.url);
      }
      return;
    }

    const deleteButton = event.target.closest("[data-delete-bookmark]");
    if (deleteButton) {
      options.setHomeSettings((currentSettings) => ({
        ...currentSettings,
        bookmarks: currentSettings.bookmarks.filter((_, index) => index !== Number(deleteButton.dataset.deleteBookmark)),
      }));
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    if (actionButton.dataset.action === "toggle-customize") {
      home.querySelector("[data-role='customize-card']")?.classList.toggle("open");
      return;
    }

    if (actionButton.dataset.action === "save-background") {
      const value = home.querySelector("[data-role='background-input']")?.value?.trim() || "";
      options.setHomeSettings((currentSettings) => ({
        ...currentSettings,
        backgroundUrl: value,
      }));
      return;
    }

    if (actionButton.dataset.action === "reset-background") {
      options.setHomeSettings((currentSettings) => ({
        ...currentSettings,
        backgroundUrl: "",
      }));
    }
  });

  home.querySelector("[data-role='bookmark-form']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nameInput = home.querySelector("[data-role='bookmark-name']");
    const urlInput = home.querySelector("[data-role='bookmark-url']");
    const bookmark = normalizeBookmark({
      name: nameInput?.value || "",
      url: urlInput?.value || "",
    });

    if (!bookmark) {
      return;
    }

    options.setHomeSettings((currentSettings) => ({
      ...currentSettings,
      bookmarks: [...currentSettings.bookmarks, bookmark],
    }));

    if (nameInput) {
      nameInput.value = "";
    }
    if (urlInput) {
      urlInput.value = "";
    }
  });

  tab.home = home;
  renderHomescreen(tab, options);
  return home;
}
