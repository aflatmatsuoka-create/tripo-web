// Relays GET requests to Tripo's API/CDN. Tripo doesn't send CORS headers for other sites,
// so the browser app calls /api/proxy?url=<tripo url> on its own origin instead.
const ALLOWED_HOSTS = [/^api\.tripo3d\.ai$/, /(^|\.)tripo3d\.com$/, /(^|\.)tripo3d\.ai$/];
const PASS_HEADERS = ['content-type', 'content-length', 'last-modified', 'etag'];

export default async function proxy(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  let target;
  try {
    target = new URL(new URL(req.url).searchParams.get('url'));
  } catch {
    return new Response('Pass ?url=<tripo url>', { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.some((r) => r.test(target.hostname))) {
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
  if (auth) headers.authorization = auth;
  if (target.hostname === 'api.tripo3d.ai') headers['x-tripo-device-id'] = crypto.randomUUID();
  const res = await fetch(target, { headers });
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_HEADERS) if (res.headers.get(h)) out.set(h, res.headers.get(h));
  return new Response(res.body, { status: res.status, headers: out });
}

export const config = { path: '/api/proxy' };
