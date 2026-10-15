import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getConfigPath,
  loadConfig,
  upsertSiteConfig,
  type JiraSiteConfig,
} from "./config.ts";
import {
  buildAuthorizationUrl,
  DEFAULT_OAUTH_SCOPES,
  exchangeAuthorizationCode,
  fetchAccessibleResources,
  findCloudId,
  persistSiteOAuth,
} from "./oauth.ts";

/**
 * Interactive `/jira-login` command. Lets the user choose PAT or OAuth for a
 * site, collects the credentials, and stores them in the extension config file.
 */
export async function runJiraLogin(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("jira-login requires an interactive session (TUI or RPC).", "error");
    return;
  }

  try {
    const authMethod = await ctx.ui.select("Choose a Jira login method", [
      "OAuth 2.0 (3LO)",
      "Personal access token (PAT)",
    ]);
    if (!authMethod) return;

    const configPath = getConfigPath();
    const defaultSite = loadConfig().defaultSite;
    const siteName = await ctx.ui.input("Site name", defaultSite ?? "acme");
    if (!siteName) return;
    const siteUrl = await ctx.ui.input("Site URL", "https://your-domain.atlassian.net");
    if (!siteUrl) return;

    const site: JiraSiteConfig = { name: siteName, url: siteUrl };

    if (authMethod.startsWith("OAuth")) {
      await configureOAuthSite(ctx, site);
      upsertSiteConfig(configPath, site);
      await completeOAuthLogin(ctx, site, configPath);
    } else {
      await configurePatSite(ctx, site);
      upsertSiteConfig(configPath, site);
      ctx.ui.notify(`Saved PAT login for "${siteName}". Run /jira-doctor to verify.`, "info");
    }
  } catch (error) {
    ctx.ui.notify(`Jira login failed: ${(error as Error).message}`, "error");
  }
}

async function configurePatSite(ctx: ExtensionCommandContext, site: JiraSiteConfig): Promise<void> {
  const email = await ctx.ui.input("Atlassian account email");
  if (!email) throw new Error("PAT login requires an email.");
  const apiToken = await ctx.ui.input("Atlassian API token");
  if (!apiToken) throw new Error("PAT login requires an API token.");
  site.email = email;
  site.apiToken = apiToken;
}

async function configureOAuthSite(ctx: ExtensionCommandContext, site: JiraSiteConfig): Promise<void> {
  const clientId = await ctx.ui.input("OAuth client ID");
  if (!clientId) throw new Error("OAuth login requires a client ID.");
  const clientSecret = await ctx.ui.input("OAuth client secret");
  if (!clientSecret) throw new Error("OAuth login requires a client secret.");
  const redirectUri = await ctx.ui.input("OAuth callback URL", "http://localhost:8765/callback");
  if (!redirectUri) throw new Error("OAuth login requires a callback URL.");

  const scopesInput = await ctx.ui.input("OAuth scopes (space-separated)", DEFAULT_OAUTH_SCOPES.join(" "));
  const scopes = (scopesInput ?? DEFAULT_OAUTH_SCOPES.join(" "))
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  site.oauth = { clientId, clientSecret, redirectUri, scopes };
}

async function completeOAuthLogin(
  ctx: ExtensionCommandContext,
  site: JiraSiteConfig,
  configPath: string,
): Promise<void> {
  const oauth = site.oauth;
  if (!oauth?.clientId || !oauth.clientSecret || !oauth.redirectUri) {
    throw new Error("OAuth site configuration is incomplete.");
  }

  const state = randomUUID();
  const authUrl = buildAuthorizationUrl({
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    scopes: oauth.scopes,
    state,
  });

  openUrl(authUrl);
  ctx.ui.notify(`Opening ${authUrl} in your browser. If it does not open, copy the URL manually.`, "info");

  const callbackInput = await ctx.ui.input("Paste the full callback URL after approving access");
  if (!callbackInput) return;

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callbackInput);
  } catch {
    throw new Error("The pasted callback value is not a valid URL.");
  }

  if (callbackUrl.searchParams.get("state") !== state) {
    throw new Error("OAuth callback state did not match. Aborting login.");
  }

  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("OAuth callback did not contain an authorization code.");
  }

  ctx.ui.notify("Exchanging OAuth code for tokens…", "info");
  const token = await exchangeAuthorizationCode({
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    code,
    redirectUri: oauth.redirectUri,
  });

  const resources = await fetchAccessibleResources(token.accessToken);
  const cloudId = findCloudId(resources, site.url);

  persistSiteOAuth(configPath, site.name, {
    accessToken: token.accessToken,
    ...(token.refreshToken !== undefined ? { refreshToken: token.refreshToken } : {}),
    expiresAt: token.expiresAt,
    cloudId,
  });

  ctx.ui.notify(`Signed in to ${site.url} with OAuth.`, "info");
}

function openUrl(url: string): void {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Opening a browser is best-effort; the user can copy the URL from the notification.
  }
}
