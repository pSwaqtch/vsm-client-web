const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('backend connection routes delegate to a real transport when provided', async () => {
  const calls = [];
  const transport = {
    isOpen: () => true,
    list: async () => [{ path: '/dev/cu.usbmodem-preview', serialNumber: '', pnpId: '', manufacturer: 'macOS serial' }],
    init: async (port) => {
      calls.push(['init', port]);
      return true;
    },
    open: async () => {
      calls.push(['open']);
      return true;
    },
    close: async () => {
      calls.push(['close']);
      return true;
    },
    connectionStatusCheck: async () => true,
    getVersion: async () => 'fw-1.2.3',
    getBoard: async () => 'board-x',
    getSillicon: async () => '7000',
  };
  const handler = createBackendHandler({ transport });

  assert.deepEqual(await handler.list(), [{ path: '/dev/cu.usbmodem-preview', serialNumber: '', pnpId: '', manufacturer: 'macOS serial' }]);
  assert.equal(await handler.init({ port: '/dev/cu.usbmodem-preview' }), true);
  assert.equal(await handler.open(), true);
  assert.equal(await handler.connectionStatusCheck(), true);
  assert.equal(await handler.getVersion(), 'fw-1.2.3');
  assert.equal(await handler.getBoard(), 'board-x');
  assert.equal(await handler.getSillicon(), '7000');
  assert.equal(await handler.close(), true);
  assert.deepEqual(calls, [
    ['init', '/dev/cu.usbmodem-preview'],
    ['open'],
    ['close'],
  ]);
});

test('backend reset works before explicit device selection so welcome-screen loadCfg can proceed', async () => {
  const handler = createBackendHandler();

  await handler.reset();
  await handler.loadCfg({ fileContent: '0010 00aa\n', sim: true });

  assert.equal(await handler.getSillicon(), '7000');
  assert.equal(await handler.readRegister({ value: '0010', sim: true }), '00aa');
});

test('backend keeps sim state while delegating core register operations to hardware transport', async () => {
  const calls = [];
  const transport = {
    isOpen: () => true,
    reset: async () => {
      calls.push(['reset']);
      return true;
    },
    loadCfgContent: async (content) => {
      calls.push(['loadCfgContent', content]);
      return 'success';
    },
    readRegister: async (value) => {
      calls.push(['readRegister', value]);
      return 'beef';
    },
    writeRegister: async (value) => {
      calls.push(['writeRegister', value]);
      return '0x0010 0x00bb';
    },
    getSillicon: async () => '7000',
    getVersion: async () => 'fw',
    getBoard: async () => 'board',
  };
  const handler = createBackendHandler({ transport });

  assert.equal(await handler.reset(), true);
  assert.equal(await handler.loadCfg({ fileContent: '0010 00aa\n' }), 'success');
  assert.equal(await handler.readRegister({ value: '0010' }), 'beef');
  assert.equal(await handler.writeRegister({ value: '0010 00bb' }), '0x0010 0x00bb');
  assert.equal(await handler.readRegister({ value: '0010', sim: true }), '00bb');
  assert.deepEqual(calls, [
    ['reset'],
    ['loadCfgContent', '0010 00aa\n'],
    ['readRegister', '0010'],
    ['writeRegister', '0010 00bb'],
  ]);
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

test('backend PPG populate reads prefer live hardware registers when connected', async () => {
  const hardwareImage = createBackendHandler();
  const calls = [];
  const transport = {
    isOpen: () => true,
    readRegister: async (value) => {
      const normalized = String(value).replace(/^0x/i, '').toLowerCase().padStart(4, '0');
      calls.push(`0x${normalized}`);
      return hardwareImage.readRegister({ value: normalized, sim: true });
    },
    getSillicon: async () => '7000',
    getVersion: async () => 'fw',
    getBoard: async () => 'board',
  };
  const handler = createBackendHandler({ transport });

  await hardwareImage.reset();
  await hardwareImage.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });
  await handler.selectDevice('7000');

  assert.equal(await handler.readSampleRate({ type: 'ppg', sillicon: '7000', slot: 'NA' }), 100);
  assert.deepEqual(await handler.readSlotEnable({ type: 'ppg' }), ['A']);
  assert.deepEqual(await handler.readLedType({ slot: 'A' }), ['LED1A']);
  assert.equal(await handler.readOperationMode({ slot: 'A' }), 'normal');
  assert.equal(calls.length > 0, true);
  assert.equal(calls.some((address) => /^0x[0-9a-f]{4}$/.test(address)), true);
});

test('backend PPG write routes update sim state and round-trip through populate reads', async () => {
  const handler = createBackendHandler();

  await handler.reset();
  await handler.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });

  assert.equal(await handler.writeSlotEnable({ slots: 'AB', type: 'ppg', sim: true }), 'success');
  assert.deepEqual(await handler.readSlotEnable({ type: 'ppg', sim: true }), ['A', 'B']);

  assert.equal(await handler.writeCHEnable({ slot: 'A', channelName: 'Channel1,Channel2', sim: true }), 'success');
  assert.deepEqual(await handler.readCHEnable({ slot: 'A', sim: true }), ['Channel1', 'Channel2']);

  assert.equal(await handler.writeTIAGain({ slot: 'A', channelName: 'Channel1', resistanceValue: 25, sim: true }), 'success');
  assert.deepEqual(
    await handler.readTIAGain({ slot: 'A', sim: true }),
    [
      { channelName: 'Channel1', optionValue: 25 },
      { channelName: 'Channel2', optionValue: 100 },
      { channelName: 'Channel3', optionValue: 100 },
      { channelName: 'Channel4', optionValue: 100 },
    ],
  );

  assert.equal(await handler.writeDACLEDDC({ slot: 'A', chName: 'Channel1', dacValue: 3.0, sillicon: '7000', sim: true }), 'success');
  assert.deepEqual(
    await handler.readDACLEDDC({ slot: 'A', sillicon: '7000', sim: true }),
    [
      { channelName: 'Channel1', optionValue: 3 },
      { channelName: 'Channel2', optionValue: 0 },
      { channelName: 'Channel3', optionValue: 0 },
      { channelName: 'Channel4', optionValue: 0 },
    ],
  );

  assert.equal(await handler.writeOperationMode({ slot: 'A', type: 'two', sim: true }), 'success');
  assert.equal(await handler.readOperationMode({ slot: 'A', sim: true }), 'two');

  assert.equal(await handler.writeLedType({ slot: 'A', ledType: 'LED2A', status: true, sim: true }), 'success');
  assert.equal(await handler.writeLedCurrent({ slot: 'A', ledType: 'LED2A', currentValue: 31.24, sillicon: '7000', sim: true }), 'success');
  assert.deepEqual(await handler.readLedType({ slot: 'A', sim: true }), ['LED1A', 'LED2A']);
  assert.deepEqual(
    await handler.readLedCurrent({ slot: 'A', sillicon: '7000', sim: true }),
    [
      { ledName: 'LED1A', optionValue: '15.745' },
      { ledName: 'LED2A', optionValue: '31.495' },
    ],
  );

  assert.equal(await handler.writePulse({ slot: 'A', pulseValue: 7, type: 'NUM_INT_x', sim: true }), 'success');
  const diMode = await handler.populateDIMode({ slotName: 'A', connectionStatus: false });
  assert.deepEqual(diMode, [1, 7, 54, 24, 30, 34, 1, 10]);

  assert.equal(await handler.writeDecimateFactor({ slot: 'A', decimateFactorValue: 4, sim: true }), 'success');
  assert.equal(await handler.readDecimateFactor({ slot: 'A', sim: true }), 4);

  assert.equal(await handler.writeSampleRate({ type: 'ppg', sample: 400, sillicon: '7000', slot: 'NA', sim: true }), 'success');
  assert.equal(await handler.readSampleRate({ type: 'ppg', sillicon: '7000', slot: 'NA', sim: true }), 400);

  assert.equal(await handler.writeRegister({ value: '0010 00bb', sim: true }), '0x0010 0x00bb');
  assert.equal(await handler.readRegister({ value: '0010', sim: true }), '00bb');

  assert.equal(await handler.writeSimRegister2Hardware({ sim: true }), true);
});

test('backend AGC controls track preview state', async () => {
  const handler = createBackendHandler();

  await handler.reset();

  assert.equal(await handler.AGCOnOff({ status: true }), true);
  assert.equal(await handler.AGCSample({ average: 5, skip: 2 }), true);
  assert.equal(await handler.AGCSlotOnOff({ slotNumber: 'A', data: 0, status: true }), 1);
  assert.equal(await handler.AGCSlotLED({ slotNumber: 'A', data: 1, led: 'LED2B' }), 7);
  assert.equal(await handler.AGCSlotChannel({ slotNumber: 'A', data: 7, channel: 'Channel2' }), 15);
});

test('backend replays preview-generated PPG write commands to hardware when connected', async () => {
  const executed = [];
  const loadedCfg = [];
  const transport = {
    isOpen: () => true,
    executeCommands: async (commands) => {
      executed.push([...commands]);
      return true;
    },
    loadCfgContent: async (content) => {
      loadedCfg.push(content);
      return 'success';
    },
    getSillicon: async () => '7000',
    getVersion: async () => 'fw',
    getBoard: async () => 'board',
  };
  const handler = createBackendHandler({ transport });

  await handler.selectDevice('7000');
  await handler.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });

  assert.equal(await handler.writeTIAGain({ slot: 'A', channelName: 'Channel1', resistanceValue: 25 }), 'success');
  assert.equal(executed[0].some((command) => command.startsWith('reg_write ')), true);

  assert.equal(await handler.AGCOnOff({ status: true }), true);
  assert.deepEqual(executed[1], ['agc_en 1']);

  assert.equal(await handler.writeSimRegister2Hardware({}), true);
  assert.match(loadedCfg[0], /^007a 0001$/m);
});

test('backend plot routes return the frontend-compatible empty payload shape', async () => {
  const handler = createBackendHandler();

  assert.equal(await handler.startPlot({ value: 'fifo start' }), 'fifo start');

  const payload = await handler.startPlotReceive({
    type: ['ppg'],
    slotList: ['slotA-Channel1'],
    sillicon: '7000',
  });

  assert.deepEqual(Object.keys(payload), [
    'ecg',
    'ecg_filter',
    'ecg_python',
    'ppg',
    'ppg_filter',
    'ppg_spo2',
    'ppg_test',
    'ppg_python',
    'ppg_imu_a',
    'ppg_imu_g',
    'ppg_hrm',
    'bioz_mag',
    'bioz_phase',
    'bioz_ci1',
    'bioz_ci2',
    'bioz_ci3',
    'bioz_ci4',
    'eda_mag',
    'eda_phase',
  ]);
  assert.equal(payload.ppg.data.length > 0, true);
  assert.equal(payload.ppg_filter.data.length > 0, true);
  assert.equal(payload.ppg_hrm.data.length > 0, true);
  assert.equal(typeof payload.ppg.data[0]['slotA-Channel1'], 'number');
  assert.equal(typeof payload.ppg_filter.data[0]['slotA-Channel1'], 'number');
  assert.equal(typeof payload.ppg_hrm.data[0]['slotA-Channel1'], 'number');

  const nextPayload = await handler.startPlotReceive({
    type: ['ppg'],
    slotList: ['slotA-Channel1'],
    sillicon: '7000',
  });
  assert.equal(nextPayload.ppg.data[0].ts > payload.ppg.data[payload.ppg.data.length - 1].ts, true);

  assert.equal(await handler.stopPlot({}), true);
  assert.equal(await handler.startExportData({}), 'Success to start export data.');
  assert.deepEqual(await handler.stopExportData({}), []);
  assert.deepEqual(
    await handler.ppgFullScale({
      data: { 'slotA-Channel1': 1000 },
      storeList: [{
        slotName: 'slotA-Channel1',
        storeName: {
          slot_afe_trim_vref: '01',
          slot_num_int_x: 1,
          slot_num_repeat_x: 1,
          slot_ambient_cancellation: '00',
          slot_operation_mode: 'normal',
        },
      }],
      selectedSlotList: ['slotA-Channel1'],
    }),
    [{ slotName: 'slotA-Channel1', scale: '12.2' }],
  );
  assert.deepEqual(
    await handler.ppgSmoothProcess({
      data: [{ ts: 1, 'slotA-Channel1': 10 }, { ts: 2, 'slotA-Channel1': 20 }],
      count: [1, 2],
      ppgSlotList: ['slotA-Channel1'],
    }),
    { data: [{ ts: 1, 'slotA-Channel1': 50 / 3 }, { ts: 2, 'slotA-Channel1': 50 / 3 }] },
  );

  const debugState = await handler.debugPreviewState();
  assert.equal(debugState.plotActive, false);
  assert.equal(debugState.exportActive, false);
});

test('backend startPlotReceive parses real hardware-style PPG fifo lines when transport is active', async () => {
  const transport = {
    isOpen: () => true,
    startPlot: async () => true,
    drainPlotData: () => '[10] fc8022ee,0@755b2,7534b\r[20] bpm:72\r',
    stopPlot: async () => true,
    getSillicon: async () => '7000',
    getVersion: async () => 'fw',
    getBoard: async () => 'board',
  };
  const handler = createBackendHandler({ transport });

  await handler.startPlot({ value: 'app_bringup 4' });
  const payload = await handler.startPlotReceive({
    type: ['ppg'],
    slotList: ['slotA-Channel1', 'slotA-Channel2'],
    sillicon: '7000',
  });

  assert.deepEqual(payload.ppg.data, [
    { ts: 10, 'slotA-Channel1': parseInt('755b2', 16), 'slotA-Channel2': parseInt('7534b', 16) },
  ]);
  assert.deepEqual(payload.ppg_filter.data, [
    { ts: 10, 'slotA-Channel1': parseInt('755b2', 16), 'slotA-Channel2': parseInt('7534b', 16) },
  ]);
  assert.deepEqual(payload.ppg_hrm.data, [
    { ts: 20, 'slotA-Channel1': 72 },
  ]);
});

test('backend exportCfg writes a dcfg file from current sim state', async () => {
  const handler = createBackendHandler();
  let filePath = '';

  await handler.reset();
  await handler.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });
  await handler.writeRegister({ value: '0010 00cc', sim: true });

  try {
    const result = await handler.exportCfg({
      type: ['ppg'],
      sillicon: '7000',
      otherRegisters: ['0x0010'],
      sim: true,
    });

    assert.match(result, /^Success to write dcfg file in /);
    filePath = result.replace('Success to write dcfg file in ', '');
    assert.equal(fs.existsSync(filePath), true);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    assert.match(fileContent, /^007a 0001$/m);
    assert.match(fileContent, /^0010 00cc$/m);
    assert.match(fileContent, /^## Other indvidual registers settings$/m);
    assert.match(fileContent, /^0x0010 00cc$/m);
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('backend exportCfg syncs live hardware registers before writing the file', async () => {
  const hardwareImage = createBackendHandler();
  const reads = [];
  const transport = {
    isOpen: () => true,
    readRegister: async (value) => {
      const normalized = String(value).replace(/^0x/i, '').toLowerCase().padStart(4, '0');
      reads.push(normalized);
      return hardwareImage.readRegister({ value: normalized, sim: true });
    },
    getSillicon: async () => '7000',
    getVersion: async () => 'fw',
    getBoard: async () => 'board',
  };
  const handler = createBackendHandler({ transport });

  await hardwareImage.reset();
  await hardwareImage.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });
  await hardwareImage.writeRegister({ value: '0010 00dd', sim: true });
  await handler.selectDevice('7000');

  const result = await handler.exportCfg({
    type: ['ppg'],
    sillicon: '7000',
    otherRegisters: ['0x0010'],
  });

  const filePath = result.replace('Success to write dcfg file in ', '');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  assert.match(fileContent, /^0010 00dd$/m);
  assert.equal(reads.length > 0, true);
});

test('backend startExportData and stopExportData export live PPG fifo data to files', async () => {
  let started = 0;
  let stopped = 0;
  const transport = {
    isOpen: () => true,
    startExportData: async () => {
      started += 1;
      return true;
    },
    drainExportData: () => '[10] fc8022ee,0@755b2,7534b*72,75,98,1.2,1.3\r[20] imu:1,2,3,4,5,6\r',
    stopExportData: async () => {
      stopped += 1;
      return true;
    },
    getSillicon: async () => '7000',
    getVersion: async () => 'fw',
    getBoard: async () => 'board',
  };
  const handler = createBackendHandler({ transport });

  await handler.selectDevice('7000');
  assert.equal(await handler.startExportData({}), 'Success to start export data.');

  const result = await handler.stopExportData({
    sillicon: '7000',
    deviceType: ['ppg'],
    ppgSlotList: ['slotA-Channel1', 'slotA-Channel2'],
    spo2Enable: true,
    imuEnable: true,
  });

  assert.equal(started, 1);
  assert.equal(stopped, 1);
  assert.match(result, /^Success to export data in\r\n/);

  const outputPaths = result.replace('Success to export data in\r\n', '').split('\r\n');
  assert.equal(outputPaths.length, 2);
  const ppgCsv = fs.readFileSync(outputPaths[0], 'utf8');
  const imuCsv = fs.readFileSync(outputPaths[1], 'utf8');
  assert.match(ppgCsv, /^timestamp,slotA-Channel1,slotA-Channel2,HRM,Rate,Spo2,DC1,DC2$/m);
  assert.match(ppgCsv, /^10,480690,480075,72,75,98,1.2,1.3$/m);
  assert.match(imuCsv, /^timestamp,ax,ay,az,gx,gy,gz$/m);
  assert.match(imuCsv, /^20,1,2,3,4,5,6$/m);
});

test('backend records serial-equivalent commands for preview writes', async () => {
  const handler = createBackendHandler();

  await handler.reset();
  await handler.loadCfg({ filePath: REAL_PPG_DCFG_PATH, sim: true });
  await handler.writeTIAGain({ slot: 'A', channelName: 'Channel1', resistanceValue: 25, sim: true });

  const log = await handler.previewCommandLog();

  assert.equal(Array.isArray(log), true);
  assert.equal(log.length > 0, true);
  assert.match(log[0].action, /^writeTIAGain\(A, Channel1, 25\)$/);
  assert.equal(Array.isArray(log[0].commands), true);
  assert.equal(log[0].commands.length >= 2, true);
  assert.match(log[0].commands[0], /^reg_read 0x[0-9a-f]{4}$/);
  assert.match(log[0].commands[1], /^reg_write 0x[0-9a-f]{4} 0x[0-9a-f]{4}$/);
});
