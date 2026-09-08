// CUSTOM-JOURNAL: shared background picker UI (pattern + independent color +
// gradient swatches + image upload), used by both PersonalizeButton
// (per-entry, writes into EditorStore.metadata.personalization) and the
// page-wide background setting in PerferSetting.tsx (writes into the global
// `pageBackground` config key). Pulled out as its own component instead of
// duplicating the swatch grid twice.
//
// Pattern and color are independent choices that combine (pick a texture,
// pick what color it's tinted) rather than one flat list of pre-baked
// options - see app/src/lib/personalization.ts for the resolution logic and
// why this changed. Gradient/image remain separate, mutually-exclusive
// background types.
import { useState } from 'react';
import { Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { PATTERN_PRESETS, COLOR_PRESETS, GRADIENT_PRESETS, BackgroundChoice, resolveBackgroundStyle, resolveColorChoice } from '@/lib/personalization';

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

  const isPatternType = value?.type === 'pattern' || !value;
  const currentPattern = isPatternType ? (value?.pattern || 'blank') : undefined;
  const currentColor = isPatternType ? value?.color : undefined;

  const setPattern = (key: string) => {
    if (isPatternType && currentPattern === key) {
      // Toggle off the whole background choice only if it's already blank/uncolored.
      if (key === 'blank' && !currentColor) {
        onChange(undefined);
        return;
      }
    }
    onChange({ type: 'pattern', pattern: key, color: value?.color });
  };

  const setColor = (colorValue: string) => {
    onChange({ type: 'pattern', pattern: value?.pattern || 'blank', color: colorValue });
  };

  const setGradient = (key: string) => {
    if (value?.type === 'gradient' && value.value === key) {
      onChange(undefined);
      return;
    }
    onChange({ type: 'gradient', value: key });
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
      <div className="text-[11px] text-desc mb-1">{t('pattern', { defaultValue: 'Pattern' })}</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {PATTERN_PRESETS.map(p => (
          <Tooltip key={p.key} content={p.label} delay={300}>
            <div
              onClick={() => setPattern(p.key)}
              className="w-7 h-7 rounded-md cursor-pointer border-2 bg-background"
              style={{
                ...resolveBackgroundStyle({ type: 'pattern', pattern: p.key, color: currentColor }, isDark),
                borderColor: isPatternType && currentPattern === p.key ? 'var(--primary)' : 'var(--border)',
              }}
            />
          </Tooltip>
        ))}
      </div>

      <div className="text-[11px] text-desc mb-1">{t('color', { defaultValue: 'Color' })}</div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {COLOR_PRESETS.map(c => (
          <Tooltip key={c.key} content={c.label} delay={300}>
            <div
              onClick={() => setColor(c.key)}
              className="w-7 h-7 rounded-md cursor-pointer border-2"
              style={{
                backgroundColor: resolveColorChoice(c.key, isDark),
                borderColor: isPatternType && currentColor === c.key ? 'var(--primary)' : 'var(--border)',
              }}
            />
          </Tooltip>
        ))}
        {/* CUSTOM-JOURNAL: native color input for a fully custom color, not just
            the 6 curated presets - styled to look like a swatch consistent with
            the preset ones above. */}
        <Tooltip content={t('custom-color', { defaultValue: 'Custom color' })} delay={300}>
          <label
            className="w-7 h-7 rounded-md cursor-pointer border-2 flex items-center justify-center relative overflow-hidden"
            style={{
              borderColor: isPatternType && currentColor && !COLOR_PRESETS.find(c => c.key === currentColor) ? 'var(--primary)' : 'var(--border)',
              background: isPatternType && currentColor && !COLOR_PRESETS.find(c => c.key === currentColor)
                ? currentColor
                : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
            }}
          >
            <input
              type="color"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              value={(isPatternType && currentColor && currentColor.startsWith('#')) ? currentColor : '#f3e9d8'}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        </Tooltip>
      </div>

      <div className="text-[11px] text-desc mb-1">{t('gradient', { defaultValue: 'Gradient' })}</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {GRADIENT_PRESETS.map(g => (
          <Tooltip key={g.key} content={g.label} delay={300}>
            <div
              onClick={() => setGradient(g.key)}
              className="w-7 h-7 rounded-md cursor-pointer border-2"
              style={{
                ...resolveBackgroundStyle({ type: 'gradient', value: g.key }, isDark),
                borderColor: value?.type === 'gradient' && value.value === g.key ? 'var(--primary)' : 'var(--border)',
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
