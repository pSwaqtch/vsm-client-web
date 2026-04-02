const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { createBackendServer } = require('./backend.js');
const { prepareSite, SITE_DIR } = require('./prepare.js');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  response.end(fs.readFileSync(filePath));
}

function createServer(port = 4173, backendPort = 2880) {
  prepareSite();
  const backendServer = createBackendServer(backendPort);

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    let filePath = path.join(SITE_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));

    if (!filePath.startsWith(SITE_DIR)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    sendFile(response, filePath);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Mac preview running at http://127.0.0.1:${port}`);
  });

  return { backendServer, server };
}

if (require.main === module) {
  createServer();
}

module.exports = {
  createServer,
};
