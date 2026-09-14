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

// CUSTOM-JOURNAL: surfaces a reasoning model's "thinking" content in the
// logged output, clearly separated from the actual answer -- this is
// exactly what would have made the earlier mood-scoring failure (the model
// burning its whole budget stuck in a reasoning loop over an inapplicable
// "bipolar" rule, producing no JSON at all) immediately diagnosable from
// the log instead of requiring raw Ollama server logs to spot. Two sources,
// tried in order: (1) a structured `reasoning` field some providers/SDKs
// return separately from the answer text (checked by callers, passed in
// here as-is), (2) inline <think>...</think> (or <thinking>...</thinking>)
// tags some models -- including Qwen3/3.5 over Ollama when thinking isn't
// suppressed -- emit directly inside the text itself. In the inline case,
// the thinking block is moved out of the answer and into its own section
// rather than left in place, so the "actual answer" portion reads cleanly.
export function formatOutputWithThinking(text: string, reasoning?: string | null): string {
  let clean = text ?? '';
  let thinking = reasoning?.trim() || null;
  if (!thinking) {
    const match = clean.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
    if (match) {
      thinking = match[1].trim();
      clean = (clean.slice(0, match.index) + clean.slice(match.index! + match[0].length)).trim();
    }
  }
  if (!thinking) return clean;
  return `${clean}\n\n####THINKING####\n${thinking}\n####END THINKING####`;
}

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
export async function callAgentWithLog<T extends { text: string; reasoning?: string | null }>({
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
      output: formatOutputWithThinking(result.text ?? '', (result as any)?.reasoning),
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
