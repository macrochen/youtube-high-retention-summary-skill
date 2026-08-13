let isBatching = false;
const extractionTabs = new Set();

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
      filename: `youtube-summaries/${filename}.md`,
      saveAs: false
    });
    sendResponse({ success: true });
  } else if (message.action === "closeTab") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    sendResponse({ success: true });
  } else if (message.action === "startExtractionTab") {
    const mainTabId = sender.tab ? sender.tab.id : null;
    chrome.tabs.create({ url: message.url, active: false }).then(tab => {
       const tabIdToWait = tab.id;
       extractionTabs.add(tabIdToWait);

       const listener = (tabId, removeInfo) => {
          if (tabId === tabIdToWait) {
             chrome.tabs.onRemoved.removeListener(listener);
             extractionTabs.delete(tabIdToWait);
             if (mainTabId) {
                chrome.tabs.sendMessage(mainTabId, { action: "extractionDone", url: message.url }).catch(() => {});
             }
          }
       };
       chrome.tabs.onRemoved.addListener(listener);
       
       // Timeout safeguard for the extraction tab
       setTimeout(() => {
          chrome.tabs.onRemoved.removeListener(listener);
          extractionTabs.delete(tabIdToWait);
          chrome.tabs.remove(tabIdToWait).catch(() => {}); // force close it
          if (mainTabId) {
             chrome.tabs.sendMessage(mainTabId, { action: "extractionDone", url: message.url }).catch(() => {});
          }
       }, 60000);
    });
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
