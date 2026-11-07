import type { FridayAssistantId } from "./assistant-profiles";

export type FridayModelEnvironment = Record<string, unknown>;

export type FridayModelConfig = {
  providerName: "zhipu" | "openclaw";
  apiKey: string;
  baseURL: string;
  modelName: string;
};

const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ZHIPU_MODEL = "glm-4-air";

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

export function validateOpenClawGatewayUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("OPENCLAW_GATEWAY_URL must be a valid absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("OPENCLAW_GATEWAY_URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OPENCLAW_GATEWAY_URL must not contain credentials, query, or fragment");
  }
  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new Error("OPENCLAW_GATEWAY_URL must use a public DNS hostname");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}/v1`;
}

export function resolveFridayModelConfig(
  env: FridayModelEnvironment,
  assistantId: FridayAssistantId,
): FridayModelConfig {
  const gatewayUrl = requiredString(env, "OPENCLAW_GATEWAY_URL");
  const gatewayToken = requiredString(env, "OPENCLAW_GATEWAY_TOKEN");

  if (gatewayUrl || gatewayToken) {
    if (!gatewayUrl || !gatewayToken) {
      throw new Error("OpenClaw Gateway URL and token must be configured together");
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
    };
  }

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
