const test = require('node:test');
const assert = require('node:assert/strict');

const { createSimState } = require('../lib/sim-state.js');

test('sim state loads a device and applies .dcfg register values from content', async () => {
  const state = createSimState();

  await state.selectDevice('7000');
  await state.loadCfgContent('# comment\n0x0010 0x00aa\n0011 00bb\n');

  assert.equal(await state.readRegister('0010'), '00aa');
  assert.equal(await state.readRegister('0x0011'), '00bb');
});

test('sim state reset restores default register values', async () => {
  const state = createSimState();

  await state.selectDevice('7000');
  const original = await state.readRegister('0010');
  await state.loadCfgContent('0010 00aa\n');
  assert.equal(await state.readRegister('0010'), '00aa');

  await state.reset();

  assert.equal(await state.readRegister('0010'), original);
});
