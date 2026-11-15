import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@google/genai';
import { getGeminiClient } from './geminiClient.ts';
import type { VisionMedia } from './ollamaVision.ts';

export async function captionAllMediaWithGemini(
  media: readonly VisionMedia[],
  cacheDir: string,
  onProgress?: (completed: number, total: number) => void
): Promise<Record<string, string>> {
  const client = getGeminiClient();
  if (!client) throw new Error('Gemini API key is not configured.');
  const model = process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-3.5-flash-lite';
  await fs.mkdir(cacheDir, { recursive: true });

  const output: Record<string, string> = {};
  const pending: Array<{ frame: VisionMedia; cachePath: string }> = [];
  for (const frame of media) {
    const thumb = await fs.readFile(frame.thumbPath);
    const hash = createHash('sha256').update(model).update(thumb).digest('hex');
    const cachePath = path.join(cacheDir, hash + '.json');
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8')) as { caption?: string };
      if (!cached.caption || cached.caption.length < 12) throw new Error('Bad cache');
      output[frame.id] = cached.caption;
    } catch {
      pending.push({ frame, cachePath });
    }
  }
  onProgress?.(media.length - pending.length, media.length);

  // Unlike the previous multimodal path, inspect ALL images, not just 36.
  // Small batches reduce context / payload failures on long 110-image projects.
  for (let offset = 0; offset < pending.length; offset += 8) {
    const batch = pending.slice(offset, offset + 8);
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{
      text: 'Describe each image separately. Return imageDescriptions array with exact imageId strings. For every image: one detailed sentence naming visible objects, subject action, expression, setting, camera angle. Be literal and concise. Do not infer events from a story or filename. Every supplied ID must appear exactly once.',
    }];
    for (const { frame } of batch) {
      parts.push({ text: `Image ID: ${frame.id}` });
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: (await fs.readFile(frame.thumbPath)).toString('base64'),
        },
      });
    }
    const response = await client.models.generateContent({
      model,
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            imageDescriptions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  imageId: { type: Type.STRING },
                  visualSummary: { type: Type.STRING },
                },
                required: ['imageId', 'visualSummary'],
              },
            },
          },
          required: ['imageDescriptions'],
        },
      },
    });
    const parsed = JSON.parse(response.text || '{}') as {
      imageDescriptions?: Array<{ imageId?: string; visualSummary?: string }>;
    };
    const descriptionMap = new Map((parsed.imageDescriptions || [])
      .filter((item) => item.imageId && item.visualSummary)
      .map((item) => [item.imageId!, item.visualSummary!.trim()]));
    for (const { frame, cachePath } of batch) {
      const caption = descriptionMap.get(frame.id);
      if (!caption || caption.length < 12) {
        throw new Error(`Gemini did not describe image ${frame.id}. Refusing to guess its contents.`);
      }
      output[frame.id] = caption.slice(0, 420);
      await fs.writeFile(cachePath, JSON.stringify({ caption: output[frame.id] }), 'utf8');
    }
    onProgress?.(media.length - pending.length + Math.min(pending.length, offset + batch.length), media.length);
  }
  return output;
}
