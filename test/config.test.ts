import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveSite, resolveSafetyLevel, ConfigError, type JiraConfig, type JiraSiteConfig } from "../src/config.ts";

function withConfigFile(contents: unknown | undefined, run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pi-jira-test-"));
  const path = join(dir, "config.json");
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents), "utf8");
  try {
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadConfig returns a not-configured stub when the file is missing", () => {
  withConfigFile(undefined, (path) => {
    const config = loadConfig(path);
    assert.equal(config.configExists, false);
    assert.deepEqual(config.sites, []);
  });
});

test("loadConfig parses a valid config", () => {
  withConfigFile(
    { sites: [{ name: "acme", url: "https://acme.atlassian.net", email: "a@acme.com", apiToken: "tok" }], defaultSite: "acme" },
    (path) => {
      const config = loadConfig(path);
      assert.equal(config.configExists, true);
      assert.equal(config.sites.length, 1);
      assert.equal(config.defaultSite, "acme");
      assert.equal(config.safetyLevel, "confirm");
    },
  );
});

test("loadConfig parses site headless approval rules", () => {
  withConfigFile(
    {
      sites: [{
        name: "acme",
        url: "https://acme.atlassian.net",
        email: "a@acme.com",
        apiToken: "tok",
        headlessApprovals: [{ action: "jira_create_issue", projectKey: "UAT" }],
      }],
    },
    (path) => {
      assert.deepEqual(loadConfig(path).sites[0].headlessApprovals, [{ action: "jira_create_issue", projectKey: "UAT" }]);
    },
  );
});

test("loadConfig rejects malformed site headless approval rules", () => {
  withConfigFile(
    { sites: [{ name: "acme", url: "https://acme.atlassian.net", email: "a@acme.com", apiToken: "tok", headlessApprovals: [{}] }] },
    (path) => assert.throws(() => loadConfig(path), ConfigError),
  );
});

test("loadConfig defaults defaultSite to the first site when omitted", () => {
  withConfigFile({ sites: [{ name: "only", url: "https://only.atlassian.net", email: "a@only.com", apiToken: "tok" }] }, (path) => {
    assert.equal(loadConfig(path).defaultSite, "only");
  });
});

test("loadConfig rejects a site missing apiToken outside mock mode", () => {
  withConfigFile({ sites: [{ name: "acme", url: "https://acme.atlassian.net", email: "a@acme.com" }] }, (path) => {
    assert.throws(() => loadConfig(path), ConfigError);
  });
});

test("loadConfig allows a missing apiToken in mock mode", () => {
  withConfigFile({ mock: true, sites: [{ name: "acme", url: "https://acme.atlassian.net", email: "a@acme.com" }] }, (path) => {
    const config = loadConfig(path);
    assert.equal(config.mock, true);
  });
});

test("loadConfig throws on malformed JSON", () => {
  withConfigFile(undefined, (path) => {
    writeFileSync(path, "{ not json", "utf8");
    assert.throws(() => loadConfig(path), ConfigError);
  });
});

test("resolveSite finds the named site and falls back to defaultSite", () => {
  const config: JiraConfig = {
    configPath: "/tmp/x.json",
    defaultSite: "acme",
    safetyLevel: "confirm",
    mock: false,
    configExists: true,
    sites: [
      { name: "acme", url: "https://acme.atlassian.net", email: "a@acme.com" },
      { name: "other", url: "https://other.atlassian.net", email: "b@other.com" },
    ],
  };
  assert.equal(resolveSite(config).name, "acme");
  assert.equal(resolveSite(config, "other").name, "other");
});

test("resolveSite throws for an unknown site name", () => {
  const config: JiraConfig = {
    configPath: "/tmp/x.json",
    defaultSite: "acme",
    safetyLevel: "confirm",
    mock: false,
    configExists: true,
    sites: [{ name: "acme", url: "https://acme.atlassian.net", email: "a@acme.com" }],
  };
  assert.throws(() => resolveSite(config, "missing"), ConfigError);
});

test("resolveSite throws when no site is configured at all", () => {
  const config: JiraConfig = {
    configPath: "/tmp/x.json",
    defaultSite: undefined,
    safetyLevel: "confirm",
    mock: false,
    configExists: true,
    sites: [],
  };
  assert.throws(() => resolveSite(config), ConfigError);
});

test("resolveSafetyLevel prefers the site override over the global config", () => {
  const site: Pick<JiraSiteConfig, "safetyLevel"> = { safetyLevel: "open" };
  assert.equal(resolveSafetyLevel({ safetyLevel: "confirm" }, site), "open");
  assert.equal(resolveSafetyLevel({ safetyLevel: "confirm" }, {}), "confirm");
  assert.equal(resolveSafetyLevel({ safetyLevel: "confirm" }), "confirm");
});
