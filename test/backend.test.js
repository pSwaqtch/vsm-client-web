const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackendHandler } = require('../backend.js');

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
