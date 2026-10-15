-- CreateEnum
CREATE TYPE "ai_interaction_status" AS ENUM ('SUCCESS', 'INVALID_OUTPUT', 'ERROR');

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "booking_draft" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "stalled_turns" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID,
    "user_id" UUID,
    "model" VARCHAR(100) NOT NULL,
    "prompt_version" VARCHAR(50) NOT NULL,
    "status" "ai_interaction_status" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error_message" VARCHAR(1000),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_interactions_session_id_created_at_idx" ON "ai_interactions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_interactions_created_at_idx" ON "ai_interactions"("created_at");

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_stalled_turns_check" CHECK ("stalled_turns" >= 0);

-- At most one active conversation per user. Partial index: closed sessions don't count.
CREATE UNIQUE INDEX "chat_sessions_one_active_per_user" ON "chat_sessions"("user_id") WHERE "status" = 'ACTIVE';
