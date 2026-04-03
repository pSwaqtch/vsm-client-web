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
