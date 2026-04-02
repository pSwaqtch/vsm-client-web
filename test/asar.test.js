const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAsarHeaderEnd, listFilesUnder } = require('../lib/asar.js');

test('parseAsarHeaderEnd finds the end of the top-level header JSON', () => {
  const sample = Buffer.concat([
    Buffer.from([0x04, 0x00, 0x00, 0x00]),
    Buffer.from('xxxx'),
    Buffer.from('{"files":{"a.txt":{"size":1,"offset":"0"}}}Z', 'utf8'),
  ]);

  const end = parseAsarHeaderEnd(sample, 8);

  assert.equal(sample[end], '}'.charCodeAt(0));
});

test('listFilesUnder returns nested file entries for a directory tree', () => {
  const header = {
    files: {
      build: {
        files: {
          'index.html': { size: 3, offset: '0' },
          static: {
            files: {
              'main.js': { size: 2, offset: '3' },
            },
          },
        },
      },
    },
  };

  const files = listFilesUnder(header, 'build');

  assert.deepEqual(
    files.map((entry) => entry.path),
    ['build/index.html', 'build/static/main.js'],
  );
});

test('parseAsarHeader skips null padding between the header and file payload', () => {
  const { parseAsarHeader } = require('../lib/asar.js');
  const headerJson = '{"files":{"package.json":{"size":1,"offset":"0"}}}';
  const sample = Buffer.concat([
    Buffer.alloc(16, 0),
    Buffer.from(headerJson, 'utf8'),
    Buffer.from([0x00]),
    Buffer.from('{', 'utf8'),
  ]);

  const { baseOffset } = parseAsarHeader(sample);

  assert.equal(sample[baseOffset], '{'.charCodeAt(0));
});
