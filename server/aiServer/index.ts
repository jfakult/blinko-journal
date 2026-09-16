import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { prisma } from '../prisma';
import { AiModelFactory } from './aiModelFactory';
import { ProgressResult } from '@shared/lib/types';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { UnstructuredLoader } from '@langchain/community/document_loaders/fs/unstructured';
import { BaseDocumentLoader } from '@langchain/core/document_loaders/base';
import { FileService } from '../lib/files';
import { Context } from '../context';
import { CreateNotification } from '../routerTrpc/notification';
import { NotificationType } from '@shared/lib/prismaZodType';
import { CoreMessage } from '@mastra/core';
import { MDocument } from '@mastra/rag';
import { embedMany, generateObject, generateText } from 'ai';
import { z } from 'zod';
import dayjs from '@shared/lib/dayjs';
import { RebuildEmbeddingJob } from '../jobs/rebuildEmbeddingJob';

import { getAllPathTags, syncNoteTagsFromContent } from '@server/lib/helper';
import { logAiTaskStart, logAiTaskFinish, callAgentWithLog, logAiTaskCall, formatOutputWithThinking } from '@server/lib/aiTaskLog';
import { commentWebhookInclude, sendCommentWebhook } from '@server/lib/commentWebhook';
import { LibSQLVector } from '@mastra/libsql';
import { RuntimeContext } from "@mastra/core/di";

export function isImage(filePath: string): boolean {
  if (!filePath) return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  return imageExtensions.some((ext) => filePath.toLowerCase().endsWith(ext));
}

export function isAudio(filePath: string): boolean {
  if (!filePath) return false;
  const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.opus', '.webm'];
  return audioExtensions.some((ext) => filePath.toLowerCase().endsWith(ext));
}

export class AiService {
  static isImage = isImage;
  static isAudio = isAudio;

  // CUSTOM-JOURNAL: escapes regex metacharacters in a literal string --
  // needed because the transcription heading below contains literal
  // parentheses ("(#123)"), which are regex grouping syntax.
  static #escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // CUSTOM-JOURNAL: each attachment's transcript is wrapped in a plain,
  // visible markdown heading (keyed by attachment id) followed immediately
  // by a blockquote -- NOT an HTML comment marker, which an earlier version
  // of this used. That broke as soon as a user edited the note at all: the
  // Vditor WYSIWYG editor round-trips content through its own DOM/markdown
  // serializer on every save, and doesn't preserve arbitrary raw HTML
  // comments verbatim -- they'd get mangled or stripped, silently breaking
  // the marker-based detection this relies on to replace (not duplicate) a
  // transcript on retranscribe. A heading + blockquote are both real
  // markdown constructs Vditor fully understands and round-trips correctly.
  // The block's extent is simply "the heading line, then every immediately
  // following line that starts with '>'" -- no separate closing marker
  // needed, since the first non-'>' line (blank line, plain text, or
  // another heading) naturally ends it. This also means the block can never
  // accidentally swallow trailing user content the way an unbounded
  // "match to end of string" scheme could.
  static transcriptionHeading(attachmentId: number): string {
    return `## Audio Transcription (#${attachmentId})`;
  }

  static transcriptionBlock(attachmentId: number, text: string): string {
    const quoted = text.split('\n').map((line) => `> ${line}`).join('\n');
    return `\n\n${AiService.transcriptionHeading(attachmentId)}\n${quoted}`;
  }

  static transcriptionBlockRegex(attachmentId: number): RegExp {
    const heading = AiService.#escapeRegex(AiService.transcriptionHeading(attachmentId));
    return new RegExp(`\\n*${heading}\\n(?:>.*(?:\\n|$))*`);
  }

  // Used by the tag-audit job to find notes whose audio attachment was
  // marked transcribed (attachments.transcribedAt set) but whose content is
  // actually missing the expected block -- e.g. an old note from before this
  // marker format existed, a transcription that silently produced nothing,
  // or a block an editor round-trip corrupted before this fix.
  static hasTranscriptionBlock(content: string, attachmentId: number): boolean {
    return AiService.transcriptionBlockRegex(attachmentId).test(content);
  }

  static async loadFileContent(filePath: string): Promise<string> {
    try {
      let loader: BaseDocumentLoader;
      switch (true) {
        case filePath.endsWith('.pdf'):
          loader = new PDFLoader(filePath);
          break;
        case filePath.endsWith('.docx') || filePath.endsWith('.doc'):
          loader = new DocxLoader(filePath);
          break;
        case filePath.endsWith('.txt'):
          loader = new TextLoader(filePath);
          break;
        case filePath.endsWith('.csv'):
          console.log('load csv');
          loader = new CSVLoader(filePath);
          break;
        default:
          loader = new UnstructuredLoader(filePath);
      }
      const docs = await loader.load();
      return docs.map((doc) => doc.pageContent).join('\n');
    } catch (error) {
      console.error('File loading error:', error);
      throw new Error(`can not load file: ${filePath}`);
    }
    return '';
  }

  static async embeddingDeleteAll(id: number, VectorStore: LibSQLVector) {
    await VectorStore.truncateIndex({ indexName: 'blinko' });
  }

  static async embeddingDeleteAllAttachments(filePath: string, VectorStore: LibSQLVector) {
    await VectorStore.truncateIndex({ indexName: 'blinko' });
  }

  static async embeddingUpsert({ id, content, type, createTime, updatedAt, accountId }: { id: number; content: string; type: 'update' | 'insert'; createTime: Date; updatedAt?: Date; accountId: number }) {
    try {
      const { VectorStore, Embeddings } = await AiModelFactory.GetProvider();
      if (!Embeddings) {
        throw new Error("No embeddings model config")
      }
      const config = await AiModelFactory.globalConfig();

      if (config.excludeEmbeddingTagId) {
        const tag = await prisma.tag.findUnique({ where: { id: config.excludeEmbeddingTagId } });
        if (tag && content.includes(tag.name)) {
          console.warn('this note is not allowed to be embedded:', tag.name);
          return { ok: false, msg: 'tag is not allowed to be embedded' };
        }
      }

      const note = await prisma.notes.findUnique({
        where: { id },
        select: { metadata: true, attachments: true }
      });

      const chunks = await MDocument.fromMarkdown(content).chunk();
      if (type == 'update') {
        AiModelFactory.queryAndDeleteVectorById(id, accountId);
      }

      // CUSTOM-JOURNAL: previously appended raw "Create At: <iso> Update At:
      // <iso>" text directly onto every embedded chunk. For a short journal
      // entry that timestamp noise can be a large fraction of the embedded
      // text and measurably drags the resulting vector away from the note's
      // actual semantic content -- createTime/updatedAt are already carried
      // separately in the vector's metadata below, so there's no need to
      // embed them too. See queryVector's prefix comment for the other half
      // of this retrieval-quality fix.
      const modelKey = await AiModelFactory.getEmbeddingModelKey();
      const { embeddings } = await embedMany({
        values: chunks.map((chunk) => AiModelFactory.applyEmbeddingPrefix(chunk.text, modelKey, 'document')),
        model: Embeddings,
      });

      await VectorStore.upsert({
        indexName: 'blinko',
        vectors: embeddings,
        // CUSTOM-JOURNAL: accountId stored per-vector so queryVector can
        // filter the nearest-neighbor search itself, not just the Postgres
        // fetch afterward -- see queryVector's own comment.
        metadata: chunks?.map((chunk) => ({ text: chunk.text, id, noteId: id, accountId, createTime, updatedAt })),
      });

      try {
        await prisma.notes.update({
          where: { id },
          data: {
            metadata: {
              //@ts-ignore
              ...(note?.metadata || {}),
              isIndexed: true,
            },
            embeddedAt: new Date(),
            updatedAt,
          },
        });
      } catch (error) {
        console.log(error);
      }

      return { ok: true };
    } catch (error) {
      console.log(error, 'embeddingUpsert error');
      return { ok: false, error: error?.message };
    }
  }

  //api/file/123.pdf
  static async embeddingInsertAttachments({ id, updatedAt, filePath, accountId }: { id: number; updatedAt?: Date; filePath: string; accountId: number }) {
    try {

      const fileResult = await FileService.getFile(filePath);
      let content: string;
      try {
        if (AiService.isImage(filePath)) {
          content = await AiModelFactory.describeImage(fileResult.path);
        } else {
          content = await AiService.loadFileContent(fileResult.path);
        }
      } finally {
        // Clean up temporary file if needed
        if (fileResult.isTemporary && fileResult.cleanup) {
          await fileResult.cleanup();
        }
      }
      const { VectorStore, TokenTextSplitter, Embeddings } = await AiModelFactory.GetProvider();
      if (!Embeddings) {
        throw new Error("No embeddings model config")
      }
      const doc = MDocument.fromText(content);
      const chunks = await doc.chunk();

      const modelKey = await AiModelFactory.getEmbeddingModelKey();
      const { embeddings } = await embedMany({
        values: chunks.map((chunk) => AiModelFactory.applyEmbeddingPrefix(chunk.text, modelKey, 'document')),
        model: Embeddings,
      });

      await VectorStore.upsert({
        indexName: 'blinko',
        vectors: embeddings,
        metadata: chunks?.map((chunk) => ({ text: chunk.text, id, noteId: id, accountId, isAttachment: true, updatedAt })),
      });

      try {
        const note = await prisma.notes.findUnique({
          where: { id },
          select: { metadata: true }
        });
        await prisma.notes.update({
          where: { id },
          data: {
            metadata: {
              //@ts-ignore
              ...(note?.metadata || {}),
              isIndexed: true,
              isAttachmentsIndexed: true,
            },
            embeddedAt: new Date(),
            updatedAt,
          },
        });
      } catch (error) {
        console.log(error);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  static async embeddingDelete({ id, accountId }: { id: number; accountId?: number }) {
    await AiModelFactory.queryAndDeleteVectorById(id, accountId);
    return { ok: true };
  }

  // CUSTOM-JOURNAL: the single place a note's content is (re-)embedded into
  // RAG after AI tagging/mood scoring -- called once at the END of
  // postProcessNote/reanalyzeNote/tagAuditJob's per-note tag+mood work (not
  // from inside appendTagsIfUnchanged anymore, which used to re-embed
  // eagerly the moment tags were appended, before mood scoring even ran),
  // and directly from note.ts on a plain edit or when post-processing is
  // off (nothing else will trigger it in that case). Optionally prepends
  // admin-configured metadata (dates/mood/tags -- see ragInclude* config)
  // to the text actually embedded, so RAG retrieval can match on "what mood
  // was I in" or "entries tagged #travel" style questions, not just literal
  // content. Logs to aiTaskLog (taskType 'embedding') and stamps
  // notes.embeddedAt so both the admin RAG history log and the per-note
  // "Info" panel can show whether/when a note is actually indexed.
  static async embedNoteWithMetadata({ noteId, accountId }: { noteId: number; accountId: number }): Promise<void> {
    const config = await AiModelFactory.globalConfig();
    if (!config.embeddingModelId) return;

    const note = await prisma.notes.findUnique({
      where: { id: noteId },
      select: { content: true, createdAt: true, updatedAt: true, moodScores: true, tags: { include: { tag: true } } },
    });
    if (!note) return;

    const taskLogId = await logAiTaskStart({ accountId, taskType: 'embedding', noteId, message: 'Embedding note into RAG index' });
    try {
      const prefixLines: string[] = [];
      if (config.ragIncludeDates) {
        prefixLines.push(`Date: ${dayjs(note.createdAt).format('YYYY-MM-DD')}`);
      }
      if (config.ragIncludeTags && note.tags.length > 0) {
        prefixLines.push(`Tags: ${note.tags.map((t) => `#${t.tag.name}`).join(' ')}`);
      }
      if (config.ragIncludeMood && note.moodScores && typeof note.moodScores === 'object') {
        const axes = await prisma.moodAxis.findMany({ orderBy: { sortOrder: 'asc' } });
        const moodLines = axes
          .map((axis) => {
            const score = (note.moodScores as Record<string, unknown>)[axis.positiveLabel];
            return typeof score === 'number' ? `${axis.positiveLabel}: ${score}/100` : null;
          })
          .filter((line): line is string => line != null);
        if (moodLines.length > 0) prefixLines.push(`Mood: ${moodLines.join(', ')}`);
      }
      const textToEmbed = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n\n${note.content}` : note.content;

      const result = await AiService.embeddingUpsert({
        id: noteId,
        content: textToEmbed,
        type: 'update',
        createTime: note.createdAt,
        updatedAt: note.updatedAt,
        accountId,
      });
      if (!result.ok) {
        await logAiTaskFinish(taskLogId, 'error', result.error || result.msg || 'embedding failed');
        return;
      }
      await logAiTaskFinish(taskLogId, 'success', prefixLines.length > 0 ? `Embedded with metadata: ${prefixLines.join(' | ')}` : 'Embedded');
    } catch (error: any) {
      await logAiTaskFinish(taskLogId, 'error', error?.message || String(error));
    }
  }

  static async *rebuildEmbeddingIndex({ force = false }: { force?: boolean }): AsyncGenerator<ProgressResult & { progress?: { current: number; total: number } }, void, unknown> {
    // This method is now a wrapper around the RebuildEmbeddingJob
    // We'll just return a simple message directing to use the job instead
    yield {
      type: 'info' as const,
      content: 'Rebuild embedding index task started - check task progress for details',
      progress: { current: 0, total: 0 },
    };

    // Start the job
    await RebuildEmbeddingJob.ForceRebuild(force);
  }

  static getChatHistory({ conversations }: { conversations: { role: string; content: string }[] }) {
    const conversationMessage = conversations.map((i) => {
      if (i.role == 'user') {
        return new HumanMessage(i.content);
      }
      return new AIMessage(i.content);
    });
    conversationMessage.pop();
    return conversationMessage;
  }

  static async enhanceQuery({ query, ctx }: { query: string; ctx: Context }) {
    try {
      const { notes } = await AiModelFactory.queryVector(query, Number(ctx.id));
      return notes;
    } catch (error) {
      console.error('Error in enhanceQuery:', error);
      return [];
    }
  }

  static async completions({
    question,
    conversations,
    withTools,
    withRAG = true,
    withOnline = false,
    systemPrompt,
    ctx,
  }: {
    question: string;
    conversations: CoreMessage[];
    withTools?: boolean;
    withRAG?: boolean;
    withOnline?: boolean;
    systemPrompt?: string;
    ctx: Context;
  }) {
    try {
      console.log('completions');

      // Fold all system context into a single agent instruction so that only ONE
      // system message reaches the model. Some providers (e.g. Qwen/DashScope) reject
      // multiple leading system messages with "System message must be at the beginning".
      // See https://github.com/blinkospace/blinko/issues/1122
      const historySystem = conversations
        .filter((m) => m.role === 'system')
        .map((m) => m.content as string);
      const cleanedConversations = conversations.filter((m) => m.role !== 'system');

      // CUSTOM-JOURNAL: previously injected retrieved notes as a bare,
      // unlabeled blob ("This is the note content ...") alongside a generic
      // "versatile AI assistant" persona that says nothing about journaling
      // or retrieval at all -- with no capability statement and no
      // distinction between "notes were found" vs "none were found" (an
      // empty ragNote still produced a non-empty-looking string), the model
      // had every reason to fall back to its trained-in generic disclaimer
      // ("I don't have access to your personal history...") even when real
      // entries were sitting right there in context. Now: explicit
      // capability statement, each entry clearly delimited with its date,
      // and an explicit "nothing found" instruction when the search comes
      // up empty instead of an ambiguous blank-looking fragment. (Also drops
      // queryVector's `aiContext` return value, which just duplicated
      // `notes`' content a second time via an unjoined array -- redundant.)
      let ragNote: any[] = [];
      let ragNoteString = '';
      if (withRAG) {
        // CUSTOM-JOURNAL: withRAG is now forced true from the router (see
        // ai.ts) rather than a client-toggleable flag, so a misconfigured/
        // missing embedding model must degrade to "no RAG" instead of
        // throwing and breaking the whole chat response.
        const notes = await AiModelFactory.queryVector(question, Number(ctx.id))
          .then((r) => r.notes)
          .catch((error) => {
            console.error('Error in RAG queryVector:', error);
            return [];
          });
        ragNote = notes;
        if (notes.length > 0) {
          const entries = notes
            .map((note: any, i: number) => {
              const date = note.createdAt ? dayjs(note.createdAt).format('YYYY-MM-DD') : 'unknown date';
              return `--- Journal entry ${i + 1} (${date}) ---\n${note.content}`;
            })
            .join('\n\n');
          ragNoteString = `You have retrieval-augmented access to the user's personal journal. The following ${notes.length} ${notes.length === 1 ? 'entry was' : 'entries were'} retrieved specifically because they are relevant to the user's current question. Treat them as real, ground-truth excerpts from the user's own life -- answer confidently using them, and do not claim you lack access to the user's personal history when entries like these are provided.\n\n${entries}`;
        } else {
          ragNoteString = "You have retrieval-augmented access to the user's personal journal, but no entries matching this specific question were found. Tell the user you searched their journal and didn't find anything relevant to this question, rather than saying you have no access to their personal history at all.";
        }
      }

      const contextParts = [
        ...historySystem,
        `Current user name: ${ctx.name}`,
        systemPrompt,
        ragNoteString,
      ].filter(Boolean);

      cleanedConversations.push({
        role: 'user',
        content: question,
      });
      console.log(cleanedConversations, 'conversations');
      const runtimeContext = new RuntimeContext();
      runtimeContext.set('accountId', Number(ctx.id));
      const agent = await AiModelFactory.BaseChatAgent({
        withTools,
        withOnlineSearch: withOnline,
        extraInstructions: contextParts.join('\n\n'),
      });
      const result = await agent.stream(cleanedConversations, { runtimeContext });
      return { result, notes: ragNote };
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  }

  static async AIComment({ content, noteId }: { content: string; noteId: number }) {
    let taskLogId: number | null = null;
    try {
      const note = await prisma.notes.findUnique({
        where: { id: noteId },
        select: { content: true, accountId: true },
      });

      if (!note) {
        throw new Error('Note not found');
      }

      taskLogId = await logAiTaskStart({ accountId: note.accountId, taskType: 'aiComment', noteId });

      const agent = await AiModelFactory.CommentAgent();
      const messages = [
        { role: 'user' as const, content },
        { role: 'user' as const, content: `This is the note content: ${note.content}` },
      ];
      const modelInfo = await AiService.#getPostProcessingModelInfo();
      const systemPrompt = AiModelFactory.getAgentSystemPrompt(agent);
      const rawInput = messages.map((m) => m.content).join('\n\n');
      const result = await callAgentWithLog({
        taskLogId,
        agent: 'CommentAgent',
        provider: modelInfo.provider,
        modelTitle: modelInfo.title,
        input: systemPrompt ? `[System prompt]\n${systemPrompt}\n\n[Input]\n${rawInput}` : rawInput,
        run: () => agent.generate(messages),
      });

      const comment = await prisma.comments.create({
        data: {
          content: result.text.trim(),
          noteId,
          guestName: 'Blinko AI',
          guestIP: '',
          guestUA: '',
        },
        include: commentWebhookInclude,
      });
      sendCommentWebhook('comment.created', comment, {});
      await CreateNotification({
        accountId: note.accountId ?? 0,
        title: 'comment-notification',
        content: 'comment-notification',
        type: NotificationType.COMMENT,
      });
      await logAiTaskFinish(taskLogId, 'success');
      return comment;
    } catch (error) {
      console.log(error);
      await logAiTaskFinish(taskLogId, 'error', error?.toString());
      throw new Error(error);
    }
  }

  // CUSTOM-JOURNAL: resolves the model actually backing post-processing
  // agents (postProcessingModelId, falling back to mainModelId) purely for
  // aiTaskLog display purposes -- a small redundant lookup rather than
  // threading model metadata back out of AiModelFactory's agent factory.
  static async #getPostProcessingModelInfo(config?: any): Promise<{ provider: string | null; title: string | null }> {
    try {
      const globalConfig = config ?? (await AiModelFactory.globalConfig());
      const modelId = globalConfig.postProcessingModelId || globalConfig.mainModelId;
      if (!modelId) return { provider: null, title: null };
      const model = await AiModelFactory.getAiModel(modelId);
      return { provider: model?.provider?.title ?? model?.provider?.provider ?? null, title: model?.title ?? null };
    } catch {
      return { provider: null, title: null };
    }
  }

  // CUSTOM-JOURNAL: same idea as #getPostProcessingModelInfo, but for the
  // voice/transcription model -- used to label transcription's per-call log
  // entries with which model actually ran.
  static async #getVoiceModelInfo(config?: any): Promise<{ provider: string | null; title: string | null }> {
    try {
      const globalConfig = config ?? (await AiModelFactory.globalConfig());
      if (!globalConfig.voiceModelId) return { provider: null, title: null };
      const model = await AiModelFactory.getAiModel(globalConfig.voiceModelId);
      return { provider: model?.provider?.title ?? model?.provider?.provider ?? null, title: model?.title ?? null };
    } catch {
      return { provider: null, title: null };
    }
  }

  // CUSTOM-JOURNAL: shared by postProcessNote's live 'tags'/'both' path and
  // server/jobs/tagAuditJob.ts's backfill pass, so both run identical logic.
  static async suggestTags(content: string, taskLogId: number | null = null): Promise<string[]> {
    const config = await AiModelFactory.globalConfig();
    const aiTagsPrompt = config.aiTagsPrompt;
    const tagAgent = aiTagsPrompt ? await AiModelFactory.TagAgent(aiTagsPrompt) : await AiModelFactory.TagAgent();
    // CUSTOM-JOURNAL: no longer passing the existing tag list -- per explicit
    // request, tagging should be free and creative, not anchored to
    // whatever's already been used. This also removed the (upstream Blinko)
    // "5-8 tags from the existing list" framing, which combined with the old
    // 5-fixed-category prompt to force one tag per category (people/places/
    // mood/occasion/theme) even when a category had nothing to tag -- e.g. a
    // #people tag on an entry that names no one.
    const input = `Note content:\n${content}`;
    const modelInfo = await AiService.#getPostProcessingModelInfo(config);
    // CUSTOM-JOURNAL: the AI Task Log used to only show `input` (the note
    // content) -- logging the system prompt too so what actually shaped the
    // response is visible, not just what was fed in per-call.
    const systemPrompt = AiModelFactory.getAgentSystemPrompt(tagAgent);
    const loggedInput = systemPrompt ? `[System prompt]\n${systemPrompt}\n\n[Input]\n${input}` : input;
    const result = await callAgentWithLog({
      taskLogId,
      agent: 'TagAgent',
      provider: modelInfo.provider,
      modelTitle: modelInfo.title,
      input: loggedInput,
      run: () => tagAgent.generate(input),
    });
    return result.text.split(',').map((tag: string) => tag.trim()).filter(Boolean).slice(0, 5);
  }

  // CUSTOM-JOURNAL: scores every active moodAxis (0-100) for a note's content,
  // returning a map keyed by moodAxis.id (string) ready to store directly in
  // notes.moodScores. Shared the same way suggestTags is.
  //
  // Uses schema-enforced structured output (Vercel AI SDK's generateObject)
  // instead of the free-text "label:score,label:score" parsing this used to
  // do -- that approach silently dropped any axis the model omitted or
  // mislabeled (a real completeness gap, not just a calibration one). A
  // dynamically-built Zod schema (one number field per active axis,
  // 0-100) guarantees every axis comes back with a value; called directly
  // against the raw post-processing model rather than through
  // AiModelFactory.MoodAgent's Agent wrapper, since Mastra's Agent.generate
  // doesn't expose a structured-output mode as cleanly as generateObject
  // does for a schema built fresh per call (the axis list is user-editable).
  // If a provider/model handles forced JSON schema output poorly, this
  // throws and is caught by postProcessNote's existing try/catch around
  // scoreMood -- mood scoring is just skipped for that note, same as any
  // other failure today.
  static async scoreMood(content: string, taskLogId: number | null = null): Promise<Record<string, number>> {
    const axes = await prisma.moodAxis.findMany({ orderBy: { sortOrder: 'asc' } });
    if (axes.length === 0) return {};

    // CUSTOM-JOURNAL: every axis is optional in the schema now, not required
    // -- the model is instructed to only include a unipolar emotion (anger,
    // joy, etc.) if it's actually present, rather than being forced to
    // assign all 9 a number on every entry. That forced full-coverage was
    // itself producing bad scores (e.g. "anxiety" pinned to 100 on an entry
    // that never mentions anxiety at all, because the model had to put
    // *something* there). Optional fields are valid Zod/JSON-schema -- this
    // doesn't change how generateObject validates a response, it just means
    // the model isn't required to supply every key.
    //
    // CUSTOM-JOURNAL: the model is asked for 0-10, not 0-100 -- that
    // granularity was never meaningful (a personal-journal mood read doesn't
    // need to distinguish a 62 from a 65), and asking for fewer distinct
    // values a small model has to choose between is easier for it to reason
    // about reliably. notes.moodScores itself, and every UI consumer
    // (SentimentView's percentage-width bars, its "X / 100" label, mood-sort
    // in filterPop.tsx, etc.), all still expect 0-100 -- rather than touch
    // every one of those and leave already-scored notes on a different scale
    // than newly-scored ones, the 0-10 model output is rescaled by *10 right
    // before storage/return, below. scoreMood's public contract (an
    // axisId -> 0-100 map) is unchanged; only what the model itself sees and
    // reasons about is coarser now.
    // CUSTOM-JOURNAL: keyed by each axis's name (positiveLabel), not its id.
    // Moods are user-editable/addable in AI Settings and can change over
    // time, and a name-keyed score is directly readable in the AI Task Log
    // (`{"joy": 70}` vs `{"4": 70}`) without cross-referencing an id to a
    // label. This does mean a later rename orphans that axis's already-
    // scored notes (their old key no longer matches any current axis) --
    // same as it would have for an id if an axis were ever deleted and
    // recreated. tagAuditJob.ts's repair pass below detects the *previous*
    // id-keyed format specifically (a purely-numeric key) and wipes+reruns
    // scoring for any note still carrying it, so the one-time migration off
    // ids is handled automatically; a future rename is a different, smaller
    // problem (one axis's history, not the whole scheme) and isn't
    // auto-repaired the same way.
    const schema = z.object(
      Object.fromEntries(axes.map((axis) => [axis.positiveLabel, z.number().min(1).max(10).optional()]))
    );

    // CUSTOM-JOURNAL: no longer needs to spell out each axis's id -- the
    // schema key *is* the name now, so there's no id-to-label mapping for
    // the model to track at all.
    //
    // CUSTOM-JOURNAL: "positivity"/"negativity" are called out here by name
    // (matching moodSystemPrompt's rule 5, which requires them by the same
    // literal names) so the per-axis list agrees with the Rules section
    // instead of silently contradicting it -- the earlier bipolar-vs-
    // unipolar bug was exactly this shape of mismatch (the abstract rule
    // said one thing, the per-axis list said another) and it's what sent
    // the model into an unproductive reasoning loop. This does hardcode an
    // assumption that axes with these exact names exist; if they're ever
    // renamed or deleted, this quietly stops calling them out (falls back
    // to ordinary unipolar treatment) rather than breaking.
    const ALWAYS_INCLUDE_AXIS_NAMES = new Set(['positivity', 'negativity']);
    const axesDescription = axes
      .map((axis) => {
        if (axis.negativeLabel) {
          return `${axis.positiveLabel} vs ${axis.negativeLabel} -- always include. Score 0-10: 0 = fully ${axis.negativeLabel}, 10 = fully ${axis.positiveLabel}, 5 = neutral or mixed.`;
        }
        if (ALWAYS_INCLUDE_AXIS_NAMES.has(axis.positiveLabel)) {
          return `${axis.positiveLabel} -- always include, even if the score is 0.`;
        }
        return axis.positiveLabel;
      })
      .join('\n');
    const systemPrompt = AiModelFactory.moodSystemPrompt(axesDescription);
    const input = `Entry content:\n${content}`;
    // CUSTOM-JOURNAL: logged separately from `input` (which stays just the
    // entry content, actually passed to generateObject/generateText's
    // `prompt`) so the AI Task Log shows the full system prompt that shaped
    // the response, not just the per-call entry text.
    const loggedInput = `[System prompt]\n${systemPrompt}\n\n[Input]\n${input}`;

    const model = await AiModelFactory.GetPostProcessingLLM();
    const modelInfo = await AiService.#getPostProcessingModelInfo();

    // CUSTOM-JOURNAL: small local models don't reliably support the AI SDK's
    // tool-calling-based structured output -- generateObject's default mode
    // can throw AI_NoObjectGeneratedError often enough to break every
    // mood-scoring call (and, since tagAuditJob.ts calls scoreMood right
    // after tagging, that used to take otherwise-successful tag audit runs
    // down with it too). This must succeed essentially 100% of the time even
    // if the approach is hacky: try schema-mode generateObject first (best
    // quality when the provider supports it), then a raw-JSON mode, then
    // finally fall back to a plain-text generateText call with a hand-rolled
    // JSON-extraction parser.
    // CUSTOM-JOURNAL: rawText/reasoning threaded out of each tier (not just
    // the parsed object) so a failure -- especially tier 3's "no JSON found"
    // case -- can log the model's actual raw output instead of a truncated
    // error-message fragment. This is exactly what would have made an
    // earlier real failure (the model stuck reasoning in a loop over an
    // inapplicable prompt rule, burning its whole budget and never writing
    // JSON) diagnosable from the log alone. On throw, rawText/reasoning are
    // attached to the Error itself so the catch block below can recover them.
    const attempts: Array<{ label: string; run: () => Promise<{ object: unknown; rawText?: string; reasoning?: string | null }> }> = [
      {
        label: 'generateObject (auto)',
        run: async () => {
          const r = await generateObject({ model, schema, system: systemPrompt, prompt: input });
          return { object: r.object, reasoning: (r as any)?.reasoning };
        },
      },
      {
        label: 'generateObject (json mode)',
        run: async () => {
          const r = await generateObject({ model, schema, system: systemPrompt, prompt: input, mode: 'json' as any });
          return { object: r.object, reasoning: (r as any)?.reasoning };
        },
      },
      {
        label: 'generateText + manual JSON parse',
        run: async () => {
          const jsonPrompt = `${input}\n\nRespond with ONLY a single JSON object, no explanation, no code fences, no markdown. Keys are the exact dimension names shown above -- include only the ones those rules say to include, each set to a whole number 1-10.`;
          const { text, reasoning } = await generateText({ model, system: systemPrompt, prompt: jsonPrompt });
          const match = text.match(/\{[\s\S]*\}/);
          if (!match) {
            const error: any = new Error(`No JSON object found in model output (see raw text/thinking below)`);
            error.rawText = text;
            error.reasoning = reasoning;
            throw error;
          }
          return { object: JSON.parse(match[0]), rawText: text, reasoning };
        },
      },
    ];

    // CUSTOM-JOURNAL: an axis genuinely omitted by the model means different
    // things depending on axis type. For a unipolar emotion, "not
    // mentioned" correctly reads as 0 (absent). For a bipolar axis, 0 is a
    // real, meaningful endpoint (fully the negative label) -- reading a
    // missing bipolar key as "definitely fully negative" would be wrong, so
    // it defaults to 5 (neutral/unscored, native 0-10 scale) instead. Used
    // both for a key the model left out and as the final fallback if every
    // attempt fails. Rescaled to the 0-100 storage scale by toStorageScale
    // below, same as every model-supplied value.
    const defaultFor = (axis: (typeof axes)[number]) => (axis.negativeLabel ? 5 : 0);
    // CUSTOM-JOURNAL: the model reasons in 0-10 (schema/prompt above); this
    // converts to the 0-100 scale notes.moodScores and every UI consumer
    // still expect. Applied uniformly to model-supplied and default values
    // alike so nothing downstream needs to know the model-facing scale ever
    // changed.
    const toStorageScale = (value: number) => value * 10;

    let lastError: any = null;
    for (const attempt of attempts) {
      const attemptStartedAt = new Date();
      try {
        const result = await attempt.run();
        const raw = result.object as Record<string, unknown>;
        const scores: Record<string, number> = {};
        for (const axis of axes) {
          const key = axis.positiveLabel;
          if (!(key in raw) || raw[key] == null) {
            scores[key] = toStorageScale(defaultFor(axis));
            continue;
          }
          const value = typeof raw[key] === 'number' ? (raw[key] as number) : Number(raw[key]);
          scores[key] = Number.isFinite(value) ? toStorageScale(Math.max(0, Math.min(10, Math.round(value)))) : toStorageScale(defaultFor(axis));
        }
        const summary = `Resolved: ${JSON.stringify(scores)}\nRaw object: ${JSON.stringify(raw)}`;
        const outputText = result.rawText ? `${summary}\n\nRaw model text:\n${result.rawText}` : summary;
        await logAiTaskCall(taskLogId, {
          agent: 'MoodAgent',
          provider: modelInfo.provider,
          modelTitle: modelInfo.title,
          startedAt: attemptStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt.getTime(),
          input: loggedInput,
          output: `[${attempt.label}] ${formatOutputWithThinking(outputText, result.reasoning)}`,
        });
        return scores;
      } catch (error: any) {
        lastError = error;
        const isLastAttempt = attempt === attempts[attempts.length - 1];
        console.warn(`[MoodAgent] ${attempt.label} failed, ${isLastAttempt ? 'falling back to per-axis defaults' : 'trying next strategy'}:`, error?.message || error);
        // CUSTOM-JOURNAL: log every failed attempt individually (not just a
        // final catch-all) -- each tier's own raw text/thinking, when
        // available (e.g. tier 3's "no JSON found" case, which used to just
        // truncate to a 200-char error-message fragment), is exactly what
        // makes a failure like "the model got stuck reasoning in a loop and
        // never produced JSON" diagnosable from the log alone.
        const rawText: string | undefined = error?.rawText;
        await logAiTaskCall(taskLogId, {
          agent: 'MoodAgent',
          provider: modelInfo.provider,
          modelTitle: modelInfo.title,
          startedAt: attemptStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt.getTime(),
          input: loggedInput,
          output: rawText ? `[${attempt.label}] ${formatOutputWithThinking(rawText, error?.reasoning)}` : '',
          error: `[${attempt.label}] ${error?.message || String(error)}`,
        });
      }
    }

    // Every strategy failed -- fall back to the same per-axis defaults used
    // for an omitted key (0 for unipolar, 50/neutral for bipolar, on the
    // 0-100 storage scale) rather than throwing, so the note still gets a
    // moodScores object and a caller like tagAuditJob.ts never treats this
    // as a fatal per-note error. The last attempt's own failure log above
    // already carries the diagnostic detail (raw text/thinking), so no
    // extra summary call here.
    return Object.fromEntries(axes.map((axis) => [axis.positiveLabel, toStorageScale(defaultFor(axis))]));
  }

  // CUSTOM-JOURNAL: appends AI-suggested tags via optimistic-concurrency
  // compare-and-swap -- only writes if the note's content AND updatedAt still
  // match what was read before the (slow) tag-suggestion call, and preserves
  // the original updatedAt on success so a purely-background tag pass never
  // reorders "recently updated" sort or looks like a user edit. On a lost
  // race this just skips rather than risking a clobber: the note stays
  // untagged and gets picked up again by the next post-process pass or the
  // nightly tag audit, so nothing is ever destroyed, only occasionally
  // deferred. Also re-embeds on success so newly-added tags stay searchable,
  // matching what note.ts's upsert would have done.
  static async appendTagsIfUnchanged({
    noteId,
    accountId,
    expectedContent,
    expectedUpdatedAt,
    tags,
  }: {
    noteId: number;
    accountId: number;
    expectedContent: string;
    expectedUpdatedAt: Date;
    tags: string[];
  }): Promise<boolean> {
    if (tags.length === 0) return true;
    const newContent = `${expectedContent}\n${tags.join(' ')}`;
    const { count } = await prisma.notes.updateMany({
      where: { id: noteId, content: expectedContent, updatedAt: expectedUpdatedAt },
      data: { content: newContent, updatedAt: expectedUpdatedAt },
    });
    if (count === 0) {
      console.warn(`[AI tagging] skipped appending tags to note ${noteId}: note changed since read, avoiding clobber`);
      return false;
    }
    await syncNoteTagsFromContent(noteId, accountId, newContent);
    // CUSTOM-JOURNAL: verify the sync actually produced relation rows --
    // server-console-only (was also a visible "TagSync" AI Task Log entry on
    // every single tag apply, dropped per explicit request as noise now that
    // the underlying sync bug this was added to catch is confirmed fixed).
    // Kept as a console.warn safety net in case it ever regresses.
    const relationCount = await prisma.tagsToNote.count({ where: { noteId } });
    if (relationCount === 0) {
      console.warn(`[AI tagging] note ${noteId}: appended tags "${tags.join(' ')}" to content but tagsToNote has 0 rows for this note`);
    }
    // CUSTOM-JOURNAL: no longer re-embeds here -- this used to fire the
    // moment tags were appended, before mood scoring even ran, so RAG saw a
    // half-finished pass (tags but not mood). Every caller of this function
    // (postProcessNote/reanalyzeNote/tagAuditJob) now calls
    // AiService.embedNoteWithMetadata itself exactly once, after BOTH tag
    // and mood work for that note are done.
    return true;
  }

  static async postProcessNote({ noteId, ctx }: { noteId: number; ctx: Context }) {
    let taskLogId: number | null = null;
    try {
      const runtimeContext = new RuntimeContext();
      runtimeContext.set('accountId', ctx.id);

      // Get the configuration -- resolved for this specific note's owner,
      // so their own AI Features/Post-Processing toggle preference (not
      // just the site-wide default) is what's actually enforced here.
      const config = await AiModelFactory.resolveEffectiveConfig(Number(ctx.id));

      // CUSTOM-JOURNAL: master AI killswitch, checked before the
      // post-processing-specific toggle below.
      if (!(await AiModelFactory.assertAiEnabled(config))) {
        return { success: false, message: 'AI features are disabled' };
      }

      // Check if post-processing is enabled
      if (!config.isUseAiPostProcessing) {
        return { success: false, message: 'AI post-processing not enabled' };
      }

      // Fetch the note
      const note = await prisma.notes.findUnique({
        where: { id: noteId },
        select: {
          content: true,
          accountId: true,
          type: true,
          updatedAt: true,
          tags: {
            include: {
              tag: true,
            },
          },
        },
      });
      let noteType = 'blinko'
      switch (note?.type) {
        case 0:
          noteType = 'blinko';
          break;
        case 1:
          noteType = 'note';
          break;
        case 2:
          noteType = 'todo';
          break;
        default:
          noteType = 'blinko';
      }

      if (!note) {
        return { success: false, message: 'Note not found' };
      }

      const processingMode = config.aiPostProcessingMode || 'comment';
      taskLogId = await logAiTaskStart({ accountId: note.accountId, taskType: 'postProcess', noteId, message: `mode: ${processingMode}` });

      // Handle custom processing mode
      if (processingMode === 'custom') {
        // Get all tags for tag replacement
        const tags = await getAllPathTags();
        const tagsList = tags.join(', ');

        // Get custom prompt and replace variables
        let customPrompt = config.aiCustomPrompt || 'Analyze the following note content and provide feedback.';
        customPrompt = customPrompt.replace('{tags}', tagsList).replace('{note}', note.content);
        const withOnlineSearch = !!config.tavilyApiKey || !!config.searxngUrl;
        // Process with AI using BaseChatAgent with tools

        const agent = await AiModelFactory.BaseChatAgent({
          withTools: true,
          withOnlineSearch: withOnlineSearch,
          model: await AiModelFactory.GetPostProcessingLLM(),
          extraInstructions: `You are an AI assistant that helps to process notes. You MUST use the available tools to complete your task.
This is a one-time conversation, so you MUST take action immediately using the tools provided.
You have access to tools that can help you modify notes, add comments, or create new notes.
DO NOT just respond with suggestions or analysis - you MUST use the appropriate tool to implement your changes.
If you need to add a comment, use the createCommentTool.
If you need to update the note, use the updateBlinkoTool.
If you need to create a new note, use the upsertBlinkoTool.
Remember: ALWAYS use tools to implement your suggestions rather than just describing what should be done.`,
        });
        const customInput = `Current user name: ${ctx.name}\n${customPrompt}\n\nNote ID: ${noteId}\nNote content:\n${note.content}
            Current Note Type: ${noteType}`;
        const customSystemPrompt = AiModelFactory.getAgentSystemPrompt(agent);
        await callAgentWithLog({
          taskLogId,
          agent: 'BaseChatAgent (custom)',
          input: customSystemPrompt ? `[System prompt]\n${customSystemPrompt}\n\n[Input]\n${customInput}` : customInput,
          run: () => agent.generate([{ role: 'user', content: customInput }], { runtimeContext }),
        });

        await logAiTaskFinish(taskLogId, 'success', 'Custom processing completed');
        if (config.embeddingModelId) {
          AiService.embedNoteWithMetadata({ noteId, accountId: note.accountId! }).catch((err) => console.error('Error embedding note after post-processing:', err));
        }
        return { success: true, message: 'Custom processing completed' };
      }

      // Get the custom prompt, or use default
      const prompt = config.aiCommentPrompt || 'Analyze the following note content. Extract key topics as tags and provide a brief summary of the main points.';

      // CUSTOM-JOURNAL: this CommentAgent call used to run unconditionally
      // for every processing mode (including 'tags', this journal's seeded
      // default), even though its result (aiResponse) is only ever used
      // inside the comment/both branch below -- meaning every 'tags'-only
      // pass burned an LLM call for a response nothing read. Moved inside
      // the branch that actually needs it. (Found via aiTaskLog call
      // logging showing a 'tags' pass making more calls than the tags/mood
      // logic alone accounts for.)
      if (processingMode === 'comment' || processingMode === 'both') {
        const agent = await AiModelFactory.CommentAgent();
        const commentInput = `${prompt}\n\nNote content: ${note.content}`;
        const commentSystemPrompt = AiModelFactory.getAgentSystemPrompt(agent);
        const modelInfo = await AiService.#getPostProcessingModelInfo(config);
        const result = await callAgentWithLog({
          taskLogId,
          agent: 'CommentAgent',
          provider: modelInfo.provider,
          modelTitle: modelInfo.title,
          input: commentSystemPrompt ? `[System prompt]\n${commentSystemPrompt}\n\n[Input]\n${commentInput}` : commentInput,
          run: () => agent.generate([
            { role: 'user', content: prompt },
            { role: 'user', content: `Note content: ${note.content}` },
          ]),
        });
        const aiResponse = result.text.trim();

        // Add comment
        const comment = await prisma.comments.create({
          data: {
            content: aiResponse,
            noteId,
            guestName: 'Blinko AI',
            guestIP: '',
            guestUA: '',
          },
          include: commentWebhookInclude,
        });
        sendCommentWebhook('comment.created', comment, ctx);

        await CreateNotification({
          accountId: note.accountId ?? 0,
          title: 'ai-post-processing-notification',
          content: 'ai-processed-your-note',
          type: NotificationType.COMMENT,
        });
      }

      if (processingMode === 'tags' || processingMode === 'both') {
        try {
          const suggestedTags = await AiService.suggestTags(note.content, taskLogId);
          await AiService.appendTagsIfUnchanged({
            noteId,
            accountId: note.accountId!,
            expectedContent: note.content,
            expectedUpdatedAt: note.updatedAt,
            tags: suggestedTags,
          });
        } catch (error) {
          console.error('Error processing tags:', error);
        }

        try {
          const moodScores = await AiService.scoreMood(note.content, taskLogId);
          if (Object.keys(moodScores).length > 0) {
            await prisma.notes.update({ where: { id: noteId }, data: { moodScores, updatedAt: note.updatedAt } });
          }
        } catch (error) {
          console.error('Error scoring mood:', error);
        }

        // CUSTOM-JOURNAL: preserve updatedAt here too -- marking a note as
        // AI-tagged is a background bookkeeping write, not a user edit, and
        // shouldn't bump "recently updated" sort.
        await prisma.notes.update({ where: { id: noteId }, data: { aiTaggedAt: new Date(), updatedAt: note.updatedAt } });
      }

      if (processingMode === 'smartEdit' || processingMode === 'both') {
        try {
          const smartEditPrompt = config.aiSmartEditPrompt || 'Improve this note by organizing content, adding headers, and enhancing readability.';
          const agent = await AiModelFactory.BaseChatAgent({
            withTools: true,
            model: await AiModelFactory.GetPostProcessingLLM(),
            extraInstructions: `You are an AI assistant that helps to improve notes. You'll be provided with a note content, and your task is to enhance it according to instructions. You have access to tools that can help you modify the note. Use these tools to make the requested improvements.`,
          });
          const smartEditInput = `\nCurrent user id: ${ctx.id}\nCurrent user name: ${ctx.name}\n${smartEditPrompt}\n\nNote ID: ${noteId}\nNote content:\n${note.content}`;
          const smartEditSystemPrompt = AiModelFactory.getAgentSystemPrompt(agent);
          const result = await callAgentWithLog({
            taskLogId,
            agent: 'BaseChatAgent (smartEdit)',
            input: smartEditSystemPrompt ? `[System prompt]\n${smartEditSystemPrompt}\n\n[Input]\n${smartEditInput}` : smartEditInput,
            run: () => agent.generate([{ role: 'user', content: smartEditInput }], { runtimeContext }),
          });
          const comment = await prisma.comments.create({
            data: {
              content: result.text,
              noteId,
              guestName: 'Blinko AI',
              guestIP: '',
              guestUA: '',
            },
            include: commentWebhookInclude,
          });
          sendCommentWebhook('comment.created', comment, ctx);
        } catch (error) {
          console.error('Error during smart edit:', error);
          const comment = await prisma.comments.create({
            data: {
              content: `⚠️ **Smart Edit Error**\n\nI encountered an error while trying to edit this note. This may happen if the AI model doesn't support function calling or if there was an issue with the edit process.\n\nError details: ${error.message}`,
              noteId,
              guestName: 'Blinko AI',
              guestIP: '',
              guestUA: '',
            },
            include: commentWebhookInclude,
          });
          sendCommentWebhook('comment.created', comment, ctx);
        }
      }

      await logAiTaskFinish(taskLogId, 'success', `mode: ${processingMode}`);
      // CUSTOM-JOURNAL: RAG embedding deliberately happens LAST, after
      // tags+mood (and any content-editing modes) above have finished --
      // see embedNoteWithMetadata's own comment for why this replaced the
      // old eager re-embed inside appendTagsIfUnchanged.
      if (config.embeddingModelId) {
        AiService.embedNoteWithMetadata({ noteId, accountId: note.accountId! }).catch((err) => console.error('Error embedding note after post-processing:', err));
      }
      return { success: true, message: 'Note processed successfully' };
    } catch (error) {
      console.error('Error in post-processing note:', error);
      await logAiTaskFinish(taskLogId, 'error', error.message || 'Unknown error');
      return { success: false, message: error.message || 'Unknown error' };
    }
  }

  // CUSTOM-JOURNAL: "Re-run AI analysis" -- on-demand, per-note version of
  // the tags+mood pipeline, triggered from the right-click menu (previously
  // that menu item, "AI Tag," actually called the old autoTag tRPC
  // procedure: a raw TagAgent.generate() call using the upstream
  // hardcoded-existing-tag-list/slash-hierarchy prompt convention and a
  // manual pick-and-insert dialog -- none of the fixes made to suggestTags/
  // scoreMood/tag-application this project ever applied to it, and it never
  // touched mood at all). This instead reuses the same real pipeline
  // tagAuditJob.ts's backfill and postProcessNote use: transcribe any
  // pending audio first, then suggest+apply tags (auto-applied via the
  // normal CAS write + relational sync, not a manual picker), then score
  // mood. Deliberately does NOT gate on config.aiPostProcessingMode the way
  // postProcessNote does -- a user explicitly asking to re-run analysis on
  // one note wants the real tags+mood pipeline regardless of whatever the
  // global post-processing mode happens to be set to.
  static async reanalyzeNote({ noteId, ctx }: { noteId: number; ctx: Context }) {
    // CUSTOM-JOURNAL: master AI killswitch only -- deliberately NOT gated on
    // isUseAiPostProcessing, for the same reason this function already
    // ignores aiPostProcessingMode (see the comment below): a user
    // explicitly clicking "Re-run AI analysis" on one note wants the real
    // pipeline regardless of the global automatic-mode/toggle state. The
    // menu item itself is still hidden when post-processing is off (see
    // BlinkoRightClickMenu) -- that's a UI-discoverability choice, not a
    // reason to block an already-triggered explicit request here too.
    if (!(await AiModelFactory.assertAiEnabled(await AiModelFactory.resolveEffectiveConfig(Number(ctx.id))))) {
      throw new Error('AI features are disabled');
    }

    const note = await prisma.notes.findUnique({
      where: { id: noteId, accountId: Number(ctx.id) },
      select: { content: true, accountId: true, updatedAt: true },
    });
    if (!note) throw new Error('Note not found');

    const taskLogId = await logAiTaskStart({ accountId: note.accountId, taskType: 'postProcess', noteId, message: 'Manual re-run AI analysis' });
    try {
      let noteContent = note.content;
      let noteUpdatedAt = note.updatedAt;
      // CUSTOM-JOURNAL: always call this, forced -- unconditionally, not
      // gated on hasPendingAudioTranscription. That check only sees
      // attachments never yet attempted (transcribedAt IS NULL); any
      // attachment that was ever attempted before (even one that produced
      // nothing, e.g. before the AudioProvider fix) would silently look
      // "done" and get skipped, so "Re-run AI analysis" could tag/score a
      // note whose actual voice content was never really transcribed.
      // force:true retranscribes regardless of transcribedAt, guaranteeing
      // the real transcript exists before anything gets sent to the tag/
      // mood models below. transcribeAndAppend itself no-ops cleanly (logs
      // why, doesn't throw) if the note has no audio attachment at all.
      await AiService.transcribeAndAppend({ noteId, accountId: note.accountId!, force: true });
      const refreshed = await prisma.notes.findUnique({ where: { id: noteId }, select: { content: true, updatedAt: true } });
      noteContent = refreshed?.content ?? note.content;
      noteUpdatedAt = refreshed?.updatedAt ?? note.updatedAt;

      try {
        const suggestedTags = await AiService.suggestTags(noteContent, taskLogId);
        await AiService.appendTagsIfUnchanged({
          noteId,
          accountId: note.accountId!,
          expectedContent: noteContent,
          expectedUpdatedAt: noteUpdatedAt,
          tags: suggestedTags,
        });
      } catch (error) {
        console.error('Error re-running tags:', error);
      }

      const moodScores = await AiService.scoreMood(noteContent, taskLogId);
      // CUSTOM-JOURNAL: unlike postProcessNote's automatic tagging, this is
      // an EXPLICIT user-triggered action from the right-click menu ("Re-run
      // AI analysis") -- per product decision, manual AI actions should bump
      // updatedAt like any other user edit; only automatic/background AI
      // writes (postProcessNote, tagAuditJob's backfill) continue to
      // preserve it. Let Prisma's @updatedAt auto-touch this normally -- no
      // updatedAt override. (The intermediate CAS writes above --
      // transcribeAndAppend's forced call and appendTagsIfUnchanged -- still
      // preserve updatedAt internally to stay consistent with the
      // noteUpdatedAt value they were CAS-chained against; this final write
      // is what actually bumps it for real, so there's no user-visible
      // inconsistency.)
      await prisma.notes.update({
        where: { id: noteId },
        data: {
          aiTaggedAt: new Date(),
          ...(Object.keys(moodScores).length > 0 && { moodScores }),
        },
      });

      await logAiTaskFinish(taskLogId, 'success', 'Manual re-run AI analysis completed');
      // CUSTOM-JOURNAL: re-embed last, after transcription/tags/mood above
      // -- same reasoning as postProcessNote's own final embed call.
      const config = await AiModelFactory.globalConfig();
      if (config.embeddingModelId) {
        AiService.embedNoteWithMetadata({ noteId, accountId: note.accountId! }).catch((err) => console.error('Error embedding note after reanalyze:', err));
      }
      return { success: true };
    } catch (error: any) {
      await logAiTaskFinish(taskLogId, 'error', error?.message || String(error));
      throw error;
    }
  }

  /**
   * Transcribe audio file to text
   * @param filePath Audio file path
   * @param voiceModelId Voice model ID
   * @param accountId User account ID
   * @returns Transcribed text content
   */
  static async transcribeAudio({
    filePath,
    voiceModelId,
    accountId
  }: {
    filePath: string;
    voiceModelId: number;
    accountId: number;
  }): Promise<string> {
    try {
      // Get voice model configuration
      const voiceModel = await prisma.aiModels.findUnique({
        where: { id: voiceModelId },
        include: { provider: true },
      });

      if (!voiceModel || !(voiceModel.capabilities as any)?.audio) {
        throw new Error('Voice model not found or does not support audio');
      }

      // Get audio provider
      const { audioModel } = await AiModelFactory.GetProvider();
      // Read audio file
      const fs = await import('fs');
      if (!fs.existsSync(filePath)) {
        throw new Error(`Audio file not found: ${filePath}`);
      }

      // Get file extension to determine audio format
      const path = await import('path');
      const fileExtension = path.extname(filePath).toLowerCase().substring(1);
      // Create audio stream
      const audioStream = fs.createReadStream(filePath);
      // Execute speech to text, 
      // {
      //   filetype: fileExtension || 'mp3',
      // }
      const transcription = await audioModel?.listen(audioStream,
        {
          filetype: fileExtension || 'mp3',
        }
      );

      console.log(`Audio transcription completed for file: ${filePath},${transcription}`);
      return transcription?.toString() || '';
    } catch (error) {
      console.error('Error transcribing audio:', error);
      throw new Error(`Audio transcription failed: ${error.message}`);
    }
  }

  /**
   * Process audio attachments for transcription
   * @param attachments Array of attachments to process
   * @param voiceModelId Voice model ID
   * @param accountId User account ID
   * @returns Transcription results
   */
  static async processNoteAudioAttachments({
    attachments,
    voiceModelId,
    accountId,
    taskLogId = null,
  }: {
    attachments: Array<{ name: string; path: string; type?: string }>;
    voiceModelId: number;
    accountId: number;
    taskLogId?: number | null;
  }): Promise<{ success: boolean; transcriptions: Array<{ fileName: string; transcription: string }>; error?: string }> {
    try {
      const audioAttachments = attachments.filter(attachment =>
        this.isAudio(attachment.name || attachment.path)
      );

      if (audioAttachments.length === 0) {
        // CUSTOM-JOURNAL: distinct from a real failure -- surfaced as its
        // own call-log entry so "transcription task finished instantly with
        // 0 calls" is diagnosable as "no file here was recognized as
        // audio" rather than an unexplained no-op (see transcribeAndAppend's
        // caller, which used to report this identically to every other
        // failure as "Transcription failed or produced no text").
        await logAiTaskCall(taskLogId, {
          agent: 'AudioTranscription',
          input: attachments.map((a) => a.name || a.path).join(', '),
          output: '',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          error: 'None of the pending attachments were recognized as audio by isAudio() -- check attachment name/extension',
        });
        return { success: true, transcriptions: [] };
      }

      // CUSTOM-JOURNAL: resolved once per batch, not per file -- used to
      // label each per-call log entry (see logAiTaskCall below) the same way
      // TagAgent/MoodAgent/CommentAgent's calls already are.
      const modelInfo = await AiService.#getVoiceModelInfo();

      const transcriptions: any = [];

      for (const attachment of audioAttachments) {
        let cleanup: (() => Promise<void>) | undefined;
        const startedAt = new Date();
        try {
          // Use FileService to get file path (handles both local and S3 storage)
          const fileResult = await FileService.getFile(attachment.path);
          cleanup = fileResult.cleanup;

          const transcription = await this.transcribeAudio({
            filePath: fileResult.path,
            voiceModelId,
            accountId,
          });

          transcriptions.push({
            fileName: attachment.name || attachment.path,
            transcription,
          });

          // CUSTOM-JOURNAL: call-level log entry with real content (input =
          // which file, output = the transcript itself) -- previously
          // transcription only ever got a task-level start/finish row with
          // no calls, so its detail view showed nothing to actually read.
          await logAiTaskCall(taskLogId, {
            agent: 'AudioTranscription',
            provider: modelInfo.provider,
            modelTitle: modelInfo.title,
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            input: `Audio file: ${attachment.name || attachment.path}`,
            output: transcription,
          });

          console.log(`Transcribed audio: ${attachment.name}`);
        } catch (error) {
          console.error(`Failed to transcribe audio ${attachment.name}:`, error);
          await logAiTaskCall(taskLogId, {
            agent: 'AudioTranscription',
            provider: modelInfo.provider,
            modelTitle: modelInfo.title,
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            input: `Audio file: ${attachment.name || attachment.path}`,
            output: '',
            error: error?.message || String(error),
          });
        } finally {
          // Clean up temporary file if using S3 storage
          if (cleanup) {
            try {
              await cleanup();
            } catch (cleanupError) {
              console.error(`Failed to cleanup temporary file for ${attachment.name}:`, cleanupError);
            }
          }
        }
      }

      return { success: true, transcriptions };
    } catch (error: any) {
      // CUSTOM-JOURNAL: this used to only console.error and return
      // success:false with no detail -- a failure here (e.g. resolving the
      // voice model config) meant the per-attachment loop, and therefore
      // every logAiTaskCall entry above, never even ran, so the resulting
      // task showed 0 calls with no way to tell why from the UI. Log a
      // diagnostic call with the real error before returning so it's
      // visible without server console access, and propagate the message
      // to the caller so transcribeAndAppend's finish message is specific
      // instead of the generic "failed or produced no text".
      console.error('Error processing note audio attachments:', error);
      await logAiTaskCall(taskLogId, {
        agent: 'AudioTranscription',
        input: attachments.map((a) => a.name || a.path).join(', '),
        output: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: error?.message || String(error),
      });
      return { success: false, transcriptions: [], error: error?.message || String(error) };
    }
  }

  // CUSTOM-JOURNAL: true if this note has an audio attachment whose
  // transcript hasn't been appended yet. Used to gate AI tagging/mood
  // scoring -- many entries are voice-only, so tagging before the transcript
  // exists would tag empty/near-empty content.
  static async hasPendingAudioTranscription(noteId: number): Promise<boolean> {
    const attachments = await prisma.attachments.findMany({ where: { noteId, transcribedAt: null } });
    return attachments.some((a) => AiService.isAudio(a.name || a.path));
  }

  // CUSTOM-JOURNAL: transcribes audio attachments on a note and appends each
  // transcript under its own "## Audio Transcription" heading. Two modes:
  // - force=false (default): only attachments never yet attempted
  //   (transcribedAt IS NULL). Used by the automatic paths -- note.ts's
  //   create/update, tagAuditJob.ts's backfill, reanalyzeNote's normal
  //   check -- where retrying an attachment forever after one failed
  //   attempt would just waste calls on a permanently-broken file.
  // - force=true: every audio attachment on the note, regardless of
  //   transcribedAt. Used by the explicit "Transcribe" menu action (and
  //   reanalyzeNote, per explicit request that it guarantee a transcript
  //   exists before tagging/scoring) -- transcribedAt getting set on ANY
  //   attempt (even one that produced nothing, e.g. before the
  //   AudioProvider fix) meant a note whose audio never actually got
  //   transcribed looked permanently "done" to hasPendingAudioTranscription
  //   forever after, so clicking "Transcribe" again silently did nothing:
  //   no pending attachments found, immediate no-op return, before
  //   logAiTaskStart even ran -- a toast that flashes and vanishes with
  //   zero log/network evidence, exactly matching what force fixes. Also
  //   logs a task (with a real reason) for the "nothing to do" cases when
  //   force is set, since an explicit user action deserves visible feedback
  //   either way -- the non-forced/automatic paths stay silent on purpose,
  //   they're not something a person is watching for a result.
  static async transcribeAndAppend({ noteId, accountId, force = false }: { noteId: number; accountId: number; force?: boolean }): Promise<{ transcribedAny: boolean; message?: string }> {
    // Resolved for this note's owning account, so their own toggle
    // preference (not just the site-wide default) is enforced.
    const config = await AiModelFactory.resolveEffectiveConfig(accountId);
    // CUSTOM-JOURNAL: gates every caller (note create/update, reanalyzeNote,
    // the manual "Transcribe" menu button) from this single entry point --
    // the master AI killswitch and the "AI Audio Transcription" toggle
    // (isUseAiTranscription, one of the 4 cascading AI Features toggles).
    if (!(await AiModelFactory.assertAiEnabled(config)) || config.isUseAiTranscription === false) {
      const message = !(await AiModelFactory.assertAiEnabled(config))
        ? 'AI features are disabled'
        : 'Audio transcription is disabled (AI Settings -> AI Audio Transcription)';
      if (force) {
        const taskLogId = await logAiTaskStart({ accountId, taskType: 'transcription', noteId, message: 'Manual transcribe requested' });
        await logAiTaskFinish(taskLogId, 'error', message);
      }
      return { transcribedAny: false, message };
    }
    if (!config.voiceModelId) {
      const message = 'No voice/transcription model configured (AI Settings -> Voice)';
      if (force) {
        const taskLogId = await logAiTaskStart({ accountId, taskType: 'transcription', noteId, message: 'Manual transcribe requested' });
        await logAiTaskFinish(taskLogId, 'error', message);
      }
      return { transcribedAny: false, message };
    }

    const audioAttachments = (await prisma.attachments.findMany({ where: { noteId } }))
      .filter((a) => AiService.isAudio(a.name || a.path));
    const targetAttachments = force ? audioAttachments : audioAttachments.filter((a) => a.transcribedAt == null);
    if (targetAttachments.length === 0) {
      // CUSTOM-JOURNAL: no task log entry here, unlike the two config-error
      // branches above -- "this note has no audio attachment" isn't really
      // a failure (the manual Transcribe button has no attachment-presence
      // gate, so it's reachable from any text-only note), it's just nothing
      // to do. The caller (handleTranscribe) already surfaces `message` as
      // a toast on !transcribedAny, so this stays visible to the user
      // without also leaving a permanent "error" row in the AI Task Log for
      // something that isn't one.
      return { transcribedAny: false, message: 'No audio attachment found on this note' };
    }

    const taskLogId = await logAiTaskStart({
      accountId,
      taskType: 'transcription',
      noteId,
      message: `${targetAttachments.length} audio attachment(s)${force ? ' (forced)' : ''}`,
    });

    const { success, transcriptions, error: batchError } = await AiService.processNoteAudioAttachments({
      attachments: targetAttachments,
      voiceModelId: config.voiceModelId,
      accountId,
      taskLogId,
    });

    // Mark every attempted attachment as processed regardless of per-file
    // success, so a single bad audio file can't permanently block tagging
    // (and doesn't get retried forever by the nightly tag audit).
    await prisma.attachments.updateMany({
      where: { id: { in: targetAttachments.map((a) => a.id) } },
      data: { transcribedAt: new Date() },
    });

    if (!success || transcriptions.length === 0) {
      // CUSTOM-JOURNAL: was one generic message ("Transcription failed or
      // produced no text") for every distinct failure mode -- now specific
      // enough to diagnose from the AI Task Log UI alone.
      const message = batchError
        ? `Transcription batch failed: ${batchError}`
        : transcriptions.length === 0
          ? 'No attachments were recognized as audio to transcribe'
          : 'Transcription produced no text';
      await logAiTaskFinish(taskLogId, 'error', message);
      return { transcribedAny: false, message };
    }
    if (transcriptions.every((t) => !t.transcription)) {
      const message = 'Every attachment transcribed to an empty string -- check the voice model/provider config';
      await logAiTaskFinish(taskLogId, 'error', `${message} (see per-call log entries above)`);
      return { transcribedAny: false, message };
    }

    // transcriptions are matched to targetAttachments positionally by
    // fileName (see processNoteAudioAttachments) -- zip the attachment id
    // back in so each block can be looked up/replaced independent of order.
    const fileNameToAttachmentId = new Map(targetAttachments.map((a) => [a.name || a.path, a.id]));
    const transcriptionsWithId = transcriptions
      .map((t) => ({ ...t, attachmentId: fileNameToAttachmentId.get(t.fileName) }))
      .filter((t): t is typeof t & { attachmentId: number } => t.attachmentId != null);

    // CUSTOM-JOURNAL: CAS-retry the content write against freshly-read
    // content/updatedAt each attempt. Transcripts must never be silently
    // lost (the attachments above are already marked transcribedAt, so a
    // dropped write here would never be retried), but a blind overwrite
    // could clobber a concurrent user edit -- so only ever commit if nothing
    // changed underneath us since the read, and keep retrying against the
    // latest content until it succeeds. Automatic transcription (force:false)
    // preserves the pre-transcript updatedAt so background bookkeeping
    // doesn't bump "recently updated" sort; the manual "Transcribe" button
    // (force:true) is an explicit user action and should bump updatedAt like
    // any user edit -- same distinction reanalyzeNote's final write makes.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await prisma.notes.findUnique({ where: { id: noteId }, select: { content: true, createdAt: true, updatedAt: true } });
      if (!current) {
        await logAiTaskFinish(taskLogId, 'error', 'Note no longer exists');
        return { transcribedAny: false, message: 'Note no longer exists' };
      }

      // Replace-in-place per attachment instead of blind append -- derived
      // fresh from current.content every attempt, since a concurrent edit
      // could itself have added/removed a block between retries.
      let newContent = current.content;
      for (const t of transcriptionsWithId) {
        const block = AiService.transcriptionBlock(t.attachmentId, t.transcription);
        const re = AiService.transcriptionBlockRegex(t.attachmentId);
        newContent = re.test(newContent) ? newContent.replace(re, block) : newContent + block;
      }

      const { count } = await prisma.notes.updateMany({
        where: { id: noteId, content: current.content, updatedAt: current.updatedAt },
        data: force
          ? { content: newContent } // explicit user action -- let @updatedAt auto-touch
          : { content: newContent, updatedAt: current.updatedAt }, // automatic/background -- preserve
      });

      if (count > 0) {
        if (config.embeddingModelId) {
          AiService.embeddingUpsert({ id: noteId, content: newContent, type: 'update', createTime: current.createdAt, updatedAt: current.updatedAt });
        }
        await logAiTaskFinish(taskLogId, 'success', `Appended ${transcriptions.length} transcript(s)`);
        return { transcribedAny: true };
      }
      // Lost the race against a concurrent write -- retry against fresh content.
    }

    console.error(`[transcription] failed to append transcript to note ${noteId} after ${MAX_ATTEMPTS} attempts (concurrent writes)`);
    await logAiTaskFinish(taskLogId, 'error', `Failed after ${MAX_ATTEMPTS} attempts (concurrent writes)`);
    return { transcribedAny: false, message: `Failed after ${MAX_ATTEMPTS} attempts (concurrent writes)` };
  }
}
