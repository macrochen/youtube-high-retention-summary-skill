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
  }
});
