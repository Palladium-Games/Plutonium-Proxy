import assert from "node:assert/strict";
import test from "node:test";

import { orderTabsForDisplay } from "../public/scripts/tab-utils.js";

test("tab ordering keeps pinned tabs first while preserving group order", () => {
  const ordered = orderTabsForDisplay([
    { id: "alpha", pinned: false },
    { id: "beta", pinned: true },
    { id: "gamma", pinned: false },
    { id: "delta", pinned: true },
  ]);

  assert.deepEqual(
    ordered.map((tab) => tab.id),
    ["beta", "delta", "alpha", "gamma"]
  );
});

test("tab ordering ignores invalid entries and tolerates non-arrays", () => {
  assert.deepEqual(orderTabsForDisplay(null), []);
  assert.deepEqual(
    orderTabsForDisplay([{ id: "home", pinned: true }, null, { id: "docs", pinned: false }]).map((tab) => tab.id),
    ["home", "docs"]
  );
});
