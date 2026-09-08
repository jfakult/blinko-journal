// CUSTOM-JOURNAL: shared background picker UI (pattern/color/gradient swatches
// + image upload), used by both PersonalizeButton (per-entry, writes into
// EditorStore.metadata.personalization) and the page-wide background setting
// in PerferSetting.tsx (writes into the global `pageBackground` config key).
// Pulled out as its own component instead of duplicating the swatch grid
// twice - see docs/workstreams/09-entry-personalization.md.
import { useState } from 'react';
import { Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { PATTERN_PRESETS, COLOR_PRESETS, GRADIENT_PRESETS, BackgroundChoice, BackgroundType, resolveBackgroundStyle } from '@/lib/personalization';

interface Props {
  value?: BackgroundChoice;
  onChange: (value: BackgroundChoice | undefined) => void;
  onUploadImage: (file: File) => Promise<any>;
  uploadLabel?: string;
  changeLabel?: string;
}

export const BackgroundPicker = ({ value, onChange, onUploadImage, uploadLabel, changeLabel }: Props) => {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [uploading, setUploading] = useState(false);

  const isActive = (type: BackgroundType, key: string) => value?.type === type && value?.value === key;

  const setBackground = (type: BackgroundType, key: string) => {
    if (isActive(type, key)) {
      onChange(undefined);
      return;
    }
    onChange({ type, value: key });
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await onUploadImage(file);
    } catch (error) {
      console.error('Failed to upload background image:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {PATTERN_PRESETS.map(p => (
          <Tooltip key={p.key} content={p.label} delay={300}>
            <div
              onClick={() => setBackground('pattern', p.key)}
              className="w-7 h-7 rounded-md cursor-pointer border-2 bg-background"
              style={{
                ...resolveBackgroundStyle({ type: 'pattern', value: p.key }, isDark),
                borderColor: isActive('pattern', p.key) ? 'var(--primary)' : 'var(--border)',
              }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {COLOR_PRESETS.map(c => (
          <Tooltip key={c.key} content={c.label} delay={300}>
            <div
              onClick={() => setBackground('color', c.key)}
              className="w-7 h-7 rounded-md cursor-pointer border-2"
              style={{
                ...resolveBackgroundStyle({ type: 'color', value: c.key }, isDark),
                borderColor: isActive('color', c.key) ? 'var(--primary)' : 'var(--border)',
              }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {GRADIENT_PRESETS.map(g => (
          <Tooltip key={g.key} content={g.label} delay={300}>
            <div
              onClick={() => setBackground('gradient', g.key)}
              className="w-7 h-7 rounded-md cursor-pointer border-2"
              style={{
                ...resolveBackgroundStyle({ type: 'gradient', value: g.key }, isDark),
                borderColor: isActive('gradient', g.key) ? 'var(--primary)' : 'var(--border)',
              }}
            />
          </Tooltip>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer text-desc hover:text-foreground !transition-colors">
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
        {uploading
          ? t('uploading', { defaultValue: 'Uploading...' })
          : value?.type === 'image'
            ? (changeLabel || t('change-background-image', { defaultValue: 'Change background image' }))
            : (uploadLabel || t('use-a-photo-as-background', { defaultValue: 'Use a photo as background' }))}
      </label>
    </div>
  );
};
