/**
 * API Sniffer - 浏览器控制台版
 * 
 * 使用方法：
 * 1. 打开任意网页
 * 2. 按 F12 打开开发者工具，切换到 Console 标签
 * 3. 把下面整段代码复制粘贴进去，按回车
 * 4. 开始点击网页功能，所有接口请求会自动打印在控制台并暂存
 * 5. 执行 apiSniffer.exportJSON() 或 apiSniffer.exportCSV() 下载文件到本地
 * 
 * 不需要安装任何扩展，即贴即用！
 */

(function() {
  'use strict';

  if (window.__API_SNIFFER_INSTALLED__) {
    console.warn('[API Sniffer] 已经初始化过了');
    return;
  }
  window.__API_SNIFFER_INSTALLED__ = true;

  const records = [];
  let reqCounter = 0;
  let domainOnly = true;

  function shouldCapture(url) {
    if (!domainOnly) return true;
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

  function now() {
    return new Date().toISOString();
  }

  function safeJson(data) {
    try {
      if (typeof data === 'string') return JSON.parse(data);
      return data;
    } catch (e) {
      return data;
    }
  }

  function logRecord(r) {
    const style = r.status >= 200 && r.status < 300
      ? 'color: #2e7d32; font-weight: bold;'
      : 'color: #c62828; font-weight: bold;';

    console.groupCollapsed(
      `%c[API Sniffer] ${r.method} ${r.status} ${r.duration}ms | ${r.url}`,
      style
    );
    console.log('时间:', r.timestamp);
    console.log('类型:', r.type);
    console.log('请求头:', r.requestHeaders);
    console.log('请求体:', r.requestBody);
    console.log('响应头:', r.responseHeaders);
    console.log('响应体:', r.responseBody);
    console.groupEnd();
  }

  // ========== fetch 拦截 ==========
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const id = ++reqCounter;
    const t0 = performance.now();
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || (typeof input === 'object' && input.method) || 'GET';

    let reqBody = init.body;
    if (reqBody instanceof FormData) {
      const obj = {};
      reqBody.forEach((v, k) => obj[k] = v);
      reqBody = obj;
    } else if (reqBody instanceof URLSearchParams) {
      reqBody = reqBody.toString();
    } else if (typeof reqBody !== 'string' && reqBody != null) {
      try { reqBody = await new Response(reqBody).text(); } catch (e) { reqBody = '[Stream]'; }
    }

    let reqHeaders = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => reqHeaders[k] = v);
      } else {
        reqHeaders = { ...init.headers };
      }
    }

    try {
      const res = await _fetch.apply(this, args);
      const t1 = performance.now();
      const clone = res.clone();
      let resBody;
      let resType = 'text';
      const ct = clone.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        resBody = await clone.json();
        resType = 'json';
      } else if (ct.includes('text/') || ct.includes('javascript') || ct.includes('xml') || ct.includes('html')) {
        resBody = await clone.text();
        resType = 'text';
      } else {
        resBody = await clone.text();
        resType = 'blob';
      }

      if (typeof resBody === 'string' && resBody.length > 10240) {
        resBody = resBody.substring(0, 10240) + '\n\n[已截断，原长度 ' + resBody.length + ' 字符]';
      }

      let resHeaders = {};
      res.headers.forEach((v, k) => resHeaders[k] = v);

      const record = {
        id, type: 'fetch', url, method,
        status: res.status, statusText: res.statusText,
        requestHeaders: reqHeaders, requestBody: reqBody,
        responseHeaders: resHeaders, responseBody: resBody, responseType: resType,
        timestamp: now(), duration: parseFloat((t1 - t0).toFixed(2))
      };
      if (shouldCapture(url)) {
        records.push(record);
        logRecord(record);
      }
      return res;
    } catch (err) {
      const t1 = performance.now();
      const record = {
        id, type: 'fetch', url, method,
        status: 0, statusText: 'Network Error',
        requestHeaders: reqHeaders, requestBody: reqBody,
        responseHeaders: {}, responseBody: err.message || String(err), responseType: 'error',
        timestamp: now(), duration: parseFloat((t1 - t0).toFixed(2)), error: true
      };
      if (shouldCapture(url)) {
        records.push(record);
        logRecord(record);
      }
      throw err;
    }
  };

  // ========== XHR 拦截 ==========
  const _XHR = window.XMLHttpRequest;
  const _open = _XHR.prototype.open;
  const _send = _XHR.prototype.send;
  const _setHeader = _XHR.prototype.setRequestHeader;

  window.XMLHttpRequest = function() {
    const xhr = new _XHR();
    const id = ++reqCounter;
    const t0 = performance.now();
    let method = 'GET';
    let url = '';
    let reqHeaders = {};
    let reqBody = null;

    xhr.open = function(m, u, ...rest) {
      method = m; url = u;
      return _open.call(xhr, m, u, ...rest);
    };
    xhr.setRequestHeader = function(h, v) {
      reqHeaders[h] = v;
      return _setHeader.call(xhr, h, v);
    };
    xhr.send = function(body) {
      reqBody = body;
      if (body instanceof FormData) {
        const obj = {};
        body.forEach((v, k) => obj[k] = v);
        reqBody = obj;
      }

      xhr.addEventListener('load', function() {
        const t1 = performance.now();
        let resBody = xhr.responseText;
        let resType = 'text';
        try {
          const ct = xhr.getResponseHeader('content-type') || '';
          if (ct.includes('application/json')) {
            resBody = JSON.parse(xhr.responseText);
            resType = 'json';
          }
        } catch (e) {}

        if (typeof resBody === 'string' && resBody.length > 10240) {
          resBody = resBody.substring(0, 10240) + '\n\n[已截断，原长度 ' + resBody.length + ' 字符]';
        }

        const record = {
          id, type: 'xhr', url, method,
          status: xhr.status, statusText: xhr.statusText,
          requestHeaders: reqHeaders, requestBody: reqBody,
          responseHeaders: parseXHRHeaders(xhr.getAllResponseHeaders()),
          responseBody: resBody, responseType: resType,
          timestamp: now(), duration: parseFloat((t1 - t0).toFixed(2))
        };
        if (shouldCapture(url)) {
          records.push(record);
          logRecord(record);
        }
      });

      xhr.addEventListener('error', function() {
        const t1 = performance.now();
        const record = {
          id, type: 'xhr', url, method,
          status: 0, statusText: 'Network Error',
          requestHeaders: reqHeaders, requestBody: reqBody,
          responseHeaders: {}, responseBody: 'XHR Error', responseType: 'error',
          timestamp: now(), duration: parseFloat((t1 - t0).toFixed(2)), error: true
        };
        if (shouldCapture(url)) {
          records.push(record);
          logRecord(record);
        }
      });

      return _send.call(xhr, body);
    };

    return xhr;
  };

  function parseXHRHeaders(str) {
    const h = {};
    if (!str) return h;
    str.trim().split(/[\r\n]+/).forEach(line => {
      const parts = line.split(': ');
      const key = parts.shift();
      if (key) h[key] = parts.join(': ');
    });
    return h;
  }

  // ========== 导出工具 ==========
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }, 100);
  }

  window.apiSniffer = {
    getRecords() { return records; },
    clear() { records.length = 0; console.log('[API Sniffer] 已清空记录'); },
    domainOnly(enable) {
      domainOnly = enable !== undefined ? enable : true;
      console.log('[API Sniffer] 域名过滤:', domainOnly ? '仅当前域名' : '全部域名');
    },
    exportSummary() {
      const groups = {};
      records.forEach(r => {
        const key = (r.method || 'GET') + ' ' + (r.url || '');
        if (!groups[key]) {
          groups[key] = {
            method: r.method, url: r.url, count: 0, statusCodes: {},
            avgDuration: 0, firstTime: r.timestamp, lastTime: r.timestamp,
            minDuration: Infinity, maxDuration: 0
          };
        }
        const g = groups[key];
        g.count++;
        g.statusCodes[r.status] = (g.statusCodes[r.status] || 0) + 1;
        g.avgDuration += r.duration || 0;
        g.lastTime = r.timestamp;
        if (r.duration < g.minDuration) g.minDuration = r.duration;
        if (r.duration > g.maxDuration) g.maxDuration = r.duration;
      });
      const summary = Object.values(groups).map(g => ({
        method: g.method, url: g.url, count: g.count,
        statusCodes: g.statusCodes,
        avgDuration: parseFloat((g.avgDuration / g.count).toFixed(1)),
        minDuration: g.minDuration === Infinity ? 0 : g.minDuration,
        maxDuration: g.maxDuration,
        firstTime: g.firstTime, lastTime: g.lastTime
      }));
      summary.sort((a, b) => b.count - a.count);
      const output = JSON.stringify({
        totalRequests: records.length,
        uniqueEndpoints: summary.length,
        generatedAt: new Date().toISOString(),
        endpoints: summary
      }, null, 2);
      download(`api_summary_${Date.now()}.json`, output, 'application/json');
      console.log('[API Sniffer] 摘要已下载');
    },
    exportJSON() {
      const json = JSON.stringify(records, null, 2);
      download(`api_records_${Date.now()}.json`, json, 'application/json');
      console.log('[API Sniffer] JSON 已下载');
    },
    exportCSV() {
      const headers = ['timestamp', 'type', 'method', 'url', 'status', 'duration(ms)', 'respSize', 'respType'];
      const rows = records.map(r => {
        const respSize = typeof r.responseBody === 'string' ? r.responseBody.length : JSON.stringify(r.responseBody || '').length;
        return [
          r.timestamp, r.type, r.method, r.url, r.status, r.duration, respSize, r.responseType || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      });
      const csv = ['\uFEFF' + headers.join(','), ...rows].join('\n');
      download(`api_records_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
      console.log('[API Sniffer] CSV 已下载');
    },
    exportHAR() {
      const har = {
        log: {
          version: '1.2',
          creator: { name: 'API Sniffer Console', version: '1.0' },
          entries: records.map(r => ({
            startedDateTime: r.timestamp,
            time: r.duration,
            request: {
              method: r.method,
              url: r.url,
              headers: Object.entries(r.requestHeaders || {}).map(([name, value]) => ({ name, value })),
              postData: r.requestBody ? {
                mimeType: typeof r.requestBody === 'string' ? 'text/plain' : 'application/json',
                text: typeof r.requestBody === 'string' ? r.requestBody : JSON.stringify(r.requestBody)
              } : undefined
            },
            response: {
              status: r.status,
              statusText: r.statusText,
              headers: Object.entries(r.responseHeaders || {}).map(([name, value]) => ({ name, value })),
              content: {
                size: -1,
                mimeType: r.responseType === 'json' ? 'application/json' : 'text/plain',
                text: typeof r.responseBody === 'string' ? r.responseBody : JSON.stringify(r.responseBody)
              }
            }
          }))
        }
      };
      download(`api_records_${Date.now()}.har`, JSON.stringify(har, null, 2), 'application/json');
      console.log('[API Sniffer] HAR 已下载');
    },
    help() {
      console.log(`%c[API Sniffer] 可用命令：\n` +
        `  apiSniffer.getRecords()       - 获取所有记录\n` +
        `  apiSniffer.clear()            - 清空记录\n` +
        `  apiSniffer.domainOnly(true/false) - 域名过滤（默认仅当前域名）\n` +
        `  apiSniffer.exportJSON()       - 导出完整 JSON\n` +
        `  apiSniffer.exportSummary()    - 导出摘要（按URL去重，不含响应体）\n` +
        `  apiSniffer.exportCSV()        - 导出为 CSV\n` +
        `  apiSniffer.exportHAR()        - 导出为 HAR\n` +
        `  apiSniffer.help()             - 显示帮助`,
        'color: #1a73e8; font-weight: bold;');
    }
  };

  console.log('%c[API Sniffer] 已启动监听！默认仅捕获当前域名请求。\n输入 apiSniffer.help() 查看可用命令。', 'color: #1a73e8; font-size: 14px; font-weight: bold;');
  window.apiSniffer.help();
})();
