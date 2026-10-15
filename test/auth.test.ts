import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBasicAuthHeader, buildBearerAuthHeader } from "../src/auth.ts";

test("buildBasicAuthHeader encodes email:token as base64", () => {
  const header = buildBasicAuthHeader("fred@example.com", "freds_api_token");
  const expected = `Basic ${Buffer.from("fred@example.com:freds_api_token", "utf8").toString("base64")}`;
  assert.equal(header, expected);
});

test("buildBasicAuthHeader throws when email is missing", () => {
  assert.throws(() => buildBasicAuthHeader(undefined, "token"), /requires both email and apiToken/);
});

test("buildBasicAuthHeader throws when apiToken is missing", () => {
  assert.throws(() => buildBasicAuthHeader("fred@example.com", undefined), /requires both email and apiToken/);
});

test("buildBearerAuthHeader returns a Bearer header", () => {
  assert.equal(buildBearerAuthHeader("access-token"), "Bearer access-token");
});

test("buildBearerAuthHeader throws when the access token is missing", () => {
  assert.throws(() => buildBearerAuthHeader(undefined), /requires an access token/);
});
