# pi-jira-multiproject

Jira Cloud (REST API v3) integration for the [pi coding agent](https://pi.dev) — JQL search, issues, comments, transitions, and filters for test-management workflows.

> Status: published as a standalone, npm-installable pi package (TypeScript, loaded natively by pi — no build step).

## Installation

From npm:

```bash
pi install npm:pi-jira-multiproject
```

From git:

```bash
pi install git:github.com/Lauritz30/pi-jira-multiproject
```

For a one-off session: `pi -e npm:pi-jira-multiproject`.

## Quick Start

Pick one of the two supported sign-in methods for each site:

- **Personal access token (PAT)** — `email` + `apiToken` in the config file.
- **OAuth 2.0 (3LO)** — a browser sign-in via `/jira-login`; tokens are stored and refreshed automatically.

### PAT setup

1. Generate an API token at https://id.atlassian.com/manage-profile/security/api-tokens.
2. Create `~/.pi/agent/pi-jira-multiproject.json` with your site, email, and API token (see the examples below), or run `/jira-login` and choose PAT.
3. Run `/jira-doctor` to verify configuration and connectivity.

### OAuth setup

1. Create an OAuth 2.0 (3LO) app at https://developer.atlassian.com/console/myapps/ and add the Jira API with at least `read:jira-work` and `write:jira-work` (plus `offline_access` for refresh tokens).
2. Under **Authorization**, configure a callback URL such as `http://localhost:8765/callback` (the OAuth flow pastes the redirected URL back into pi, so any reachable callback URL works).
3. Run `/jira-login`, choose **OAuth 2.0 (3LO)**, and enter the site name, site URL, client ID, client secret, callback URL, and scopes.
4. Approve the browser prompt, paste the full callback URL back into pi, and run `/jira-doctor` to verify.

OAuth requests are sent through `https://api.atlassian.com/ex/jira/<cloudId>` with a bearer token. The cloud ID is resolved from the Atlassian accessible-resources endpoint after login, and expired access tokens are refreshed automatically using the stored refresh token.

To grant the OAuth app access to only one project, authorize it with a Jira account whose **Browse Projects** / issue permissions are limited to that project. Jira user permissions still constrain every OAuth token, regardless of the app's scopes.

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

### OAuth example configuration

```json
{
  "defaultSite": "acme",
  "sites": [
    {
      "name": "acme",
      "url": "https://acme.atlassian.net",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "redirectUri": "http://localhost:8765/callback",
        "scopes": ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"]
      }
    }
  ]
}
```

After `/jira-login`, the `oauth` object is updated with `accessToken`, `refreshToken`, `expiresAt`, and `cloudId`.

### Multi-site

```json
{
  "defaultSite": "acme",
  "sites": [
    { "name": "acme", "url": "https://acme.atlassian.net", "email": "you@acme.com", "apiToken": "token-a" },
    { "name": "client-xyz", "url": "https://client-xyz.atlassian.net", "oauth": { "clientId": "client-id", "clientSecret": "client-secret", "redirectUri": "http://localhost:8765/callback" }, "safetyLevel": "readonly" }
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
| `/jira-status` | Show the current connection status (site, auth method, safety level) |
| `/jira-doctor` | Check configuration, auth, and connection health |
| `/jira-login` | Sign in to a site with OAuth 2.0 (3LO) or a personal access token |

## Prompt templates

| Template | Description |
| --- | --- |
| `/jira-uat-defects` | List all open UAT defects, ordered by priority and age |
| `/jira-triage [project]` | Triage Sev1/Sev2 defects aging more than 2 days |
| `/jira-status-report` | Generate a daily UAT status report |

## Configuration reference

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `sites` | array | — | List of site entries. Each entry is either PAT (`name`, `url`, `email`, `apiToken`) or OAuth (`name`, `url`, `oauth`). Optional per-site fields: `safetyLevel`, `headlessApprovals` |
| `sites[].oauth` | object | — | OAuth 2.0 (3LO) settings: `{ clientId, clientSecret, redirectUri?, scopes?, accessToken?, refreshToken?, expiresAt?, cloudId? }` |
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

If your environment requires an outbound HTTP(S) proxy, set `HTTPS_PROXY` (or `HTTP_PROXY`) as an environment variable. The client automatically builds an [undici](https://undici.nodejs.org/) `ProxyAgent` from it; no extra config is needed in `pi-jira-multiproject.json`. `NO_PROXY` bypass rules are not currently supported.

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

- `src/config.ts` — load/validate `~/.pi/agent/pi-jira-multiproject.json`, site/safety-level resolution, config writes
- `src/auth.ts` — Basic and Bearer auth header construction (PAT and OAuth)
- `src/oauth.ts` — Atlassian OAuth 2.0 (3LO) authorization, token exchange/refresh, cloud ID resolution
- `src/login.ts` — interactive `/jira-login` command (OAuth or PAT)
- `src/proxy.ts` — optional corporate-proxy dispatcher built from `HTTPS_PROXY`/`HTTP_PROXY`
- `src/client.ts` — fetch wrapper (PAT/OAuth base URLs and auth, JSON in/out, error normalization, 429 retry/backoff)
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
pi install /absolute/path/to/pi-jira-multiproject
# or, for a one-off session:
pi -e /absolute/path/to/pi-jira-multiproject
```

## Requirements

- Node.js 22.19+ (pi runs `.ts` extension entries natively via type stripping)
- pi coding agent
- A Jira Cloud site with either an API token (PAT) or an OAuth 2.0 (3LO) app

## License

MIT — see [LICENSE](LICENSE).
