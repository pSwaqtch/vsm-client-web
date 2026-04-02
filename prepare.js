const fs = require('node:fs');
const path = require('node:path');

const { extractDirectoryFromAsar } = require('./lib/asar.js');
const { buildShimScript } = require('./lib/mock-api.js');

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(ROOT, '..');
const ASAR_PATH = path.join(PROJECT_ROOT, 'resources', 'app.asar');
const SITE_DIR = path.join(ROOT, 'site');
const SHIM_FILE = 'preview-shim.js';

function injectShim(indexHtml) {
  const scriptTag = `<script src="./${SHIM_FILE}"></script>`;
  if (indexHtml.includes(scriptTag)) {
    return indexHtml;
  }
  return indexHtml.replace(
    /<script>!function/,
    `${scriptTag}<script>!function`,
  );
}

function patchPreviewBundle(bundleSource) {
  return bundleSource
    .replace('l={loadStatus:!1}', 'l={loadStatus:!0}')
    .replace('c={connectionStatus:!1}', 'c={connectionStatus:!0}')
    .replace(
      'O={device:"",dType:[],process:[]}',
      'O={device:"7000",dType:["ecg","ppg","bioz","eda"],process:["ecg","cnibp","bioz","eda"]}',
    );
}

function prepareSite() {
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });

  const count = extractDirectoryFromAsar(ASAR_PATH, 'build', SITE_DIR);
  const indexPath = path.join(SITE_DIR, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  fs.writeFileSync(indexPath, injectShim(indexHtml));
  fs.writeFileSync(path.join(SITE_DIR, SHIM_FILE), buildShimScript());

  const jsDir = path.join(SITE_DIR, 'static', 'js');
  const mainBundle = fs.readdirSync(jsDir).find((file) => /^main\..+\.chunk\.js$/.test(file));
  if (mainBundle) {
    const mainBundlePath = path.join(jsDir, mainBundle);
    fs.writeFileSync(
      mainBundlePath,
      patchPreviewBundle(fs.readFileSync(mainBundlePath, 'utf8')),
    );
  }

  return { count, siteDir: SITE_DIR, indexPath };
}

if (require.main === module) {
  const result = prepareSite();
  console.log(`Prepared ${result.count} files in ${result.siteDir}`);
}

module.exports = {
  SHIM_FILE,
  SITE_DIR,
  patchPreviewBundle,
  prepareSite,
};
