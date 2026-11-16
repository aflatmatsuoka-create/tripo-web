import { test } from 'node:test';
import assert from 'node:assert/strict';
import proxy from '../netlify/edge-functions/proxy.js';
import { imageSize } from '../src/core.js';

const request = (url, options = {}) => new Request(`https://example.test/api/proxy?url=${encodeURIComponent(url)}`, options);
const id = '12345678-1234-1234-1234-123456789abc';
const api = `https://api.tripo3d.ai/v2/studio/project/detail/v3/${id}`;

test('proxy rejects invalid destinations before network access', async () => {
  for (const url of ['https://evil.test/a', 'http://api.tripo3d.ai/a', 'https://api.tripo3d.ai.evil.test/a', 'https://user:pass@api.tripo3d.ai/a', 'https://api.tripo3d.ai:8443/a']) {
    assert.equal((await proxy(request(url))).status, 403);
  }
  assert.equal((await proxy(new Request('https://example.test/api/proxy'))).status, 400);
  assert.equal((await proxy(request(api, { method: 'POST' }))).status, 405);
});

test('authorization is limited to project-detail API, redirects never followed', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response('model', { headers: { 'content-type': 'model/gltf-binary' } });
  });
  for (const url of [api, 'https://cdn.tripo3d.ai/file.glb', 'https://api.tripo3d.ai/other']) {
    const response = await proxy(request(url, { headers: { authorization: 'Bearer TEST_ONLY' } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  }
  assert.equal(calls[0].options.headers.authorization, 'Bearer TEST_ONLY');
  for (const call of calls.slice(1)) assert.equal(call.options.headers.authorization, undefined);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'manual');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('upstream redirects are blocked without relaying Location', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
  const response = await proxy(request(api));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('location'), null);
});

test('upstream errors return safe 502/504 responses', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('private details'); });
  let response = await proxy(request(api));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes('private details'), false);
  mock.mock.mockImplementation(async () => { throw new DOMException('timeout', 'TimeoutError'); });
  response = await proxy(request(api));
  assert.equal(response.status, 504);
});

function webp(type, size) {
  const b = new Uint8Array(size);
  for (const [offset, tag] of [[0, 'RIFF'], [8, 'WEBP'], [12, type]]) {
    b.set(new TextEncoder().encode(tag), offset);
  }
  return b;
}

test('truncated WebP headers never throw', () => {
  for (const type of ['VP8 ', 'VP8L', 'VP8X']) {
    assert.deepEqual(imageSize(webp(type, 24)), {});
  }
});

test('WebP VP8, VP8L and VP8X dimensions are decoded', () => {
  let b = webp('VP8 ', 30);
  b.set([0x9d, 1, 0x2a], 23);
  new DataView(b.buffer).setUint16(26, 512, true);
  new DataView(b.buffer).setUint16(28, 256, true);
  assert.deepEqual(imageSize(b), { width: 512, height: 256 });
  b = webp('VP8L', 25); b[20] = 0x2f;
  new DataView(b.buffer).setUint32(21, 511 | (255 << 14), true);
  assert.deepEqual(imageSize(b), { width: 512, height: 256 });
  b = webp('VP8X', 30); b[24] = 255; b[25] = 1; b[27] = 255;
  assert.deepEqual(imageSize(b), { width: 512, height: 256 });
});
