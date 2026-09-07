import { ProxyAgent, type Dispatcher } from "undici";

/**
 * Build an undici dispatcher from HTTPS_PROXY/HTTP_PROXY env vars, so requests work
 * from inside a Docker container behind a corporate egress proxy. Returns undefined
 * when no proxy is configured, in which case fetch uses its normal direct dispatcher.
 */
export function getProxyDispatcher(env: NodeJS.ProcessEnv = process.env): Dispatcher | undefined {
  const proxyUrl = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}
