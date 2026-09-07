import { test } from "node:test";
import assert from "node:assert/strict";
import { guardMutation, SafetyBlockedError } from "../src/safety.ts";

const config = { safetyLevel: "confirm" as const };

function siteWith(safetyLevel: "readonly" | "open" | "confirm") {
  return { name: "acme", safetyLevel };
}

function ctxWithConfirm() {
  return { hasUI: true, ui: { confirm: async () => true } };
}

test("guardMutation blocks unconditionally under readonly", async () => {
  await assert.rejects(
    () => guardMutation(config, siteWith("readonly"), ctxWithConfirm(), { title: "t", message: "m" }),
    SafetyBlockedError,
  );
});

test("guardMutation proceeds without prompting under open", async () => {
  let confirmCalled = false;
  await guardMutation(
    config,
    siteWith("open"),
    { hasUI: true, ui: { confirm: async () => { confirmCalled = true; return true; } } },
    { title: "t", message: "m" },
  );
  assert.equal(confirmCalled, false);
});

test("guardMutation prompts and proceeds when the user approves under confirm", async () => {
  let promptedWith: { title: string; message: string } | undefined;
  await guardMutation(
    config,
    siteWith("confirm"),
    { hasUI: true, ui: { confirm: async (title: string, message: string) => { promptedWith = { title, message }; return true; } } },
    { title: "Create thing", message: "Are you sure?" },
  );
  assert.deepEqual(promptedWith, { title: "Create thing", message: "Are you sure?" });
});

test("guardMutation blocks when the user declines under confirm", async () => {
  await assert.rejects(
    () => guardMutation(config, siteWith("confirm"), { hasUI: true, ui: { confirm: async () => false } }, { title: "t", message: "m" }),
    SafetyBlockedError,
  );
});

test("guardMutation blocks under confirm when no UI is available", async () => {
  await assert.rejects(
    () => guardMutation(config, siteWith("confirm"), { hasUI: false }, { title: "t", message: "m" }),
    /Set safetyLevel to "open"/,
  );
});

test("guardMutation falls back to the site's own safetyLevel over the global config", async () => {
  const permissiveConfig = { safetyLevel: "readonly" as const };
  let confirmCalled = false;
  await guardMutation(
    permissiveConfig,
    siteWith("open"),
    { hasUI: true, ui: { confirm: async () => { confirmCalled = true; return true; } } },
    { title: "t", message: "m" },
  );
  assert.equal(confirmCalled, false);
});
