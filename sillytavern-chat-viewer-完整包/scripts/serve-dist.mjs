import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const rootDir = path.resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.env.PORT || 4173);

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, { 'Content-Type': contentType });
  response.end(body);
}

function resolveFile(urlPath) {
  const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  const candidate = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const resolved = path.resolve(rootDir, candidate);

  if (!resolved.startsWith(rootDir)) {
    return null;
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }

  return path.join(rootDir, 'index.html');
}

const server = http.createServer((request, response) => {
  const filePath = resolveFile(request.url || '/');
  if (!filePath) {
    send(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    send(response, 200, content, contentType);
  } catch (error) {
    send(response, 500, `Failed to read file.\n${String(error)}`, 'text/plain; charset=utf-8');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`SillyTavern Export Viewer running at http://127.0.0.1:${port}`);
});
