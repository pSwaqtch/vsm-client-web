const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createBackendHandler, createBackendServer } = require('../backend.js');

const REAL_PPG_DCFG_PATH = path.resolve(
  __dirname,
  '../../Cfg/ADPD7000/ADPD7000_PPG_SLOTA_ch4.dcfg',
);

test('backend loadCfg accepts inline fileContent and updates readable registers', async () => {
  const handler = createBackendHandler();

  await handler.selectDevice('7000');
  await handler.loadCfg({ fileContent: '0010 00aa\n', sim: true });
  const value = await handler.readRegister({ value: '0010', sim: true });

  assert.equal(value, '00aa');
});

test('backend metadata endpoints expose preview defaults', async () => {
  const handler = createBackendHandler();

  await handler.selectDevice('7000');

  assert.equal(await handler.getVersion(), 'preview');
  assert.equal(await handler.getBoard(), 'preview-board');
  assert.equal(await handler.getSillicon(), '7000');
});

test('backend reset works before explicit device selection so welcome-screen loadCfg can proceed', async () => {
  const handler = createBackendHandler();

  await handler.reset();
  await handler.loadCfg({ fileContent: '0010 00aa\n', sim: true });

  assert.equal(await handler.getSillicon(), '7000');
  assert.equal(await handler.readRegister({ value: '0010', sim: true }), '00aa');
});

test('backend loadCfg accepts a cached preview file selected in the browser', async () => {
  const handler = createBackendHandler();

  await handler.cachePreviewCfg({
    filePath: '/preview/demo.dcfg',
    fileContent: '0010 00aa\n',
  });
  await handler.loadCfg({ filePath: '/preview/demo.dcfg', sim: true });

  assert.equal(await handler.readRegister({ value: '0010', sim: true }), '00aa');
});

test('backend loadCfg falls back to the latest cached preview file when the request body is empty', async () => {
  const handler = createBackendHandler();

  await handler.cachePreviewCfg({
    filePath: '/preview/demo.dcfg',
    fileName: 'demo.dcfg',
    fileContent: '0010 00aa\n',
  });
  await handler.loadCfg({});

  assert.equal(await handler.readRegister({ value: '0010', sim: true }), '00aa');
});

test('backend server answers browser CORS preflight for reset endpoint', async () => {
  const server = createBackendServer(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/target/reset`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:4173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
    assert.match(response.headers.get('access-control-allow-headers') || '', /content-type/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('backend server accepts legacy form-encoded loadCfg bodies', async () => {
  const server = createBackendServer(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await fetch(`http://127.0.0.1:${port}/target/previewStoreCfg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: '/preview/demo.dcfg',
        fileName: 'demo.dcfg',
        fileContent: '0010 00aa\n',
      }),
    });

    const response = await fetch(`http://127.0.0.1:${port}/target/loadCfg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'params[filePath]=%2Fpreview%2Fdemo.dcfg&params[sim]=true',
    });

    assert.equal(response.status, 200);
    assert.equal(await response.json(), 'success');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('backend exposes PPG populate readbacks for a real dcfg file', async () => {
  const handler = createBackendHandler();

  await handler.reset();
  await handler.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });

  assert.equal(await handler.readSampleRate({ type: 'ppg', sillicon: '7000', slot: 'NA', sim: true }), 100);
  assert.deepEqual(await handler.readSlotEnable({ type: 'ppg', sim: true }), ['A']);
  assert.equal(await handler.readPPGAFETrimVref({ slot: 'A', sim: true }), '01');
  assert.equal(await handler.readPPGAmbientCancellation({ slot: 'A', sim: true }), '00');
  assert.equal(await handler.readDecimateFactor({ slot: 'A', sim: true }), 1);
  assert.deepEqual(
    await handler.readCHEnable({ slot: 'A', sim: true }),
    ['Channel1', 'Channel2', 'Channel3', 'Channel4'],
  );
  assert.deepEqual(
    await handler.readTIAGain({ slot: 'A', sim: true }),
    [
      { channelName: 'Channel1', optionValue: 100 },
      { channelName: 'Channel2', optionValue: 100 },
      { channelName: 'Channel3', optionValue: 100 },
      { channelName: 'Channel4', optionValue: 100 },
    ],
  );
  assert.deepEqual(
    await handler.readDACLEDDC({ slot: 'A', sillicon: '7000', sim: true }),
    [
      { channelName: 'Channel1', optionValue: 0 },
      { channelName: 'Channel2', optionValue: 0 },
      { channelName: 'Channel3', optionValue: 0 },
      { channelName: 'Channel4', optionValue: 0 },
    ],
  );
  assert.equal(await handler.readOperationMode({ slot: 'A', sim: true }), 'normal');
  assert.deepEqual(await handler.readLedType({ slot: 'A', sim: true }), ['LED1A']);
  assert.deepEqual(
    await handler.readLedCurrent({ slot: 'A', sillicon: '7000', sim: true }),
    [{ ledName: 'LED1A', optionValue: '15.745' }],
  );
  assert.deepEqual(
    await handler.populateDIMode({ slotName: 'A', connectionStatus: false }),
    [1, 10, 54, 24, 30, 34, 1, 10],
  );
});
