import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

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
