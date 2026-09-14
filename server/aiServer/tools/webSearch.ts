import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v3';
import { tavily } from '@tavily/core';
import { getGlobalConfig } from '@server/routerTrpc/config';

// CUSTOM-JOURNAL: self-hosted SearXNG is the default web search backend for
// this fork (no external API key, no cost, no third-party query logging) --
// Tavily is kept as a fallback for anyone who'd rather use it. searxngUrl may
// be a bare base URL ("http://searxng:8080") or a template containing
// "<query>" (matches the SEARXNG_QUERY_URL convention used elsewhere in this
// user's infra). Requires SearXNG's `json` output format to be enabled in
// settings.yml (disabled by default upstream).
async function searchWithSearxng(searxngUrl: string, query: string, maxResults: number) {
  const url = searxngUrl.includes('<query>')
    ? searxngUrl.replace('<query>', encodeURIComponent(query))
    : `${searxngUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}`;
  const separator = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${separator}format=json`);
  if (!res.ok) {
    throw new Error(`SearXNG search failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return {
    results: (data.results ?? []).slice(0, maxResults).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    })),
  };
}

export const webSearchTool = createTool({
  id: 'web-search-tool',
  description: 'you are a web search assistant,you can use api to search web,return the result',
  //@ts-ignore
  inputSchema: z.object({
    query: z.string().describe('the query to search'),
  }) as any,
  execute: async ({ context }) => {
    try {
      const config = await getGlobalConfig({ useAdmin: true })
      const maxResults = config?.tavilyMaxResult ?? 5;
      if (config.searxngUrl) {
        return await searchWithSearxng(config.searxngUrl, context.query, maxResults);
      }
      if (!config.tavilyApiKey) {
        return 'No web search backend configured. Set "searxngUrl" (self-hosted SearXNG) or "tavilyApiKey" in AI settings.'
      }
      const client = tavily({ apiKey: config.tavilyApiKey });
      const result = await client.search(context.query, {
        max_results: maxResults
      })
      return result
    } catch (e) {
      return e.message
    }
  }
});
