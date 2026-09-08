import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { toAdfBody } from "../adf.ts";
import { createJiraClient } from "../client.ts";
import { loadConfig, resolveSite } from "../config.ts";
import { guardMutation, type MutationContext } from "../safety.ts";
import { siteParam, textResult } from "./shared.ts";

function getSiteClient(params: { site?: string }) {
  const config = loadConfig();
  const site = resolveSite(config, params.site);
  return { config, site, client: createJiraClient(site) };
}

const linkTypeParameters = Type.Object({
  site: siteParam,
});
type LinkTypeParams = Static<typeof linkTypeParameters>;

const linkParameters = Type.Object({
  inwardIssueKey: Type.String({ description: "Issue key on the inward side of the selected link type." }),
  outwardIssueKey: Type.String({ description: "Issue key on the outward side of the selected link type." }),
  linkType: Type.String({ description: 'Link type name from jira_list_issue_link_types, e.g. "Blocks".' }),
  comment: Type.Optional(Type.String({ description: "Plain text comment added with the link." })),
  site: siteParam,
});
type LinkParams = Static<typeof linkParameters>;

export function createRelationTools(): ToolDefinition<any, any, any>[] {
  return [
    {
      name: "jira_list_issue_link_types",
      label: "List Issue Link Types",
      description: "List the issue relationship types available on the Jira site.",
      promptSnippet: "List Jira issue link types",
      parameters: linkTypeParameters,
      async execute(_toolCallId: string, params: LinkTypeParams) {
        const { client } = getSiteClient(params);
        const result = await client.get("/issueLinkType");
        const types = result.issueLinkTypes ?? [];
        return textResult(
          types.length ? types.map((type: { name: string; inward: string; outward: string }) => `${type.name}: ${type.outward} / ${type.inward}`).join("\n") : "No issue link types found.",
          result,
        );
      },
    },
    {
      name: "jira_link_issues",
      label: "Link Issues",
      description: "Create a relationship between two Jira issues. Gated by safetyLevel (default: confirm).",
      promptSnippet: "Link two Jira issues",
      parameters: linkParameters,
      async execute(
        _toolCallId: string,
        params: LinkParams,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: MutationContext | undefined,
      ) {
        if (params.inwardIssueKey === params.outwardIssueKey) {
          throw new Error("Issue links require two distinct issue keys.");
        }

        const { config, site, client } = getSiteClient(params);
        await guardMutation(config, site, ctx, {
          title: "Link Jira issues",
          message: `Create a ${params.linkType} link between ${params.outwardIssueKey} and ${params.inwardIssueKey}?`,
          action: "jira_link_issues",
          issueKeys: [params.inwardIssueKey, params.outwardIssueKey],
        });

        await client.post("/issueLink", {
          type: { name: params.linkType },
          inwardIssue: { key: params.inwardIssueKey },
          outwardIssue: { key: params.outwardIssueKey },
          ...(params.comment ? { comment: { body: toAdfBody(params.comment) } } : {}),
        });
        return textResult(`Linked ${params.outwardIssueKey} and ${params.inwardIssueKey} as ${params.linkType}.`, {
          inwardIssueKey: params.inwardIssueKey,
          outwardIssueKey: params.outwardIssueKey,
          linkType: params.linkType,
        });
      },
    },
  ];
}