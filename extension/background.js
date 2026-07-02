chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "downloadMarkdown") {
    const { text, filename } = message;
    
    // Safely encode to base64 avoiding call stack size limits and handling UTF-8 properly
    const utf8Bytes = new TextEncoder().encode(text);
    const binString = Array.from(utf8Bytes, (byte) => String.fromCharCode(byte)).join("");
    const base64 = btoa(binString);
    const url = 'data:text/markdown;charset=utf-8;base64,' + base64;

    chrome.downloads.download({
      url: url,
      filename: `youtube-summeries/${filename}.md`,
      saveAs: false
    });
    sendResponse({ success: true });
  } else if (message.action === "closeTab") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    sendResponse({ success: true });
  } else if (message.action === "startBatchSync") {
    processBatchUrls(message.urls, sender.tab.id);
    sendResponse({ success: true });
  } else if (message.action === "checkExtractionStatus") {
    if (sender.tab && extractionTabs.has(sender.tab.id)) {
      sendResponse({ shouldExtract: true });
    } else {
      sendResponse({ shouldExtract: false });
    }
  }
  return true; // Keep message channel open for async responses if needed
});

let isBatching = false;
const extractionTabs = new Set();

async function processBatchUrls(urls, originalTabId) {
  if (isBatching) return;
  isBatching = true;
  try {
    for (const url of urls) {
      // 必须 active: true，否则 Chrome 后台标签页会暂停 requestAnimationFrame，
      // 导致 Gemini 的 Angular/React 框架根本不渲染聊天内容的 DOM 和侧边栏 UI。
      const tab = await chrome.tabs.create({ url: url, active: true });
      extractionTabs.add(tab.id);
      
      // Wait for it to close
      await new Promise(resolve => {
        const listener = (tabId, removeInfo) => {
          if (tabId === tab.id) {
            chrome.tabs.onRemoved.removeListener(listener);
            extractionTabs.delete(tab.id);
            resolve();
          }
        };
        chrome.tabs.onRemoved.addListener(listener);
        
        // Timeout safeguard
        setTimeout(() => {
          chrome.tabs.onRemoved.removeListener(listener);
          extractionTabs.delete(tab.id);
          chrome.tabs.remove(tab.id).catch(() => {});
          resolve();
        }, 60000); // 60s timeout per tab max
      });
      
      await new Promise(r => setTimeout(r, 1500)); // anti-spam
    }
  } catch (e) {
    console.error(e);
  } finally {
    isBatching = false;
    if (originalTabId) {
      chrome.tabs.sendMessage(originalTabId, { action: "batchSyncDone" }).catch(() => {});
    }
  }
}
