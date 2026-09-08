# pi-jira-testmanager

Jira Cloud (REST API v3) integration for the [pi coding agent](https://pi.dev) — JQL search, issues, comments, transitions, and filters for test-management workflows.

> Status: published as a standalone, npm-installable pi package (TypeScript, loaded natively by pi — no build step).

## Installation

From npm:

```bash
pi install npm:pi-jira-testmanager
```

From git:

```bash
pi install git:github.com/Lauritz30/pi-jira-testmanager
```

For a one-off session: `pi -e npm:pi-jira-testmanager`.

## Quick Start

1. Generate an API token at https://id.atlassian.com/manage-profile/security/api-tokens.
2. Create `~/.pi/agent/pi-jira-testmanager.json` with your site, email, and API token.
3. Run `/jira-doctor` to verify configuration and connectivity.

### Example configuration

```json
{
  "defaultSite": "acme",
  "safetyLevel": "confirm",
  "sites": [
    {
      "name": "acme",
      "url": "https://acme.atlassian.net",
      "email": "you@acme.com",
      "apiToken": "your-api-token"
    }
  ]
}
```

### Multi-site

```json
{
  "defaultSite": "acme",
  "sites": [
    { "name": "acme", "url": "https://acme.atlassian.net", "email": "you@acme.com", "apiToken": "token-a" },
    { "name": "client-xyz", "url": "https://client-xyz.atlassian.net", "email": "you@client-xyz.com", "apiToken": "token-b", "safetyLevel": "readonly" }
  ]
}
```

### Mock mode

Set `"mock": true` in the config to let `jira_doctor` validate config shape without making a live request — useful for testing the extension without real credentials.

## Tools

### Read

| Tool | Description |
| --- | --- |
| `jira_doctor` | Verify configuration and connection health |
| `jira_search_issues` | Run a JQL query via the enhanced search endpoint (`/rest/api/3/search/jql`), with `expand` and pagination support |
| `jira_get_issue` | Fetch a single issue by key, with `expand` (e.g. `renderedFields`, `transitions`, `changelog`) |
| `jira_get_issue_comments` | List comments on an issue |
| `jira_get_issue_transitions` | List available workflow transitions |
| `jira_get_create_meta` | Fetch required fields/allowed values for creating an issue |
| `jira_list_filters` / `jira_get_filter` | Search and fetch saved Jira filters |

### Write (safety-gated)

| Tool | Description |
| --- | --- |
| `jira_create_issue` | Create an issue (e.g. a defect) |
| `jira_update_issue` | Update fields on an existing issue |
| `jira_transition_issue` | Move an issue through a workflow transition |
| `jira_add_comment` | Add a comment to an issue |
| `jira_create_issue` with `parentKey` | Create a subtask under the specified parent issue |
| `jira_list_issue_link_types` | List available issue relationship types |
| `jira_link_issues` | Create a relationship between two distinct issues |

Plain-text `description`/`comment` inputs are automatically converted to Atlassian Document Format (ADF).

## Commands

| Command | Description |
| --- | --- |
| `/jira-status` | Show the current connection status (site, safety level) |
| `/jira-doctor` | Check configuration, auth, and connection health |

## Prompt templates

| Template | Description |
| --- | --- |
| `/jira-uat-defects` | List all open UAT defects, ordered by priority and age |
| `/jira-triage [project]` | Triage Sev1/Sev2 defects aging more than 2 days |
| `/jira-status-report` | Generate a daily UAT status report |

## Configuration reference

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `sites` | array | — | List of `{ name, url, email, apiToken, safetyLevel? }` |
| `defaultSite` | string | first site | Default site name used when a tool call omits `site` |
| `safetyLevel` | string | `"confirm"` | Global default: `"open"`, `"confirm"`, or `"readonly"` |
| `mock` | boolean | `false` | Skip live requests in `jira_doctor` for offline testing |

### Headless write approvals

In `confirm` mode, writes without an interactive UI remain blocked unless the selected site defines a matching `headlessApprovals` rule. Rules are deny-by-default and can constrain an action by project or issue keys:

```json
{
  "sites": [{
    "name": "automation",
    "url": "https://acme.atlassian.net",
    "email": "bot@acme.com",
    "apiToken": "your-api-token",
    "headlessApprovals": [
      { "action": "jira_create_issue", "projectKey": "UAT" },
      { "action": "jira_add_comment", "issueKeys": ["UAT-123", "UAT-124"] }
    ]
  }]
}
```

`readonly` always blocks mutations, including calls that match a headless approval rule.

## Network egress and corporate proxies

This extension calls Jira Cloud directly over HTTPS; no special network config is required when outbound internet access is available.

If your environment requires an outbound HTTP(S) proxy, set `HTTPS_PROXY` (or `HTTP_PROXY`) as an environment variable. The client automatically builds an [undici](https://undici.nodejs.org/) `ProxyAgent` from it; no extra config is needed in `pi-jira-testmanager.json`. `NO_PROXY` bypass rules are not currently supported.

To rule out a proxy/firewall issue vs. a config issue, test raw connectivity first:

```bash
curl -v https://your-domain.atlassian.net/rest/api/3/myself -u you@example.com:your-api-token
```

### Safety levels

| Level | Behavior |
| --- | --- |
| `open` | No confirmation before write tools run |
| `confirm` (default) | Prompts via `ctx.ui.confirm` before create/update/transition/comment; blocked outright when no UI is available (e.g. print mode) |
| `readonly` | All write tools blocked |

Resolution order: per-site `safetyLevel` override > global config `safetyLevel` > default `"confirm"`.

## Architecture

- `src/config.ts` — load/validate `~/.pi/agent/pi-jira-testmanager.json`, site/safety-level resolution
- `src/auth.ts` — Basic Auth header construction (email + API token)
- `src/proxy.ts` — optional corporate-proxy dispatcher built from `HTTPS_PROXY`/`HTTP_PROXY`
- `src/client.ts` — fetch wrapper (JSON in/out, error normalization, 429 retry/backoff)
- `src/adf.ts` — plain text ↔ Atlassian Document Format conversion
- `src/safety.ts` — mutation confirmation/blocking gate
- `src/status.ts` — footer status label + persistent connection card
- `src/tools/{doctor,read,write,relations}.ts` — tool definitions
- `src/index.ts` — extension entry point, tool/command registration
- `prompts/` — reusable prompt templates for common UAT workflows

## Development

```bash
npm install
npm test        # node:test runner against src/*.test.ts — no live network calls
npm run check   # tsc --noEmit type-check
```

Run against a local checkout from anywhere with:

```bash
pi install /absolute/path/to/pi-jira-testmanager
# or, for a one-off session:
pi -e /absolute/path/to/pi-jira-testmanager
```

## Requirements

- Node.js 22.19+ (pi runs `.ts` extension entries natively via type stripping)
- pi coding agent
- A Jira Cloud site with an API token

## License

MIT — see [LICENSE](LICENSE).
