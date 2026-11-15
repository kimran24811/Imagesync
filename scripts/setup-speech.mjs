import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve('workspace_data', '_speech');
fs.mkdirSync(root, { recursive: true });
const python =
  process.env.SPEECH_BOOTSTRAP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const venv = path.join(root, 'venv');
const local = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error(
      result.error?.message || 'Speech setup failed. Install Python 3.10–3.12 and retry.'
    );
    process.exit(1);
  }
};
run(python, ['-m', 'venv', venv]);
run(local, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '--cache-dir',
  path.join(root, 'pip-cache'),
  '-r',
  fileURLToPath(new URL('../server/scripts/speech-requirements.txt', import.meta.url)),
]);
console.log('Downloading the multilingual speech model (first setup only)…');
run(local, [
  '-c',
  'from faster_whisper import WhisperModel; import sys; WhisperModel(sys.argv[1],device="cpu",compute_type="int8",download_root=sys.argv[2])',
  process.env.SPEECH_MODEL || 'base',
  path.join(root, 'models'),
]);
console.log('Speech alignment is ready. Reload SceneSync. No cloud transcription key is needed.');
