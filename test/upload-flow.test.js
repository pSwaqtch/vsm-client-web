const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createBackendServer } = require('../backend.js');
const { buildShimScript } = require('../lib/mock-api.js');

const REAL_DCFG_PATH = path.resolve(
  __dirname,
  '../../Cfg/ADPD7000/ADPD7000_PPG_SLOTA_ch4.dcfg',
);

function createDocument() {
  const listeners = new Map();

  return {
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },

    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
  };
}

function createBrowserContext(port) {
  const document = createDocument();
  const browserOrigin = 'http://127.0.0.1:4173';

  async function backendAwareFetch(input, init = {}) {
    const inputUrl = typeof input === 'string' ? input : input.url;
    const normalized = new URL(inputUrl, browserOrigin);

    let targetUrl = normalized;
    if (
      (normalized.hostname === 'localhost' && normalized.port === '2880') ||
      (normalized.origin === browserOrigin && normalized.pathname.startsWith('/target/'))
    ) {
      targetUrl = new URL(normalized.pathname + normalized.search, `http://127.0.0.1:${port}`);
    }

    return fetch(targetUrl, init);
  }

  class BaseXHR {
    constructor() {
      this._headers = {};
      this._listeners = {};
      this.readyState = 0;
      this.status = 0;
      this.statusText = '';
      this.responseText = '';
      this.response = '';
      this.responseURL = '';
      this.onreadystatechange = null;
      this.onload = null;
      this.onerror = null;
    }

    open(method, url) {
      this._method = method;
      this._url = url;
      this.readyState = 1;
      this.#emit('readystatechange');
    }

    setRequestHeader(name, value) {
      this._headers[name] = value;
    }

    addEventListener(type, listener) {
      const entries = this._listeners[type] || [];
      entries.push(listener);
      this._listeners[type] = entries;
    }

    removeEventListener(type, listener) {
      this._listeners[type] = (this._listeners[type] || []).filter((entry) => entry !== listener);
    }

    async send(body) {
      try {
        const response = await backendAwareFetch(this._url, {
          method: this._method,
          headers: this._headers,
          body,
        });

        this.readyState = 4;
        this.status = response.status;
        this.statusText = response.statusText;
        this.responseURL = response.url;
        this.responseText = await response.text();
        this.response = this.responseText;
        this.#emit('readystatechange');
        this.#emit('load');
      } catch (error) {
        this.#emit('error');
        throw error;
      }
    }

    #emit(type) {
      if (typeof this[`on${type}`] === 'function') {
        this[`on${type}`]({ target: this });
      }
      for (const listener of this._listeners[type] || []) {
        listener({ target: this });
      }
    }
  }

  class BaseFileReader {
    readAsText(file) {
      this.result = typeof file._text === 'string' ? file._text : '';
      if (typeof this.onload === 'function') {
        this.onload({ target: this });
      }
    }
  }

  const window = {
    location: { href: `${browserOrigin}/` },
    fetch: backendAwareFetch,
    XMLHttpRequest: BaseXHR,
    FileReader: BaseFileReader,
    setTimeout,
    clearTimeout,
    Promise,
    Response,
    URL,
  };

  const context = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Response,
    URL,
    JSON,
    Object,
    Array,
    Map,
    Set,
  };

  window.document = document;

  vm.runInNewContext(buildShimScript(), context);

  return { window, document, backendAwareFetch };
}

async function sendXhr(window, url, body) {
  const xhr = new window.XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.addEventListener('load', () => resolve(xhr.responseText));
    xhr.addEventListener('error', reject);
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(body);
  });
}

test('preview shim uploads a selected real dcfg file and loadCfg succeeds', async () => {
  const server = createBackendServer(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const { window, document, backendAwareFetch } = createBrowserContext(port);
    const realDcfgContent = fs.readFileSync(REAL_DCFG_PATH, 'utf8');
    const selectedFile = {
      name: path.basename(REAL_DCFG_PATH),
      path: '/preview/' + path.basename(REAL_DCFG_PATH),
      _text: realDcfgContent,
      text: async () => realDcfgContent,
    };

    document.dispatch('change', { target: { files: [selectedFile] } });
    const reader = new window.FileReader();
    reader.readAsText(selectedFile);
    await window.__previewSelectedDcfgPromise;

    const loadResponse = await backendAwareFetch('/target/loadCfg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: selectedFile.path, sim: true }),
    });
    assert.equal(await loadResponse.json(), 'success');

    const xhrResponseText = await sendXhr(
      window,
      '/target/loadCfg',
      JSON.stringify({ filePath: selectedFile.path, sim: true }),
    );
    assert.equal(JSON.parse(xhrResponseText), 'success');

    const registerResponse = await backendAwareFetch('/target/readRegister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '0006', sim: true }),
    });
    assert.equal(await registerResponse.json(), '00a0');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
