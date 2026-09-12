import { observer } from 'mobx-react-lite';
import { Textarea } from '@heroui/react';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';

// CUSTOM-JOURNAL: the starter/hint prompts shown (3 picked at random) on the
// AI tab when not chatting -- previously a hardcoded array of i18n keys in
// app/src/pages/ai.tsx, moved to a DB-backed config value (one prompt per
// line) so they're editable here without a code change or redeploy. Mirrors
// GlobalPromptSection's single-textarea pattern.
export const AiHintPromptsSection = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const [hintPrompts, setHintPrompts] = useState('');

  useEffect(() => {
    blinko.config.call();
  }, []);

  useEffect(() => {
    setHintPrompts(blinko.config.value?.aiHintPrompts || '');
  }, [blinko.config.value?.aiHintPrompts]);

  const handleBlur = () => {
    PromiseCall(
      api.config.update.mutate({
        key: 'aiHintPrompts',
        value: hintPrompts,
      }),
      { autoAlert: false }
    );
  };

  return (
    <CollapsibleCard icon="mingcute:magic-2-line" title={t('ai-hint-prompts')}>
      <div className="space-y-4">
        <div className="flex flex-col gap-2">
          <div className="font-medium">{t('ai-hint-prompts')}</div>
          <div className="text-[12px] text-default-400">{t('ai-hint-prompts-description')}</div>
        </div>

        <Textarea
          radius="lg"
          minRows={6}
          maxRows={16}
          value={hintPrompts}
          onChange={(e) => setHintPrompts(e.target.value)}
          onBlur={handleBlur}
          placeholder="What happened when I was in Europe?&#10;When was the last time I laughed so hard I cried?"
          className="w-full"
        />
      </div>
    </CollapsibleCard>
  );
});
