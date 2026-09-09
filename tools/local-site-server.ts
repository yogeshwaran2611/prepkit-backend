/**
 * Serves fixtures/sites on :8099 so the pipeline can be exercised with no external network.
 *
 * This mirrors Appendix B exactly: "The company sites used with this command may be served
 * from a local address, so your retrieval code must not assume a particular host and must
 * follow relative links."
 *
 *   npm run sites            # http://localhost:8099/acme/ and /nohiring/
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'fixtures/sites');
const PORT = Number(process.env.SITES_PORT ?? 8099);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  // Path traversal guard: this server is a fixture, but it still must not serve the repo.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel);

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`fixture sites on http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/acme/       (rich site, publishes its hiring process)`);
  console.log(`  http://localhost:${PORT}/nohiring/   (no careers or hiring page anywhere)`);
});
