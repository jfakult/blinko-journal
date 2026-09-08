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
}

/**
 * CUSTOM-JOURNAL: seed a default local-Ollama AI configuration (chat +
 * auto-tagging + embeddings) so a fresh deploy of this fork doesn't start
 * with AI features completely unconfigured.
 *
 * Safety: this ONLY runs when the `aiProviders` table is empty. Once an
 * admin has configured any provider (via this seed or by hand in
 * Settings > AI), this function is a no-op on every subsequent container
 * start (the dockerfile runs `node server/seed.js` on every boot).
 *
 * IMPORTANT — placeholder values that MUST be reviewed after deploy:
 * - OLLAMA_BASE_URL: this repo has no visibility into the Unraid host's
 *   actual Ollama address. Defaults to an intentionally-invalid
 *   placeholder so it fails loudly instead of silently pointing at
 *   nothing. Set the OLLAMA_BASE_URL env var (e.g. `http://ollama:11434`
 *   if Blinko and Ollama share a Docker network, or
 *   `http://<unraid-lan-ip>:11434` otherwise) in docker-compose before
 *   first boot, or edit the value later in Settings > AI > Providers.
 * - OLLAMA_CHAT_MODEL / OLLAMA_EMBEDDING_MODEL: default to commonly-used
 *   Ollama model tags ('llama3.1' / 'nomic-embed-text'). These must
 *   actually be pulled on the target Ollama instance
 *   (`ollama pull llama3.1`, `ollama pull nomic-embed-text`) or requests
 *   will fail. Override via env vars if different models are preferred.
 */
async function seedDefaultAiConfig() {
  const existingProviderCount = await prisma.aiProviders.count();
  if (existingProviderCount > 0) {
    console.log('ℹ AI providers already configured, skipping default AI config seed.');
    return;
  }

  const ollamaBaseURL = process.env.OLLAMA_BASE_URL || 'http://REPLACE_WITH_OLLAMA_HOST:11434';
  const chatModelKey = process.env.OLLAMA_CHAT_MODEL || 'llama3.1';
  const embeddingModelKey = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

  if (!process.env.OLLAMA_BASE_URL) {
    console.warn(
      '⚠ OLLAMA_BASE_URL is not set. Seeding AI provider with placeholder ' +
      `baseURL "${ollamaBaseURL}" — chat, auto-tagging, and embeddings will ` +
      'NOT work until this is corrected in Settings > AI > Providers, or ' +
      'OLLAMA_BASE_URL is set before the container first starts.'
    );
  }

  console.log('🤖 Seeding default Ollama AI provider + models...');

  const provider = await prisma.aiProviders.create({
    data: {
      title: 'Ollama (local, journal default)',
      provider: 'ollama',
      baseURL: ollamaBaseURL,
      apiKey: null,
      sortOrder: 0,
    },
  });

  const chatModel = await prisma.aiModels.create({
    data: {
      providerId: provider.id,
      title: `Ollama Chat (${chatModelKey})`,
      modelKey: chatModelKey,
      capabilities: {
        inference: true,
        tools: true,
        image: false,
        imageGeneration: false,
        video: false,
        audio: false,
        embedding: false,
        rerank: false,
      },
      sortOrder: 0,
    },
  });

  // NOTE: Ollama's embedding baseURL is used as-is by Blinko's embedding
  // provider (unlike the chat/LLM provider, which auto-appends `/api`).
  // If embeddings fail with a 404, try setting OLLAMA_BASE_URL to include
  // the `/api` suffix (e.g. `http://ollama:11434/api`) — verify against
  // the actual `ollama-ai-provider` version in use once deployed.
  const embeddingModel = await prisma.aiModels.create({
    data: {
      providerId: provider.id,
      title: `Ollama Embeddings (${embeddingModelKey})`,
      modelKey: embeddingModelKey,
      capabilities: {
        inference: false,
        tools: false,
        image: false,
        imageGeneration: false,
        video: false,
        audio: false,
        embedding: true,
        rerank: false,
      },
      sortOrder: 1,
    },
  });

  const journalTagsPrompt = `You are tagging entries in a personal voice journal. Read the entry and suggest 3 to 6 tags that capture who, where, how the writer felt, and what kind of occasion this was. Rules:
1. **Categories to draw from**: people mentioned (by name or relationship, e.g. #people/mom, #people/sarah), places (e.g. #places/home, #places/lake-house), mood or emotional tone (e.g. #mood/grateful, #mood/anxious, #mood/excited, #mood/tired), and occasion or event type (e.g. #occasion/birthday, #occasion/milestone, #occasion/everyday, #occasion/trip).
2. **Reuse first**: prefer an existing tag from the provided tag list over inventing a new one, if it genuinely fits.
3. **New tags**: if nothing existing fits, create a new tag under one of the four categories above using the #category/value pattern.
4. **Avoid generic note-taking tags**: do NOT use tags like #todo, #idea, #project, #meeting, #work, #reference unless the entry is genuinely about work — this is a personal journal, not a notes app.
5. **Language**: match the language of the entry.
6. **Response format**: return only the tags, comma-separated, each starting with #, no spaces between tags, no explanation, no code blocks or Markdown. Example: #people/mom,#places/home,#mood/grateful,#occasion/everyday`;

  const globalConfigDefaults: Record<string, any> = {
    mainModelId: chatModel.id,
    embeddingModelId: embeddingModel.id,
    isUseAiPostProcessing: true,
    aiPostProcessingMode: 'tags',
    aiTagsPrompt: journalTagsPrompt,
  };

  for (const [key, value] of Object.entries(globalConfigDefaults)) {
    await prisma.config.create({
      data: { key, config: { type: typeof value, value } },
    });
  }

  console.log('✅ Default Ollama AI config seeded (chat + auto-tagging + embeddings).');
  console.log(`   Provider baseURL: ${ollamaBaseURL} (verify this is correct!)`);
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