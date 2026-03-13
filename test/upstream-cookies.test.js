import assert from "node:assert/strict";
import test from "node:test";
import {
  getProxySessionCookieName,
  getUpstreamCookieHeader,
  parseRequestCookieHeader,
  resetUpstreamCookieStores,
  storeUpstreamCookies,
} from "../src/upstream-cookies.js";

test("request cookie parsing reads simple cookie headers", () => {
  assert.deepEqual(parseRequestCookieHeader("foo=bar; answer=42"), {
    foo: "bar",
    answer: "42",
  });
  assert.equal(getProxySessionCookieName(), "plutonium_session");
});

test("server-side cookie jar stores, scopes, and expires upstream cookies", () => {
  resetUpstreamCookieStores();
  const sessionId = "session-a";

  storeUpstreamCookies(sessionId, "https://example.com/challenge", [
    "cf_clearance=good; Path=/; Secure; HttpOnly",
    "narrow=path-only; Path=/challenge",
    "expired=gone; Max-Age=0; Path=/",
  ]);

  assert.equal(
    getUpstreamCookieHeader(sessionId, "https://example.com/challenge/step-two"),
    "narrow=path-only; cf_clearance=good"
  );
  assert.equal(getUpstreamCookieHeader(sessionId, "https://example.com/elsewhere"), "cf_clearance=good");
  assert.equal(getUpstreamCookieHeader(sessionId, "http://example.com/challenge"), "narrow=path-only");
});

test("server-side cookie jar respects domain cookies and rejects foreign domains", () => {
  resetUpstreamCookieStores();
  const sessionId = "session-b";

  storeUpstreamCookies(sessionId, "https://sub.example.com/login", [
    "shared=1; Domain=.example.com; Path=/",
    "hostonly=1; Path=/",
    "foreign=1; Domain=.evil.test; Path=/",
  ]);

  assert.equal(
    getUpstreamCookieHeader(sessionId, "https://deep.sub.example.com/dashboard"),
    "shared=1"
  );
  assert.equal(
    getUpstreamCookieHeader(sessionId, "https://sub.example.com/dashboard"),
    "shared=1; hostonly=1"
  );
});
