(function() {
  'use strict';

  function log(msg) {
    const el = document.getElementById('debugLog');
    if (el) {
      el.style.display = 'block';
      el.textContent += msg + '\n';
    }
    console.log(msg);
  }

  log('[API Sniffer] popup.js start');

  let allRecords = [];
  let filterText = '';
  let filterMethod = '';
  let filterStatus = '';

  const els = {
    list: document.getElementById('list'),
    count: document.getElementById('count'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnClear: document.getElementById('btnClear'),
    filterUrl: document.getElementById('filterUrl'),
    btnJson: document.getElementById('btnJson'),
    btnHar: document.getElementById('btnHar'),
    btnCsv: document.getElementById('btnCsv'),
    btnSummary: document.getElementById('btnSummary'),
    btnPause: document.getElementById('btnPause'),
    toggleDomainOnly: document.getElementById('toggleDomainOnly'),
  };

  if (!els.list) {
    log('[API Sniffer] ERROR: list element not found');
    return;
  }
  if (!els.count) {
    log('[API Sniffer] ERROR: count element not found');
    return;
  }

  log('[API Sniffer] elements found OK');

  function safeJson(data) {
    try {
      if (typeof data === 'object') return JSON.stringify(data, null, 2);
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch (e) {
      return String(data);
    }
  }

  function getStatusClass(status) {
    if (!status || status >= 400 || status === 0) return 'err';
    return 'ok';
  }

  function getMethodClass(method) {
    const m = String(method).toUpperCase();
    const map = { GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', PATCH: 'PATCH' };
    return map[m] || 'OTHER';
  }

  function matchesStatus(r) {
    if (!filterStatus) return true;
    const s = r.status || 0;
    if (filterStatus === 'error') return s === 0 || s >= 400;
    if (filterStatus === '2xx') return s >= 200 && s < 300;
    if (filterStatus === '3xx') return s >= 300 && s < 400;
    if (filterStatus === '4xx') return s >= 400 && s < 500;
    if (filterStatus === '5xx') return s >= 500 && s < 600;
    return true;
  }

  function getFilteredRecords() {
    return allRecords.filter(r => {
      if (filterMethod && String(r.method || '').toUpperCase() !== filterMethod) return false;
      if (filterStatus && !matchesStatus(r)) return false;
      if (filterText && String(r.url || '').toLowerCase().indexOf(filterText) === -1) return false;
      return true;
    });
  }

  function render(records) {
    allRecords = records || [];
    const filtered = getFilteredRecords();

    els.count.textContent = (filtered.length) + ' 条记录';

    if (filtered.length === 0) {
      els.list.innerHTML = '<div class="empty">暂无捕获到的请求</div>';
      return;
    }

    els.list.innerHTML = '';
    const list = filtered.slice().reverse();
    list.forEach((r, idx) => {
      const recordEl = document.createElement('div');
      recordEl.className = 'record';
      recordEl.dataset.index = String(filtered.length - 1 - idx);

      const methodClass = getMethodClass(r.method);
      const statusClass = getStatusClass(r.status);

      recordEl.innerHTML = `
        <div class="record-header">
          <span class="method ${methodClass}">${r.method || 'GET'}</span>
          <span class="status ${statusClass}">${r.status || 0}</span>
          <span class="url" title="${r.url || ''}">${r.url || ''}</span>
          <span class="meta">${r.duration != null ? r.duration + 'ms' : ''}</span>
          <span class="del-btn" data-id="${r.id || ''}" title="删除此条">×</span>
        </div>
        <div class="record-body">
          <div class="section">
            <div class="section-title">URL <button class="copy-btn">复制</button></div>
            <div class="code">${r.url || ''}</div>
          </div>
          <div class="section">
            <div class="section-title">请求头 <button class="copy-btn">复制</button></div>
            <div class="code">${safeJson(r.requestHeaders || {})}</div>
          </div>
          <div class="section">
            <div class="section-title">请求体 <button class="copy-btn">复制</button></div>
            <div class="code">${r.requestBody != null ? safeJson(r.requestBody) : '(无)'}</div>
          </div>
          <div class="section">
            <div class="section-title">响应头 <button class="copy-btn">复制</button></div>
            <div class="code">${safeJson(r.responseHeaders || {})}</div>
          </div>
          <div class="section">
            <div class="section-title">响应体 <button class="copy-btn">复制</button></div>
            <div class="code">${r.responseBody != null ? safeJson(r.responseBody) : '(无)'}</div>
          </div>
          <div class="section">
            <div class="section-title">时间戳</div>
            <div class="code">${r.timestamp || ''}</div>
          </div>
        </div>
      `;

      els.list.appendChild(recordEl);
    });
  }

  function loadRecords() {
    log('[API Sniffer] popup loading records...');
    try {
      chrome.runtime.sendMessage({ action: 'getRecords' }, (response) => {
        if (chrome.runtime.lastError) {
          log('[API Sniffer] popup load error: ' + chrome.runtime.lastError.message);
          return;
        }
        const records = response && response.records ? response.records : [];
        log('[API Sniffer] popup loaded records: ' + records.length);
        render(records);
      });
    } catch (e) {
      log('[API Sniffer] popup load exception: ' + String(e));
    }
  }

  if (els.btnRefresh) {
    els.btnRefresh.addEventListener('click', loadRecords);
  }

  if (els.btnClear) {
    els.btnClear.addEventListener('click', () => {
      if (!confirm('确定要清空所有记录吗？')) return;
      try {
        chrome.runtime.sendMessage({ action: 'clearRecords' }, (response) => {
          if (chrome.runtime.lastError) {
            log('[API Sniffer] clear error: ' + chrome.runtime.lastError.message);
            return;
          }
          loadRecords();
        });
      } catch (e) {
        log('[API Sniffer] clear exception: ' + String(e));
      }
    });
  }

  if (els.filterUrl) {
    els.filterUrl.addEventListener('input', (e) => {
      filterText = String(e.target.value).toLowerCase().trim();
      render(allRecords);
    });
  }

  function download(format) {
    log('[API Sniffer] popup downloading format: ' + format);
    var filtered = getFilteredRecords();
    try {
      chrome.runtime.sendMessage({ action: 'downloadRecords', format: format, records: filtered }, (response) => {
        if (chrome.runtime.lastError) {
          log('[API Sniffer] download error: ' + chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      log('[API Sniffer] download exception: ' + String(e));
    }
  }

  if (els.btnJson) els.btnJson.addEventListener('click', () => download('json'));
  if (els.btnHar) els.btnHar.addEventListener('click', () => download('har'));
  if (els.btnCsv) els.btnCsv.addEventListener('click', () => download('csv'));
  if (els.btnSummary) els.btnSummary.addEventListener('click', () => download('summary'));

  // 方法和状态过滤芯片
  function setupChips(containerId, setter) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      setter(chip.dataset.val || '');
      render(allRecords);
    });
  }

  setupChips('methodChips', (v) => { filterMethod = v; });
  setupChips('statusChips', (v) => { filterStatus = v; });

  // 域名过滤开关
  // 暂停/恢复按钮
  if (els.btnPause) {
    let paused = false;
    chrome.storage.local.get(['paused'], (result) => {
      paused = result.paused || false;
      els.btnPause.textContent = paused ? '已暂停' : '暂停';
      els.btnPause.style.background = paused ? '#fce8e6' : '#fff3e0';
      els.btnPause.style.color = paused ? '#c62828' : '#ef6c00';
    });

    els.btnPause.addEventListener('click', () => {
      paused = !paused;
      els.btnPause.textContent = paused ? '已暂停' : '暂停';
      els.btnPause.style.background = paused ? '#fce8e6' : '#fff3e0';
      els.btnPause.style.color = paused ? '#c62828' : '#ef6c00';
      chrome.runtime.sendMessage({ action: 'setPaused', value: paused });
    });
  }

  if (els.toggleDomainOnly) {
    // 从 storage 加载初始状态
    chrome.storage.local.get(['domainOnly'], (result) => {
      const v = result.domainOnly !== undefined ? result.domainOnly : true;
      els.toggleDomainOnly.checked = v;
    });

    els.toggleDomainOnly.addEventListener('change', () => {
      const v = els.toggleDomainOnly.checked;
      chrome.runtime.sendMessage({ action: 'setDomainOnly', value: v }, (response) => {
        log('[API Sniffer] setDomainOnly: ' + v + ' response: ' + JSON.stringify(response));
      });
    });
  }

  log('[API Sniffer] popup.js initialized');

  // 列表点击事件委托（展开详情 / 删除）
  els.list.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.del-btn');
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.id;
      if (id && confirm('确定删除此条记录？')) {
        chrome.runtime.sendMessage({ action: 'deleteRecord', id: id }, () => {
          loadRecords();
        });
      }
      return;
    }
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      const codeEl = copyBtn.parentElement.nextElementSibling;
      const text = codeEl ? codeEl.textContent : '';
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '已复制';
        setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
      }).catch(() => {
        copyBtn.textContent = '失败';
        setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
      });
      return;
    }
    const header = e.target.closest('.record-header');
    if (header) {
      const body = header.nextElementSibling;
      if (body && body.classList.contains('record-body')) {
        body.classList.toggle('open');
      }
    }
  });

  loadRecords();

  // 实时接收 background 推送，自动刷新列表
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'recordsUpdated') {
      loadRecords();
    }
  });
})();
