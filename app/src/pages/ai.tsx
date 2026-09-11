import { Button } from '@heroui/react';
import { useRef, useState, useEffect, useMemo } from 'react';
import { AiInput } from '@/components/BlinkoAi/aiInput';
import { useMediaQuery } from 'usehooks-ts';
import { motion, AnimatePresence } from 'framer-motion';
import { AiStore } from '@/store/aiStore';
import { RootStore } from '@/store';
import { cn } from '@/lib/utils';
import { observer } from 'mobx-react-lite';
import { BlinkoChatBox } from '@/components/BlinkoAi/aiChatBox';
import { Watermark } from '@hirohe/react-watermark';
import { useTheme } from 'next-themes';
import { UserStore } from '@/store/user';
import { useTranslation } from 'react-i18next';
import { BaseStore } from '@/store/baseStore';
import i18n from '@/lib/i18n';
import { useSwiper } from '@/lib/hooks';
const AIPage = observer(() => {
  const [prompt, setPrompt] = useState('');
  const isPc = useMediaQuery('(min-width: 768px)');
  const userStore = RootStore.Get(UserStore)
  const { t } = useTranslation()
  const aiStore = RootStore.Get(AiStore)
  const baseStore = RootStore.Get(BaseStore)
  const InputBoxRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const [inputHeight, setInputHeight] = useState(0);
  const isVisible = useSwiper();
  useEffect(() => {
    if (!InputBoxRef.current) return;

    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setInputHeight(entry.contentRect.height);
      }
    });

    observer.observe(InputBoxRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  const suggestionActions = [
    {
      prompt: t('ai-prompt-suggestion-mood')
    },
    {
      prompt: t('ai-prompt-suggestion-find-person')
    },
    {
      prompt: t('ai-prompt-suggestion-tag-untagged')
    },
    {
      prompt: t('ai-prompt-suggestion-archive-summary')
    }
  ]

  // CUSTOM-JOURNAL: replaces the old fixed Recall/Search/Trends button row --
  // those three prompts are folded into this pool alongside new ones focused
  // on moments/places/memories, and every load shows 3 picked at random so
  // the entry point into RAG-backed chat stays discoverable without needing
  // a taxonomy of buttons. useMemo with no deps keeps the pick stable across
  // re-renders of this mount (a fresh pick happens on the next page visit).
  const hintPromptKeys = [
    'ai-prompt-recall',
    'ai-prompt-search',
    'ai-prompt-trends',
    'ai-prompt-suggestion-mood',
    'ai-prompt-suggestion-find-person',
    'ai-prompt-suggestion-archive-summary',
    'ai-prompt-hint-europe',
    'ai-prompt-hint-laugh',
    'ai-prompt-hint-place-love',
    'ai-prompt-hint-recent-moment',
    'ai-prompt-hint-surprising',
    'ai-prompt-hint-forgotten',
  ];
  const hintPrompts = useMemo(() => {
    return [...hintPromptKeys].sort(() => Math.random() - 0.5).slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        height: isPc ? '100%' : `calc(100% - ${!isVisible ? '0px' : '60px'})`
      }}
      className={`flex flex-col items-center ${aiStore.isChatting ? 'pt-0' : 'pt-[10vh] md:pt-[20vh]'} w-full gap-4 relative  md:h-[calc(100vh_-_80px)]`}>
      {!aiStore.isChatting ? (
        <div className="flex flex-col items-center w-full">
          <motion.div
            initial={{ width: 0, scaleX: 0 }}
            animate={{ width: "auto", scaleX: 1 }}
            transition={{
              duration: 1.2,
              ease: [0.16, 0.77, 0.47, 0.97],
              scaleX: {
                type: "spring",
                stiffness: 150,
                damping: 15,
                mass: 0.5
              }
            }}
            className="text-3xl font-bold overflow-hidden whitespace-nowrap origin-left"
          >
            {t('welcome-to-blinko', { name: userStore.userInfo?.value?.nickName.toUpperCase() ?? userStore.userInfo?.value?.name.toUpperCase() })}!
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="text-desc text-sm mt-2 text-center px-4"
          >
            {t('ai-page-subtitle')}
          </motion.div>
        </div>
      ) : (
        <div className="w-full " style={{ height: `calc(100% - ${inputHeight}px)` }}>
          <BlinkoChatBox />
        </div>
      )}

      <motion.div
        ref={InputBoxRef}
        layout
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={cn(
          "flex flex-col items-center",
          isPc ? "w-[90%]" : "w-[95%]",
          aiStore.isChatting ? "absolute bottom-2" : "mt-4"
        )}
      >
        <AiInput className={aiStore.isChatting ? 'mt-0' : 'mt-2'} />

        <AnimatePresence>
          {!aiStore.isChatting && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                y: 150,
                opacity: 0,
                transition: {
                  type: "spring",
                  damping: 10,
                  stiffness: 100
                }
              }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className='flex gap-2 mt-4 flex-wrap justify-center px-4'
            >
              {hintPrompts.map((key) => (
                <Button
                  size={isPc ? 'md' : 'sm'}
                  onPress={() => {
                    aiStore.newChatWithSuggestion(t(key))
                  }}
                  className='w-fit'
                  key={key}
                  radius='full'
                  variant='flat'
                >
                  {t(key)}
                </Button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {RootStore.Get(AiStore).withTools.value && !aiStore.isChatting && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className='flex gap-2 mt-4 flex-col items-center'
            >
              {suggestionActions.map((action, index) => (
                <Button
                  size={isPc ? 'md' : 'sm'}
                  onPress={() => {
                    aiStore.newChatWithSuggestion(t(action.prompt))
                  }}
                  className='w-fit'
                  key={index}
                  radius='full'
                  variant='flat'
                >
                  {t(action.prompt)}
                </Button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
});

export default AIPage;
