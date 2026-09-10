import { Icon } from '@/components/Common/Iconify/icons';
import { Tooltip } from '@heroui/react';
import { Note } from '@shared/lib/types';
import { BlinkoStore } from '@/store/blinkoStore';
import { useTranslation } from 'react-i18next';
import { CommentCount } from './commentButton';
import { TagList } from '@/components/Common/TagList';
import { BlinkoItem } from '.';

interface CardFooterProps {
  blinkoItem: BlinkoItem;
  blinko: BlinkoStore;
  isShareMode?: boolean;
}

export const CardFooter = ({ blinkoItem, blinko, isShareMode }: CardFooterProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <TagList tags={blinkoItem.tags as any} createdAt={blinkoItem.createdAt} updatedAt={blinkoItem.updatedAt} className="flex-1 min-w-0" />
      <RightContent blinkoItem={blinkoItem} t={t} />
    </div>
  );
};

const RightContent = ({ blinkoItem, t }: { blinkoItem: Note; t: any }) => {
  return (
    <div className="ml-auto flex items-center gap-2">
      {<CommentCount blinkoItem={blinkoItem} />}
      {blinkoItem?.metadata?.isIndexed && (
        <Tooltip content={'Indexed'} delay={1500}>
          <Icon className="!text-ignore opacity-50" icon="hugeicons:ai-beautify" width="16" height="16" />
        </Tooltip>
      )}
    </div>
  );
};
