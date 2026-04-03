const defaultOk = { status: 200, body: true };
const passthroughRoutes = [
  '/target/selectDevice',
  '/target/reset',
  '/target/loadCfg',
  '/target/readRegister',
  '/target/writeRegister',
  '/target/readSampleRate',
  '/target/readSlotEnable',
  '/target/readPPGAFETrimVref',
  '/target/readPPGAmbientCancellation',
  '/target/readDecimateFactor',
  '/target/readCHEnable',
  '/target/readTIAGain',
  '/target/readDACLEDDC',
  '/target/readOperationMode',
  '/target/readLedType',
  '/target/readLedCurrent',
  '/target/populateDIMode',
  '/target/writeSampleRate',
  '/target/writeSampleRateLoop',
  '/target/writeSlotEnable',
  '/target/writeCHEnable',
  '/target/writeTIAGain',
  '/target/writeDACLEDDC',
  '/target/writeOperationMode',
  '/target/writeLedType',
  '/target/writeLedCurrent',
  '/target/writePulse',
  '/target/writeDecimateFactor',
  '/target/writeSimRegister2Hardware',
  '/target/AGCOnOff',
  '/target/AGCSample',
  '/target/AGCSlotOnOff',
  '/target/AGCSlotLED',
  '/target/AGCSlotChannel',
  '/target/exportCfg',
];

function mockResponseFor(url, method = 'GET') {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (passthroughRoutes.includes(pathname)) return null;

  if (pathname === '/target/list') return { status: 200, body: [] };
  if (pathname === '/target/getVersion') return { status: 200, body: 'preview' };
  if (pathname === '/target/getBoard') return { status: 200, body: 'preview-board' };
  if (pathname === '/target/getSillicon') return { status: 200, body: '7000' };
  if (pathname === '/target/connectionStatusCheck') return { status: 200, body: false };
  if (pathname === '/target/fileExists') return { status: 200, body: false };
  if (pathname.startsWith('/target/read')) return { status: 200, body: '0' };
  if (pathname.startsWith('/target/')) return { status: 200, body: method === 'GET' ? [] : true };

  return null;
}

function buildShimScript() {
  return `(() => {
  const routes = ${JSON.stringify({
    '/target/list': [],
    '/target/getVersion': 'preview',
    '/target/getBoard': 'preview-board',
    '/target/getSillicon': '7000',
    '/target/connectionStatusCheck': false,
    '/target/fileExists': false,
  })};

  const jsonHeaders = 'content-type: application/json\\r\\n';
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  const OriginalXHR = window.XMLHttpRequest;
  const OriginalFileReader = window.FileReader;
  const passthroughRoutes = new Set(${JSON.stringify([
    ...passthroughRoutes,
    '/target/getVersion',
    '/target/getBoard',
    '/target/getSillicon',
  ])});
  const previewBackendUrl = 'http://localhost:2880/target/previewStoreCfg';

  window.__previewSelectedDcfg = null;
  window.__previewSelectedDcfgPromise = Promise.resolve(null);

  function normalize(url) {
    return new URL(url, window.location.href);
  }

  function isDcfgFile(file) {
    return Boolean(file && file.name && /\\.dcfg$/i.test(file.name));
  }

  async function captureSelectedDcfg(file) {
    if (!isDcfgFile(file)) {
      return null;
    }

    const filePath = file.path || '/preview/' + file.name;
    try {
      if (!file.path) {
        Object.defineProperty(file, 'path', { value: filePath, configurable: true });
      }
    } catch (error) {}

    const fileContent = typeof file.text === 'function' ? await file.text() : '';
    window.__previewSelectedDcfg = {
      fileContent,
      fileName: file.name,
      filePath,
    };
    if (originalFetch) {
      try {
        await originalFetch(previewBackendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(window.__previewSelectedDcfg),
        });
      } catch (error) {}
    }
    return window.__previewSelectedDcfg;
  }

  async function getSelectedDcfg() {
    await window.__previewSelectedDcfgPromise;
    return window.__previewSelectedDcfg;
  }

  async function augmentBody(url, body) {
    if (normalize(url).pathname !== '/target/loadCfg') {
      return body;
    }

    const selected = await getSelectedDcfg();
    if (!selected) {
      return body;
    }

    let payload;
    if (typeof body === 'string') {
      if (!body.trim()) {
        payload = {};
      } else {
        try {
          payload = JSON.parse(body);
        } catch (error) {
          return body;
        }
      }
    } else if (!body) {
      payload = {};
    } else if (typeof body === 'object') {
      payload = Object.assign({}, body);
    } else {
      return body;
    }

    if (!payload.fileContent) payload.fileContent = selected.fileContent;
    if (!payload.filePath) payload.filePath = selected.filePath;
    if (!payload.fileName) payload.fileName = selected.fileName;

    return typeof body === 'string' || body == null ? JSON.stringify(payload) : payload;
  }

  document.addEventListener('change', (event) => {
    const target = event.target;
    const file = target && target.files && target.files[0];
    if (!isDcfgFile(file)) {
      return;
    }
    window.__previewSelectedDcfgPromise = captureSelectedDcfg(file).catch(() => null);
  }, true);

  if (OriginalFileReader && OriginalFileReader.prototype && typeof OriginalFileReader.prototype.readAsText === 'function') {
    const originalReadAsText = OriginalFileReader.prototype.readAsText;
    OriginalFileReader.prototype.readAsText = function(file, ...args) {
      if (isDcfgFile(file)) {
        window.__previewSelectedDcfgPromise = captureSelectedDcfg(file).catch(() => null);
      }
      return originalReadAsText.call(this, file, ...args);
    };
  }

  function responseFor(url, method) {
    const normalized = normalize(url);
    const pathname = normalized.pathname;
    if (passthroughRoutes.has(pathname)) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(routes, pathname)) {
      return { status: 200, body: routes[pathname] };
    }
    if (pathname.startsWith('/target/read')) {
      return { status: 200, body: '0' };
    }
    if (pathname.startsWith('/target/')) {
      return { status: 200, body: method === 'GET' ? [] : true };
    }
    return null;
  }

  if (originalFetch) {
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const mocked = responseFor(url, method);
      if (!mocked) {
        const body = await augmentBody(url, init.body);
        return originalFetch(input, Object.assign({}, init, { body }));
      }
      return Promise.resolve(new Response(JSON.stringify(mocked.body), {
        status: mocked.status,
        headers: { 'Content-Type': 'application/json' },
      }));
    };
  }

  function trigger(target, name) {
    if (typeof target['on' + name] === 'function') {
      target['on' + name]({ target });
    }
    const listeners = target._listeners[name] || [];
    for (const listener of listeners) {
      listener.call(target, { target });
    }
  }

  class PreviewXHR {
    constructor() {
      this._listeners = {};
      this._headers = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.response = '';
      this.responseURL = '';
      this.statusText = '';
      this.onreadystatechange = null;
      this.onload = null;
      this.onerror = null;
      this._real = null;
      this._mock = null;
    }

    open(method, url, async = true, user, password) {
      this._method = (method || 'GET').toUpperCase();
      this._url = url;
      this._mock = responseFor(url, this._method);

      if (!this._mock) {
        this._real = new OriginalXHR();
        this._wireReal();
        this._real.open(method, url, async, user, password);
        return;
      }

      this.readyState = 1;
      this.responseURL = normalize(url).toString();
      trigger(this, 'readystatechange');
    }

    setRequestHeader(name, value) {
      if (this._real) {
        this._real.setRequestHeader(name, value);
        return;
      }
      this._headers[name.toLowerCase()] = value;
    }

    addEventListener(name, listener) {
      if (this._real) {
        this._real.addEventListener(name, listener);
        return;
      }
      this._listeners[name] = this._listeners[name] || [];
      this._listeners[name].push(listener);
    }

    removeEventListener(name, listener) {
      if (this._real) {
        this._real.removeEventListener(name, listener);
        return;
      }
      this._listeners[name] = (this._listeners[name] || []).filter((entry) => entry !== listener);
    }

    getAllResponseHeaders() {
      if (this._real) return this._real.getAllResponseHeaders();
      return jsonHeaders;
    }

    getResponseHeader(name) {
      if (this._real) return this._real.getResponseHeader(name);
      return name.toLowerCase() === 'content-type' ? 'application/json' : null;
    }

    abort() {
      if (this._real) {
        this._real.abort();
      }
    }

    send(body) {
      if (this._real) {
        augmentBody(this._url, body).then((nextBody) => {
          this._real.send(nextBody);
        }).catch(() => {
          this._real.send(body);
        });
        return;
      }

      window.setTimeout(() => {
        this.readyState = 4;
        this.status = this._mock.status;
        this.statusText = 'OK';
        this.responseText = JSON.stringify(this._mock.body);
        this.response = this.responseText;
        trigger(this, 'readystatechange');
        trigger(this, 'load');
      }, 0);
    }

    _wireReal() {
      const forward = (name) => {
        this._real.addEventListener(name, () => {
          this.readyState = this._real.readyState;
          this.status = this._real.status;
          this.responseText = this._real.responseText;
          this.response = this._real.response;
          this.responseURL = this._real.responseURL;
          this.statusText = this._real.statusText;
          trigger(this, name);
        });
      };

      forward('readystatechange');
      forward('load');
      forward('error');
    }
  }

  window.XMLHttpRequest = PreviewXHR;
})();`;
}

module.exports = {
  buildShimScript,
  mockResponseFor,
};
