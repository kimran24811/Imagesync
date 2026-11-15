import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { matchNarrative } from '../server/services/narrativeMatcher.ts';
import { getOllamaVisionStatus } from '../server/services/ollamaVision.ts';

test('Ollama capability checks reject text-only models; narrative assignments use only valid IDs', async () => {
  let vision = false,
    invalid = false;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'fixture-vision' }] }));
    else if (req.url === '/api/show')
      res.end(JSON.stringify({ capabilities: vision ? ['completion', 'vision'] : ['completion'] }));
    else if (req.url === '/api/chat')
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              matches: [
                {
                  index: 0,
                  imageId: invalid ? 'unknown' : 'crow',
                  score: 0.9,
                  reason: 'The bird is visibly drinking.',
                },
              ],
            }),
          },
        })
      );
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const oldHost = process.env.OLLAMA_HOST,
    oldModel = process.env.OLLAMA_VISION_MODEL;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${address.port}`;
  process.env.OLLAMA_VISION_MODEL = 'fixture-vision';
  try {
    assert.equal((await getOllamaVisionStatus()).available, false);
    vision = true;
    assert.equal((await getOllamaVisionStatus()).available, true);
    const result = await matchNarrative(
      ['The crow drinks'],
      [{ id: 'crow', description: 'A crow sipping water.' }],
      'ollama-vision'
    );
    assert.equal(result[0].id, 'crow');
    assert.equal(result[0].confidence, 'high');
    invalid = true;
    await assert.rejects(
      matchNarrative(
        ['The crow drinks'],
        [{ id: 'crow', description: 'A crow sipping water.' }],
        'ollama-vision'
      ),
      /Invalid narrative/
    );
  } finally {
    if (oldHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = oldHost;
    if (oldModel === undefined) delete process.env.OLLAMA_VISION_MODEL;
    else process.env.OLLAMA_VISION_MODEL = oldModel;
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});
