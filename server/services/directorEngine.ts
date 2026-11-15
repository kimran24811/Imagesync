import path from 'node:path';
import { createMusicBed } from './musicBed.ts';
import { Type } from '@google/genai';
import type { ProjectSession } from '../../src/types/studio.ts';
import { attachSpeech, estimateWords, planMotion } from '../../src/director/planner.ts';
import {
  sanitizeDirector,
  LAYOUTS,
  ENTRANCES,
  type SpeechAlignment,
} from '../../src/director/types.ts';
import { alignSpeech, getSpeechStatus } from './speechAligner.ts';
import { getGeminiClient, getGeminiVisionModel } from './geminiClient.ts';

export async function directSession(
  session: ProjectSession,
  audioPath: string,
  rawSettings: unknown,
  onProgress?: (message: string) => void
): Promise<ProjectSession> {
  const settings = sanitizeDirector(rawSettings);
  if (!settings.enabled)
    return {
      ...session,
      directorSettings: settings,
      directorReport: undefined,
      scenes: session.scenes.map((s) => ({ ...s, motion: undefined })),
    };
  onProgress?.('Aligning spoken words and planning motion…');
  let alignment: SpeechAlignment = {
    engine: 'estimated',
    coverage: 0,
    words: estimateWords(session.scenes),
    notice: 'Timing uses scene estimates rather than recognized speech.',
  };
  const speech = await getSpeechStatus();
  if (settings.alignment !== 'estimated' && speech.available) {
    alignment = await alignSpeech(audioPath, session.rawScript, session.audio.durationMs);
  } else if (settings.alignment === 'required') throw new Error(speech.message);
  if (settings.alignment === 'required' && alignment.coverage < 0.9)
    throw new Error(
      `Speech alignment matched only ${Math.round(alignment.coverage * 100)}% of words. Check the script or choose automatic timing explicitly.`
    );
  let scenes =
    alignment.engine === 'faster-whisper'
      ? attachSpeech(session.scenes, alignment, session.audio.durationMs)
      : session.scenes;
  const planned = planMotion(scenes, settings.preset, alignment);
  scenes = planned.scenes;
  // Cloud suggestions are optional. The executable library/constraints always own timing and rendering.
  const client = process.env.DIRECTOR_AI === 'off' ? null : getGeminiClient();
  if (client) {
    try {
      onProgress?.('Choosing emphasis and layouts with Gemini…');
      const response = await client.models.generateContent({
        model: getGeminiVisionModel(),
        contents: JSON.stringify({
          task: 'Choose a layout and entrance for each narration beat. Preserve every id. Headlines and emphasis must be exact substrings of the provided text. Do not invent facts. Vary layouts and keep quieter beats minimal.',
          preset: settings.preset,
          scenes: scenes.map((s) => ({ id: s.id, text: s.text, quiet: s.motion?.quiet })),
        }),
        config: {
          httpOptions: { timeout: 60000 },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              shots: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    headline: { type: Type.STRING },
                    accent: { type: Type.STRING },
                    layout: { type: Type.STRING, enum: LAYOUTS },
                    entrance: { type: Type.STRING, enum: ENTRANCES },
                  },
                  required: ['id', 'headline', 'accent', 'layout', 'entrance'],
                },
              },
            },
            required: ['shots'],
          },
        },
      });
      const payload = JSON.parse(response.text || '{}') as {
        shots?: Array<Record<string, string>>;
      };
      let accepted = 0;
      scenes = scenes.map((s) => {
        if (s.motion?.originMs !== undefined) return s;
        const shot = payload.shots?.find((x) => x.id === s.id);
        if (
          !shot ||
          !s.motion ||
          typeof shot.headline !== 'string' ||
          typeof shot.accent !== 'string' ||
          (shot.layout === 'stat' && !/\d/.test(shot.accent)) ||
          !s.text.includes(shot.headline) ||
          !s.text.includes(shot.accent) ||
          !LAYOUTS.includes(shot.layout as never) ||
          !ENTRANCES.includes(shot.entrance as never)
        )
          return s;
        accepted++;
        return {
          ...s,
          motion: {
            ...s.motion,
            headline: shot.headline.slice(0, 120),
            accent: shot.accent.slice(0, 48),
            layout: s.motion.quiet ? 'minimal' : (shot.layout as typeof s.motion.layout),
            entrance: shot.entrance as typeof s.motion.entrance,
          },
        };
      });
      if (accepted) planned.report.engine = 'gemini-assisted';
      if (accepted < scenes.length)
        planned.report.notices.push(
          `${scenes.length - accepted} shots used validated design rules instead of unusable AI suggestions.`
        );
    } catch {
      planned.report.notices.push(
        'Cloud direction was unavailable; the local design rules created the motion plan.'
      );
    }
  }
  const hasOwnMusic =
    Boolean(session.backgroundMusic) && (session.backgroundMusic?.source==='uploaded' || (session.backgroundMusic?.source!=='procedural' && session.backgroundMusic?.filename !== 'SceneSync original underscore'));
  let backgroundMusic = session.backgroundMusic;
  if (!hasOwnMusic && settings.music === 'auto') {
    const musicPath = path.join(
      path.dirname(path.dirname(audioPath)),
      'music',
      `director_music_v1_${settings.preset}.wav`
    );
    await import('node:fs/promises').then((fs) =>
      fs.mkdir(path.dirname(musicPath), { recursive: true })
    );
    await createMusicBed(musicPath, session.audio.durationMs, settings.preset);
    backgroundMusic = {
      source:'procedural',
      filename: 'SceneSync original underscore',
      url: `/api/media/${session.id}/music/director_music_v1_${settings.preset}.wav`,
      durationMs: session.audio.durationMs,
      volumeDb: -18,
      duckingEnabled: true,
    };
  } else if (!hasOwnMusic && settings.music === 'none') backgroundMusic = undefined;
  const fallbackNotice =
    alignment.engine === 'faster-whisper'
      ? session.fallbackNotice?.replace(/Speech positions.*?pauses\./gi, '').trim()
      : session.fallbackNotice;
  return {
    ...session,
    backgroundMusic,
    fallbackNotice,
    scenes,
    directorSettings: settings,
    directorReport: planned.report,
    motionIntensity: settings.preset === 'cinematic-story' ? 'subtle' : 'moderate',
  };
}
