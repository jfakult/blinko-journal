import { observer } from 'mobx-react-lite';
import { Button, Input, Switch } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { api } from '@/lib/trpc';
import { showTipsDialog } from '@/components/Common/TipsDialog';

interface MoodAxis {
  id: number;
  positiveLabel: string;
  negativeLabel?: string | null;
}

// CUSTOM-JOURNAL: manage the mood dimensions (emotional valence + specific
// emotions) AI scores every note against, 0-100 each -- see prisma.moodAxis
// and AiService.scoreMood. A bipolar axis has both labels (e.g.
// positive/negative); a unipolar one is intensity-only (e.g. "joy").
export const MoodAxisSection = observer(function MoodAxisSection() {
  const { t } = useTranslation();
  const [axes, setAxes] = useState<MoodAxis[]>([]);
  const [isBipolar, setIsBipolar] = useState(false);
  const [positiveLabel, setPositiveLabel] = useState('');
  const [negativeLabel, setNegativeLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = () => {
    api.ai.moodAxisList.query().then(setAxes).catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleAdd = async () => {
    if (!positiveLabel.trim()) return;
    setIsSubmitting(true);
    try {
      await api.ai.moodAxisCreate.mutate({
        positiveLabel: positiveLabel.trim(),
        negativeLabel: isBipolar && negativeLabel.trim() ? negativeLabel.trim() : null,
      });
      setPositiveLabel('');
      setNegativeLabel('');
      setIsBipolar(false);
      refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (axis: MoodAxis) => {
    showTipsDialog({
      title: t('delete-mood-axis'),
      content: t('delete-mood-axis-desc'),
      onConfirm: async () => {
        await api.ai.moodAxisDelete.mutate({ id: axis.id });
        refresh();
      },
    });
  };

  return (
    <CollapsibleCard icon="solar:emoji-funny-square-bold" title="Mood Axes">
      <div className="space-y-4">
        <div className="text-desc text-xs">{t('mood-axes-desc')}</div>

        <div className="flex flex-col gap-2">
          {axes.map(axis => (
            <div key={axis.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-default-100">
              <span className="font-medium text-sm">
                {axis.negativeLabel ? `${axis.positiveLabel} ↔ ${axis.negativeLabel}` : axis.positiveLabel}
              </span>
              <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => handleDelete(axis)}>
                <Icon icon="mingcute:delete-2-line" width="16" height="16" />
              </Button>
            </div>
          ))}
          {axes.length === 0 && <div className="text-desc text-xs">{t('no-mood-axes-yet')}</div>}
        </div>

        <div className="flex flex-col gap-2 border-t border-default-200 pt-3">
          <div className="flex items-center gap-2">
            <Switch size="sm" isSelected={isBipolar} onValueChange={setIsBipolar} />
            <span className="text-sm">{t('bipolar-axis')}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              size="sm"
              placeholder={isBipolar ? t('positive-label-placeholder') : t('emotion-label-placeholder')}
              value={positiveLabel}
              onValueChange={setPositiveLabel}
            />
            {isBipolar && (
              <Input
                size="sm"
                placeholder={t('negative-label-placeholder')}
                value={negativeLabel}
                onValueChange={setNegativeLabel}
              />
            )}
            <Button
              size="sm"
              color="primary"
              isDisabled={!positiveLabel.trim() || isSubmitting}
              onPress={handleAdd}
              startContent={<Icon icon="mingcute:add-line" width="16" height="16" />}
            >
              {t('add-mood-axis')}
            </Button>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
});
