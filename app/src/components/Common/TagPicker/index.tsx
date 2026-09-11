import { Popover, PopoverContent, PopoverTrigger, Autocomplete, AutocompleteItem } from '@heroui/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface TagPickerProps {
  currentTags: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  showCurrentTags?: boolean;
  className?: string;
}

// CUSTOM-JOURNAL: shared "attach a tag to this entry" control -- chips for
// the tags already on the entry (each removable) plus a "+" that opens a
// search-or-create picker. Used by the card "+tag" chip, the right-click
// "Add tag" dialog, and the editor's Tags row -- callers decide whether
// onAdd/onRemove hit the server immediately (already-saved notes) or just
// update local draft state (composing a new entry).
export const TagPicker = observer(({ currentTags, onAdd, onRemove, showCurrentTags = true, className = '' }: TagPickerProps) => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const allPaths = blinko.tagList.value?.pathTags || [];
  const available = allPaths.filter((p: string) => !currentTags.includes(p));

  const submit = (path: string) => {
    const clean = path.trim().replace(/^#/, '');
    if (!clean || currentTags.includes(clean)) return;
    onAdd(clean);
    setInputValue('');
    setIsOpen(false);
  };

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {showCurrentTags && currentTags.map(path => (
        <div
          key={path}
          className="text-desc text-xs blinko-tag whitespace-nowrap font-bold flex items-center gap-1"
        >
          #{path}
          <Icon
            icon="mdi:close"
            width="12"
            height="12"
            className="cursor-pointer opacity-60 hover:opacity-100 !transition-all"
            onClick={(e) => { e.stopPropagation(); onRemove(path); }}
          />
        </div>
      ))}
      <Popover placement="bottom-start" isOpen={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger>
          <div
            className="text-desc text-xs blinko-tag whitespace-nowrap font-bold hover:opacity-80 !transition-all cursor-pointer flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon icon="mingcute:add-line" width="12" height="12" />
            {t('tag')}
          </div>
        </PopoverTrigger>
        <PopoverContent>
          <div className="p-2 w-[240px]" onClick={(e) => e.stopPropagation()}>
            <Autocomplete
              autoFocus
              size="sm"
              placeholder={t('search-or-create-tag')}
              inputValue={inputValue}
              onInputChange={setInputValue}
              defaultItems={available.map((p: string) => ({ path: p }))}
              allowsCustomValue
              onKeyDown={(e: any) => {
                if (e.key === 'Enter' && inputValue.trim() && !available.includes(inputValue.trim())) {
                  submit(inputValue);
                }
              }}
              onSelectionChange={(key) => key && submit(key as string)}
            >
              {(item: { path: string }) => (
                <AutocompleteItem key={item.path} textValue={item.path}>
                  #{item.path}
                </AutocompleteItem>
              )}
            </Autocomplete>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});
