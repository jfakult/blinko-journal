import { observer } from 'mobx-react-lite';
import { Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { api } from '@/lib/trpc';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { ShowCommentDialog } from '@/components/BlinkoCard/commentButton';

type TaskLogRow = {
  id: number;
  accountId: number | null;
  taskType: string;
  status: string;
  noteId: number | null;
  message: string | null;
  startedAt: string | Date;
  finishedAt: string | Date | null;
};

const STATUS_STYLES: Record<string, { icon: string; color: string }> = {
  running: { icon: 'line-md:loading-twotone-loop', color: 'text-primary' },
  success: { icon: 'mingcute:check-circle-line', color: 'text-success' },
  error: { icon: 'mingcute:close-circle-line', color: 'text-danger' },
  stopped: { icon: 'mingcute:stop-circle-line', color: 'text-warning' },
};

const PAGE_SIZE = 20;

// CUSTOM-JOURNAL: expandable, paginated log of background AI operations
// (tagging, mood scoring, transcription, AI comments, embedding rebuilds,
// tag audits) written by server/lib/aiTaskLog.ts. A superadmin can toggle
// between "My tasks" and "All accounts"; everyone else always sees only
// their own (enforced server-side too -- see ai.ts's aiTaskLogList).
export const AiTaskLogSection = observer(function AiTaskLogSection() {
  const { t } = useTranslation();
  const user = RootStore.Get(UserStore);
  const [logs, setLogs] = useState<TaskLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  const fetchPage = async (targetPage: number, reset: boolean) => {
    setLoading(true);
    try {
      const rows = await api.ai.aiTaskLogList.query({ page: targetPage, size: PAGE_SIZE, scope });
      setLogs((prev) => (reset ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setPage(targetPage);
    } catch (error) {
      console.error('Failed to fetch AI task log:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  return (
    <CollapsibleCard icon="hugeicons:task-01" title={t('ai-task-log')}>
      <div className="space-y-3">
        {user.isSuperAdmin && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={scope === 'mine' ? 'solid' : 'flat'}
              color={scope === 'mine' ? 'primary' : 'default'}
              onPress={() => setScope('mine')}
            >
              {t('my-tasks')}
            </Button>
            <Button
              size="sm"
              variant={scope === 'all' ? 'solid' : 'flat'}
              color={scope === 'all' ? 'primary' : 'default'}
              onPress={() => setScope('all')}
            >
              {t('all-accounts')}
            </Button>
          </div>
        )}

        {logs.length === 0 && !loading && (
          <div className="text-desc text-sm text-center py-4">{t('no-ai-tasks-found')}</div>
        )}

        <div className="flex flex-col gap-1 max-h-[500px] overflow-y-auto">
          {logs.map((log) => {
            const style = STATUS_STYLES[log.status] || STATUS_STYLES.error;
            const durationSeconds = log.finishedAt
              ? dayjs(log.finishedAt).diff(dayjs(log.startedAt), 'second', true)
              : null;
            return (
              <div key={log.id} className="flex items-center gap-2 p-2 rounded-md bg-default-50 text-sm">
                <Icon icon={style.icon} width="16" height="16" className={`shrink-0 ${style.color}`} />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t(`ai-task-type-${log.taskType}`, log.taskType)}</span>
                    {log.noteId != null && (
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => ShowCommentDialog(log.noteId!)}
                      >
                        #{log.noteId}
                      </button>
                    )}
                  </div>
                  {log.message && <div className="text-desc text-xs truncate">{log.message}</div>}
                </div>
                <div className="text-desc text-xs shrink-0 text-right">
                  <div>{dayjs(log.startedAt).fromNow()}</div>
                  {durationSeconds != null && <div>{durationSeconds.toFixed(1)}s</div>}
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && logs.length > 0 && (
          <Button size="sm" variant="flat" className="w-full" isLoading={loading} onPress={() => fetchPage(page + 1, false)}>
            {t('load-more')}
          </Button>
        )}
      </div>
    </CollapsibleCard>
  );
});
