import { observer } from 'mobx-react-lite';
import { RootStore } from '@/store';
import { useTranslation } from 'react-i18next';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { ShowUpdateTagDialog } from '../Common/UpdateTagPop';
import { showTipsDialog } from '../Common/TipsDialog';
import { BlinkoStore } from '@/store/blinkoStore';
import { api } from '@/lib/trpc';
import { DialogStandaloneStore } from '@/store/module/DialogStandalone';
import { MultiSelectToolbar } from '../Common/MultiSelectToolbar';

export const BlinkoMultiSelectPop = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  // CUSTOM-JOURNAL: the archive/unarchive bulk toggle was dropped along with
  // the Archive feature (single recycle bin now). isRecycleView still needs
  // to gate two things here: a bulk "Restore" action only makes sense while
  // looking at the trash, and delete should stay a soft trashMany (with a
  // lighter confirm) everywhere except the trash view itself, where it's
  // genuinely a permanent delete (matching BlinkoRightClickMenu's
  // handleTrash/handleDelete split, gated the same way).
  const isRecycleView = blinko.noteListFilterConfig.isRecycle;

  const actions = [
    ...(isRecycleView ? [{
      icon: "mdi:restore",
      text: t('recovery'),
      onClick: async () => {
        await RootStore.Get(ToastPlugin).promise(
          api.notes.updateMany.mutate({ ids: blinko.curMultiSelectIds, isRecycle: false }),
          {
            loading: t('in-progress'),
            success: <b>{t('your-changes-have-been-saved')}</b>,
            error: <b>{t('operation-failed')}</b>,
          });
        blinko.onMultiSelectRest();
      }
    }] : []),
    {
      icon: "solar:tag-outline",
      text: t('add-tag'),
      onClick: () => {
        ShowUpdateTagDialog({
          type: 'select',
          onSave: async (tagName) => {
            await RootStore.Get(ToastPlugin).promise(
              api.tags.updateTagMany.mutate({ tag: tagName, ids: blinko.curMultiSelectIds }),
              {
                loading: t('in-progress'),
                success: <b>{t('your-changes-have-been-saved')}</b>,
                error: <b>{t('operation-failed')}</b>,
              });
            blinko.onMultiSelectRest();
          }
        });
      }
    },
    {
      icon: "mingcute:delete-2-line",
      text: t('delete'),
      isDeleteButton: true,
      onClick: () => {
        if (!isRecycleView) {
          showTipsDialog({
            title: t('confirm-to-trash'),
            content: t('this-entry-will-be-moved-to-the-recycle-bin'),
            onConfirm: async () => {
              await RootStore.Get(ToastPlugin).promise(
                api.notes.trashMany.mutate({ ids: blinko.curMultiSelectIds }),
                {
                  loading: t('in-progress'),
                  success: <b>{t('your-changes-have-been-saved')}</b>,
                  error: <b>{t('operation-failed')}</b>,
                });
              blinko.onMultiSelectRest();
              RootStore.Get(DialogStandaloneStore).close();
            }
          });
          return;
        }
        showTipsDialog({
          title: t('confirm-to-delete'),
          content: t('this-operation-removes-the-associated-label-and-cannot-be-restored-please-confirm'),
          onConfirm: async () => {
            await RootStore.Get(ToastPlugin).promise(
              api.notes.deleteMany.mutate({ ids: blinko.curMultiSelectIds }),
              {
                loading: t('in-progress'),
                success: <b>{t('your-changes-have-been-saved')}</b>,
                error: <b>{t('operation-failed')}</b>,
              });
            blinko.curMultiSelectIds.map(i => api.ai.embeddingDelete.mutate({ id: i }));
            blinko.onMultiSelectRest();
            RootStore.Get(DialogStandaloneStore).close();
          }
        });
      }
    }
  ];

  return (
    <MultiSelectToolbar
      show={blinko.isMultiSelectMode}
      actions={actions}
      onClose={() => blinko.onMultiSelectRest()}
    />
  );
});