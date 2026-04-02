const fs = require('node:fs');
const path = require('node:path');

function parseAsarHeaderEnd(buffer, start = 16) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < buffer.length; index += 1) {
    const ch = buffer[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === 0x5c) {
        escaped = true;
      } else if (ch === 0x22) {
        inString = false;
      }
      continue;
    }

    if (ch === 0x22) {
      inString = true;
      continue;
    }

    if (ch === 0x7b) {
      depth += 1;
      continue;
    }

    if (ch === 0x7d) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error('Unable to find ASAR header end');
}

function parseAsarHeader(buffer) {
  const end = parseAsarHeaderEnd(buffer, 16);
  let baseOffset = end + 1;

  while (baseOffset < buffer.length && buffer[baseOffset] === 0x00) {
    baseOffset += 1;
  }

  return {
    baseOffset,
    header: JSON.parse(buffer.subarray(16, end + 1).toString('utf8')),
  };
}

function listFilesUnder(header, directory) {
  const parts = directory.split('/').filter(Boolean);
  let node = header;

  for (const part of parts) {
    node = node.files?.[part];
    if (!node) {
      throw new Error(`Directory not found: ${directory}`);
    }
  }

  const out = [];
  const walk = (entry, prefix) => {
    if (entry.files) {
      for (const [name, child] of Object.entries(entry.files)) {
        walk(child, `${prefix}/${name}`);
      }
      return;
    }

    out.push({
      path: prefix,
      size: entry.size,
      offset: Number(entry.offset),
    });
  };

  walk(node, directory);
  return out;
}

function extractDirectoryFromAsar(asarPath, directory, outputDir) {
  const buffer = fs.readFileSync(asarPath);
  const { baseOffset, header } = parseAsarHeader(buffer);
  const files = listFilesUnder(header, directory);

  for (const file of files) {
    const relativePath = file.path.slice(`${directory}/`.length);
    const destination = path.join(outputDir, relativePath);
    const start = baseOffset + file.offset;
    const end = start + file.size;

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer.subarray(start, end));
  }

  return files.length;
}

module.exports = {
  extractDirectoryFromAsar,
  listFilesUnder,
  parseAsarHeader,
  parseAsarHeaderEnd,
};
