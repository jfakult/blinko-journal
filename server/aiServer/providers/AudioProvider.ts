import { BufferLoader } from 'langchain/document_loaders/fs/buffer';
import { BaseProvider } from './BaseProvider';
import { OpenAIVoice } from '@mastra/voice-openai';
import { MastraVoice } from '@mastra/core/voice';
import OpenAI from 'openai';

interface AudioConfig {
  provider: string;
  apiKey?: any;
  baseURL?: any;
  modelKey: string;
  apiVersion?: string;
  speaker?: string;
  speed?: number;
}

export class AudioProvider extends BaseProvider {
  async getAudioModel(config: AudioConfig): Promise<MastraVoice | null> {
    await this.initializeFetch();

    switch (config.provider.toLowerCase()) {
      // CUSTOM-JOURNAL: 'openai' and 'custom'/default used to diverge in two
      // ways that broke self-hosted Whisper (seeded with provider: 'openai',
      // apiKey: null, baseURL: WHISPER_BASE_URL -- see prisma/seed.ts):
      // (1) both branches required a truthy apiKey before constructing
      // anything, returning null (silently) otherwise -- but a self-hosted
      // OpenAI-compatible endpoint typically needs no real key; (2) only the
      // 'custom' branch ever wired config.baseURL into the client at all, so
      // even with a key, 'openai' would always talk to api.openai.com
      // instead of the configured self-hosted URL. Net effect: getAudioModel
      // returned null for Whisper, so AiService.transcribeAudio's
      // `audioModel?.listen(...)` silently short-circuited to undefined
      // (no throw) and returned '' -- a transcription "succeeded" with an
      // empty transcript, appending just the "## Audio Transcription"
      // heading with no text under it. Matches LLMProvider.ts's 'openai'
      // case, which already correctly applies `baseURL: config.baseURL ||
      // undefined` regardless of apiKey.
      case 'openai':
      case 'custom':
      default: {
        const openAIVoice = new OpenAIVoice({
          speechModel: {
            apiKey: config.apiKey || 'not-needed',
          },
          listeningModel: {
            name: config.modelKey as any || "whisper-1",
            apiKey: config.apiKey || 'not-needed',
          },
        });
        openAIVoice.listeningClient = new OpenAI({
          apiKey: config.apiKey || 'not-needed',
          baseURL: config.baseURL || undefined,
          fetch: this.proxiedFetch,
        });
        return openAIVoice as unknown as MastraVoice
      }
      case 'azureopenai':
        return null;
      case 'azure':
        // TODO: Implement Azure OpenAI audio support
        return null;
    }
  }
}