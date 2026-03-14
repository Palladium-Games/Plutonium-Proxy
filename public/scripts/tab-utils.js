/**
 * Group pinned tabs ahead of regular tabs while preserving relative order
 * inside each group.
 *
 * @param {Array<object>} tabs Tab collection.
 * @returns {Array<object>} Display-ordered tab list.
 */
export function orderTabsForDisplay(tabs) {
  if (!Array.isArray(tabs)) {
    return [];
  }

  const pinned = [];
  const regular = [];

  tabs.forEach((tab) => {
    if (!tab || typeof tab !== "object") {
      return;
    }

    if (tab.pinned) {
      pinned.push(tab);
      return;
    }

    regular.push(tab);
  });

  return [...pinned, ...regular];
}
