// Relays GET requests to Tripo's API/CDN. Tripo doesn't send CORS headers for other sites,
// so the browser app calls /api/proxy?url=<tripo url> on its own origin instead.
const ALLOWED_HOSTS = [/^api\.tripo3d\.ai$/, /(^|\.)tripo3d\.com$/, /(^|\.)tripo3d\.ai$/];
const PASS_HEADERS = ['content-type', 'content-length', 'last-modified', 'etag'];

export default async function proxy(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
  let target;
  try {
    target = new URL(new URL(req.url).searchParams.get('url'));
  } catch {
    return new Response('Pass ?url=<tripo url>', { status: 400 });
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.port || !ALLOWED_HOSTS.some((r) => r.test(target.hostname))) {
    return new Response('Host not allowed', { status: 403 });
  }
  const headers = {
    accept: req.headers.get('accept') || '*/*',
    origin: 'https://studio.tripo3d.ai',
    referer: 'https://studio.tripo3d.ai/',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };
  const auth = req.headers.get('authorization');
  if (auth && target.hostname === 'api.tripo3d.ai' &&
      /^\/v2\/studio\/project\/detail\/v3\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(target.pathname)) {
    headers.authorization = auth;
  }
  if (target.hostname === 'api.tripo3d.ai') headers['x-tripo-device-id'] = crypto.randomUUID();
  let res;
  try {
    res = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return new Response(timeout ? 'Upstream request timed out' : 'Upstream request failed', {
      status: timeout ? 504 : 502, headers: { 'cache-control': 'no-store' },
    });
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    return new Response('Upstream redirects are not allowed', {
      status: 502, headers: { 'cache-control': 'no-store' },
    });
  }
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_HEADERS) if (res.headers.get(h)) out.set(h, res.headers.get(h));
  return new Response(res.body, { status: res.status, headers: out });
}

export const config = { path: '/api/proxy' };

