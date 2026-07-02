// Gemini YouTube Summary Automator (Native Chrome Extension Edition)

(function() {
    'use strict';

    const urlParams = new URLSearchParams(window.location.search);
    const autoPrompt = urlParams.get('auto_prompt');

    // 检查是否是被后台批量任务打开的隐藏标签页
    chrome.runtime.sendMessage({ action: "checkExtractionStatus" }, (response) => {
        if (response && response.shouldExtract) {
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
    });

    // ==========================================
    // 逻辑一：批量注入侧边栏 UI
    // ==========================================
    function injectBatchUI() {
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

                // 注入“批量归档选中的对话”按钮到底部（或搜索栏下方）
                if (!document.getElementById('gemini-batch-btn-container') && chatLinks.length > 0) {
                    // 找列表滚动容器
                    const listContainer = chatLinks[0].closest('div[role="list"], ul, [data-test-id="recent-chats-list"]') || chatLinks[0].parentElement.parentElement;
                    if (listContainer) {
                        const btnContainer = document.createElement('div');
                        btnContainer.id = 'gemini-batch-btn-container';
                        btnContainer.style.cssText = `
                            position: sticky;
                            top: 0;
                            z-index: 99;
                            padding: 8px 12px 12px 12px;
                            background: var(--gem-sys-color--surface, var(--md-sys-color-surface, #1e1f20));
                        `;

                        const btn = document.createElement('button');
                        btn.id = 'gemini-automator-batch-btn';
                        btn.innerHTML = '📦 批量归档选中的对话';
                        btn.style.cssText = `
                            width: 100%;
                            background: #1a73e8;
                            color: white;
                            border: none;
                            border-radius: 8px;
                            padding: 10px 16px;
                            font-size: 14px;
                            font-weight: 500;
                            cursor: pointer;
                            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                            transition: all 0.2s;
                        `;

                        btn.onmouseover = () => btn.style.background = '#1557b0';
                        btn.onmouseout = () => btn.style.background = '#1a73e8';

                        btn.onclick = async () => {
                            const checkboxes = document.querySelectorAll('.gemini-automator-cb:checked');
                            if (checkboxes.length === 0) {
                                alert('请先勾选需要归档的对话！');
                                return;
                            }

                            const urls = Array.from(checkboxes).map(cb => cb.closest('a').href);
                            
                            btn.innerHTML = '⏳ 正在当前页面按序提取并归档中...';
                            btn.style.background = '#5f6368';
                            btn.style.pointerEvents = 'none';

                            // 帮助函数：等待 DOM 渲染出新聊天的聊天内容
                            const waitAndExtractChatContent = async (targetId) => {
                                return new Promise((resolve) => {
                                    let stableCount = 0;
                                    let lastLength = 0;
                                    let totalWaitMs = 0;
                                    
                                    let checkInterval = setInterval(() => {
                                        totalWaitMs += 1000;
                                        
                                        // 确保 URL 已经跳转到了目标
                                        if (!window.location.href.includes(targetId)) {
                                            if (totalWaitMs >= 15000) {
                                                clearInterval(checkInterval);
                                                console.error("❌ 路由跳转超时", window.location.href, targetId);
                                                resolve(null);
                                            }
                                            return;
                                        }

                                        const responseBlocks = Array.from(document.querySelectorAll('message-content, .message-content, .model-response-text, [data-test-id="model-response"], div[class*="message-content"]'));
                                        
                                        // 获取用户的提问块，通常包含源链接
                                        const queryBlocks = Array.from(document.querySelectorAll('user-query, .user-query, [data-test-id="user-query"], div[class*="query-content"], div[class*="user-message"], [data-test-id="chunked-text"]'));

                                        if (responseBlocks.length > 0) {
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

                                                if (stableCount >= 2) {
                                                    clearInterval(checkInterval);
                                                    
                                                    let markdownResult = convertHtmlToMarkdown(lastBlock);
                                                    
                                                    // 尝试从用户的第一个提问中提取链接
                                                    let sourceLink = "";
                                                    if (queryBlocks.length > 0) {
                                                        const firstQuery = queryBlocks[0].innerText || queryBlocks[0].textContent || "";
                                                        // 匹配常规的 http/https 链接，排除尾部可能的标点符号
                                                        const urlMatch = firstQuery.match(/https?:\/\/[^\s)\]'"]+/);
                                                        if (urlMatch) {
                                                            sourceLink = urlMatch[0];
                                                        }
                                                    }
                                                    
                                                    // 如果找到了链接，将它以引用的形式前置在 Markdown 内容的开头
                                                    if (sourceLink) {
                                                        markdownResult = `> **📺 源视频链接：** [${sourceLink}](${sourceLink})\n\n---\n\n` + markdownResult;
                                                    }

                                                    resolve(markdownResult);
                                                    return;
                                                }
                                            }
                                        }
                                        
                                        if (totalWaitMs >= 15000) {
                                            clearInterval(checkInterval);
                                            console.error("❌ 提取聊天内容超时或页面结构不符");
                                            resolve(null);
                                        }
                                    }, 1000);
                                });
                            };

                            for (let i = 0; i < urls.length; i++) {
                                const targetUrl = urls[i];
                                btn.innerHTML = `⏳ 处理中 (${i + 1}/${urls.length})...`;
                                console.log(`[主控室] 开始处理: ${targetUrl}`);
                                
                                try {
                                    // 1. 在侧边栏找到这个 a 标签，触发 Angular 路由跳转
                                    const pathParts = targetUrl.split('/');
                                    const targetId = pathParts[pathParts.length - 1].split('?')[0]; 
                                    
                                    const allLinks = document.querySelectorAll('a[href*="/app/"], a[href*="/gem/"]');
                                    const linkEl = Array.from(allLinks).find(el => el.getAttribute('href') && el.getAttribute('href').includes(targetId));
                                    
                                    if (!linkEl) {
                                        console.error(`[主控室] 在侧边栏找不到 ID 为 ${targetId} 对应的链接`);
                                        continue;
                                    }
                                    
                                    console.log(`[主控室] 模拟点击侧边栏链接: ${linkEl.href}`);
                                    // 不要直接 href 赋值，使用原生 click() 触发 Angular Router 跳转！
                                    linkEl.click();
                                    
                                    // 2. 等待路由跳转和内容加载，并提取正文
                                    const extractedText = await waitAndExtractChatContent(targetId);
                                    
                                    // 3. 下载与归档
                                    if (extractedText) {
                                        console.log(`[主控室] 内容提取成功，开始下载 MD`);
                                        downloadMarkdown(extractedText);
                                        
                                        console.log(`[主控室] 开始在侧边栏对当前会话进行归档`);
                                        // 传当前的真实 URL 进去归档，因为刚才模拟点击后，如果带有 Gem 参数，
                                        // URL 可能会从 /app/xx 变成 /gem/xx/xx，用 window.location.href 最稳妥
                                        await moveSpecificUrlToNotebook(window.location.href, 'youtube-summeries');
                                    } else {
                                        console.error(`[主控室] 跳过 ${targetUrl}：提取内容失败`);
                                    }
                                } catch(e) {
                                    console.error(`[主控室] 处理 ${targetUrl} 失败:`, e);
                                }
                                
                                // 缓冲间隔
                                await new Promise(r => setTimeout(r, 2000));
                            }
                            
                            btn.innerHTML = '✅ 全部处理完成！';
                            setTimeout(() => {
                                btn.innerHTML = '📦 批量归档选中的对话';
                                btn.style.pointerEvents = 'auto';
                                btn.style.background = '#1a73e8';
                                document.querySelectorAll('.gemini-automator-cb').forEach(cb => cb.checked = false);
                            }, 3000);
                        };

                        btnContainer.appendChild(btn);
                        listContainer.prepend(btnContainer);
                    }
                }
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
        let totalWaitMs = 0;

        let checkInterval = setInterval(() => {
            totalWaitMs += 1000;
            const responseBlocks = Array.from(document.querySelectorAll('message-content, .message-content, .model-response-text, [data-test-id="model-response"], div[class*="message-content"]'));

            if (responseBlocks.length > 0) {
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

                    if (stableCount >= 2) {
                        clearInterval(checkInterval);
                        console.log("✅ 检测到历史内容加载完毕，开始提取...");
                        executePostGenerationTasks(currentText);
                        return;
                    }
                }
            }
            
            // 保底超时机制：如果在 15 秒内还没有加载出来内容，尝试自动刷新网页一次
            if (totalWaitMs >= 15000) {
                clearInterval(checkInterval);
                let reloads = parseInt(sessionStorage.getItem('gemini_automator_reloads') || '0');
                
                if (reloads < 2) {
                    console.log(`🔄 页面加载似乎卡死了，正在尝试第 ${reloads + 1} 次自动刷新...`);
                    sessionStorage.setItem('gemini_automator_reloads', (reloads + 1).toString());
                    window.location.reload();
                } else {
                    console.error("❌ 多次尝试刷新后依然超时，可能此对话为空、网络太慢或已失效");
                    sessionStorage.removeItem('gemini_automator_reloads'); // 清理状态
                    chrome.runtime.sendMessage({action: "closeTab"});
                }
            }
        }, 1000);
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
                            executePostGenerationTasks(convertHtmlToMarkdown(lastBlock));
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

        // 提取模式下，不再在此页面进行归档操作，主控页面会接管归档。
        // 直接关闭自己，触发主控页面的 extractionDone 事件。
        setTimeout(() => {
            chrome.runtime.sendMessage({action: "closeTab"});
        }, 1500);
    }

    function downloadMarkdown(text) {
        let title = document.title || "";
        // 清理掉 Gemini 默认加的后缀，以及不合法的文件名字符
        title = title.replace(' - Google Gemini', '').replace(' - Gemini', '').replace(/[\/\\:*?"<>|]/g, ' ').trim();
        
        // Fallback (降级) 机制：如果页面没加载完标题，document.title 只是 "Google Gemini"，
        // 我们就降级去提取文本的正文第一行作为标题。
        if (!title || title.toLowerCase() === 'google gemini' || title.toLowerCase() === 'gemini') {
            console.log("⚠️ 网页标题未加载完成，启动 Fallback 机制提取正文标题...");
            const lines = text.trim().split('\n');
            if (lines.length > 0) {
                let firstLine = lines[0].replace(/[#*`]/g, '').trim();
                if (firstLine.length > 0 && firstLine.length < 50) {
                    title = firstLine.replace(/[\/\\:*?"<>|]/g, ' ').trim();
                } else {
                    title = "youtube_summary_" + new Date().getTime();
                }
            } else {
                title = "youtube_summary_" + new Date().getTime();
            }
        }

        // 保底：如果标题太长，截取前 100 个字符
        if (title.length > 100) {
            title = title.substring(0, 100).trim();
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

    async function moveSpecificUrlToNotebook(url, notebookName) {
        console.log(`[归档追踪 1] 寻找侧边栏指定的对话... URL=${url}`);
        
        // 【防闪退保护】确保侧边栏已展开
        const sidebarToggleButton = document.querySelector('button[aria-label="Main menu"], button[aria-label="主菜单"]');
        const sidebar = document.querySelector('nav, aside');
        if (sidebar && !isVisible(sidebar) && sidebarToggleButton) {
            simulateFullClick(sidebarToggleButton);
            await new Promise(r => setTimeout(r, 500));
        }
        
        const row = await waitFor(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/app/"], a[href*="/gem/"]')).filter(l => !l.closest('header'));
            
            const pathParts = url.split('/');
            const id = pathParts[pathParts.length - 1].split('?')[0]; 
            let match = links.find(el => el.getAttribute('href') && el.getAttribute('href').includes(id));
            if (match) return match;
            
            return null;
        }, 5000);

        if (!row) {
            console.error("[归档报错] 在侧边栏找不到指定 URL 的对话条目。URL:", url);
            throw new Error('在侧边栏找不到指定的对话条目');
        }
        
        const rowName = row.innerText || row.textContent || "未知名称";
        console.log(`[归档追踪 2] 找到侧边栏元素，对话名称: "${rowName.trim()}"，准备模拟悬停并寻找三个点菜单`);

        // 使用 waitFor 持续尝试 Hover 并寻找按钮
        const menuButton = await waitFor(() => {
            const hoverEvents = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'];
            
            [row, row.parentElement].forEach(el => {
                if (el) {
                    const rect = el.getBoundingClientRect();
                    hoverEvents.forEach(type => {
                        el.dispatchEvent(new MouseEvent(type, { 
                            bubbles: true, 
                            cancelable: true,
                            view: window,
                            clientX: rect.left + (rect.width / 2) || 0,
                            clientY: rect.top + (rect.height / 2) || 0
                        }));
                    });
                }
            });

            // 使用基于 Y 轴几何距离的查找法，防止定位到其他对话的菜单
            const rowRect = row.getBoundingClientRect();
            const rowCenterY = rowRect.top + (rowRect.height / 2);
            
            // 在整个侧边栏区域搜索
            const searchArea = row.closest('nav, aside, ul') || document.body;
            const btns = Array.from(searchArea.querySelectorAll('button')).filter(btn =>
                btn.hasAttribute('aria-haspopup') ||
                (btn.getAttribute('aria-label') || '').includes('选项') ||
                (btn.getAttribute('data-test-id') || '').includes('menu')
            );
            
            if (btns.length === 0) return null;

            let closestBtn = btns[0];
            let minDiff = Infinity;
            
            btns.forEach(btn => {
                const btnRect = btn.getBoundingClientRect();
                const btnCenterY = btnRect.top + (btnRect.height / 2);
                const diff = Math.abs(btnCenterY - rowCenterY);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestBtn = btn;
                }
            });
            
            // 只要高度相差不超过 30px，就认为是正确的按钮
            if (minDiff < 30) {
                return closestBtn;
            }
            return null;
        }, 8000);

        if (!menuButton) {
            console.error("[归档报错] 持续 8 秒仍找不到侧边栏的三个点菜单按钮。定位的 row 元素:", row);
            throw new Error('持续 8 秒仍找不到侧边栏的三个点菜单按钮');
        }

        menuButton.style.visibility = 'visible';
        menuButton.style.opacity = '1';
        menuButton.click();
        console.log(`[归档追踪 3] 已点击三个点菜单，正在寻找包含"笔记本"的选项`);
        
        await new Promise(r => setTimeout(r, 400));

        const addOption = await waitFor(() => {
            const btns = Array.from(document.querySelectorAll('button[role="menuitem"], li[role="menuitem"], [role="menu"] button, [role="menu"] li, [data-test-id*="notebook"]'));
            for (let i = btns.length - 1; i >= 0; i--) {
                const b = btns[i];
                if ((b.textContent.includes('笔记本') || b.textContent.includes('notebook') || b.textContent.includes('Notebook') || b.textContent.includes('Save')) && !b.closest('nav') && !b.closest('aside')) {
                    return b;
                }
            }
            return null;
        }, 3000);
        if (!addOption) {
            console.error("[归档报错] 在弹出菜单里没找到'笔记本'选项。可能的原因：账号不支持 Notebook，或者菜单结构已改变。");
            throw new Error('在弹出菜单里没找到"笔记本"选项');
        }
        simulateFullClick(addOption);

        console.log(`[归档追踪 4] 已点击笔记本选项，寻找指定笔记本：${notebookName}`);
        await new Promise(r => setTimeout(r, 600));

        const notebookOption = await waitFor(() => {
            const items = Array.from(document.querySelectorAll('button, li, [role="menuitem"], [role="option"], span'));
            for (let i = items.length - 1; i >= 0; i--) {
                const b = items[i];
                if (b.textContent.toLowerCase().includes(notebookName.toLowerCase()) && !b.closest('nav') && !b.closest('aside')) {
                    return b;
                }
            }
            return null;
        }, 3000);
        if (!notebookOption) {
            console.error(`[归档报错] 找不到名为 ${notebookName} 的笔记本。请确保已提前在侧边栏创建了该 Notebook。`);
            throw new Error(`找不到名为 ${notebookName} 的笔记本`);
        }
        simulateFullClick(notebookOption);
        console.log(`[归档追踪 5] 找到并点击了目标笔记本 ${notebookName}`);

        await new Promise(r => setTimeout(r, 400));
        
        const saveBtn = Array.from(document.querySelectorAll('button')).find(b =>
            (b.textContent.includes('保存') || b.textContent.includes('Save') || b.textContent.includes('完成') || b.textContent.includes('Done')) && b.closest('[role="dialog"], dialog')
        );
        if (saveBtn) {
            simulateFullClick(saveBtn);
            console.log(`[归档追踪 6] 点击了弹窗内的确认保存按钮`);
        }
        
        await new Promise(r => setTimeout(r, 800));
    }
})();
