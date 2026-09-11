import { prisma } from '../prisma';

// CUSTOM-JOURNAL: append-only log of background AI operations (tagging, mood
// scoring, transcription, AI comments, embedding rebuilds, tag audits),
// surfaced in AI Settings as a paginated task log (server/routerTrpc/ai.ts's
// aiTaskLogList, app/src/components/BlinkoSettings/AiSetting/AiTaskLogSection.tsx).
// Logging is strictly best-effort: a failure to write a log row must never
// interrupt or fail the AI operation it's describing, so every call here
// swallows its own errors.
export type AiTaskType = 'postProcess' | 'transcription' | 'aiComment' | 'tagAudit' | 'embeddingRebuild';

export async function logAiTaskStart({
  accountId,
  taskType,
  noteId,
  message,
}: {
  accountId?: number | null;
  taskType: AiTaskType;
  noteId?: number | null;
  message?: string;
}): Promise<number | null> {
  try {
    const row = await prisma.aiTaskLog.create({
      data: {
        accountId: accountId ?? null,
        taskType,
        status: 'running',
        noteId: noteId ?? null,
        message: message?.slice(0, 500),
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    console.error('Failed to write AI task log start:', error);
    return null;
  }
}

export async function logAiTaskFinish(
  logId: number | null,
  status: 'success' | 'error' | 'stopped',
  message?: string,
): Promise<void> {
  if (logId == null) return;
  try {
    await prisma.aiTaskLog.update({
      where: { id: logId },
      data: { status, message: message?.slice(0, 500), finishedAt: new Date() },
    });
  } catch (error) {
    console.error('Failed to write AI task log finish:', error);
  }
}
