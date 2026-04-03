const test = require('node:test');
const assert = require('node:assert/strict');

const { injectPreviewAssets, patchPreviewBundle } = require('../prepare.js');

test('injectPreviewAssets adds preview shim and editable workspace assets', () => {
  const input = '<html><head></head><body><script>!function(){}</script></body></html>';

  const output = injectPreviewAssets(input);

  assert.match(output, /<script src="\.\/preview-shim\.js"><\/script>/);
  assert.match(output, /<link rel="stylesheet" href="\.\/config-workspace\.css">/);
  assert.match(output, /<script src="\.\/config-workspace\.js"><\/script>/);
});

test('patchPreviewBundle enables preview-only load and connection state without forcing device types', () => {
  const input = 'var a=1,l={loadStatus:!1},r={flash2HardwareStatus:!1},c={connectionStatus:!1},O={device:\"\",dType:[],process:[]};';

  const output = patchPreviewBundle(input);

  assert.match(output, /l=\{loadStatus:!0\}/);
  assert.match(output, /c=\{connectionStatus:!0\}/);
  assert.doesNotMatch(output, /l=\{loadStatus:!1\}/);
  assert.doesNotMatch(output, /c=\{connectionStatus:!1\}/);
  assert.match(output, /O=\{device:"",dType:\[\],process:\[\]\}/);
  assert.doesNotMatch(output, /device:"7000",dType:\["ecg","ppg","bioz","eda"\]/);
});
