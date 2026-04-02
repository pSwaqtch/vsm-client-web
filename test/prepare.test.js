const test = require('node:test');
const assert = require('node:assert/strict');

const { patchPreviewBundle } = require('../prepare.js');

test('patchPreviewBundle enables preview-only load, connection, and device state in the bundle', () => {
  const input = 'var a=1,l={loadStatus:!1},r={flash2HardwareStatus:!1},c={connectionStatus:!1},O={device:\"\",dType:[],process:[]};';

  const output = patchPreviewBundle(input);

  assert.match(output, /l=\{loadStatus:!0\}/);
  assert.match(output, /c=\{connectionStatus:!0\}/);
  assert.match(output, /O=\{device:"7000",dType:\["ecg","ppg","bioz","eda"\],process:\["ecg","cnibp","bioz","eda"\]\}/);
  assert.doesNotMatch(output, /l=\{loadStatus:!1\}/);
  assert.doesNotMatch(output, /c=\{connectionStatus:!1\}/);
  assert.doesNotMatch(output, /O=\{device:"",dType:\[\],process:\[\]\}/);
});
