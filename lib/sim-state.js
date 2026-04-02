const fs = require('node:fs');
const path = require('node:path');

const ASSERTS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'resources',
  'extracted',
  'node_modues',
  'vsm-client-backend',
  'controllers',
  'lib',
  'asserts',
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRegister(register) {
  const value = String(register || '').trim().toLowerCase().replace(/^0x/, '');
  if (!value) {
    throw new Error('Register address is required');
  }
  return `0x${value.padStart(4, '0')}`;
}

function normalizeValue(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  if (!normalized) {
    throw new Error('Register value is required');
  }
  return `0x${normalized.padStart(4, '0')}`;
}

function parseCfgContent(fileContent) {
  const content = String(fileContent || '');
  if (!content.trim()) {
    throw new Error('Empty dcfg file!');
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('/'))
    .map((line) => {
      const [register, value] = line.split(/[ \t]+/);
      if (!register || !value) {
        throw new Error(`Invalid dcfg line: ${line}`);
      }
      return [normalizeRegister(register), normalizeValue(value)];
    });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createSimState() {
  let device = '';
  let simRegisters = null;
  let defaultRegisters = null;

  function ensureLoaded() {
    if (!simRegisters) {
      throw new Error('No simulation device selected');
    }
  }

  return {
    async selectDevice(nextDevice) {
      if (!nextDevice) {
        throw new Error('Device is required');
      }

      const registerPath = path.join(ASSERTS_DIR, `${nextDevice}_simulation_registers.json`);
      const registers = readJson(registerPath);

      device = String(nextDevice);
      simRegisters = clone(registers);
      defaultRegisters = clone(registers);
      return true;
    },

    async loadCfgContent(fileContent) {
      ensureLoaded();
      for (const [register, value] of parseCfgContent(fileContent)) {
        simRegisters[register] = value;
      }
      return 'success';
    },

    async readRegister(register) {
      ensureLoaded();
      const normalized = normalizeRegister(register);
      if (!(normalized in simRegisters)) {
        throw new Error('No such register in simulation environment');
      }
      return simRegisters[normalized].replace(/^0x/, '');
    },

    async writeRegister(register, value) {
      ensureLoaded();
      const normalizedRegister = normalizeRegister(register);
      simRegisters[normalizedRegister] = normalizeValue(value);
      return `${normalizedRegister} ${simRegisters[normalizedRegister]}`;
    },

    async reset() {
      ensureLoaded();
      simRegisters = clone(defaultRegisters);
      return true;
    },

    getDevice() {
      return device;
    },
  };
}

module.exports = {
  createSimState,
};
