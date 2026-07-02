// Gemini YouTube Summary Automator (Native Chrome Extension Edition)

(function() {
    'use strict';

    const urlParams = new URLSearchParams(window.location.search);
    const autoPrompt = urlParams.get('auto_prompt');
    const isBatchSync = urlParams.get('batch_sync') === 'true';

    // 如果是通过批量任务后台打开的隐藏标签页，走这里：
    if (isBatchSync) {
        // 清理 URL 栏看着干净点（虽然是隐藏的）
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        waitForChatAndProcess();
        return;
    }

    // 如果是通过 Python 调度自动唤起的生成任务，走这里：
    if (autoPrompt) {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        handleAutoPromptTask(autoPrompt);
        return;
    }

    // 如果既不是自动生成，也不是批量后台，那这就是用户正常浏览的页面。
    // 我们在这里注入 UI 供用户手动发起批量任务。
    injectBatchUI();

    // ==========================================
    // 逻辑一：批量注入侧边栏 UI
    // ==========================================
    function injectBatchUI() {
        // 监听后台完成消息
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === "batchSyncDone") {
                const btn = document.getElementById('gemini-automator-batch-btn');
                if (btn) {
                    btn.innerHTML = '✅ 处理完成！';
                    setTimeout(() => {
                        btn.innerHTML = '📦 批量归档选中的对话';
                        btn.disabled = false;
                        btn.style.background = '#1a73e8';
                        document.querySelectorAll('.gemini-automator-cb').forEach(cb => cb.checked = false);
                    }, 3000);
                }
            }
        });

        // 持续探测并注入 UI
        setInterval(() => {
            // 完全使用 gemini-chat-exporter 验证过绝对有效的侧边栏选择器逻辑
            const sidebarSelectors = [
                '[data-test-id="chat-history"]',
                'nav[role="navigation"]',
                '.chat-history',
                'aside',
                '[role="navigation"]',
                'nav'
            ];
            
            let sidebar = null;
            for (const selector of sidebarSelectors) {
                sidebar = document.querySelector(selector);
                if (sidebar) break;
            }
            
            if (sidebar) {
                const chatLinks = Array.from(sidebar.querySelectorAll('a[href*="/app/"]'));
                
                chatLinks.forEach(link => {
                    // 避免重复注入
                    if (link.querySelector('.gemini-automator-cb')) return;
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'gemini-automator-cb';
                    cb.style.cssText = 'margin-right: 8px; z-index: 999; position: relative; width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;';
                    
                    // 防止点复选框导致网页跳转
                    cb.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                    
                    link.style.display = 'flex';
                    link.style.alignItems = 'center';
                    link.prepend(cb);
                });
            }

            // 使用悬浮按钮 (Floating Action Button) 避免被侧边栏的 CSS 或 React 刷新给吞掉
            if (!document.getElementById('gemini-automator-batch-btn')) {
                const btn = document.createElement('button');
                btn.id = 'gemini-automator-batch-btn';
                btn.innerHTML = '📦 批量归档选中的对话';
                btn.style.cssText = 'position: fixed; bottom: 20px; left: 20px; z-index: 999999; padding: 12px 20px; background: #1a73e8; color: white; border: none; border-radius: 24px; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: all 0.3s ease;';
                
                // 鼠标悬停特效
                btn.onmouseenter = () => btn.style.transform = 'scale(1.05)';
                btn.onmouseleave = () => btn.style.transform = 'scale(1)';

                btn.onclick = () => {
                    const checked = document.querySelectorAll('.gemini-automator-cb:checked');
                    if (checked.length === 0) {
                        alert('请先在左侧边栏勾选要归档的历史对话！');
                        return;
                    }
                    const urls = Array.from(checked).map(cb => cb.closest('a').href);
                    chrome.runtime.sendMessage({ action: 'startBatchSync', urls: urls });
                    btn.innerHTML = `正在后台静默处理 ${urls.length} 个任务...`;
                    btn.disabled = true;
                    btn.style.background = '#888';
                };
                document.body.appendChild(btn);
            }
        }, 2000);
    }

    // ==========================================
    // 逻辑二：处理批量任务的隐藏标签页提取
    // ==========================================
    function waitForChatAndProcess() {
        console.log("🚀 进入批量提取模式，等待聊天内容加载...");
        
        // 为了防止页面没加载好提取到空内容，我们要等得久一点，确保 DOM 稳定
        let stableCount = 0;
        let lastLength = 0;

        let checkInterval = setInterval(() => {
            const responseBlocks = Array.from(document.querySelectorAll('message-content, .message-content, .model-response-text, [data-test-id="model-response"], div[class*="message-content"]'));
            const skeletons = document.querySelectorAll('.skeleton-loader, [role="progressbar"], .loading');

            if (responseBlocks.length > 0 && skeletons.length === 0) {
                const lastBlock = responseBlocks[responseBlocks.length - 1];
                const currentText = lastBlock.innerText || lastBlock.textContent;
                const currentLength = currentText.length;

                if (currentLength > 50) {
                    if (currentLength === lastLength) {
                        stableCount++;
                    } else {
                        stableCount = 0;
                        lastLength = currentLength;
                    }

                    // 连续 2 秒字数不变，且没有 loading 状态，认为加载完成
                    if (stableCount >= 2) {
                        clearInterval(checkInterval);
                        console.log("✅ 检测到历史内容加载完毕，开始提取...");
                        executePostGenerationTasks(currentText);
                    }
                }
            }
        }, 1000);
        
        // 保底超时机制：如果页面卡死，不要让后台队列一直堵塞
        setTimeout(() => {
            clearInterval(checkInterval);
            console.error("❌ 等待聊天内容超时，可能此对话为空或已失效");
            chrome.runtime.sendMessage({action: "closeTab"});
        }, 15000);
    }

    // ==========================================
    // 逻辑三：原有的全自动生成逻辑
    // ==========================================
    let hasSent = false;
    function handleAutoPromptTask(prompt) {
        const initObserver = new MutationObserver((mutations, obs) => {
            if (hasSent) return;

            const editor = document.querySelector('rich-textarea div[contenteditable="true"], div.ql-editor');
            const sendButton = document.querySelector('button[aria-label="Send message"], button[aria-label="发送消息"], .send-button');

            if (editor && sendButton && !sendButton.disabled) {
                obs.disconnect();
                editor.focus();
                document.execCommand('insertText', false, prompt);

                let checkReady = setInterval(() => {
                    if (!sendButton.disabled && editor.textContent.includes(prompt.substring(0, 5))) {
                        clearInterval(checkReady);
                        hasSent = true;
                        sendButton.click();
                        startCompletionObserver();
                    }
                }, 100);
            }
        });

        initObserver.observe(document.body, { childList: true, subtree: true });
    }

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

    // ==========================================
    // 公共任务：下载 MD 与 归档
    // ==========================================
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

        // 无论是哪种任务，都发命令关掉自己
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
                title = firstLine.replace(/[\/\\:*?"<>|]/g, ' ').trim();
            }
        }

        console.log(`[下载追踪] 准备发送消息给 Background 脚本下载: youtube-summeries/${title}.md`);
        
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
        
        // 【防闪退保护】确保侧边栏已展开
        const sidebarToggleButton = document.querySelector('button[aria-label="Main menu"], button[aria-label="主菜单"]');
        const sidebar = document.querySelector('nav, aside');
        if (sidebar && !isVisible(sidebar) && sidebarToggleButton) {
            simulateFullClick(sidebarToggleButton);
            await new Promise(r => setTimeout(r, 500));
        }
        
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
