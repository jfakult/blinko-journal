import { observer } from 'mobx-react-lite';
import { Switch, Select, SelectItem, Textarea, Button, Tooltip } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { Item, ItemWithTooltip } from '../Item';
import { useMediaQuery } from 'usehooks-ts';

export const AiPostProcessingSection = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const isPc = useMediaQuery('(min-width: 768px)');

  const [isUseAiPostProcessing, setIsUseAiPostProcessing] = useState(false);
  const [aiPostProcessingMode, setAiPostProcessingMode] = useState('comment');
  const [aiCommentPrompt, setAiCommentPrompt] = useState('');
  const [aiSmartEditPrompt, setAiSmartEditPrompt] = useState('');
  const [aiCustomPrompt, setAiCustomPrompt] = useState('');

  useEffect(() => {
    blinko.config.call();
  }, []);

  useEffect(() => {
    if (blinko.config.value) {
      setIsUseAiPostProcessing(blinko.config.value.isUseAiPostProcessing || false);
      setAiPostProcessingMode(blinko.config.value.aiPostProcessingMode || 'comment');
      setAiCommentPrompt(blinko.config.value.aiCommentPrompt || '');
      setAiSmartEditPrompt(blinko.config.value.aiSmartEditPrompt || '');
      setAiCustomPrompt(blinko.config.value.aiCustomPrompt || '');
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
    <CollapsibleCard icon="hugeicons:ai-innovation-01" title="AI Post Processing">
      <Item
        leftContent={
          <ItemWithTooltip
            content={<>{t('enable-ai-post-processing')}</>}
            toolTipContent={
              <div className="w-[300px] flex flex-col gap-2">
                <div>
                  {t('automatically-process-notes-after-creation-or-update')}
                </div>
                <div>
                  {t('can-generate-summaries-tags-or-perform-analysis')}
                </div>
              </div>
            }
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

      {isUseAiPostProcessing && (
        <>
          <Item
            type={isPc ? 'row' : 'col'}
            leftContent={
              <div className="flex flex-col gap-1">
                <div>{t('ai-post-processing-mode')}</div>
                <div className="text-[12px] text-default-400">{t('choose-what-to-do-with-ai-results')}</div>
              </div>
            }
            rightContent={
              <Select
                radius="lg"
                selectedKeys={[aiPostProcessingMode]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setAiPostProcessingMode(value);
                  updateConfig('aiPostProcessingMode', value);
                }}
                size="sm"
                className="w-[200px]"
              >
                <SelectItem key="comment" startContent={<Icon icon="tabler:message" />}>
                  {t('add-as-comment')}
                </SelectItem>
                <SelectItem key="tags" startContent={<Icon icon="tabler:tags" />}>
                  {t('auto-add-tags')}
                </SelectItem>
                <SelectItem key="smartEdit" startContent={<Icon icon="tabler:robot" />}>
                  {t('smart-edit')}
                </SelectItem>
                <SelectItem key="both" startContent={<Icon icon="tabler:analyze" />}>
                  {t('both')}
                </SelectItem>
                <SelectItem key="custom" startContent={<Icon icon="tabler:code" />}>
                  {t('custom')}
                </SelectItem>
              </Select>
            }
          />

          {(aiPostProcessingMode === 'comment' || aiPostProcessingMode === 'both') && (
            <Item
              type={isPc ? 'row' : 'col'}
              leftContent={
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {t('ai-post-processing-prompt')}
                    <Tooltip
                      content={
                        <div className="w-[300px] flex flex-col gap-2">
                          <div>{t('define-custom-prompt-for-ai-to-process-notes')}</div>
                        </div>
                      }
                    >
                      <Icon icon="proicons:info" width="18" height="18" />
                    </Tooltip>
                  </div>
                  <div className="text-[12px] text-default-400">{t('prompt-used-for-post-processing-notes')}</div>
                </div>
              }
              rightContent={
                <Textarea
                  radius="lg"
                  value={aiCommentPrompt || t('analyze-the-following-note-content-and-suggest-appropriate-tags-and-provide-a-brief-summary')}
                  onBlur={(e) => {
                    updateConfig('aiCommentPrompt', e.target.value);
                  }}
                  onChange={(e) => {
                    setAiCommentPrompt(e.target.value);
                  }}
                  placeholder={t('enter-custom-prompt-for-post-processing')}
                  className="w-full"
                />
              }
            />
          )}

          {/* CUSTOM-JOURNAL: the tags-prompt textarea (editing config.aiTagsPrompt)
              used to live here. Removed per explicit request -- this is a
              single-user journal, not a multi-tenant app, and the tag prompt
              is meant to be a fixed, curated instruction set (see
              prisma/seed.ts's journalTagsPrompt + forceSetConfigOnce) rather
              than something exposed for editing in the UI. The config value
              itself and server/aiServer/index.ts's suggestTags still read
              config.aiTagsPrompt normally -- this only removes the ability to
              change it from Settings; it can still be edited directly in the
              DB if ever needed. */}

          {aiPostProcessingMode === 'smartEdit' && (
            <Item
              type={isPc ? 'row' : 'col'}
              leftContent={
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {t('smart-edit-prompt')}
                    <Tooltip
                      content={
                        <div className="w-[300px] flex flex-col gap-2">
                          <div>{t('define-instructions-for-ai-to-edit-your-notes')}</div>
                        </div>
                      }
                    >
                      <Icon icon="proicons:info" width="18" height="18" />
                    </Tooltip>
                  </div>
                  <div><Button size="sm" color="warning" className="ml-2">{t('function-call-required')}</Button></div>
                </div>
              }
              rightContent={
                <Textarea
                  radius="lg"
                  value={aiSmartEditPrompt}
                  onBlur={(e) => {
                    updateConfig('aiSmartEditPrompt', e.target.value);
                  }}
                  onChange={(e) => {
                    if (!aiSmartEditPrompt) {
                      setAiSmartEditPrompt(e.target.value);
                    } else {
                      setAiSmartEditPrompt(e.target.value);
                    }
                  }}
                  className="w-full"
                />
              }
            />
          )}

          {aiPostProcessingMode === 'custom' && (
            <Item
              type={isPc ? 'row' : 'col'}
              leftContent={
                <div className="flex flex-col gap-1">
                  <div>{t('custom-ai-prompt')}</div>
                  <div className="text-[12px] text-default-400">
                    {t('available-variables')}:
                    <Button
                      size="sm"
                      variant="flat"
                      className="ml-2"
                      onPress={() => {
                        setAiCustomPrompt((prev) => (prev || '') + ' {tags}');
                      }}
                    >
                      {'{tags}'}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      className="ml-2"
                      onPress={() => {
                        setAiCustomPrompt((prev) => (prev || '') + ' {note}');
                      }}
                    >
                      {'{note}'}
                    </Button>
                  </div>
                </div>
              }
              rightContent={
                <Textarea
                  id="custom-ai-prompt"
                  radius="lg"
                  minRows={4}
                  maxRows={8}
                  value={aiCustomPrompt || 'Analyze the note content and provide feedback. Use the available tools to implement your suggestions. Available tags: {tags}'}
                  onChange={(e) => {
                    setAiCustomPrompt(e.target.value);
                  }}
                  onBlur={(e) => {
                    updateConfig('aiCustomPrompt', e.target.value);
                  }}
                  className="w-full md:w-[400px]"
                  placeholder={t('enter-custom-prompt')}
                />
              }
            />
          )}
        </>
      )}
    </CollapsibleCard>
  );
});