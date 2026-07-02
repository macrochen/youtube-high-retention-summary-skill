# YouTube High Retention Summary Skill

## 简介
这是一个配合 Google Gemini 实现全自动化 YouTube 视频总结的极客工具集。
通过这套组合拳，你可以将一批 YouTube 视频链接放入队列，它会自动打开 Gemini，输入固定提示词让 Gemini 生成高记忆度的总结（或者通过用户自定义的 Gemini Gem 处理），并在生成完毕后**自动将 Markdown 文件下载到本地指定文件夹**、**自动移动对话到指定的 Gemini 笔记本 (Notebook) 中归档**，最后**自动关闭标签页**，全程无缝挂机处理防封号。

## 工具组件构成
本套件由两部分强耦合的工具组成：
1. **Python 调度脚本 (`scripts/batch_processor.py`)**：负责解析 JSON 视频列表，控制队列和执行间隔（防封锁），并在命令行中通过系统调用 (`open`) 唤起 Chrome 浏览器访问指定 URL。
2. **原生 Chrome 插件 (`extension/` 目录)**：负责注入 Gemini 页面，自动输入预设提示词，监听生成状态。当内容生成完毕（字数静止 3 秒后），利用 Chrome 插件的高级原生权限 (`chrome.downloads`) 直接将总结保存到本地指定目录（突破浏览器默认的下载沙盒限制），执行 UI 自动化将对话归档至 `youtube-summeries` 笔记本，最后直接杀掉标签页。

## 安装步骤

### 1. 部署 Python 环境和代码
本仓库包含 Python 运行环境及脚本，下载后无需过多配置。由于这作为一个 Antigravity Skill 存在，AI Agent 在执行 `/youtube-high-retention-summary-skill` 时会自动调用 Python 脚本。

### 2. 安装配套 Chrome 原生插件 (核心!)
**必须安装配套的 Chrome 原生插件，否则自动化流水线无法走通下载、归档和关网页的最后一步。**

1. 打开 Chrome 浏览器，访问扩展程序管理页：`chrome://extensions/`
2. 确保页面右上角的 **“开发者模式 (Developer mode)”** 处于**开启**状态。
3. 点击左上角的 **“加载已解压的扩展程序 (Load unpacked)”** 按钮。
4. 在弹出的文件选择窗口中，找到并选中本 Skill 目录下的 `extension` 文件夹（路径类似于 `~/.agents/skills/youtube-high-retention-summary-skill/extension`），点击确认。
5. （如果之前安装过 Tampermonkey 的版本，请务必在 Tampermonkey 中将其关闭禁用，以免发生冲突引发双重点击）。

## 运行与使用方法

最常见的使用方式是通过 Antigravity AI Agent 直接下发指令：

1. 在对话框中输入 `/youtube-high-retention-summary-skill`，并附带一个含有待处理视频 JSON 格式列表的内容，例如：
```json
[
  {
    "title": "视频标题1",
    "url": "https://www.youtube.com/watch?v=xxx"
  },
  {
    "title": "视频标题2",
    "url": "https://www.youtube.com/watch?v=yyy"
  }
]
```

2. Agent 接收到指令后，会将该列表保存为临时 JSON 文件，并自动执行本 Skill 目录下的 `scripts/batch_processor.py` 调度脚本。

3. **脚本触发后，你只需要保持网络畅通并静静围观：**
   - 浏览器会自动打开一个新标签页访问 Gemini。
   - 插件会自动接管，写入提示词并发送。
   - Gemini 生成完毕且字数静止 3 秒后。
   - 插件后台神不知鬼不觉地将一份名为 `标题.md` 的文件静默下载到 `~/Downloads/youtube-summeries/` 文件夹下。
   - 插件在侧边栏自动化点击，将本次对话归档入名为 `youtube-summeries` 的笔记本。
   - 插件后台“咔嚓”一刀强制关闭该标签页。
   - Python 调度脚本计时等待后，继续处理队列中的下一个视频。

## 注意事项
- **笔记本名称**：插件默认寻找名为 `youtube-summeries` 的 Gemini Notebook。若你的笔记本名称不同，请通过 AI 修改 `extension/content.js` 中的相关代码并重新在扩展程序页面刷新插件。
- **自动关页报错历史**：如果你在 Console 看到 `Scripts may close only the windows that were opened by them.`，说明那是旧版本的遗留历史报错，原生 Chrome 插件使用 `chrome.runtime.sendMessage({action: "closeTab"})` 的方式已完美越过了这个安全限制。
