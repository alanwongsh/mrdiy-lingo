import { tokenCount, usageOrUndefined, type LlmDriver, type LlmRequest } from "@/lib/ai/driver";
import { isGemini3 } from "@/lib/ai/gemini";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: number | string };
};

/** OpenRouter's OpenAI-compatible chat API. The model id carries the vendor, such as google/… */
export class OpenRouterDriver implements LlmDriver {
  readonly id = "openrouter";
  readonly name = "OpenRouter";

  constructor(readonly model: string, readonly secret: string) {}

  async generate(request: LlmRequest) {
    const referer = process.env.APP_BASE_URL?.trim();
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret}`,
        "Content-Type": "application/json",
        "X-Title": "MR.DIY Lingo",
        ...(referer ? { "HTTP-Referer": referer } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.maxOutputTokens,
        ...(isGemini3(this.model) ? {} : { temperature: 0.2 }),
        ...(request.schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "reply", strict: false, schema: request.schema },
              },
            }
          : {}),
        ...(request.lowThinking ? { reasoning: { effort: "minimal", exclude: true } } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(300_000),
    });

    let data: ChatResponse = {};
    try {
      data = (await response.json()) as ChatResponse;
    } catch {
      data = {};
    }
    if (!response.ok || data.error) {
      const detail = data.error?.message?.trim() || response.statusText || "Request failed";
      throw new Error(`OpenRouter ${response.status}: ${detail}`);
    }

    const usage = data.usage;
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: usage
        ? usageOrUndefined({
            promptTokens: tokenCount(usage.prompt_tokens),
            outputTokens: tokenCount(usage.completion_tokens),
            totalTokens: tokenCount(usage.total_tokens),
            thoughtsTokens: tokenCount(usage.completion_tokens_details?.reasoning_tokens),
            cachedTokens: tokenCount(usage.prompt_tokens_details?.cached_tokens),
          })
        : undefined,
    };
  }
}
