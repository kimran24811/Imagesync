import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface VisionMedia {
  id: string;
  originalName: string;
  thumbPath: string;
}

export interface OllamaStatus {
  available: boolean;
  model: string;
  reason?: string;
}

const modelName = () => process.env.OLLAMA_VISION_MODEL?.trim() || 'gemma3:4b';
const endpoint = () => (process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434').replace(/\/$/, '');

export async function getOllamaVisionStatus(): Promise<OllamaStatus> {
  const model = modelName();
  try {
    const response = await fetch(`${endpoint()}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    if (!data.models?.some((item) => item.name === model || item.model === model)) {
      return {
        available: false, model,
        reason: `Ollama is running, but ${model} is not installed. Run: ollama pull ${model}`,
      };
    }
    const details=await fetch(`${endpoint()}/api/show`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model}),signal:AbortSignal.timeout(5000)});
    if(!details.ok)throw new Error('Cannot inspect model capabilities');
    const info=await details.json() as {capabilities?:string[]};
    if(!info.capabilities?.includes('vision'))return {available:false,model,reason:`${model} does not advertise image/vision capability. Update Ollama and choose an installed vision model.`};
    return { available: true, model };
  } catch {
    return {
      available: false, model,
      reason: `Offline image understanding is not running. Install Ollama from https://ollama.com and run: ollama pull ${model}. Restart SceneSync afterward.`,
    };
  }
}

async function describeImage(base64: string, model: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150000);
  try {
    const response = await fetch(`${endpoint()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '15m',
        options: { temperature: 0, num_predict: 145 },
        messages: [{
          role: 'user',
          content: 'Describe EXACTLY what is visible in this single frame. Say the subjects (e.g. crow, pot, water, pebbles), their precise action, facial expression, environment, and camera view. One or two clear English sentences. If there is text, describe it separately. Do not invent an event not depicted. No storyline guesses.',
          images: [base64],
        }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Local vision model returned HTTP ${response.status}: ${(await response.text()).slice(0,250)}`);
    }
    const data = await response.json() as { message?: { content?: string }; error?: string };
    const caption = (data.message?.content || '').replace(/\s+/g, ' ').trim();
    if (!caption || caption.length < 12) throw new Error(data.error || 'Vision model provided no usable description.');
    return caption.slice(0, 420);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Describe ALL uploads (not just the first 36). Cache descriptions by thumbnail
 * content hash so reanalyses do not rerun expensive local inference.
 */
export async function captionAllMedia(
  media: readonly VisionMedia[],
  cacheDir: string,
  onProgress?: (completed: number, total: number) => void
): Promise<Record<string, string>> {
  const status = await getOllamaVisionStatus();
  if (!status.available) throw new Error(status.reason || 'Offline vision model unavailable.');
  await fs.mkdir(cacheDir, { recursive: true });
  const output: Record<string, string> = {};
  for (let index = 0; index < media.length; index++) {
    const frame = media[index];
    const thumb = await fs.readFile(frame.thumbPath);
    const hash = createHash('sha256').update(status.model).update(thumb).digest('hex');
    const cachePath = path.join(cacheDir, hash + '.json');
    let caption: string | null = null;
    try {
      const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as { caption?: string };
      if (cache.caption && cache.caption.length >= 12) caption = cache.caption;
    } catch {
      // Cache miss is expected for new images.
    }

    if (!caption) {
      try {
        caption = await describeImage(thumb.toString('base64'), status.model);
      } catch (error) {
        throw new Error(
          `Could not inspect uploaded picture ${index + 1} of ${media.length} (${frame.originalName}): ${error instanceof Error ? error.message : String(error)}`
        );
      }
      await fs.writeFile(cachePath, JSON.stringify({ caption }), 'utf8');
    }
    output[frame.id] = caption;
    onProgress?.(index + 1, media.length);
  }
  return output;
}
