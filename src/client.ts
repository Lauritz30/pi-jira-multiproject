import { buildBasicAuthHeader } from "./auth.ts";
import { getProxyDispatcher } from "./proxy.ts";
import type { JiraSiteConfig } from "./config.ts";

export class JiraApiError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, { status, body }: { status?: number; body?: unknown } = {}) {
    super(message);
    this.name = "JiraApiError";
    this.status = status;
    this.body = body;
  }
}

const RETRYABLE_STATUS = 429;
const MAX_RETRIES = 2;

type Query = Record<string, unknown>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/** Minimal structural fetch — real `fetch` and test stubs both satisfy this. */
interface FetchLike {
  (url: string, init: Record<string, unknown>): Promise<ResponseLike>;
}

/** Minimal structural Response — matches the subset the client touches. */
interface ResponseLike {
  status: number;
  ok: boolean;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

function buildQueryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

function extractErrorDetail(body: unknown): string | undefined {
  const record = body as { errorMessages?: string[]; errors?: unknown } | null;
  if (record?.errorMessages?.length) return record.errorMessages.join("; ");
  if (record?.errors) return JSON.stringify(record.errors);
  return undefined;
}

function messageForStatus(status: number, statusText: string, body: unknown): string {
  const detail = extractErrorDetail(body);
  const suffix = detail ? ` ${detail}` : "";
  switch (status) {
    case 401:
      return `Jira authentication failed (401). Check the site email/apiToken in the config file.${suffix}`;
    case 403:
      return `Jira denied the request (403 Forbidden). The account may lack permission for this operation.${suffix}`;
    case 404:
      return `Jira resource not found (404).${suffix}`;
    default:
      return `Jira API request failed: ${status} ${statusText}${suffix}`;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function parseResponseBody(response: ResponseLike): Promise<unknown> {
  const text = await response.text();
  return text ? safeJsonParse(text) : undefined;
}

function resolveRetryAfterSeconds(response: ResponseLike): number {
  const parsed = Number(response.headers.get("retry-after"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

export interface JiraClient {
  baseUrl: string;
  get(path: string, options?: RequestOptions): Promise<any>;
  post(path: string, body?: unknown, options?: RequestOptions): Promise<any>;
  put(path: string, body?: unknown, options?: RequestOptions): Promise<any>;
}

interface ClientOptions {
  fetchImpl?: FetchLike;
  dispatcher?: unknown;
}

/**
 * Create a minimal fetch-based Jira Cloud REST API v3 client for one site.
 */
export function createJiraClient(site: JiraSiteConfig, { fetchImpl = fetch as unknown as FetchLike, dispatcher = getProxyDispatcher() }: ClientOptions = {}): JiraClient {
  const baseUrl = `${stripTrailingSlashes(site.url)}/rest/api/3`;
  const authHeader = buildBasicAuthHeader(site.email, site.apiToken);

  async function requestOnce(url: string, method: string, body: unknown, signal?: AbortSignal): Promise<ResponseLike> {
    return fetchImpl(url, {
      method,
      signal,
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function request(method: string, path: string, { query, body, signal }: RequestOptions = {}): Promise<any> {
    const url = `${baseUrl}${path}${buildQueryString(query)}`;

    for (let attempt = 0; ; attempt++) {
      const response = await requestOnce(url, method, body, signal);

      if (response.status === RETRYABLE_STATUS && attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, resolveRetryAfterSeconds(response) * 1000));
        continue;
      }

      if (response.status === 204) return undefined;

      const json = await parseResponseBody(response);
      if (!response.ok) {
        throw new JiraApiError(messageForStatus(response.status, response.statusText, json), {
          status: response.status,
          body: json,
        });
      }

      return json;
    }
  }

  return {
    baseUrl,
    get: (path: string, options?: RequestOptions) => request("GET", path, options),
    post: (path: string, body?: unknown, options?: RequestOptions) => request("POST", path, { ...options, body }),
    put: (path: string, body?: unknown, options?: RequestOptions) => request("PUT", path, { ...options, body }),
  };
}
