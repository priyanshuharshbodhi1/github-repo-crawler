#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const uiDir = path.join(rootDir, 'ui');
const artifactsDir = path.join(rootDir, 'artifacts');
const port = Number(process.env.UI_PORT || 4173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function resolveRequestFile(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') {
    return path.join(uiDir, 'index.html');
  }

  if (urlPath.startsWith('/artifacts/')) {
    return path.join(rootDir, urlPath);
  }

  return path.join(uiDir, urlPath.replace(/^\//, ''));
}

function safePath(filePath) {
  const normalized = path.normalize(filePath);
  const allowedRoots = [uiDir, artifactsDir];
  return allowedRoots.some((root) => normalized.startsWith(root));
}

const server = http.createServer((req, res) => {
  const pathname = req.url ? req.url.split('?')[0] : '/';
  const filePath = resolveRequestFile(pathname);

  if (!safePath(filePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not found: ${pathname}`);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(port, () => {
  console.log(`UI server running at http://localhost:${port}`);
});
