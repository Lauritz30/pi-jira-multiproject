import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveSite } from "../config.ts";
import { createJiraClient } from "../client.ts";
import { toAdfBody } from "../adf.ts";
import { guardMutation, type MutationContext } from "../safety.ts";
import { siteParam, textResult } from "./shared.ts";

function getSiteClient(params: { site?: string }) {
  const config = loadConfig();
  const site = resolveSite(config, params.site);
  return { config, site, client: createJiraClient(site) };
}

const createParameters = Type.Object({
  projectKey: Type.String({ description: "Project key, e.g. UAT." }),
  issueType: Type.String({ description: "Issue type name, e.g. Bug, Defect, Task." }),
  summary: Type.String(),
  description: Type.Optional(Type.String({ description: "Plain text; auto-converted to Atlassian Document Format." })),
  parentKey: Type.Optional(Type.String({ description: "Parent issue key when creating a subtask. Cannot be combined with fields.parent." })),
  fields: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: "Additional raw Jira fields, merged in as-is." }),
  ),
  site: siteParam,
});
type CreateParams = Static<typeof createParameters>;

const updateParameters = Type.Object({
  key: Type.String(),
  fields: Type.Record(Type.String(), Type.Unknown(), {
    description: "Fields to update, e.g. { summary, description, priority }.",
  }),
  site: siteParam,
});
type UpdateParams = Static<typeof updateParameters>;

const transitionParameters = Type.Object({
  key: Type.String(),
  transitionId: Type.String({ description: "Transition id from jira_get_issue_transitions." }),
  comment: Type.Optional(Type.String({ description: "Plain text comment to attach to the transition." })),
  site: siteParam,
});
type TransitionParams = Static<typeof transitionParameters>;

const commentParameters = Type.Object({
  key: Type.String(),
  body: Type.String({ description: "Plain text; auto-converted to Atlassian Document Format." }),
  site: siteParam,
});
type CommentParams = Static<typeof commentParameters>;

export function createWriteTools(): ToolDefinition<any, any, any>[] {
  return [
    {
      name: "jira_create_issue",
      label: "Create Issue",
      description: "Create a Jira issue (e.g. a defect). Gated by safetyLevel (default: confirm).",
      promptSnippet: "Create a new Jira issue/defect",
      parameters: createParameters,
      async execute(
        _toolCallId: string,
        params: CreateParams,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: MutationContext | undefined,
      ) {
        const { config, site, client } = getSiteClient(params);
        await guardMutation(config, site, ctx, {
          title: "Create Jira issue",
          message: `Create a ${params.issueType} in ${params.projectKey}: "${params.summary}"?`,
          action: "jira_create_issue",
          projectKey: params.projectKey,
        });

        if (params.parentKey && params.fields?.parent) {
          throw new Error('Specify either "parentKey" or "fields.parent", not both.');
        }

        const created = await client.post("/issue", {
          fields: {
            project: { key: params.projectKey },
            issuetype: { name: params.issueType },
            summary: params.summary,
            ...(params.description ? { description: toAdfBody(params.description) } : {}),
            ...(params.parentKey ? { parent: { key: params.parentKey } } : {}),
            ...params.fields,
          },
        });
        return textResult(`Created ${created.key}: ${site.url}/browse/${created.key}`, created);
      },
    },
    {
      name: "jira_update_issue",
      label: "Update Issue",
      description: "Update fields on an existing Jira issue. Gated by safetyLevel (default: confirm).",
      promptSnippet: "Update fields on an existing Jira issue",
      parameters: updateParameters,
      async execute(
        _toolCallId: string,
        params: UpdateParams,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: MutationContext | undefined,
      ) {
        const { config, site, client } = getSiteClient(params);
        await guardMutation(config, site, ctx, {
          title: "Update Jira issue",
          message: `Update ${params.key} with fields: ${Object.keys(params.fields).join(", ")}?`,
          action: "jira_update_issue",
          issueKeys: [params.key],
        });

        const fields = { ...params.fields };
        if (typeof fields.description === "string") fields.description = toAdfBody(fields.description);

        await client.put(`/issue/${encodeURIComponent(params.key)}`, { fields });
        return textResult(`Updated ${params.key}.`, { key: params.key, fields: Object.keys(fields) });
      },
    },
    {
      name: "jira_transition_issue",
      label: "Transition Issue",
      description:
        "Move a Jira issue through a workflow transition. Call jira_get_issue_transitions first to find a valid transitionId. Gated by safetyLevel (default: confirm).",
      promptSnippet: "Transition a Jira issue to a new status",
      parameters: transitionParameters,
      async execute(
        _toolCallId: string,
        params: TransitionParams,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: MutationContext | undefined,
      ) {
        const { config, site, client } = getSiteClient(params);
        await guardMutation(config, site, ctx, {
          title: "Transition Jira issue",
          message: `Transition ${params.key} using transition id ${params.transitionId}?`,
          action: "jira_transition_issue",
          issueKeys: [params.key],
        });

        await client.post(`/issue/${encodeURIComponent(params.key)}/transitions`, {
          transition: { id: params.transitionId },
          ...(params.comment ? { update: { comment: [{ add: { body: toAdfBody(params.comment) } }] } } : {}),
        });
        return textResult(`Transitioned ${params.key} (transition ${params.transitionId}).`, {
          key: params.key,
          transitionId: params.transitionId,
        });
      },
    },
    {
      name: "jira_add_comment",
      label: "Add Comment",
      description: "Add a comment to a Jira issue. Gated by safetyLevel (default: confirm).",
      promptSnippet: "Add a comment to a Jira issue",
      parameters: commentParameters,
      async execute(
        _toolCallId: string,
        params: CommentParams,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: MutationContext | undefined,
      ) {
        const { config, site, client } = getSiteClient(params);
        await guardMutation(config, site, ctx, {
          title: "Add Jira comment",
          message: `Add comment to ${params.key}: "${params.body}"?`,
          action: "jira_add_comment",
          issueKeys: [params.key],
        });

        const comment = await client.post(`/issue/${encodeURIComponent(params.key)}/comment`, {
          body: toAdfBody(params.body),
        });
        return textResult(`Added comment ${comment.id} to ${params.key}.`, comment);
      },
    },
  ];
}
