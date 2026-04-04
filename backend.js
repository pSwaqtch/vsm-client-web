const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { createSimState } = require('./lib/sim-state.js');
const { createNativeSerialTransport } = require('./lib/native-serial.js');

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

function createEmptyPlotPayload() {
  return {
    ecg: { data: [], ecgStatus: '' },
    ecg_filter: { data: [], ecgStatus: '' },
    ecg_python: { data: [] },
    ppg: { data: [] },
    ppg_filter: { data: [] },
    ppg_spo2: { data: [] },
    ppg_test: { data: [] },
    ppg_python: { data: [] },
    ppg_imu_a: { data: [] },
    ppg_imu_g: { data: [] },
    ppg_hrm: { data: [] },
    bioz_mag: { data: [] },
    bioz_phase: { data: [] },
    bioz_ci1: { data: [] },
    bioz_ci2: { data: [] },
    bioz_ci3: { data: [] },
    bioz_ci4: { data: [] },
    eda_mag: { data: [] },
    eda_phase: { data: [] },
  };
}

function createSyntheticPpgPayload(slotList = [], startTick = 0, pointCount = 96) {
  const payload = createEmptyPlotPayload();
  const slots = Array.isArray(slotList) && slotList.length ? slotList : ['slotA-Channel1'];
  const ppgData = [];
  const ppgFilterData = [];
  const hrmData = [];

  for (let index = 0; index < pointCount; index += 1) {
    const ts = startTick + index;
    const point = { ts };
    const filteredPoint = { ts };

    slots.forEach((slotName, slotIndex) => {
      const phase = (ts + slotIndex * 16) / 12;
      const value = Math.round(2200 + Math.sin(phase) * 700 + Math.sin(phase / 3) * 120);
      const filteredValue = Math.round(2200 + Math.sin(phase) * 520);
      point[slotName] = value;
      filteredPoint[slotName] = filteredValue;
    });

    ppgData.push(point);
    ppgFilterData.push(filteredPoint);
  }

  for (let index = 0; index < Math.max(1, Math.floor(pointCount / 12)); index += 1) {
    hrmData.push({
      ts: startTick + index * 12,
      'slotA-Channel1': 72,
    });
  }

  payload.ppg.data = ppgData;
  payload.ppg_filter.data = ppgFilterData;
  payload.ppg_hrm.data = hrmData;
  return payload;
}

function parseHardwarePpgPayload(rawData, slotList = [], sillicon = '7000') {
  const payload = createEmptyPlotPayload();
  const slots = Array.isArray(slotList) && slotList.length ? slotList : ['slotA-Channel1'];
  const base = sillicon === '4200' ? 10 : 16;
  const lines = String(rawData || '')
    .split('\r')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = /^\[(\d+)\]\s*(.*)$/i.exec(line);
    if (!match) {
      continue;
    }

    const ts = parseInt(match[1], 10);
    const remainder = match[2].trim();
    if (!remainder) {
      continue;
    }

    if (remainder.toLowerCase().startsWith('bpm:')) {
      payload.ppg_hrm.data.push({
        ts,
        'slotA-Channel1': parseInt(remainder.slice(4).trim(), 10),
      });
      continue;
    }

    if (remainder.toLowerCase().startsWith('imu:')) {
      continue;
    }

    const fifoContent = remainder;
    const ppgSection = fifoContent.includes('@') ? fifoContent.split('@')[1] : fifoContent.trim();
    if (!ppgSection || ppgSection.includes('ffffffff')) {
      continue;
    }

    const [ppgValuesRaw, spo2Raw] = ppgSection.split('*');
    const values = ppgValuesRaw.split(',').map((value) => value.trim()).filter(Boolean);
    const point = { ts };
    const filteredPoint = { ts };

    slots.forEach((slotName, index) => {
      if (!values[index]) {
        return;
      }
      const sample = parseInt(values[index], base);
      if (Number.isNaN(sample)) {
        return;
      }
      point[slotName] = sample;
      filteredPoint[slotName] = sample;
    });

    if (Object.keys(point).length > 1) {
      payload.ppg.data.push(point);
      payload.ppg_filter.data.push(filteredPoint);
    }

    if (spo2Raw) {
      const spo2Values = spo2Raw.split(',').map((value) => value.trim()).filter(Boolean);
      if (spo2Values.length >= 3) {
        payload.ppg_spo2.data.push({
          ts,
          hrm: parseFloat(spo2Values[0]),
          rate: parseFloat(spo2Values[1]),
          spo2: parseFloat(spo2Values[2]),
          dc1: spo2Values[3] ? parseFloat(spo2Values[3]) : 0,
          dc2: spo2Values[4] ? parseFloat(spo2Values[4]) : 0,
        });
      }
    }
  }

  return payload;
}

function timestampSuffix() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

function parsePpgExportArtifacts(rawData, options = {}) {
  const {
    sillicon = '7000',
    ppgSlotList = [],
    imuEnable = false,
    spo2Enable = false,
  } = options;
  const base = sillicon === '4200' ? 10 : 16;
  const slotNames = Array.isArray(ppgSlotList) && ppgSlotList.length ? ppgSlotList : ['slotA-Channel1'];
  const mainRows = [];
  const imuRows = [];
  const hrmRows = [];
  const lines = String(rawData || '')
    .split('\r')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = /^\[(\d+)\]\s*(.*)$/i.exec(line);
    if (!match) {
      continue;
    }
    const ts = parseInt(match[1], 10);
    const remainder = match[2].trim();
    if (!remainder) {
      continue;
    }

    if (remainder.toLowerCase().startsWith('imu:')) {
      if (imuEnable) {
        const values = remainder.slice(4).split(',').map((value) => value.trim());
        imuRows.push([ts, ...values]);
      }
      continue;
    }

    if (remainder.toLowerCase().startsWith('bpm:')) {
      hrmRows.push([ts, remainder.slice(4).trim()]);
      continue;
    }

    const ppgSection = remainder.includes('@') ? remainder.split('@')[1] : remainder;
    if (!ppgSection || ppgSection.includes('ffffffff')) {
      continue;
    }

    const [ppgValuesRaw, spo2Raw] = ppgSection.split('*');
    const values = ppgValuesRaw.split(',').map((value) => value.trim()).filter(Boolean);
    const row = [ts];

    for (let index = 0; index < slotNames.length; index += 1) {
      const sample = values[index] ? parseInt(values[index], base) : '';
      row.push(Number.isNaN(sample) ? '' : sample);
    }

    if (spo2Enable) {
      const spo2Values = spo2Raw ? spo2Raw.split(',').map((value) => value.trim()) : [];
      row.push(
        spo2Values[0] ?? '',
        spo2Values[1] ?? '',
        spo2Values[2] ?? '',
        spo2Values[3] ?? '',
        spo2Values[4] ?? '',
      );
    }

    mainRows.push(row);
  }

  return {
    mainHeaders: ['timestamp', ...slotNames, ...(spo2Enable ? ['HRM', 'Rate', 'Spo2', 'DC1', 'DC2'] : [])],
    mainRows,
    imuHeaders: ['timestamp', 'ax', 'ay', 'az', 'gx', 'gy', 'gz'],
    imuRows,
    hrmHeaders: ['timestamp', 'HRM'],
    hrmRows,
  };
}

function writePpgExportArtifacts(artifacts, options = {}) {
  const {
    exportDir,
    sillicon = '7000',
  } = options;
  fs.mkdirSync(exportDir, { recursive: true });
  const suffix = timestampSuffix();
  const outputPaths = [];

  if (artifacts.mainRows.length > 0) {
    const mainPath = path.join(exportDir, `anonymous_${sillicon}_ppg_${suffix}.csv`);
    fs.writeFileSync(mainPath, toCsv(artifacts.mainHeaders, artifacts.mainRows), 'utf8');
    outputPaths.push(path.resolve(mainPath));
  }

  if (artifacts.imuRows.length > 0) {
    const imuPath = path.join(exportDir, `anonymous_${sillicon}_ppg_imu_${suffix}.csv`);
    fs.writeFileSync(imuPath, toCsv(artifacts.imuHeaders, artifacts.imuRows), 'utf8');
    outputPaths.push(path.resolve(imuPath));
  }

  if (artifacts.mainRows.length === 0 && artifacts.hrmRows.length > 0) {
    const hrmPath = path.join(exportDir, `anonymous_${sillicon}_hrm_${suffix}.csv`);
    fs.writeFileSync(hrmPath, toCsv(artifacts.hrmHeaders, artifacts.hrmRows), 'utf8');
    outputPaths.push(path.resolve(hrmPath));
  }

  return outputPaths;
}

function addRegisterAddress(target, field) {
  if (!field || !field.Address) {
    return;
  }
  target.add(String(field.Address));
  if (field.AddressAnd) {
    target.add(String(field.AddressAnd));
  }
}

function pushCommandLogEntry(target, action, commands, source = 'preview') {
  target.unshift({
    source,
    action,
    commands,
    timestamp: new Date().toISOString(),
  });
  if (target.length > 200) {
    target.length = 200;
  }
}

function normalizeRegisterAddress(address) {
  return `0x${String(address || '').trim().replace(/^0x/i, '').toLowerCase().padStart(4, '0')}`;
}

function createBackendHandler(options = {}) {
  const simState = createSimState();
  const transport = options.transport || createNativeSerialTransport();
  const DEFAULT_DEVICE = '7000';
  const previewCfgByPath = new Map();
  const hardwareCommandLog = [];
  const debugState = {
    cachedPreviewPaths: [],
    lastPreviewStore: null,
    lastLoadCfg: null,
    lastError: null,
  };
  let lastPreviewCfg = null;
  let plotActive = false;
  let exportActive = false;
  let plotTick = 0;

  function refreshCachedPreviewPaths() {
    debugState.cachedPreviewPaths = Array.from(previewCfgByPath.keys());
  }

  async function ensureSelectedDevice() {
    if (!simState.getDevice()) {
      await simState.selectDevice(DEFAULT_DEVICE);
    }
  }

  function shouldUseHardware(args) {
    const normalized = normalizeArgs(args);
    return normalized.sim !== true && transport.isOpen();
  }

  async function syncRegistersFromHardware(addresses) {
    const uniqueAddresses = [...new Set((addresses || []).map((value) => String(value).trim()).filter(Boolean))];
    for (const address of uniqueAddresses) {
      const registerValue = await transport.readRegister(address);
      await simState.writeRegister(address, `0x${registerValue}`);
    }
    return uniqueAddresses.map((address) => `reg_read ${normalizeRegisterAddress(address)}`);
  }

  function getPpgPopulateRegisterAddresses(kind, args) {
    const mapping = simState.getMapping();
    const normalized = normalizeArgs(args);
    const slot = normalized.slot || normalized.slotName || 'A';
    const type = normalized.type || 'ppg';
    const sampleSlot = normalized.slot || 'NA';
    const addresses = new Set();

    switch (kind) {
      case 'readSampleRate': {
        const sampleField = mapping[`${type}_slot${sampleSlot}_sample_rate`];
        for (const part of sampleField['Sample Bits'] || []) {
          addRegisterAddress(addresses, part.Attribute);
        }
        break;
      }
      case 'readSlotEnable':
        addRegisterAddress(addresses, mapping[`${type}_timeslot_en`]);
        break;
      case 'readPPGAFETrimVref':
        addRegisterAddress(addresses, mapping[`${slot}`] && mapping[`${slot}`].afe_trim_vref);
        break;
      case 'readPPGAmbientCancellation':
        addRegisterAddress(addresses, mapping[`${slot}`] && mapping[`${slot}`].ambient_cancellation);
        break;
      case 'readDecimateFactor':
        addRegisterAddress(addresses, mapping[`${slot}`] && mapping[`${slot}`]['Decimate Factor']);
        break;
      case 'readCHEnable':
        addRegisterAddress(addresses, mapping[`${slot}`] && mapping[`${slot}`].channel_en_x);
        break;
      case 'readTIAGain':
        for (const channel of (mapping[`${slot}`] && mapping[`${slot}`]['Channel Control']) || []) {
          addRegisterAddress(addresses, channel.Attribute['TIA gain']);
        }
        break;
      case 'readDACLEDDC':
        for (const channel of (mapping[`${slot}`] && mapping[`${slot}`]['Channel Control']) || []) {
          addRegisterAddress(addresses, channel.Attribute.dac_led_dc);
        }
        break;
      case 'readOperationMode':
        addRegisterAddress(addresses, mapping[`${slot}`] && mapping[`${slot}`]['Slot Control']);
        break;
      case 'readLedType':
      case 'readLedCurrent':
        for (const led of (mapping[`${slot}`] && mapping[`${slot}`]['LED Control']) || []) {
          addRegisterAddress(addresses, led.Attribute.Enable);
          addRegisterAddress(addresses, led.Attribute.Current);
        }
        break;
      case 'populateDIMode':
        for (const field of Object.values((mapping[`${slot}`] && mapping[`${slot}`]['Timming Control']) || {})) {
          addRegisterAddress(addresses, field);
        }
        break;
      default:
        break;
    }

    return [...addresses];
  }

  async function syncPpgPopulateRoute(kind, args) {
    if (!shouldUseHardware(args)) {
      return;
    }
    const commands = await syncRegistersFromHardware(getPpgPopulateRegisterAddresses(kind, args));
    if (commands.length > 0) {
      pushCommandLogEntry(hardwareCommandLog, `${kind} [hardware]`, commands, 'hardware');
    }
  }

  async function replayLatestPreviewCommands(beforeCount) {
    if (!transport.isOpen() || typeof transport.executeCommands !== 'function') {
      return;
    }
    if (simState.getPreviewCommandCount() <= beforeCount) {
      return;
    }
    const latest = simState.getLatestPreviewCommand();
    if (latest && Array.isArray(latest.commands) && latest.commands.length > 0) {
      await transport.executeCommands(latest.commands);
      pushCommandLogEntry(hardwareCommandLog, latest.action, latest.commands, 'hardware');
    }
  }

  async function runSimWriteWithHardwareReplay(args, writer) {
    const beforeCount = simState.getPreviewCommandCount();
    const result = await writer();
    if (shouldUseHardware(args)) {
      await replayLatestPreviewCommands(beforeCount);
    }
    return result;
  }

  async function syncSelectedDeviceFromHardware() {
    const sillicon = await transport.getSillicon();
    await simState.selectDevice(sillicon);
    return sillicon;
  }

  return {
    async selectDevice(args) {
      const { device = DEFAULT_DEVICE } = normalizeArgs(args);
      return simState.selectDevice(device);
    },

    async reset() {
      await ensureSelectedDevice();
      if (shouldUseHardware()) {
        const result = await transport.reset();
        await simState.reset();
        return result;
      }
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
        if (shouldUseHardware(args)) {
          await transport.loadCfgContent(fileContent);
        }
        return simState.loadCfgContent(fileContent);
      }
      if (filePath && previewCfgByPath.has(filePath)) {
        const cachedContent = previewCfgByPath.get(filePath).fileContent;
        if (shouldUseHardware(args)) {
          await transport.loadCfgContent(cachedContent);
        }
        return simState.loadCfgContent(cachedContent);
      }
      if (lastPreviewCfg) {
        if (shouldUseHardware(args)) {
          await transport.loadCfgContent(lastPreviewCfg.fileContent);
        }
        return simState.loadCfgContent(lastPreviewCfg.fileContent);
      }
      if (filePath) {
        const diskContent = fs.readFileSync(filePath, 'utf8');
        if (shouldUseHardware(args)) {
          await transport.loadCfgContent(diskContent);
        }
        return simState.loadCfgContent(diskContent);
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
      if (shouldUseHardware(args)) {
        return transport.readRegister(value);
      }
      return simState.readRegister(value);
    },

    async writeRegister(args) {
      await ensureSelectedDevice();
      const { value } = normalizeArgs(args);
      if (shouldUseHardware(args)) {
        const result = await transport.writeRegister(value);
        await simState.writeRegisterValue(value);
        return result;
      }
      return simState.writeRegisterValue(value);
    },

    async readSampleRate(args) {
      await ensureSelectedDevice();
      const { type, sillicon = simState.getDevice() || DEFAULT_DEVICE, slot = 'NA' } = normalizeArgs(args);
      await syncPpgPopulateRoute('readSampleRate', args);
      return simState.readSampleRate(type, sillicon, slot);
    },

    async readSlotEnable(args) {
      await ensureSelectedDevice();
      const { type } = normalizeArgs(args);
      await syncPpgPopulateRoute('readSlotEnable', args);
      return simState.readSlotEnable(type);
    },

    async readPPGAFETrimVref(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readPPGAFETrimVref', args);
      return simState.readPPGAFETrimVref(slot);
    },

    async readPPGAmbientCancellation(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readPPGAmbientCancellation', args);
      return simState.readPPGAmbientCancellation(slot);
    },

    async readDecimateFactor(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readDecimateFactor', args);
      return simState.readDecimateFactor(slot);
    },

    async readCHEnable(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readCHEnable', args);
      return simState.readCHEnable(slot);
    },

    async readTIAGain(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readTIAGain', args);
      return simState.readTIAGain(slot);
    },

    async readDACLEDDC(args) {
      await ensureSelectedDevice();
      const { slot, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      await syncPpgPopulateRoute('readDACLEDDC', args);
      return simState.readDACLEDDC(slot, sillicon);
    },

    async readOperationMode(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readOperationMode', args);
      return simState.readOperationMode(slot);
    },

    async readLedType(args) {
      await ensureSelectedDevice();
      const { slot } = normalizeArgs(args);
      await syncPpgPopulateRoute('readLedType', args);
      return simState.readLedType(slot);
    },

    async readLedCurrent(args) {
      await ensureSelectedDevice();
      const { slot, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      await syncPpgPopulateRoute('readLedCurrent', args);
      return simState.readLedCurrent(slot, sillicon);
    },

    async populateDIMode(args) {
      await ensureSelectedDevice();
      const { slotName } = normalizeArgs(args);
      await syncPpgPopulateRoute('populateDIMode', args);
      return simState.populateDIMode(slotName);
    },

    async writeSampleRate(args) {
      await ensureSelectedDevice();
      const { type, sample, sillicon = simState.getDevice() || DEFAULT_DEVICE, slot = 'NA' } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeSampleRate(type, sample, sillicon, slot));
    },

    async writeSampleRateLoop(args) {
      await ensureSelectedDevice();
      const { type, sample, sillicon = simState.getDevice() || DEFAULT_DEVICE, slotList = [] } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeSampleRateLoop(type, sample, sillicon, slotList));
    },

    async writeSlotEnable(args) {
      await ensureSelectedDevice();
      const { slots, type } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeSlotEnable(slots, type));
    },

    async writeCHEnable(args) {
      await ensureSelectedDevice();
      const { slot, channelName } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeCHEnable(slot, channelName));
    },

    async writeTIAGain(args) {
      await ensureSelectedDevice();
      const { slot, channelName, resistanceValue } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeTIAGain(slot, channelName, resistanceValue));
    },

    async writeDACLEDDC(args) {
      await ensureSelectedDevice();
      const { slot, chName, dacValue, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeDACLEDDC(slot, chName, dacValue, sillicon));
    },

    async writeOperationMode(args) {
      await ensureSelectedDevice();
      const { slot, type } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeOperationMode(slot, type));
    },

    async writeLedType(args) {
      await ensureSelectedDevice();
      const { slot, ledType, status } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeLedType(slot, ledType, status));
    },

    async writeLedCurrent(args) {
      await ensureSelectedDevice();
      const { slot, ledType, currentValue, sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeLedCurrent(slot, ledType, currentValue, sillicon));
    },

    async writePulse(args) {
      await ensureSelectedDevice();
      const { slot, pulseValue, type } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writePulse(slot, pulseValue, type));
    },

    async writeDecimateFactor(args) {
      await ensureSelectedDevice();
      const { slot, decimateFactorValue } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.writeDecimateFactor(slot, decimateFactorValue));
    },

    async writeSimRegister2Hardware(args) {
      await ensureSelectedDevice();
      if (shouldUseHardware(args) && typeof transport.loadCfgContent === 'function') {
        await transport.loadCfgContent(simState.serializeCfgContent());
      }
      return simState.writeSimRegister2Hardware();
    },

    async AGCOnOff(args) {
      const { status } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.AGCOnOff(status));
    },

    async AGCSample(args) {
      const { average, skip } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.AGCSample(average, skip));
    },

    async AGCSlotOnOff(args) {
      const { slotNumber, data, status } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.AGCSlotOnOff(slotNumber, data, status));
    },

    async AGCSlotLED(args) {
      const { slotNumber, data, led } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.AGCSlotLED(slotNumber, data, led));
    },

    async AGCSlotChannel(args) {
      const { slotNumber, data, channel } = normalizeArgs(args);
      return runSimWriteWithHardwareReplay(args, () => simState.AGCSlotChannel(slotNumber, data, channel));
    },

    async exportCfg(args) {
      await ensureSelectedDevice();
      const { type = [], sillicon = simState.getDevice() || DEFAULT_DEVICE, otherRegisters = [] } = normalizeArgs(args);
      if (shouldUseHardware(args)) {
        await syncRegistersFromHardware(simState.getRegisterAddresses());
      }
      const filePath = simState.exportCfgFile(type, sillicon, otherRegisters);
      return `Success to write dcfg file in ${path.resolve(filePath)}`;
    },

    async startPlot(args) {
      const { value = true } = normalizeArgs(args);
      plotActive = true;
      plotTick = 0;
      if (shouldUseHardware(args) && typeof transport.startPlot === 'function') {
        await transport.startPlot(value);
      }
      return value;
    },

    async startPlotReceive(args) {
      const { type = [], slotList = [], sillicon = simState.getDevice() || DEFAULT_DEVICE } = normalizeArgs(args);
      if (!plotActive) {
        return createEmptyPlotPayload();
      }
      if (Array.isArray(type) && type.includes('ppg')) {
        if (shouldUseHardware(args) && typeof transport.drainPlotData === 'function') {
          const rawData = transport.drainPlotData();
          const payload = parseHardwarePpgPayload(rawData, slotList, sillicon);
          if (payload.ppg.data.length > 0 || payload.ppg_hrm.data.length > 0 || payload.ppg_spo2.data.length > 0) {
            return payload;
          }
        }
        const payload = createSyntheticPpgPayload(slotList, plotTick);
        plotTick += payload.ppg.data.length;
        return payload;
      }
      return createEmptyPlotPayload();
    },

    async stopPlot(args) {
      plotActive = false;
      plotTick = 0;
      const { args: command = 'app_stop' } = normalizeArgs(args);
      if (shouldUseHardware(args) && typeof transport.stopPlot === 'function') {
        await transport.stopPlot(command);
      }
      return true;
    },

    async startExportData(args) {
      exportActive = true;
      if (shouldUseHardware(args) && typeof transport.startExportData === 'function') {
        await transport.startExportData();
      }
      return 'Success to start export data.';
    },

    async stopExportData(args) {
      exportActive = false;
      if (shouldUseHardware(args) && typeof transport.stopExportData === 'function') {
        const normalized = normalizeArgs(args);
        const rawData = typeof transport.drainExportData === 'function' ? transport.drainExportData() : '';
        await transport.stopExportData();
        const deviceTypes = normalized.deviceType || [];
        if (!String(rawData || '').trim()) {
          throw new Error('Fail to export data!');
        }
        if (!Array.isArray(deviceTypes) || !deviceTypes.includes('ppg')) {
          throw new Error('Export is only implemented for PPG in mac-preview');
        }

        const artifacts = parsePpgExportArtifacts(rawData, normalized);
        const outputPaths = writePpgExportArtifacts(artifacts, {
          exportDir: path.join(__dirname, 'exports'),
          sillicon: normalized.sillicon || simState.getDevice() || DEFAULT_DEVICE,
        });
        if (outputPaths.length === 0) {
          throw new Error('Fail to export data!');
        }
        return `Success to export data in\r\n${outputPaths.join('\r\n')}`;
      }
      return [];
    },

    async ppgFullScale(args) {
      const { data, storeList = [], selectedSlotList = [] } = normalizeArgs(args);
      let constant = 16384 - 8192;
      if (!data) {
        throw new Error('Fail to get data');
      }

      const filteredStoreList = [];
      const scaleList = [];
      for (const storeItem of storeList) {
        for (const selectedSlot of selectedSlotList) {
          if (selectedSlot === storeItem.slotName) {
            filteredStoreList.push(storeItem);
          }
        }
      }

      for (const storeItem of filteredStoreList) {
        if (storeItem.storeName.slot_afe_trim_vref === '11') {
          constant = 16384 - 3300;
        }
        let scaleConstant = constant * storeItem.storeName.slot_num_int_x * storeItem.storeName.slot_num_repeat_x;
        if (storeItem.storeName.slot_ambient_cancellation === '01') {
          scaleConstant += 8192;
        }

        for (const key of Object.keys(data)) {
          if (key !== storeItem.slotName) {
            continue;
          }
          scaleList.push({
            slotName: storeItem.slotName,
            scale: (
              storeItem.storeName.slot_operation_mode === 'two'
                ? (data[storeItem.slotName] / (scaleConstant * 2)) * 100
                : (data[storeItem.slotName] / scaleConstant) * 100
            ).toFixed(1),
          });
        }
      }

      return scaleList;
    },

    async ppgSmoothProcess(args) {
      const { data = [], count = [], ppgSlotList = [] } = normalizeArgs(args);
      const temp = [];
      let slotAverage = 0;
      let sum = 0;

      for (let slotIndex = 0; slotIndex < ppgSlotList.length; slotIndex += 1) {
        for (let pointIndex = 0; pointIndex < count.length; pointIndex += 1) {
          slotAverage += Object.values(data[count[pointIndex] - 1])[slotIndex + 1] * count[pointIndex];
          sum += count[pointIndex];
        }
        slotAverage /= sum;
        temp.push(slotAverage);
        sum = 0;
        slotAverage = 0;
      }

      for (let slotIndex = 0; slotIndex < ppgSlotList.length; slotIndex += 1) {
        for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
          data[rowIndex][ppgSlotList[slotIndex]] = temp[slotIndex];
        }
      }

      if (data === '' || data === undefined) {
        throw new Error('error!');
      }
      return { data };
    },

    async previewCommandLog() {
      return [...hardwareCommandLog, ...simState.getPreviewCommandLog()]
        .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
    },

    async getVersion() {
      if (transport.isOpen()) {
        return transport.getVersion();
      }
      return 'preview';
    },

    async getBoard() {
      if (transport.isOpen()) {
        return transport.getBoard();
      }
      return 'preview-board';
    },

    async getSillicon() {
      if (transport.isOpen()) {
        return syncSelectedDeviceFromHardware();
      }
      return simState.getDevice() || DEFAULT_DEVICE;
    },

    async list() {
      return transport.list();
    },

    async init(args) {
      const { port } = normalizeArgs(args);
      return transport.init(port);
    },

    async open() {
      const result = await transport.open();
      await syncSelectedDeviceFromHardware().catch(() => ensureSelectedDevice());
      return result;
    },

    async close() {
      return transport.close();
    },

    async connectionStatusCheck() {
      return transport.connectionStatusCheck();
    },

    async fileExists() {
      return false;
    },

    async debugPreviewState() {
      return JSON.parse(JSON.stringify({
        ...debugState,
        plotActive,
        exportActive,
      }));
    },

    setLastError(error) {
      debugState.lastError = error;
    },
  };
}

function createBackendServer(port = 2880) {
  const handler = createBackendHandler();
  const routes = {
    '/target/init': (body) => handler.init(body),
    '/target/open': (body) => handler.open(body),
    '/target/close': (body) => handler.close(body),
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
    '/target/startPlot': (body) => handler.startPlot(body),
    '/target/startPlotReceive': (body) => handler.startPlotReceive(body),
    '/target/stopPlot': (body) => handler.stopPlot(body),
    '/target/startExportData': (body) => handler.startExportData(body),
    '/target/stopExportData': (body) => handler.stopExportData(body),
    '/target/ppgFullScale': (body) => handler.ppgFullScale(body),
    '/target/ppgSmoothProcess': (body) => handler.ppgSmoothProcess(body),
    '/target/previewCommandLog': () => handler.previewCommandLog(),
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
