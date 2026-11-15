import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { ProjectSession, RenderJobState } from '../../src/types/studio.ts';
import { fixture } from './fixtures.ts';

async function start(cwd: string) {
  const child = fork(fileURLToPath(new URL('./apiServer.ts', import.meta.url)), [], { cwd,
    execArgv: ['--import', new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url).href],
    env: { ...process.env, GEMINI_API_KEY: '', OLLAMA_HOST: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr?.on('data', chunk => { errors += chunk.toString(); });
  const ready = await Promise.race([
    once(child, 'message').then(([port]) => String(port)),
    once(child, 'exit').then(() => { throw new Error(`API server stopped: ${errors}`); }),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('API startup timed out')), 15000); timer.unref(); }),
  ]);
  return { url: `http://127.0.0.1:${ready}/api`, async close() {
    const closed = once(child, 'exit'); child.send('close'); await closed;
  } };
}

async function json(url: string, body?: unknown) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data)); return data;
}

async function terminal(url: string, jobId: string): Promise<RenderJobState> {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const state = await json(`${url}/jobs/${jobId}`) as RenderJobState;
    if (state.status === 'completed' || state.status === 'failed') return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Render job never reached a terminal state');
}

test('HTTP upload → edit → export → immediate download → restart; failed and orphan files never become success', { timeout: 180000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SceneSync API '));
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const input = await fixture(path.join(dir, 'input'), 2, 1400);
    server = await start(dir);
    const form = new FormData();
    form.append('audio', new Blob([await fs.readFile(input.audioPath)]), 'speech.wav');
    for (const [id, media] of input.mediaById) form.append('images', new Blob([await fs.readFile(media.path)]), `${id}.png`);
    form.append('script', 'Red opens. Green follows.');
    form.append('matchingPreference', 'local'); // deliberate manual fixture, no fake AI
    form.append('pacingMode', 'upload-match');
    form.append('motionIntensity', 'none');
    const response = await fetch(`${server.url}/analyze`, { method: 'POST', body: form });
    const project = await response.json() as ProjectSession;
    assert.ok(response.ok, JSON.stringify(project));
    assert.equal(project.images.length, 2);
    const scenes = project.scenes.map((s, i) => ({ ...s, startMs: i * 700, endMs: (i + 1) * 700, durationMs: 700 }));
    await json(`${server.url}/projects/${project.id}/realign`, { scenes });
    const job = await json(`${server.url}/projects/${project.id}/export`, { encoderId: 'libx264', scenes });
    // Read the actual SSE terminal event, then download immediately (old race).
    const events = await fetch(`${server.url}/jobs/${job.jobId}/events`);
    const eventText = await events.text();
    const completed = eventText.trim().split('\n\n').map(line => JSON.parse(line.slice(6)) as RenderJobState).at(-1)!;
    assert.equal(completed.status, 'completed', completed.error);
    const download = await fetch(server.url.replace('/api', '') + completed.outputUrl);
    assert.equal(download.status, 200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    assert.equal(bytes.length, completed.fileSizeBytes);
    const failedJob = await json(`${server.url}/projects/${project.id}/export`, {
      scenes: scenes.map(s => ({ ...s, imageId: 'missing' })),
    });
    const failed = await terminal(server.url, failedJob.jobId);
    assert.equal(failed.status, 'failed'); assert.match(failed.error!, /Media file missing/);
    assert.equal((await fetch(`${server.url}/jobs/${failedJob.jobId}/download`)).status, 404);
    await server.close(); server = undefined;
    const jobsDir = path.join(dir, 'workspace_data', '_jobs');
    await fs.writeFile(path.join(jobsDir, 'interrupted.json'), JSON.stringify({ state: { ...completed,
      jobId: 'interrupted', status: 'muxing', outputUrl: undefined } }));
    const orphan = path.join(dir, 'workspace_data', project.id, `scenesync_${project.id}_orphan.mp4`);
    await fs.writeFile(orphan, Buffer.from('partial mp4'));
    server = await start(dir);
    assert.equal((await json(`${server.url}/jobs/${job.jobId}`)).status, 'completed');
    assert.equal((await fetch(`${server.url}/jobs/${job.jobId}/download`)).status, 200);
    assert.equal((await json(`${server.url}/jobs/${failedJob.jobId}`)).status, 'failed');
    const interrupted = await json(`${server.url}/jobs/interrupted`);
    assert.equal(interrupted.status, 'failed'); assert.match(interrupted.error, /restart/);
    assert.equal((await fetch(`${server.url}/jobs/orphan`)).status, 404);
    assert.equal((await json(`${server.url}/exports/recent`)).latest.jobId, job.jobId);
    const names = await fs.readdir(path.join(dir, 'workspace_data', project.id));
    assert.ok(!names.some(n => n.startsWith('render_')));
    // Deleting a completed output must not leave a success state on next restart.
    const metadata = JSON.parse(await fs.readFile(path.join(jobsDir, `${job.jobId}.json`), 'utf8'));
    await server.close(); server = undefined;
    await fs.rm(metadata.outputPath);
    server = await start(dir);
    assert.equal((await json(`${server.url}/jobs/${job.jobId}`)).status, 'failed');
    assert.equal((await json(`${server.url}/exports/recent`)).latest, null);
  } finally {
    await server?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
