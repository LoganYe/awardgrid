import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import worker from './worker.mjs';

const env = { PUBLIC_ORIGIN: 'https://awardgrid-example.vercel.app' };
const base = 'https://awardgrid.dowhiz.com';

test('public fetch keeps path and query while withholding private request headers', async () => {
  let upstream;
  const fetchMock = mock.method(globalThis, 'fetch', async (request) => {
    upstream = request;
    return new Response('public', { headers: { 'X-Robots-Tag': 'noindex', 'Set-Cookie': 'private=wrong' } });
  });
  try {
    const response = await worker.fetch(new Request(`${base}/ios/?utm_source=test`, {
      headers: { Cookie: 'session=private', Authorization: 'Bearer private', 'CF-Connecting-IP': '192.0.2.1', Accept: 'text/html' },
    }), env);
    assert.equal(upstream.url, `${env.PUBLIC_ORIGIN}/ios/?utm_source=test`);
    assert.equal(upstream.redirect, 'manual');
    assert.equal(upstream.headers.get('accept'), 'text/html');
    for (const key of ['cookie', 'authorization', 'cf-connecting-ip']) assert.equal(upstream.headers.get(key), null);
    assert.equal(response.headers.get('x-robots-tag'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await response.text(), 'public');
  } finally { fetchMock.mock.restore(); }
});

test('private paths and parameterized root never reach the Vercel public origin', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('private request escaped'); });
  try {
    for (const path of ['/grid', '/login', '/api/auth/me', '/_next/static/app.js', '/fonts/InterVariable.woff2', '/?utm_source=test', '/robots.txt?x=1']) {
      assert.equal((await worker.fetch(new Request(base + path), env)).status, 404, path);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); }
});

test('public routes are read only', async () => {
  assert.equal((await worker.fetch(new Request(`${base}/ios/`, { method: 'POST', body: 'private' }), env)).status, 405);
});

test('HEAD preserves conditional and range semantics', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (request) => {
    assert.equal(request.method, 'HEAD');
    assert.equal(request.headers.get('if-none-match'), 'etag');
    assert.equal(request.headers.get('range'), 'bytes=0-20');
    return new Response(null, { status: 304, headers: { ETag: 'etag' } });
  });
  try {
    const response = await worker.fetch(new Request(`${base}/_site/styles.css`, {
      method: 'HEAD', headers: { 'If-None-Match': 'etag', Range: 'bytes=0-20' },
    }), env);
    assert.equal(response.status, 304);
    assert.equal(response.headers.get('etag'), 'etag');
  } finally { fetchMock.mock.restore(); }
});

test('redirects stay on the primary domain without following an upstream redirect', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 308, headers: { Location: `${env.PUBLIC_ORIGIN}/privacy/?lang=en` },
  }));
  try {
    const response = await worker.fetch(new Request(`${base}/privacy`), env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `${base}/privacy/?lang=en`);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally { fetchMock.mock.restore(); }
});

test('slash and index redirects preserve incoming tracking and language parameters', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (request) => new Response(null, {
    status: 308, headers: { Location: new URL(request.url).pathname.startsWith('/ios') ? '/ios/' : '/privacy/' },
  }));
  try {
    for (const [input, output] of [
      ['/ios?utm_source=test', '/ios/?utm_source=test'],
      ['/privacy/index.html?lang=en', '/privacy/?lang=en'],
    ]) {
      assert.equal((await worker.fetch(new Request(base + input), env)).headers.get('location'), base + output);
    }
  } finally { fetchMock.mock.restore(); }
});

test('preview aliases and public 404s stay noindex', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('page', { headers: { 'X-Robots-Tag': 'noindex' } }));
  try {
    const response = await worker.fetch(new Request('https://awardgrid-site.example.workers.dev/ios/'), env);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    fetchMock.mock.mockImplementation(async () => new Response('missing', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } }));
    assert.equal((await worker.fetch(new Request(`${base}/ios/missing`), env)).headers.get('x-robots-tag'), 'noindex');
  } finally { fetchMock.mock.restore(); }
});

test('returns the response stream before the upstream finishes', async () => {
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('first')); } });
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(stream));
  try {
    const response = await Promise.race([
      worker.fetch(new Request(`${base}/ios/`), env),
      new Promise((_, reject) => setTimeout(() => reject(new Error('response buffered')), 100)),
    ]);
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
    controller.enqueue(new TextEncoder().encode('second'));
    controller.close();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'second');
    assert.equal((await reader.read()).done, true);
  } finally { fetchMock.mock.restore(); }
});

test('missing origin and fetch failure produce an uncached noindex error', async () => {
  assert.equal((await worker.fetch(new Request(base + '/ios/'), {})).status, 503);
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  try {
    const response = await worker.fetch(new Request(base + '/ios/'), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  } finally { fetchMock.mock.restore(); }
});
