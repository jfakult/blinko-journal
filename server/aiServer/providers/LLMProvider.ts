import { LanguageModelV1, ProviderV1 } from '@ai-sdk/provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createXai } from '@ai-sdk/xai';
import { createAzure } from '@ai-sdk/azure';
import { BaseProvider } from './BaseProvider';

interface LLMConfig {
  provider: string;
  apiKey?: any;
  baseURL?: any;
  modelKey: string;
  apiVersion?: any;
}

// CUSTOM-JOURNAL: forces Ollama's `"think": false` request-body flag onto
// every /api/chat and /api/generate call. Hybrid-reasoning models (Qwen3/
// Qwen3.5, etc.) default to an internal "thinking" pass before answering --
// for this app's fast, frequent, small background calls (tag suggestion,
// mood scoring) that's pure latency with no benefit, and was directly
// responsible for multi-minute-long post-processing calls. A prompt-level
// request to skip thinking (e.g. appending "/no_think", Qwen3's own
// documented toggle) helps but is still just a polite ask the model can
// ignore -- `think: false` is a protocol-level flag Ollama added
// specifically for this, enforced by Ollama itself regardless of what the
// model does with the prompt text, so it's the actually-reliable fix.
// ollama-ai-provider (the npm package used below) doesn't expose this as a
// typed option as of the pinned version, so this injects it directly into
// the outgoing request body at the fetch layer instead of depending on
// provider-package support for a specific Ollama server feature.
const withOllamaThinkingDisabled = (baseFetch: typeof fetch): typeof fetch => {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const isChatOrGenerate = /\/api\/(chat|generate)(\?|$)/.test(url);
    if (!isChatOrGenerate || !init?.body || typeof init.body !== 'string') {
      return baseFetch(input, init);
    }
    try {
      const body = JSON.parse(init.body);
      body.think = false;
      return baseFetch(input, { ...init, body: JSON.stringify(body) });
    } catch {
      // Not JSON (or unexpected shape) -- pass through untouched rather
      // than risk sending a malformed request.
      return baseFetch(input, init);
    }
  }) as typeof fetch;
};

export class LLMProvider extends BaseProvider {
  async getLanguageModel(config: LLMConfig): Promise<LanguageModelV1> {
    await this.ensureInitialized();
    switch (config.provider.toLowerCase()) {
      case 'openai':
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'anthropic':
        return createAnthropic({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'gemini':
      case 'google':
        return createGoogleGenerativeAI({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'ollama':
        return createOllama({
          baseURL: config.baseURL?.trim().replace(/\/api$/, '') + '/api' || undefined,
          fetch: withOllamaThinkingDisabled(this.proxiedFetch || fetch)
        }).languageModel(config.modelKey);

      case 'deepseek':
        return createDeepSeek({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'openrouter':
        return createOpenRouter({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'grok':
      case 'xai':
        return createXai({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'azureopenai':
      case 'azure':
        return createAzure({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          apiVersion: config.apiVersion || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'minimax':
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://api.minimax.io/v1',
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'litellm':
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'http://localhost:4000/v1',
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'custom':
      default:
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);
    }
  }
}