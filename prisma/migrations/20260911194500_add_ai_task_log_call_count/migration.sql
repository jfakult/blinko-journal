-- AlterTable
-- CUSTOM-JOURNAL: denormalized count of aiTaskLog.calls (kept in sync
-- atomically alongside each jsonb append in server/lib/aiTaskLog.ts's
-- logAiTaskCall) so the task-log list can show "N calls" without ever
-- selecting the (potentially large, full-input/output) calls column itself.
ALTER TABLE "aiTaskLog" ADD COLUMN "callCount" INTEGER NOT NULL DEFAULT 0;
