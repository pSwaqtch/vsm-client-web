const test = require('node:test');
const assert = require('node:assert/strict');

const { mockResponseFor } = require('../lib/mock-api.js');

test('mockResponseFor returns an empty port list for /target/list', () => {
  const response = mockResponseFor('/target/list', 'GET');

  assert.deepEqual(response.body, []);
});

test('mockResponseFor returns startup device metadata for the connect flow', () => {
  assert.equal(mockResponseFor('/target/getVersion', 'POST').body, 'preview');
  assert.equal(mockResponseFor('/target/getBoard', 'POST').body, 'preview-board');
  assert.equal(mockResponseFor('/target/getSillicon', 'POST').body, '7000');
});
