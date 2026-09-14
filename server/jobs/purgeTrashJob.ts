import { PURGE_TRASH_TASK_NAME } from "@shared/lib/sharedConstant";
import { prisma } from "../prisma";
import { adminCaller } from "../routerTrpc/_app";
import { BaseScheduleJob } from "./baseScheduleJob";

// CUSTOM-JOURNAL: replaces ArchiveJob (server/jobs/archivejob.ts, deleted) --
// the Archive feature was dropped for a single recycle bin, so its nightly
// job was repurposed: instead of auto-archiving old notes, this permanently
// deletes notes that have already sat in the recycle bin (isRecycle: true)
// for more than config.trashRetentionDays (default 30). Reuses
// notes.deleteMany via adminCaller (same tRPC procedure the UI's
// "permanently delete" and "clear recycle bin" actions call) rather than a
// raw prisma.notes.deleteMany, so tags/attachments/vectors/comments/history
// get cleaned up identically -- see deleteNotes() in server/routerTrpc/note.ts.
export class PurgeTrashJob extends BaseScheduleJob {
  protected static taskName = PURGE_TRASH_TASK_NAME;
  protected static cronSchedule = '0 4 * * *'; // Daily at 4am UTC (after tagAudit's 3am slot)

  protected static async RunTask() {
    try {
      const config = await adminCaller.config.list();
      const trashRetentionDays = config.trashRetentionDays ?? 30;
      const cutoff = new Date(Date.now() - trashRetentionDays * 24 * 60 * 60 * 1000);

      // CUSTOM-JOURNAL: updatedAt, not createdAt -- a note's "time in the
      // bin" should be measured from when it was trashed (trashMany bumps
      // updatedAt via the normal update path), not from when it was
      // originally written, which could be years earlier.
      const notes = await prisma.notes.findMany({
        where: { isRecycle: true, updatedAt: { lt: cutoff } },
        select: { id: true },
      });
      if (notes.length === 0) {
        return { purged: 0 };
      }

      await adminCaller.notes.deleteMany({ ids: notes.map((n) => n.id) });
      return { purged: notes.length };
    } catch (error: any) {
      throw new Error(error);
    }
  }
}
