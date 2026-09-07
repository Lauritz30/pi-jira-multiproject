import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveSite, type JiraConfig, type JiraSiteConfig } from "./config.ts";
import { createDoctorTool, runDoctor } from "./tools/doctor.ts";
import { createReadTools } from "./tools/read.ts";
import { createWriteTools } from "./tools/write.ts";
import { publishFooterStatus, publishConnectionCard, registerConnectionCardRenderer, type StatusUi } from "./status.ts";

export default function piJiraTestManager(pi: ExtensionAPI) {
  pi.registerTool(createDoctorTool());
  for (const tool of createReadTools()) pi.registerTool(tool);
  for (const tool of createWriteTools()) pi.registerTool(tool);

  registerConnectionCardRenderer(pi);

  function refreshStatus(ctx: StatusUi) {
    const config: JiraConfig = loadConfig();
    let site: JiraSiteConfig | undefined;
    try {
      site = resolveSite(config);
    } catch {
      site = undefined;
    }
    publishFooterStatus(ctx, config, site);
    publishConnectionCard(pi, config, site);
  }

  pi.on("session_start", async (_event, ctx) => {
    refreshStatus(ctx);
  });

  pi.registerCommand("jira-status", {
    description: "Show the current Jira connection status (site, safety level)",
    handler: async (_args, ctx) => {
      refreshStatus(ctx);
    },
  });

  pi.registerCommand("jira-doctor", {
    description: "Check Jira configuration, auth, and connection health",
    handler: async (_args, ctx) => {
      const result = await runDoctor({});
      ctx.ui.notify(result.content[0].text, result.isError ? "error" : "info");
    },
  });
}
