import { observer } from "mobx-react-lite";
import { BlinkoStore } from '@/store/blinkoStore';
import { Card } from '@heroui/react';
import { RootStore } from '@/store';
import { ContextMenuTrigger } from '@/components/Common/ContextMenu';
import { Note } from '@shared/lib/types';
import { ShowEditBlinkoModel } from "../BlinkoRightClickMenu";
import { useMediaQuery } from "usehooks-ts";
import { _ } from '@/lib/lodash';
import { useState, useEffect } from "react";
import { CardBlogBox } from "./cardBlogBox";
import { NoteContent } from "./noteContent";
import { helper } from "@/lib/helper";
import { CardHeader } from "./cardHeader";
import { CardFooter } from "./cardFooter";
import { FocusEditorFixMobile } from "../Common/Editor/editorUtils";
import { AvatarAccount, SimpleCommentList } from "./commentButton";
import { PluginApiStore } from "@/store/plugin/pluginApiStore";
import { PluginRender } from "@/store/plugin/pluginRender";
import { useLocation } from "react-router-dom";
import { SwipeableCard } from "./SwipeableCard";
import { api } from "@/lib/trpc";
import { FullscreenEditor } from "./FullscreenEditor";
import { EntryCoverImage } from "./EntryCoverImage";
import { getBackgroundStyle, getFontStyle } from "@/lib/personalization";
import { useTheme } from "next-themes";
import { FontManager } from "@/lib/fontManager";


export type BlinkoItem = Note & {
  isBlog?: boolean;
  title?: string;
  originURL?: string;
  isExpand?: boolean;
}

interface BlinkoCardProps {
  blinkoItem: BlinkoItem;
  className?: string;
  account?: AvatarAccount;
  isShareMode?: boolean;
  forceBlog?: boolean;
  defaultExpanded?: boolean;
  glassEffect?: boolean;
  withoutHoverAnimation?: boolean;
  withoutBoxShadow?: boolean;
}

export const BlinkoCard = observer(({ blinkoItem, account, isShareMode = false, glassEffect = false, forceBlog = false, withoutBoxShadow = false, withoutHoverAnimation = false, className, defaultExpanded = false }: BlinkoCardProps) => {
  const isPc = useMediaQuery('(min-width: 768px)');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const blinko = RootStore.Get(BlinkoStore);
  const pluginApi = RootStore.Get(PluginApiStore);
  const { pathname } = useLocation();
  const [isFullscreenEditorOpen, setIsFullscreenEditorOpen] = useState(false);

  // Set isExpand flag to prevent drag when fullscreen editor is open for this note
  blinkoItem.isExpand = blinko.fullscreenEditorNoteId === blinkoItem.id;

  // CUSTOM-JOURNAL: ensure a chosen per-entry font's @font-face is actually
  // loaded when viewing a card (not just when it was picked in the editor) -
  // getFontStyle() only sets the CSS font-family value, it can't load the
  // stylesheet itself.
  const cardFontFamily = blinkoItem.metadata?.personalization?.fontFamily;
  useEffect(() => {
    if (cardFontFamily && cardFontFamily !== 'default') {
      FontManager.getScopedFontFamily(cardFontFamily).catch(() => {});
    }
  }, [cardFontFamily]);

  if (forceBlog) {
    blinkoItem.isBlog = true
  } else {
    blinkoItem.isBlog = ((blinkoItem.content?.length ?? 0) > (blinko.config.value?.textFoldLength ?? 1000)) && !pathname.includes('/share/')
  }
  blinkoItem.title = blinkoItem.content?.split('\n').find(line => {
    if (!line.trim()) return false;
    if (helper.regex.isContainHashTag.test(line)) return false;
    return true;
  }) || '';


  const handleClick = () => {
    if (blinko.isMultiSelectMode) {
      blinko.onMultiSelectNote(blinkoItem.id!);
    } else if (blinkoItem.isBlog && !isShareMode) {
      setIsFullscreenEditorOpen(true);
      blinko.fullscreenEditorNoteId = blinkoItem.id!;
    }
  };

  const handleContextMenu = () => {
    if (isShareMode) return;
    blinko.curSelectedNote = _.cloneDeep(blinkoItem);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isShareMode) return;
    blinko.curSelectedNote = _.cloneDeep(blinkoItem);
    ShowEditBlinkoModel();
    FocusEditorFixMobile()
  };

  const handleSwipePin = () => {
    blinko.upsertNote.call({
      id: blinkoItem.id,
      isTop: !blinkoItem.isTop
    });
  };

  const handleSwipeDelete = () => {
    api.notes.trashMany.mutate({ ids: [blinkoItem.id!] }).then(() => {
      blinko.updateTicker++;
    });
  };

  return (
    <>
      {/* Fullscreen Editor Overlay */}
      <FullscreenEditor
        blinkoItem={blinkoItem}
        isOpen={isFullscreenEditorOpen}
        onClose={() => setIsFullscreenEditorOpen(false)}
      />

      {(() => {
        const cardContent = (
          <div
            {...(!isShareMode && {
              onContextMenu: handleContextMenu,
              onDoubleClick: handleDoubleClick
            })}
            onClick={handleClick}
          >
            <Card
              onContextMenu={e => !isPc && e.stopPropagation()}
              shadow='none'
              // CUSTOM-JOURNAL: per-entry background from PersonalizeButton, see
              // app/src/lib/personalization.ts / docs/workstreams/09-entry-personalization.md
              style={getBackgroundStyle(blinkoItem.metadata?.personalization, isDark)}
              className={`
                flex flex-col p-4 ${glassEffect ? 'bg-transparent' : 'bg-background'} !transition-all group/card
                ${isPc && !blinkoItem.isShare && !withoutHoverAnimation ? 'hover:translate-y-1' : ''}
                ${blinkoItem.isBlog ? 'cursor-pointer' : ''}
                ${blinko.curMultiSelectIds?.includes(blinkoItem.id!) ? 'border-2 border-primary' : ''}
                ${className}
              `}
            >
              <div className="w-full">
                <EntryCoverImage blinkoItem={blinkoItem} />
                <CardHeader blinkoItem={blinkoItem} blinko={blinko} isShareMode={isShareMode} isExpanded={defaultExpanded} account={account} />

                {/* CUSTOM-JOURNAL: per-entry font applies to the entry text itself, not the
                    header (title/date/menu) or footer (tags/actions) - a handwriting font on
                    UI chrome would look odd, on the writing itself it's the point. */}
                <div style={getFontStyle(blinkoItem.metadata?.personalization)}>
                  {blinkoItem.isBlog && (
                    <CardBlogBox blinkoItem={blinkoItem} isExpanded={defaultExpanded} />
                  )}

                  {!blinkoItem.isBlog && <NoteContent blinkoItem={blinkoItem} blinko={blinko} isExpanded={defaultExpanded} isShareMode={isShareMode} />}
                </div>

                {/* Custom Footer Slots */}
                {pluginApi.customCardFooterSlots
                  .filter(slot => {
                    if (slot.isHidden) return false;
                    if (slot.showCondition && !slot.showCondition(blinkoItem)) return false;
                    if (slot.hideCondition && slot.hideCondition(blinkoItem)) return false;
                    return true;
                  })
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .map((slot) => (
                    <div
                      key={slot.name}
                      className={`mt-4 ${slot.className || ''}`}
                      style={slot.style}
                      onClick={slot.onClick}
                      onMouseEnter={slot.onHover}
                      onMouseLeave={slot.onLeave}
                    >
                      <div style={{ maxWidth: slot.maxWidth }}>
                        <PluginRender content={slot.content} data={blinkoItem} />
                      </div>
                    </div>
                  ))}

                <CardFooter blinkoItem={blinkoItem} blinko={blinko} isShareMode={isShareMode} />
                {!blinko.config.value?.isHideCommentInCard && blinkoItem.comments && blinkoItem.comments.length > 0 && (
                  <SimpleCommentList blinkoItem={blinkoItem} />
                )}
              </div>
            </Card>
          </div>
        );

        const wrappedContent = isShareMode ? cardContent : (
          <ContextMenuTrigger id="blink-item-context-menu">
            {cardContent}
          </ContextMenuTrigger>
        );

        // On mobile, wrap with SwipeableCard for swipe actions
        if (!isPc && !isShareMode) {
          return (
            <SwipeableCard
              onPin={handleSwipePin}
              onDelete={handleSwipeDelete}
              isPinned={blinkoItem.isTop}
            >
              {wrappedContent}
            </SwipeableCard>
          );
        }

        return wrappedContent;
      })()}
    </>
  );
});