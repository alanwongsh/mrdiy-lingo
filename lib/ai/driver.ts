export type LlmUsage = {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
  cachedTokens?: number;
};

export type LlmRequest = {
  prompt: string;
  /** JSON Schema for the reply. Without one the model answers in plain text. */
  schema?: Record<string, unknown>;
  maxOutputTokens: number;
  /** Ask for the least thinking the model allows. Callers retry without it if the model refuses. */
  lowThinking: boolean;
};

export type LlmReply = {
  text: string;
  usage?: LlmUsage;
};

/** One text model API. Translation and quality review build their prompts on top of this. */
export interface LlmDriver {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  /** Redacted from error messages and logs. */
  readonly secret: string;
  generate(request: LlmRequest): Promise<LlmReply>;
}

export function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function usageOrUndefined(tokens: LlmUsage) {
  return Object.values(tokens).some((count) => count !== undefined) ? tokens : undefined;
}

/** The error a model gives when it does not accept the thinking setting. */
export function isThinkingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /thinking|reasoning|invalid argument/i.test(message);
}
