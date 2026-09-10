import { BaseScheduleJob } from "./baseScheduleJob";
import { prisma } from "../prisma";
import { NotificationType } from "@shared/lib/prismaZodType";
import { CreateNotification } from "../routerTrpc/notification";
import { AiService } from "@server/aiServer";
import { syncNoteTagsFromContent } from "@server/lib/helper";

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

    try {
      this.forceStopFlag = false;
      const processedIds = new Set<number>(currentProgress.processedNoteIds || []);
      const failedIds = new Set<number>(currentProgress.failedNoteIds || []);
      const results: TagAuditResultRecord[] = [...(currentProgress.results || [])];

      const notes = await prisma.notes.findMany({
        where: { aiTaggedAt: null, isRecycle: false, id: { notIn: Array.from(processedIds) } },
        orderBy: { id: 'asc' },
      });

      const total = (currentProgress.total || 0) > 0 ? currentProgress.total : notes.length + processedIds.size;
      let current = currentProgress.current || processedIds.size;

      console.log(`[${new Date().toISOString()}] start tag audit, ${notes.length} untagged notes`);

      for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        if (this.forceStopFlag) {
          return await this.saveStoppedProgress(current, total, results, processedIds, failedIds);
        }
        const latestProgress = await this.getProgressFromCache();
        if (latestProgress && !latestProgress.isRunning) {
          return latestProgress;
        }

        const noteBatch = notes.slice(i, i + BATCH_SIZE);
        for (const note of noteBatch) {
          if (this.forceStopFlag) {
            return await this.saveStoppedProgress(current, total, results, processedIds, failedIds);
          }
          if (processedIds.has(note.id)) continue;

          try {
            const suggestedTags = await AiService.suggestTags(note.content);
            const newContent = suggestedTags.length > 0 ? `${note.content}\n${suggestedTags.join(' ')}` : note.content;
            if (newContent !== note.content) {
              await prisma.notes.update({ where: { id: note.id }, data: { content: newContent } });
            }
            await syncNoteTagsFromContent(note.id, note.accountId!, newContent);

            const moodScores = await AiService.scoreMood(note.content);

            await prisma.notes.update({
              where: { id: note.id },
              data: {
                aiTaggedAt: new Date(),
                ...(Object.keys(moodScores).length > 0 && { moodScores }),
              },
            });

            results.push({ type: 'success', content: note.content.slice(0, 30), timestamp: new Date().toISOString() });
            processedIds.add(note.id);
            current++;
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

      return finalProgress;
    } catch (error) {
      console.error("Error running tag audit:", error);
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
    await this.saveProgressToCache(stoppedProgress);
    return stoppedProgress;
  }
}
