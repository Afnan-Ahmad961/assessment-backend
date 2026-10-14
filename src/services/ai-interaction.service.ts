// Records every LLM call in ai_interactions (and a summary line in the console). Logging must never
// break a chat turn, so failures here are reported and swallowed.
import type { ExtractionResult } from "../ai/extract-booking-details.js";
import type { Prisma } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";

type LogAiInteractionInput = {
  userId: string;
  sessionId: string;
  input: Prisma.InputJsonValue;
  result: ExtractionResult;
};

export async function logAiInteraction({ userId, sessionId, input, result }: LogAiInteractionInput): Promise<void> {
  const { telemetry } = result;
  const status = result.ok ? "SUCCESS" : result.status;

  logger.info(
    { sessionId, model: telemetry.model, status, latencyMs: telemetry.latencyMs, outputTokens: telemetry.outputTokens },
    "AI interaction",
  );

  try {
    await prisma.aiInteraction.create({
      data: {
        userId,
        sessionId,
        model: telemetry.model,
        promptVersion: telemetry.promptVersion,
        status,
        input,
        output: result.ok ? result.extraction : result.rawOutput === null ? undefined : { raw: result.rawOutput },
        errorMessage: result.ok ? null : result.error,
        inputTokens: telemetry.inputTokens,
        outputTokens: telemetry.outputTokens,
        latencyMs: telemetry.latencyMs,
      },
    });
  } catch (error) {
    logger.error({ err: error, sessionId }, "Failed to record AI interaction");
  }
}
