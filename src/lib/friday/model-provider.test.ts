import { describe, expect, it } from "vitest";
import { resolveFridayModelConfig, validateOpenClawGatewayUrl } from "./model-provider";

describe("Friday model provider", () => {
  it("keeps the existing Zhipu provider as the default", () => {
    expect(resolveFridayModelConfig({ ZHIPU_API_KEY: "zhipu-secret" }, "friday")).toEqual({
      providerName: "zhipu",
      apiKey: "zhipu-secret",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      modelName: "glm-4-air",
    });
  });

  it("routes each allow-listed assistant through its server-configured OpenClaw agent", () => {
    const env = {
      OPENCLAW_GATEWAY_URL: "https://gateway.example.com/",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
      OPENCLAW_AGENT_FRIDAY: "main",
      OPENCLAW_AGENT_JARVIS: "jarvis",
      OPENCLAW_AGENT_LIN_MEIMEI: "lin-meimei",
    };
    expect(resolveFridayModelConfig(env, "friday").modelName).toBe("openclaw/main");
    expect(resolveFridayModelConfig(env, "jarvis").modelName).toBe("openclaw/jarvis");
    expect(resolveFridayModelConfig(env, "lin-meimei").modelName).toBe("openclaw/lin-meimei");
  });

  it("requires URL and token together", () => {
    expect(() => resolveFridayModelConfig({
      OPENCLAW_GATEWAY_URL: "https://gateway.example.com",
    }, "friday")).toThrow(/configured together/);
  });

  it("rejects insecure and local gateway URLs", () => {
    expect(() => validateOpenClawGatewayUrl("http://gateway.example.com")).toThrow(/HTTPS/);
    expect(() => validateOpenClawGatewayUrl("https://localhost:18789")).toThrow(/public DNS/);
    expect(() => validateOpenClawGatewayUrl("https://127.0.0.1:18789")).toThrow(/public DNS/);
    expect(() => validateOpenClawGatewayUrl("https://gateway.example.com?token=x")).toThrow(/query/);
  });

  it("normalizes the OpenAI-compatible API base path", () => {
    expect(validateOpenClawGatewayUrl("https://gateway.example.com/openclaw/"))
      .toBe("https://gateway.example.com/openclaw/v1");
  });

  it("does not silently accept an invalid agent ID", () => {
    expect(() => resolveFridayModelConfig({
      OPENCLAW_GATEWAY_URL: "https://gateway.example.com",
      OPENCLAW_GATEWAY_TOKEN: "secret",
      OPENCLAW_AGENT_FRIDAY: "../admin",
    }, "friday")).toThrow(/valid configured agent ID/);
  });
});
