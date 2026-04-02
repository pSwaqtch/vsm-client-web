const fs = require('node:fs');
const http = require('node:http');

const { createSimState } = require('./lib/sim-state.js');

async function readJsonBody(request) {
  let rawBody = '';
  for await (const chunk of request) {
    rawBody += chunk;
  }

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error('Invalid JSON request body');
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function normalizeArgs(args) {
  if (args && typeof args === 'object') {
    return args;
  }
  return {};
}

function createBackendHandler() {
  const simState = createSimState();

  return {
    async selectDevice(args) {
      const { device = '7000' } = normalizeArgs(args);
      return simState.selectDevice(device);
    },

    async reset() {
      return simState.reset();
    },

    async loadCfg(args) {
      const { fileContent, filePath } = normalizeArgs(args);
      if (typeof fileContent === 'string') {
        return simState.loadCfgContent(fileContent);
      }
      if (filePath) {
        return simState.loadCfgContent(fs.readFileSync(filePath, 'utf8'));
      }
      throw new Error('fileContent or filePath is required');
    },

    async readRegister(args) {
      const { value } = normalizeArgs(args);
      return simState.readRegister(value);
    },

    async getVersion() {
      return 'preview';
    },

    async getBoard() {
      return 'preview-board';
    },

    async getSillicon() {
      return simState.getDevice() || '7000';
    },

    async list() {
      return [];
    },

    async connectionStatusCheck() {
      return false;
    },

    async fileExists() {
      return false;
    },
  };
}

function createBackendServer(port = 2880) {
  const handler = createBackendHandler();
  const routes = {
    '/target/selectDevice': (body) => handler.selectDevice(body),
    '/target/reset': (body) => handler.reset(body),
    '/target/loadCfg': (body) => handler.loadCfg(body),
    '/target/readRegister': (body) => handler.readRegister(body),
    '/target/getVersion': () => handler.getVersion(),
    '/target/getBoard': () => handler.getBoard(),
    '/target/getSillicon': () => handler.getSillicon(),
    '/target/list': () => handler.list(),
    '/target/connectionStatusCheck': () => handler.connectionStatusCheck(),
    '/target/fileExists': () => handler.fileExists(),
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const route = routes[url.pathname];

    if (!route) {
      sendJson(response, 404, 'Not found');
      return;
    }

    if (request.method !== 'POST' && request.method !== 'GET') {
      sendJson(response, 405, 'Method not allowed');
      return;
    }

    try {
      const body = request.method === 'POST' ? await readJsonBody(request) : {};
      const payload = await route(body);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, error.message || String(error));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Mac preview backend running at http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = {
  createBackendHandler,
  createBackendServer,
};
