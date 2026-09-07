import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveSite } from "../config.ts";
import { createJiraClient } from "../client.ts";
import { siteParam, textResult } from "./shared.ts";

function getSiteClient(params: { site?: string }) {
  const config = loadConfig();
  const site = resolveSite(config, params.site);
  return { config, site, client: createJiraClient(site) };
}

const searchParameters = Type.Object({
  jql: Type.String({ description: "JQL query, e.g. \"project = UAT AND statusCategory != Done\"." }),
  fields: Type.Optional(Type.Array(Type.String(), { description: "Fields to return; omit for Jira defaults." })),
  expand: Type.Optional(Type.String({ description: "Comma-separated expand values, e.g. \"names,renderedFields\"." })),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  nextPageToken: Type.Optional(Type.String({ description: "Pagination token from a previous response." })),
  site: siteParam,
});
type SearchParams = Static<typeof searchParameters>;

const getIssueParameters = Type.Object({
  key: Type.String({ description: "Issue key, e.g. UAT-123." }),
  fields: Type.Optional(Type.Array(Type.String())),
  expand: Type.Optional(Type.String({ description: "Comma-separated expand values, e.g. \"renderedFields,transitions,changelog\"." })),
  site: siteParam,
});
type GetIssueParams = Static<typeof getIssueParameters>;

const commentsParameters = Type.Object({
  key: Type.String(),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  site: siteParam,
});
type CommentsParams = Static<typeof commentsParameters>;

const transitionsParameters = Type.Object({
  key: Type.String(),
  site: siteParam,
});
type TransitionsParams = Static<typeof transitionsParameters>;

const createMetaParameters = Type.Object({
  projectKey: Type.String(),
  issueTypeNames: Type.Optional(Type.Array(Type.String())),
  site: siteParam,
});
type CreateMetaParams = Static<typeof createMetaParameters>;

const listFiltersParameters = Type.Object({
  filterName: Type.Optional(Type.String({ description: "Substring to match filter names." })),
  site: siteParam,
});
type ListFiltersParams = Static<typeof listFiltersParameters>;

const getFilterParameters = Type.Object({
  id: Type.String(),
  site: siteParam,
});
type GetFilterParams = Static<typeof getFilterParameters>;

export function createReadTools(): ToolDefinition<any, any, any>[] {
  return [
    {
      name: "jira_search_issues",
      label: "Search Issues (JQL)",
      description:
        "Search Jira issues using JQL via the enhanced search endpoint (/rest/api/3/search/jql). Supports the same expand values as jira_get_issue.",
      promptSnippet: "Search Jira issues with a JQL query",
      promptGuidelines: [
        "Use jira_search_issues to run JQL queries (including your saved filters) instead of guessing issue keys.",
      ],
      parameters: searchParameters,
      async execute(_toolCallId: string, params: SearchParams) {
        const { client } = getSiteClient(params);
        const result = await client.post("/search/jql", {
          jql: params.jql,
          fields: params.fields,
          expand: params.expand,
          maxResults: params.maxResults,
          nextPageToken: params.nextPageToken,
        });
        const summary = result.issues.map((issue: any) => `${issue.key}: ${issue.fields?.summary ?? ""}`).join("\n");
        return textResult(summary || "No issues matched.", result);
      },
    },
    {
      name: "jira_get_issue",
      label: "Get Issue",
      description:
        "Fetch a single Jira issue by key, with optional field expansion (e.g. names, renderedFields, transitions, changelog).",
      promptSnippet: "Fetch a single Jira issue by key",
      parameters: getIssueParameters,
      async execute(_toolCallId: string, params: GetIssueParams) {
        const { client } = getSiteClient(params);
        const issue = await client.get(`/issue/${encodeURIComponent(params.key)}`, {
          query: { fields: params.fields, expand: params.expand },
        });
        return textResult(`${issue.key}: ${issue.fields?.summary ?? "(no summary)"}`, issue);
      },
    },
    {
      name: "jira_get_issue_comments",
      label: "Get Issue Comments",
      description: "List comments on a Jira issue.",
      promptSnippet: "List comments on a Jira issue",
      parameters: commentsParameters,
      async execute(_toolCallId: string, params: CommentsParams) {
        const { client } = getSiteClient(params);
        const result = await client.get(`/issue/${encodeURIComponent(params.key)}/comment`, {
          query: { maxResults: params.maxResults },
        });
        return textResult(`${result.total} comment(s) on ${params.key}.`, result);
      },
    },
    {
      name: "jira_get_issue_transitions",
      label: "Get Issue Transitions",
      description:
        "List available workflow transitions for a Jira issue (needed before calling jira_transition_issue).",
      promptSnippet: "List available workflow transitions for an issue",
      parameters: transitionsParameters,
      async execute(_toolCallId: string, params: TransitionsParams) {
        const { client } = getSiteClient(params);
        const result = await client.get(`/issue/${encodeURIComponent(params.key)}/transitions`);
        const summary = result.transitions.map((t: any) => `${t.id}: ${t.name} -> ${t.to?.name}`).join("\n");
        return textResult(summary || "No transitions available.", result);
      },
    },
    {
      name: "jira_get_create_meta",
      label: "Get Create Metadata",
      description:
        "Fetch createmeta for a project/issue type (required fields, allowed values) to prepare a jira_create_issue call.",
      promptSnippet: "Fetch required fields for creating an issue in a project",
      parameters: createMetaParameters,
      async execute(_toolCallId: string, params: CreateMetaParams) {
        const { client } = getSiteClient(params);
        const result = await client.get("/issue/createmeta", {
          query: {
            projectKeys: params.projectKey,
            issuetypeNames: params.issueTypeNames,
            expand: "projects.issuetypes.fields",
          },
        });
        return textResult(JSON.stringify(result, null, 2), result);
      },
    },
    {
      name: "jira_list_filters",
      label: "List Filters",
      description: "Search saved Jira filters (e.g. your UAT dashboard filters).",
      promptSnippet: "List saved Jira filters",
      parameters: listFiltersParameters,
      async execute(_toolCallId: string, params: ListFiltersParams) {
        const { client } = getSiteClient(params);
        const result = await client.get("/filter/search", { query: { filterName: params.filterName } });
        const summary = result.values.map((f: any) => `${f.id}: ${f.name}`).join("\n");
        return textResult(summary || "No filters found.", result);
      },
    },
    {
      name: "jira_get_filter",
      label: "Get Filter",
      description: "Fetch a single saved Jira filter, including its JQL.",
      promptSnippet: "Fetch a saved Jira filter's JQL",
      parameters: getFilterParameters,
      async execute(_toolCallId: string, params: GetFilterParams) {
        const { client } = getSiteClient(params);
        const filter = await client.get(`/filter/${encodeURIComponent(params.id)}`);
        return textResult(`${filter.name}: ${filter.jql}`, filter);
      },
    },
  ];
}
