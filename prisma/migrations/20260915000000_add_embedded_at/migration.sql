-- AlterTable
-- CUSTOM-JOURNAL: null = this note's content hasn't been embedded into the
-- RAG vector index yet (or is stale since its last edit/reprocess).
-- Embedding is deliberately deferred until after AI post-processing/tagging
-- completes when that's enabled -- see AiService.embedNoteWithMetadata.
ALTER TABLE "notes" ADD COLUMN "embeddedAt" TIMESTAMPTZ(6);
