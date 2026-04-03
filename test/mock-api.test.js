const test = require('node:test');
const assert = require('node:assert/strict');

const { buildShimScript, mockResponseFor } = require('../lib/mock-api.js');

test('mockResponseFor lets connection routes reach the backend', () => {
  assert.equal(mockResponseFor('/target/list', 'GET'), null);
  assert.equal(mockResponseFor('/target/init', 'POST'), null);
  assert.equal(mockResponseFor('/target/open', 'POST'), null);
  assert.equal(mockResponseFor('/target/close', 'POST'), null);
  assert.equal(mockResponseFor('/target/connectionStatusCheck', 'POST'), null);
  assert.equal(mockResponseFor('/target/getVersion', 'POST'), null);
  assert.equal(mockResponseFor('/target/getBoard', 'POST'), null);
  assert.equal(mockResponseFor('/target/getSillicon', 'POST'), null);
});

test('mockResponseFor lets PPG config populate routes reach the backend', () => {
  assert.equal(mockResponseFor('/target/readSampleRate', 'POST'), null);
  assert.equal(mockResponseFor('/target/readSlotEnable', 'POST'), null);
  assert.equal(mockResponseFor('/target/readPPGAFETrimVref', 'POST'), null);
  assert.equal(mockResponseFor('/target/readPPGAmbientCancellation', 'POST'), null);
  assert.equal(mockResponseFor('/target/readDecimateFactor', 'POST'), null);
  assert.equal(mockResponseFor('/target/readCHEnable', 'POST'), null);
  assert.equal(mockResponseFor('/target/readTIAGain', 'POST'), null);
  assert.equal(mockResponseFor('/target/readDACLEDDC', 'POST'), null);
  assert.equal(mockResponseFor('/target/readOperationMode', 'POST'), null);
  assert.equal(mockResponseFor('/target/readLedType', 'POST'), null);
  assert.equal(mockResponseFor('/target/readLedCurrent', 'POST'), null);
  assert.equal(mockResponseFor('/target/populateDIMode', 'POST'), null);
});

test('mockResponseFor lets PPG config write and export routes reach the backend', () => {
  assert.equal(mockResponseFor('/target/writeRegister', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeSampleRate', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeSampleRateLoop', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeSlotEnable', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeCHEnable', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeTIAGain', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeDACLEDDC', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeOperationMode', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeLedType', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeLedCurrent', 'POST'), null);
  assert.equal(mockResponseFor('/target/writePulse', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeDecimateFactor', 'POST'), null);
  assert.equal(mockResponseFor('/target/writeSimRegister2Hardware', 'POST'), null);
  assert.equal(mockResponseFor('/target/AGCOnOff', 'POST'), null);
  assert.equal(mockResponseFor('/target/AGCSample', 'POST'), null);
  assert.equal(mockResponseFor('/target/AGCSlotOnOff', 'POST'), null);
  assert.equal(mockResponseFor('/target/AGCSlotLED', 'POST'), null);
  assert.equal(mockResponseFor('/target/AGCSlotChannel', 'POST'), null);
  assert.equal(mockResponseFor('/target/exportCfg', 'POST'), null);
  assert.equal(mockResponseFor('/target/previewCommandLog', 'GET'), null);
});

test('buildShimScript includes the preview file bridge for target/loadCfg', () => {
  const script = buildShimScript();

  assert.match(script, /__previewSelectedDcfg/);
  assert.match(script, /\/target\/loadCfg/);
  assert.match(script, /\/target\/previewStoreCfg/);
  assert.match(script, /fileContent/);
  assert.match(script, /document\.addEventListener\('change'/);
});

test('buildShimScript patches FileReader reads so .dcfg files get a preview path and captured content', () => {
  const script = buildShimScript();

  assert.match(script, /FileReader\.prototype\.readAsText/);
  assert.match(script, /Object\.defineProperty\(file,\s*'path'/);
  assert.match(script, /captureSelectedDcfg\(file\)/);
});

test('buildShimScript passthroughs the PPG populate endpoints', () => {
  const script = buildShimScript();

  assert.match(script, /\/target\/readSampleRate/);
  assert.match(script, /\/target\/readSlotEnable/);
  assert.match(script, /\/target\/readPPGAFETrimVref/);
  assert.match(script, /\/target\/readLedCurrent/);
  assert.match(script, /\/target\/populateDIMode/);
});

test('buildShimScript passthroughs the PPG write and export endpoints', () => {
  const script = buildShimScript();

  assert.match(script, /\/target\/list/);
  assert.match(script, /\/target\/init/);
  assert.match(script, /\/target\/open/);
  assert.match(script, /\/target\/close/);
  assert.match(script, /\/target\/connectionStatusCheck/);
  assert.match(script, /\/target\/writeSlotEnable/);
  assert.match(script, /\/target\/writeCHEnable/);
  assert.match(script, /\/target\/writeTIAGain/);
  assert.match(script, /\/target\/writeLedCurrent/);
  assert.match(script, /\/target\/AGCSlotOnOff/);
  assert.match(script, /\/target\/exportCfg/);
  assert.match(script, /\/target\/previewCommandLog/);
});
