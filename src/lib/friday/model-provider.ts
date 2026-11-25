import type { FridayAssistantId } from "./assistant-profiles";

export type FridayModelEnvironment = Record<string, unknown>;

export type FridayModelConfig = {
  providerName: "zhipu" | "openclaw" | "freellmapi";
  apiKey: string;
  baseURL: string;
  modelName: string;
  headers?: Record<string, string>;
};

const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ZHIPU_MODEL = "glm-4-air";
const FREELLMAPI_DEFAULT_MODEL = "auto";

const AGENT_ENV_KEYS: Record<FridayAssistantId, string> = {
  friday: "OPENCLAW_AGENT_FRIDAY",
  jarvis: "OPENCLAW_AGENT_JARVIS",
  "lin-meimei": "OPENCLAW_AGENT_LIN_MEIMEI",
};

function requiredString(env: FridayModelEnvironment, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test")
  ) return true;

  // Reject IP literals entirely. This avoids direct access to loopback,
  // RFC1918, link-local, carrier-grade NAT, and IPv6 local ranges.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return true;
  return !host.includes(".");
}

function validatePublicHttpsBaseUrl(input: string, variableName: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${variableName} must be a valid absolute URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${variableName} must use HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${variableName} must not contain credentials, query, or fragment`);
  }
  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new Error(`${variableName} must use a public DNS hostname`);
  }

  return url.toString().replace(/\/+$/, "");
}

export function validateOpenClawGatewayUrl(input: string): string {
  const base = validatePublicHttpsBaseUrl(input, "OPENCLAW_GATEWAY_URL");
  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname.endsWith("/v1") ? pathname : `${pathname}/v1`}`;
}

export function validateFreeLlmApiBaseUrl(input: string): string {
  const base = validatePublicHttpsBaseUrl(input, "FREELLMAPI_BASE_URL");
  const url = new URL(base);
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname.endsWith("/v1") ? pathname : `${pathname}/v1`}`;
}

function resolveOpenClawConfig(
  env: FridayModelEnvironment,
  assistantId: FridayAssistantId,
): FridayModelConfig | null {
  const gatewayUrl = requiredString(env, "OPENCLAW_GATEWAY_URL");
  const gatewayToken = requiredString(env, "OPENCLAW_GATEWAY_TOKEN");

  if (!gatewayUrl && !gatewayToken) return null;
  if (!gatewayUrl || !gatewayToken) {
    throw new Error("OpenClaw Gateway URL and token must be configured together");
  }

  const accessClientId = requiredString(env, "OPENCLAW_ACCESS_CLIENT_ID");
  const accessClientSecret = requiredString(env, "OPENCLAW_ACCESS_CLIENT_SECRET");
  if (!accessClientId || !accessClientSecret) {
    throw new Error("Cloudflare Access service token ID and secret are required for the Gateway ingress");
  }

  const agentEnvKey = AGENT_ENV_KEYS[assistantId];
  const agentId = requiredString(env, agentEnvKey);
  if (!agentId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(agentId)) {
    throw new Error(`${agentEnvKey} must be a valid configured agent ID`);
  }

  return {
    providerName: "openclaw",
    apiKey: gatewayToken,
    baseURL: validateOpenClawGatewayUrl(gatewayUrl),
    modelName: `openclaw/${agentId}`,
    headers: {
      "CF-Access-Client-Id": accessClientId,
      "CF-Access-Client-Secret": accessClientSecret,
    },
  };
}

function resolveFreeLlmApiConfig(env: FridayModelEnvironment): FridayModelConfig | null {
  const baseUrl = requiredString(env, "FREELLMAPI_BASE_URL");
  const apiKey = requiredString(env, "FREELLMAPI_API_KEY");

  if (!baseUrl && !apiKey) return null;
  if (!baseUrl || !apiKey) {
    throw new Error("FreeLLMAPI base URL and unified API key must be configured together");
  }

  const modelName = requiredString(env, "FREELLMAPI_MODEL") || FREELLMAPI_DEFAULT_MODEL;
  if (modelName.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(modelName)) {
    throw new Error("FREELLMAPI_MODEL must be a valid model identifier");
  }

  return {
    providerName: "freellmapi",
    apiKey,
    baseURL: validateFreeLlmApiBaseUrl(baseUrl),
    modelName,
  };
}

export function resolveFridayModelConfig(
  env: FridayModelEnvironment,
  assistantId: FridayAssistantId,
): FridayModelConfig {
  const openClawConfig = resolveOpenClawConfig(env, assistantId);
  if (openClawConfig) return openClawConfig;

  const freeLlmApiConfig = resolveFreeLlmApiConfig(env);
  if (freeLlmApiConfig) return freeLlmApiConfig;

  const zhipuKey = requiredString(env, "ZHIPU_API_KEY");
  if (!zhipuKey) {
    throw new Error("ZHIPU_API_KEY is not configured");
  }

  return {
    providerName: "zhipu",
    apiKey: zhipuKey,
    baseURL: ZHIPU_BASE_URL,
    modelName: ZHIPU_MODEL,
  };
}
