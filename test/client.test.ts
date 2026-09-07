import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiraClient, JiraApiError } from "../src/client.ts";

const site = { name: "example", url: "https://example.atlassian.net", email: "fred@example.com", apiToken: "token" };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "status",
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  };
}

test("GET builds the expected URL, headers, and returns parsed JSON", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  const fetchImpl = async (url: string, init: any) => {
    seenUrl = url;
    seenHeaders = init.headers;
    return jsonResponse(200, { ok: true });
  };

  const client = createJiraClient(site, { fetchImpl: fetchImpl as any });
  const result = await client.get("/myself");

  assert.equal(seenUrl, "https://example.atlassian.net/rest/api/3/myself");
  assert.equal(seenHeaders.Authorization, `Basic ${Buffer.from("fred@example.com:token").toString("base64")}`);
  assert.deepEqual(result, { ok: true });
});

test("GET serializes query params, including arrays as repeated keys", async () => {
  let seenUrl = "";
  const fetchImpl = async (url: string) => {
    seenUrl = url;
    return jsonResponse(200, {});
  };
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any });
  await client.get("/search", { query: { jql: "project = X", fields: ["summary", "status"], missing: undefined } });

  const url = new URL(seenUrl);
  assert.equal(url.searchParams.get("jql"), "project = X");
  assert.deepEqual(url.searchParams.getAll("fields"), ["summary", "status"]);
  assert.equal(url.searchParams.has("missing"), false);
});

test("POST sends a JSON body and Content-Type header", async () => {
  let seenBody = "";
  let seenHeaders: Record<string, string> = {};
  const fetchImpl = async (_url: string, init: any) => {
    seenBody = init.body;
    seenHeaders = init.headers;
    return jsonResponse(200, { id: "1" });
  };
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any });
  await client.post("/issue", { fields: { summary: "x" } });

  assert.equal(seenHeaders["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seenBody), { fields: { summary: "x" } });
});

test("non-2xx responses throw JiraApiError with status and body", async () => {
  const fetchImpl = async () => jsonResponse(401, { errorMessages: ["Unauthorized"] });
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any });

  await assert.rejects(() => client.get("/myself"), (error) => {
    assert.ok(error instanceof JiraApiError);
    assert.equal((error as JiraApiError).status, 401);
    assert.match(error.message, /authentication failed/);
    return true;
  });
});

test("429 responses are retried after Retry-After before succeeding", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return jsonResponse(429, {}, { "retry-after": "0" });
    return jsonResponse(200, { ok: true });
  };
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any });
  const result = await client.get("/myself");

  assert.equal(attempts, 2);
  assert.deepEqual(result, { ok: true });
});

test("204 responses resolve to undefined", async () => {
  const fetchImpl = async () => ({ status: 204, statusText: "No Content", headers: { get: () => null } });
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any });
  assert.equal(await client.get("/issue/UAT-1/transitions"), undefined);
});

test("an explicit dispatcher (e.g. a corporate proxy agent) is passed through to fetch", async () => {
  let seenDispatcher: unknown;
  const fakeDispatcher = { marker: "proxy-dispatcher" };
  const fetchImpl = async (_url: string, init: any) => {
    seenDispatcher = init.dispatcher;
    return jsonResponse(200, {});
  };
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any, dispatcher: fakeDispatcher });
  await client.get("/myself");
  assert.equal(seenDispatcher, fakeDispatcher);
});

test("no dispatcher option is set on fetch when none is configured", async () => {
  let sawDispatcherKey = true;
  const fetchImpl = async (_url: string, init: any) => {
    sawDispatcherKey = "dispatcher" in init;
    return jsonResponse(200, {});
  };
  const client = createJiraClient(site, { fetchImpl: fetchImpl as any, dispatcher: undefined });
  await client.get("/myself");
  assert.equal(sawDispatcherKey, false);
});
