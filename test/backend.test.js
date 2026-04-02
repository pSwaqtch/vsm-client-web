const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackendHandler, createBackendServer } = require('../backend.js');

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
