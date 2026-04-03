const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function normalizeRegisterAddress(value) {
  const raw = String(value || '').replace(/^0x/i, '').toLowerCase();
  return `0x${raw.padStart(4, '0')}`;
}

function normalizeRegisterValue(value) {
  const raw = String(value || '').replace(/^0x/i, '').toLowerCase();
  return `0x${raw.padStart(4, '0')}`;
}

function parseSiliconLine(value) {
  const result = String(value || '').trim().toLowerCase();
  if (result.includes('2c2')) return '4200';
  if (result === 'c4') return '6000';
  if (result === 'c6') return '7000';
  return null;
}

function parseCfgLines(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-fA-F]{4}\s+[0-9a-fA-F]{4}$/.test(line))
    .map((line) => {
      const [address, value] = line.split(/\s+/);
      return {
        address: normalizeRegisterAddress(address),
        value: normalizeRegisterValue(value),
      };
    });
}

const fifoRegex = /^\[\d+\]/i;

async function resolvePortPath(nextPortPath, options = {}) {
  const fsModule = options.fsModule || fs;
  const devRoot = options.devRoot || '/dev';
  if (!nextPortPath) {
    throw new Error('Port path is required');
  }

  const requestedPath = String(nextPortPath).trim();
  const normalizedRequested = requestedPath.toLowerCase();
  const requestedBase = path.basename(requestedPath).toLowerCase();
  const entries = await fsModule.promises.readdir(devRoot);

  for (const entry of entries) {
    const candidatePath = path.join(devRoot, entry);
    if (candidatePath.toLowerCase() === normalizedRequested || entry.toLowerCase() === requestedBase) {
      return candidatePath;
    }
  }

  return requestedPath;
}

function createNativeSerialTransport(options = {}) {
  const fsModule = options.fsModule || fs;
  const execFileImpl = options.execFile || execFileAsync;
  const devRoot = options.devRoot || '/dev';
  const openFile = options.openFile || ((portPath) => fsModule.promises.open(portPath, 'r+'));

  let portPath = null;
  let fileHandle = null;
  let readStream = null;
  let lineBuffer = '';
  let pendingCommand = null;
  let queue = Promise.resolve();
  let plotCaptureEnabled = false;
  let exportCaptureEnabled = false;
  let plotBuffer = '';
  let exportBuffer = '';

  function isOpen() {
    return Boolean(fileHandle);
  }

  function resetPending(error) {
    if (!pendingCommand) {
      return;
    }
    const current = pendingCommand;
    pendingCommand = null;
    clearTimeout(current.timer);
    current.reject(error);
  }

  function dispatchLine(line) {
    if (pendingCommand) {
      const current = pendingCommand;
      const parsed = current.parse ? current.parse(line) : line;
      if (parsed == null) {
        return;
      }

      pendingCommand = null;
      clearTimeout(current.timer);
      current.resolve(parsed);
      return;
    }

    if (plotCaptureEnabled && fifoRegex.test(line)) {
      plotBuffer = plotBuffer.concat(`${line}\r`);
    }
    if (exportCaptureEnabled && fifoRegex.test(line)) {
      exportBuffer = exportBuffer.concat(`${line}\r`);
    }
  }

  function onData(chunk) {
    lineBuffer += chunk.toString('utf8');
    const parts = lineBuffer.split(/\r?\n/);
    lineBuffer = parts.pop() || '';
    parts
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach(dispatchLine);
  }

  async function configurePort(nextPortPath) {
    await execFileImpl('stty', [
      '-f',
      nextPortPath,
      '460800',
      'cs8',
      '-cstopb',
      '-parenb',
      'raw',
      '-echo',
    ]);
  }

  function enqueue(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  async function writeOnly(commandText) {
    if (!isOpen()) {
      throw new Error('Serial port is not open');
    }

    return enqueue(async () => {
      await fileHandle.write(`${commandText}\r`);
      return true;
    });
  }

  async function command(commandText, parse, timeoutMs = 1200) {
    if (!isOpen()) {
      throw new Error('Serial port is not open');
    }

    return enqueue(() => new Promise(async (resolve, reject) => {
      try {
        pendingCommand = {
          parse,
          resolve,
          reject,
          timer: setTimeout(() => {
            pendingCommand = null;
            reject(new Error(`Timed out waiting for response to ${commandText}`));
          }, timeoutMs),
        };
        await fileHandle.write(`${commandText}\r`);
      } catch (error) {
        resetPending(error);
      }
    }));
  }

  return {
    async list() {
      const entries = await fsModule.promises.readdir(devRoot);
      return entries
        .filter((entry) => entry.startsWith('cu.'))
        .sort()
        .map((entry) => ({
          path: path.join(devRoot, entry),
          serialNumber: '',
          pnpId: '',
          manufacturer: 'macOS serial',
        }));
    },

    async init(nextPortPath) {
      if (!nextPortPath) {
        throw new Error('Port path is required');
      }
      portPath = await resolvePortPath(nextPortPath, { fsModule, devRoot });
      return true;
    },

    async open() {
      if (!portPath) {
        throw new Error('Port not initialized');
      }
      if (isOpen()) {
        return true;
      }

      await configurePort(portPath);
      fileHandle = await openFile(portPath);
      readStream = fileHandle.createReadStream({ autoClose: false });
      readStream.on('data', onData);
      readStream.on('error', (error) => resetPending(error));
      return true;
    },

    async close() {
      if (readStream) {
        readStream.destroy();
        readStream = null;
      }
      if (fileHandle) {
        await fileHandle.close();
        fileHandle = null;
      }
      lineBuffer = '';
      plotCaptureEnabled = false;
      exportCaptureEnabled = false;
      plotBuffer = '';
      exportBuffer = '';
      resetPending(new Error('Serial connection closed'));
      return true;
    },

    isOpen,

    async connectionStatusCheck() {
      if (!isOpen()) {
        return false;
      }
      try {
        await command('version', (line) => line || null, 500);
        return true;
      } catch (error) {
        return false;
      }
    },

    async getVersion() {
      return command('version', (line) => line || null);
    },

    async getBoard() {
      return command('board', (line) => line || null);
    },

    async getSillicon() {
      const result = await command('chip_id', (line) => parseSiliconLine(line));
      if (!result) {
        throw new Error('Not a recognized silicon');
      }
      return result;
    },

    async reset() {
      await writeOnly('sw_reset');
      return true;
    },

    async readRegister(value) {
      const register = normalizeRegisterAddress(value);
      return command(`reg_read ${register}`, (line) => {
        const match = /.*:0x([0-9a-f]+)/i.exec(line);
        return match ? match[1].toLowerCase() : null;
      });
    },

    async writeRegister(value) {
      const [address, registerValue] = String(value || '').trim().split(/\s+/);
      const normalizedAddress = normalizeRegisterAddress(address);
      const normalizedValue = normalizeRegisterValue(registerValue);
      await command(`reg_write ${normalizedAddress} ${normalizedValue}`, (line) => (line ? true : null));
      return `${normalizedAddress} ${normalizedValue}`;
    },

    async loadCfgContent(content) {
      const writes = parseCfgLines(content);
      for (const write of writes) {
        await command(`reg_write ${write.address} ${write.value}`, (line) => (line ? true : null));
      }
      return 'success';
    },

    async startPlot(commandText) {
      plotBuffer = '';
      plotCaptureEnabled = true;
      return writeOnly(commandText);
    },

    drainPlotData() {
      const value = plotBuffer;
      plotBuffer = '';
      return value;
    },

    async stopPlot(commandText = 'app_stop') {
      plotCaptureEnabled = false;
      plotBuffer = '';
      return writeOnly(commandText);
    },

    async startExportData() {
      exportBuffer = '';
      exportCaptureEnabled = true;
      return true;
    },

    drainExportData() {
      const value = exportBuffer;
      exportBuffer = '';
      return value;
    },

    async stopExportData() {
      exportCaptureEnabled = false;
      return true;
    },
  };
}

module.exports = {
  createNativeSerialTransport,
  normalizeRegisterAddress,
  normalizeRegisterValue,
  parseSiliconLine,
  parseCfgLines,
  resolvePortPath,
};
