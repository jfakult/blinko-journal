import { Spinner } from '@heroui/react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { DialogStore } from '@/store/module/Dialog';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import i18n from '@/lib/i18n';
import { BlinkoCard } from '.';

// CUSTOM-JOURNAL: shows a note's actual content as a popup -- for the note
// #id links in RagSettingsSection/AiTaskLogSection's history logs, which
// were wrongly reusing commentButton.tsx's ShowCommentDialog (opens the
// *comment thread* dialog, not the note itself -- "clicking the note link
// shows the comment menu instead" was that mix-up). Reuses the same
// BlinkoCard-in-a-Dialog pattern as BlinkoRightClickMenu's "Related Notes"
// popup. Kept in its own file rather than alongside ShowCommentDialog in
// commentButton.tsx -- that file is imported BY BlinkoCard/index.tsx (for
// CommentCount/SimpleCommentList), so importing BlinkoCard back from it
// would be a circular import; this file only imports FROM index.tsx.
export const ShowNotePopup = async (noteId: number) => {
  const blinko = RootStore.Get(BlinkoStore);
  const dialog = RootStore.Get(DialogStore);

  try {
    dialog.setData({
      isOpen: true,
      size: 'lg',
      title: i18n.t('entry'),
      content: <div className="flex justify-center py-4"><Spinner /></div>
    });

    const noteDetail = await blinko.noteDetail.call({ id: noteId });

    if (!noteDetail) {
      RootStore.Get(ToastPlugin).error(i18n.t('note-not-found'));
      dialog.setData({ isOpen: false });
      return;
    }

    dialog.setData({
      isOpen: true,
      size: 'lg',
      title: i18n.t('entry'),
      content: <BlinkoCard blinkoItem={noteDetail} withoutHoverAnimation />
    });
  } catch (error) {
    console.error('Failed to load note detail:', error);
    RootStore.Get(ToastPlugin).error(i18n.t('note-not-found'));
    dialog.setData({ isOpen: false });
  }
};
