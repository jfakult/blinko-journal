import { observer } from 'mobx-react-lite';
import { Button, Switch } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { api } from '@/lib/trpc';
import dayjs from '@/lib/dayjs';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { UserStore } from '@/store/user';
import { PromiseCall } from '@/store/standard/PromiseState';
import { Item, ItemWithTooltip } from '../Item';
import { ShowNotePopup } from '@/components/BlinkoCard/showNotePopup';

type RagLogRow = {
  id: number;
  accountId: number | null;
  accountName?: string | null;
  taskType: string;
  status: string;
  noteId: number | null;
  message: string | null;
  startedAt: string | Date;
  finishedAt: string | Date | null;
};

const PAGE_SIZE = 20;

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  running: { icon: 'line-md:loading-twotone-loop', color: 'text-primary' },
  success: { icon: 'mingcute:check-circle-line', color: 'text-success' },
  error: { icon: 'mingcute:close-circle-line', color: 'text-danger' },
  stopped: { icon: 'mingcute:stop-circle-line', color: 'text-warning' },
};

// CUSTOM-JOURNAL: covers the RAG (vector search) subsystem -- basic index
// stats direct from the vector store, toggles for which per-note metadata
// (dates/mood/tags) gets prepended to the text actually embedded (see
// AiService.embedNoteWithMetadata), and a history log of every embedding
// action (reusing aiTaskLog, taskType 'embedding', the same log every other
// AI action already writes to). Rendered for everyone (see AiSetting.tsx) --
// the index-wide stats and metadata toggles are still superadmin-only
// (global, shared config), but the history log itself is visible to
// non-admins too, scoped to their own notes only (mine/all toggle here
// mirrors AiTaskLogSection's, and is enforced server-side the same way:
// aiTaskLogList ignores scope:'all' from a non-superadmin).
export const RagSettingsSection = observer(function RagSettingsSection() {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const user = RootStore.Get(UserStore);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  const [info, setInfo] = useState<{ dimension: number | null; count: number | null; metric: string | null; embeddingModelTitle: string | null } | null>(null);
  // CUSTOM-JOURNAL: default true, not false -- matches the seeded default
  // (prisma/seed.ts) and the `!== false` convention used for every other AI
  // toggle in this app, so these read as "on" before config.call() resolves
  // instead of flashing off.
  const [ragIncludeDates, setRagIncludeDates] = useState(true);
  const [ragIncludeMood, setRagIncludeMood] = useState(true);
  const [ragIncludeTags, setRagIncludeTags] = useState(true);

  const [logs, setLogs] = useState<RagLogRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchInfo = () => {
    // ragInfo is superadmin-only server-side (index-wide vector store
    // stats) -- skip the call entirely for everyone else rather than firing
    // a request that's guaranteed to 403.
    if (!user.isSuperAdmin) return;
    api.ai.ragInfo.query().then(setInfo).catch((error) => console.error('Failed to fetch RAG info:', error));
  };

  const fetchPage = async (targetPage: number, reset: boolean) => {
    setLoading(true);
    try {
      const rows = await api.ai.aiTaskLogList.query({ page: targetPage, size: PAGE_SIZE, scope, taskType: 'embedding' });
      setLogs((prev) => (reset ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setPage(targetPage);
    } catch (error) {
      console.error('Failed to fetch RAG history log:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user.isSuperAdmin) {
      blinko.config.call();
      fetchInfo();
    }
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (blinko.config.value) {
      setRagIncludeDates(blinko.config.value.ragIncludeDates !== false);
      setRagIncludeMood(blinko.config.value.ragIncludeMood !== false);
      setRagIncludeTags(blinko.config.value.ragIncludeTags !== false);
    }
  }, [blinko.config.value]);

  const updateConfig = (key: string, value: any) => {
    PromiseCall(api.config.update.mutate({ key, value }), { autoAlert: false }).then(() => {
      blinko.config.call();
    });
  };

  return (
    <CollapsibleCard icon="hugeicons:database-sync" title={t('rag-settings')}>
      <div className="space-y-4">
        {user.isSuperAdmin && (
          <>
            <div>
              <div className="text-sm font-medium mb-2">{t('rag-index-info')}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div>
                  <div className="text-xs text-desc">{t('rag-vector-count')}</div>
                  <div>{info?.count ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-desc">{t('rag-dimension')}</div>
                  <div>{info?.dimension ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-desc">{t('rag-metric')}</div>
                  <div>{info?.metric ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-desc">{t('rag-embedding-model')}</div>
                  <div>{info?.embeddingModelTitle ?? t('not-configured')}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">{t('rag-metadata-toggles')}</div>
              <Item
                leftContent={<ItemWithTooltip content={<>{t('rag-include-dates')}</>} toolTipContent={t('rag-include-dates-tooltip')} />}
                rightContent={<Switch isSelected={ragIncludeDates} onChange={(e) => { setRagIncludeDates(e.target.checked); updateConfig('ragIncludeDates', e.target.checked); }} />}
              />
              <Item
                leftContent={<ItemWithTooltip content={<>{t('rag-include-mood')}</>} toolTipContent={t('rag-include-mood-tooltip')} />}
                rightContent={<Switch isSelected={ragIncludeMood} onChange={(e) => { setRagIncludeMood(e.target.checked); updateConfig('ragIncludeMood', e.target.checked); }} />}
              />
              <Item
                leftContent={<ItemWithTooltip content={<>{t('rag-include-tags')}</>} toolTipContent={t('rag-include-tags-tooltip')} />}
                rightContent={<Switch isSelected={ragIncludeTags} onChange={(e) => { setRagIncludeTags(e.target.checked); updateConfig('ragIncludeTags', e.target.checked); }} />}
              />
            </div>
          </>
        )}

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-sm font-medium">{t('rag-history-log')}</div>
            <div className="flex items-center gap-2">
              {/* CUSTOM-JOURNAL: mirrors AiTaskLogSection's mine/all toggle --
                  non-admins never see this (their own notes are the only
                  thing they could see anyway; scope:'all' from them is
                  ignored server-side in aiTaskLogList). */}
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
              <Button size="sm" variant="light" isIconOnly isLoading={loading} onPress={() => fetchPage(1, true)}>
                <Icon icon="tabler:refresh" width="18" height="18" />
              </Button>
            </div>
          </div>

          {logs.length === 0 && !loading && (
            <div className="text-desc text-sm text-center py-4">{t('no-rag-activity-yet')}</div>
          )}

          <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
            {logs.map((log) => {
              const style = STATUS_ICON[log.status] || STATUS_ICON.error;
              return (
                <div key={log.id} className="flex items-center gap-2 p-2 rounded-md bg-default-50 text-sm">
                  <Icon icon={style.icon} width="16" height="16" className={`shrink-0 ${style.color}`} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {log.noteId != null && (
                        <span
                          role="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => ShowNotePopup(log.noteId!)}
                        >
                          {t('entry')} #{log.noteId}
                        </span>
                      )}
                      {log.accountName && <span className="text-xs text-desc">{log.accountName}</span>}
                    </div>
                    {log.message && <div className="text-desc text-xs truncate">{log.message}</div>}
                  </div>
                  <div className="text-desc text-xs shrink-0">{dayjs(log.startedAt).fromNow()}</div>
                </div>
              );
            })}
          </div>

          {hasMore && logs.length > 0 && (
            <Button size="sm" variant="flat" className="w-full mt-2" isLoading={loading} onPress={() => fetchPage(page + 1, false)}>
              {t('load-more')}
            </Button>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
});
