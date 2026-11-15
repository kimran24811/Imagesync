import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  saveProject,
  loadProject,
  listProjects,
  type ProjectRecord,
} from '../server/services/projectStore.ts';
import { RenderQueue } from '../server/services/renderQueue.ts';

test('project manifests preserve edits and maps; last queued autosave wins', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'SceneSync save '));
  try {
    const projectDir = path.join(root, 'test');
    await fs.mkdir(projectDir);
    const audioPath = path.join(projectDir, 'voice.wav');
    await fs.writeFile(audioPath, 'fixture');
    const record = {
      projectDir,
      audioPath,
      session: {
        id: 'test',
        createdAt: '2026-01-01',
        rawScript: 'first',
        aspectRatio: '9:16',
        motionIntensity: 'none',
        transitionStyle: 'cut',
        transitionDurationMs: 0,
        subtitlesEnabled: false,
        captionMode: 'off',
        textEffect: 'type-reveal',
        fontStyle: 'modern-sans',
        accentColor: 'coral',
        brandKicker: '',
        sfxConfig: {
          enabled: false,
          volumeDb: -8,
          includeTransitionWhoosh: false,
          includeTextPop: false,
          includeHookImpact: false,
          includeMicroBeatTicks: false,
        },
        matchingEngineUsed: 'local-heuristic',
        audio: {
          durationMs: 1000,
          filename: 'voice.wav',
          url: '',
          sampleRate: 16000,
          channels: 1,
          codec: 'pcm_s16le',
          waveformPeaks: [],
          pauses: [],
        },
        images: [],
        scenes: [],
      },
      mediaById: new Map([
        ['image', { path: path.join(projectDir, 'image.png'), mediaType: 'image' }],
      ]),
      thumbPathsById: new Map(),
    } as ProjectRecord;
    const a = saveProject(record);
    record.session.rawScript = 'latest edit';
    const b = saveProject(record);
    await Promise.all([a, b]);
    const loaded = await loadProject(root, 'test');
    assert.equal(loaded?.session.rawScript, 'latest edit');
    assert.equal(loaded?.mediaById.get('image')?.mediaType, 'image');
    assert.equal((await listProjects(root)).length, 1);
    assert.equal(await loadProject(root, '../test'), undefined);
    assert.ok(!(await fs.readdir(projectDir)).some((p) => p.endsWith('.tmp')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('render queue is serial, queued cancellation does not start a compositor, and failures release the queue', async () => {
  const queue = new RenderQueue(),
    events: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const first = queue.enqueue(async () => {
    events.push('first');
    await hold;
    events.push('first end');
  });
  const abort = new AbortController();
  const second = queue.enqueue(async () => {
    events.push('cancelled should not run');
  }, abort.signal);
  const secondResult = assert.rejects(second, /cancelled/);
  abort.abort();
  const third = queue.enqueue(async () => {
    events.push('third');
    throw new Error('device failed');
  });
  const thirdResult = assert.rejects(third, /device failed/);
  const fourth = queue.enqueue(async () => {
    events.push('fourth');
  });
  release();
  await Promise.all([first, secondResult, thirdResult, fourth]);
  assert.deepEqual(events, ['first', 'first end', 'third', 'fourth']);
});
