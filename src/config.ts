import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "pi-jira-testmanager.json";

export type SafetyLevel = "open" | "confirm" | "readonly";

/** A single Jira Cloud site/account entry from the config file. */
export interface JiraSiteConfig {
  name: string;
  url: string;
  email: string;
  apiToken?: string;
  safetyLevel?: SafetyLevel;
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
  safetyLevel?: unknown;
}

export class ConfigError extends Error {}

/** Absolute path to the user-level config file (~/.pi/agent/pi-jira-testmanager.json). */
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
  for (const site of sites) {
    if (!site.name) throw new ConfigError(`Config ${path}: every entry in "sites" requires a "name".`);
    if (!site.url) throw new ConfigError(`Config ${path}: site "${site.name}" requires a "url" (e.g. https://your-domain.atlassian.net).`);
    if (!site.email) throw new ConfigError(`Config ${path}: site "${site.name}" requires an "email".`);
    if (!site.apiToken && !raw.mock) throw new ConfigError(`Config ${path}: site "${site.name}" requires an "apiToken".`);
  }

  const parsedSites: JiraSiteConfig[] = sites.map((site) => ({
    name: String(site.name),
    url: String(site.url),
    email: String(site.email),
    ...(site.apiToken !== undefined ? { apiToken: String(site.apiToken) } : {}),
    ...(site.safetyLevel !== undefined ? { safetyLevel: site.safetyLevel as SafetyLevel } : {}),
  }));

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
