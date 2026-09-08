// CUSTOM-JOURNAL: "Entry theme" (background + font) - a single GLOBAL,
// account-synced setting (config.entryTheme), not a per-note choice. Lives as
// a toolbar button in the editor for quick access while composing, but reads/
// writes the same global config the page-background setting in
// PerferSetting.tsx does - see app/src/lib/personalization.ts's revision
// history comment for why this changed from per-entry. Cover photo (still
// genuinely per-entry - a specific photo attached to one entry) stays wired
// through EditorStore/store.uploadCoverImage.
import { useEffect, useState, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Popover, PopoverTrigger, PopoverContent } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../IconButton';
import { EditorStore } from '../../editorStore';
import { RootStore } from '@/store/root';
import { RootStore as GlobalRootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { api } from '@/lib/trpc';
import { PromiseCall } from '@/store/standard/PromiseState';
import { FontManager, FontMetadata } from '@/lib/fontManager';
import { EntryPersonalization, EntryTheme, BackgroundChoice } from '@/lib/personalization';
import { BackgroundPicker } from '@/components/Common/BackgroundPicker';
import { uploadImageFile } from '@/lib/uploadImageFile';

interface Props {
  store: EditorStore;
}

export const PersonalizeButton = observer(({ store }: Props) => {
  const { t } = useTranslation();
  const blinko = GlobalRootStore.Get(BlinkoStore);
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

  const entryTheme: EntryTheme = blinko.config.value?.entryTheme || {};
  const personalization: EntryPersonalization = store.metadata?.personalization || {};

  // CUSTOM-JOURNAL: debounced, no-toast config write. A native <input
  // type="color"> fires onChange continuously while dragging inside the
  // picker, not just on release - without this every drag tick fired a
  // separate mutation AND a separate "Operation successful" toast. autoAlert
  // is off entirely for this setting regardless (a toast on every swatch
  // click is noise, not signal, even without the drag-spam case).
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const setEntryTheme = (patch: Partial<EntryTheme>) => {
    const next = { ...entryTheme, ...patch };
    blinko.config.setValue({ ...blinko.config.value, entryTheme: next }); // optimistic, instant UI feedback
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      PromiseCall(api.config.update.mutate({ key: 'entryTheme', value: next }), { autoAlert: false });
    }, 300);
  };

  const setFont = async (fontName: string) => {
    if (fontName !== 'default') {
      await FontManager.getScopedFontFamily(fontName).catch(() => {});
    }
    setEntryTheme({ fontFamily: fontName });
  };

  const hasCustomization = !!(entryTheme.background || personalization.coverImagePath || (entryTheme.fontFamily && entryTheme.fontFamily !== 'default'));

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
            <div className="text-xs font-bold text-desc mb-0.5">{t('entry-theme', { defaultValue: 'Entry theme' })}</div>
            <div className="text-[11px] text-desc mb-1.5">{t('entry-theme-tip', { defaultValue: 'Applies to every entry, everywhere - not just this one' })}</div>
            <BackgroundPicker
              value={entryTheme.background}
              onChange={(background) => setEntryTheme({ background })}
              onUploadImage={async (file) => {
                const filePath = await uploadImageFile(file);
                if (filePath) setEntryTheme({ background: { type: 'image', value: filePath } });
              }}
            />
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
                    borderColor: (entryTheme.fontFamily || 'default') === f.name ? 'var(--primary)' : 'var(--border)',
                    fontFamily: f.isSystem ? undefined : `"${f.name}", ${f.category === 'handwriting' ? 'cursive' : 'serif'}`,
                  }}
                >
                  {f.displayName}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-desc mb-1.5">{t('cover-photo', { defaultValue: 'Cover photo (this entry only)' })}</div>
            <label className="flex items-center gap-2 text-sm cursor-pointer text-desc hover:text-foreground !transition-colors">
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverFile} disabled={uploadingCover} />
              {uploadingCover
                ? t('uploading', { defaultValue: 'Uploading...' })
                : personalization.coverImagePath
                  ? t('change-cover-photo', { defaultValue: 'Change cover photo' })
                  : t('add-cover-photo', { defaultValue: 'Add cover photo' })}
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
