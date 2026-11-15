import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ProjectSession, MediaType } from '../../src/types/studio.ts';

export interface ProjectRecord {
  session: ProjectSession;
  projectDir: string;
  audioPath: string;
  musicPath?: string;
  mediaById: Map<string, { path: string; mediaType: MediaType }>;
  thumbPathsById: Map<string, string>;
}
const pending = new Map<string, Promise<void>>();
/** Serialized same-project writes prevent an older autosave from winning a race. */
export function saveProject(record: ProjectRecord): Promise<void> {
  const id = record.session.id;
  const snapshot = JSON.stringify({
    version: 1,
    ...record,
    session: record.session,
    mediaById: [...record.mediaById],
    thumbPathsById: [...record.thumbPathsById],
  });
  const operation = (pending.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const target = path.join(record.projectDir, 'project.json'),
        temporary = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try {
        await fs.writeFile(temporary, snapshot, 'utf8');
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
  pending.set(id, operation);
  void operation
    .finally(() => {
      if (pending.get(id) === operation) pending.delete(id);
    })
    .catch(() => {});
  return operation;
}
export async function loadProject(root: string, id: string): Promise<ProjectRecord | undefined> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
  try {
    const dir = path.join(root, id),
      x = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
    if (
      x.version !== 1 ||
      x.session?.id !== id ||
      !Array.isArray(x.mediaById) ||
      !Array.isArray(x.session.scenes) ||
      typeof x.session.rawScript !== 'string' ||
      !x.session.audio
    )
      return;
    const inside = (p: string) =>
      typeof p === 'string' && path.resolve(p).startsWith(path.resolve(dir) + path.sep);
    if (
      !Array.isArray(x.thumbPathsById) ||
      !x.thumbPathsById.every(([, p]: [string, string]) => inside(p))
    )
      return;
    if (
      !inside(x.audioPath) ||
      !x.mediaById.every(([, v]: [string, { path: string }]) => inside(v.path)) ||
      (x.musicPath && !inside(x.musicPath))
    )
      return;
    await fs.access(x.audioPath);
    return {
      session: x.session,
      projectDir: dir,
      audioPath: x.audioPath,
      musicPath: x.musicPath,
      mediaById: new Map(x.mediaById),
      thumbPathsById: new Map(x.thumbPathsById ?? []),
    };
  } catch {
    return;
  }
}
export async function listProjects(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const records = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => loadProject(root, e.name))
  );
  return records
    .filter((x): x is ProjectRecord => Boolean(x))
    .map((x) => ({
      id: x.session.id,
      createdAt: x.session.createdAt,
      durationMs: x.session.audio.durationMs,
      shots: x.session.scenes.length,
      preset: x.session.directorSettings?.preset,
      title: x.session.rawScript.slice(0, 100),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
