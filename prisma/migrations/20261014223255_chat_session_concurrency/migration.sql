-- DropIndex
DROP INDEX "appointments_chat_session_id_idx";

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "appointments_chat_session_id_key" ON "appointments"("chat_session_id");

