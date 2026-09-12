import { PrismaClient } from '@prisma/client';

import { promises as fs } from 'fs';
import { randomBytes, pbkdf2 } from 'crypto';
import * as path from 'path';
import { FontSeed, systemDefaultFont, cdnFonts } from './defaultFonts';

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    pbkdf2(password, salt, 1000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve('pbkdf2:' + salt + ':' + derivedKey.toString('hex'));
    });
  });
}

export async function verifyPassword(inputPassword: string, hashedPassword: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [prefix, salt, hash] = hashedPassword.split(':');
    if (prefix !== 'pbkdf2') {
      return resolve(false);
    }
    pbkdf2(inputPassword, salt!, 1000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex') === hash);
    });
  });
}

const prisma = new PrismaClient();

async function main() {
  try {
    await fs.mkdir(".blinko")
  } catch (error) { }

  try {
    await Promise.all([fs.mkdir(".blinko/files"), fs.mkdir(".blinko/vector"), fs.mkdir(".blinko/pgdump")])
  } catch (error) { }

  //Compatible with users prior to v0.2.9
  const account = await prisma.accounts.findFirst({ orderBy: { id: 'asc' } })
  if (account) {
    if (!account.role) {
      await prisma.accounts.update({ where: { id: account.id }, data: { role: 'superadmin' } })
    }
    await prisma.notes.updateMany({ where: { accountId: null }, data: { accountId: account.id } })
  }
  // if (!account && process.env.NODE_ENV === 'development') {
  //   await prisma.accounts.create({ data: { name: 'admin', password: await hashPassword('123456'), role: 'superadmin' } })
  // }

  //database password hash
  const accounts = await prisma.accounts.findMany()
  for (const account of accounts) {
    const isHash = account.password.startsWith('pbkdf2:')
    if (!isHash) {
      await prisma.accounts.update({ where: { id: account.id }, data: { password: await hashPassword(account.password) } })
    }
  }

  const tagsWithoutAccount = await prisma.tag.findMany({ where: { accountId: null } })
  for (const account of accounts) {
    if (account.role == 'superadmin') {
      await prisma.tag.updateMany({ where: { id: { in: tagsWithoutAccount.map(tag => tag.id) } }, data: { accountId: account.id } })
      break
    }
  }
  try {
    // update attachments depth and perfixPath
    const attachmentsWithoutDepth = await prisma.attachments.findMany({
      where: {
        OR: [
          { depth: null },
          { perfixPath: null }
        ]
      }
    });

    if (attachmentsWithoutDepth.length > 0) {
      for (const attachment of attachmentsWithoutDepth) {
        const pathParts = attachment.path
          .replace('/api/file/', '')
          .replace('/api/s3file/', '')
          .split('/');

        await prisma.attachments.update({
          where: { id: attachment.id },
          data: {
            depth: pathParts.length - 1,
            perfixPath: pathParts.slice(0, -1).join(',')
          }
        });
      }
    }
  } catch (error) {
    console.log(error)
  }
  await seedDefaultFonts();
  await seedDefaultAiConfig();
  await seedDefaultMoodAxes();
}

/**
 * CUSTOM-JOURNAL: seed/self-heal the local AI configuration (chat +
 * auto-tagging + embeddings + vision + voice transcription) so this fork's
 * AI features come up configured without manual DB surgery, and so
 * incremental infra rollout (Ollama today, Whisper "later") self-completes
 * on a later restart instead of needing a one-off fix each time.
 *
 * Unlike the old all-or-nothing version, every piece below is checked and
 * created/repaired independently — this runs on every boot (the dockerfile
 * runs `node server/seed.js` every start) and is safe to run repeatedly:
 * anything already correctly configured is left alone, anything missing or
 * still holding the placeholder value gets created/fixed.
 *
 * Env vars:
 * - OLLAMA_BASE_URL (required to actually work) — e.g. http://192.168.1.208:11434.
 *   If the existing provider row still has the placeholder host and this is
 *   now set, it gets corrected in place.
 * - OLLAMA_CHAT_MODEL / OLLAMA_EMBEDDING_MODEL / OLLAMA_VISION_MODEL —
 *   default 'llama3.1' / 'nomic-embed-text' / 'llava'. Must actually be
 *   pulled on the target Ollama instance (`ollama pull <model>`).
 * - WHISPER_BASE_URL (optional) — e.g. http://192.168.1.208:8000/v1. Only
 *   when this is set does the Whisper provider/model get created and
 *   voiceModelId get wired up — safe to leave unset until that service is
 *   actually deployed, and setting it later + restarting is enough to
 *   finish the setup then, no code changes needed.
 */
async function seedDefaultAiConfig() {
  const PLACEHOLDER_HOST = 'REPLACE_WITH_OLLAMA_HOST';

  const setConfigIfMissing = async (key: string, value: any) => {
    const existing = await prisma.config.findFirst({ where: { key, userId: null } });
    if (existing) return;
    await prisma.config.create({ data: { key, config: { type: typeof value, value } } });
    console.log(`   config.${key} = ${JSON.stringify(value)}`);
  };

  // --- Ollama provider (chat + embeddings + vision) ---
  let ollamaProvider = await prisma.aiProviders.findFirst({ where: { provider: 'ollama' } });
  const ollamaBaseURL = process.env.OLLAMA_BASE_URL;

  if (!ollamaProvider) {
    const baseURL = ollamaBaseURL || `http://${PLACEHOLDER_HOST}:11434`;
    if (!ollamaBaseURL) {
      console.warn(`⚠ OLLAMA_BASE_URL not set — seeding Ollama provider with placeholder "${baseURL}" (won't work until corrected).`);
    }
    console.log('🤖 Seeding Ollama AI provider...');
    ollamaProvider = await prisma.aiProviders.create({
      data: { title: 'Ollama (local, journal default)', provider: 'ollama', baseURL, apiKey: null, sortOrder: 0 },
    });
  } else if (ollamaBaseURL && ollamaProvider.baseURL?.includes(PLACEHOLDER_HOST)) {
    console.log(`🔧 Correcting Ollama provider baseURL: ${ollamaProvider.baseURL} -> ${ollamaBaseURL}`);
    ollamaProvider = await prisma.aiProviders.update({ where: { id: ollamaProvider.id }, data: { baseURL: ollamaBaseURL } });
  }

  const chatModelKey = process.env.OLLAMA_CHAT_MODEL || 'llama3.1';
  let chatModel = await prisma.aiModels.findFirst({ where: { providerId: ollamaProvider.id, modelKey: chatModelKey } });
  if (!chatModel) {
    chatModel = await prisma.aiModels.create({
      data: {
        providerId: ollamaProvider.id, title: `Ollama Chat (${chatModelKey})`, modelKey: chatModelKey, sortOrder: 0,
        capabilities: { inference: true, tools: true, image: false, imageGeneration: false, video: false, audio: false, embedding: false, rerank: false },
      },
    });
  }
  await setConfigIfMissing('mainModelId', chatModel.id);

  const embeddingModelKey = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
  let embeddingModel = await prisma.aiModels.findFirst({ where: { providerId: ollamaProvider.id, modelKey: embeddingModelKey } });
  if (!embeddingModel) {
    // NOTE: Ollama's embedding baseURL is used as-is by Blinko's embedding provider
    // (unlike the chat/LLM provider, which auto-appends /api). If embeddings 404,
    // try OLLAMA_BASE_URL with an /api suffix instead.
    embeddingModel = await prisma.aiModels.create({
      data: {
        providerId: ollamaProvider.id, title: `Ollama Embeddings (${embeddingModelKey})`, modelKey: embeddingModelKey, sortOrder: 1,
        capabilities: { inference: false, tools: false, image: false, imageGeneration: false, video: false, audio: false, embedding: true, rerank: false },
      },
    });
  }
  await setConfigIfMissing('embeddingModelId', embeddingModel.id);

  // Vision model — describes/tags photo attachments (imageModelId).
  const visionModelKey = process.env.OLLAMA_VISION_MODEL || 'llava';
  let visionModel = await prisma.aiModels.findFirst({ where: { providerId: ollamaProvider.id, modelKey: visionModelKey } });
  if (!visionModel) {
    visionModel = await prisma.aiModels.create({
      data: {
        providerId: ollamaProvider.id, title: `Ollama Vision (${visionModelKey})`, modelKey: visionModelKey, sortOrder: 2,
        capabilities: { inference: true, tools: false, image: true, imageGeneration: false, video: false, audio: false, embedding: false, rerank: false },
      },
    });
  }
  await setConfigIfMissing('imageModelId', visionModel.id);

  // CUSTOM-JOURNAL: optional, separate model for AI Post-Processing (tag
  // suggestion, mood scoring, comment/smartEdit/custom, tagAuditJob
  // backfill) -- see aiModelFactory.ts's GetPostProcessingLLM. Only set up
  // if given and different from the chat model; otherwise postProcessingModelId
  // stays unset, which already falls back to mainModelId on its own, so
  // there'd be nothing to gain from a redundant duplicate model row.
  const postProcessingModelKey = process.env.OLLAMA_POST_PROCESSING_MODEL;
  if (postProcessingModelKey && postProcessingModelKey !== chatModelKey) {
    let postProcessingModel = await prisma.aiModels.findFirst({ where: { providerId: ollamaProvider.id, modelKey: postProcessingModelKey } });
    if (!postProcessingModel) {
      postProcessingModel = await prisma.aiModels.create({
        data: {
          providerId: ollamaProvider.id, title: `Ollama Post-Processing (${postProcessingModelKey})`, modelKey: postProcessingModelKey, sortOrder: 3,
          capabilities: { inference: true, tools: true, image: false, imageGeneration: false, video: false, audio: false, embedding: false, rerank: false },
        },
      });
    }
    await setConfigIfMissing('postProcessingModelId', postProcessingModel.id);
  }

  // --- Whisper provider (voice transcription) — only if actually deployed ---
  const whisperBaseURL = process.env.WHISPER_BASE_URL;
  if (whisperBaseURL) {
    let whisperProvider = await prisma.aiProviders.findFirst({ where: { title: 'Whisper (local, journal default)' } });
    if (!whisperProvider) {
      console.log('🎙️ Seeding Whisper AI provider...');
      whisperProvider = await prisma.aiProviders.create({
        // OpenAI-compatible custom provider — speaches/faster-whisper-server expose
        // an OpenAI-shaped /v1/audio/transcriptions endpoint (see infra/whisper-service).
        data: { title: 'Whisper (local, journal default)', provider: 'openai', baseURL: whisperBaseURL, apiKey: null, sortOrder: 1 },
      });
    } else if (whisperProvider.baseURL !== whisperBaseURL) {
      whisperProvider = await prisma.aiProviders.update({ where: { id: whisperProvider.id }, data: { baseURL: whisperBaseURL } });
    }

    const whisperModelKey = process.env.WHISPER_MODEL || 'Systran/faster-whisper-medium';
    let voiceModel = await prisma.aiModels.findFirst({ where: { providerId: whisperProvider.id, modelKey: whisperModelKey } });
    if (!voiceModel) {
      voiceModel = await prisma.aiModels.create({
        data: {
          providerId: whisperProvider.id, title: `Whisper (${whisperModelKey})`, modelKey: whisperModelKey, sortOrder: 0,
          capabilities: { inference: false, tools: false, image: false, imageGeneration: false, video: false, audio: true, embedding: false, rerank: false },
        },
      });
    }
    await setConfigIfMissing('voiceModelId', voiceModel.id);
  } else {
    console.log('ℹ WHISPER_BASE_URL not set — skipping voice transcription setup (voiceModelId left unconfigured). Set it and restart once the Whisper service is deployed.');
  }

  // CUSTOM-JOURNAL: freeform, flat tags -- no category prefixes or slash
  // hierarchy (was #people/mom, #places/home, #theme/work, etc.). Dropped
  // per explicit request: single-word or hyphenated tags only, no slashes,
  // for cleaner organization. setConfigIfMissing only writes when unset, so
  // updating this constant won't retroactively change an already-seeded
  // prompt on a live server -- clear the 'aiTagsPrompt' config row (or edit
  // it directly in AI Settings -> Post-Processing) to pick this up there.
  const journalTagsPrompt = `You are tagging entries in a personal voice journal. Read the entry and suggest 3 to 6 tags that capture whatever's most relevant -- people mentioned, places, feelings, the occasion, or the topic/theme. Rules:
1. **Tag format**: every tag is a single word or, if it needs more than one word, hyphenated (e.g. #mom, #home, #work-stress, #road-trip, #grateful). Never use slashes or any other category-prefix structure.
2. **Reuse first**: prefer an existing tag from the provided tag list over inventing a new one, if it genuinely fits.
3. **New tags**: if nothing existing fits, invent a new single-word or hyphenated tag.
4. **Avoid generic note-taking tags**: do NOT use tags like #todo, #idea, #project, #meeting unless the entry is genuinely about work — this is a personal journal, not a notes app.
5. **Language**: match the language of the entry.
6. **Response format**: return only the tags, comma-separated, each starting with #, no spaces between tags, no explanation, no code blocks or Markdown. Example: #mom,#home,#grateful,#roadtrip`;

  await setConfigIfMissing('isUseAiPostProcessing', true);
  await setConfigIfMissing('aiPostProcessingMode', 'tags');
  await setConfigIfMissing('aiTagsPrompt', journalTagsPrompt);

  // CUSTOM-JOURNAL: default to creation-time ordering/display -- a journal
  // entry's date should read as "when I wrote this," not "when it was last
  // touched" (which now includes AI tag/mood passes, even though those are
  // deliberately updatedAt-preserving -- a genuine user edit still bumps it,
  // and sorting/display by that is confusing for a chronological journal).
  // Both are still user-editable in Settings -> Preferences.
  await setConfigIfMissing('isOrderByCreateTime', true);
  await setConfigIfMissing('timeFormat', 'dddd, MMM D, YYYY [at] h:mmA');

  // CUSTOM-JOURNAL: starter prompts shown (3 at random) on the AI tab --
  // previously a hardcoded array of i18n keys in app/src/pages/ai.tsx, moved
  // to a plain newline-separated config value so the user can add/edit/
  // remove hints from AI Settings -> AI Hint Prompts without a redeploy.
  const defaultHintPrompts = [
    "Summarize what I've written about over the past week and highlight anything notable.",
    'I want to search my past entries — ask me what topic, person, or place to look for.',
    'Look across my recent entries and tell me about any patterns or trends you notice — in mood, topics, people, or habits.',
    'How have I been feeling lately, based on my recent entries?',
    'Find every entry that mentions a specific person and summarize what I wrote about them — ask me who.',
    'Find my oldest archived entries, summarize them, and save the summary as a new entry.',
    'What happened when I was in Europe?',
    'When was the last time I laughed so hard I cried?',
    "What's a place I've written about that I seem to really love?",
    'Tell me about a recent moment that really stuck with me.',
    "What's something surprising or funny that happened recently, based on my entries?",
    "Pull up an old entry I've probably forgotten about and remind me what I wrote.",
  ].join('\n');
  await setConfigIfMissing('aiHintPrompts', defaultHintPrompts);

  console.log('✅ AI config seed/self-heal pass complete.');
}

// CUSTOM-JOURNAL: seeds the default mood axes (emotional valence + 8 basic
// emotions) AI-scores every note against, once, if the account has none yet.
// Non-destructive and idempotent like seedDefaultAiConfig above -- safe to
// re-run on every boot. The user can add/rename/delete axes afterward from
// AI Settings, this is just a sensible starting set.
async function seedDefaultMoodAxes() {
  const existingCount = await prisma.moodAxis.count();
  if (existingCount > 0) return;

  console.log('🎭 Seeding default mood axes...');
  const defaultAxes: { positiveLabel: string; negativeLabel: string | null }[] = [
    { positiveLabel: 'positive', negativeLabel: 'negative' }, // emotional valence
    { positiveLabel: 'anger', negativeLabel: null },
    { positiveLabel: 'anxiety', negativeLabel: null },
    { positiveLabel: 'joy', negativeLabel: null },
    { positiveLabel: 'sadness', negativeLabel: null },
    { positiveLabel: 'surprise', negativeLabel: null },
    { positiveLabel: 'fear', negativeLabel: null },
    { positiveLabel: 'excitement', negativeLabel: null },
    { positiveLabel: 'gratitude', negativeLabel: null },
  ];

  for (let i = 0; i < defaultAxes.length; i++) {
    await prisma.moodAxis.create({ data: { ...defaultAxes[i], sortOrder: i } });
  }
  console.log(`   ✅ Seeded ${defaultAxes.length} mood axes.`);
}

export async function seedDefaultFonts() {
  const fontsDir = path.resolve(__dirname, "../app/public/fonts");

  const localFonts = await scanLocalFonts(fontsDir);

  const allFonts: FontSeed[] = [systemDefaultFont, ...cdnFonts, ...localFonts];

  console.log("🔤 Seeding fonts...");
  console.log(`   🌐 CDN fonts: ${cdnFonts.length}`);
  console.log(`   📁 Local fonts: ${localFonts.length}`);

  for (const font of allFonts) {
    const fontData = {
      ...font,
      fileData: font.fileData ? Buffer.from(font.fileData) : null,
    };
    await prisma.fonts.upsert({
      where: { name: font.name },
      update: fontData,
      create: fontData,
    });
  }
}
/**
 * Scan the fonts directory and discover all local font families
 * Expects structure: fonts/{FontName}/{FontName}-*.woff2
 */
async function scanLocalFonts(fontsDir: string): Promise<FontSeed[]> {
  try {
    await fs.access(fontsDir);
  } catch {
    console.log(`ℹ Fonts directory not found: ${fontsDir}`);
    return [];
  }

  const entries = await fs.readdir(fontsDir, { withFileTypes: true });

  const tasks = entries
    .filter(e => e.isDirectory())
    .map((entry, index) => processFontFamily(fontsDir, entry.name, index + 1));

  return (await Promise.all(tasks)).filter(
    (f): f is FontSeed => f !== null
  );
}



async function processFontFamily(
  fontsDir: string,
  fontName: string,
  sortOrder: number
): Promise<FontSeed | null> {
  try {
    const fontDir = path.join(fontsDir, fontName);
    const files = await fs.readdir(fontDir);

    const fontFiles = files.filter(f => f.endsWith(".woff") || f.endsWith(".woff2"));
    if (!fontFiles.length) return null;

    const mainFontFile = pickMainFont(fontFiles);
    if (!mainFontFile) return null;

    const filePath = path.join(fontDir, mainFontFile);
    const buffer = await fs.readFile(filePath);

    return {
      name: fontName,
      displayName: `${fontName} (Ext)`,
      url: null,
      fileData: new Uint8Array(buffer),
      isLocal: true,
      weights: isVariableFont(mainFontFile)
        ? [100, 200, 300, 400, 500, 600, 700, 800, 900]
        : [400, 500, 600, 700],
      category: detectFontCategory(fontName),
      isSystem: false,
      sortOrder,
    };
  } catch (err) {
    console.warn(`⚠ Failed to load font: ${fontName}`);
    return null;
  }
}
function pickMainFont(files: string[]): string | null {
  return (
    files.find(f => /variablefont/i.test(f) && !/italic/i.test(f) && f.endsWith(".woff2")) ||
    files.find(f => !/italic/i.test(f) && f.endsWith(".woff2")) ||
    files.find(f => f.endsWith(".woff2")) ||
    files[0] ||
    null
  );
}

function isVariableFont(fileName: string): boolean {
  return /variablefont/i.test(fileName);
}

/**
 * Detect font category based on font name
 */
function detectFontCategory(fontName: string): string {
  const name = fontName.toLowerCase();

  if (
    name.includes("mono") ||
    name.includes("code") ||
    name.includes("consola") ||
    name.includes("courier") ||
    name.includes("fira") ||
    name.includes("jetbrains")
  ) return "monospace";

  if (
    name.includes("serif") ||
    name.includes("times") ||
    name.includes("georgia") ||
    name.includes("merriweather") ||
    name.includes("playfair") ||
    name.includes("baskerville")
  ) return "serif";

  if (
    name.includes("display") ||
    name.includes("black") ||
    name.includes("ultra")
  ) return "display";

  if (
    name.includes("script") ||
    name.includes("cursive") ||
    name.includes("hand") ||
    name.includes("pacifico") ||
    name.includes("dancing")
  ) return "handwriting";

  return "sans-serif";
}

main()
  .then(e => {
    console.log("✨ Seed done! ✨")
  })
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });