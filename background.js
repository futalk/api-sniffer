chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'newRecord') {
    console.log('[API Sniffer] background received newRecord:', message.record.url);
    // 将记录存储到本地
    chrome.storage.local.get(['apiRecords'], (result) => {
      const records = result.apiRecords || [];
      records.push(message.record);
      // 最多保留最近 5000 条，防止内存溢出
      if (records.length > 5000) {
        records.splice(0, records.length - 5000);
      }
      chrome.storage.local.set({ apiRecords: records }, () => {
        console.log('[API Sniffer] record saved, total:', records.length);
        chrome.runtime.sendMessage({ action: 'recordsUpdated' }).catch(() => {});

        // 实时保存到本地
        chrome.storage.local.get(['autoSave', 'savePath'], (settings) => {
          if (settings.autoSave !== true) return;
          saveRecordToFile(message.record, settings.savePath || 'api-sniffer');
        });
      });
    });
    return;
  }

  if (message.action === 'getRecords') {
    chrome.storage.local.get(['apiRecords'], (result) => {
      sendResponse({ records: result.apiRecords || [] });
    });
    return true; // 保持消息通道打开
  }

  if (message.action === 'deleteRecord') {
    chrome.storage.local.get(['apiRecords'], (result) => {
      const records = (result.apiRecords || []).filter(r => r.id !== message.id);
      chrome.storage.local.set({ apiRecords: records }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.action === 'clearRecords') {
    chrome.storage.local.set({ apiRecords: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'getDomainOnly') {
    chrome.storage.local.get(['domainOnly'], (result) => {
      sendResponse({ domainOnly: result.domainOnly !== undefined ? result.domainOnly : true });
    });
    return true;
  }

  if (message.action === 'setDomainOnly') {
    const value = message.value;
    chrome.storage.local.set({ domainOnly: value }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'setDomainOnly', value }).catch(() => {});
          }
        });
      });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'setPaused') {
    const value = message.value;
    chrome.storage.local.set({ paused: value }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'setPaused', value }).catch(() => {});
          }
        });
      });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'replayRequest') {
    handleReplayRequest(message.record).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ status: 0, statusText: 'Replay Error', headers: {}, body: err.message || String(err), duration: 0 });
    });
    return true;
  }

  if (message.action === 'downloadRecords') {
    const format = message.format || 'json';
    const providedRecords = message.records;

    function doDownload(records) {
      try {
        let content = '';
        let mimeType = '';
        let filename = '';

        if (format === 'json') {
          content = JSON.stringify(records, null, 2);
          mimeType = 'application/json';
          filename = `api_records_${Date.now()}.json`;
        } else if (format === 'summary') {
          content = buildSummary(records);
          mimeType = 'application/json';
          filename = `api_summary_${Date.now()}.json`;
        } else if (format === 'har') {
          const har = buildHAR(records);
          content = JSON.stringify(har, null, 2);
          mimeType = 'application/json';
          filename = `api_records_${Date.now()}.har`;
        } else if (format === 'postman') {
          const collection = buildPostmanCollection(records);
          content = JSON.stringify(collection, null, 2);
          mimeType = 'application/json';
          filename = `postman_collection_${Date.now()}.json`;
        } else if (format === 'csv') {
          content = '\uFEFF' + buildCSV(records);
          mimeType = 'text/csv;charset=utf-8';
          filename = `api_records_${Date.now()}.csv`;
        }

        // 使用 base64 data URL，兼容 Service Worker（URL.createObjectURL 在部分 Chrome 版本中不可用）
        const encoded = btoa(unescape(encodeURIComponent(content)));
        const dataUrl = `data:${mimeType};base64,${encoded}`;

        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('[API Sniffer] download failed:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log('[API Sniffer] download started, id:', downloadId);
            sendResponse({ success: true, downloadId });
          }
        });
      } catch (err) {
        console.error('[API Sniffer] download exception:', err);
        sendResponse({ success: false, error: err.message });
      }
    }

    if (providedRecords && providedRecords.length > 0) {
      doDownload(providedRecords);
    } else {
      chrome.storage.local.get(['apiRecords'], (result) => {
        doDownload(result.apiRecords || []);
      });
    }
    return true;
  }
});

function safeFilename(str) {
  return String(str).replace(/[\\/:*?"<>|]/g, '_').replace(/^[A-Za-z]:/, '').substring(0, 100);
}

function saveRecordToFile(record, savePath) {
  try {
    // 确保子目录名不含非法字符，去掉可能的绝对路径前缀
    const cleanSavePath = safeFilename(savePath).replace(/^_+/, '') || 'api-sniffer';

    const url = record.url || 'unknown';
    let domain = 'unknown';
    let pathname = '';
    try {
      const u = new URL(url);
      domain = u.hostname;
      pathname = u.pathname;
    } catch (e) {}

    const ts = record.timestamp ? record.timestamp.replace(/[:.]/g, '-') : Date.now();
    const method = record.method || 'GET';
    const cleanPath = safeFilename(pathname.replace(/^\//, '').replace(/\//g, '_') || 'root');
    const dir = cleanSavePath + '/' + safeFilename(domain);
    const filename = dir + '/' + ts + '_' + method + '_' + cleanPath + '.json';

    const content = JSON.stringify(record, null, 2);
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = 'data:application/json;base64,' + encoded;

    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[API Sniffer] auto-save failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[API Sniffer] auto-saved: 下载文件夹/' + filename, 'id:', downloadId);
      }
    });
  } catch (err) {
    console.error('[API Sniffer] auto-save exception:', err);
  }
}

async function handleReplayRequest(record) {
  const { method, url, requestHeaders, requestBody } = record;
  const startTime = performance.now();

  const fetchOptions = {
    method: method || 'GET',
    headers: requestHeaders || {},
    credentials: 'include'
  };

  // GET/HEAD 请求不应带 body
  const hasBody = method && !['GET', 'HEAD'].includes(method.toUpperCase());
  if (hasBody && requestBody != null) {
    if (typeof requestBody === 'string') {
      fetchOptions.body = requestBody;
    } else {
      fetchOptions.body = JSON.stringify(requestBody);
      if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }
  }

  const resp = await fetch(url, fetchOptions);
  const duration = parseFloat((performance.now() - startTime).toFixed(1));

  const responseHeaders = {};
  resp.headers.forEach((v, k) => { responseHeaders[k] = v; });

  let responseBody;
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    responseBody = await resp.json();
  } else {
    responseBody = await resp.text();
  }

  if (typeof responseBody === 'string' && responseBody.length > 10240) {
    responseBody = responseBody.substring(0, 10240) + '\n\n[已截断，原长度 ' + responseBody.length + ' 字符]';
  }

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
    body: responseBody,
    duration: duration
  };
}

function buildHAR(records) {
  const entries = records.map(r => {
    const startTime = new Date(r.timestamp).getTime();
    return {
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
    };
  });

  return {
    log: {
      version: '1.2',
      creator: { name: 'API Sniffer', version: '1.0.0' },
      entries: entries
    }
  };
}

function parseUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.hostname.split('.'),
      port: u.port || undefined,
      path: u.pathname.split('/').filter(Boolean),
      query: Array.from(u.searchParams.entries()).map(([key, value]) => ({ key, value })),
      raw: rawUrl
    };
  } catch (e) {
    return { protocol: 'https', host: [''], path: [rawUrl], query: [], raw: rawUrl };
  }
}

function formatBody(requestBody) {
  if (requestBody == null) return undefined;
  if (typeof requestBody === 'string') {
    try {
      JSON.parse(requestBody);
      return { mode: 'raw', raw: requestBody, options: { raw: { language: 'json' } } };
    } catch (e) {
      return { mode: 'raw', raw: requestBody };
    }
  }
  return { mode: 'raw', raw: JSON.stringify(requestBody), options: { raw: { language: 'json' } } };
}

function buildPostmanCollection(records) {
  const items = records.map((r, idx) => {
    const urlObj = parseUrl(r.url || '');
    const headerList = Object.entries(r.requestHeaders || {}).map(([key, value]) => ({
      key, value: String(value), type: 'text'
    }));

    const item = {
      name: (r.method || 'GET') + ' ' + (r.url || ''),
      request: {
        method: r.method || 'GET',
        header: headerList,
        url: {
          raw: r.url || '',
          protocol: urlObj.protocol,
          host: urlObj.host,
          port: urlObj.port,
          path: urlObj.path,
          query: urlObj.query
        }
      },
      response: [{
        name: 'Recorded Response',
        status: r.statusText || 'OK',
        code: r.status || 200,
        header: Object.entries(r.responseHeaders || {}).map(([key, value]) => ({
          key, value: String(value)
        })),
        body: typeof r.responseBody === 'string' ? r.responseBody : JSON.stringify(r.responseBody, null, 2)
      }]
    };

    const body = formatBody(r.requestBody);
    if (body) {
      item.request.body = body;
    }

    return item;
  });

  return {
    info: {
      name: 'API Sniffer Export',
      description: 'Exported from API Sniffer extension. Total requests: ' + records.length,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: items
  };
}

function buildSummary(records) {
  // 按 URL+Method 分组，去重统计
  const groups = {};
  records.forEach(r => {
    const key = (r.method || 'GET') + ' ' + (r.url || '');
    if (!groups[key]) {
      groups[key] = {
        method: r.method,
        url: r.url,
        count: 0,
        statusCodes: {},
        avgDuration: 0,
        firstTime: r.timestamp,
        lastTime: r.timestamp,
        minDuration: Infinity,
        maxDuration: 0
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
    method: g.method,
    url: g.url,
    count: g.count,
    statusCodes: g.statusCodes,
    avgDuration: parseFloat((g.avgDuration / g.count).toFixed(1)),
    minDuration: g.minDuration === Infinity ? 0 : g.minDuration,
    maxDuration: g.maxDuration,
    firstTime: g.firstTime,
    lastTime: g.lastTime
  }));

  summary.sort((a, b) => b.count - a.count);

  return JSON.stringify({
    totalRequests: records.length,
    uniqueEndpoints: summary.length,
    generatedAt: new Date().toISOString(),
    endpoints: summary
  }, null, 2);
}

function buildCSV(records) {
  const headers = ['timestamp', 'type', 'method', 'url', 'status', 'duration(ms)', 'respSize', 'respType'];
  const rows = records.map(r => {
    const respSize = typeof r.responseBody === 'string' ? r.responseBody.length : JSON.stringify(r.responseBody || '').length;
    return [
      r.timestamp,
      r.type,
      r.method,
      r.url,
      r.status,
      r.duration,
      respSize,
      r.responseType || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
