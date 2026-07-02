---
name: youtube-high-retention-summary-skill
description: 将指定的 YouTube 视频链接传递给用户自定义的 Gemini Gem，配合油猴脚本全自动处理；同时也支持传入 JSON 队列文件进行防封号的慢速批量调用。
---

# youtube-high-retention-summary-skill

## When to use

当用户需要总结 YouTube 视频时使用：
1. **单次极速调用**：直接提供一个 URL（如 `youtube.com/watch?v=...`）。
2. **批量慢速队列**：提供一个由 `youtube-summary-collector` 插件导出的 `.json` 文件路径。Agent 会启动后台守护进程，每隔一段时间向 Gemini Web 投递一个任务，防止触发高频拦截。

## Execution Steps

### 场景一：单次极速调用（传入 URL）
1. 从用户的输入中提取目标 YouTube URL。
2. 拼接参数并直接调用 `open`：
   ```bash
   open "https://gemini.google.com/u/0/gem/df372934aec1?auto_prompt=<YouTube_URL>"
   ```
3. 告知用户页面已打开，油猴脚本已接管。

### 场景二：批量慢速队列（传入 JSON 文件）
1. 如果用户输入中包含 JSON 文件的绝对或相对路径（如 `youtube_batch_xxx.json`），请将该路径解析为绝对路径 `$JSON_PATH`。
2. 调用随 Skill 附带的批处理脚本启动慢速循环：
   ```bash
   python3 ~/.agents/skills/youtube-high-retention-summary-skill/scripts/batch_processor.py "$JSON_PATH"
   ```
3. 这个脚本会解析 JSON，并且每发送一个任务就会休眠 5 分钟（`sleep 300`），你需要耐心等待（或者把任务放到后台异步运行，但只要提示用户队列已启动即可，终端日志会持续打印）。

---

## 核心设计理念
本 Skill 完全摒弃了后端抓取，而是通过 `URL Parameter` 传参配合浏览器端的**油猴脚本 (Tampermonkey)**，实现对专属 Gemini Gem 的无缝调用。针对批量任务，引入了“本地间隔唤醒+浏览器原生调度”的策略，最大限度保证安全性和防风控。
