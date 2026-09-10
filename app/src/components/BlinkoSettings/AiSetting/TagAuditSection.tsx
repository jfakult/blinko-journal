import { observer } from 'mobx-react-lite';
import { Button } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import { api } from '@/lib/trpc';
import { Item, ItemWithTooltip } from '../Item';
import { showTipsDialog } from '@/components/Common/TipsDialog';
import { ShowTagAuditProgressDialog } from '@/components/Common/TagAuditProgress';

// CUSTOM-JOURNAL: backfills AI tagging + mood scoring for notes that never
// got either (created before Post-Processing was on, or a prior run failed).
// Same start/poll/progress-dialog pattern as EmbeddingSettingsSection's
// "Force Rebuild" control, pointed at TagAuditJob/tagAudit* instead.
export const TagAuditSection = observer(function TagAuditSection() {
  const { t } = useTranslation();
  const isPc = useMediaQuery('(min-width: 768px)');

  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [auditProgress, setAuditProgress] = useState<{ percentage: number; isRunning: boolean } | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAuditProgress = async () => {
    try {
      const data = await api.ai.tagAuditProgress.query();
      if (data) {
        setAuditProgress({ percentage: data.percentage, isRunning: data.isRunning });
        if (data.isRunning && !pollingIntervalRef.current) {
          startPolling();
        } else if (!data.isRunning && pollingIntervalRef.current) {
          stopPolling();
        }
      }
    } catch (error) {
      console.error('Error fetching tag audit progress:', error);
    }
  };

  const startPolling = () => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(fetchAuditProgress, 2000);
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  useEffect(() => {
    fetchAuditProgress();
    api.ai.tagAuditPendingCount.query().then(setPendingCount).catch(() => {});
    return () => stopPolling();
  }, []);

  const handleAuditClick = async () => {
    try {
      const latestProgress = await api.ai.tagAuditProgress.query();
      if (latestProgress?.isRunning) {
        setAuditProgress({ percentage: latestProgress.percentage, isRunning: true });
        ShowTagAuditProgressDialog(true);
        startPolling();
      } else {
        showTipsDialog({
          title: t('run-tagging-audit'),
          content: t('run-tagging-audit-desc', { count: pendingCount ?? 0 }),
          onConfirm: async () => {
            ShowTagAuditProgressDialog(true);
            await api.ai.tagAuditStart.mutate({ force: true });
            setAuditProgress({ percentage: 0, isRunning: true });
            startPolling();
          },
        });
      }
    } catch (error) {
      console.error('Failed to check tag audit status:', error);
    }
  };

  return (
    <CollapsibleCard icon="mingcute:refresh-2-ai-line" title="Tagging Audit">
      <div className="space-y-4">
        <Item
          type={isPc ? 'row' : 'col'}
          leftContent={
            <div className="flex flex-col gap-1">
              <ItemWithTooltip
                content={<>{t('run-tagging-audit')}</>}
                toolTipContent={t('run-tagging-audit-tip')}
              />
              <div className="text-desc text-xs">
                {pendingCount != null ? t('untagged-entries-found', { count: pendingCount }) : t('loading')}
              </div>
            </div>
          }
          rightContent={
            <Button
              color="primary"
              variant="flat"
              startContent={
                auditProgress?.isRunning ? (
                  <div className="flex items-center gap-1">
                    <Icon icon="line-md:loading-twotone-loop" width="16" height="16" />
                    {auditProgress?.percentage || 0}%
                  </div>
                ) : (
                  <Icon icon="mingcute:tag-2-line" width="16" height="16" />
                )
              }
              onPress={handleAuditClick}
            >
              {auditProgress?.isRunning ? t('rebuild-in-progress') : t('run-tagging-audit')}
            </Button>
          }
        />
      </div>
    </CollapsibleCard>
  );
});
