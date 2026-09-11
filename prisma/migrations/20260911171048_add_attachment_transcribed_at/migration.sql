-- AlterTable
-- CUSTOM-JOURNAL: null = this attachment's transcript (if it's audio) hasn't
-- been appended to its note yet. Used to gate AI tagging until transcription
-- completes -- see AiService.transcribeAndAppend / hasPendingAudioTranscription.
ALTER TABLE "attachments" ADD COLUMN "transcribedAt" TIMESTAMPTZ(6);
