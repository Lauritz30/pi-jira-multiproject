import { test } from "node:test";
import assert from "node:assert/strict";
import { ProxyAgent } from "undici";
import { getProxyDispatcher } from "../src/proxy.ts";

test("getProxyDispatcher returns undefined when no proxy env vars are set", () => {
  assert.equal(getProxyDispatcher({}), undefined);
});

test("getProxyDispatcher builds a ProxyAgent from HTTPS_PROXY", async () => {
  const dispatcher = getProxyDispatcher({ HTTPS_PROXY: "http://proxy.example.com:8080" });
  try {
    assert.ok(dispatcher instanceof ProxyAgent);
  } finally {
    await dispatcher?.close();
  }
});

test("getProxyDispatcher falls back through https_proxy, HTTP_PROXY, http_proxy in order", async () => {
  const dispatcher = getProxyDispatcher({ http_proxy: "http://proxy.example.com:3128" });
  try {
    assert.ok(dispatcher instanceof ProxyAgent);
  } finally {
    await dispatcher?.close();
  }
});

test("getProxyDispatcher prefers HTTPS_PROXY over HTTP_PROXY when both are set", async () => {
  const dispatcher = getProxyDispatcher({
    HTTPS_PROXY: "http://secure-proxy.example.com:8080",
    HTTP_PROXY: "http://plain-proxy.example.com:8080",
  });
  try {
    assert.ok(dispatcher instanceof ProxyAgent);
  } finally {
    await dispatcher?.close();
  }
});
