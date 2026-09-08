// CUSTOM-JOURNAL: per-entry personalization picker (background pattern/color/
// gradient/image + warm font), see docs/workstreams/09-entry-personalization.md.
// Follows HashtagButton's Popover-in-toolbar pattern; writes into
// store.metadata.personalization, which already round-trips to the DB
// unchanged (EditorStore.metadata was already wired through handleSend).
// Background swatch grid + upload is shared with the page-wide background
// setting via BackgroundPicker.
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Popover, PopoverTrigger, PopoverContent } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../IconButton';
import { EditorStore } from '../../editorStore';
import { RootStore } from '@/store/root';
import { api } from '@/lib/trpc';
import { FontManager, FontMetadata } from '@/lib/fontManager';
import { EntryPersonalization, BackgroundChoice } from '@/lib/personalization';
import { BackgroundPicker } from '@/components/Common/BackgroundPicker';

interface Props {
  store: EditorStore;
}

export const PersonalizeButton = observer(({ store }: Props) => {
  const { t } = useTranslation();
  const [fonts, setFonts] = useState<FontMetadata[]>([]);
  const localStore = RootStore.Local(() => ({ show: false }));

  useEffect(() => {
    api.fonts?.list.query().then((list: FontMetadata[]) => {
      const curated = list.filter(f => f.isSystem || f.category === 'serif' || f.category === 'handwriting');
      setFonts(curated);
      // CUSTOM-JOURNAL: load each option's actual webfont so the picker preview
      // shows the real typeface, not the fallback - list is small (curated to
      // serif/handwriting) so eager-loading all of them is cheap.
      curated.forEach(f => {
        if (!f.isSystem) FontManager.loadFont(f.name).catch(() => {});
      });
    }).catch(() => {});
  }, []);

  const personalization: EntryPersonalization = store.metadata?.personalization || {};

  const setPersonalization = (patch: Partial<EntryPersonalization>) => {
    store.updateMetadata({ personalization: { ...personalization, ...patch } });
  };

  const setFont = async (fontName: string) => {
    if (fontName !== 'default') {
      await FontManager.getScopedFontFamily(fontName).catch(() => {});
    }
    setPersonalization({ fontFamily: fontName });
  };

  const hasCustomization = !!(personalization.background || personalization.coverImagePath || (personalization.fontFamily && personalization.fontFamily !== 'default'));

  const [uploadingCover, setUploadingCover] = useState(false);
  const handleCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingCover(true);
    try {
      await store.uploadCoverImage(file);
    } catch (error) {
      console.error('Failed to upload cover image:', error);
    } finally {
      setUploadingCover(false);
    }
  };

  return (
    <Popover placement="bottom" isOpen={localStore.show} onOpenChange={v => localStore.show = v}>
      <PopoverTrigger>
        <div>
          <IconButton
            icon="solar:palette-bold"
            tooltip={t('entry-theme', { defaultValue: 'Entry theme' })}
            onClick={() => localStore.show = !localStore.show}
            classNames={hasCustomization ? { icon: '!text-primary' } : undefined}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-3 w-[280px] max-h-[70vh] overflow-y-auto">
        <div className="flex flex-col gap-3 w-full">
          <div>
            <div className="text-xs font-bold text-desc mb-1.5">{t('background', { defaultValue: 'Background' })}</div>
            {/* CUSTOM-JOURNAL: swatches render this theme's variant of each preset so
                the picker always shows what you'll actually see - a color/pattern/
                gradient choice persists across a light/dark switch but always renders
                its theme-appropriate variant, never a mismatched light pastel on a
                dark page or vice versa. */}
            <BackgroundPicker
              value={personalization.background}
              onChange={(background) => setPersonalization({ background })}
              onUploadImage={(file) => store.uploadBackgroundImage(file)}
            />
          </div>

          <div>
            <div className="text-xs font-bold text-desc mb-1.5">{t('cover-photo', { defaultValue: 'Cover photo' })}</div>
            <label className="flex items-center gap-2 text-sm cursor-pointer text-desc hover:text-foreground !transition-colors">
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverFile} disabled={uploadingCover} />
              {uploadingCover
                ? t('uploading', { defaultValue: 'Uploading...' })
                : personalization.coverImagePath
                  ? t('change-cover-photo', { defaultValue: 'Change cover photo' })
                  : t('add-cover-photo', { defaultValue: 'Add cover photo' })}
            </label>
          </div>

          <div>
            <div className="text-xs font-bold text-desc mb-1.5">{t('font', { defaultValue: 'Font' })}</div>
            <div className="flex flex-wrap gap-1.5">
              {fonts.map(f => (
                <div
                  key={f.name}
                  onClick={() => setFont(f.name)}
                  className="px-2 py-1 rounded-md cursor-pointer text-sm border-2"
                  style={{
                    borderColor: (personalization.fontFamily || 'default') === f.name ? 'var(--primary)' : 'var(--border)',
                    fontFamily: f.isSystem ? undefined : `"${f.name}", ${f.category === 'handwriting' ? 'cursive' : 'serif'}`,
                  }}
                >
                  {f.displayName}
                </div>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
