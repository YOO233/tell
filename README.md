# Tell 项目介绍

`Tell` 是一个基于 Node.js 的应用程序，旨在作为 Telegram 机器人与 Dify 工作流之间的桥梁。它能够实时接收 Telegram 消息，并根据配置自动或手动将这些消息转发到 Dify 工作流进行处理。此外，项目还提供了一个简洁的 Web 界面，方便用户查看接收到的消息、管理 Telegram Bot Token 以及配置自动发送规则。

## 主要功能

*   **Telegram 消息接收**: 持续轮询 Telegram API，获取最新的消息更新。
*   **Dify 工作流集成**: 将 Telegram 消息内容发送至预设的 Dify 工作流进行自动化处理。
*   **Web 管理界面**:
    *   实时显示接收到的 Telegram 消息。
    *   管理和切换多个 Telegram Bot Token。
    *   配置消息自动发送到 Dify 的规则（例如，根据关键词过滤）。
*   **日志记录**: 详细记录 Telegram 消息 (`messages.log`) 和 Dify API 交互 (`dify_api.log`)，便于调试和审计。
*   **配置化**: 所有关键设置（如 Telegram Token、Dify API 地址和密钥、自动发送规则）均通过 `config.json` 文件进行管理。
*   **实时状态更新**: 利用 Server-Sent Events (SSE) 技术，将 Dify 工作流的实时状态更新推送到前端。

## 技术栈

*   **后端**: Node.js, Express.js
*   **HTTP 客户端**: Axios
*   **前端**: HTML, CSS, JavaScript
*   **消息队列/流**: Server-Sent Events (SSE)

## 部署方法

### 1. 环境准备

确保您的系统已安装 Node.js (推荐 LTS 版本) 和 npm。

### 2. 克隆项目

首先，将项目从 GitHub 克隆到您的本地机器：

```bash
git clone https://github.com/YOO233/tell.git
cd tell
```

### 3. 安装依赖

进入项目目录后，安装所有必要的 Node.js 依赖：

```bash
npm install
```

### 4. 配置 `config.json`

项目依赖于 `config.json` 文件来存储敏感信息和配置。请在项目根目录下创建 `config.json` 文件，并按照以下格式填写您的配置：

```json
{
  "telegram": {
    "tokens": [
      "YOUR_TELEGRAM_BOT_TOKEN_1",
      "YOUR_TELEGRAM_BOT_TOKEN_2"
    ],
    "activeToken": "YOUR_ACTIVE_TELEGRAM_BOT_TOKEN"
  },
  "dify": {
    "apiUrl": "YOUR_DIFY_WORKFLOW_API_URL",
    "apiKey": "YOUR_DIFY_API_KEY"
  },
  "autoSend": {
    "enabled": false,
    "filterKeyword": "自动:"
  }
}
```

*   **`telegram.tokens`**: 一个数组，包含您所有 Telegram Bot 的 Token。
*   **`telegram.activeToken`**: 当前激活的 Telegram Bot Token，必须是 `tokens` 数组中的一个。
*   **`dify.apiUrl`**: 您的 Dify 工作流的 API 地址。
*   **`dify.apiKey`**: 您的 Dify API 密钥。
*   **`autoSend.enabled`**: 布尔值，`true` 启用自动发送，`false` 禁用。
*   **`autoSend.filterKeyword`**: 当 `autoSend.enabled` 为 `true` 时，Telegram 消息内容以此关键词开头时，将自动发送到 Dify。例如，如果设置为 `"自动:"`，则消息 "自动:你好" 会被发送，而 "你好" 不会。

### 5. 运行项目

配置完成后，您可以通过以下命令启动应用程序：

```bash
node index.js
```

或者，如果您希望在后台运行并自动重启（例如使用 `pm2`）：

```bash
npm install -g pm2
pm2 start index.js --name tell-bot
```

### 6. 访问 Web 界面

项目启动后，您可以通过浏览器访问 `http://localhost:3000` 来查看 Telegram 消息和管理配置。

### 7. 日志文件

*   `messages.log`: 记录所有接收到的 Telegram 消息。
*   `dify_api.log`: 记录与 Dify API 的交互日志。
