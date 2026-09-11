import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react';
import { helper } from '@/lib/helper';
import { RootStore } from '@/store/root';
import { useNavigate } from 'react-router-dom';
import { BlinkoStore } from '@/store/blinkoStore';
import { useTranslation } from 'react-i18next';
import { observer } from 'mobx-react-lite';
import dayjs from '@/lib/dayjs';
import { api } from '@/lib/trpc';
import { TagPicker } from '@/components/Common/TagPicker';

interface TagListProps {
  noteId?: number;
  tags?: { tag: { id: number; name: string; parent: number } }[];
  maxVisible?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  className?: string;
}

// CUSTOM-JOURNAL: shared tag-chip renderer for note cards -- extracted from
// cardBlogBox.tsx (which used to be the only place tags showed on a card) so
// every card, not just long "blog mode" ones, can show its tags. Also the
// "+tag" affordance to attach a tag to this specific entry (noteId required
// for that -- without it, e.g. in a read-only/share context, it just shows
// the existing tags with no add control).
export const TagList = observer(({ noteId, tags, maxVisible = 3, createdAt, updatedAt, className = '' }: TagListProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);

  const tagTree = helper.buildHashTagTreeFromDb((tags || []).map(item => item.tag));
  const tagPaths = tagTree.flatMap(node => helper.generateTagPaths(node));
  const uniquePaths = tagPaths.filter(path => {
    return !tagPaths.some(otherPath => otherPath !== path && otherPath.startsWith(path + '/'));
  });

  if (uniquePaths.length === 0 && !noteId) return null;

  const visiblePaths = uniquePaths.slice(0, maxVisible);
  const overflowPaths = uniquePaths.slice(maxVisible);

  const goToTag = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/?path=all&searchText=${encodeURIComponent('#' + path)}`);
    blinko.forceQuery++;
  };

  const attach = (path: string) => {
    if (!noteId) return;
    api.tags.attachToNote.mutate({ noteId, tagPath: path }).then(() => blinko.forceQuery++);
  };

  const detach = (path: string) => {
    if (!noteId) return;
    api.tags.detachFromNote.mutate({ noteId, tagPath: path }).then(() => blinko.forceQuery++);
  };

  return (
    <div className={`flex flex-nowrap items-center gap-1 overflow-x-auto hide-scrollbar ${className}`}>
      {visiblePaths.map(path => (
        <div
          key={path}
          className="text-desc text-xs blinko-tag whitespace-nowrap font-bold hover:opacity-80 !transition-all cursor-pointer"
          onClick={(e) => goToTag(path, e)}
        >
          #{path}
        </div>
      ))}
      {overflowPaths.length > 0 && (
        <Popover placement="top" showArrow>
          <PopoverTrigger>
            <div
              className="text-desc text-xs blinko-tag whitespace-nowrap font-bold hover:opacity-80 !transition-all cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              +{overflowPaths.length}
            </div>
          </PopoverTrigger>
          <PopoverContent>
            <div className="p-3 flex flex-col gap-2 max-w-[280px]" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap gap-1">
                {overflowPaths.map(path => (
                  <div
                    key={path}
                    className="text-desc text-xs blinko-tag whitespace-nowrap font-bold hover:opacity-80 !transition-all cursor-pointer"
                    onClick={(e) => goToTag(path, e)}
                  >
                    #{path}
                  </div>
                ))}
              </div>
              {(createdAt || updatedAt) && (
                <div className="text-tiny text-default-400 flex flex-col gap-0.5 border-t border-default-200 pt-2 mt-1">
                  {createdAt && <span>{t('created-at')}: {dayjs(createdAt).format('YYYY-MM-DD HH:mm')}</span>}
                  {updatedAt && <span>{t('updated-at')}: {dayjs(updatedAt).format('YYYY-MM-DD HH:mm')}</span>}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {noteId && (
        <div onClick={(e) => e.stopPropagation()}>
          <TagPicker currentTags={[]} showCurrentTags={false} onAdd={attach} onRemove={detach} />
        </div>
      )}
    </div>
  );
});
