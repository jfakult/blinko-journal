import { BlinkoStore } from '@/store/blinkoStore';
import { observer } from 'mobx-react-lite';
import { RootStore } from '@/store';
import { Button, Input } from '@heroui/react';
import { useState } from 'react';
import { DialogStore } from '@/store/module/Dialog';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { api } from '@/lib/trpc';
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';

// CUSTOM-JOURNAL: tags are otherwise only ever created implicitly by typing
// #hashtag in a note -- this lets the user create one directly (zero notes
// attached yet) from the sidebar tag tree. Icon/rename/delete/reorder all
// already work via TagListPanel's existing context menu once it exists.
const CreateTag = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await api.tags.create.mutate({ name: name.trim() });
      blinko.tagList.call();
      RootStore.Get(DialogStore).close();
    } catch (error: any) {
      RootStore.Get(ToastPlugin).error(error?.message || 'Failed to create tag');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 pb-4">
      <Input
        autoFocus
        placeholder={t('tag-name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
      <Button style={{ width: '30px' }} color="primary" isDisabled={!name.trim() || isSubmitting} onPress={handleSave}>
        {t('save')}
      </Button>
    </div>
  );
});

export const ShowCreateTagDialog = () => {
  RootStore.Get(DialogStore).setData({
    isOpen: true,
    title: i18n.t('create-tag'),
    content: <CreateTag />,
  });
};
