import { observer } from "mobx-react-lite";
import { BlinkoStore } from '@/store/blinkoStore';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, DatePicker } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, ContextMenuItem } from '@/components/Common/ContextMenu';
import { Icon } from '@/components/Common/Iconify/icons';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { RootStore } from "@/store";
import { DialogStore } from "@/store/module/Dialog";
import { BlinkoEditor } from "../BlinkoEditor";
import { useEffect, useState } from "react";
import { parseAbsoluteToLocal } from "@internationalized/date";
import i18n from "@/lib/i18n";
import { BlinkoShareDialog } from "../BlinkoShareDialog";
import { getBlinkoEndpoint } from "@/lib/blinkoEndpoint";
import { BaseStore } from "@/store/baseStore";
import { PluginApiStore } from "@/store/plugin/pluginApiStore";
import { ToastPlugin } from "@/store/module/Toast/Toast";
import { Note } from "@shared/lib/types";
import { BlinkoCard } from "../BlinkoCard";
import { useLocation } from "react-router-dom";
import { ShowCommentDialog } from "../BlinkoCard/commentButton";
import { useMediaQuery } from "usehooks-ts";
import { FocusEditorFixMobile } from "@/components/Common/Editor/editorUtils";
import { helper } from "@/lib/helper";
import { TagPicker } from "@/components/Common/TagPicker";
import { SentimentView } from "@/components/Common/SentimentView";
import { moodAxis } from "@shared/lib/prismaZodType";
import { showTipsDialog } from "@/components/Common/TipsDialog";
import { DialogStandaloneStore } from "@/store/module/DialogStandalone";
import dayjs from "@/lib/dayjs";
import { aiTaskLog } from "@shared/lib/prismaZodType";


export const ShowEditTimeModel = (showExpired: boolean = false) => {
  const blinko = RootStore.Get(BlinkoStore)
  RootStore.Get(DialogStore).setData({
    size: 'sm' as any,
    isOpen: true,
    onlyContent: true,
    isDismissable: false,
    showOnlyContentCloseButton: true,
    content: () => {
      const [createdAt, setCreatedAt] = useState(blinko.curSelectedNote?.createdAt ?
        parseAbsoluteToLocal(blinko.curSelectedNote.createdAt.toISOString()) : null);

      const [updatedAt, setUpdatedAt] = useState(blinko.curSelectedNote?.updatedAt ?
        parseAbsoluteToLocal(blinko.curSelectedNote.updatedAt.toISOString()) : null);

      const [expireAt, setExpireAt] = useState(blinko.curSelectedNote?.metadata?.expireAt ?
        parseAbsoluteToLocal(new Date(blinko.curSelectedNote.metadata.expireAt).toISOString()) : null);

      const handleSave = () => {
        if (showExpired) {
          // Handle expired date save
          const existingMetadata = blinko.curSelectedNote?.metadata || {};
          
          blinko.upsertNote.call({
            id: blinko.curSelectedNote?.id,
            metadata: {
              ...existingMetadata,
              expireAt: expireAt ? expireAt.toDate().toISOString() : null
            }
          });
        } else {
          // Handle created/updated date save
          if (!createdAt || !updatedAt) return;

          blinko.upsertNote.call({
            id: blinko.curSelectedNote?.id,
            createdAt: createdAt.toDate(),
            updatedAt: updatedAt.toDate()
          });
        }

        RootStore.Get(DialogStore).close();
      }

      return <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 p-4">
          {showExpired ? (
            // Show expired date picker for TODO
            <>
              <DatePicker
                label={i18n.t('expiry-time')}
                value={expireAt}
                onChange={setExpireAt}
                labelPlacement="outside"
                showMonthAndYearPickers
                granularity="second"
                hideTimeZone
              />
              
              {/* Quick time selection buttons */}
              <div className="flex flex-col gap-2">
                <div className="text-sm text-gray-600 font-medium">{i18n.t('quick-select') || 'Quick Select'}:</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="bordered"
                    onPress={() => {
                      const now = new Date();
                      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                      setExpireAt(parseAbsoluteToLocal(tomorrow.toISOString()));
                    }}
                  >
                    {i18n.t('1-day') || '1 Day'}
                  </Button>
                  <Button
                    size="sm"
                    variant="bordered"
                    onPress={() => {
                      const now = new Date();
                      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                      setExpireAt(parseAbsoluteToLocal(nextWeek.toISOString()));
                    }}
                  >
                    {i18n.t('1-week') || '1 Week'}
                  </Button>
                  <Button
                    size="sm"
                    variant="bordered"
                    onPress={() => {
                      const now = new Date();
                      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
                      setExpireAt(parseAbsoluteToLocal(nextMonth.toISOString()));
                    }}
                  >
                    {i18n.t('1-month') || '1 Month'}
                  </Button>
                  <Button
                    size="sm"
                    variant="bordered"
                    color="warning"
                    onPress={() => {
                      setExpireAt(null);
                    }}
                  >
                    {i18n.t('cancel')}
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  color="primary"
                  className="flex-1"
                  onPress={handleSave}
                >
                  {i18n.t('save')}
                </Button>
              </div>
            </>
          ) : (
            // Show created/updated date pickers
            <>
              <DatePicker
                label={i18n.t('created-at')}
                value={createdAt}
                onChange={setCreatedAt}
                labelPlacement="outside"
                granularity="second"
                hideTimeZone
              />
              <DatePicker
                label={i18n.t('updated-at')}
                value={updatedAt}
                onChange={setUpdatedAt}
                labelPlacement="outside"
                granularity="second"
                hideTimeZone
              />
              <Button
                color="primary"
                className="mt-2"
                onPress={handleSave}
              >
                {i18n.t('save')}
              </Button>
            </>
          )}
        </div>
      </div>
    }
  })
}

export const ShowEditBlinkoModel = (size: string = '2xl', mode: 'create' | 'edit' = 'edit', initialData?: { file?: File, text?: string }) => {
  const blinko = RootStore.Get(BlinkoStore)
  RootStore.Get(DialogStore).setData({
    size: size as any,
    isOpen: true,
    onlyContent: true,
    isDismissable: false,
    showOnlyContentCloseButton: true,
    content: <BlinkoEditor isInDialog mode={mode} initialData={initialData} key={`editor-key-${mode}`} onSended={() => {
      RootStore.Get(DialogStore).close()
      blinko.isCreateMode = false
    }} />
  })
}

const handleEdit = (isDetailPage: boolean) => {
  ShowEditBlinkoModel(isDetailPage ? '5xl' : '5xl')
  FocusEditorFixMobile()
}

const handleMultiSelect = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.isMultiSelectMode = true
  blinko.onMultiSelectNote(blinko.curSelectedNote?.id!)
}

const handleSelectAll = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.isMultiSelectMode = true

  const currentPath = new URLSearchParams(window.location.search).get('path');
  let items: Array<{ id?: number | null }> | undefined;

  if (currentPath === 'notes') {
    items = blinko.noteOnlyList.value;
  } else if (currentPath === 'todo') {
    items = blinko.todoList.value;
  } else if (currentPath === 'archived') {
    items = blinko.archivedList.value;
  } else if (currentPath === 'trash') {
    items = blinko.trashList.value;
  } else if (currentPath === 'all') {
    items = blinko.noteList.value;
  } else {
    items = blinko.blinkoList.value;
  }

  const ids = (items || [])
    .map(n => n.id)
    .filter((id): id is number => typeof id === 'number');

  // Assign directly to avoid toggle side-effects
  blinko.curMultiSelectIds = Array.from(new Set(ids));
}

const handleTop = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.upsertNote.call({
    id: blinko.curSelectedNote?.id,
    isTop: !blinko.curSelectedNote?.isTop
  })
}

const handlePublic = () => {
  const blinko = RootStore.Get(BlinkoStore)
  RootStore.Get(DialogStore).setData({
    size: 'md' as any,
    isOpen: true,
    title: i18n.t('share'),
    isDismissable: false,
    content: <BlinkoShareDialog defaultSettings={{
      shareUrl: blinko.curSelectedNote?.shareEncryptedUrl ? getBlinkoEndpoint('/share/' + blinko.curSelectedNote.shareEncryptedUrl) : undefined,
      expiryDate: blinko.curSelectedNote?.shareExpiryDate ?? undefined,
      password: blinko.curSelectedNote?.sharePassword ?? '',
      isShare: blinko.curSelectedNote?.isShare
    }} />
  })

  // blinko.upsertNote.call({
  //   id: blinko.curSelectedNote?.id,
  //   isShare: !blinko.curSelectedNote?.isShare
  // })
}

// CUSTOM-JOURNAL: used to be a 3-way archive/unarchive/restore toggle
// (handleArchived). The Archive feature was dropped for a single recycle
// bin -- this is now restore-from-trash only, and RestoreItem below only
// renders this menu entry when the note is actually in the trash. Doesn't
// touch isArchived: that field is unrelated here, still used as the
// TODO-type "complete" flag (see cardHeader.tsx's handleTodoToggle) -- a
// completed todo that gets trashed and restored should stay completed.
const handleRestore = () => {
  const blinko = RootStore.Get(BlinkoStore)
  if (!blinko.curSelectedNote?.isRecycle) return
  return blinko.upsertNote.call({
    id: blinko.curSelectedNote?.id,
    isRecycle: false,
  })
}

// CUSTOM-JOURNAL: transcribes any pending audio attachment on this note
// on demand -- transcribeAndAppend already existed (called internally from
// note create/update), this is just its first direct menu entry point,
// separate from the combined "Re-run AI analysis" action below.
const handleTranscribe = async () => {
  const blinko = RootStore.Get(BlinkoStore)
  const toast = RootStore.Get(ToastPlugin)
  const noteId = blinko.curSelectedNote?.id
  if (!noteId) return
  try {
    toast.loading(i18n.t('transcribing-audio'))
    const result = await api.ai.transcribeNote.mutate({ noteId })
    toast.dismiss()
    // CUSTOM-JOURNAL: previously just dismissed the loading toast either
    // way -- a note whose audio attachment was already marked transcribed
    // (from any prior attempt, even one that produced nothing) made this
    // silently no-op with zero visible feedback: a toast that flashed and
    // vanished, no error, no log entry, nothing to go on. transcribeNote
    // now forces a retry and returns a real reason on failure -- surface it.
    if (!result.transcribedAny) {
      toast.error(result.message || i18n.t('operation-failed'))
      return
    }
    toast.success(i18n.t('your-changes-have-been-saved'))
    blinko.updateTicker++
  } catch (error: any) {
    toast.dismiss()
    toast.error(error?.message || i18n.t('operation-failed'))
  }
}

// CUSTOM-JOURNAL: replaces the old handleAITag (aiStore.autoTag -- a
// separate, unfixed code path: raw TagAgent.generate() with the upstream
// hardcoded-existing-tag-list/slash-hierarchy prompt, returning suggestions
// for a manual pick-and-insert dialog, no mood scoring at all). This calls
// the real pipeline (transcribe pending audio, suggest+auto-apply tags,
// score mood) via AiService.reanalyzeNote -- tags/mood land automatically,
// same as a live post-processing pass, no picker dialog needed.
const handleReanalyze = async () => {
  const blinko = RootStore.Get(BlinkoStore)
  const toast = RootStore.Get(ToastPlugin)
  const noteId = blinko.curSelectedNote?.id
  if (!noteId) return
  try {
    toast.loading(i18n.t('thinking'))
    await api.ai.reanalyzeNote.mutate({ noteId })
    toast.dismiss()
    blinko.updateTicker++
  } catch (error: any) {
    toast.dismiss()
    toast.error(error?.message || i18n.t('operation-failed'))
  }
}

// CUSTOM-JOURNAL: manual "add/remove tags on this entry" dialog, distinct
// from ReanalyzeItem above (which asks the AI to suggest and auto-apply
// tags) -- opens the shared TagPicker scoped to whichever note the menu was
// triggered on.
const AddTagDialogContent = observer(() => {
  const blinko = RootStore.Get(BlinkoStore)
  const note = blinko.curSelectedNote
  const noteId = note?.id ? Number(note.id) : undefined
  const tagTree = helper.buildHashTagTreeFromDb(((note?.tags as any) || []).map((t: any) => t.tag))
  const currentTags = tagTree.flatMap((n: any) => helper.generateTagPaths(n))

  if (!noteId) return null

  // CUSTOM-JOURNAL: currentTags is derived from blinko.curSelectedNote, a
  // one-time snapshot taken when the menu was opened (see cardHeader.tsx's
  // ShowEditTimeModel-style _.cloneDeep pattern) -- forceQuery++ alone
  // refetches the underlying LIST, but never touches this snapshot, so a
  // removed tag's chip stayed visible here (the delete had genuinely
  // already happened server-side) until the dialog was closed and reopened
  // against fresh data. Re-fetch and reassign curSelectedNote directly so
  // this dialog (an observer) picks up the change immediately.
  const refreshCurrentNote = async () => {
    const fresh = await blinko.noteDetail.call({ id: noteId })
    if (fresh) blinko.curSelectedNote = fresh as any
  }

  // CUSTOM-JOURNAL: same {path -> tag id} reconstruction TagList/index.tsx's
  // goToTag uses -- buildHashTagTreeFromDb already computes each node's full
  // path (node.metadata.path) alongside its real DB id.
  const flattenWithId = (node: any): { path: string; id: number }[] => [
    { path: node.metadata.path, id: node.id },
    ...((node.children || []) as any[]).flatMap(flattenWithId),
  ];
  const pathToId = new Map(tagTree.flatMap(flattenWithId).map(({ path, id }) => [path, id]));

  return (
    <div className="pb-2">
      <TagPicker
        currentTags={currentTags}
        onAdd={(path) => {
          api.tags.attachToNote.mutate({ noteId, tagPath: path })
            .then(() => { blinko.forceQuery++; refreshCurrentNote() })
            .catch((error: any) => {
              RootStore.Get(ToastPlugin).error(error?.message || i18n.t('operation-failed'))
            })
        }}
        onRemove={(path) => {
          // CUSTOM-JOURNAL: optimistic -- remove the chip immediately
          // instead of waiting on the round trip (that lag was the actual
          // complaint; the previous fix above only addressed a *stale*
          // chip lingering after the request had already finished). Roll
          // back to the pre-removal tag list and toast if the mutation
          // actually fails.
          const tagId = pathToId.get(path)
          const prevNote = note
          if (tagId != null && prevNote) {
            blinko.curSelectedNote = {
              ...prevNote,
              tags: (prevNote.tags as any[]).filter((t: any) => t.tag?.id !== tagId),
            } as any
          }
          api.tags.detachFromNote.mutate({ noteId, tagPath: path })
            .then(() => { blinko.forceQuery++; refreshCurrentNote() })
            .catch((error: any) => {
              if (prevNote) blinko.curSelectedNote = prevNote
              RootStore.Get(ToastPlugin).error(error?.message || i18n.t('operation-failed'))
            })
        }}
      />
    </div>
  )
})

const handleAddTag = () => {
  RootStore.Get(DialogStore).setData({
    isOpen: true,
    title: i18n.t('edit-tags'),
    content: <AddTagDialogContent />
  })
}

// CUSTOM-JOURNAL: "View Sentiments" dialog -- shows the mood-axis scores the
// post-processing pipeline (see aiServer/index.ts's scoreMood) already
// generated for this note, if any. Fetches the axis definitions (label
// text, bipolar vs unipolar) fresh each open since they
// can be edited/added in AI Settings at any time.
const ViewSentimentsDialogContent = observer(() => {
  const blinko = RootStore.Get(BlinkoStore)
  const note = blinko.curSelectedNote
  const [axes, setAxes] = useState<moodAxis[] | null>(null)

  useEffect(() => {
    api.ai.moodAxisList.query().then(setAxes).catch(() => setAxes([]))
  }, [])

  if (!axes) {
    return <div className="flex justify-center py-6"><Icon icon="line-md:loading-twotone-loop" width="24" height="24" /></div>
  }

  return <SentimentView axes={axes} moodScores={note?.moodScores as Record<string, number> | null | undefined} />
})

const handleViewSentiments = () => {
  RootStore.Get(DialogStore).setData({
    isOpen: true,
    title: i18n.t('view-sentiments'),
    content: <ViewSentimentsDialogContent />
  })
}

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4 text-sm py-1 border-b border-default-100 last:border-b-0">
    <span className="text-default-500">{label}</span>
    <span className="text-right">{value}</span>
  </div>
)

// CUSTOM-JOURNAL: "Info" -- a "nitty gritty details" panel for interested
// users, deliberately NOT duplicating tags (TagList on the card) or mood
// scores ("View Sentiments" above) which already have dedicated UI. Fields
// come straight off the already-loaded note object (notes.list has no
// restrictive select, returns all scalars -- see notesSchema) except the AI
// Task Log rows (attempts / time to generate), fetched on open via
// aiTaskLogList's noteId filter. Reuses the same centered DialogStore modal
// ViewSentiments above uses.
// CUSTOM-JOURNAL: same icon/color-by-status convention as AiTaskLogSection.tsx
// and RagSettingsSection.tsx's history logs -- kept as its own small copy
// rather than extracted to a shared module, since each caller's row layout
// differs enough that a shared component wouldn't save much.
const INFO_STATUS_ICON: Record<string, { icon: string; color: string }> = {
  running: { icon: 'line-md:loading-twotone-loop', color: 'text-primary' },
  success: { icon: 'mingcute:check-circle-line', color: 'text-success' },
  error: { icon: 'mingcute:close-circle-line', color: 'text-danger' },
  stopped: { icon: 'mingcute:stop-circle-line', color: 'text-warning' },
};

const InfoDialogContent = observer(() => {
  const blinko = RootStore.Get(BlinkoStore)
  const note = blinko.curSelectedNote
  const [logs, setLogs] = useState<aiTaskLog[] | null>(null)

  useEffect(() => {
    if (!note?.id) return
    api.ai.aiTaskLogList.query({ noteId: note.id, size: 50 }).then(setLogs).catch(() => setLogs([]))
  }, [note?.id])

  const fmt = (d: any) => d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : i18n.t('never')

  return (
    <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
      <div className="flex flex-col">
        <InfoRow label="ID" value={String(note?.id ?? '-')} />
        <InfoRow label={i18n.t('created-at')} value={fmt(note?.createdAt)} />
        <InfoRow label={i18n.t('updated-at')} value={fmt(note?.updatedAt)} />
        <InfoRow label={i18n.t('ai-tagged-at')} value={fmt(note?.aiTaggedAt)} />
        <InfoRow label={i18n.t('rag-indexed-at')} value={note?.embeddedAt ? fmt(note.embeddedAt) : i18n.t('not-indexed-yet')} />
        <InfoRow label={i18n.t('content-length')} value={String(note?.contentLength ?? note?.content?.length ?? 0)} />
        <InfoRow label={i18n.t('is-top')} value={note?.isTop ? i18n.t('yes') : i18n.t('no')} />
        <InfoRow label={i18n.t('is-archived')} value={note?.isArchived ? i18n.t('yes') : i18n.t('no')} />
        <InfoRow label={i18n.t('is-reviewed')} value={note?.isReviewed ? i18n.t('yes') : i18n.t('no')} />
        <InfoRow label={i18n.t('is-shared')} value={note?.isShare ? i18n.t('yes') : i18n.t('no')} />
        {note?.isShare && (
          <InfoRow label={i18n.t('share-view-count')} value={`${note?.shareViewCount ?? 0}${note?.shareMaxView ? ` / ${note.shareMaxView}` : ''}`} />
        )}
        {note?.attachments?.map(a => (
          <InfoRow key={a.id} label={`${i18n.t('transcribed-at')}: ${a.name}`} value={fmt(a.transcribedAt)} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">{i18n.t('ai-task-history')}</div>
        {logs == null ? (
          <div className="flex justify-center py-4"><Icon icon="line-md:loading-twotone-loop" width="20" height="20" /></div>
        ) : logs.length === 0 ? (
          <div className="text-desc text-sm">{i18n.t('no-ai-activity-yet')}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {logs.map(log => {
              const style = INFO_STATUS_ICON[log.status] || INFO_STATUS_ICON.error
              return (
                <div key={log.id} className="text-xs flex items-center gap-2 p-1.5 rounded-md bg-default-50">
                  <Icon icon={style.icon} width="14" height="14" className={`shrink-0 ${style.color}`} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{log.taskType}</span>
                      <span className="text-desc shrink-0">{log.finishedAt ? `${dayjs(log.finishedAt).diff(dayjs(log.startedAt), 'second')}s` : '…'}</span>
                    </div>
                    <span className="text-desc">{fmt(log.startedAt)}</span>
                    {log.status === 'error' && log.message && (
                      <span className="text-danger truncate" title={log.message}>{log.message}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

const handleInfo = () => {
  RootStore.Get(DialogStore).setData({
    isOpen: true,
    title: i18n.t('info'),
    content: <InfoDialogContent />
  })
}

export const InfoItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2">
    <Icon icon="proicons:info" width="20" height="20" />
    <div>{t('info')}</div>
  </div>
})

const handleTrash = () => {
  const blinko = RootStore.Get(BlinkoStore)
  showTipsDialog({
    title: i18n.t('confirm-to-trash'),
    content: i18n.t('this-entry-will-be-moved-to-the-recycle-bin'),
    onConfirm: async () => {
      await PromiseCall(api.notes.trashMany.mutate({ ids: [blinko.curSelectedNote?.id!] }))
      RootStore.Get(DialogStandaloneStore).close()
    }
  })
}

const handleDelete = async () => {
  const blinko = RootStore.Get(BlinkoStore)
  showTipsDialog({
    title: i18n.t('confirm-to-delete'),
    content: i18n.t('this-operation-removes-the-associated-label-and-cannot-be-restored-please-confirm'),
    onConfirm: async () => {
      await PromiseCall(api.notes.deleteMany.mutate({ ids: [blinko.curSelectedNote?.id!] }))
      PromiseCall(api.ai.embeddingDelete.mutate({ id: blinko.curSelectedNote?.id! }))
      RootStore.Get(DialogStandaloneStore).close()
    }
  })
}

const handleRelatedNotes = async () => {
  const blinko = RootStore.Get(BlinkoStore);
  const dialog = RootStore.Get(DialogStore);
  const toast = RootStore.Get(ToastPlugin);

  try {
    const noteId = blinko.curSelectedNote?.id;
    if (!noteId) return;
    toast.loading(i18n.t('loading'));
    const relatedNotes = await api.notes.relatedNotes.query({ id: noteId });
    toast.dismiss();
    if (relatedNotes.length === 0) {
      toast.error(i18n.t('no-related-notes-found'));
      return;
    }

    dialog.setData({
      size: 'lg' as any,
      isOpen: true,
      title: i18n.t('related-notes'),
      isDismissable: true,
      content: () => {
        return (
          <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
            {relatedNotes.map((note: Note) => (
              <BlinkoCard key={note.id} blinkoItem={note} withoutHoverAnimation/>
            ))}
          </div>
        );
      }
    });
  } catch (error) {
    toast.dismiss();
    toast.error(i18n.t('operation-failed'));
    console.error("Failed to fetch related notes:", error);
  }
};

const handleComment = () => {
  const blinko = RootStore.Get(BlinkoStore)
  if (blinko.curSelectedNote?.id) {
    ShowCommentDialog(blinko.curSelectedNote.id)
  }
}

export const EditItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2">
    <Icon icon="tabler:edit" width="20" height="20" />
    <div>{t('edit')}</div>
  </div>
})

export const MutiSelectItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2" >
    <Icon icon="mingcute:multiselect-line" width="20" height="20" />
    <div>{t('multiple-select')}</div>
  </div>
})

export const SelectAllItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2">
    <Icon icon="lucide:square-check" width="20" height="20" />
    <div>{t('select-all')}</div>
  </div>
})

export const TopItem = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore)
  return <div className="flex items-start gap-2">
    <Icon icon="lets-icons:pin" width="20" height="20" />
    <div>{blinko.curSelectedNote?.isTop ? t('cancel-top') : t('top')}</div>
  </div>
})

export const PublicItem = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore)
  return <div className="flex items-start gap-2">
    <Icon icon="ic:outline-share" width="20" height="20" />
    <div>{t('share')}</div>
  </div>
})

export const RestoreItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2">
    <Icon icon="mdi:restore" width="20" height="20" />
    {t('recovery')}
  </div>
})

export const ReanalyzeItem = observer(() => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <Icon icon="majesticons:tag-line" width="20" height="20" />
      <div>{t('re-run-ai-analysis')}</div>
    </div>
  );
});

export const TranscribeItem = observer(() => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <Icon icon="mdi:microphone-outline" width="20" height="20" />
      <div>{t('transcribe')}</div>
    </div>
  );
});

export const AddTagItem = observer(() => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <Icon icon="mingcute:add-line" width="20" height="20" />
      {/* CUSTOM-JOURNAL: was t('add-tag') ("Add Tag") -- the dialog this
          opens (AddTagDialogContent) shows every current tag as a removable
          chip alongside the add control, so "Add Tag" undersold what it
          actually does. Kept as its own key (edit-tags), separate from
          add-tag, since BlinkoMultiSelectPop's bulk action reuses add-tag
          for a genuinely add-only operation (no per-note removal makes
          sense across a multi-selection) and shouldn't be relabeled too. */}
      <div>{t('edit-tags')}</div>
    </div>
  );
});

export const ViewSentimentsItem = observer(() => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <Icon icon="mdi:emoticon-outline" width="20" height="20" />
      <div>{t('view-sentiments')}</div>
    </div>
  );
});

export const RelatedNotesItem = observer(() => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <Icon icon="mdi:note-search-outline" width="20" height="20" />
      <div>{t('related-notes')}</div>
    </div>
  );
});

export const CommentItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2">
    <Icon icon="akar-icons:comment" width="20" height="20" />
    <div>{t('comment')}</div>
  </div>
})

export const TrashItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2 text-red-500">
    <Icon icon="mingcute:delete-2-line" width="20" height="20" />
    <div>{t('trash')}</div>
  </div>
})

export const DeleteItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2 text-red-500">
    <Icon icon="mingcute:delete-2-line" width="20" height="20" />
    <div>{t('delete')}</div>
  </div>
})


export const BlinkoRightClickMenu = observer(() => {
  const [isDetailPage, setIsDetailPage] = useState(false)
  const location = useLocation()
  
  const blinko = RootStore.Get(BlinkoStore)
  const pluginApi = RootStore.Get(PluginApiStore)
  const isPc = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    setIsDetailPage(location.pathname.includes('/detail'))
  }, [location.pathname])

  return <ContextMenu className='font-bold' id="blink-item-context-menu" hideOnLeave={false} animation="zoom">
    <ContextMenuItem onClick={() => handleEdit(isDetailPage)}>
      <EditItem />
    </ContextMenuItem>

    {!isDetailPage ? (
      <>
        <ContextMenuItem onClick={() => handleMultiSelect()}>
          <MutiSelectItem />
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleSelectAll()}>
          <SelectAllItem />
        </ContextMenuItem>
      </>
    ) : <></>}

    <ContextMenuItem onClick={handleInfo}>
      <InfoItem />
    </ContextMenuItem>

    <ContextMenuItem onClick={handleTop}>
      <TopItem />
    </ContextMenuItem>

    {blinko.curSelectedNote?.isRecycle ? (
      <ContextMenuItem onClick={handleRestore}>
        <RestoreItem />
      </ContextMenuItem>
    ) : <></>}

    {!blinko.curSelectedNote?.isRecycle ? (
      <ContextMenuItem onClick={handlePublic}>
      <PublicItem />
    </ContextMenuItem>
    ) : <></>}

    {!isPc ? (
      <ContextMenuItem onClick={handleComment}>
        <CommentItem />
      </ContextMenuItem>
    ) : <></>}

    <ContextMenuItem onClick={handleAddTag}>
      <AddTagItem />
    </ContextMenuItem>

    {/* CUSTOM-JOURNAL: AI items gated on the 4 cascading "AI Features"
        toggles (AI Settings) in addition to their model being configured --
        TranscribeItem now checks voiceModelId (the model it actually needs)
        instead of mainModelId, which was arguably always the wrong check;
        ReanalyzeItem additionally requires the "AI Post-Processing" toggle
        since it triggers the tags+mood pipeline that toggle covers (the
        backend itself still permits an already-open menu's click through
        regardless, see reanalyzeNote -- hiding the button is a
        discoverability choice, not a data-integrity one); RelatedNotesItem
        and ViewSentimentsItem are gated on the master toggle only, since
        embeddings search and mood-score *display* aren't "using AI" in the
        sense the other toggles mean to block. */}
    {blinko.config.value?.isEnableAiFeatures !== false
      && blinko.config.value?.isUseAiTranscription !== false
      && blinko.config.value?.voiceModelId ? (
      <ContextMenuItem onClick={handleTranscribe}>
        <TranscribeItem />
      </ContextMenuItem>
    ) : <></>}

    {blinko.config.value?.isEnableAiFeatures !== false
      && blinko.config.value?.isUseAiPostProcessing !== false
      && blinko.config.value?.mainModelId ? (
      <ContextMenuItem onClick={handleReanalyze}>
        <ReanalyzeItem />
      </ContextMenuItem>
    ) : <></>}

    {blinko.config.value?.isEnableAiFeatures !== false
      && blinko.config.value?.mainModelId ? (
      <ContextMenuItem onClick={handleRelatedNotes}>
        <RelatedNotesItem />
      </ContextMenuItem>
    ) : <></>}

    {blinko.config.value?.isEnableAiFeatures !== false
      && blinko.config.value?.mainModelId ? (
      <ContextMenuItem onClick={handleViewSentiments}>
        <ViewSentimentsItem />
      </ContextMenuItem>
    ) : <></>}

    {pluginApi.customRightClickMenus.map((menu) => (
      <ContextMenuItem key={menu.name} onClick={() => menu.onClick(blinko.curSelectedNote!)} disabled={menu.disabled}>
        <div className="flex items-start gap-2">
          {menu.icon && <Icon icon={menu.icon} width="20" height="20" />}
          <div>{menu.label}</div>
        </div>
      </ContextMenuItem>
    ))}

    {!blinko.curSelectedNote?.isRecycle ? (
      <ContextMenuItem onClick={handleTrash}>
        <TrashItem />
      </ContextMenuItem>
    ) : <></>}

    {blinko.curSelectedNote?.isRecycle ? (
      <ContextMenuItem onClick={handleDelete}>
        <DeleteItem />
      </ContextMenuItem>
    ) : <></>}
  </ContextMenu>
})

export const LeftCickMenu = observer(({ onTrigger, className }: { onTrigger: () => void, className: string }) => {
  const [isDetailPage, setIsDetailPage] = useState(false)
  const blinko = RootStore.Get(BlinkoStore)
  const pluginApi = RootStore.Get(PluginApiStore)
  const location = useLocation()
  const isPc = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    setIsDetailPage(location.pathname.includes('/detail'))
  }, [location.pathname])

  const disabledKeys = isDetailPage ? ['MutiSelectItem'] : []

  return <Dropdown onOpenChange={e => onTrigger()}>
    <DropdownTrigger >
      <div onClick={onTrigger} className={`${className} text-desc hover:text-primary cursor-pointer hover:scale-1.3 !transition-all`}>
        <Icon icon="fluent:more-vertical-16-regular" width="16" height="16" />
      </div>
    </DropdownTrigger>
    <DropdownMenu aria-label="Static Actions" disabledKeys={disabledKeys}>
      <DropdownItem key="EditItem" onPress={() => handleEdit(isDetailPage)}><EditItem /></DropdownItem>
      {!isDetailPage ? (
        <>
          <DropdownItem key="MutiSelectItem" onPress={() => handleMultiSelect()}>
            <MutiSelectItem />
          </DropdownItem>
          <DropdownItem key="SelectAllItem" onPress={() => handleSelectAll()}>
            <SelectAllItem />
          </DropdownItem>
        </>
      ) : null}
      <DropdownItem key="InfoItem" onPress={handleInfo}> <InfoItem /></DropdownItem>
      <DropdownItem key="TopItem" onPress={handleTop}> <TopItem />  </DropdownItem>
      {blinko.curSelectedNote?.isRecycle ? (
        <DropdownItem key="RestoreItem" onPress={handleRestore}>
          <RestoreItem />
        </DropdownItem>
      ) : <></>}

      {!blinko.curSelectedNote?.isRecycle ? (
        <DropdownItem key="ShareItem" onPress={handlePublic}> 
          <PublicItem />  
        </DropdownItem>
      ) : <></>}

      {!isPc ? (
        <DropdownItem key="CommentItem" onPress={handleComment}>
          <CommentItem />
        </DropdownItem>
      ) : <></>}

      <DropdownItem key="AddTagItem" onPress={handleAddTag}>
        <AddTagItem />
      </DropdownItem>

      {blinko.config.value?.isEnableAiFeatures !== false
        && blinko.config.value?.isUseAiTranscription !== false
        && blinko.config.value?.voiceModelId ? (
        <DropdownItem key="TranscribeItem" onPress={handleTranscribe}>
          <TranscribeItem />
        </DropdownItem>
      ) : <></>}

      {blinko.config.value?.isEnableAiFeatures !== false
        && blinko.config.value?.isUseAiPostProcessing !== false
        && blinko.config.value?.mainModelId ? (
        <DropdownItem key="ReanalyzeItem" onPress={handleReanalyze}>
          <ReanalyzeItem />
        </DropdownItem>
      ) : <></>}

      {blinko.config.value?.isEnableAiFeatures !== false
        && blinko.config.value?.mainModelId ? (
        <DropdownItem key="RelatedNotesItem" onPress={handleRelatedNotes}>
          <RelatedNotesItem />
        </DropdownItem>
      ) : <></>}

      {blinko.config.value?.isEnableAiFeatures !== false
        && blinko.config.value?.mainModelId ? (
        <DropdownItem key="ViewSentimentsItem" onPress={handleViewSentiments}>
          <ViewSentimentsItem />
        </DropdownItem>
      ) : <></>}

      {
        pluginApi.customRightClickMenus.length > 0 ?
          <>
            {
              pluginApi.customRightClickMenus.map((menu) => (
                <DropdownItem key={menu.name} onPress={() => menu.onClick(blinko.curSelectedNote!)}>
                  <div className="flex items-start gap-2">
                    {menu.icon && <Icon icon={menu.icon} width="20" height="20" />}
                    <div>{menu.label}</div>
                  </div>
                </DropdownItem>
              ))
            }
          </> :
          <></>
      }

      {!blinko.curSelectedNote?.isRecycle ? (
        <DropdownItem key="TrashItem" onPress={handleTrash}>
          <TrashItem />
        </DropdownItem>
      ) : <></>}

      {blinko.curSelectedNote?.isRecycle ? (
        <DropdownItem key="DeleteItem" className="text-danger" onPress={handleDelete}>
          <DeleteItem />
        </DropdownItem>
      ) : <></>}

    </DropdownMenu>
  </Dropdown>
})