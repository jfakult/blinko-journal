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

// CUSTOM-JOURNAL: max characters kept per input/output -- generous (an
// entry + tag list can be long), but bounded so one runaway response can't
// blow up a task log row indefinitely.
const MAX_CALL_TEXT_LENGTH = 20000;

export interface AiTaskCallRecord {
  agent: string;
  provider?: string | null;
  modelTitle?: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  input: string;
  output: string;
  error?: string | null;
}

// CUSTOM-JOURNAL: appends one call record to a task's `calls` array via
// Postgres's jsonb `||` concat, not a read-modify-write -- a task's calls
// are normally awaited sequentially so this rarely matters, but it makes a
// lost update impossible even if that ever changes. Best-effort like the
// rest of this file.
export async function logAiTaskCall(logId: number | null, call: AiTaskCallRecord): Promise<void> {
  if (logId == null) return;
  try {
    const record = {
      ...call,
      input: call.input.slice(0, MAX_CALL_TEXT_LENGTH),
      output: call.output.slice(0, MAX_CALL_TEXT_LENGTH),
    };
    await prisma.$executeRaw`
      UPDATE "aiTaskLog"
      SET "calls" = COALESCE("calls", '[]'::jsonb) || ${JSON.stringify([record])}::jsonb,
          "callCount" = "callCount" + 1
      WHERE id = ${logId}
    `;
  } catch (error) {
    console.error('Failed to write AI task log call:', error);
  }
}

// CUSTOM-JOURNAL: wraps one agent.generate() call with timing + a
// logAiTaskCall entry. Re-throws on failure (after logging the error into
// the call record) so callers keep their existing try/catch behavior --
// this only adds observability, it never swallows an error the caller
// would otherwise have seen.
export async function callAgentWithLog<T extends { text: string }>({
  taskLogId,
  agent,
  provider,
  modelTitle,
  input,
  run,
}: {
  taskLogId: number | null;
  agent: string;
  provider?: string | null;
  modelTitle?: string | null;
  input: string;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await run();
    await logAiTaskCall(taskLogId, {
      agent,
      provider,
      modelTitle,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input,
      output: result.text ?? '',
    });
    return result;
  } catch (error: any) {
    await logAiTaskCall(taskLogId, {
      agent,
      provider,
      modelTitle,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      input,
      output: '',
      error: error?.message || String(error),
    });
    throw error;
  }
}
