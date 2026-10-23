import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { tokenCount, usageOrUndefined, type LlmDriver, type LlmRequest } from "@/lib/ai/driver";

export function isGemini3(model: string) {
  return /^(?:google\/)?gemini-3(?:[.-]|$)/i.test(model);
}

export class GeminiDriver implements LlmDriver {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  private readonly ai: GoogleGenAI;

  constructor(readonly model: string, readonly secret: string) {
    this.ai = new GoogleGenAI({ apiKey: secret });
  }

  async generate(request: LlmRequest) {
    const gemini3 = isGemini3(this.model);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: request.prompt,
      config: {
        maxOutputTokens: request.maxOutputTokens,
        ...(request.schema
          ? { responseMimeType: "application/json", responseJsonSchema: request.schema }
          : {}),
        ...(gemini3
          ? request.lowThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
            : {}
          : {
              temperature: 0.2,
              ...(request.lowThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            }),
      },
    });
    const usage = response.usageMetadata;
    return {
      text: response.text ?? "",
      usage: usage
        ? usageOrUndefined({
            promptTokens: tokenCount(usage.promptTokenCount),
            outputTokens: tokenCount(usage.candidatesTokenCount),
            totalTokens: tokenCount(usage.totalTokenCount),
            thoughtsTokens: tokenCount(usage.thoughtsTokenCount),
            cachedTokens: tokenCount(usage.cachedContentTokenCount),
          })
        : undefined,
    };
  }
}
