import { NoteType } from "@shared/lib/types";
import { PromiseState } from "@/store/standard/PromiseState";

export type OnSendContentType = {
  content: string;
  files: (FileType & { uploadPath: string })[]
  noteType: NoteType;
  references: number[]
  metadata?: any;
}

export type FileType = {
  name: string
  size: number
  previewType: 'image' | 'audio' | 'video' | 'other'
  extension: string
  preview: any
  uploadPromise: PromiseState<any>
  type: string // audio/webm
  // CUSTOM-JOURNAL: the saved attachment's DB metadata (audioDuration/
  // audioDurationSeconds for voice recordings, etc.) -- was dropped by
  // HandleFileType's mapping from Attachment -> FileType, which meant
  // audioRender.tsx's getDuration() could never read it back for an
  // already-saved note (only a not-yet-submitted recording, via the
  // in-memory File object's own audioDuration property, worked).
  metadata?: any
}
