import { observer } from 'mobx-react-lite';
import { Switch } from '@heroui/react';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { Item, ItemWithTooltip } from '../Item';

// CUSTOM-JOURNAL: the 4 cascading "AI Features" toggles, rendered first in
// AiSetting.tsx (not collapsed away, since this is the primary on/off
// control everything else in the tab depends on). Positive labels ("Use AI
// Features" rather than "Disable AI Features") so switch-on always means
// on, matching the rest of this settings UI's convention (see
// AiPostProcessingSection.tsx's isUseAiPostProcessing toggle, which this
// mirrors exactly for the update-config/Switch pattern).
export const AiFeaturesToggleSection = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);

  const [isEnableAiFeatures, setIsEnableAiFeatures] = useState(true);
  const [isUseAiPostProcessing, setIsUseAiPostProcessing] = useState(false);
  const [isUseAiTranscription, setIsUseAiTranscription] = useState(true);
  const [isShowAiChatTab, setIsShowAiChatTab] = useState(true);

  useEffect(() => {
    blinko.config.call();
  }, []);

  useEffect(() => {
    if (blinko.config.value) {
      setIsEnableAiFeatures(blinko.config.value.isEnableAiFeatures !== false);
      setIsUseAiPostProcessing(blinko.config.value.isUseAiPostProcessing || false);
      setIsUseAiTranscription(blinko.config.value.isUseAiTranscription !== false);
      setIsShowAiChatTab(blinko.config.value.isShowAiChatTab !== false);
    }
  }, [blinko.config.value]);

  const updateConfig = (key: string, value: any) => {
    PromiseCall(
      api.config.update.mutate({ key, value }),
      { autoAlert: false }
    ).then(() => {
      blinko.config.call();
    });
  };

  return (
    <CollapsibleCard icon="hugeicons:ai-brain-03" title={t('ai-features')}>
      <Item
        leftContent={
          <ItemWithTooltip
            content={<>{t('use-ai-features')}</>}
            toolTipContent={<div className="w-[280px]">{t('use-ai-features-tooltip')}</div>}
          />
        }
        rightContent={
          <Switch
            isSelected={isEnableAiFeatures}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsEnableAiFeatures(checked);
              updateConfig('isEnableAiFeatures', checked);
            }}
          />
        }
      />

      {isEnableAiFeatures && (
        <>
          <Item
            leftContent={
              <ItemWithTooltip
                content={<>{t('ai-post-processing')}</>}
                toolTipContent={<div className="w-[280px]">{t('ai-post-processing-toggle-tooltip')}</div>}
              />
            }
            rightContent={
              <Switch
                isSelected={isUseAiPostProcessing}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsUseAiPostProcessing(checked);
                  updateConfig('isUseAiPostProcessing', checked);
                }}
              />
            }
          />

          <Item
            leftContent={
              <ItemWithTooltip
                content={<>{t('ai-audio-transcription')}</>}
                toolTipContent={<div className="w-[280px]">{t('ai-audio-transcription-tooltip')}</div>}
              />
            }
            rightContent={
              <Switch
                isSelected={isUseAiTranscription}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsUseAiTranscription(checked);
                  updateConfig('isUseAiTranscription', checked);
                }}
              />
            }
          />

          <Item
            leftContent={
              <ItemWithTooltip
                content={<>{t('ai-chat-tab')}</>}
                toolTipContent={<div className="w-[280px]">{t('ai-chat-tab-tooltip')}</div>}
              />
            }
            rightContent={
              <Switch
                isSelected={isShowAiChatTab}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsShowAiChatTab(checked);
                  updateConfig('isShowAiChatTab', checked);
                }}
              />
            }
          />
        </>
      )}
    </CollapsibleCard>
  );
});
