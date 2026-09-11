import { observer } from 'mobx-react-lite';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, Spinner } from '@heroui/react';
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
  accountName?: string | null;
  taskType: string;
  status: string;
  noteId: number | null;
  message: string | null;
  startedAt: string | Date;
  finishedAt: string | Date | null;
  callCount: number;
};

type TaskLogCall = {
  agent: string;
  provider?: string | null;
  modelTitle?: string | null;
  startedAt: string | Date;
  finishedAt: string | Date;
  durationMs: number;
  input: string;
  output: string;
  error?: string | null;
};

type TaskLogDetail = TaskLogRow & { calls: TaskLogCall[] };

const STATUS_STYLES: Record<string, { icon: string; color: string }> = {
  running: { icon: 'line-md:loading-twotone-loop', color: 'text-primary' },
  success: { icon: 'mingcute:check-circle-line', color: 'text-success' },
  error: { icon: 'mingcute:close-circle-line', color: 'text-danger' },
  stopped: { icon: 'mingcute:stop-circle-line', color: 'text-warning' },
};

const PAGE_SIZE = 20;

// CUSTOM-JOURNAL: one call within the detail modal -- collapsed by default
// (input/output can be long, e.g. a full note + tag list), expand to see
// the full prompt/response.
const TaskLogCallItem = ({ call }: { call: TaskLogCall }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const durationSeconds = dayjs(call.finishedAt).diff(dayjs(call.startedAt), 'second', true);

  return (
    <div className="rounded-md border border-default-200 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-2 text-left hover:bg-default-50"
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon icon={call.error ? 'mingcute:close-circle-line' : 'mingcute:check-circle-line'} width="16" height="16" className={`shrink-0 ${call.error ? 'text-danger' : 'text-success'}`} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium">{call.agent}</span>
          <span className="text-desc text-xs truncate">
            {call.modelTitle || t('unknown-model')}{call.provider ? ` · ${call.provider}` : ''}
          </span>
        </div>
        <div className="text-desc text-xs shrink-0 text-right">
          <div>{dayjs(call.startedAt).format('h:mm:ssA')}</div>
          <div>{durationSeconds.toFixed(1)}s</div>
        </div>
        <Icon icon={expanded ? 'tabler:chevron-up' : 'tabler:chevron-down'} width="16" height="16" className="shrink-0 text-desc" />
      </button>
      {expanded && (
        <div className="p-2 border-t border-default-200 space-y-2 bg-default-50">
          {call.error && (
            <div className="text-xs text-danger">{t('error')}: {call.error}</div>
          )}
          <div>
            <div className="text-xs font-medium text-desc mb-1">{t('input')}</div>
            <pre className="text-xs whitespace-pre-wrap break-words bg-background rounded p-2 max-h-[300px] overflow-y-auto">{call.input}</pre>
          </div>
          <div>
            <div className="text-xs font-medium text-desc mb-1">{t('output')}</div>
            <pre className="text-xs whitespace-pre-wrap break-words bg-background rounded p-2 max-h-[300px] overflow-y-auto">{call.output || '—'}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

// CUSTOM-JOURNAL: full detail for one task -- who ran it, every individual
// LLM call it made (destination model, timing, duration), and the full
// input/output for each. Fetched on demand (aiTaskLogGet) since a list row
// only ever carries a callCount, not the calls themselves.
const TaskLogDetailModal = ({ id, onClose }: { id: number | null; onClose: () => void }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<TaskLogDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (id == null) {
      setDetail(null);
      return;
    }
    setLoading(true);
    api.ai.aiTaskLogGet.query({ id }).then((res) => setDetail(res as any)).catch((error) => {
      console.error('Failed to fetch AI task log detail:', error);
    }).finally(() => setLoading(false));
  }, [id]);

  const totalDuration = detail?.finishedAt
    ? dayjs(detail.finishedAt).diff(dayjs(detail.startedAt), 'second', true)
    : null;

  return (
    <Modal isOpen={id != null} onClose={onClose} placement="center" scrollBehavior="inside" size="2xl">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Icon icon="hugeicons:task-01" width="20" height="20" />
          {detail ? t(`ai-task-type-${detail.taskType}`, detail.taskType) : t('loading')}
        </ModalHeader>
        <ModalBody className="pb-6">
          {loading && (
            <div className="flex justify-center py-8"><Spinner size="sm" /></div>
          )}
          {!loading && detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs text-desc">{t('who-ran-it')}</div>
                  <div>{detail.accountName || (detail.accountId != null ? `#${detail.accountId}` : t('system'))}</div>
                </div>
                <div>
                  <div className="text-xs text-desc">{t('status')}</div>
                  <div className="capitalize">{detail.status}</div>
                </div>
                <div>
                  <div className="text-xs text-desc">{t('started')}</div>
                  <div>{dayjs(detail.startedAt).format('dddd, MMM D, YYYY [at] h:mmA')}</div>
                </div>
                <div>
                  <div className="text-xs text-desc">{t('duration')}</div>
                  <div>{totalDuration != null ? `${totalDuration.toFixed(1)}s` : '—'}</div>
                </div>
                {detail.noteId != null && (
                  <div>
                    <div className="text-xs text-desc">{t('note')}</div>
                    <button className="text-primary hover:underline" onClick={() => ShowCommentDialog(detail.noteId!)}>#{detail.noteId}</button>
                  </div>
                )}
                {detail.message && (
                  <div className="col-span-2">
                    <div className="text-xs text-desc">{t('message')}</div>
                    <div>{detail.message}</div>
                  </div>
                )}
              </div>

              <div>
                <div className="text-sm font-medium mb-2">{t('calls-count', { count: detail.calls.length })}</div>
                {detail.calls.length === 0 ? (
                  <div className="text-desc text-sm">{t('no-calls-recorded')}</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {detail.calls.map((call, i) => (
                      <TaskLogCallItem key={i} call={call} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

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
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
              <button
                key={log.id}
                className="flex items-center gap-2 p-2 rounded-md bg-default-50 hover:bg-default-100 text-sm text-left w-full"
                onClick={() => setSelectedId(log.id)}
              >
                <Icon icon={style.icon} width="16" height="16" className={`shrink-0 ${style.color}`} />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t(`ai-task-type-${log.taskType}`, log.taskType)}</span>
                    {log.noteId != null && (
                      <span
                        role="button"
                        className="text-xs text-primary hover:underline"
                        onClick={(e) => { e.stopPropagation(); ShowCommentDialog(log.noteId!); }}
                      >
                        #{log.noteId}
                      </span>
                    )}
                    {log.callCount > 0 && (
                      <span className="text-xs text-desc bg-default-200 rounded-full px-2 py-0.5">
                        {t('calls-count', { count: log.callCount })}
                      </span>
                    )}
                    {scope === 'all' && log.accountName && (
                      <span className="text-xs text-desc">{log.accountName}</span>
                    )}
                  </div>
                  {log.message && <div className="text-desc text-xs truncate">{log.message}</div>}
                </div>
                <div className="text-desc text-xs shrink-0 text-right">
                  <div>{dayjs(log.startedAt).fromNow()}</div>
                  {durationSeconds != null && <div>{durationSeconds.toFixed(1)}s</div>}
                </div>
              </button>
            );
          })}
        </div>

        {hasMore && logs.length > 0 && (
          <Button size="sm" variant="flat" className="w-full" isLoading={loading} onPress={() => fetchPage(page + 1, false)}>
            {t('load-more')}
          </Button>
        )}
      </div>

      <TaskLogDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
    </CollapsibleCard>
  );
});
