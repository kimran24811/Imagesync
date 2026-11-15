import { Type } from '@google/genai';
import { getGeminiClient, getGeminiVisionModel } from './geminiClient.ts';
import type { CaptionCandidate, SemanticMatch } from '../../src/utils/semanticMatching.ts';

/** Select from verified visual descriptions; names are never part of the prompt. */
export async function matchNarrative(
  beats: string[],
  assets: CaptionCandidate[],
  provider: 'gemini-vision' | 'ollama-vision'
): Promise<SemanticMatch[]> {
  const prompt = JSON.stringify({
    instruction:
      'Assign the best visual to each spoken beat in story order. Use only supplied image IDs. Match subjects AND actions, setting and chronology. Prefer a genuinely relevant repeated image to an irrelevant new one. Each beat index must appear exactly once. Score confidence from 0 to 1; low scores are allowed. Do not infer events not visible in the descriptions. Return {matches:[{index,imageId,score,reason}]} with concise reasons.',
    beats: beats.map((text, index) => ({ index, text })),
    assets,
  });
  let raw: string;
  if (provider === 'gemini-vision') {
    const client = getGeminiClient();
    if (!client) throw new Error('Gemini is unavailable.');
    const response = await client.models.generateContent({
      model: getGeminiVisionModel(),
      contents: prompt,
      config: {
        httpOptions: { timeout: 90000 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  imageId: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                },
                required: ['index', 'imageId', 'score', 'reason'],
              },
            },
          },
          required: ['matches'],
        },
      },
    });
    raw = response.text || '{}';
  } else {
    const response = await fetch(
      `${(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(150000),
        body: JSON.stringify({
          model: process.env.OLLAMA_VISION_MODEL || 'gemma3:4b',
          stream: false,
          format: 'json',
          options: { temperature: 0, num_predict: 8192 },
          messages: [{ role: 'user', content: prompt }],
        }),
      }
    );
    if (!response.ok) throw new Error(`Narrative model returned ${response.status}`);
    raw = ((await response.json()) as { message?: { content?: string } }).message?.content || '{}';
  }
  const parsed = JSON.parse(raw) as {
    matches?: Array<{ index: number; imageId: string; score: number; reason: string }>;
  };
  if (!Array.isArray(parsed.matches) || parsed.matches.length !== beats.length)
    throw new Error('Incomplete narrative matching plan.');
  const ids = new Set(assets.map((a) => a.id)),
    indices = new Set<number>();
  const ordered = parsed.matches.slice().sort((a, b) => a.index - b.index);
  return ordered.map((m, i) => {
    if (
      m.index !== i ||
      indices.has(m.index) ||
      !ids.has(m.imageId) ||
      !Number.isFinite(m.score) ||
      m.score < 0 ||
      m.score > 1 ||
      typeof m.reason !== 'string'
    )
      throw new Error('Invalid narrative image assignment.');
    indices.add(m.index);
    return {
      id: m.imageId,
      score: m.score,
      confidence: m.score >= 0.75 ? 'high' : m.score >= 0.4 ? 'medium' : 'low',
      explanation: `Narrative match: ${m.reason.slice(0, 220)}`,
    };
  });
}
