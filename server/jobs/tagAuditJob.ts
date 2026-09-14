import { BaseScheduleJob } from "./baseScheduleJob";
import { prisma } from "../prisma";
import { NotificationType } from "@shared/lib/prismaZodType";
import { CreateNotification } from "../routerTrpc/notification";
import { AiService } from "@server/aiServer";
import { syncNoteTagsFromContent, extractHashtags } from "@server/lib/helper";
import { logAiTaskStart, logAiTaskFinish } from "@server/lib/aiTaskLog";

// CUSTOM-JOURNAL: backfills AI tagging + mood scoring for notes that never
// got either -- e.g. notes created before AI Post-Processing was turned on,
// or notes where postProcessNote's fire-and-forget call failed silently.
// Modeled directly on RebuildEmbeddingJob (same progress/cache/batch shape),
// since it's the existing precedent for a resumable, stoppable backfill job
// with no live tRPC Context to build a userCaller from.
export const TAG_AUDIT_TASK_NAME = "tagAudit";
const PROGRESS_CACHE_KEY = "tag-audit-progress";
const BATCH_SIZE = 5;

export interface TagAuditResultRecord {
  type: 'success' | 'error';
  content: string;
  error?: string;
  timestamp: string;
}

export interface TagAuditProgress {
  current: number;
  total: number;
  percentage: number;
  isRunning: boolean;
  results: TagAuditResultRecord[];
  lastUpdate: string;
  processedNoteIds: number[];
  failedNoteIds: number[];
  startTime: string;
}

export class TagAuditJob extends BaseScheduleJob {
  protected static taskName = TAG_AUDIT_TASK_NAME;
  protected static cronSchedule = '0 3 * * *';
  private static forceStopFlag = false;
  // CUSTOM-JOURNAL: id of the aiTaskLog row for the run currently in
  // RunTask -- this job is effectively single-flight (same pattern as
  // forceStopFlag above), so a static field is enough to thread it through
  // RunTask's several return points without changing every signature.
  private static currentLogId: number | null = null;

  private static async getProgressFromCache(): Promise<TagAuditProgress | null> {
    const cached = await prisma.cache.findUnique({ where: { key: PROGRESS_CACHE_KEY } });
    return cached?.value as unknown as TagAuditProgress | null;
  }

  private static async saveProgressToCache(progress: TagAuditProgress): Promise<void> {
    await prisma.cache.upsert({
      where: { key: PROGRESS_CACHE_KEY },
      update: { value: progress as any },
      create: { key: PROGRESS_CACHE_KEY, value: progress as any },
    });
  }

  static async ForceRebuild(force: boolean = true): Promise<boolean> {
    try {
      this.forceStopFlag = false;
      const existingProgress = await this.getProgressFromCache();

      if (existingProgress?.isRunning && force) {
        await this.StopRebuild();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const initialProgress: TagAuditProgress = {
        current: 0,
        total: 0,
        percentage: 0,
        isRunning: true,
        results: [],
        lastUpdate: new Date().toISOString(),
        processedNoteIds: [],
        failedNoteIds: [],
        startTime: new Date().toISOString(),
      };
      await this.saveProgressToCache(initialProgress);
      await super.TriggerNow();
      return true;
    } catch (error) {
      console.error("Failed to force tag audit:", error);
      return false;
    }
  }

  static async ResumeRebuild(): Promise<boolean> {
    try {
      const existingProgress = await this.getProgressFromCache();
      if (!existingProgress) return this.ForceRebuild(false);

      this.forceStopFlag = false;
      await this.saveProgressToCache({ ...existingProgress, isRunning: true, lastUpdate: new Date().toISOString() });
      await super.TriggerNow();
      return true;
    } catch (error) {
      console.error("Failed to resume tag audit:", error);
      return false;
    }
  }

  static async StopRebuild(): Promise<boolean> {
    try {
      this.forceStopFlag = true;
      const progress = await this.getProgressFromCache();
      if (progress) {
        progress.isRunning = false;
        await this.saveProgressToCache(progress);
      }
      return true;
    } catch (error) {
      console.error("Failed to stop tag audit:", error);
      return false;
    }
  }

  static async GetProgress(): Promise<TagAuditProgress | null> {
    return this.getProgressFromCache();
  }

  static async RetryFailedNotes(): Promise<boolean> {
    try {
      const progress = await this.getProgressFromCache();
      if (!progress) return false;

      const updatedProgress: TagAuditProgress = {
        ...progress,
        processedNoteIds: (progress.processedNoteIds || []).filter((id) => !(progress.failedNoteIds || []).includes(id)),
        failedNoteIds: [],
        isRunning: true,
      };
      await this.saveProgressToCache(updatedProgress);
      await super.TriggerNow();
      return true;
    } catch (error) {
      console.error("Failed to retry failed notes:", error);
      return false;
    }
  }

  protected static async RunTask(): Promise<any> {
    let currentProgress = await this.getProgressFromCache();
    if (!currentProgress) {
      currentProgress = {
        current: 0,
        total: 0,
        percentage: 0,
        isRunning: true,
        results: [],
        lastUpdate: new Date().toISOString(),
        processedNoteIds: [],
        failedNoteIds: [],
        startTime: new Date().toISOString(),
      };
      await this.saveProgressToCache(currentProgress);
    }

    if (!currentProgress.isRunning) {
      return currentProgress;
    }

    this.currentLogId = await logAiTaskStart({
      accountId: null,
      taskType: 'tagAudit',
      message: `Tag audit run starting (${currentProgress.current || 0}/${currentProgress.total || '?'} already done)`,
    });

    try {
      this.forceStopFlag = false;
      const processedIds = new Set<number>(currentProgress.processedNoteIds || []);
      const failedIds = new Set<number>(currentProgress.failedNoteIds || []);
      const results: TagAuditResultRecord[] = [...(currentProgress.results || [])];

      const untaggedNotes = await prisma.notes.findMany({
        where: { aiTaggedAt: null, isRecycle: false, id: { notIn: Array.from(processedIds) } },
        orderBy: { id: 'asc' },
      });

      // CUSTOM-JOURNAL: repair pass -- notes marked aiTaggedAt (so the query
      // above skips them entirely) but with zero real tag relations. Root
      // cause: postProcessNote used to hit a missing-import ReferenceError
      // inside syncNoteTagsFromContent (fixed earlier this project), but
      // aiTaggedAt still got set unconditionally afterward regardless of
      // whether tagging actually succeeded -- so these notes look "done" to
      // the query above forever, even though the AI's suggested #tags are
      // sitting right there in the content with no matching tagsToNote rows.
      // Scoped tightly to content that still has real hashtag text in it
      // (not just "zero tags," which can also be a legitimate outcome, e.g.
      // an entry the AI correctly decided needed none) so this can't misfire
      // on a genuinely-fine note. Repair just re-parses the tags already
      // sitting in the content -- no AI call, so it can't invent tags
      // different from what's visibly there, and no content/aiTaggedAt
      // mutation needed since both are already correct.
      const repairCandidates = (await prisma.notes.findMany({
        where: { aiTaggedAt: { not: null }, isRecycle: false, tags: { none: {} }, id: { notIn: Array.from(processedIds) } },
        orderBy: { id: 'asc' },
      })).filter((n) => extractHashtags(n.content).length > 0);
      const repairOnlyIds = new Set(repairCandidates.map((n) => n.id));

      const notes = [...untaggedNotes, ...repairCandidates];

      const total = (currentProgress.total || 0) > 0 ? currentProgress.total : notes.length + processedIds.size;
      let current = currentProgress.current || processedIds.size;

      console.log(`[${new Date().toISOString()}] start tag audit, ${untaggedNotes.length} untagged notes, ${repairCandidates.length} broken notes to repair`);

      for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        if (this.forceStopFlag) {
          return await this.saveStoppedProgress(current, total, results, processedIds, failedIds);
        }
        const latestProgress = await this.getProgressFromCache();
        if (latestProgress && !latestProgress.isRunning) {
          await logAiTaskFinish(this.currentLogId, 'stopped', `Stopped externally at ${current}/${total}`);
          return latestProgress;
        }

        const noteBatch = notes.slice(i, i + BATCH_SIZE);
        for (const note of noteBatch) {
          if (this.forceStopFlag) {
            return await this.saveStoppedProgress(current, total, results, processedIds, failedIds);
          }
          if (processedIds.has(note.id)) continue;

          try {
            if (repairOnlyIds.has(note.id)) {
              // CUSTOM-JOURNAL: repair path -- re-parse the hashtags already
              // sitting in this note's content and create the missing
              // tagsToNote rows. No AI call, no content/aiTaggedAt write --
              // both are already correct, only the relational sync was ever
              // missing. Falls through to the shared progress-save below
              // rather than an early `continue`, so repaired notes still
              // update current/percentage/processedIds in the cache.
              await syncNoteTagsFromContent(note.id, note.accountId!, note.content);
              results.push({ type: 'success', content: `[repair] ${note.content.slice(0, 30)}`, timestamp: new Date().toISOString() });
              processedIds.add(note.id);
              current++;
            } else {
              // CUSTOM-JOURNAL: backfill notes never reached by the live
              // create-path sequencing too -- transcribe pending audio first
              // so a voice-only entry doesn't get tagged on empty content.
              let noteContent = note.content;
              let noteUpdatedAt = note.updatedAt;
              if (await AiService.hasPendingAudioTranscription(note.id)) {
                await AiService.transcribeAndAppend({ noteId: note.id, accountId: note.accountId! });
                const refreshed = await prisma.notes.findUnique({ where: { id: note.id }, select: { content: true, updatedAt: true } });
                noteContent = refreshed?.content ?? note.content;
                noteUpdatedAt = refreshed?.updatedAt ?? note.updatedAt;
              }

              const suggestedTags = await AiService.suggestTags(noteContent, this.currentLogId);
              if (suggestedTags.length > 0) {
                // CUSTOM-JOURNAL: CAS write -- skips (self-heals next audit
                // run) rather than clobbering if the note changed underneath
                // this backfill pass. See appendTagsIfUnchanged.
                await AiService.appendTagsIfUnchanged({
                  noteId: note.id,
                  accountId: note.accountId!,
                  expectedContent: noteContent,
                  expectedUpdatedAt: noteUpdatedAt,
                  tags: suggestedTags,
                  taskLogId: this.currentLogId,
                });
              } else {
                // Defensive: pick up any manually-typed hashtags not yet synced.
                await syncNoteTagsFromContent(note.id, note.accountId!, noteContent);
              }

              const moodScores = await AiService.scoreMood(noteContent, this.currentLogId);

              // CUSTOM-JOURNAL: preserve updatedAt -- this is a background
              // backfill bookkeeping write, not a user edit.
              await prisma.notes.update({
                where: { id: note.id },
                data: {
                  aiTaggedAt: new Date(),
                  updatedAt: noteUpdatedAt,
                  ...(Object.keys(moodScores).length > 0 && { moodScores }),
                },
              });

              results.push({ type: 'success', content: noteContent.slice(0, 30), timestamp: new Date().toISOString() });
              processedIds.add(note.id);
              current++;
            }
          } catch (error: any) {
            console.error(`[${new Date().toISOString()}] error tagging note ${note.id}:`, error);
            results.push({ type: 'error', content: note.content.slice(0, 30), error: error?.toString(), timestamp: new Date().toISOString() });
            failedIds.add(note.id);
          }

          const percentage = total > 0 ? Math.floor((current / total) * 100) : 100;
          await this.saveProgressToCache({
            current, total, percentage,
            isRunning: true,
            results: results.slice(-50),
            lastUpdate: new Date().toISOString(),
            processedNoteIds: Array.from(processedIds),
            failedNoteIds: Array.from(failedIds),
            startTime: currentProgress.startTime || new Date().toISOString(),
          });
        }
      }

      const finalProgress: TagAuditProgress = {
        current, total, percentage: 100,
        isRunning: false,
        results: results.slice(-50),
        lastUpdate: new Date().toISOString(),
        processedNoteIds: Array.from(processedIds),
        failedNoteIds: Array.from(failedIds),
        startTime: currentProgress.startTime || new Date().toISOString(),
      };
      await this.saveProgressToCache(finalProgress);

      await CreateNotification({
        title: 'tag-audit-complete',
        content: 'tag-audit-complete',
        type: NotificationType.SYSTEM,
        useAdmin: true,
      });

      await logAiTaskFinish(this.currentLogId, 'success', `Tagged ${current}/${total} notes (${failedIds.size} failed)`);
      return finalProgress;
    } catch (error) {
      console.error("Error running tag audit:", error);
      await logAiTaskFinish(this.currentLogId, 'error', error?.toString());
      const errorProgress: TagAuditProgress = {
        ...currentProgress,
        isRunning: false,
        results: [
          ...(currentProgress.results || []).slice(-49),
          { type: 'error', content: 'Task failed with error', error: error?.toString(), timestamp: new Date().toISOString() },
        ],
        lastUpdate: new Date().toISOString(),
      };
      await this.saveProgressToCache(errorProgress);
      throw error;
    }
  }

  private static async saveStoppedProgress(
    current: number,
    total: number,
    results: TagAuditResultRecord[],
    processedIds: Set<number>,
    failedIds: Set<number>,
  ): Promise<TagAuditProgress> {
    const stoppedProgress: TagAuditProgress = {
      current, total,
      percentage: total > 0 ? Math.floor((current / total) * 100) : 0,
      isRunning: false,
      results: results.slice(-50),
      lastUpdate: new Date().toISOString(),
      processedNoteIds: Array.from(processedIds),
      failedNoteIds: Array.from(failedIds),
      startTime: new Date().toISOString(),
    };
    await logAiTaskFinish(this.currentLogId, 'stopped', `Stopped at ${current}/${total}`);
    await this.saveProgressToCache(stoppedProgress);
    return stoppedProgress;
  }
}
