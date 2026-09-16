"use client";
import { useEffect } from 'react';
import { PromisePageState, PromiseState } from './standard/PromiseState';
import { Store } from './standard/base';
import { helper } from '@/lib/helper';
import { ToastPlugin } from './module/Toast/Toast';
import { RootStore } from './root';
import { eventBus } from '@/lib/event';
import { StorageListState } from './standard/StorageListState';
import i18n from '@/lib/i18n';
import { api } from '@/lib/trpc';
import { Attachment, NoteType, type Note } from '@shared/lib/types';
import { PURGE_TRASH_TASK_NAME, DBBAK_TASK_NAME } from '@shared/lib/sharedConstant';
import { makeAutoObservable } from 'mobx';
import { UserStore } from './user';
import { BaseStore } from './baseStore';
import { StorageState } from './standard/StorageState';
import { useSearchParams, useLocation } from 'react-router-dom';

type filterType = {
  label: string;
  sortBy: string;
  direction: string;
}

// Interface for note upsert parameters
interface UpsertNoteParams {
  /** Note content */
  content?: string | null;
  /** Whether the note is archived */
  isArchived?: boolean;
  /** Whether the note is in recycle bin */
  isRecycle?: boolean;
  /** Note type */
  type?: NoteType;
  /** Note ID */
  id?: number;
  /** List of attachments */
  attachments?: Attachment[];
  /** Whether to refresh the list after operation */
  refresh?: boolean;
  /** Whether the note is pinned to top */
  isTop?: boolean;
  /** Whether the note is publicly shared */
  isShare?: boolean;
  /** Whether to show toast notification */
  showToast?: boolean;
  /** List of referenced note IDs */
  references?: number[];
  /** Creation time */
  createdAt?: Date;
  /** Last update time */
  updatedAt?: Date;
  /** Metadata */
  metadata?: any;
}

interface OfflineNote extends Omit<Note, 'id' | 'references'> {
  id: number;
  isOffline: boolean;
  pendingSync: boolean;
  references: { toNoteId: number }[];
}

export class BlinkoStore implements Store {
  sid = 'BlinkoStore';
  noteContent = '';
  createContentStorage = new StorageState<{ content: string }>({
    key: 'createModeNote',
    default: { content: '' }
  });
  createAttachmentsStorage = new StorageListState<{ name: string, path: string, type: string, size: number }>({
    key: 'createModeAttachments',
  });
  editContentStorage = new StorageListState<{ content: string, id: number }>({
    key: 'editModeNotes'
  });
  editAttachmentsStorage = new StorageListState<{ name: string, path: string, type: string, size: number, id: number }>({
    key: 'editModeAttachments'
  });
  // CUSTOM-JOURNAL: per-entry note metadata (currently just the cover photo,
  // see app/src/lib/personalization.ts - background/font are a global setting,
  // config.entryTheme, not per-note) previously lived only in EditorStore's
  // in-memory `metadata` field - a refresh mid-compose lost it, unlike content
  // and attachments, which already persist via the storages above. Same
  // pattern applied here. See docs/workstreams/09-entry-personalization.md.
  createMetadataStorage = new StorageState<{ metadata: any }>({
    key: 'createModeMetadata',
    default: { metadata: {} }
  });
  editMetadataStorage = new StorageListState<{ metadata: any, id: number }>({
    key: 'editModeMetadata'
  });

  searchText: string = '';
  isCreateMode: boolean = true
  curSelectedNote: Note | null = null;
  curMultiSelectIds: number[] = [];
  isMultiSelectMode: boolean = false;
  fullscreenEditorNoteId: number | null = null;
  forceQuery: number = 0;
  allTagRouter = {
    title: 'total',
    href: '/?path=all',
    icon: ''
  }
  noteListFilterConfig = {
    isArchived: false as boolean | null,
    isRecycle: false,
    isShare: null as boolean | null,
    type: 0,
    tagId: null as number | null,
    withoutTag: false,
    withFile: false,
    withLink: false,
    isUseAiQuery: false,
    startDate: null as Date | null,
    endDate: null as Date | null,
    hasTodo: false,
    // CUSTOM-JOURNAL: entry sort, surfaced in FilterPop's "Sort" section.
    // 'date' + orderBy keeps the pre-existing newest/oldest behavior.
    sortField: 'date' as 'date' | 'size' | 'mood',
    moodAxisId: null as number | null,
    orderBy: 'desc' as 'asc' | 'desc'
  }
  // CUSTOM-JOURNAL: drives the filter button's active/highlighted state in
  // FilterPop -- true whenever any filter field differs from its "no filter
  // applied" default. isArchived/isRecycle/type/sortField/orderBy are
  // deliberately excluded: those are view-mode/sort selections, not
  // "filters" in the sense this indicator is meant to surface.
  get hasActiveFilter(): boolean {
    const cfg = this.noteListFilterConfig;
    return (
      cfg.tagId != null ||
      cfg.withoutTag ||
      cfg.withFile ||
      cfg.withLink ||
      !!cfg.isShare ||
      cfg.hasTodo ||
      cfg.startDate != null ||
      cfg.endDate != null
    );
  }
  noteTypeDefault: NoteType = NoteType.BLINKO
  currentCommonFilter: filterType | null = null
  updateTicker = 0
  fullNoteList: Note[] = []

  // For global search
  globalSearchTerm!: '';
  // Will be set to true when the global search modal is opened
  isGlobalSearchOpen!: false;
  // For search results presentation
  searchResults = {
    notes: [],
    resources: [],
    settings: []
  };

  offlineNoteStorage = new StorageListState<OfflineNote>({ key: 'offlineNotes' });

  get offlineNotes(): OfflineNote[] {
    return this.offlineNoteStorage.list;
  }

  get isOnline(): boolean {
    return RootStore.Get(BaseStore).isOnline;
  }

  private saveOfflineNote(note: OfflineNote) {
    this.offlineNoteStorage.push(note);
  }

  private removeOfflineNote(id: number) {
    const index = this.offlineNoteStorage.list?.findIndex(note => note.id === id);
    if (index !== -1) {
      this.offlineNoteStorage.remove(index);
    }
  }

  private async getFilteredNotes(params: {
    page: number;
    size: number;
    filterConfig: any;
    offlineFilter?: (note: OfflineNote) => boolean | undefined;
  }) {
    const { page, size, filterConfig, offlineFilter = () => true } = params;
    let notes: Note[] = [];

    if (this.isOnline) {
      const queryParams = { 
        ...this.noteListFilterConfig, 
        ...filterConfig,
        searchText: this.searchText, 
        page, 
        size 
      };
      notes = await api.notes.list.mutate(queryParams);

      
      if (this.offlineNotes.length > 0) {
        await this.syncOfflineNotes();
      }
    }

    const filteredOfflineNotes = this.offlineNotes.filter(offlineFilter);
    const mergedNotes = [...filteredOfflineNotes, ...notes].map(i => ({ ...i, isExpand: false }));

    if (!this.isOnline) {
      const start = (page - 1) * size;
      const end = start + size;
      return mergedNotes.slice(start, end);
    }

    return mergedNotes;
  }

  upsertNote = new PromiseState({
    eventKey: 'upsertNote',
    function: async (params: UpsertNoteParams) => {
      console.log("upsertNote", params)
      const {
        content = null,
        isArchived,
        isRecycle,
        type,
        id,
        attachments = [],
        refresh = true,
        isTop,
        isShare,
        showToast = true,
        references = [],
        createdAt: inputCreatedAt,
        updatedAt: inputUpdatedAt,
        metadata
      } = params;

      if (!this.isOnline && !id) {
        const now = new Date();
        const offlineNote: OfflineNote = {
          id: now.getTime(),
          content: content || '',
          type,
          isArchived: !!isArchived,
          isRecycle: !!isRecycle,
          attachments: attachments || [],
          isTop: !!isTop,
          isShare: !!isShare,
          references: references.map(refId => ({ toNoteId: refId })),
          createdAt: now,
          updatedAt: now,
          isOffline: true,
          pendingSync: true,
          tags: [],
          metadata: metadata || {}
        };

        this.saveOfflineNote(offlineNote);
        showToast && RootStore.Get(ToastPlugin).success(i18n.t("create-successfully") + '-' + i18n.t("offline-status"));
        return offlineNote;
      }

      const res = await api.notes.upsert.mutate({
        content,
        type,
        isArchived,
        isRecycle,
        id,
        attachments,
        isTop,
        isShare,
        references,
        createdAt: inputCreatedAt ? new Date(inputCreatedAt) : undefined,
        updatedAt: inputUpdatedAt ? new Date(inputUpdatedAt) : undefined,
        metadata
      });
      eventBus.emit('editor:clear')
      showToast && RootStore.Get(ToastPlugin).success(id ? i18n.t("update-successfully") : i18n.t("create-successfully"))
      refresh && this.updateTicker++
      return res
    }
  })

  shareNote = new PromiseState({
    function: async (params: { id: number, isCancel: boolean, password?: string, expireAt?: Date }) => {
      const res = await api.notes.shareNote.mutate(params)
      RootStore.Get(ToastPlugin).success(i18n.t("operation-success"))
      this.updateTicker++
      return res
    }
  })

  internalShareNote = new PromiseState({
    function: async (params: { id: number, accountIds: number[], isCancel: boolean }) => {
      const res = await api.notes.internalShareNote.mutate(params)
      RootStore.Get(ToastPlugin).success(i18n.t("operation-success"))
      this.updateTicker++
      return res
    }
  })

  getInternalSharedUsers = new PromiseState({
    function: async (id: number) => {
      return await api.notes.getInternalSharedUsers.mutate({ id })
    }
  })

  async syncOfflineNotes() {
    if (!this.isOnline) return;

    const offlineNotes = [...this.offlineNotes];
    for (const note of offlineNotes) {
      if (note.pendingSync) {
        try {
          const { id, isOffline, pendingSync, references, ...noteData } = note;
          const onlineNote: UpsertNoteParams = {
            ...noteData,
            references: references.map(ref => ref.toNoteId),
            showToast: false
          };
          await this.upsertNote.call(onlineNote);
          this.removeOfflineNote(id);
        } catch (error) {
          console.error('Failed to sync offline note:', error);
        }
      }
    }
    this.updateTicker++;
  }

  blinkoList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.BLINKO,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.BLINKO && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  noteOnlyList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.NOTE,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.NOTE && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  todoList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          type: NoteType.TODO,
          isArchived: false,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.type === NoteType.TODO && !note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  archivedList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isArchived: true,
          isRecycle: false
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.isArchived && !note.isRecycle);
        }
      });
    }
  })

  trashList = new PromisePageState({
    function: async ({ page, size }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isRecycle: true
        },
        offlineFilter: (note: OfflineNote) => {
          return Boolean(note.isRecycle);
        }
      });
    }
  })

  noteList = new PromisePageState({
    function: async ({ page, size, ...filterConfig }) => {
      return this.getFilteredNotes({
        page,
        size,
        filterConfig: {
          isArchived: false,
          ...filterConfig
        },
        offlineFilter: (note) => {
          // Exclude notes in recycle bin
          return !note.isRecycle;
        }
      });
    }
  })

  referenceSearchList = new PromisePageState({
    function: async ({ page, size, searchText }) => {
      return await api.notes.list.mutate({
        searchText
      })
    }
  })

  userList = new PromiseState({
    function: async () => {
      return await api.users.list.query()
    }
  })

  noteDetail = new PromiseState({
    function: async ({ id }) => {
      return await api.notes.detail.mutate({ id })
    }
  })

  dailyReviewNoteList = new PromiseState({
    function: async () => {
      return await api.notes.dailyReviewNoteList.query()
    }
  })

  randomReviewNoteList = new PromiseState({
    function: async ({ limit = 30 }) => {
      return await api.notes.randomNoteList.query({ limit })
    }
  })

  resourceList = new PromisePageState({
    function: async ({ page, size, searchText, folder }) => {
      return await api.attachments.list.query({ page, size, searchText, folder })
    }
  })

  tagList = new PromiseState({
    function: async () => {
      const falttenTags = await api.tags.list.query(undefined, { context: { skipBatch: true } });
      const listTags = helper.buildHashTagTreeFromDb(falttenTags)
      console.log(falttenTags, 'listTags')
      let pathTags: string[] = [];
      listTags.forEach(node => {
        pathTags = pathTags.concat(helper.generateTagPaths(node));
      });
      return { falttenTags, listTags, pathTags }
    }
  })

  get showAi() {
    return true
  }

  config = new PromiseState({
    loadingLock: false,
    function: async () => {
      const res = await api.config.list.query()
      return res
    }
  })

  task = new PromiseState({
    function: async () => {
      try {
        if (RootStore.Get(UserStore).role == 'superadmin') {
          return (await api.task.list.query()) ?? [];
        }
        return []
      } catch (error) {
        return []
      }
    }
  })

  updateDBTask = new PromiseState({
    function: async (isStart) => {
      if (isStart) {
        await api.task.upsertTask.mutate({ type: 'start', task: DBBAK_TASK_NAME })
      } else {
        await api.task.upsertTask.mutate({ type: 'stop', task: DBBAK_TASK_NAME })
      }
      await this.task.call()
    }
  })
  updatePurgeTrashTask = new PromiseState({
    function: async (isStart) => {
      if (isStart) {
        await api.task.upsertTask.mutate({ type: 'start', task: PURGE_TRASH_TASK_NAME })
      } else {
        await api.task.upsertTask.mutate({ type: 'stop', task: PURGE_TRASH_TASK_NAME })
      }
      await this.task.call()
    }
  })


  get DBTask() {
    return this.task.value?.find(i => i.name == DBBAK_TASK_NAME)
  }

  get PurgeTrashTask() {
    return this.task.value?.find(i => i.name == PURGE_TRASH_TASK_NAME)
  }


  async onBottom() {
    const currentPath = new URLSearchParams(window.location.search).get('path');

    if (currentPath === 'notes') {
      await this.noteOnlyList.callNextPage({});
    } else if (currentPath === 'todo') {
      await this.todoList.callNextPage({});
    } else if (currentPath === 'archived') {
      await this.archivedList.callNextPage({});
    } else if (currentPath === 'trash') {
      await this.trashList.callNextPage({});
    } else if (currentPath === 'all') {
      // CUSTOM-JOURNAL: was resetAndCall({}), which resets to page 1 and
      // re-fetches it on every scroll-to-bottom instead of advancing --
      // infinite scroll on a tag-filtered (?path=all) list looked like it
      // was loading but never appended anything new.
      await this.noteList.callNextPage({});
    } else {
      // CUSTOM-JOURNAL: aligned with index.tsx's default render branch
      // (noteOnlyList) -- currently unreachable in normal nav (every real
      // path value is handled above), fixed for consistency.
      await this.noteOnlyList.callNextPage({});
    }
  }

  onMultiSelectNote(id: number) {
    if (this.curMultiSelectIds.includes(id)) {
      this.curMultiSelectIds = this.curMultiSelectIds.filter(item => item !== id);
    } else {
      this.curMultiSelectIds.push(id);
    }
    if (this.curMultiSelectIds.length == 0) {
      this.isMultiSelectMode = false
    }
  }

  onMultiSelectRest() {
    this.isMultiSelectMode = false
    this.curMultiSelectIds = []
    // Fix: Remove updateTicker++ to avoid unnecessary list refresh and duplicate display
    // this.updateTicker++
  }

  firstLoad() {
    this.tagList.call()
    this.config.call()
    this.dailyReviewNoteList.call()
    this.task.call()
  }


  async refreshData() {
    // Fix: Clear multi-select state when refreshing data to avoid stale selections
    this.curMultiSelectIds = [];
    this.isMultiSelectMode = false;

    this.tagList.call()

    const currentPath = new URLSearchParams(window.location.search).get('path');
    
    if (currentPath === 'notes') {
      this.noteOnlyList.resetAndCall({});
    } else if (currentPath === 'todo') {
      this.todoList.resetAndCall({});
    } else if (currentPath === 'archived') {
      this.archivedList.resetAndCall({});
    } else if (currentPath === 'trash') {
      this.trashList.resetAndCall({});
    } else if (currentPath === 'all') {
      this.noteList.resetAndCall({});
    } else {
      // CUSTOM-JOURNAL: matches useQuery()'s own default-path fix above --
      // was blinkoList, but the bare root path renders noteOnlyList.
      this.noteOnlyList.resetAndCall({});
    }

    this.config.call()
    this.dailyReviewNoteList.call()
  }

  private clear() {
    this.createContentStorage.clear()
    this.editContentStorage.clear()
  }

  use() {
    useEffect(() => {
      if (RootStore.Get(UserStore).id) {
        console.log('firstLoad', RootStore.Get(UserStore).id)
        this.firstLoad()
      }
    }, [RootStore.Get(UserStore).id])

    useEffect(() => {
      if (this.updateTicker == 0) return
      console.log('updateTicker', this.updateTicker)
      this.refreshData()
    }, [this.updateTicker])
  }

  useQuery() {
    const [searchParams] = useSearchParams();
    const location = useLocation();
    useEffect(() => {
      // CUSTOM-JOURNAL: this effect's job is now ONLY the cold-load/deep-link
      // case (a URL with filter params arriving with no prior interactive
      // state, e.g. a pasted ?path=all&tagId=7 link) and path-tab switching.
      // Ordinary interactive filter changes (tag-chip click, sidebar tag
      // click, FilterPop Apply/Reset) go through applyFilter()/
      // updateTagFilter() directly (see those methods) and don't depend on
      // this effect at all anymore. This used to early-return here whenever
      // the URL's tagId already matched noteListFilterConfig.tagId -- which
      // silently skipped the resetAndCall() below (the only thing that
      // actually re-queries the backend) on repeat/rapid tag interactions,
      // even though the URL/UI looked correctly filtered. Removed outright
      // rather than tightened, since the direct-write path above now owns
      // every interactive case this guard was trying to shortcut; any
      // resulting redundant re-fetch here is harmless (not state-corrupting)
      // once PromiseState's loadingLock fix is in place.
      const tagId = searchParams.get('tagId');
      const withoutTag = searchParams.get('withoutTag');
      const withFile = searchParams.get('withFile');
      const withLink = searchParams.get('withLink');
      const searchText = searchParams.get('searchText') || this.searchText;
      const hasTodo = searchParams.get('hasTodo');
      const path = searchParams.get('path');

      this.noteListFilterConfig.type = NoteType.BLINKO
      this.noteTypeDefault = NoteType.BLINKO
      this.noteListFilterConfig.tagId = null
      this.noteListFilterConfig.isArchived = false
      this.noteListFilterConfig.withoutTag = false
      this.noteListFilterConfig.withLink = false
      this.noteListFilterConfig.withFile = false
      this.noteListFilterConfig.isRecycle = false
      this.noteListFilterConfig.startDate = null
      this.noteListFilterConfig.endDate = null
      this.noteListFilterConfig.isShare = null
      this.noteListFilterConfig.hasTodo = false
      this.noteListFilterConfig.sortField = 'date'
      this.noteListFilterConfig.moodAxisId = null
      this.noteListFilterConfig.orderBy = 'desc'

      // Fix: Clear multi-select state when switching paths to avoid stale selections
      this.curMultiSelectIds = [];
      this.isMultiSelectMode = false;

      // CUSTOM-JOURNAL: every URL-derived filter field (tagId, withoutTag,
      // withLink, withFile, hasTodo, searchText) must be written into
      // noteListFilterConfig BEFORE any resetAndCall() below fires -- these
      // read the filter config synchronously to build their query, so
      // applying tagId etc. *after* the call (as this used to) meant a
      // fresh tag-chip click (?tagId=7) updated the URL and the MobX field
      // correctly, but the actual fetch that just fired still went out
      // unfiltered. Reopening the filter popup showed the tag as "selected"
      // (it reads the same, now-correct, field) which is why clicking
      // Apply there appeared to fix it -- Apply's resetAndCall() came after
      // tagId was already set, this one didn't.
      if (tagId) {
        this.noteListFilterConfig.tagId = Number(tagId) as number
      }
      if (withoutTag) {
        this.noteListFilterConfig.withoutTag = true
      }
      if (withLink) {
        this.noteListFilterConfig.withLink = true
      }
      if (withFile) {
        this.noteListFilterConfig.withFile = true
      }
      if (hasTodo) {
        this.noteListFilterConfig.hasTodo = true
      }
      if (searchText) {
        this.searchText = searchText as string;
      } else {
        this.searchText = '';
      }

      if (path == 'notes') {
        this.noteListFilterConfig.type = NoteType.NOTE
        this.noteOnlyList.resetAndCall({});
      } else if (path == 'todo') {
        this.noteListFilterConfig.type = NoteType.TODO
        this.todoList.resetAndCall({});
      } else if (path == 'all') {
        this.noteListFilterConfig.type = -1
        this.noteList.resetAndCall({});
      } else if (path == 'archived') {
        this.noteListFilterConfig.type = -1
        this.noteListFilterConfig.isArchived = true
        this.archivedList.resetAndCall({});
      } else if (path == 'trash') {
        this.noteListFilterConfig.type = -1
        this.noteListFilterConfig.isRecycle = true
        this.trashList.resetAndCall({});
      } else {
        // CUSTOM-JOURNAL: was blinkoList.resetAndCall({}) -- the bare root
        // path (no ?path= at all, e.g. straight after login) renders
        // noteOnlyList by default (see pages/index.tsx's currentListState),
        // not blinkoList (this journal only ever creates NoteType.NOTE
        // entries, see baseStore.ts's routerList comment). Querying the
        // wrong list here meant the home page's actually-rendered list was
        // never fetched at all on a fresh cold load, showing an empty page
        // until some other action happened to trigger it.
        this.noteListFilterConfig.type = NoteType.NOTE
        this.noteOnlyList.resetAndCall({});
      }
    }, [this.forceQuery, location.pathname, searchParams])
  }

  excludeEmbeddingTagId: number | null = null;

  setExcludeEmbeddingTagId(tagId: number | null) {
    this.excludeEmbeddingTagId = tagId;
  }

  settingsSearchText: string = '';
  constructor() {
    makeAutoObservable(this)
    eventBus.on('user:signout', () => {
      this.clear()
    })
  }

  removeCreateAttachments(file: { name: string, }) {
    this.createAttachmentsStorage.removeByFind(f => f.name === file.name);
    this.updateTicker++;
  }

  // CUSTOM-JOURNAL: single source of truth for "which list is active" for a
  // given ?path= value -- previously duplicated between here (implicitly,
  // via updateTagFilter always targeting noteList) and FilterPop's own local
  // getActiveList(). Centralized so every filter-changing call site shares
  // one answer.
  getActiveList(path: string | null) {
    switch (path) {
      case 'notes': return this.noteOnlyList;
      case 'todo': return this.todoList;
      case 'all': return this.noteList;
      case 'archived': return this.archivedList;
      case 'trash': return this.trashList;
      default: return this.noteOnlyList;
    }
  }

  // CUSTOM-JOURNAL: single source of truth for filter changes -- every
  // interactive filter action (tag-chip click, sidebar tag click, FilterPop
  // Apply/Reset) should go through this instead of writing
  // noteListFilterConfig directly or relying on useQuery()'s URL-parsing
  // effect to pick it up. Order matters: (1) apply the patch to
  // noteListFilterConfig synchronously so any code reading it immediately
  // after this call (e.g. FilterPop reopening) sees the new state, (2)
  // resetAndCall() on whichever list is actually on screen right now -- the
  // URL (updated separately, by the caller) is a deep-link mirror of this
  // state, not the trigger for it.
  applyFilter(patch: Partial<typeof this.noteListFilterConfig>, path: string | null) {
    Object.assign(this.noteListFilterConfig, patch);
    this.getActiveList(path).resetAndCall({});
  }

  updateTagFilter(tagId: number) {
    this.applyFilter({ tagId, type: -1 }, 'all');
  }
}
