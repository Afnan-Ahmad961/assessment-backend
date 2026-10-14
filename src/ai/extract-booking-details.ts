// One Gemini call per chat turn: reads the conversation and returns structured booking details,
// an intent, and a short reply. Never throws; every failure comes back as a result with telemetry
// so the caller can log it and fall back to the form.
import { ApiError, type Content, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";

import { buildExtractionSchema, type BookingExtraction } from "./booking-extraction.schema.js";
import { BOOKING_PROMPT_VERSION, buildSystemInstruction, type ExtractionContext } from "./booking-extraction.prompt.js";
import { GEMINI_MODEL, gemini, thinkingConfig } from "./gemini-client.js";

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 750;

export type ConversationMessage = { role: "USER" | "ASSISTANT"; content: string };

export type ExtractionTelemetry = {
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ExtractionResult =
  | { ok: true; extraction: BookingExtraction; telemetry: ExtractionTelemetry }
  | { ok: false; status: "INVALID_OUTPUT" | "ERROR"; error: string; rawOutput: string | null; telemetry: ExtractionTelemetry };

export async function extractBookingDetails(
  context: ExtractionContext,
  history: ConversationMessage[],
): Promise<ExtractionResult> {
  const startedAt = Date.now();
  const telemetry = (response?: GenerateContentResponse): ExtractionTelemetry => ({
    model: GEMINI_MODEL,
    promptVersion: BOOKING_PROMPT_VERSION,
    latencyMs: Date.now() - startedAt,
    inputTokens: response?.usageMetadata?.promptTokenCount ?? null,
    // Thinking tokens are billed as output, so they count here too.
    outputTokens:
      response?.usageMetadata === undefined
        ? null
        : (response.usageMetadata.candidatesTokenCount ?? 0) + (response.usageMetadata.thoughtsTokenCount ?? 0),
  });

  const [firstService, ...otherServices] = context.services.map((s) => s.name);
  if (!firstService) {
    return { ok: false, status: "ERROR", error: "No services configured", rawOutput: null, telemetry: telemetry() };
  }
  const schema = buildExtractionSchema([firstService, ...otherServices]);

  let response: GenerateContentResponse;
  try {
    response = await generateWithRetry(context, history, z.toJSONSchema(schema));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: "ERROR", error: message.slice(0, 1000), rawOutput: null, telemetry: telemetry() };
  }

  const rawOutput = response.text ?? "";
  const parsed = schema.safeParse(parseJson(rawOutput));
  if (!parsed.success) {
    return {
      ok: false,
      status: "INVALID_OUTPUT",
      error: z.prettifyError(parsed.error).slice(0, 1000),
      rawOutput,
      telemetry: telemetry(response),
    };
  }

  return { ok: true, extraction: parsed.data, telemetry: telemetry(response) };
}

/** Retries once when Gemini is overloaded or rate limited (429 / 5xx), which happens in bursts. */
async function generateWithRetry(
  context: ExtractionContext,
  history: ConversationMessage[],
  responseJsonSchema: unknown,
): Promise<GenerateContentResponse> {
  const request = () =>
    gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: toGeminiContents(history),
      config: {
        systemInstruction: buildSystemInstruction(context),
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0.2,
        maxOutputTokens: 2048,
        thinkingConfig,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    });

  try {
    return await request();
  } catch (error) {
    const retryable = error instanceof ApiError && (error.status === 429 || error.status >= 500);
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return request();
  }
}

/** Gemini expects the conversation to start with a user turn, so leading assistant messages are dropped. */
function toGeminiContents(history: ConversationMessage[]): Content[] {
  const firstUserIndex = history.findIndex((message) => message.role === "USER");
  return history.slice(Math.max(firstUserIndex, 0)).map((message) => ({
    role: message.role === "USER" ? "user" : "model",
    parts: [{ text: message.content }],
  }));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
