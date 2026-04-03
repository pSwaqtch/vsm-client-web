const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

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
    const parsedLegacyBody = parseLegacyBody(rawBody);
    if (parsedLegacyBody) {
      return parsedLegacyBody;
    }

    const parseError = new Error('Invalid JSON request body');
    parseError.rawBody = rawBody;
    throw parseError;
  }
}

function coerceLegacyValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function parseLegacyBody(rawBody) {
  const params = new URLSearchParams(rawBody);
  const entries = Array.from(params.entries());
  if (entries.length === 0) {
    return null;
  }

  if (params.has('params')) {
    const wrappedParams = params.get('params');
    if (wrappedParams) {
      try {
        const parsed = JSON.parse(wrappedParams);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch (error) {}
    }
  }

  const payload = {};
  for (const [key, value] of entries) {
    let normalizedKey = key;
    const bracketMatch = key.match(/^params\[(.+)\]$/);

    if (bracketMatch) {
      normalizedKey = bracketMatch[1];
    } else if (key.startsWith('params.')) {
      normalizedKey = key.slice('params.'.length);
    } else if (key === 'params') {
      continue;
    }

    payload[normalizedKey] = coerceLegacyValue(value);
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Cache-Control': 'no-store',
  });
  response.end();
}

function normalizeArgs(args) {
  if (args && typeof args === 'object') {
    return args;
  }
  return {};
}

function createBackendHandler() {
  const simState = createSimState();
  const DEFAULT_DEVICE = '7000';
  const previewCfgByPath = new Map();
  const debugState = {
    cachedPreviewPaths: [],
    lastPreviewStore: null,
    lastLoadCfg: null,
    lastError: null,
  };
  let lastPreviewCfg = null;

  function refreshCachedPreviewPaths() {
    debugState.cachedPreviewPaths = Array.from(previewCfgByPath.keys());
  }

  async function ensureSelectedDevice() {
    if (!simState.getDevice()) {
      await simState.selectDevice(DEFAULT_DEVICE);
    }
  }

  return {
    async selectDevice(args) {
      const { device = DEFAULT_DEVICE } = normalizeArgs(args);
      return simState.selectDevice(device);
    },

    async reset() {
      await ensureSelectedDevice();
      return simState.reset();
    },

    async loadCfg(args) {
      await ensureSelectedDevice();
      const { fileContent, filePath } = normalizeArgs(args);
      debugState.lastLoadCfg = {
        filePath: filePath || null,
        hasFileContent: typeof fileContent === 'string',
        fileContentLength: typeof fileContent === 'string' ? fileContent.length : 0,
      };
      if (typeof fileContent === 'string') {
        return simState.loadCfgContent(fileContent);
      }
      if (filePath && previewCfgByPath.has(filePath)) {
        return simState.loadCfgContent(previewCfgByPath.get(filePath).fileContent);
      }
      if (lastPreviewCfg) {
        return simState.loadCfgContent(lastPreviewCfg.fileContent);
      }
      if (filePath) {
        return simState.loadCfgContent(fs.readFileSync(filePath, 'utf8'));
      }
      throw new Error('fileContent or filePath is required');
    },

    async cachePreviewCfg(args) {
      const { fileContent, fileName, filePath } = normalizeArgs(args);
      if (!filePath || typeof fileContent !== 'string') {
        throw new Error('filePath and fileContent are required');
      }
      lastPreviewCfg = { fileContent, fileName, filePath };
      previewCfgByPath.set(filePath, lastPreviewCfg);
      debugState.lastPreviewStore = {
        fileName: fileName || null,
        filePath,
        fileContentLength: fileContent.length,
      };
      refreshCachedPreviewPaths();
      return true;
    },

    async readRegister(args) {
      await ensureSelectedDevice();
      const { value } = normalizeArgs(args);
      return simState.readRegister(value);
    },

    async writeRegister(args) {
      await ensureSelectedDevice();
      const { value } = normalizeArgs(args);
      return simState.writeRegisterValue(value);
    },

    async readSampleRate(args) {
      await ensureSelectedDevice();
      const { type, sillicon = simState.getDevice() || DEFAULT_DEVICE, slot = 'NA' } = normalizeArgs(args);
      return simState.readSampleRate(type, sillicon, slot);
    },

    async readSlotEnable(args) {
      await ensureSelectedDevice();
      const { type } = normalizeArgs(args);
      return simState.readSlotEnable(type);
    },

    async readPPGAFETrimVref(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readPPGAFETrimVref(slot);
    },

    async readPPGAmbientCancellation(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readPPGAmbientCancellation(slot);
    },

    async readDecimateFactor(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readDecimateFactor(slot);
    },

    async readCHEnable(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readCHEnable(slot);
    },

    async readTIAGain(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readTIAGain(slot);
    },

    async readDACLEDDC(args) {
      await ensureSelectedDevice();
      const { slot, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      return simState.readDACLEDDC(slot, sillicon);
    },

    async readOperationMode(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readOperationMode(slot);
    },

    async readLedType(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      return simState.readLedType(slot);
    },

    async readLedCurrent(args) {
      await ensureSelectedDevice();
      const { slot, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      return simState.readLedCurrent(slot, sillicon);
    },

    async populateDIMode(args) {
      await ensureSelectedDevice();
      const { slotName } = normalizeArgs(args);
      return simState.populateDIMode(slotName);
    },

    async writeSampleRate(args) {
      await ensureSelectedDevice();
      const { type, sample, sillicon = simState.getDevice() || DEFAULT_DEVICE, slot = 'NA' } = normalizeArgs(args);
      return simState.writeSampleRate(type, sample, sillicon, slot);
    },

    async writeSampleRateLoop(args) {
      await ensureSelectedDevice();
      const { type, sample, sillicon = simState.getDevice() || DEFAULT_DEVICE, slotList = [] } = normalizeArgs(args);
      return simState.writeSampleRateLoop(type, sample, sillicon, slotList);
    },

    async writeSlotEnable(args) {
      await ensureSelectedDevice();
      const { slots, type } = normalizeArgs(args);
      return simState.writeSlotEnable(slots, type);
    },

    async writeCHEnable(args) {
      await ensureSelectedDevice();
      const { slot, channelName } = normalizeArgs(args);
      return simState.writeCHEnable(slot, channelName);
    },

    async writeTIAGain(args) {
      await ensureSelectedDevice();
      const { slot, channelName, resistanceValue } = normalizeArgs(args);
      return simState.writeTIAGain(slot, channelName, resistanceValue);
    },

    async writeDACLEDDC(args) {
      await ensureSelectedDevice();
      const { slot, chName, dacValue, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      return simState.writeDACLEDDC(slot, chName, dacValue, sillicon);
    },

    async writeOperationMode(args) {
      await ensureSelectedDevice();
      const { slot, type } = normalizeArgs(args);
      return simState.writeOperationMode(slot, type);
    },

    async writeLedType(args) {
      await ensureSelectedDevice();
      const { slot, ledType, status } = normalizeArgs(args);
      return simState.writeLedType(slot, ledType, status);
    },

    async writeLedCurrent(args) {
      await ensureSelectedDevice();
      const { slot, ledType, currentValue, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      return simState.writeLedCurrent(slot, ledType, currentValue, sillicon);
    },

    async writePulse(args) {
      await ensureSelectedDevice();
      const { slot, pulseValue, type } = normalizeArgs(args);
      return simState.writePulse(slot, pulseValue, type);
    },

    async writeDecimateFactor(args) {
      await ensureSelectedDevice();
      const { slot, decimateFactorValue } = normalizeArgs(args);
      return simState.writeDecimateFactor(slot, decimateFactorValue);
    },

    async writeSimRegister2Hardware() {
      await ensureSelectedDevice();
      return simState.writeSimRegister2Hardware();
    },

    async AGCOnOff(args) {
      const { status } = normalizeArgs(args);
      return simState.AGCOnOff(status);
    },

    async AGCSample(args) {
      const { average, skip } = normalizeArgs(args);
      return simState.AGCSample(average, skip);
    },

    async AGCSlotOnOff(args) {
      const { slotNumber, data, status } = normalizeArgs(args);
      return simState.AGCSlotOnOff(slotNumber, data, status);
    },

    async AGCSlotLED(args) {
      const { slotNumber, data, led } = normalizeArgs(args);
      return simState.AGCSlotLED(slotNumber, data, led);
    },

    async AGCSlotChannel(args) {
      const { slotNumber, data, channel } = normalizeArgs(args);
      return simState.AGCSlotChannel(slotNumber, data, channel);
    },

    async exportCfg(args) {
      await ensureSelectedDevice();
      const { type = [], sillicon = simState.getDevice() || DEFAULT_DEVICE, otherRegisters = [] } = normalizeArgs(args);
      const filePath = simState.exportCfgFile(type, sillicon, otherRegisters);
      return `Success to write dcfg file in ${path.resolve(filePath)}`;
    },

    async getVersion() {
      return 'preview';
    },

    async getBoard() {
      return 'preview-board';
    },

    async getSillicon() {
      return simState.getDevice() || DEFAULT_DEVICE;
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

    async debugPreviewState() {
      return JSON.parse(JSON.stringify(debugState));
    },

    setLastError(error) {
      debugState.lastError = error;
    },
  };
}

function createBackendServer(port = 2880) {
  const handler = createBackendHandler();
  const routes = {
    '/target/selectDevice': (body) => handler.selectDevice(body),
    '/target/reset': (body) => handler.reset(body),
    '/target/loadCfg': (body) => handler.loadCfg(body),
    '/target/previewStoreCfg': (body) => handler.cachePreviewCfg(body),
    '/target/readRegister': (body) => handler.readRegister(body),
    '/target/writeRegister': (body) => handler.writeRegister(body),
    '/target/readSampleRate': (body) => handler.readSampleRate(body),
    '/target/readSlotEnable': (body) => handler.readSlotEnable(body),
    '/target/readPPGAFETrimVref': (body) => handler.readPPGAFETrimVref(body),
    '/target/readPPGAmbientCancellation': (body) => handler.readPPGAmbientCancellation(body),
    '/target/readDecimateFactor': (body) => handler.readDecimateFactor(body),
    '/target/readCHEnable': (body) => handler.readCHEnable(body),
    '/target/readTIAGain': (body) => handler.readTIAGain(body),
    '/target/readDACLEDDC': (body) => handler.readDACLEDDC(body),
    '/target/readOperationMode': (body) => handler.readOperationMode(body),
    '/target/readLedType': (body) => handler.readLedType(body),
    '/target/readLedCurrent': (body) => handler.readLedCurrent(body),
    '/target/populateDIMode': (body) => handler.populateDIMode(body),
    '/target/writeSampleRate': (body) => handler.writeSampleRate(body),
    '/target/writeSampleRateLoop': (body) => handler.writeSampleRateLoop(body),
    '/target/writeSlotEnable': (body) => handler.writeSlotEnable(body),
    '/target/writeCHEnable': (body) => handler.writeCHEnable(body),
    '/target/writeTIAGain': (body) => handler.writeTIAGain(body),
    '/target/writeDACLEDDC': (body) => handler.writeDACLEDDC(body),
    '/target/writeOperationMode': (body) => handler.writeOperationMode(body),
    '/target/writeLedType': (body) => handler.writeLedType(body),
    '/target/writeLedCurrent': (body) => handler.writeLedCurrent(body),
    '/target/writePulse': (body) => handler.writePulse(body),
    '/target/writeDecimateFactor': (body) => handler.writeDecimateFactor(body),
    '/target/writeSimRegister2Hardware': (body) => handler.writeSimRegister2Hardware(body),
    '/target/AGCOnOff': (body) => handler.AGCOnOff(body),
    '/target/AGCSample': (body) => handler.AGCSample(body),
    '/target/AGCSlotOnOff': (body) => handler.AGCSlotOnOff(body),
    '/target/AGCSlotLED': (body) => handler.AGCSlotLED(body),
    '/target/AGCSlotChannel': (body) => handler.AGCSlotChannel(body),
    '/target/exportCfg': (body) => handler.exportCfg(body),
    '/target/getVersion': () => handler.getVersion(),
    '/target/getBoard': () => handler.getBoard(),
    '/target/getSillicon': () => handler.getSillicon(),
    '/target/list': () => handler.list(),
    '/target/connectionStatusCheck': () => handler.connectionStatusCheck(),
    '/target/fileExists': () => handler.fileExists(),
    '/target/debugPreviewState': () => handler.debugPreviewState(),
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const route = routes[url.pathname];

    if (request.method === 'OPTIONS') {
      sendNoContent(response);
      return;
    }

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
      handler.setLastError({
        path: url.pathname,
        message: error.message || String(error),
        rawBody: typeof error.rawBody === 'string' ? error.rawBody.slice(0, 500) : null,
      });
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
