-- CreateTable
-- CUSTOM-JOURNAL: append-only audit trail of background AI operations
-- (tagging, mood scoring, transcription, AI comments, embedding rebuilds,
-- tag audits) for the AI Settings "Task Log" panel. accountId nullable
-- (SET NULL on account delete) since a log row should outlive the account
-- it belonged to, matching moodAxis's FK convention.
CREATE TABLE "aiTaskLog" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER,
    "taskType" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'running',
    "noteId" INTEGER,
    "message" VARCHAR(500),
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "aiTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aiTaskLog_accountId_startedAt_idx" ON "aiTaskLog"("accountId", "startedAt");

-- AddForeignKey
ALTER TABLE "aiTaskLog" ADD CONSTRAINT "aiTaskLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
