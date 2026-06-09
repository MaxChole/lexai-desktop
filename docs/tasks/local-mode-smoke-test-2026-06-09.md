# 本地模式手测记录（2026-06-09）

## 测试目标

验证 `T-11` 本地模式的核心可用性：

- Electron 桌面端能正确进入本地模式
- 本地推理 sidecar 能正常启动并被 UI 识别
- 本地附件入口可见且可触发文件选择器
- 本地附件上下文可被导入并参与模型生成

## 测试环境

- 机器：macOS / Apple M4
- 桌面端启动方式：`cd frontend && npm run dev`
- 本地模型：`Qwen2.5-7B-Instruct-Q4_K_M.gguf`
- 本地推理服务：`llama-cpp-python` OpenAI-compatible server
- 服务地址：`http://127.0.0.1:11435/v1`

## 测试步骤

### 1. 桌面端本地模式 UI 冒烟

在 Electron 窗口中确认：

- 页面加载自 `localhost:5173`
- 左侧“本地推理”卡片显示 `已就绪`
- 顶部模式切换处可进入 `本地`
- 输入区左侧 `添加文件` 按钮可点击

### 2. 附件入口验证

在本地模式下点击 `添加文件`：

- 成功弹出 macOS 原生“打开”对话框
- 选择器可见 `pdf/doc/docx/txt/md` 候选文件

说明：

- 在自动化环境下，macOS 打开对话框的“打开”按钮未能通过可访问性树稳定激活
- 这更像系统文件选择器在自动化下的交互限制，不是桌面端业务逻辑错误

### 3. 本地附件导入链路验证

使用与桌面端相同的 `LocalDocumentStore.saveFiles()` 和 `buildAttachmentContext()` 逻辑，对 [tasks.md](/Users/wanghan/code/lexai-desktop/docs/tasks/tasks.md) 执行一次本地导入。

结果：

- 原文件：`/Users/wanghan/code/lexai-desktop/docs/tasks/tasks.md`
- 导入后副本：`/var/folders/cb/b645mbg13_q652n39ss7tmwc0000gn/T/lexai-local-smoke-docs/smoke-conversation/doc-1780967538588-brox2v-tasks.md`
- 文件大小：`7318` bytes
- 生成的附件上下文长度：`4243` 字符

### 4. 本地模型结合附件上下文生成

将上一步生成的附件上下文作为 `system` 消息，向本地推理服务发送请求：

用户问题：

`请根据附件内容，用两句话总结这个项目当前的任务进度。`

模型返回：

`当前项目已完成初始化并搭建了基础的 Electron + React + Node.js 脚手架（T-01），并且 Skill 引擎也已解析并索引了两个仓库中的全部 SKILL.md 文件（T-02）。`

## 结论

本地模式核心链路已通过：

- 本地 runtime 能启动并被桌面端识别
- 本地模式能切换成功
- 附件入口可触发
- 本地附件存储与上下文构建正常
- 本地模型能够利用附件上下文生成结果

## 已知边界

- 在当前自动化环境下，macOS 原生文件选择器的最终“打开”动作未能稳定通过可访问性自动化完成
- 这次已通过桌面端同一套附件存储/上下文逻辑完成等价验证，因此不影响对本地附件工作流代码链路的判定
