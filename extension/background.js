chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "downloadMarkdown") {
    const { text, filename } = message;
    
    // In Service Worker, we can use Data URI
    const utf8Bytes = new TextEncoder().encode(text);
    const base64 = btoa(String.fromCharCode(...utf8Bytes));
    const url = 'data:text/markdown;charset=utf-8;base64,' + base64;

    chrome.downloads.download({
      url: url,
      filename: `youtube-summeries/${filename}.md`,
      saveAs: false
    });
  } else if (message.action === "closeTab") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
  } else if (message.action === "startBatchSync") {
    processBatchUrls(message.urls, sender.tab.id);
  }
});

let isBatching = false;

async function processBatchUrls(urls, originalTabId) {
  if (isBatching) return;
  isBatching = true;
  try {
    for (const url of urls) {
      const batchUrl = new URL(url);
      batchUrl.searchParams.set('batch_sync', 'true');
      
      const tab = await chrome.tabs.create({ url: batchUrl.href, active: false });
      
      // Wait for it to close
      await new Promise(resolve => {
        const listener = (tabId, removeInfo) => {
          if (tabId === tab.id) {
            chrome.tabs.onRemoved.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onRemoved.addListener(listener);
        
        // Timeout safeguard
        setTimeout(() => {
          chrome.tabs.onRemoved.removeListener(listener);
          chrome.tabs.remove(tab.id).catch(() => {});
          resolve();
        }, 30000); // 30s timeout per tab max
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
