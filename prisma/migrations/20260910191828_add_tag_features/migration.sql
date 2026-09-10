-- AlterTable
-- CUSTOM-JOURNAL: Postgres generated column, auto-computed on every insert/update.
-- Never written to by app code -- used only to sort/paginate entries by length.
ALTER TABLE "notes" ADD COLUMN "contentLength" INTEGER GENERATED ALWAYS AS (char_length("content")) STORED;

-- AlterTable
-- CUSTOM-JOURNAL: null = this note has never had AI tagging/mood-scoring run.
ALTER TABLE "notes" ADD COLUMN "aiTaggedAt" TIMESTAMPTZ(6);

-- AlterTable
-- CUSTOM-JOURNAL: per-note mood scores, keyed by moodAxis.id (JSON keys are
-- strings), e.g. {"1": 72, "2": 40}. jsonb (not json) so it can be ordered by
-- a specific axis's value.
ALTER TABLE "notes" ADD COLUMN "moodScores" JSONB;

-- CreateTable
-- CUSTOM-JOURNAL: bipolar (both labels set) or unipolar (negativeLabel null)
-- 0-100 mood dimensions, AI-scored per note into notes.moodScores.
CREATE TABLE "moodAxis" (
    "id" SERIAL NOT NULL,
    "positiveLabel" VARCHAR NOT NULL,
    "negativeLabel" VARCHAR,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moodAxis_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "moodAxis" ADD CONSTRAINT "moodAxis_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
