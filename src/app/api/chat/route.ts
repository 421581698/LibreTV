
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { searchSources, mergeSearchResults } from "@/lib/search";
import type { SearchResultItem, SourceConfig, SourceSearchOutcome } from "@/lib/types";
import { guardRequest } from "@/lib/api-guard";
import { buildFridayAssistantSystemPrompt } from "@/lib/friday/assistant-profiles";
import { resolveFridayModelConfig } from "@/lib/friday/model-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;
const MAX_KEYWORD_LENGTH = 50;
const MAX_SOURCES = 50;
const MAX_RESULTS_TO_CLIENT = 60;
const MAX_RESULTS_TO_MODEL = 10;
const MAX_TOOL_STEPS = 6;

const MODEL_NAME = "glm-4-air";
const MODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

const sourceSchema = z.object({
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048),
  detail: z.string().max(2048).optional(),
  isAdult: z.boolean().optional(),
});

const requestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
  sources: z.array(sourceSchema).max(MAX_SOURCES).default([]),
  filterAdult: z.boolean().default(true),
  language: z.enum(["zh", "en"]).default("zh"),
  assistantId: z.enum(["friday", "jarvis", "lin-meimei"]).default("friday"),
});

type SearchItem = SearchResultItem;

type SearchOutcome = SourceSearchOutcome;

type MovieDataPart = {
  searchId: string;
  keyword: string;
  totalFound: number;
  returnedCount: number;
  outcomes: SearchOutcome[];
  results: SearchItem[];
  createdAt: number;
};

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(
    request.headers.get("content-length") || 0,
  );

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("REQUEST_TOO_LARGE");
  }

  if (!request.body) {
    throw new Error("EMPTY_BODY");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      if (!value) continue;

      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("REQUEST_TOO_LARGE");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function sanitizeMessages(input: unknown[]): UIMessage[] {
  const valid: UIMessage[] = [];

  for (const raw of input.slice(-MAX_MESSAGES)) {
    if (!raw || typeof raw !== "object") continue;

    const message = raw as Record<string, unknown>;

    if (
      typeof message.id !== "string" ||
      !["user", "assistant"].includes(String(message.role)) ||
      !Array.isArray(message.parts)
    ) {
      continue;
    }

    const parts = message.parts
      .filter(
        (part): part is Record<string, unknown> =>
          !!part && typeof part === "object",
      )
      .filter((part) => {
        if (typeof part.type !== "string") return false;

        // 不接受客户端伪造的工具结果和历史数据块。
        if (part.type.startsWith("tool-")) return false;
        if (part.type.startsWith("data-")) return false;

        return (
          part.type === "text" &&
          typeof part.text === "string"
        );
      })
      .map((part) => ({
        type: "text" as const,
        text: String(part.text).slice(0, MAX_MESSAGE_CHARS),
      }));

    if (parts.length === 0) continue;

    valid.push({
      id: message.id,
      role: message.role as "user" | "assistant",
      parts,
    } as UIMessage);
  }

  return valid;
}

function cleanSourceList(input: unknown) {
  const parsed = z
    .array(sourceSchema)
    .max(MAX_SOURCES)
    .safeParse(input);

  if (!parsed.success) {
    throw new Error("INVALID_SOURCES");
  }

  const seen = new Set<string>();

  return parsed.data.filter((source) => {
    if (seen.has(source.key)) return false;
    seen.add(source.key);
    return true;
  });
}

function getMovieName(item: SearchItem) {
  return String(item.name || "未命名影片").slice(0, 200);
}

function createModelSummary(
  keyword: string,
  outcomes: SearchOutcome[],
  results: SearchItem[],
  totalFound: number,
) {
  const successful = outcomes.filter((item) => item.ok).length;
  const failed = outcomes.length - successful;

  const lines = results
    .slice(0, MAX_RESULTS_TO_MODEL)
    .map((item, index) => {
      const name = getMovieName(item);
      const source = String(
        item.sourceName || item.sourceKey || "未知来源",
      );
      const year = item.year ? `，年份：${item.year}` : "";
      const type = item.typeName ? `，类型：${item.typeName}` : "";
      const remarks = item.remarks
        ? `，备注：${String(item.remarks).slice(0, 100)}`
        : "";

      return `${index + 1}. ${name}；来源：${source}${year}${type}${remarks}`;
    });

  return [
    `搜索关键词：${keyword}`,
    `搜索源：${outcomes.length} 个，成功 ${successful} 个，失败 ${failed} 个。`,
    `符合过滤条件的结果共 ${totalFound} 条。`,
    lines.length
      ? `部分结果：\n${lines.join("\n")}`
      : "没有找到可用结果。",
    "完整影片数据由系统通过独立数据流发送给前端。",
    "不要编造影片、播放地址、清晰度或搜索结果。",
  ].join("\n");
}

function getLatestUserText(messages: UIMessage[]) {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!last) return "";

  return last.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .slice(0, MAX_MESSAGE_CHARS);
}

function makeSearchId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: Request) {
  const authError = guardRequest(request);
  if (authError) return authError;

  if (request.signal.aborted) {
    return jsonError("请求已取消", 499);
  }

  let payload: z.infer<typeof requestSchema>;

  try {
    const rawBody = await readLimitedBody(
      request,
      MAX_BODY_BYTES,
    );

    const parsedJson = JSON.parse(rawBody);
    const parsed = requestSchema.safeParse(parsedJson);

    if (!parsed.success) {
      return jsonError("请求格式不正确", 400);
    }

    payload = parsed.data;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "";

    if (message === "REQUEST_TOO_LARGE") {
      return jsonError("请求内容过大", 413);
    }

    if (message === "EMPTY_BODY") {
      return jsonError("请求内容为空", 400);
    }

    return jsonError("无法解析请求内容", 400);
  }

  let sources: z.infer<typeof sourceSchema>[];

  try {
    sources = cleanSourceList(payload.sources);
  } catch {
    return jsonError("视频源配置不合法", 400);
  }

  const messages = sanitizeMessages(payload.messages);

  if (messages.length === 0) {
    return jsonError("没有可用的聊天消息", 400);
  }

  const userText = getLatestUserText(messages);

  if (!userText.trim()) {
    return jsonError("请输入内容", 400);
  }

  let env: Record<string, unknown>;

  try {
    const context = getCloudflareContext();
    env = context.env as Record<string, unknown>;
  } catch (error) {
    console.error("[Friday] Cloudflare context unavailable:", error);
    return jsonError("服务器环境配置不可用", 500);
  }

  let model;
  try {
    const modelConfig = resolveFridayModelConfig(env, payload.assistantId);
    const provider = createOpenAICompatible({
      name: modelConfig.providerName,
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
      headers: modelConfig.headers,
    });
    model = provider(modelConfig.modelName);
  } catch (error) {
    console.error("[Friday] Model configuration invalid:", error instanceof Error ? error.message : "unknown");
    return jsonError("AI 服务配置不完整或无效，请检查服务器环境变量", 503);
  }

  const system = buildFridayAssistantSystemPrompt(
    payload.assistantId,
    payload.language,
  );

  const searchMovieTool = tool({
    description:
      "搜索 LibreTV 当前启用的视频源。仅在用户明确要求查找影视资源时调用。",
    inputSchema: z.object({
      keyword: z
        .string()
        .trim()
        .min(1)
        .max(MAX_KEYWORD_LENGTH)
        .describe("影视名称或搜索关键词"),
    }),

    execute: async ({ keyword }) => {
      if (request.signal.aborted) {
        return {
          ok: false,
          summary: "搜索已取消。",
        };
      }

      if (sources.length === 0) {
        return {
          ok: false,
          summary:
            "当前没有可用的视频源，请先在 LibreTV 中启用视频源。",
        };
      }

      try {
        const outcomes = await searchSources(
          keyword,
          sources as SourceConfig[],
          {
            filterAdult: payload.filterAdult,
            signal: request.signal,
          },
        );

        const merged = mergeSearchResults(outcomes);

        const allResults = Array.isArray(merged)
          ? merged.filter(
              (item) => item && typeof item === "object",
            )
          : [];

        const filteredResults = allResults.filter((item) => {
          if (payload.filterAdult && item.isAdult) {
            return false;
          }

          return true;
        });

        // 过滤后的真实总数，不受前端显示上限影响。
        const totalFound = filteredResults.length;

        // 仅把最多 60 条完整结果发送给前端。
        const clientResults = filteredResults.slice(
          0,
          MAX_RESULTS_TO_CLIENT,
        );

        const searchId = makeSearchId();

        const data: MovieDataPart = {
          searchId,
          keyword,
          totalFound,
          returnedCount: clientResults.length,

          outcomes: outcomes.map((outcome) => ({
            sourceKey: String(
              outcome.sourceKey || "",
            ).slice(0, 120),
            ok: Boolean(outcome.ok),
            list: [],
            error: outcome.error
              ? String(outcome.error).slice(0, 200)
              : undefined,
            timedOut: Boolean(outcome.timedOut),
            ms:
              typeof outcome.ms === "number" &&
              Number.isFinite(outcome.ms)
                ? outcome.ms
                : undefined,
          })),

          results: clientResults,
          createdAt: Date.now(),
        };

        // 暂存完整数据，等待 onStepFinish 写入 UI Data Stream。
        pendingMovieData.set(searchId, data);

        return {
          ok: true,
          searchId,
          totalFound,
          returnedCount: clientResults.length,
          summary: createModelSummary(
            keyword,
            outcomes,
            filteredResults,
            totalFound,
          ),
        };
      } catch (error) {
        if (request.signal.aborted) {
          return {
            ok: false,
            summary: "搜索已取消。",
          };
        }

        console.error(
          "[Friday] search_movie failed:",
          error,
        );

        return {
          ok: false,
          summary: "搜索过程中出现错误，请稍后重试。",
        };
      }
    },
  });

  const pendingMovieData = new Map<
    string,
    MovieDataPart
  >();

  const sentSearchIds = new Set<string>();

  const stream = createUIMessageStream({
    originalMessages: messages,

    execute: async ({ writer }) => {
      const result = streamText({
        model,
        system,
        messages: await convertToModelMessages(messages),

        tools: {
          search_movie: searchMovieTool,
        },

        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        abortSignal: request.signal,
        temperature: 0.3,
        maxOutputTokens: 1400,

        onStepFinish: async ({ toolResults }) => {
          for (const toolResult of toolResults) {
            if (toolResult.toolName !== "search_movie") {
              continue;
            }

            const output = toolResult.output as
              | {
                  ok?: boolean;
                  searchId?: string;
                }
              | undefined;

            if (
              !output?.ok ||
              !output.searchId ||
              sentSearchIds.has(output.searchId)
            ) {
              continue;
            }

            const movieData = pendingMovieData.get(
              output.searchId,
            );

            if (!movieData) {
              console.error(
                "[Friday] Movie data missing:",
                output.searchId,
              );
              continue;
            }

            // 完整影片数据在这里写入 UI Data Stream。
            writer.write({
              type: "data-movies",
              id: movieData.searchId,
              data: movieData,
            });

            sentSearchIds.add(output.searchId);
            pendingMovieData.delete(output.searchId);
          }
        },
      });

      writer.merge(
        result.toUIMessageStream({
          sendReasoning: false,
        }),
      );
    },

    onError: (error) => {
      console.error("[Friday] UI stream error:", error);

      return "Friday 暂时遇到问题，请稍后重试。";
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
