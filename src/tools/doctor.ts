import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveSite } from "../config.ts";
import { createJiraClient } from "../client.ts";
import { errorResult, textResult, type ToolResult } from "./shared.ts";

const parameters = Type.Object({
  site: Type.Optional(Type.String({ description: "Site name to check; defaults to defaultSite." })),
});
type Params = Static<typeof parameters>;

/** Shared by the jira_doctor tool and the /jira-doctor command. */
export async function runDoctor(params: Params): Promise<ToolResult> {
  const config = loadConfig();

  if (!config.configExists) {
    return textResult(
      `No Jira config found at ${config.configPath}. Create it with at least one entry under "sites" (see README.md).`,
      { configured: false, configPath: config.configPath },
    );
  }

  let site;
  try {
    site = resolveSite(config, params.site);
  } catch (error) {
    return errorResult((error as Error).message);
  }

  if (config.mock) {
    return textResult(
      `Mock mode enabled. Site "${site.name}" (${site.url}) resolved from config; no live Jira request made.`,
      { configured: true, mock: true, site: site.name },
    );
  }

  const client = createJiraClient(site);
  const me = await client.get("/myself");
  return textResult(`Connected to ${site.url} as ${me.displayName} <${me.emailAddress ?? "no email on profile"}>.`, {
    configured: true,
    mock: false,
    site: site.name,
    accountId: me.accountId,
    displayName: me.displayName,
  });
}

export function createDoctorTool(): ToolDefinition<any, any, any> {
  return {
    name: "jira_doctor",
    label: "Jira Doctor",
    description: "Check Jira configuration and connectivity (config file, site resolution, authentication).",
    promptSnippet: "Verify Jira configuration and connection health",
    parameters,
    async execute(_toolCallId: string, params: Params) {
      return runDoctor(params);
    },
  };
}
