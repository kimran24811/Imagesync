import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs = 120000
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
    };
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer };
    const stderrText = e.stderr ? e.stderr.toString() : '';
    throw new Error(`${command} failed: ${e.message ?? 'Unknown error'}\n${stderrText.slice(-600)}`);
  }
}

export function spawnStreamCommand(
  command: string,
  args: string[],
  onStderrLine?: (line: string) => void,
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: options.cwd,
      stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrTail = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 20 * 60_000);

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-6000);
      if (onStderrLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onStderrLine(line);
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start ${command}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out: ${stderrTail.slice(-1000)}`));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderrTail.slice(-6000)}`));
      }
    });
  });
}

export function runCommandBuffer(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderrText = '';

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrText = (stderrText + chunk.toString()).slice(-1000);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`${command} buffer exited with ${code}: ${stderrText}`));
      }
    });
  });
}
