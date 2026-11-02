import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "pi-jira-multiproject.json";

export type SafetyLevel = "open" | "confirm" | "readonly";

/** A narrowly scoped mutation action permitted for a headless confirm-mode run. */
export interface HeadlessApprovalRule {
  action: string;
  projectKey?: string;
  issueKeys?: string[];
}

/** OAuth 2.0 (3LO) settings for a Jira Cloud site. Tokens are persisted by /jira-login. */
export interface JiraOAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  accessToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds when the current access token expires. */
  expiresAt?: number;
  cloudId?: string;
}

/** A single Jira Cloud site/account entry from the config file. */
export interface JiraSiteConfig {
  name: string;
  url: string;
  /** PAT auth: Atlassian account email. Omit for OAuth-only sites. */
  email?: string;
  /** PAT auth: Atlassian API token. Omit for OAuth-only sites. */
  apiToken?: string;
  /** OAuth auth: 3LO app credentials + persisted tokens. Omit for PAT-only sites. */
  oauth?: JiraOAuthConfig;
  safetyLevel?: SafetyLevel;
  headlessApprovals?: HeadlessApprovalRule[];
  /** Absolute path of the config file this site was loaded from (used to persist OAuth token refreshes). */
  configPath?: string;
}

/** Parsed and validated contents of the user-level config file. */
export interface JiraConfig {
  sites: JiraSiteConfig[];
  defaultSite?: string;
  safetyLevel: SafetyLevel;
  mock: boolean;
  configPath: string;
  configExists: boolean;
}

interface RawSite {
  name?: unknown;
  url?: unknown;
  email?: unknown;
  apiToken?: unknown;
  oauth?: unknown;
  safetyLevel?: unknown;
  headlessApprovals?: unknown;
}

export class ConfigError extends Error {}

function parseOAuthConfig(raw: unknown, siteName: string, path: string): JiraOAuthConfig | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth" must be an object.`);
  }

  const o = raw as Record<string, unknown>;
  if (typeof o.clientId !== "string" || o.clientId.length === 0) {
    throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.clientId" must be a non-empty string.`);
  }

  const oauth: JiraOAuthConfig = { clientId: o.clientId };

  if (o.clientSecret !== undefined) {
    if (typeof o.clientSecret !== "string") {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.clientSecret" must be a string.`);
    }
    oauth.clientSecret = o.clientSecret;
  }
  if (o.redirectUri !== undefined) {
    if (typeof o.redirectUri !== "string") {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.redirectUri" must be a string.`);
    }
    oauth.redirectUri = o.redirectUri;
  }
  if (o.scopes !== undefined) {
    if (!Array.isArray(o.scopes) || !o.scopes.every((scope) => typeof scope === "string")) {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.scopes" must be an array of strings.`);
    }
    oauth.scopes = o.scopes as string[];
  }
  if (o.accessToken !== undefined) {
    if (typeof o.accessToken !== "string") {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.accessToken" must be a string.`);
    }
    oauth.accessToken = o.accessToken;
  }
  if (o.refreshToken !== undefined) {
    if (typeof o.refreshToken !== "string") {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.refreshToken" must be a string.`);
    }
    oauth.refreshToken = o.refreshToken;
  }
  if (o.expiresAt !== undefined) {
    if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.expiresAt" must be a number.`);
    }
    oauth.expiresAt = o.expiresAt;
  }
  if (o.cloudId !== undefined) {
    if (typeof o.cloudId !== "string") {
      throw new ConfigError(`Config ${path}: site "${siteName}" field "oauth.cloudId" must be a string.`);
    }
    oauth.cloudId = o.cloudId;
  }

  return oauth;
}

/**
 * Insert or update one site entry in the config file. Unknown top-level config
 * fields and other sites are preserved.
 */
export function upsertSiteConfig(path: string, site: JiraSiteConfig): void {
  const config = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
    : {};

  const sites = Array.isArray(config.sites) ? (config.sites as Record<string, unknown>[]) : [];
  const nextSite: Record<string, unknown> = {
    name: site.name,
    url: site.url,
    email: site.email,
    apiToken: site.apiToken,
    oauth: site.oauth,
  };
  if (site.safetyLevel !== undefined) nextSite.safetyLevel = site.safetyLevel;
  if (site.headlessApprovals !== undefined) nextSite.headlessApprovals = site.headlessApprovals;

  const existingIndex = sites.findIndex((entry) => entry?.name === site.name);
  if (existingIndex >= 0) {
    sites[existingIndex] = { ...sites[existingIndex], ...nextSite };
  } else {
    sites.push(nextSite);
  }

  config.sites = sites;
  if (typeof config.defaultSite !== "string" || config.defaultSite.length === 0) {
    config.defaultSite = site.name;
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Absolute path to the user-level config file (~/.pi/agent/pi-jira-multiproject.json). */
export function getConfigPath(): string {
  return join(homedir(), ".pi", "agent", CONFIG_FILE_NAME);
}

/**
 * Load and validate config. Returns a not-configured stub when no config file
 * exists yet, so `jira_doctor` can report a clear setup message instead of throwing.
 */
export function loadConfig(path: string = getConfigPath()): JiraConfig {
  if (!existsSync(path)) {
    return {
      sites: [],
      defaultSite: undefined,
      safetyLevel: "confirm",
      mock: false,
      configPath: path,
      configExists: false,
    };
  }

  let raw: { sites?: unknown; defaultSite?: unknown; safetyLevel?: unknown; mock?: unknown };
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as typeof raw;
  } catch (error) {
    throw new ConfigError(`Failed to parse ${path}: ${(error as Error).message}`);
  }

  const sites = Array.isArray(raw.sites) ? (raw.sites as RawSite[]) : [];
  const parsedSites: JiraSiteConfig[] = [];

  for (const site of sites) {
    if (!site || typeof site !== "object") {
      throw new ConfigError(`Config ${path}: every entry in "sites" must be an object.`);
    }
    if (!site.name) throw new ConfigError(`Config ${path}: every entry in "sites" requires a "name".`);
    if (!site.url) throw new ConfigError(`Config ${path}: site "${site.name}" requires a "url" (e.g. https://your-domain.atlassian.net).`);

    const email = typeof site.email === "string" && site.email.length > 0 ? site.email : undefined;
    const apiToken = typeof site.apiToken === "string" && site.apiToken.length > 0 ? site.apiToken : undefined;
    const oauth = parseOAuthConfig(site.oauth, String(site.name), path);
    const hasPat = Boolean(email && apiToken);
    const hasOAuth = Boolean(oauth);

    if (!raw.mock && !hasOAuth) {
      if (email && !apiToken) {
        throw new ConfigError(`Config ${path}: site "${site.name}" has "email" but is missing an "apiToken" (or configure "oauth" instead).`);
      }
      if (!email && apiToken) {
        throw new ConfigError(`Config ${path}: site "${site.name}" has "apiToken" but is missing an "email" (or configure "oauth" instead).`);
      }
    }
    if (!raw.mock && !hasPat && !hasOAuth) {
      throw new ConfigError(
        `Config ${path}: site "${site.name}" requires either "email"+"apiToken" (PAT) or an "oauth" object (see README.md).`,
      );
    }

    if (site.headlessApprovals !== undefined && !Array.isArray(site.headlessApprovals)) {
      throw new ConfigError(`Config ${path}: site "${site.name}" field "headlessApprovals" must be an array.`);
    }
    for (const rule of (site.headlessApprovals ?? [])) {
      if (!rule || typeof rule !== "object" || typeof (rule as { action?: unknown }).action !== "string") {
        throw new ConfigError(`Config ${path}: every "headlessApprovals" entry for site "${site.name}" requires an "action" string.`);
      }
      const typedRule = rule as { projectKey?: unknown; issueKeys?: unknown };
      if (typedRule.projectKey !== undefined && typeof typedRule.projectKey !== "string") {
        throw new ConfigError(`Config ${path}: "headlessApprovals.projectKey" for site "${site.name}" must be a string.`);
      }
      if (typedRule.issueKeys !== undefined && (!Array.isArray(typedRule.issueKeys) || !typedRule.issueKeys.every((key) => typeof key === "string"))) {
        throw new ConfigError(`Config ${path}: "headlessApprovals.issueKeys" for site "${site.name}" must be an array of strings.`);
      }
    }

    parsedSites.push({
      name: String(site.name),
      url: String(site.url),
      configPath: path,
      ...(email !== undefined ? { email } : {}),
      ...(apiToken !== undefined ? { apiToken } : {}),
      ...(oauth !== undefined ? { oauth } : {}),
      ...(site.safetyLevel !== undefined ? { safetyLevel: site.safetyLevel as SafetyLevel } : {}),
      ...(Array.isArray(site.headlessApprovals)
        ? {
            headlessApprovals: site.headlessApprovals.map((rule) => {
              const typedRule = rule as { action: string; projectKey?: string; issueKeys?: string[] };
              return {
                action: typedRule.action,
                ...(typedRule.projectKey !== undefined ? { projectKey: typedRule.projectKey } : {}),
                ...(typedRule.issueKeys !== undefined ? { issueKeys: typedRule.issueKeys } : {}),
              };
            }),
          }
        : {}),
    });
  }

  return {
    sites: parsedSites,
    defaultSite: typeof raw.defaultSite === "string" ? raw.defaultSite : parsedSites[0]?.name,
    safetyLevel: raw.safetyLevel === "open" || raw.safetyLevel === "readonly" ? raw.safetyLevel : "confirm",
    mock: Boolean(raw.mock),
    configPath: path,
    configExists: true,
  };
}

/** Resolve the effective site config, falling back to defaultSite when name is omitted. */
export function resolveSite(config: JiraConfig, name?: string): JiraSiteConfig {
  const siteName = name ?? config.defaultSite;
  if (!siteName) {
    throw new ConfigError(
      `No Jira site configured. Add one to ${config.configPath} (see README.md for the expected shape).`,
    );
  }
  const site = config.sites.find((s) => s.name === siteName);
  if (!site) {
    const known = config.sites.map((s) => s.name).join(", ") || "(none configured)";
    throw new ConfigError(`Unknown Jira site "${siteName}". Configured sites: ${known}.`);
  }
  return site;
}

/** Cascading safetyLevel resolution: site override > global config > default "confirm". */
export function resolveSafetyLevel(
  config: Pick<JiraConfig, "safetyLevel">,
  site?: Pick<JiraSiteConfig, "safetyLevel">,
): SafetyLevel {
  return site?.safetyLevel ?? config.safetyLevel ?? "confirm";
}
