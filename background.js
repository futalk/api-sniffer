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
