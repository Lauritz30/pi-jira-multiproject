/** Build the `Authorization: Basic ...` header value for Jira Cloud's email + API token auth. */
export function buildBasicAuthHeader(email: string | undefined, apiToken: string | undefined): string {
  if (!email || !apiToken) {
    throw new Error("buildBasicAuthHeader requires both email and apiToken.");
  }
  const encoded = Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}
