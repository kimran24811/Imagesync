import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

// Model choices live in the environment, never in a committed API key.
// See https://ai.google.dev/gemini-api/docs/models for active model IDs.
export const getGeminiVisionModel = (): string =>
  process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-3.5-flash-lite';

export const getGeminiBlueprintModel = (): string =>
  process.env.GEMINI_BLUEPRINT_MODEL?.trim() || 'gemini-3.8-flash';

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.length > 10);
}

export function getGeminiClient(): GoogleGenAI | null {
  if (!isGeminiConfigured()) {
    return null;
  }
  const key = process.env.GEMINI_API_KEY!.trim();
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKey = key;
  }
  return cachedClient;
}
