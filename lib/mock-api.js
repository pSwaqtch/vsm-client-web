const defaultOk = { status: 200, body: true };

function mockResponseFor(url, method = 'GET') {
  const pathname = new URL(url, 'http://localhost').pathname;

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

  function normalize(url) {
    return new URL(url, window.location.href);
  }

  function responseFor(url, method) {
    const normalized = normalize(url);
    const pathname = normalized.pathname;
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
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const mocked = responseFor(url, method);
      if (!mocked) {
        return originalFetch(input, init);
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
        this._real.send(body);
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
