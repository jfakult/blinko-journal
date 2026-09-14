import { Icon } from '@/components/Common/Iconify/icons';
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react';
import { Note } from '@shared/lib/types';
import { BlinkoStore } from '@/store/blinkoStore';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { CommentCount } from './commentButton';
import { TagList } from '@/components/Common/TagList';
import { BlinkoItem } from '.';
import { SentimentView } from '@/components/Common/SentimentView';
import { moodAxis } from '@shared/lib/prismaZodType';
import { api } from '@/lib/trpc';

interface CardFooterProps {
  blinkoItem: BlinkoItem;
  blinko: BlinkoStore;
  isShareMode?: boolean;
}

export const CardFooter = ({ blinkoItem, blinko, isShareMode }: CardFooterProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <TagList noteId={isShareMode ? undefined : Number(blinkoItem.id)} tags={blinkoItem.tags as any} createdAt={blinkoItem.createdAt} updatedAt={blinkoItem.updatedAt} className="flex-1 min-w-0" />
      <RightContent blinkoItem={blinkoItem} t={t} />
    </div>
  );
};

const RightContent = ({ blinkoItem, t }: { blinkoItem: Note; t: any }) => {
  return (
    <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {<CommentCount blinkoItem={blinkoItem} />}
      <SentimentIcon blinkoItem={blinkoItem} />
    </div>
  );
};

// CUSTOM-JOURNAL: replaces the old "Indexed" icon (hugeicons:ai-beautify,
// purely decorative, no onClick -- "does nothing" per user report). Shown
// whenever the note has mood scores; clicking opens a centered Modal (not
// the DialogStore modal the right-click menu's "View Sentiments" uses, and
// not an anchored Popover -- an anchored popover's position is derived from
// the trigger's location, so near a screen edge (this icon sits at the
// bottom-right of every card) it could render partly off-screen with no way
// to reposition it back on-screen. Same reasoning as filterPop.tsx's
// Popover -> Modal conversion.
const SentimentIcon = ({ blinkoItem }: { blinkoItem: Note }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [axes, setAxes] = useState<moodAxis[] | null>(null);
  const moodScores = blinkoItem?.moodScores as Record<string, number> | null | undefined;

  if (!moodScores || Object.keys(moodScores).length === 0) return null;

  return (
    <>
      <div
        className="cursor-pointer"
        onClick={() => {
          setIsOpen(true);
          if (!axes) {
            api.ai.moodAxisList.query().then(setAxes).catch(() => setAxes([]));
          }
        }}
      >
        <Icon className="text-desc opacity-70 hover:opacity-100 !transition-all" icon="mdi:emoticon-outline" width="16" height="16" />
      </div>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} placement="center" size="sm">
        <ModalContent>
          <ModalHeader>{t('view-sentiments')}</ModalHeader>
          <ModalBody className="pb-6">
            {axes ? (
              <SentimentView axes={axes} moodScores={moodScores} />
            ) : (
              <div className="flex justify-center py-4"><Icon icon="line-md:loading-twotone-loop" width="20" height="20" /></div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};
