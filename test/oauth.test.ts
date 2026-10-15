import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATLASSIAN_ACCESSIBLE_RESOURCES_URL,
  ATLASSIAN_TOKEN_URL,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchAccessibleResources,
  findCloudId,
  OAuthTokenManager,
  refreshAccessToken,
} from "../src/oauth.ts";
import { loadConfig } from "../src/config.ts";

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "status",
    text: async () => JSON.stringify(body),
  };
}

function withConfigFile(contents: unknown, run: (path: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), "pi-jira-oauth-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(contents), "utf8");
  return Promise.resolve(run(path)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("buildAuthorizationUrl builds an Atlassian 3LO authorization URL", () => {
  const url = buildAuthorizationUrl({
    clientId: "client-id",
    redirectUri: "http://localhost:8765/callback",
    scopes: ["read:jira-work", "offline_access"],
    state: "state-123",
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://auth.atlassian.com/authorize");
  assert.equal(parsed.searchParams.get("audience"), "api.atlassian.com");
  assert.equal(parsed.searchParams.get("client_id"), "client-id");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://localhost:8765/callback");
  assert.equal(parsed.searchParams.get("scope"), "read:jira-work offline_access");
  assert.equal(parsed.searchParams.get("state"), "state-123");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
});

test("exchangeAuthorizationCode posts the code and parses token fields", async () => {
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  const fetchImpl = async (url: string, init: any) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    return jsonResponse(200, { access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600, scope: "read:jira-work" });
  };

  const token = await exchangeAuthorizationCode({
    clientId: "client-id",
    clientSecret: "client-secret",
    code: "auth-code",
    redirectUri: "http://localhost/callback",
    fetchImpl: fetchImpl as any,
    now: 1_000_000,
  });

  assert.equal(seenUrl, ATLASSIAN_TOKEN_URL);
  assert.equal(seenBody.grant_type, "authorization_code");
  assert.equal(seenBody.code, "auth-code");
  assert.equal(seenBody.client_id, "client-id");
  assert.equal(seenBody.client_secret, "client-secret");
  assert.deepEqual(token, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: 1_000_000 + 3600 * 1000,
    scope: "read:jira-work",
  });
});

test("refreshAccessToken posts the refresh token grant", async () => {
  let seenBody: Record<string, unknown> = {};
  const fetchImpl = async (_url: string, init: any) => {
    seenBody = JSON.parse(init.body);
    return jsonResponse(200, { access_token: "fresh-access-token", expires_in: 7200 });
  };

  const token = await refreshAccessToken({
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token",
    fetchImpl: fetchImpl as any,
    now: 2_000_000,
  });

  assert.equal(seenBody.grant_type, "refresh_token");
  assert.equal(seenBody.refresh_token, "refresh-token");
  assert.equal(token.accessToken, "fresh-access-token");
  assert.equal(token.refreshToken, undefined);
  assert.equal(token.expiresAt, 2_000_000 + 7200 * 1000);
});

test("fetchAccessibleResources sends a Bearer token and parses resources", async () => {
  let seenAuthorization = "";
  const fetchImpl = async (_url: string, init: any) => {
    seenAuthorization = init.headers.Authorization;
    return jsonResponse(200, [{ id: "cloud-1", name: "Acme", url: "https://acme.atlassian.net" }]);
  };

  const resources = await fetchAccessibleResources("access-token", fetchImpl as any);

  assert.equal(seenAuthorization, "Bearer access-token");
  assert.equal(resources[0].id, "cloud-1");
});

test("findCloudId matches site URLs regardless of trailing slash", () => {
  const resources = [
    { id: "cloud-1", name: "Acme", url: "https://acme.atlassian.net/" },
    { id: "cloud-2", name: "Other", url: "https://other.atlassian.net" },
  ];

  assert.equal(findCloudId(resources, "https://acme.atlassian.net"), "cloud-1");
  assert.throws(() => findCloudId(resources, "https://missing.atlassian.net"), /No accessible Jira resource matched/);
});

test("OAuthTokenManager refreshes an expired token and persists it to the config file", async () => {
  await withConfigFile(
    {
      sites: [{
        name: "acme",
        url: "https://acme.atlassian.net",
        oauth: {
          clientId: "client-id",
          clientSecret: "client-secret",
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: Date.now() - 60_000,
        },
      }],
    },
    async (path) => {
      const site = loadConfig(path).sites[0];

      const fetchImpl = async (url: string) => {
        assert.equal(url, ATLASSIAN_TOKEN_URL);
        return jsonResponse(200, { access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 3600 });
      };

      const manager = new OAuthTokenManager(site, fetchImpl as any);
      const token = await manager.getAccessToken();

      assert.equal(token, "new-access-token");

      const persisted = JSON.parse(readFileSync(path, "utf8")) as { sites: Array<{ oauth: { accessToken: string; refreshToken: string; expiresAt: number } }> };
      assert.equal(persisted.sites[0].oauth.accessToken, "new-access-token");
      assert.equal(persisted.sites[0].oauth.refreshToken, "new-refresh-token");
      assert.ok(persisted.sites[0].oauth.expiresAt > Date.now());
    },
  );
});

test("OAuthTokenManager resolves and persists the cloud ID on first use", async () => {
  await withConfigFile(
    {
      sites: [{
        name: "acme",
        url: "https://acme.atlassian.net",
        oauth: {
          clientId: "client-id",
          clientSecret: "client-secret",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: Date.now() + 3_600_000,
        },
      }],
    },
    async (path) => {
      const site = loadConfig(path).sites[0];

      const fetchImpl = async (url: string) => {
        assert.equal(url, ATLASSIAN_ACCESSIBLE_RESOURCES_URL);
        return jsonResponse(200, [{ id: "cloud-42", name: "Acme", url: "https://acme.atlassian.net" }]);
      };

      const manager = new OAuthTokenManager(site, fetchImpl as any);
      const cloudId = await manager.ensureCloudId();

      assert.equal(cloudId, "cloud-42");

      const persisted = JSON.parse(readFileSync(path, "utf8")) as { sites: Array<{ oauth: { cloudId: string } }> };
      assert.equal(persisted.sites[0].oauth.cloudId, "cloud-42");
    },
  );
});
