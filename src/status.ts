import { Box, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveSafetyLevel, type JiraConfig, type JiraSiteConfig } from "./config.ts";

const ENTRY_TYPE = "pi-jira-multiproject:connection";

/** Data persisted on the connection card entry (TUI-only, never sent to the LLM). */
export interface ConnectionCardData {
  configured: boolean;
  site?: string;
  url?: string;
  email?: string;
  safetyLevel?: string;
  configPath: string;
}

/** Minimal structural view of the session/command context used for footer status. */
export interface StatusUi {
  ui: {
    setStatus(key: string, text: string | undefined): void;
  };
}

/** Compact footer status label, e.g. "✓ Jira · my-site (confirm)". */
export function buildFooterLabel(config: JiraConfig, site: JiraSiteConfig | undefined): string {
  if (!site) return "Jira · not configured";
  const safetyLevel = resolveSafetyLevel(config, site);
  return `✓ Jira · ${site.name} (${safetyLevel})`;
}

/** Publish/refresh the footer status label for the active site. */
export function publishFooterStatus(ctx: StatusUi, config: JiraConfig, site: JiraSiteConfig | undefined): void {
  ctx.ui.setStatus("pi-jira-multiproject", buildFooterLabel(config, site));
}

/** Append a persistent connection card entry to the transcript (TUI-only, not sent to the LLM). */
export function publishConnectionCard(pi: ExtensionAPI, config: JiraConfig, site: JiraSiteConfig | undefined): void {
  pi.appendEntry<ConnectionCardData>(ENTRY_TYPE, {
    configured: Boolean(site),
    site: site?.name,
    url: site?.url,
    email: site?.email,
    safetyLevel: site ? resolveSafetyLevel(config, site) : undefined,
    configPath: config.configPath,
  });
}

/** Register the TUI renderer for the connection card entry created by publishConnectionCard(). */
export function registerConnectionCardRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<ConnectionCardData>(ENTRY_TYPE, (entry) => {
    const data = entry.data;
    const box = new Box(1, 1);
    if (!data?.configured) {
      box.addChild(new Text(`Jira: not configured${data ? ` (see ${data.configPath})` : ""}`));
      return box;
    }
    box.addChild(new Text(`Jira · ${data.site ?? "?"} · ${data.email ?? "?"} · safetyLevel=${data.safetyLevel ?? "?"}`));
    box.addChild(new Text(data.url ?? ""));
    return box;
  });
}
