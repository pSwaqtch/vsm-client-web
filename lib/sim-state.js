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

function bin2hex(bin, bitNumber) {
  return parseInt(bin, 2).toString(16).toLowerCase().padStart(bitNumber, '0');
}

function bin2dec(bin) {
  return parseInt(bin, 2);
}

function dec2bin(dec, bitNumber) {
  return parseInt(dec, 10).toString(2).padStart(bitNumber, '0');
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
  let agcEnabled = false;
  let agcAverage = 0;
  let agcSkip = 0;
  const agcSlotCfg = new Map();
  const previewCommandLog = [];

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

  function pushPreviewCommand(action, commands) {
    previewCommandLog.unshift({
      action,
      commands,
      timestamp: new Date().toISOString(),
    });
    if (previewCommandLog.length > 200) {
      previewCommandLog.length = 200;
    }
  }

  function setRegisterHex(register, hexValue) {
    const normalizedRegister = normalizeRegister(register);
    simRegisters[normalizedRegister] = normalizeValue(hexValue);
    return simRegisters[normalizedRegister];
  }

  function setFieldBits(field, bits) {
    const registerValue = getRegisterValue(field.Address);
    const width = field.EndBit - field.StartBit + 1;
    if (bits.length !== width) {
      throw new Error(`Expected ${width} bits for ${field.Address}, got ${bits.length}`);
    }
    const binary = replacePartOfString(hex2bin(registerValue, 16), 15, field.StartBit, field.EndBit, bits);
    return setRegisterHex(field.Address, `0x${bin2hex(binary, 4)}`);
  }

  function updateFieldWithCommands(field, bits) {
    const normalizedAddress = normalizeRegister(field.Address);
    const currentValue = normalizeValue(getRegisterValue(normalizedAddress));
    const width = field.EndBit - field.StartBit + 1;
    if (bits.length !== width) {
      throw new Error(`Expected ${width} bits for ${field.Address}, got ${bits.length}`);
    }
    const binary = replacePartOfString(
      hex2bin(currentValue, 16),
      15,
      field.StartBit,
      field.EndBit,
      bits,
    );
    const nextValue = normalizeValue(`0x${bin2hex(binary, 4)}`);
    setRegisterHex(normalizedAddress, nextValue);
    return [`reg_read ${normalizedAddress}`, `reg_write ${normalizedAddress} ${nextValue}`];
  }

  function readMappedOption(field) {
    const bit = getFieldBits(field);
    const option = (field.Options || []).find((entry) => entry.key === bit);
    if (!option) {
      throw new Error(`No option maps for ${field.Address}[${field.StartBit}:${field.EndBit}]`);
    }
    return option.value;
  }

  function getOptionKeyByValue(field, value) {
    const option = (field.Options || []).find((entry) => String(entry.value) === String(value));
    if (!option) {
      throw new Error(`No option maps for value ${value}`);
    }
    return option.key;
  }

  function readSampleField(type, sillicon, slot) {
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
      return { sampleField, dec, sampleValue: Constants.defaultHZ[sillicon] / dec };
    }
    if (type === 'bioz') {
      return {
        sampleField,
        dec,
        sampleValue: slot === 'NA'
          ? Constants.defaultHZ[sillicon] / dec
          : Math.round(dec / Constants.biozSampleArg, 10),
      };
    }
    if (type === 'eda') {
      return {
        sampleField,
        dec,
        sampleValue: slot === 'NA'
          ? Constants.defaultHZ[sillicon] / dec
          : Math.round(dec / Constants.edaSampleArg, 10),
      };
    }

    throw new Error(`Unsupported sample rate type: ${type}`);
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
      agcEnabled = false;
      agcAverage = 0;
      agcSkip = 0;
      agcSlotCfg.clear();
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
      agcEnabled = false;
      agcAverage = 0;
      agcSkip = 0;
      agcSlotCfg.clear();
      return true;
    },

    async readSampleRate(type, sillicon, slot = 'NA') {
      ensureLoaded();
      return readSampleField(type, sillicon, slot).sampleValue;
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

    async writeFieldByOptionValue(field, value) {
      ensureLoaded();
      updateFieldWithCommands(field, getOptionKeyByValue(field, value));
      return true;
    },

    async writeSampleRate(type, sample, sillicon, slot = 'NA') {
      ensureLoaded();
      if (!sample) {
        return '';
      }

      const { sampleField } = readSampleField(type, sillicon, slot);
      let dec = 0;
      if (type === 'ppg') {
        dec = Constants.defaultHZ[sillicon] / sample;
      } else if (type === 'bioz') {
        dec = slot === 'NA'
          ? Constants.defaultHZ[sillicon] / sample
          : Math.round(sample * Constants.biozSampleArg, 10);
      } else if (type === 'eda') {
        dec = slot === 'NA'
          ? Constants.defaultHZ[sillicon] / sample
          : Math.round(sample * Constants.edaSampleArg, 10);
      } else {
        throw new Error(`Unsupported sample rate type: ${type}`);
      }

      const commands = [];
      const binary = dec2bin(dec, sampleField.Length);
      for (const part of sampleField['Sample Bits']) {
        const attribute = part.Attribute;
        const replaceBits = binary.slice(
          bitPosition2NumberPosition(sampleField.Length - 1, attribute.EndBitStored),
          bitPosition2NumberPosition(sampleField.Length - 1, attribute.StartBitStored) + 1,
        );
        commands.push(...updateFieldWithCommands(attribute, replaceBits));
      }
      pushPreviewCommand(`writeSampleRate(${type}, ${sample}, ${slot})`, commands);
      return 'success';
    },

    async writeSampleRateLoop(type, sample, sillicon, slotList) {
      ensureLoaded();
      const commands = [];
      for (const slot of slotList || []) {
        const { sampleField } = readSampleField(type, sillicon, slot);
        let dec = 0;
        if (type === 'ppg') {
          dec = Constants.defaultHZ[sillicon] / sample;
        } else if (type === 'bioz') {
          dec = slot === 'NA'
            ? Constants.defaultHZ[sillicon] / sample
            : Math.round(sample * Constants.biozSampleArg, 10);
        } else if (type === 'eda') {
          dec = slot === 'NA'
            ? Constants.defaultHZ[sillicon] / sample
            : Math.round(sample * Constants.edaSampleArg, 10);
        } else {
          throw new Error(`Unsupported sample rate type: ${type}`);
        }

        const binary = dec2bin(dec, sampleField.Length);
        for (const part of sampleField['Sample Bits']) {
          const attribute = part.Attribute;
          const replaceBits = binary.slice(
            bitPosition2NumberPosition(sampleField.Length - 1, attribute.EndBitStored),
            bitPosition2NumberPosition(sampleField.Length - 1, attribute.StartBitStored) + 1,
          );
          commands.push(...updateFieldWithCommands(attribute, replaceBits));
        }
      }
      pushPreviewCommand(`writeSampleRateLoop(${type}, ${sample}, ${String(slotList || []).replace(/,/g, ', ')})`, commands);
      return 'success';
    },

    async writeSlotEnable(slots, type) {
      ensureLoaded();
      const field = mapping[`${type}_timeslot_en`];
      pushPreviewCommand(`writeSlotEnable(${type}, ${slots})`, updateFieldWithCommands(field, getOptionKeyByValue(field, slots)));
      return 'success';
    },

    async writeOperationMode(slot, type) {
      ensureLoaded();
      pushPreviewCommand(
        `writeOperationMode(${slot}, ${type})`,
        updateFieldWithCommands(mapping[`${slot}`]['Slot Control'], getOptionKeyByValue(mapping[`${slot}`]['Slot Control'], type)),
      );
      return 'success';
    },

    async writePulse(slot, pulseValue, type) {
      ensureLoaded();
      const field = mapping[`${slot}`]['Timming Control'][type];
      const width = field.EndBit - field.StartBit + 1;
      pushPreviewCommand(`writePulse(${slot}, ${type}, ${pulseValue})`, updateFieldWithCommands(field, dec2bin(pulseValue, width)));
      return 'success';
    },

    async writeDecimateFactor(slot, decimateFactorValue) {
      ensureLoaded();
      const field = mapping[`${slot}`]['Decimate Factor'];
      const width = field.EndBit - field.StartBit + 1;
      pushPreviewCommand(
        `writeDecimateFactor(${slot}, ${decimateFactorValue})`,
        updateFieldWithCommands(field, dec2bin(decimateFactorValue, width)),
      );
      return 'success';
    },

    async writeCHEnable(slot, channelName) {
      ensureLoaded();
      const field = mapping[`${slot}`].channel_en_x;
      pushPreviewCommand(
        `writeCHEnable(${slot}, ${channelName})`,
        updateFieldWithCommands(field, getOptionKeyByValue(field, channelName)),
      );
      return 'success';
    },

    async writeTIAGain(slot, channelName, resistanceValue) {
      ensureLoaded();
      const channel = mapping[`${slot}`]['Channel Control'].find((entry) => entry.Name === channelName);
      if (!channel) {
        throw new Error(`Unknown channel ${channelName}`);
      }
      const field = channel.Attribute['TIA gain'];
      pushPreviewCommand(
        `writeTIAGain(${slot}, ${channelName}, ${resistanceValue})`,
        updateFieldWithCommands(field, getOptionKeyByValue(field, resistanceValue)),
      );
      return 'success';
    },

    async writeDACLEDDC(slot, chName, dacValue, sillicon) {
      ensureLoaded();
      const channel = mapping[`${slot}`]['Channel Control'].find((entry) => entry.Name === chName);
      if (!channel) {
        throw new Error(`Unknown channel ${chName}`);
      }
      const field = channel.Attribute.dac_led_dc;
      const width = field.EndBit - field.StartBit + 1;
      pushPreviewCommand(
        `writeDACLEDDC(${slot}, ${chName}, ${dacValue})`,
        updateFieldWithCommands(field, dec2bin(Math.round(dacValue / Constants.ppgDACStep[sillicon]), width)),
      );
      return 'success';
    },

    async writeLedType(slot, ledType, status) {
      ensureLoaded();
      const led = mapping[`${slot}`]['LED Control'].find((entry) => entry.Name === ledType);
      if (!led) {
        throw new Error(`Unknown LED ${ledType}`);
      }
      const enableField = led.Attribute.Enable;
      const selectedKey = enableField.Options[0].key;
      const disabledKey = enableField.Options.find((entry) => entry.value === false).key;
      const commands = [...
        updateFieldWithCommands(enableField, status ? selectedKey : disabledKey),
      ];
      if (!status) {
        const width = enableField.EndBitAnd - enableField.StartBitAnd + 1;
        commands.push(...updateFieldWithCommands(
          {
            Address: enableField.AddressAnd,
            StartBit: enableField.StartBitAnd,
            EndBit: enableField.EndBitAnd,
          },
          dec2bin(0, width),
        ));
      }
      pushPreviewCommand(`writeLedType(${slot}, ${ledType}, ${status})`, commands);
      return 'success';
    },

    async writeLedCurrent(slot, ledType, currentValue, sillicon) {
      ensureLoaded();
      const led = mapping[`${slot}`]['LED Control'].find((entry) => entry.Name === ledType);
      if (!led) {
        throw new Error(`Unknown LED ${ledType}`);
      }
      const field = led.Attribute.Current;
      const width = field.EndBit - field.StartBit + 1;
      const dec = currentValue === 0
        ? 0
        : Math.round((currentValue - Constants.minLedCurrentValue[sillicon] + Constants.ledCurrentStep[sillicon]) / Constants.ledCurrentStep[sillicon]);
      pushPreviewCommand(
        `writeLedCurrent(${slot}, ${ledType}, ${currentValue})`,
        updateFieldWithCommands(field, dec2bin(dec, width)),
      );
      return 'success';
    },

    async writeRegisterValue(value) {
      ensureLoaded();
      const [register, nextValue] = String(value || '').trim().split(/\s+/);
      if (!register || !nextValue) {
        throw new Error('Register address and value are required');
      }
      const result = await this.writeRegister(register, nextValue);
      pushPreviewCommand(
        `writeRegister(${normalizeRegister(register)}, ${normalizeValue(nextValue)})`,
        [`reg_write ${normalizeRegister(register)} ${normalizeValue(nextValue)}`],
      );
      return result;
    },

    async writeSimRegister2Hardware() {
      ensureLoaded();
      return true;
    },

    async AGCOnOff(status) {
      agcEnabled = Boolean(status);
      pushPreviewCommand(`AGCOnOff(${Boolean(status)})`, [`agc_en ${status ? 1 : 0}`]);
      return true;
    },

    async AGCSample(average, skip) {
      agcAverage = average;
      agcSkip = skip;
      pushPreviewCommand(`AGCSample(${average}, ${skip})`, [`agc_sample ${average} ${skip}`]);
      return true;
    },

    async AGCSlotOnOff(slotNumber, data, status) {
      const current = dec2bin(data, 4);
      const next = current.slice(0, 3) + (status ? '1' : '0');
      const value = bin2dec(next);
      agcSlotCfg.set(slotNumber, value);
      pushPreviewCommand(`AGCSlotOnOff(${slotNumber}, ${data}, ${status})`, [`agc_slot ${slotNumber.charCodeAt(0) - 65} ${value}`]);
      return value;
    },

    async AGCSlotLED(slotNumber, data, led) {
      const ledMap = {
        LED1A: '00',
        LED1B: '10',
        LED2A: '01',
        LED2B: '11',
      };
      const current = dec2bin(data, 4);
      const next = current.slice(0, 1) + ledMap[led] + current.slice(3);
      const value = bin2dec(next);
      agcSlotCfg.set(slotNumber, value);
      pushPreviewCommand(`AGCSlotLED(${slotNumber}, ${data}, ${led})`, [`agc_slot ${slotNumber.charCodeAt(0) - 65} ${value}`]);
      return value;
    },

    async AGCSlotChannel(slotNumber, data, channel) {
      const channelMap = {
        Channel1: '0',
        Channel2: '1',
      };
      const current = dec2bin(data, 4);
      const next = channelMap[channel] + current.slice(1);
      const value = bin2dec(next);
      agcSlotCfg.set(slotNumber, value);
      pushPreviewCommand(`AGCSlotChannel(${slotNumber}, ${data}, ${channel})`, [`agc_slot ${slotNumber.charCodeAt(0) - 65} ${value}`]);
      return value;
    },

    exportCfgFile(type, sillicon, otherRegisters = []) {
      ensureLoaded();
      const outputDir = path.join(__dirname, '..', 'exports');
      fs.mkdirSync(outputDir, { recursive: true });
      const now = new Date();
      const typeName = (type || []).map((item) => String(item).toUpperCase()).join('_');
      const fileName = `ADPD${sillicon}_${typeName}_${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}-${now.getHours()}${now.getMinutes()}${now.getSeconds()}.dcfg`;
      const filePath = path.join(outputDir, fileName);
      const lines = [];

      for (const register of Object.keys(simRegisters)) {
        lines.push(`${register.replace(/^0x/, '')} ${getRegisterValue(register).padStart(4, '0')}`);
      }

      if (otherRegisters.length > 0) {
        lines.push('');
        lines.push('## Other indvidual registers settings');
        for (const register of otherRegisters) {
          lines.push(`${register} ${getRegisterValue(register).padStart(4, '0')}`);
        }
      }

      fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
      return filePath;
    },

    getDevice() {
      return device;
    },

    getPreviewCommandLog() {
      return clone(previewCommandLog);
    },
  };
}

module.exports = {
  createSimState,
};
