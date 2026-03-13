export const FRAME_EVENT_SOURCE = "plutonium-frame";
export const HOME_STORAGE_KEY = "plutonium-home-settings";
export const BROWSER_STATE_STORAGE_KEY = "plutonium-browser-state";

export const DEFAULT_HOME_SETTINGS = {
  backgroundUrl: "",
  bookmarks: [
    { name: "YouTube", url: "https://www.youtube.com/", accent: "YT" },
    { name: "Gmail", url: "https://mail.google.com/", accent: "GM" },
    { name: "GitHub", url: "https://github.com/", accent: "GH" },
    { name: "Reddit", url: "https://www.reddit.com/", accent: "RD" },
    { name: "X", url: "https://x.com/", accent: "X" },
    { name: "Wikipedia", url: "https://www.wikipedia.org/", accent: "WK" },
  ],
};

export const CLOCK_FORMATTER = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

export const DATE_FORMATTER = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});
