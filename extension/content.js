// Gemini YouTube Summary Automator (Native Chrome Extension Edition)

(function() {
    'use strict';

    const urlParams = new URLSearchParams(window.location.search);
    const autoPrompt = urlParams.get('auto_prompt');
    if (!autoPrompt) return;

    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    let hasSent = false;

    // ----- 第一阶段：自动发送 -----
    const initObserver = new MutationObserver((mutations, obs) => {
        if (hasSent) return;

        const editor = document.querySelector('rich-textarea div[contenteditable="true"], div.ql-editor');
        const sendButton = document.querySelector('button[aria-label="Send message"], button[aria-label="发送消息"], .send-button');

        if (editor && sendButton && !sendButton.disabled) {
            obs.disconnect();
            editor.focus();
            document.execCommand('insertText', false, autoPrompt);

            let checkReady = setInterval(() => {
                if (!sendButton.disabled && editor.textContent.includes(autoPrompt.substring(0, 5))) {
                    clearInterval(checkReady);
                    hasSent = true;
                    sendButton.click();
                    startCompletionObserver();
                }
            }, 100);
        }
    });

    initObserver.observe(document.body, { childList: true, subtree: true });

    // ----- 第二阶段：监听生成完毕 -----
    function startCompletionObserver() {
        let lastLength = 0;
        let stableCount = 0;
        let checkInterval = null;

        console.log("🚀 进入字数静止判定模式...");

        setTimeout(() => {
            checkInterval = setInterval(() => {
                const responseBlocks = Array.from(document.querySelectorAll('message-content, .message-content, .model-response-text, [data-test-id="model-response"], div[class*="message-content"]'));
                const stopButtons = Array.from(document.querySelectorAll('button[aria-label*="Stop"], button[aria-label*="停止"], [data-test-id*="stop"]')).filter(isVisible);
                
                if (responseBlocks.length > 0) {
                    const lastBlock = responseBlocks[responseBlocks.length - 1];
                    const currentText = lastBlock.innerText || lastBlock.textContent;
                    const currentLength = currentText.length;

                    if (currentLength > 50 && stopButtons.length === 0) {
                        if (currentLength === lastLength) {
                            stableCount++;
                        } else {
                            stableCount = 0;
                            lastLength = currentLength;
                        }

                        if (stableCount >= 3) {
                            clearInterval(checkInterval);
                            console.log("✅ 检测到生成完毕，开始执行后续动作。");
                            executePostGenerationTasks(currentText);
                        }
                    }
                }
            }, 1000);
        }, 5000);
    }

    // ----- 第三阶段：防阻塞流水线 -----
    async function executePostGenerationTasks(summaryText) {
        try {
            downloadMarkdown(summaryText);
        } catch (e) {
            console.error("❌ MD 下载报错:", e);
        }

        try {
            await moveCurrentToNotebook('youtube-summeries');
        } catch (e) {
            console.error("❌ 归档报错详情:", e);
        }

        setTimeout(() => {
            chrome.runtime.sendMessage({action: "closeTab"});
        }, 1500);
    }

    function downloadMarkdown(text) {
        let title = "youtube_summary_" + new Date().getTime();
        const lines = text.trim().split('\n');
        if (lines.length > 0) {
            let firstLine = lines[0].replace(/[#*`]/g, '').trim();
            if (firstLine.length > 0 && firstLine.length < 50) {
                // 恢复稍微宽松的过滤，因为 Chrome 插件天然支持建文件夹
                title = firstLine.replace(/[\/\\:*?"<>|]/g, ' ').trim();
            }
        }

        console.log(`[下载追踪] 准备发送消息给 Background 脚本下载: youtube-summeries/${title}.md`);
        
        // 调用 Chrome 插件独有的原生下载接口，100% 能建文件夹
        chrome.runtime.sendMessage({
            action: "downloadMarkdown",
            text: text,
            filename: title
        });
    }

    // ---------- UI 自动化助手函数 ----------

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function simulateFullClick(el) {
        if (!el) return;
        try { el.scrollIntoView({ block: 'nearest' }); } catch(e) {}
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    async function waitFor(predicate, timeout = 3000) {
        const check = () => { try { return predicate(); } catch (e) { return false; } };
        const initial = check();
        if (initial) return initial;

        return new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
                const result = check();
                if (result) { observer.disconnect(); resolve(result); }
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
            setTimeout(() => { observer.disconnect(); reject(new Error('Timeout')); }, timeout);
        });
    }

    async function moveCurrentToNotebook(notebookName) {
        console.log(`[归档追踪 1] 寻找侧边栏当前对话... 当前路径=${window.location.pathname}`);
        
        const row = await waitFor(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/app/"], a[href*="/gem/"]')).filter(l => !l.closest('header'));
            
            let active = links.find(el => el.getAttribute('aria-current') === 'page' || el.classList.contains('active') || el.classList.contains('selected'));
            if (active) return active;
            
            const pathParts = window.location.pathname.split('/');
            const id = pathParts[pathParts.length - 1]; 
            let match = links.find(el => el.getAttribute('href') && el.getAttribute('href').includes(id));
            if (match) return match;
            
            return links[0];
        }, 5000);

        if (!row) throw new Error('在侧边栏找不到任何对话条目');
        console.log(`[归档追踪 2] 找到侧边栏元素，准备模拟悬停并寻找三个点菜单`);

        [row, row.parentElement].forEach(el => {
            if (el) {
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
        });

        const menuButtons = Array.from(row.parentElement.querySelectorAll('button')).filter(btn =>
            btn.hasAttribute('aria-haspopup') ||
            (btn.getAttribute('aria-label') || '').includes('选项') ||
            (btn.getAttribute('data-test-id') || '').includes('menu')
        );
        const menuButton = menuButtons.pop();
        if (!menuButton) throw new Error('找不到侧边栏的三个点菜单按钮');

        menuButton.style.visibility = 'visible';
        menuButton.style.opacity = '1';
        menuButton.click();
        console.log(`[归档追踪 3] 已点击三个点菜单，正在寻找包含"笔记本"的选项`);
        
        await new Promise(r => setTimeout(r, 400));

        const addOption = await waitFor(() => {
            const btns = Array.from(document.querySelectorAll('button[role="menuitem"], li[role="menuitem"], [role="menu"] button, [role="menu"] li, [data-test-id*="notebook"]'));
            for (let i = btns.length - 1; i >= 0; i--) {
                const b = btns[i];
                if (isVisible(b) && (b.textContent.includes('笔记本') || b.textContent.includes('notebook') || b.textContent.includes('Notebook') || b.textContent.includes('Save')) && !b.closest('nav') && !b.closest('aside')) {
                    return b;
                }
            }
            return null;
        }, 3000);
        if (!addOption) throw new Error('在弹出菜单里没找到"笔记本"选项');
        simulateFullClick(addOption);

        console.log(`[归档追踪 4] 已点击笔记本选项，寻找指定笔记本：${notebookName}`);
        await new Promise(r => setTimeout(r, 600));

        const notebookOption = await waitFor(() => {
            const items = Array.from(document.querySelectorAll('button, li, [role="menuitem"], [role="option"], span'));
            for (let i = items.length - 1; i >= 0; i--) {
                const b = items[i];
                if (isVisible(b) && b.textContent.toLowerCase().includes(notebookName.toLowerCase()) && !b.closest('nav') && !b.closest('aside')) {
                    return b;
                }
            }
            return null;
        }, 3000);
        if (!notebookOption) throw new Error(`找不到名为 ${notebookName} 的笔记本`);
        simulateFullClick(notebookOption);
        console.log(`[归档追踪 5] 找到并点击了目标笔记本 ${notebookName}`);

        await new Promise(r => setTimeout(r, 400));
        
        const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
            isVisible(b) && (b.textContent.includes('保存') || b.textContent.includes('Save') || b.textContent.includes('完成') || b.textContent.includes('Done')) && b.closest('[role="dialog"], dialog')
        );
        if (saveBtn) {
            simulateFullClick(saveBtn);
            console.log(`[归档追踪 6] 点击了弹窗内的确认保存按钮`);
        }
        
        await new Promise(r => setTimeout(r, 800));
    }
})();
