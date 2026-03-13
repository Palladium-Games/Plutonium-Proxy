import { DEFAULT_HOME_SETTINGS, HOME_STORAGE_KEY } from "./config.js";
import { normalizeBookmark } from "./browser-utils.js";

/**
 * Load homescreen settings from local storage.
 *
 * @param {Storage | undefined} [storage] Browser storage implementation.
 * @returns {{backgroundUrl: string, bookmarks: Array<{name: string, url: string, accent: string}>}} Loaded settings.
 */
export function loadHomeSettings(storage = globalThis.localStorage) {
  if (!storage) {
    return cloneDefaultSettings();
  }

  try {
    const parsed = JSON.parse(storage.getItem(HOME_STORAGE_KEY) || "{}");
    const bookmarks =
      Array.isArray(parsed.bookmarks) && parsed.bookmarks.length
        ? parsed.bookmarks.map((bookmark) => normalizeBookmark(bookmark)).filter(Boolean)
        : DEFAULT_HOME_SETTINGS.bookmarks.slice();

    return {
      backgroundUrl: typeof parsed.backgroundUrl === "string" ? parsed.backgroundUrl.trim() : "",
      bookmarks,
    };
  } catch {
    return cloneDefaultSettings();
  }
}

/**
 * Save homescreen settings into local storage.
 *
 * @param {{backgroundUrl: string, bookmarks: Array<{name: string, url: string, accent: string}>}} settings Settings payload.
 * @param {Storage | undefined} [storage] Browser storage implementation.
 * @returns {void}
 */
export function saveHomeSettings(settings, storage = globalThis.localStorage) {
  if (!storage) {
    return;
  }

  storage.setItem(HOME_STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Create a fresh copy of the default homescreen settings.
 *
 * @returns {{backgroundUrl: string, bookmarks: Array<{name: string, url: string, accent: string}>}} Default settings clone.
 */
function cloneDefaultSettings() {
  return {
    backgroundUrl: "",
    bookmarks: DEFAULT_HOME_SETTINGS.bookmarks.slice(),
  };
}
