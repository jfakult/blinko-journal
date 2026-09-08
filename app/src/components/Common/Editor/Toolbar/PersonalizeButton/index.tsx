// CUSTOM-JOURNAL: per-entry personalization picker (background pattern/color
// + warm font), see docs/workstreams/09-entry-personalization.md. Follows
// HashtagButton's Popover-in-toolbar pattern; writes into
// store.metadata.personalization, which already round-trips to the DB
// unchanged (EditorStore.metadata was already wired through handleSend).
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Popover, PopoverTrigger, PopoverContent, Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../IconButton';
import { EditorStore } from '../../editorStore';
import { RootStore } from '@/store/root';
import { api } from '@/lib/trpc';
import { FontManager, FontMetadata } from '@/lib/fontManager';
import { PATTERNS, ACCENT_COLORS, EntryPersonalization } from '@/lib/personalization';

interface Props {
  store: EditorStore;
}

export const PersonalizeButton = observer(({ store }: Props) => {
  const { t } = useTranslation();
  const [fonts, setFonts] = useState<FontMetadata[]>([]);
  const localStore = RootStore.Local(() => ({ show: false }));

  useEffect(() => {
    api.fonts?.list.query().then((list: FontMetadata[]) => {
      setFonts(list.filter(f => f.isSystem || f.category === 'serif' || f.category === 'handwriting'));
    }).catch(() => {});
  }, []);

  const personalization: EntryPersonalization = store.metadata?.personalization || {};

  const setPersonalization = (patch: Partial<EntryPersonalization>) => {
    if (!store.metadata) store.metadata = {};
    store.metadata.personalization = { ...personalization, ...patch };
  };

  const setBackground = (type: 'pattern' | 'color', value: string) => {
    if (personalization.background?.type === type && personalization.background?.value === value) {
      // Toggle off — clicking the active choice again clears it.
      const { background, ...rest } = personalization;
      setPersonalization({ background: undefined, ...rest });
      return;
    }
    setPersonalization({ background: { type, value } });
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
            tooltip={t('personalize-entry', { defaultValue: 'Personalize this entry' })}
            onClick={() => localStore.show = !localStore.show}
            classNames={hasCustomization ? { icon: '!text-primary' } : undefined}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-3 w-[260px]">
        <div className="flex flex-col gap-3 w-full">
          <div>
            <div className="text-xs font-bold text-desc mb-1.5">{t('background', { defaultValue: 'Background' })}</div>
            <div className="flex flex-wrap gap-2">
              {PATTERNS.map(p => (
                <Tooltip key={p.key} content={p.label} delay={300}>
                  <div
                    onClick={() => setBackground('pattern', p.key)}
                    className="w-7 h-7 rounded-md cursor-pointer border-2 bg-background"
                    style={{
                      backgroundImage: p.backgroundImage,
                      backgroundRepeat: 'repeat',
                      borderColor: personalization.background?.type === 'pattern' && personalization.background?.value === p.key ? 'var(--primary)' : 'var(--border)',
                    }}
                  />
                </Tooltip>
              ))}
              {ACCENT_COLORS.map(color => (
                <div
                  key={color}
                  onClick={() => setBackground('color', color)}
                  className="w-7 h-7 rounded-md cursor-pointer border-2"
                  style={{
                    background: color,
                    borderColor: personalization.background?.type === 'color' && personalization.background?.value === color ? 'var(--primary)' : 'var(--border)',
                  }}
                />
              ))}
            </div>
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
