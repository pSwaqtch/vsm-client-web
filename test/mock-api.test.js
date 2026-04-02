const test = require('node:test');
const assert = require('node:assert/strict');

const { buildShimScript, mockResponseFor } = require('../lib/mock-api.js');

test('mockResponseFor returns an empty port list for /target/list', () => {
  const response = mockResponseFor('/target/list', 'GET');

  assert.deepEqual(response.body, []);
});

test('mockResponseFor returns startup device metadata for the connect flow', () => {
  assert.equal(mockResponseFor('/target/getVersion', 'POST').body, 'preview');
  assert.equal(mockResponseFor('/target/getBoard', 'POST').body, 'preview-board');
  assert.equal(mockResponseFor('/target/getSillicon', 'POST').body, '7000');
});

test('buildShimScript includes the preview file bridge for target/loadCfg', () => {
  const script = buildShimScript();

  assert.match(script, /__previewSelectedDcfg/);
  assert.match(script, /\/target\/loadCfg/);
  assert.match(script, /fileContent/);
  assert.match(script, /document\.addEventListener\('change'/);
});

test('buildShimScript patches FileReader reads so .dcfg files get a preview path and captured content', () => {
  const script = buildShimScript();

  assert.match(script, /FileReader\.prototype\.readAsText/);
  assert.match(script, /Object\.defineProperty\(file,\s*'path'/);
  assert.match(script, /captureSelectedDcfg\(file\)/);
});
