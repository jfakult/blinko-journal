import { Icon } from '@/components/Common/Iconify/icons';
import { Popover, PopoverContent, PopoverTrigger, Select, SelectItem, Button, Radio, RadioGroup, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { RootStore } from "@/store";
import { BlinkoStore } from "@/store/blinkoStore";
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { RangeCalendar } from "@heroui/react";
import { today, getLocalTimeZone } from "@internationalized/date";
import dayjs from "@/lib/dayjs";
import TagSelector from "@/components/Common/TagSelector";
import { api } from "@/lib/trpc";

// CUSTOM-JOURNAL: composite "field:direction[:axisId]" sort value, parsed in
// handleApplyFilter into noteListFilterConfig.sortField/orderBy/moodAxisId.
const DATE_DESC = 'date:desc';

export default function FilterPop() {
  const { t } = useTranslation();
  const blinkoStore = RootStore.Get(BlinkoStore);
  const [searchParams] = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{
    start: any;
    end: any;
  }>({
    start: null,
    end: null
  });
  const [focusedValue, setFocusedValue] = useState(today(getLocalTimeZone()));
  const [tagStatus, setTagStatus] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);
  const [sortValue, setSortValue] = useState<string>(DATE_DESC);
  const [moodAxes, setMoodAxes] = useState<{ id: number; positiveLabel: string; negativeLabel?: string | null }[]>([]);

  useEffect(() => {
    api.ai.moodAxisList.query().then(setMoodAxes).catch(() => {});
  }, []);

  const sortOptions = [
    { value: 'date:desc', label: t('newest') },
    { value: 'date:asc', label: t('oldest') },
    { value: 'size:desc', label: t('longest') },
    { value: 'size:asc', label: t('shortest') },
    ...moodAxes.flatMap(axis => [
      { value: `mood:${axis.id}:desc`, label: `${t('most')} ${axis.positiveLabel}` },
      ...(axis.negativeLabel ? [{ value: `mood:${axis.id}:asc`, label: `${t('most')} ${axis.negativeLabel}` }] : [])
    ])
  ];

  const conditions = [
    { label: t('has-link'), value: 'hasLink' },
    { label: t('has-file'), value: 'hasFile' },
    { label: t('public'), value: 'isShare' },
    { label: t('has-todo'), value: 'hasTodo' },
  ];

  // CUSTOM-JOURNAL: FilterPop is rendered both in the header (visible on
  // every list view) and under the new-entry box, so Apply/Reset must
  // refetch whichever list is actually on screen -- resolved the same way
  // blinkoStore.useQuery()/refreshData() and index.tsx's currentListState
  // do, from the current ?path=. This used to unconditionally call
  // noteList.resetAndCall() (the ?path=all list); since the normal journal
  // view is ?path=notes (noteOnlyList, a *different* PromisePageState),
  // Apply silently refetched a list nobody was looking at and looked like
  // "sorting doesn't work."
  const getActiveList = () => {
    switch (searchParams.get('path')) {
      case 'notes': return blinkoStore.noteOnlyList;
      case 'todo': return blinkoStore.todoList;
      case 'all': return blinkoStore.noteList;
      case 'archived': return blinkoStore.archivedList;
      case 'trash': return blinkoStore.trashList;
      default: return blinkoStore.noteOnlyList;
    }
  };

  const parseSortValue = (value: string) => {
    const [field, direction, axisId] = value.split(':');
    return {
      sortField: field as 'date' | 'size' | 'mood',
      orderBy: direction as 'asc' | 'desc',
      moodAxisId: axisId ? Number(axisId) : null
    };
  };

  const handleApplyFilter = () => {
    blinkoStore.noteListFilterConfig = {
      ...blinkoStore.noteListFilterConfig,
      startDate: dateRange.start ? new Date(dateRange.start.toString()) : null,
      endDate: dateRange.end ? new Date(dateRange.end.toString()) : null,
      tagId: selectedTag ? Number(selectedTag) : null,
      withoutTag: tagStatus === 'without',
      withFile: selectedCondition === 'hasFile',
      withLink: selectedCondition === 'hasLink',
      isShare: selectedCondition === 'isShare' ? true : false,
      hasTodo: selectedCondition === 'hasTodo',
      isArchived: null,
      ...parseSortValue(sortValue)
    };
    getActiveList().resetAndCall({});
    setIsOpen(false);
  };

  const handleReset = () => {
    setDateRange({ start: null, end: null });
    setTagStatus("all");
    setSelectedTag(null);
    setSelectedCondition(null);
    setSortValue(DATE_DESC);

    blinkoStore.noteListFilterConfig = {
      ...blinkoStore.noteListFilterConfig,
      startDate: null,
      endDate: null,
      tagId: null,
      withoutTag: false,
      withFile: false,
      withLink: false,
      isArchived: false,
      isShare: null,
      hasTodo: false,
      ...parseSortValue(DATE_DESC)
    };
    getActiveList().resetAndCall({});
    setIsOpen(false);
  };

  // CUSTOM-JOURNAL: this used to be a Popover anchored below the trigger
  // icon. Capping its height/width (previous fix) still wasn't enough -- an
  // anchored popover's position is derived from the trigger's location, so
  // near a screen edge it could still render partly off-screen with no way
  // to reposition it fully back on-screen. A centered Modal has no anchor to
  // go wrong: HeroUI keeps it centered and within the viewport regardless of
  // where the trigger button sits, and scrollBehavior="inside" keeps
  // Apply/Reset always reachable (pinned in the footer) even if the body
  // content is taller than the screen.
  return (
    <>
      <Button isIconOnly size="sm" variant="light" onPress={() => setIsOpen(true)}>
        <Icon className="cursor-pointer text-default-600" icon="tabler:filter-bolt" width="24" height="24" />
      </Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} placement="center" scrollBehavior="inside" size="sm">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Icon icon="tabler:filter-bolt" width="20" height="20" />
            {t('filter-settings')}
          </ModalHeader>
          <ModalBody className="pb-4">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Icon icon="solar:sort-by-time-broken" width="24" height="24" />
              {t('time-range')}
            </div>
            <Popover placement="bottom" classNames={{
              content: [
                "p-0 bg-transparent border-none shadow-none",
              ],
            }}>
              <PopoverTrigger>
                <div className="flex items-center gap-2 bg-default-100 rounded-lg p-3">
                  <Icon icon="solar:calendar-bold" className="text-default-500" width="20" height="20" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {dateRange.start ? dayjs(new Date(dateRange.start.toString())).format('YYYY-MM-DD') : t('start-date')}
                    </span>
                    <span className="text-default-500">{t('to')}</span>
                    <span className="text-sm">
                      {dateRange.end ? dayjs(new Date(dateRange.end.toString())).format('YYYY-MM-DD') : t('end-date')}
                    </span>
                  </div>
                </div>
              </PopoverTrigger>
              <PopoverContent>
                <div className="flex flex-col gap-2">
                  <RangeCalendar
                    className="bg-background"
                    value={dateRange.start && dateRange.end ? dateRange : undefined}
                    onChange={setDateRange}
                    focusedValue={focusedValue}
                    onFocusChange={setFocusedValue}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Icon icon="fluent:tag-search-24-regular" width="20" height="20" />
              {t('tag-status')}
            </div>
            <Select
              value={tagStatus}
              onChange={(e) => {
                setTagStatus(e.target.value);
                if (e.target.value === 'without') setSelectedTag(null);
              }}
              className="w-full"
              defaultSelectedKeys={['all']}
              classNames={{
                trigger: "h-12",
              }}
              labelPlacement="outside"
              placeholder={t('select-tag-status')}
              renderValue={(items) => {
                const item = items[0];
                const getIcon = (value: string) => {
                  switch (value) {
                    case 'all':
                      return <Icon icon="solar:notes-bold" width="20" height="20" />;
                    case 'with':
                      return <Icon icon="lucide:tags" width="20" height="20" />;
                    case 'without':
                      return <Icon icon="majesticons:tag-off-line" width="20" height="20" />;
                    default:
                      return null;
                  }
                };
                return (
                  <div className="flex items-center gap-2">
                    {getIcon(item?.key as string)}
                    <span>{item?.textValue}</span>
                  </div>
                );
              }}
            >
              {[
                { key: 'all', label: t('all'), icon: <Icon icon="solar:notes-bold" width="20" height="20" /> },
                { key: 'with', label: t('with-tags'), icon: <Icon icon="lucide:tags" width="20" height="20" /> },
                { key: 'without', label: t('without-tags'), icon: <Icon icon="majesticons:tag-off-line" width="20" height="20" /> }
              ].map((item) => (
                <SelectItem key={item.key} textValue={item.label}>
                  <div className="flex gap-2 items-center">
                    {item.icon}
                    <span className="text-small">{item.label}</span>
                  </div>
                </SelectItem>
              ))}
            </Select>
          </div>

          {/* CUSTOM-JOURNAL: always-visible autocompleting tag search, not
              gated behind picking "With Tags" first -- picking a tag here
              implies "with this tag" on its own (Apply reads selectedTag
              independently of tagStatus), so the extra click was pure
              friction. Hidden only for "Without Tags", where searching a
              specific tag would be a contradictory combination. */}
          {tagStatus !== "without" && (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Icon icon="solar:tags-bold" width="20" height="20" />
                {t('filter-by-tag')}
              </div>

              <div className="flex items-center gap-2">
                <TagSelector
                  selectedTag={selectedTag}
                  onSelectionChange={(key) => {
                    setSelectedTag(key || null);
                    if (key) setTagStatus('with');
                  }}
                  className="flex-1"
                />
                {selectedTag && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    onPress={() => {
                      setSelectedTag(null);
                      if (tagStatus === 'with') setTagStatus('all');
                    }}
                  >
                    <Icon icon="mingcute:close-line" width="18" height="18" />
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Icon icon="material-symbols:conditions" width="20" height="20" />
              {t('additional-conditions')}
            </div>
            <RadioGroup
              value={selectedCondition || ""}
              onValueChange={setSelectedCondition}
            >
              <Radio value="">{t('no-condition')}</Radio>
              {conditions.map(condition => (
                <Radio key={condition.value} value={condition.value}>
                  {condition.label}
                </Radio>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Icon icon="solar:sort-vertical-bold" width="20" height="20" />
              {t('sort')}
            </div>
            <Select
              selectedKeys={[sortValue]}
              onChange={(e) => e.target.value && setSortValue(e.target.value)}
              className="w-full"
              classNames={{ trigger: "h-12" }}
              disallowEmptySelection
            >
              {sortOptions.map(option => (
                <SelectItem key={option.value} textValue={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          </ModalBody>
          <ModalFooter className="flex gap-2">
            <Button
              color="primary"
              onClick={handleApplyFilter}
              className="flex-1"
              startContent={<Icon icon="solar:filter-bold" width="20" height="20" />}
            >
              {t('apply')}
            </Button>
            <Button
              variant="flat"
              onClick={handleReset}
              className="flex-1"
              startContent={<Icon icon="fluent:arrow-reset-20-filled" width="20" height="20" />}
            >
              {t('reset')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}