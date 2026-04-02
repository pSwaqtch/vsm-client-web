const fs = require('node:fs');
const path = require('node:path');

const Constants = require('../../resources/extracted/node_modues/vsm-client-backend/controllers/lib/constants.js');

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

function hex2bin(hex, bitNumber) {
  return parseInt(String(hex).replace(/^0x/i, ''), 16).toString(2).padStart(bitNumber, '0');
}

function bin2dec(bin) {
  return parseInt(bin, 2);
}

function bitPosition2NumberPosition(bitLength, bitPosition) {
  return bitLength - bitPosition;
}

function getSpecificBitsfromHex(hex, startBit, endBit) {
  return hex2bin(hex, 16).slice(
    bitPosition2NumberPosition(15, endBit),
    bitPosition2NumberPosition(15, startBit) + 1,
  );
}

function replacePartOfString(targetString, length, startBit, endBit, replacePart) {
  return (
    targetString.substring(0, bitPosition2NumberPosition(length, endBit)) +
    replacePart +
    targetString.substring(bitPosition2NumberPosition(length, startBit) + 1)
  );
}

function createSimState() {
  let device = '';
  let simRegisters = null;
  let defaultRegisters = null;
  let mapping = null;

  function ensureLoaded() {
    if (!simRegisters || !mapping) {
      throw new Error('No simulation device selected');
    }
  }

  function getRegisterValue(register) {
    ensureLoaded();
    const normalized = normalizeRegister(register);
    if (!(normalized in simRegisters)) {
      throw new Error('No such register in simulation environment');
    }
    return simRegisters[normalized].replace(/^0x/, '');
  }

  function getFieldBits(field) {
    return getSpecificBitsfromHex(getRegisterValue(field.Address), field.StartBit, field.EndBit);
  }

  function readMappedOption(field) {
    const bit = getFieldBits(field);
    const option = (field.Options || []).find((entry) => entry.key === bit);
    if (!option) {
      throw new Error(`No option maps for ${field.Address}[${field.StartBit}:${field.EndBit}]`);
    }
    return option.value;
  }

  function readPulse(slot, name) {
    const field = mapping[`${slot}`]['Timming Control'][name];
    return bin2dec(getFieldBits(field));
  }

  return {
    async selectDevice(nextDevice) {
      if (!nextDevice) {
        throw new Error('Device is required');
      }

      const registerPath = path.join(ASSERTS_DIR, `${nextDevice}_simulation_registers.json`);
      const mappingPath = path.join(ASSERTS_DIR, `${nextDevice}_registers_map.json`);
      const registers = readJson(registerPath);

      device = String(nextDevice);
      simRegisters = clone(registers);
      defaultRegisters = clone(registers);
      mapping = readJson(mappingPath);
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
      return getRegisterValue(register);
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

    async readSampleRate(type, sillicon, slot = 'NA') {
      ensureLoaded();
      const sampleField = mapping[`${type}_slot${slot}_sample_rate`];
      if (!sampleField) {
        throw new Error(`Sample rate mapping not found for ${type} slot ${slot}`);
      }

      let binary = '0'.repeat(sampleField.Length);
      for (const part of sampleField['Sample Bits']) {
        const attribute = part.Attribute;
        binary = replacePartOfString(
          binary,
          sampleField.Length - 1,
          attribute.StartBitStored,
          attribute.EndBitStored,
          getSpecificBitsfromHex(getRegisterValue(attribute.Address), attribute.StartBit, attribute.EndBit),
        );
      }

      const dec = bin2dec(binary);
      if (type === 'ppg') {
        return Constants.defaultHZ[sillicon] / dec;
      }
      if (type === 'bioz') {
        return slot === 'NA'
          ? Constants.defaultHZ[sillicon] / dec
          : Math.round(dec / Constants.biozSampleArg, 10);
      }
      if (type === 'eda') {
        return slot === 'NA'
          ? Constants.defaultHZ[sillicon] / dec
          : Math.round(dec / Constants.edaSampleArg, 10);
      }

      throw new Error(`Unsupported sample rate type: ${type}`);
    },

    async readSlotEnable(type) {
      ensureLoaded();
      const field = mapping[`${type}_timeslot_en`];
      const value = readMappedOption(field);
      return String(value || '').split('').filter(Boolean);
    },

    async readPPGAFETrimVref(slot) {
      ensureLoaded();
      try {
        return getFieldBits(mapping[`${slot}`].afe_trim_vref);
      } catch (error) {
        return '00';
      }
    },

    async readPPGAmbientCancellation(slot) {
      ensureLoaded();
      try {
        return getFieldBits(mapping[`${slot}`].ambient_cancellation);
      } catch (error) {
        return '00';
      }
    },

    async readDecimateFactor(slot) {
      ensureLoaded();
      return bin2dec(getFieldBits(mapping[`${slot}`]['Decimate Factor']));
    },

    async readCHEnable(slot) {
      ensureLoaded();
      const value = readMappedOption(mapping[`${slot}`].channel_en_x);
      return String(value).split(',');
    },

    async readTIAGain(slot) {
      ensureLoaded();
      return mapping[`${slot}`]['Channel Control'].map((channel) => {
        const tiaField = channel.Attribute['TIA gain'];
        const bit = getFieldBits(tiaField);
        const option = (tiaField.Options || []).find((entry) => entry.key === bit);
        return {
          channelName: channel.Name,
          optionValue: option ? option.value : 0,
        };
      });
    },

    async readDACLEDDC(slot, sillicon) {
      ensureLoaded();
      return mapping[`${slot}`]['Channel Control'].map((channel) => ({
        channelName: channel.Name,
        optionValue: bin2dec(getFieldBits(channel.Attribute.dac_led_dc)) * Constants.ppgDACStep[sillicon],
      }));
    },

    async readOperationMode(slot) {
      ensureLoaded();
      return readMappedOption(mapping[`${slot}`]['Slot Control']);
    },

    async readLedType(slot) {
      ensureLoaded();
      const ledList = [];
      for (const led of mapping[`${slot}`]['LED Control']) {
        const enableField = led.Attribute.Enable;
        const enableBits = getFieldBits(enableField);
        if (enableBits !== enableField.Options[0].key) {
          continue;
        }

        const currentBits = getSpecificBitsfromHex(
          getRegisterValue(enableField.AddressAnd),
          enableField.StartBitAnd,
          enableField.EndBitAnd,
        );
        if (currentBits !== enableField.OptionsAnd[0].key) {
          ledList.push(led.Name);
        }
      }
      return ledList;
    },

    async readLedCurrent(slot, sillicon) {
      ensureLoaded();
      const ledTypes = await this.readLedType(slot);
      const ledCurrentList = [];

      for (const led of mapping[`${slot}`]['LED Control']) {
        if (!ledTypes.includes(led.Name)) {
          continue;
        }
        const dec = bin2dec(getFieldBits(led.Attribute.Current));
        ledCurrentList.push({
          ledName: led.Name,
          optionValue: ((dec - 1) * Constants.ledCurrentStep[sillicon] + Constants.minLedCurrentValue[sillicon]).toFixed(3),
        });
      }

      return ledCurrentList;
    },

    async populateDIMode(slotName) {
      ensureLoaded();
      return Constants.DIRegisters.map((register) => readPulse(slotName, register.name));
    },

    getDevice() {
      return device;
    },
  };
}

module.exports = {
  createSimState,
};
