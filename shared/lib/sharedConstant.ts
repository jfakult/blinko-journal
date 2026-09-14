export const DBBAK_TASK_NAME = 'backup-database'
// CUSTOM-JOURNAL: replaces the old ARCHIVE_BLINKO_TASK_NAME ('auto-archive-blinko',
// server/jobs/archivejob.ts) -- the Archive feature was dropped entirely in favor of
// a single recycle bin, so its nightly job was repurposed into PurgeTrashJob
// (server/jobs/purgeTrashJob.ts), which permanently deletes recycled notes older
// than config.trashRetentionDays.
export const PURGE_TRASH_TASK_NAME = 'purge-trash'
export const RECOMMAND_TASK_NAME = 'follow-recommand-index'
export const VECTOR_DB_FILE_PATH = 'file:.blinko/vector/embeddings.db'