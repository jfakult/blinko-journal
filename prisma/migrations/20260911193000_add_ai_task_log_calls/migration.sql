-- AlterTable
-- CUSTOM-JOURNAL: array of individual LLM calls a single aiTaskLog row made
-- (a "Post-Processing" task can be 2+ separate agent.generate() calls --
-- tag suggestion, mood scoring, etc.). Each element:
-- { agent, provider, modelKey, modelTitle, startedAt, finishedAt, durationMs,
--   input, output, error? }
-- Appended atomically (jsonb concatenation) as each call completes -- see
-- server/lib/aiTaskLog.ts's logAiTaskCall.
ALTER TABLE "aiTaskLog" ADD COLUMN "calls" JSONB;
