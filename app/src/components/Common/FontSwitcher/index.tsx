import { useState, useEffect, useRef } from 'react';
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection
} from "@heroui/dropdown";
import { Button, Spinner } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { api } from '@/lib/trpc';
import { FontManager, FontMetadata } from '@/lib/fontManager';

interface FontSwitcherProps {
  fontname?: string;
  onChange?: (fontname: string) => void;
}

const CSS_GENERIC_FALLBACK: Record<string, string> = {
  serif: 'serif',
  'sans-serif': 'sans-serif',
  monospace: 'monospace',
  handwriting: 'cursive',
  display: 'sans-serif',
};

const FontSwitcher = ({ fontname = 'default', onChange }: FontSwitcherProps) => {
  const [fonts, setFonts] = useState<FontMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  // CUSTOM-JOURNAL: the dropdown already set the right font-family CSS per option
  // (below), but nothing ever loaded each font's actual @font-face stylesheet -
  // only the currently-applied font gets loaded (via the effect below), so every
  // *other* option silently fell back to its generic category font, defeating the
  // point of a preview. Lazily load every option's stylesheet the first time the
  // dropdown opens (not on mount, to avoid ~30 network requests before the user
  // ever looks at this control).
  const previewsLoaded = useRef(false);
  const loadAllPreviews = () => {
    if (previewsLoaded.current || fonts.length === 0) return;
    previewsLoaded.current = true;
    fonts.forEach(font => {
      if (!font.isSystem && font.name !== 'default') {
        FontManager.loadFont(font.name).catch(() => {});
      }
    });
  };

  // Fetch font metadata from database on mount (no binary data - fast!)
  useEffect(() => {
    const fetchFonts = async () => {
      try {
        if (!api.fonts) {
          throw new Error('Font API not available');
        }
        // This only fetches metadata, not binary data
        const fontList = await api.fonts.list.query();
        setFonts(fontList);
        // Initialize the FontManager with metadata only
        FontManager.initializeRegistry(fontList);
      } catch (error) {
        console.error('Failed to fetch fonts:', error);
        // Fallback to default font if API fails
        setFonts([
          { id: 0, name: 'default', displayName: 'Default (System)', url: null, isLocal: false, weights: [400], category: 'sans-serif', isSystem: true, sortOrder: 0 }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchFonts();
  }, []);

  // Load the current font on mount if not default
  useEffect(() => {
    if (fontname && fontname !== 'default' && fonts.length > 0) {
      // Apply font immediately (will load in background)
      FontManager.applyFont(fontname).catch((error) => {
        console.warn('Failed to apply font on mount:', error);
      });
    }
  }, [fontname, fonts]);

  const handleFontSelect = async (selectedFont: string) => {
    if (selectedFont === fontname) return;

    setLoadingFont(selectedFont);

    try {
      // Load and apply the font
      await FontManager.applyFont(selectedFont);
      onChange?.(selectedFont);
    } catch (error) {
      console.error('Failed to apply font:', error);
    } finally {
      setLoadingFont(null);
    }
  };



  const currentFont = fonts.find(f => f.name === fontname);

  if (loading) {
    return (
      <Button variant="flat" isLoading>
        Loading...
      </Button>
    );
  }

  return (
    <Dropdown onOpenChange={(isOpen) => isOpen && loadAllPreviews()}>
      <DropdownTrigger>
        <Button variant="flat">
          {currentFont?.displayName || fontname || 'Select Font'}
        </Button>
      </DropdownTrigger>

      <DropdownMenu
        className="p-2 max-h-[400px] overflow-y-auto"
        aria-label="Font selection"
      >
        {fonts.map((font) => (
          <DropdownItem
            key={font.name}
            className="flex items-center justify-between cursor-pointer"
            onClick={() => handleFontSelect(font.name)}
            endContent={
              loadingFont === font.name ? (
                <Spinner size="sm" />
              ) : fontname === font.name ? (
                <Icon icon="mingcute:check-fill" width="18" height="18" />
              ) : null
            }
          >
            <span
              style={{
                // CUSTOM-JOURNAL: 'display'/'handwriting' aren't valid CSS generic
                // font-family keywords (only serif/sans-serif/monospace/cursive/
                // fantasy are) - an invalid fallback just gets ignored, which was
                // harmless once the real font loads but could show tofu/wrong-font
                // during that brief window. Map to a real generic keyword.
                fontFamily: font.isSystem ? undefined : `"${font.name}", ${CSS_GENERIC_FALLBACK[font.category] || 'sans-serif'}`
              }}
            >
              {font.displayName}
            </span>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
};

export default FontSwitcher;