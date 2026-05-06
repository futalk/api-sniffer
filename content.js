(function() {
  'use strict';

  // 避免重复注入
  if (document.documentElement.dataset.apiSnifferInjected) return;
  document.documentElement.dataset.apiSnifferInjected = 'true';

  // 将 injected.js 注入到页面上下文中（这样才能劫持页面自己的 fetch/XHR）
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    console.log('[API Sniffer] injected.js loaded successfully');
    script.remove();
    // 注入完成后，同步 domainOnly 设置到页面上下文
    syncSettingsToPage();
  };
  script.onerror = function(err) {
    console.error('[API Sniffer] Failed to load injected.js', err);
  };
  (document.head || document.documentElement).appendChild(script);
  console.log('[API Sniffer] content.js running on', location.href);

  function sendToPage(action, value) {
    window.postMessage({
      source: 'api-sniffer-control',
      action: action,
      value: value
    }, location.origin);
  }

  function syncSettingsToPage() {
    chrome.storage.local.get(['domainOnly', 'paused'], function(result) {
      if (result.domainOnly !== undefined) {
        sendToPage('setDomainOnly', result.domainOnly);
      }
      if (result.paused !== undefined) {
        sendToPage('setPaused', result.paused);
      }
    });
  }

  // 接收来自扩展的消息（设置变更等）
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'setDomainOnly') {
      sendToPage('setDomainOnly', message.value);
    }
    if (message.action === 'setPaused') {
      sendToPage('setPaused', message.value);
    }
  });

  // 接收来自 injected.js 的消息
  window.addEventListener('message', function(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data && event.data.source === 'api-sniffer-injected' && event.data.record) {
      console.log('[API Sniffer] content.js received record from injected.js:', event.data.record.url);
      // 转发给 background.js
      try {
        chrome.runtime.sendMessage({
          action: 'newRecord',
          record: event.data.record
        });
        console.log('[API Sniffer] sendMessage to background success');
      } catch (e) {
        console.error('[API Sniffer] sendMessage error:', e);
      }
    }
  });
})();
