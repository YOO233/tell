const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 加载配置文件
const configPath = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error('错误：无法加载 config.json 文件。请确保它存在且格式正确。', error);
    process.exit(1);
}

const TELEGRAM_BOT_TOKEN = config.telegramBotToken;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const LOG_FILE = path.join(__dirname, 'messages.log');

let lastUpdateId = 0;
let isPolling = false;
let messages = []; // 内存中存储的消息，用于前端展示

// 确保日志文件存在
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
}

// 轮询 Telegram API
async function pollTelegramUpdates() {
    if (isPolling) {
        console.log('轮询已在进行中，跳过本次请求以避免冲突。');
        return;
    }

    isPolling = true;
    try {
        console.log(`正在轮询 Telegram API，offset: ${lastUpdateId}`);
        const response = await axios.get(`${TELEGRAM_API_URL}/getUpdates`, {
            params: {
                offset: lastUpdateId,
                timeout: 30 // 长轮询，等待30秒
            }
        });

        const updates = response.data.result;
        if (updates.length > 0) {
            console.log(`收到 ${updates.length} 条新消息。`);
            updates.forEach(update => {
                console.log('接收到完整的更新对象:', JSON.stringify(update, null, 2)); // 添加调试日志
                if (update.update_id >= lastUpdateId) { // 确保只处理新的或当前update_id的消息
                    lastUpdateId = update.update_id + 1; // 更新offset
                    
                    let messageContent = null;
                    if (update.message) {
                        messageContent = update.message;
                    } else if (update.channel_post) {
                        messageContent = update.channel_post;
                    } else if (update.edited_message) {
                        messageContent = update.edited_message;
                    }
                    // 可以根据需要添加更多类型的消息处理，例如 update.callback_query 等

                    if (messageContent) {
                        let from = '未知用户';
                        if (messageContent.from && messageContent.from.first_name) {
                            from = messageContent.from.first_name;
                        } else if (messageContent.sender_chat && messageContent.sender_chat.title) {
                            from = messageContent.sender_chat.title; // 频道消息的发送者
                        }
                        
                        const text = messageContent.text || '[非文本消息]';
                        const date = new Date(messageContent.date * 1000).toLocaleString('zh-CN');
                        const chatId = messageContent.chat ? messageContent.chat.id : '未知'; // 获取chat.id

                        const logEntry = `[${date}] [UpdateID: ${update.update_id}] [ChatID: ${chatId}] ${from}: ${text}\n`;

                        // 写入日志文件
                        fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
                        console.log(`新消息已写入日志: ${logEntry.trim()}`);

                        // 添加到内存中的消息列表，只保留最新N条
                        messages.push({ 
                            id: update.update_id, 
                            chatId: chatId, // 添加chatId
                            from: from, 
                            text: text, 
                            date: date 
                        });
                        // 可以限制messages数组的大小，例如只保留最新的50条消息
                        if (messages.length > 50) {
                            messages.shift(); 
                        }
                    } else {
                        console.log('收到非消息更新，跳过处理。');
                    }
                }
            });
        } else {
            console.log('没有新消息。');
        }
    } catch (error) {
        if (error.response && error.response.status === 409) {
            console.error('轮询失败: ETELEGRAM: 409 Conflict: terminated by other getUpdates request; make sure that only one bot instance is running。这通常意味着有其他实例正在轮询。');
        } else {
            console.error('轮询失败:', error.message);
        }
    } finally {
        isPolling = false;
        // 无论成功或失败，都等待一段时间后再次轮询
        setTimeout(pollTelegramUpdates, 1000); // 1秒后再次尝试轮询
    }
}

// 启动轮询
pollTelegramUpdates();

// 提供静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// API 接口，用于前端获取消息
app.get('/api/messages', (req, res) => {
    // 返回内存中的消息列表
    res.json(messages);
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`请访问 http://localhost:${PORT} 查看消息。`);
});
