import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnStreamCommand } from '../server/services/execUtils.ts';

test('streaming commands drain large stdout without blocking the render process', { timeout: 10000 }, async () => {
  await spawnStreamCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(2_000_000))']);
});

test('hung render commands are terminated with a meaningful timeout', { timeout: 10000 }, async () => {
  await assert.rejects(spawnStreamCommand(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], undefined, { timeoutMs: 100 }), /timed out/);
});

test('command failures retain the actual diagnostic', async () => {
  await assert.rejects(spawnStreamCommand(process.execPath,
    ['-e', 'console.error("Encoder device initialization failed"); process.exit(7)']),
  /code 7: Encoder device initialization failed/);
});
