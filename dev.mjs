// Local preview: serves dist/ and runs the same proxy as the Netlify edge function.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import proxy from './netlify/edge-functions/proxy.js';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 8888;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/api/proxy') {
      const r = await proxy(new Request(url, { method: req.method, headers: req.headers }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) Readable.fromWeb(r.body).pipe(res);
      else res.end();
      return;
    }
    const file = path.join('dist', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500);
    res.end(String(e.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));

