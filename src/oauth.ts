import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { JiraOAuthConfig, JiraSiteConfig } from "./config.ts";

export const ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const ATLASSIAN_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
export const ATLASSIAN_API_BASE = "https://api.atlassian.com/ex/jira";
export const DEFAULT_OAUTH_SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"];

const EXPIRY_LEEWAY_MS = 60_000;

/** Minimal structural fetch — real `fetch` and test stubs both satisfy this. */
export interface OAuthFetchLike {
  (url: string, init: Record<string, unknown>): Promise<OAuthResponseLike>;
}

/** Minimal structural Response for the OAuth endpoints this module talks to. */
export interface OAuthResponseLike {
  status: number;
  ok: boolean;
  statusText: string;
  text(): Promise<string>;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export interface AccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes?: string[];
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** Build the Atlassian OAuth 2.0 (3LO) authorization URL. */
export function buildAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  state?: string;
}): string {
  const query = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: params.clientId,
    scope: (params.scopes ?? DEFAULT_OAUTH_SCOPES).join(" "),
    redirect_uri: params.redirectUri,
    state: params.state ?? randomUUID(),
    response_type: "code",
    prompt: "consent",
  });
  return `${ATLASSIAN_AUTHORIZE_URL}?${query.toString()}`;
}

/** Exchange an authorization code for an access/refresh token pair. */
export async function exchangeAuthorizationCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: OAuthFetchLike;
  now?: number;
}): Promise<OAuthTokenSet> {
  const data = await tokenRequest(
    {
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    },
    params.fetchImpl ?? (fetch as unknown as OAuthFetchLike),
  );
  return tokenSetFromResponse(data, params.now ?? Date.now());
}

/** Refresh an OAuth access token using a refresh token. */
export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: OAuthFetchLike;
  now?: number;
}): Promise<OAuthTokenSet> {
  const data = await tokenRequest(
    {
      grant_type: "refresh_token",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    },
    params.fetchImpl ?? (fetch as unknown as OAuthFetchLike),
  );
  return tokenSetFromResponse(data, params.now ?? Date.now());
}

/** List the Atlassian sites (cloud resources) the supplied access token can act on. */
export async function fetchAccessibleResources(
  accessToken: string,
  fetchImpl: OAuthFetchLike = fetch as unknown as OAuthFetchLike,
): Promise<AccessibleResource[]> {
  const response = await fetchImpl(ATLASSIAN_ACCESSIBLE_RESOURCES_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await oauthErrorText("Atlassian accessible-resources request failed", response));
  }

  const text = await response.text();
  if (!text) return [];
  try {
    return JSON.parse(text) as AccessibleResource[];
  } catch {
    throw new Error(`Atlassian accessible-resources returned invalid JSON: ${text}`);
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/^https?:\/\//i, "").toLowerCase();
}

/** Match a Jira site URL against the accessible-resources response and return its cloud ID. */
export function findCloudId(resources: AccessibleResource[], siteUrl: string): string {
  const normalizedSite = normalizeUrl(siteUrl);
  const match = resources.find((resource) => normalizeUrl(resource.url) === normalizedSite);
  if (!match) {
    const known = resources.map((resource) => resource.url).join(", ") || "(none)";
    throw new Error(
      `No accessible Jira resource matched "${siteUrl}". The OAuth token can access: ${known}.`,
    );
  }
  return match.id;
}

export function isOAuthTokenExpired(oauth: JiraOAuthConfig, now: number = Date.now()): boolean {
  if (!oauth.accessToken) return true;
  if (typeof oauth.expiresAt !== "number") return Boolean(oauth.refreshToken);
  return oauth.expiresAt <= now + EXPIRY_LEEWAY_MS;
}

/**
 * Persist token/cloud-id changes for one site back into the config file without
 * disturbing the rest of the file. Does nothing when the site has no config path
 * (e.g. hand-constructed test fixtures).
 */
export function persistSiteOAuth(
  configPath: string | undefined,
  siteName: string,
  patch: Partial<JiraOAuthConfig>,
): void {
  if (!configPath || !existsSync(configPath)) return;
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as { sites?: Record<string, unknown>[] };
  const sites = Array.isArray(raw.sites) ? raw.sites : [];
  const site = sites.find((entry) => entry?.name === siteName);
  if (!site) return;
  site.oauth = { ...(site.oauth as Record<string, unknown> | undefined), ...patch };
  writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

/**
 * Stateful OAuth token access for one site. Refreshes expired tokens and resolves
 * the Jira cloud ID on first use, persisting both back to the config file.
 */
export class OAuthTokenManager {
  private readonly site: JiraSiteConfig;
  private readonly fetchImpl: OAuthFetchLike;

  constructor(site: JiraSiteConfig, fetchImpl: OAuthFetchLike = fetch as unknown as OAuthFetchLike) {
    this.site = site;
    this.fetchImpl = fetchImpl;
  }

  private oauth(): JiraOAuthConfig {
    if (!this.site.oauth) {
      throw new Error(`OAuth is not configured for Jira site "${this.site.name}".`);
    }
    return this.site.oauth;
  }

  /** Resolve the Jira cloud ID, fetching accessible-resources when it is not cached. */
  async ensureCloudId(): Promise<string> {
    const oauth = this.oauth();
    if (oauth.cloudId) return oauth.cloudId;

    const accessToken = await this.getAccessToken();
    const resources = await fetchAccessibleResources(accessToken, this.fetchImpl);
    const cloudId = findCloudId(resources, this.site.url);
    this.persist({ cloudId });
    return cloudId;
  }

  /** Return a valid access token, refreshing first when the current one expired. */
  async getAccessToken(): Promise<string> {
    const oauth = this.oauth();
    if (!oauth.accessToken) {
      if (oauth.refreshToken) return this.refresh();
      throw new Error(
        `No OAuth access token for Jira site "${this.site.name}". Run /jira-login to sign in.`,
      );
    }

    if (!isOAuthTokenExpired(oauth)) return oauth.accessToken;
    return this.refresh();
  }

  /** Force a refresh-token grant, persist the result, and return the new access token. */
  async refresh(): Promise<string> {
    const oauth = this.oauth();
    if (!oauth.clientSecret) {
      throw new Error(`OAuth clientSecret is required to refresh Jira site "${this.site.name}".`);
    }
    if (!oauth.refreshToken) {
      throw new Error(
        `OAuth refresh token is missing for Jira site "${this.site.name}". Run /jira-login to reauthorize.`,
      );
    }

    const token = await refreshAccessToken({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken: oauth.refreshToken,
      fetchImpl: this.fetchImpl,
    });

    this.persist({
      accessToken: token.accessToken,
      ...(token.refreshToken !== undefined ? { refreshToken: token.refreshToken } : {}),
      expiresAt: token.expiresAt,
    });
    return token.accessToken;
  }

  private persist(patch: Partial<JiraOAuthConfig>): void {
    const oauth = this.oauth();
    Object.assign(oauth, patch);
    persistSiteOAuth(this.site.configPath, this.site.name, patch);
  }
}

async function tokenRequest(body: Record<string, unknown>, fetchImpl: OAuthFetchLike): Promise<OAuthTokenResponse> {
  const response = await fetchImpl(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await oauthErrorText("Atlassian OAuth token request failed", response));
  }

  const text = await response.text();
  if (!text) {
    throw new Error("Atlassian OAuth token request returned an empty response.");
  }

  let data: OAuthTokenResponse;
  try {
    data = JSON.parse(text) as OAuthTokenResponse;
  } catch {
    throw new Error(`Atlassian OAuth token request returned invalid JSON: ${text}`);
  }

  if (!data.access_token) {
    throw new Error("Atlassian OAuth token response is missing access_token.");
  }
  return data;
}

async function oauthErrorText(prefix: string, response: OAuthResponseLike): Promise<string> {
  let detail = "";
  try {
    const text = await response.text();
    if (text) detail = `: ${text}`;
  } catch {
    // ignore body-read errors and fall back to status/statusText
  }
  return `${prefix} (${response.status} ${response.statusText})${detail}`;
}

function tokenSetFromResponse(data: OAuthTokenResponse, now: number): OAuthTokenSet {
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
    expiresAt: now + expiresIn * 1000,
    ...(data.scope !== undefined ? { scope: data.scope } : {}),
  };
}
