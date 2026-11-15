import React, { useEffect, useState } from 'react';
import { Sparkles, Check, Loader2, FolderOpen } from 'lucide-react';
import { DIRECTOR_PRESETS, type DirectorSettings } from '../director/types';
import type { ProjectSession, StudioCapabilities } from '../types/studio';

interface Props {
  settings: DirectorSettings;
  onChange: (settings: DirectorSettings) => void;
  capabilities: StudioCapabilities | null;
  onCapabilities: () => void;
  onLoad: (session: ProjectSession) => void;
  disabled: boolean;
}
export function DirectorControls({
  settings,
  onChange,
  capabilities,
  onCapabilities,
  onLoad,
  disabled,
}: Props) {
  const [setup, setSetup] = useState<{ status: string; message: string }>({
    status: 'idle',
    message: '',
  });
  const [projects, setProjects] = useState<
    Array<{ id: string; title: string; shots: number; durationMs: number }>
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/projects')
      .then((r) => r.json())
      .then((x) => setProjects(x.projects ?? []))
      .catch(() => {});
  }, [disabled]);
  useEffect(() => {
    if (setup.status !== 'running') return;
    const timer = setInterval(() => {
      void fetch('/api/speech/setup')
        .then((r) => r.json())
        .then((x) => {
          setSetup(x);
          if (x.status === 'completed') onCapabilities();
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [setup.status, onCapabilities]);
  const install = async () => {
    try {
      const r = await fetch('/api/speech/setup', { method: 'POST' });
      setSetup(await r.json());
    } catch {
      setError('Could not start speech setup.');
    }
  };
  const load = async (id: string) => {
    try {
      const r = await fetch(`/api/projects/${id}`);
      const x = await r.json();
      if (!r.ok) throw new Error(x.error);
      onLoad(x);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load project.');
    }
  };
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[#31343e] bg-[#14161e] p-5 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-5 w-5 text-[#ff3d87]" />
            Automatic Reel Director
          </div>
          <p className="mt-1 text-sm text-[#bec2d0]">
            Your images, voiceover and script → an edited reel with motion, text, overlays and
            sound.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
          />
          Direct the edit automatically
        </label>
      </div>
      {settings.enabled && (
        <>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {DIRECTOR_PRESETS.map((p) => (
              <button
                key={p.id}
                disabled={disabled}
                onClick={() => onChange({ ...settings, preset: p.id })}
                className={`rounded-xl border p-3 text-left transition-colors ${settings.preset === p.id ? 'border-[#ff3d87] bg-[#30202c]' : 'border-[#343846] bg-[#1b1e29] hover:border-[#7c8293]'}`}
              >
                <div className="flex items-start justify-between gap-1 text-sm font-semibold">
                  {p.name}
                  {settings.preset === p.id && (
                    <Check className="h-4 w-4 shrink-0 text-[#ff3d87]" />
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#bec2d0]">{p.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#343846] pt-4 text-xs">
            <label className="flex items-center gap-2">
              Speech timing
              <select
                aria-label="Speech timing"
                className="rounded border border-[#555b6d] bg-[#252937] p-2 text-white"
                value={settings.alignment}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    alignment: e.target.value as DirectorSettings['alignment'],
                  })
                }
              >
                <option value="auto">Automatic · use local speech when ready</option>
                <option value="required">Require recognized word timestamps</option>
                <option value="estimated">Estimated timing · no speech recognition</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.music !== 'none'}
                onChange={(e) =>
                  onChange({ ...settings, music: e.target.checked ? 'auto' : 'none' })
                }
              />
              Automatic instrumental bed
            </label>
            <span className={capabilities?.speech?.available ? 'text-[#8de0ab]' : 'text-[#eac98d]'}>
              {capabilities?.speech?.available
                ? 'Local speech ready'
                : 'Word timing setup needed; automatic mode will disclose estimates'}
            </span>
            {!capabilities?.speech?.available && (
              <button
                onClick={() => void install()}
                disabled={setup.status === 'running'}
                className="inline-flex items-center gap-2 rounded border border-[#5a6073] px-3 py-2 hover:bg-[#303647]"
              >
                {setup.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}Set up
                speech
              </button>
            )}
          </div>
          {setup.message && (
            <p className="mt-2 break-words text-xs text-[#bec2d0]">{setup.message}</p>
          )}
        </>
      )}
      {projects.length > 0 && (
        <label className="mt-4 flex items-center gap-2 border-t border-[#343846] pt-4 text-xs">
          <FolderOpen className="h-4 w-4" />
          Resume a saved project
          <select
            aria-label="Resume saved project"
            className="max-w-[480px] rounded bg-[#252937] p-2 text-white"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void load(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.shots} shots · {Math.round(p.durationMs / 1000)}s
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[#ff9da8]">
          {error}
        </p>
      )}
    </section>
  );
}
