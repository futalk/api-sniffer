(function() {
  'use strict';

  if (window.__API_SNIFFER_INSTALLED__) return;
  window.__API_SNIFFER_INSTALLED__ = true;

  const originalFetch = window.fetch;
  const originalXHR = window.XMLHttpRequest;
  const originalOpen = originalXHR.prototype.open;
  const originalSend = originalXHR.prototype.send;
  const originalSetRequestHeader = originalXHR.prototype.setRequestHeader;

  window.__API_SNIFFER_DOMAIN_ONLY__ = true;
  window.__API_SNIFFER_PAUSED__ = false;

  let requestIdCounter = 0;

  function generateId() {
    return 'req_' + Date.now() + '_' + (++requestIdCounter);
  }

  function shouldCapture(url) {
    if (!window.__API_SNIFFER_DOMAIN_ONLY__) return true;
    try {
      const requestHost = new URL(url, location.href).hostname;
      const pageHost = location.hostname;
      if (requestHost === pageHost) return true;
      if (requestHost.endsWith('.' + pageHost)) return true;
      if (pageHost.endsWith('.' + requestHost)) return true;
      return false;
    } catch (e) {
      return true;
    }
  }

  function postRecord(record) {
    if (window.__API_SNIFFER_PAUSED__) return;
    if (!shouldCapture(record.url)) return;
    console.log('[API Sniffer] postRecord:', record.method, record.url, 'status:', record.status);
    window.postMessage({
      source: 'api-sniffer-injected',
      record: record
    }, location.origin);
  }

  function safeStringify(data) {
    try {
      if (typeof data === 'string') return data;
      return JSON.stringify(data);
    } catch (e) {
      return String(data);
    }
  }

  function parseHeaders(headerStr) {
    const headers = {};
    if (!headerStr) return headers;
    const lines = headerStr.trim().split(/[\r\n]+/);
    lines.forEach(line => {
      const parts = line.split(': ');
      const key = parts.shift();
      const value = parts.join(': ');
      if (key) headers[key] = value;
    });
    return headers;
  }

  // ========== 拦截 fetch ==========
  window.fetch = async function(...args) {
    console.log('[API Sniffer] fetch intercepted:', args[0]);
    const id = generateId();
    const startTime = performance.now();
    const init = args[1] || {};
    const input = args[0];
    const url = (typeof input === 'string') ? input : input.url;
    const method = init.method || (typeof input === 'object' && input.method) || 'GET';

    let requestBody = null;
    if (init.body) {
      if (typeof init.body === 'string') {
        requestBody = init.body;
      } else if (init.body instanceof FormData) {
        const obj = {};
        init.body.forEach((v, k) => { obj[k] = v; });
        requestBody = obj;
      } else if (init.body instanceof URLSearchParams) {
        requestBody = init.body.toString();
      } else {
        try {
          requestBody = await init.body.text();
        } catch (e) {
          requestBody = '[Stream/Body]';
        }
      }
    }

    const requestHeaders = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { requestHeaders[k] = v; });
      } else if (typeof init.headers === 'object') {
        Object.assign(requestHeaders, init.headers);
      }
    }

    try {
      const response = await originalFetch.apply(this, args);
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      const responseClone = response.clone();
      let responseBody = null;
      let responseType = 'text';
      try {
        const contentType = responseClone.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          responseBody = await responseClone.json();
          responseType = 'json';
        } else if (contentType.includes('text/') || contentType.includes('javascript') || contentType.includes('xml') || contentType.includes('html')) {
          responseBody = await responseClone.text();
          responseType = 'text';
        } else {
          responseBody = await responseClone.text();
          responseType = 'blob';
        }
      } catch (e) {
        responseBody = '[Unable to read response]';
      }

      if (typeof responseBody === 'string' && responseBody.length > 10240) {
        responseBody = responseBody.substring(0, 10240) + '\n\n[已截断，原长度 ' + responseBody.length + ' 字符]';
      }

      const responseHeaders = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      postRecord({
        id,
        type: 'fetch',
        url,
        method,
        status: response.status,
        statusText: response.statusText,
        requestHeaders,
        requestBody,
        responseHeaders,
        responseBody,
        responseType,
        timestamp: new Date().toISOString(),
        duration: parseFloat(duration)
      });

      return response;
    } catch (error) {
      const endTime = performance.now();
      postRecord({
        id,
        type: 'fetch',
        url,
        method,
        status: 0,
        statusText: 'Network Error',
        requestHeaders,
        requestBody,
        responseHeaders: {},
        responseBody: error.message || String(error),
        responseType: 'error',
        timestamp: new Date().toISOString(),
        duration: parseFloat((endTime - startTime).toFixed(2)),
        error: true
      });
      throw error;
    }
  };

  // ========== 拦截 XMLHttpRequest ==========
  function XHRInterceptor() {
    console.log('[API Sniffer] XHR created');
    const xhr = new originalXHR();
    const realXhr = xhr;
    const id = generateId();
    const startTime = performance.now();
    let method = 'GET';
    let url = '';
    let requestHeaders = {};
    let requestBody = null;

    const proxy = new Proxy(xhr, {
      get(target, prop) {
        if (prop === 'open') {
          return function(m, u, ...rest) {
            method = m;
            url = u;
            return originalOpen.call(target, m, u, ...rest);
          };
        }
        if (prop === 'setRequestHeader') {
          return function(header, value) {
            requestHeaders[header] = value;
            return originalSetRequestHeader.call(target, header, value);
          };
        }
        if (prop === 'send') {
          return function(body) {
            requestBody = body;
            if (typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
              try { requestBody = JSON.stringify(body); } catch (e) {}
            }

            target.addEventListener('load', function() {
              const endTime = performance.now();
              let responseBody = null;
              let responseType = 'text';

              try {
                const rt = target.responseType;
                const ct = target.getResponseHeader('content-type') || '';
                if (rt === 'json') {
                  responseBody = target.response;
                  responseType = 'json';
                } else if (rt === '' || rt === 'text') {
                  responseBody = target.responseText;
                  if (ct.includes('application/json') || (typeof responseBody === 'string' && responseBody.trim().startsWith('{'))) {
                    try {
                      responseBody = JSON.parse(responseBody);
                      responseType = 'json';
                    } catch (e) {
                      responseType = 'text';
                    }
                  } else {
                    responseType = 'text';
                  }
                } else if (rt === 'blob') {
                  responseBody = '[Blob]';
                  responseType = 'blob';
                } else if (rt === 'arraybuffer') {
                  responseBody = '[ArrayBuffer]';
                  responseType = 'arraybuffer';
                } else if (rt === 'document') {
                  responseBody = '[Document]';
                  responseType = 'document';
                } else {
                  responseBody = target.responseText || target.response || '[Unknown]';
                  responseType = rt || 'text';
                }
              } catch (e) {
                responseBody = '[Unable to read response]';
                responseType = 'error';
              }

              if (typeof responseBody === 'string' && responseBody.length > 10240) {
                responseBody = responseBody.substring(0, 10240) + '\n\n[已截断，原长度 ' + responseBody.length + ' 字符]';
              }

              postRecord({
                id,
                type: 'xhr',
                url,
                method,
                status: target.status,
                statusText: target.statusText,
                requestHeaders,
                requestBody,
                responseHeaders: parseHeaders(target.getAllResponseHeaders()),
                responseBody,
                responseType,
                timestamp: new Date().toISOString(),
                duration: parseFloat((endTime - startTime).toFixed(2))
              });
            });

            target.addEventListener('error', function() {
              const endTime = performance.now();
              postRecord({
                id,
                type: 'xhr',
                url,
                method,
                status: 0,
                statusText: 'Network Error',
                requestHeaders,
                requestBody,
                responseHeaders: {},
                responseBody: 'XHR Error',
                responseType: 'error',
                timestamp: new Date().toISOString(),
                duration: parseFloat((endTime - startTime).toFixed(2)),
                error: true
              });
            });

            return originalSend.call(target, body);
          };
        }
        const value = target[prop];
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });

    return proxy;
  }

  // 替换全局 XMLHttpRequest
  window.XMLHttpRequest = XHRInterceptor;

  window.addEventListener('message', function(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data && event.data.source === 'api-sniffer-control') {
      if (event.data.action === 'setDomainOnly') {
        window.__API_SNIFFER_DOMAIN_ONLY__ = event.data.value;
        console.log('[API Sniffer] domainOnly set to:', event.data.value);
      }
      if (event.data.action === 'setPaused') {
        window.__API_SNIFFER_PAUSED__ = event.data.value;
        console.log('[API Sniffer] paused set to:', event.data.value);
      }
    }
  });

  console.log('[API Sniffer] Injected and listening on', location.href);
  console.log('[API Sniffer] domainOnly:', window.__API_SNIFFER_DOMAIN_ONLY__);
  console.log('[API Sniffer] fetch intercepted:', typeof window.fetch);
  console.log('[API Sniffer] XHR intercepted:', typeof window.XMLHttpRequest);
})();
