import { LLMProvider, EmbeddingProvider, AudioProvider, AiUtilities } from './providers';
import { upsertBlinkoTool } from './tools/createBlinko';
import { createCommentTool } from './tools/createComment';
import { LibSQLVector } from "@mastra/libsql";
import dayjs from 'dayjs';
import { Agent, Mastra } from '@mastra/core';
import { LanguageModelV1, EmbeddingModelV1 } from '@ai-sdk/provider';
import { MarkdownTextSplitter, TokenTextSplitter } from '@langchain/textsplitters';
import { embed } from 'ai';
import { _ } from '@shared/lib/lodash';
import { webSearchTool } from './tools/webSearch';
import { webExtra } from './tools/webExtra';
import { searchBlinkoTool } from './tools/searchBlinko';
import { updateBlinkoTool } from './tools/updateBlinko';
import { deleteBlinkoTool } from './tools/deleteBlinko';
import { createScheduledTaskTool, deleteScheduledTaskTool, listScheduledTasksTool } from './tools/scheduledTask';
import { getMcpMastraTools, hasMcpServers } from './mcp';
import { rerank } from '@mastra/rag';
import { prisma } from '@server/prisma';
import { getGlobalConfig } from '@server/routerTrpc/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PinoLogger } from '@mastra/loggers';
import { ModelCapabilities } from './types';
import { aiModels } from '@shared/index';
import { MastraVoice } from '@mastra/core/voice';

export class AiModelFactory {
  static async queryAndDeleteVectorById(targetId: number) {
    const { VectorStore } = await AiModelFactory.GetProvider();
    try {
      const query = `
          WITH target_record AS (
            SELECT vector_id 
            FROM 'blinko'
            WHERE metadata->>'id' = ? 
            LIMIT 1
          )
          DELETE FROM 'blinko'
          WHERE vector_id IN (SELECT vector_id FROM target_record)
          RETURNING *;`;
      //@ts-ignore
      const result = await VectorStore.turso.execute({
        sql: query,
        args: [targetId],
      });

      if (result.rows.length === 0) {
        throw new Error(`id  ${targetId} is not found`);
      }

      return {
        success: true,
        deletedData: result.rows[0],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  // CUSTOM-JOURNAL: nomic-embed-text (this journal's seeded/default embedding
  // model) is trained on task-prefixed pairs and needs "search_query: " /
  // "search_document: " prefixes to produce well-separated cosine scores --
  // without them, a short conversational question and a longer journal entry
  // about the same thing routinely score well under a 0.4-0.6 threshold even
  // when they're a real match. See
  // https://huggingface.co/nomic-ai/nomic-embed-text-v1.5#usage
  static async getEmbeddingModelKey(): Promise<string | null> {
    const globalConfig = await AiModelFactory.globalConfig();
    if (!globalConfig.embeddingModelId) return null;
    const embeddingModel = await AiModelFactory.getAiModel(globalConfig.embeddingModelId);
    return embeddingModel?.modelKey ?? null;
  }

  static applyEmbeddingPrefix(text: string, modelKey: string | null, task: 'query' | 'document'): string {
    if (modelKey?.includes('nomic-embed-text')) {
      return `${task === 'query' ? 'search_query' : 'search_document'}: ${text}`;
    }
    return text;
  }

  static async queryVector(query: string, accountId: number, _topK?: number) {
    const { VectorStore, Embeddings } = await AiModelFactory.GetProvider();
    if (!Embeddings) {
      throw new Error("No embeddings model config")
    }
    const config = await AiModelFactory.globalConfig();
    const topK = _topK ?? config.embeddingTopK ?? 5;
    // CUSTOM-JOURNAL: a personal journal has far fewer, more varied notes
    // than a typical RAG corpus -- missing the one relevant entry is a much
    // worse outcome than the model occasionally seeing an unrelated one, so
    // this defaults lower (more inclusive) than the 0.6 that made sense
    // upstream. Keep in sync with EmbeddingSettingsSection.tsx's UI default.
    const embeddingMinScore = config.embeddingScore ?? 0.3;
    const modelKey = await AiModelFactory.getEmbeddingModelKey();
    const { embedding } = await embed({
      value: AiModelFactory.applyEmbeddingPrefix(query, modelKey, 'query'),
      model: Embeddings,
    });

    const result = await VectorStore.query({
      indexName: 'blinko',
      queryVector: embedding,
      topK: topK,
    });
    let filteredResults = result.filter(({ score }) => score >= embeddingMinScore);

    const notes =
      (
        await prisma.notes.findMany({
          where: {
            accountId: accountId,
            id: {
              in: _.uniqWith(filteredResults.map((i) => Number(i.metadata?.id))).filter((i) => !!i) as number[],
            },
          },
          include: {
            tags: { include: { tag: true } },
            attachments: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
            references: {
              select: {
                toNoteId: true,
                toNote: {
                  select: {
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
            referencedBy: {
              select: {
                fromNoteId: true,
                fromNote: {
                  select: {
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
            _count: {
              select: {
                comments: true,
                histories: true,
              },
            },
          },
        })
      ).map((i) => {
        return { ...i, score: filteredResults.find((t) => Number(t.metadata?.id) == i.id)?.score ?? 0 };
      }) ?? [];

    let aiContext = notes.map((i) => i.content + '\n') || '';
    return { notes, aiContext: aiContext };
  }

  static async rebuildVectorIndex({ vectorStore, isDelete = false }: { vectorStore: LibSQLVector; isDelete?: boolean }) {
    try {
      if (isDelete) {
        await vectorStore.deleteIndex({ indexName: 'blinko' });
      }
    } catch (error) {
      console.error('delete vector index failed:', error);
    }

    const config = await AiModelFactory.globalConfig();
    const embeddingModel = config.embeddingModelId ? await AiModelFactory.getAiModel(config.embeddingModelId) : null;
    if (!embeddingModel) {
      console.warn('Embedding model not configured, skipping vector index creation');
      return;
    }

    const model = embeddingModel.modelKey.toLowerCase();
    let userConfigDimensions = (embeddingModel.config as any)?.embeddingDimensions || 0;
    let dimensions: number = 0;
    switch (true) {
      case model.includes('text-embedding-3-small'):
        dimensions = 1536;
        break;
      case model.includes('text-embedding-3-large'):
        dimensions = 3072;
        break;
      case model.includes('cohere/embed-english-v3') || model.includes('bge-m3') || model.includes('voyage') || model.includes('bge-large'):
        dimensions = 1024;
        break;
      case model.includes('cohere'):
        dimensions = 4096;
        break;
      case model.includes('voyage-3-lite'):
        dimensions = 512;
        break;
      case model.includes('bge') || model.includes('bert') || model.includes('bce-embedding-base'):
        dimensions = 768;
        break;
      case model.includes('all-minilm'):
        dimensions = 384;
        break;
      case model.includes('mxbai-embed-large'):
        dimensions = 1024;
        break;
      case model.includes('nomic-embed-text'):
        dimensions = 768;
        break;
      case model.includes('bge-large-en'):
        dimensions = 1024;
        break;
      default:
        if (userConfigDimensions == 0 || userConfigDimensions == undefined || !userConfigDimensions) {
          throw new Error('Must set the embedding dimension in ai Settings > Embed Settings > Advanced Settings');
        }
    }
    if (userConfigDimensions != 0 && userConfigDimensions != undefined) {
      dimensions = userConfigDimensions;
    }
    await vectorStore.createIndex({ indexName: 'blinko', dimension: dimensions, metric: 'cosine' });
  }

  static async globalConfig() {
    return await getGlobalConfig({ useAdmin: true });
  }

  static async getAiProvider(id: number) {
    return await prisma.aiProviders.findUnique({
      where: { id },
      include: { models: true }
    });
  }

  static async getAllAiProviders() {
    return await prisma.aiProviders.findMany({
      include: { models: true },
      orderBy: { sortOrder: 'asc' }
    });
  }

  static async getAiModel(id: number) {
    return await prisma.aiModels.findUnique({
      where: { id },
      include: { provider: true }
    });
  }

  static async getAiModelsByCapability(capability: string) {
    return await prisma.aiModels.findMany({
      where: {
        capabilities: {
          path: [capability],
          equals: true
        }
      },
      include: { provider: true },
      orderBy: { sortOrder: 'asc' }
    });
  }


  static async ValidConfig() {
    const globalConfig = await AiModelFactory.globalConfig();
    if (!globalConfig.mainModelId) {
      throw new Error('Main AI model not configured!');
    }
    return await AiModelFactory.globalConfig();
  }

  // CUSTOM-JOURNAL: the LLM used for AI Post-Processing (tag suggestion,
  // mood scoring, comment/smartEdit/custom modes, tagAuditJob backfill) --
  // falls back to mainModelId when postProcessingModelId isn't set, so this
  // is a safe drop-in for anything that used to just read provider.LLM.
  // Deliberately lightweight (doesn't build embeddings/audio/etc like
  // GetProvider does) since post-processing only ever needs a chat model.
  static async GetPostProcessingLLM(): Promise<LanguageModelV1> {
    const globalConfig = await AiModelFactory.globalConfig();
    const modelId = globalConfig.postProcessingModelId || globalConfig.mainModelId;
    if (!modelId) {
      throw new Error('No AI model configured for post-processing (set a Main Chat Model or a Post-Processing Model)');
    }
    const model = await AiModelFactory.getAiModel(modelId);
    if (!model) {
      throw new Error('Post-processing model configuration not found');
    }
    const llmProvider = new LLMProvider();
    return await llmProvider.getLanguageModel({
      provider: model.provider.provider,
      apiKey: model.provider.apiKey,
      baseURL: model.provider.baseURL,
      modelKey: model.modelKey,
      apiVersion: (model.provider.config as any)?.apiVersion,
    });
  }

  static async GetProvider() {
    const globalConfig = await AiModelFactory.ValidConfig();
    if (!globalConfig.mainModelId) {
      throw new Error('Main AI model configuration not found!');
    }
    const mainModel = await AiModelFactory.getAiModel(globalConfig.mainModelId);
    if (!mainModel) {
      throw new Error('Main AI model configuration not found!');
    }

    const embeddingModel = globalConfig.embeddingModelId
      ? await AiModelFactory.getAiModel(globalConfig.embeddingModelId)
      : null;

    const audioModel = globalConfig.voiceModelId
      ? await AiModelFactory.getAiModel(globalConfig.voiceModelId)
      : null;

    const imageModel = globalConfig.imageModelId
      ? await AiModelFactory.getAiModel(globalConfig.imageModelId)
      : null;

    // Initialize providers
    const llmProvider = new LLMProvider();
    const embeddingProvider = new EmbeddingProvider();
    const audioProvider = new AudioProvider();

    // Create LLM configuration
    const llmConfig = {
      provider: mainModel.provider.provider,
      apiKey: mainModel.provider.apiKey,
      baseURL: mainModel.provider.baseURL,
      modelKey: mainModel.modelKey,
      apiVersion: (mainModel.provider.config as any)?.apiVersion
    };

    // Get LLM instance
    const llm = await llmProvider.getLanguageModel(llmConfig);

    // Get Embedding instance (if configured)
    let embeddings: EmbeddingModelV1<string> | null = null;
    if (embeddingModel) {
      const embeddingConfig = {
        provider: embeddingModel.provider.provider,
        apiKey: embeddingModel.provider.apiKey,
        baseURL: embeddingModel.provider.baseURL,
        modelKey: embeddingModel.modelKey,
        apiVersion: (embeddingModel.provider.config as any)?.apiVersion
      };
      embeddings = await embeddingProvider.getEmbeddingModel(embeddingConfig);
    }

    // Get Audio instance (if configured)
    let audio: MastraVoice | null = null;
    if (audioModel) {
      const audioConfig = {
        provider: audioModel.provider.provider,
        apiKey: audioModel.provider.apiKey,
        baseURL: audioModel.provider.baseURL,
        modelKey: audioModel.modelKey,
        apiVersion: (audioModel.provider.config as any)?.apiVersion
      };
      audio = await audioProvider.getAudioModel(audioConfig);
    }

    // Get utilities
    const vectorStore = await AiUtilities.VectorStore();
    const markdownSplitter = AiUtilities.MarkdownSplitter();
    const tokenTextSplitter = AiUtilities.TokenTextSplitter();

    return {
      LLM: llm,
      VectorStore: vectorStore,
      Embeddings: embeddings,
      MarkdownSplitter: markdownSplitter,
      TokenTextSplitter: tokenTextSplitter,
      audioModel: audio,
      // Keep for backward compatibility
      provider: {
        llmProvider,
        embeddingProvider,
        audioProvider
      }
    };
  }
  static async BaseChatAgent({ withTools = true, withOnlineSearch = false, withMcpTools = true, extraInstructions, model }: { withTools?: boolean; withOnlineSearch?: boolean; withMcpTools?: boolean; extraInstructions?: string; model?: LanguageModelV1 }) {
    // CUSTOM-JOURNAL: `model` lets a caller (postProcessNote's smartEdit/
    // custom modes) use the post-processing model instead of mainModelId --
    // skips GetProvider() entirely in that case since this agent only ever
    // needs the chat model out of everything GetProvider builds.
    const chatModel = model ?? (await AiModelFactory.GetProvider())?.LLM!;
    let tools: Record<string, any> = {};
    if (withTools) {
      tools = {
        tools: {
          upsertBlinkoTool,
          searchBlinkoTool,
          updateBlinkoTool,
          deleteBlinkoTool,
          webExtra,
          webSearchTool,
          createCommentTool,
          createScheduledTaskTool,
          deleteScheduledTaskTool,
          listScheduledTasksTool,
        },
      };
    }
    if (withOnlineSearch) {
      tools = {
        tools: { ...tools?.tools, webSearchTool },
      };
    }

    // Load MCP tools if enabled
    if (withMcpTools && withTools) {
      try {
        const hasMcp = await hasMcpServers();
        if (hasMcp) {
          const mcpTools = await getMcpMastraTools();
          if (Object.keys(mcpTools).length > 0) {
            tools = {
              tools: { ...tools?.tools, ...mcpTools },
            };
            console.log(`[AI] Loaded ${Object.keys(mcpTools).length} MCP tools`);
          }
        }
      } catch (error) {
        console.error('[AI] Failed to load MCP tools:', error);
        // Continue without MCP tools - don't break the agent
      }
    }

    const globalConfig = await AiModelFactory.globalConfig();
    const defaultInstructions =
      `Today is ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n` +
      'You are a versatile AI assistant who can:\n' +
      '1. Answer questions and explain concepts\n' +
      '2. Provide suggestions and analysis\n' +
      '3. Help with planning and organizing ideas\n' +
      '4. Assist with content creation and editing\n' +
      '5. Perform basic calculations and reasoning\n\n' +
      "6. When using 'web-search-tool' to return results, use the markdown link format to mark the origin of the page" +
      "7. When using 'search-blinko-tool', The entire content of the note should not be returned unless specifically specified by the user " +
      "Always respond in the user's language.\n" +
      'Maintain a friendly and professional conversational tone.';

    // CUSTOM-JOURNAL: was `a + b || c` -- string concat binds tighter than ||,
    // so the "Today is ..." prefix made the left side truthy unconditionally
    // and defaultInstructions could never actually be used, even with no
    // globalPrompt configured (globalConfig.globalPrompt undefined produced
    // the literal text "...undefined" as the chat agent's entire persona).
    const baseInstructions = globalConfig.globalPrompt
      ? `Today is ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n${globalConfig.globalPrompt}`
      : defaultInstructions;
    const instructions = extraInstructions ? `${baseInstructions}\n\n${extraInstructions}` : baseInstructions;

    const BlinkoAgent = new Agent({
      name: 'Blinko Chat Agent',
      instructions,
      model: chatModel,
      ...tools,
    });

    const mastra = new Mastra({
      agents: { BlinkoAgent },
      logger: process.env.NODE_ENV === 'development' ? new PinoLogger({
        name: 'Mastra',
        level: 'debug',
      }) : undefined
    });
    const mastraAgent = mastra.getAgent('BlinkoAgent');
    // CUSTOM-JOURNAL: see #createAgentFactory's matching comment -- lets
    // callers log the actual instructions this chat agent was built with.
    (mastraAgent as any).__systemPrompt = instructions;
    return mastraAgent;
  }

  static #createAgentFactory(
    name: string,
    systemPrompt: string | ((customPrompt?: string) => string),
    loggerName: string,
    options?: {
      tools?: Record<string, any>;
      isWritingAgent?: boolean;
      // CUSTOM-JOURNAL: 'postProcessing' routes this agent through
      // GetPostProcessingLLM() (postProcessingModelId, falling back to
      // mainModelId) instead of the main chat provider -- set on the
      // post-processing agents built through this factory (TagAgent,
      // CommentAgent; MoodAgent moved to a direct generateObject call using
      // GetPostProcessingLLM() itself, see AiService.scoreMood), so a user
      // can point post-processing at a different (e.g. cheaper/local) model
      // without affecting the interactive chat agent or the other
      // single-purpose agents built through this same factory.
      useModelId?: 'main' | 'postProcessing';
    },
  ) {
    return async (type?: 'expand' | 'polish' | 'custom' | string) => {
      const model = options?.useModelId === 'postProcessing'
        ? await AiModelFactory.GetPostProcessingLLM()
        : (await AiModelFactory.GetProvider())?.LLM!;
      const finalPrompt = typeof systemPrompt === 'function' ? systemPrompt(type!) : systemPrompt;

      const agent = new Agent({
        name: options?.isWritingAgent ? `${name} - ${type}` : name,
        instructions: finalPrompt,
        model,
        ...(options?.tools || {}),
      });

      const mastraAgent = new Mastra({
        agents: { agent },
        logger: process.env.NODE_ENV === 'development' ? new PinoLogger({
          name: 'Mastra',
          level: 'debug',
        }) : undefined,
      }).getAgent('agent');
      // CUSTOM-JOURNAL: stash the exact system prompt text this agent was
      // built with directly on the returned object, so call sites can log
      // the *actual* prompt sent to the model (see callers' use of
      // getAgentSystemPrompt below) instead of just the per-call user
      // input -- the AI Task Log used to only show the note content, never
      // the instructions that shaped how it was processed. Attached here
      // rather than read back from Mastra's Agent API, which doesn't
      // reliably expose a static instructions string (it can be a function
      // in general), whereas this factory always knows the resolved text.
      (mastraAgent as any).__systemPrompt = finalPrompt;
      return mastraAgent;
    };
  }

  // CUSTOM-JOURNAL: reads back the system prompt stashed by
  // #createAgentFactory above (or undefined for an agent not built through
  // it, e.g. BaseChatAgent -- see its own __systemPrompt assignment).
  static getAgentSystemPrompt(agent: unknown): string | undefined {
    return (agent as any)?.__systemPrompt;
  }

  static TagAgent = AiModelFactory.#createAgentFactory(
    'Blinko Tagging Agent',
    (customPrompt?: string) => {
      console.log(customPrompt, 'customPrompt');
      if (customPrompt) {
        return customPrompt;
      }
      // CUSTOM-JOURNAL: flat, single-word/hyphenated tags -- no slash
      // hierarchy, and no existing-tag list referenced (AiService.suggestTags
      // no longer passes one in -- tagging should be free and creative, not
      // anchored to whatever's already been used). This is the generic
      // fallback used only when no config.aiTagsPrompt is set (this journal
      // always seeds one via prisma/seed.ts's journalTagsPrompt, so in
      // practice this path is a safety net for a fresh DB, not what actually
      // runs) -- kept in sync with that seeded prompt's conventions regardless,
      // including the trailing "Answer briefly" (replaced an earlier
      // "/no_think" + Ollama think:false approach -- simple, direct phrasing
      // tested to work as well or better, without needing a model-specific
      // toggle or extra request-layer plumbing).
      return `You are a precise label classification expert, and you will generate precisely matched content labels based on the content. Rules:
      1. **Core Selection Principle**: Select 3 to 6 tags that are most relevant to the content -- people, places, feelings, or the specific topic/thing being discussed. Only tag what's actually present in the content; don't invent a tag for a category just to cover it.
      2. **Tag Format**: every tag is a single word or, if it needs more than one word, hyphenated (e.g. #javascript, #web-development). Never use slashes or any other category-prefix/hierarchy structure. A concrete noun or subject from the content is just as valid a tag as an emotion or person.
      3. **Response Format**: Only return tags separated by commas. There should be no spaces between tags, and no formatting or code blocks should be used. Each tag should start with #, such as #JavaScript. Example: #JavaScript,#web-development,#frontend

      Answer briefly`;
    },
    'BlinkoTag',
    { useModelId: 'postProcessing' },
  );

  static EmojiAgent = AiModelFactory.#createAgentFactory(
    'Blinko Emoji Agent',
    `You are an emoji recommendation expert. Rules:
     1. Analyze content theme and emotion
     2. Return 4-10 comma-separated emojis
     3. Use '💻,🔧' for tech content, '😊,🎉' for emotional content
     4. Must be separated by comma like '💻,🔧'`,
    'BlinkoEmoji',
  );

  // CUSTOM-JOURNAL: was a #createAgentFactory-produced Agent whose .generate()
  // returned free-text "label:score,..." pairs -- moved to a plain prompt
  // builder because AiService.scoreMood now calls generateObject directly
  // against the post-processing model with a per-call Zod schema (one
  // number field per active moodAxis), guaranteeing every axis gets scored
  // instead of silently dropping any axis the model omitted from free text.
  // This is still just the descriptive/calibration half of that prompt --
  // the schema itself enforces the response shape.
  //
  // Rewritten twice since: (1) from "score every dimension, every time" to
  // "only report the ones that actually apply" -- forcing a number onto
  // every axis on every entry was itself producing bad scores (e.g.
  // "anxiety" pinned to 100 on an entry that never mentions anxiety, because
  // the model had to put *something* there). (2) the per-axis instructions
  // in axesDescription already say whether a given axis is always-include
  // (bipolar) or only-if-present (unipolar) -- an earlier version of the
  // Rules section *also* re-explained that same bipolar/unipolar split in
  // the abstract, branching its wording on whether any bipolar axis
  // currently existed. That duplication was a real, observed problem: with
  // a stock install (zero bipolar axes after the valence-axis split, see
  // prisma/seed.ts's 2026-09-16-split-valence-axis migration), the model
  // got stuck re-litigating "could this axis actually be bipolar?" against
  // a distinction the Rules section raised but nothing in front of it
  // satisfied, burning its whole response budget without ever producing
  // JSON. Rules now just point back at each axis's own instructions instead
  // of re-describing the bipolar/unipolar split itself, so there's nothing
  // abstract left to get stuck on regardless of how many bipolar axes
  // exist. "Answer briefly" replaces an earlier "/no_think" + Ollama
  // think:false approach -- simpler, and tested to work as well or better.
  // (3) the response is now keyed by each dimension's name instead of its
  // id -- see AiService.scoreMood's comment for why (log readability, and
  // moods being user-editable over time) and tagAuditJob.ts's repair pass
  // for how already-scored notes get migrated off the old id-keyed format.
  static moodSystemPrompt(axesDescription: string): string {
    return `You are an emotional-tone analysis expert for a personal journal. Below is a list of mood dimensions, each with its own instructions for when and how to score it.

Mood dimensions:
${axesDescription}

Rules:
1. Follow each dimension's own instructions above to decide whether to include it -- most say to only include it if genuinely present in the entry.
2. When you do include a dimension, use the full range thoughtfully: a mild, passing feeling scores low (1-3), a clearly present but not overwhelming feeling scores mid-range (4-7), and only a genuinely intense, dominant feeling scores high (8-10). Don't default to 0 or 10 out of habit.
3. Base every score only on what the entry actually expresses or implies, never on assumptions beyond the text.
4. Respond with a JSON object keyed by each dimension's exact name (as given above), mapping to its score. Leave out any dimension its own instructions say to skip -- never include one at 0 just to show it's absent.

Sample output shape (the names and scores below are just illustrative -- use the real dimension names from the list above, and include only the ones that actually apply):
{
  "positive": 7,
  "negative": 3,
  "joy": 8,
  "excitement": 5,
  "anxiety": 2
}

Answer briefly`;
  }

  static RelatedNotesAgent = AiModelFactory.#createAgentFactory(
    'Blinko Related Notes Agent',
    `You are a keyword extraction expert. Your task is to extract the most representative keywords from the provided note content.

    Rules:
    1. Analyze note content to identify core themes, concepts, and key information
    2. Extract 5-8 keywords or phrases that accurately summarize the content
    3. Ensure the extracted keywords are specific and can be used to find related notes
    4. Sort the extracted keywords by importance from high to low
    5. Return a comma-separated list of keywords without any additional formatting or explanation
    6. Keywords should accurately express the content theme, not too broad or specific
    7. If the note content includes professional terms or technical content, please ensure that the keywords include these terms

    Example output:
    machine learning, neural network, deep learning, TensorFlow, image recognition`,
    'BlinkoRelatedNotes',
  );

  static CommentAgent = AiModelFactory.#createAgentFactory(
    'Blinko Comment Agent',
    `You are Blinko Comment Assistant. Guidelines:
     1. Use Markdown formatting
     2. Include 1-2 relevant emojis
     3. Maintain professional tone
     4. Keep responses concise (50-150 words)
     5. Match user's language`,
    'BlinkoComment',
    { useModelId: 'postProcessing' },
  );

  static SummarizeAgent = AiModelFactory.#createAgentFactory(
    'Blinko Summary Agent',
    `You are a conversation title summarizer. Rules:
      1. Summarize the content 
      2. Return the title only
      3. Generate titles based on the user's language
      4. Do not return any punctuation marks in the result
      5. Keep it short and concise`,
    'BlinkoSummary',
  );

  static WritingAgent = AiModelFactory.#createAgentFactory(
    'Blinko Writing Agent',
    (type) => {
      const prompts = {
        expand: `# Text Expansion Expert
          ## Original Content
          {content}

          ## Requirements
          1. Use same language as input
          2. Add details/examples without introducing new concepts
          3. Maintain original structure and style
          4. Use Markdown formatting
          5. Output format with markdown
          6. Do not add explanation`,

        polish: `# Text Refinement Specialist
          ## Input Text
          {content}

          ## Guidelines
          1. Optimize sentence flow and vocabulary
          2. Preserve core meaning
          3. Apply technical writing standards
          4. Use Markdown formatting
          5. Output format with markdown`,

        custom: `# Multi-Purpose Writing Assistant
            ## User Request
            {content}

            ## Requirements
            1. Create content as needed
            2. Follow industry-standard documentation
            3. Use Markdown formatting
            4. Output format with markdown`,
      };
      return prompts[type as 'expand' | 'polish' | 'custom'] || prompts['custom'];
    },
    'BlinkoWriting',
    { isWritingAgent: true },
  );

  static TestConnectAgent = AiModelFactory.#createAgentFactory('Blinko Test Connect Agent', `Test the api is working,return 1 words`, 'BlinkoTestConnect');

  static ImageEmbeddingAgent = AiModelFactory.#createAgentFactory(
    'Blinko Image Embedding Agent',
    `You are a vision assistant. When provided an image, you must:
1) Describe the image in detail (objects, scenes, layout, style, colors).
2) Extract and return all visible text in the image (OCR) accurately.
If the underlying model does not support image inputs, respond exactly with: not support image`,
    'BlinkoImageEmbedding',
  );

  static async readImage(
    imagePath: string,
    options?: { maxEdge?: number; quality?: number; toJPEG?: boolean; background?: string },
  ): Promise<{ dataUrl: string; mime: string }> {
    const { maxEdge = 1024, quality = 70, toJPEG = true, background = '#ffffff' } = options || {};
    try {
      let pipeline = sharp(imagePath).rotate();
      pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
      if (toJPEG) {
        // Remove alpha channel when converting to JPEG
        pipeline = pipeline.flatten({ background }).jpeg({ quality, mozjpeg: true });
      }
      const buffer = await pipeline.toBuffer();
      const mime = toJPEG ? 'image/jpeg' : path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, mime };
    } catch (err) {
      // Fallback to original file if compression fails
      const fallbackMime = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      return { dataUrl: `data:${fallbackMime};base64,${fs.readFileSync(imagePath, 'base64')}`, mime: fallbackMime };
    }
  }

  static async describeImage(imagePath: string): Promise<string> {
    try {
      const agent = await AiModelFactory.ImageEmbeddingAgent();
      console.log(imagePath, 'imagePath');
      const { dataUrl, mime } = await AiModelFactory.readImage(imagePath);
      const response = await agent.generate(
        [
          {
            role: 'user',
            content: [
              { type: 'image', image: dataUrl, mimeType: mime },
              {
                type: 'text',
                text: 'Describe the image in detail, and extract all the text in the image.',
              },
            ],
          },
        ],
        { temperature: 0.3 },
      );
      console.log(response.text?.trim(), 'response.text?.trim()');
      return response.text?.trim() || '';
    } catch (error) {
      console.log(error, 'error');
      // Fallback when model/provider does not support images or any error occurs
      return 'not support image';
    }
  }

  // static async GetAudioLoader(audioPath: string) {
  //   const globalConfig = await AiModelFactory.ValidConfig()
  //   if (globalConfig.aiModelProvider == 'OpenAI') {
  //     const provider = new OpenAIModelProvider({ globalConfig })
  //     return provider.AudioLoader(audioPath)
  //   } else {
  //     throw new Error('not support other loader')
  //   }
  // }
}
