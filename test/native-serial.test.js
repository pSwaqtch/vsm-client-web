const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNativeSerialTransport,
  normalizeRegisterAddress,
  normalizeRegisterValue,
  parseSiliconLine,
  parseCfgLines,
  resolvePortPath,
} = require('../lib/native-serial.js');

test('native serial helpers normalize register strings and silicon ids', () => {
  assert.equal(normalizeRegisterAddress('10'), '0x0010');
  assert.equal(normalizeRegisterValue('aa'), '0x00aa');
  assert.equal(parseSiliconLine('c6'), '7000');
  assert.equal(parseSiliconLine('something else'), null);
});

test('native serial helper parses dcfg lines into normalized register writes', () => {
  assert.deepEqual(parseCfgLines('0010 00aa\n# skip\n0020 00bb\n'), [
    { address: '0x0010', value: '0x00aa' },
    { address: '0x0020', value: '0x00bb' },
  ]);
});

test('native serial transport lists macOS serial candidates from /dev', async () => {
  const transport = createNativeSerialTransport({
    devRoot: '/dev',
    fsModule: {
      promises: {
        readdir: async () => ['tty.debug', 'cu.Bluetooth-Incoming-Port', 'cu.usbmodem123', 'cu.usbserial456'],
      },
    },
    execFile: async () => {},
    openFile: async () => {
      throw new Error('should not open');
    },
  });

  assert.deepEqual(await transport.list(), [
    {
      path: '/dev/cu.Bluetooth-Incoming-Port',
      serialNumber: '',
      pnpId: '',
      manufacturer: 'macOS serial',
    },
    {
      path: '/dev/cu.usbmodem123',
      serialNumber: '',
      pnpId: '',
      manufacturer: 'macOS serial',
    },
    {
      path: '/dev/cu.usbserial456',
      serialNumber: '',
      pnpId: '',
      manufacturer: 'macOS serial',
    },
  ]);
});

test('native serial transport resolves uppercased frontend port paths to real macOS device nodes', async () => {
  const resolved = await resolvePortPath('/DEV/CU.USBMODEM204435354E321', {
    devRoot: '/dev',
    fsModule: {
      promises: {
        readdir: async () => ['cu.usbmodem204435354e321', 'cu.usbserial456'],
      },
    },
  });

  assert.equal(resolved, '/dev/cu.usbmodem204435354e321');
});

test('native serial transport reset succeeds after writing sw_reset even without a response line', async () => {
  const writes = [];
  const readStream = {
    on() {},
    destroy() {},
  };
  const fileHandle = {
    createReadStream() {
      return readStream;
    },
    async write(value) {
      writes.push(value);
    },
    async close() {},
  };

  const transport = createNativeSerialTransport({
    devRoot: '/dev',
    fsModule: {
      promises: {
        readdir: async () => ['cu.usbmodem123'],
      },
    },
    execFile: async () => {},
    openFile: async () => fileHandle,
  });

  await transport.init('/DEV/CU.USBMODEM123');
  await transport.open();

  assert.equal(await transport.reset(), true);
  assert.deepEqual(writes, ['sw_reset\r']);
});

test('native serial transport captures fifo lines during plot mode and drains them', async () => {
  const handlers = {};
  const readStream = {
    on(name, handler) {
      handlers[name] = handler;
    },
    destroy() {},
  };
  const writes = [];
  const fileHandle = {
    createReadStream() {
      return readStream;
    },
    async write(value) {
      writes.push(value);
    },
    async close() {},
  };

  const transport = createNativeSerialTransport({
    devRoot: '/dev',
    fsModule: {
      promises: {
        readdir: async () => ['cu.usbmodem123'],
      },
    },
    execFile: async () => {},
    openFile: async () => fileHandle,
  });

  await transport.init('/dev/cu.usbmodem123');
  await transport.open();
  await transport.startPlot('app_bringup 4');
  handlers.data(Buffer.from('[10] fc8022ee,0@755b2,7534b\n'));
  handlers.data(Buffer.from('[20] bpm:72\n'));

  assert.equal(transport.drainPlotData(), '[10] fc8022ee,0@755b2,7534b\r[20] bpm:72\r');
  assert.equal(transport.drainPlotData(), '');

  await transport.stopPlot('app_stop');
  assert.deepEqual(writes, ['app_bringup 4\r', 'app_stop\r']);
});
