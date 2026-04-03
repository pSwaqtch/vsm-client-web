const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('config workspace reads preview command log from the backend server', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '../frontend-src/config-workspace.js'),
    'utf8',
  );

  assert.match(script, /const ENDPOINT = 'http:\/\/localhost:2880\/target\/previewCommandLog';/);
});

test('config workspace includes preview-specific tab state and compact log controls', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '../frontend-src/config-workspace.js'),
    'utf8',
  );

  assert.match(script, /const MAX_VISIBLE_ENTRIES = 20;/);
  assert.match(script, /preview-serial-tab-selected/);
  assert.match(script, /document\.createElement\('details'\)/);
  assert.match(script, /preview-serial-details/);
  assert.match(script, /Showing latest \$\{visibleEntries\.length\} of \$\{entries\.length\} entries/);
});
