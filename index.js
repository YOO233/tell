const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const clients = new Map(); // 存储 SSE 客户端 { workflow_run_id: [res1, res2, ...] }

const app = express();
const PORT = 3000;

// 加载配置文件
const configPath = path.join(__dirname, 'config.json');
// 动态加载配置的函数
function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('错误：无法加载 config.json 文件。请确保它存在且格式正确。', error);
        process.exit(1);
    }
}

let config = loadConfig(); // 初始加载配置
let TELEGRAM_BOT_TOKEN = config.telegram.activeToken;
let TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const MESSAGE_LOG_FILE = path.join(__dirname, 'messages.log');
const DIFY_LOG_FILE = path.join(__dirname, 'dify_api.log');

let lastUpdateId = 0;
let isPolling = false;
let messages = []; // 内存中存储的消息，用于前端展示

// 确保日志文件存在
if (!fs.existsSync(MESSAGE_LOG_FILE)) {
    fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf8');
}
if (!fs.existsSync(DIFY_LOG_FILE)) {
    fs.writeFileSync(DIFY_LOG_FILE, '', 'utf8');
}

// 封装发送到 Dify 的逻辑
// 增加一个可选的 `res` 参数（仅在手动发送时传递）和 `userName` 参数
async function sendToDifyWorkflow(content, chatId, telToken, userName, isAutoSend = false, res = null) {
    const difyConfig = config.dify;
    const logPrefix = isAutoSend ? '[自动发送]' : '[手动发送]';

    if (!difyConfig || !difyConfig.apiUrl || !difyConfig.apiKey) {
        const errorMsg = 'Dify API 配置缺失。请检查 config.json。';
        console.error(errorMsg);
        fs.appendFileSync(DIFY_LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${logPrefix} 错误: ${errorMsg}\n`, 'utf8');
        if (!isAutoSend && res && !res.headersSent) {
            res.status(500).json({ success: false, message: errorMsg });
        }
        throw new Error(errorMsg);
    }

    const requestData = {
        inputs: {
            conet: content,
            ChatID: chatId,
            tel_token: telToken
        },
        response_mode: "streaming",
        user: userName || "abc-123" // 使用 userName，如果不存在则回退到默认值
    };

    fs.appendFileSync(DIFY_LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${logPrefix} 启动。User: "${requestData.user}", Content: "${content.substring(0, 50)}..."\n`, 'utf8');
    console.log(`${logPrefix} Dify 工作流启动。User: "${requestData.user}"`);

    try {
        const difyResponse = await axios.post(difyConfig.apiUrl, requestData, {
            headers: {
                'Authorization': `Bearer ${difyConfig.apiKey}`,
                'Content-Type': 'application/json'
            },
            responseType: 'stream'
        });

        let workflowRunId = null;
        let taskId = null;
        let buffer = '';

        difyResponse.data.on('data', chunk => {
            buffer += chunk.toString();

            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const completeMessage = buffer.substring(0, boundary);
                buffer = buffer.substring(boundary + 2);

                if (completeMessage.startsWith('data:')) {
                    try {
                        const eventData = JSON.parse(completeMessage.substring(5));
                        // 移除冗余的流事件日志
                        // fs.appendFileSync(DIFY_LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] Dify 流事件: ${JSON.stringify(eventData)}\n`, 'utf8');
                        // console.log('Dify 流事件已记录。');

                        if (eventData.event === 'workflow_started') {
                            workflowRunId = eventData.workflow_run_id;
                            taskId = eventData.task_id;
                            if (!isAutoSend && res && !res.headersSent) {
                                res.json({ success: true, message: 'Dify 工作流已启动。', workflow_run_id: workflowRunId, task_id: taskId });
                            }
                        } else if (eventData.event === 'workflow_finished') {
                            const status = eventData.data.status;
                            const elapsedTime = eventData.data.elapsed_time;
                            const error = eventData.data.error;
                            const finishLog = `[${new Date().toLocaleString('zh-CN')}] ${logPrefix} 工作流结束。RunID: ${workflowRunId}, Status: ${status}, Time: ${elapsedTime ? `${elapsedTime.toFixed(2)}s` : 'N/A'}${error ? `, Error: "${error}"` : ''}\n`;
                            fs.appendFileSync(DIFY_LOG_FILE, finishLog, 'utf8');
                            console.log(`${logPrefix} 工作流结束。Status: ${status}`);
                        }

                        if (workflowRunId && clients.has(workflowRunId)) {
                            clients.get(workflowRunId).forEach(clientRes => {
                                clientRes.write(`data: ${JSON.stringify(eventData)}\n\n`);
                            });
                        }
                    } catch (parseError) {
                        console.error('解析 Dify 流数据失败:', parseError);
                        fs.appendFileSync(DIFY_LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${logPrefix} 解析 Dify 流数据失败: ${parseError.message}\n原始数据: ${completeMessage}\n`, 'utf8');
                    }
                }
            }
        });

        difyResponse.data.on('end', () => {
            console.log(`${logPrefix} Dify 流响应结束。`);
            if (workflowRunId && clients.has(workflowRunId)) {
                clients.get(workflowRunId).forEach(clientRes => {
                    if (!clientRes.finished) {
                        clientRes.end();
                    }
                });
                clients.delete(workflowRunId);
            }
        });

        difyResponse.data.on('error', streamError => {
            console.error(`${logPrefix} Dify 流错误:`, streamError);
            const errorMsg = `Dify 流错误: ${streamError.message}`;
            fs.appendFileSync(DIFY_LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${logPrefix} Dify 流错误: ${streamError.message}\n`, 'utf8');
            if (workflowRunId && clients.has(workflowRunId)) {
                clients.get(workflowRunId).forEach(clientRes => {
                    if (!clientRes.finished) {
                        clientRes.write(`data: ${JSON.stringify({ event: 'error', message: errorMsg })}\n\n`);
                        clientRes.end();
                    }
                });
                clients.delete(workflowRunId);
            }
            if (!isAutoSend && res && !res.headersSent) {
                res.status(500).json({ success: false, message: errorMsg });
            }
        });

    } catch (error) {
        const errorMsg = `Dify API 请求失败: ${error.message}`;
        console.error(`${logPrefix} Dify API 请求失败:`, error);
        const logEntry = `[${new Date().toLocaleString('zh-CN')}] ${logPrefix} Dify API 请求失败。\n请求数据: ${JSON.stringify(requestData)}\n错误: ${error.message}\n`;
        fs.appendFileSync(DIFY_LOG_FILE, logEntry, 'utf8');
        if (!isAutoSend && res && !res.headersSent) {
            res.status(500).json({ success: false, message: errorMsg, error: error.response ? error.response.data : error.message });
        }
        throw error;
    }
}


// 轮询 Telegram API
async function pollTelegramUpdates() {
    if (isPolling) {
        console.log('轮询已在进行中，跳过本次请求以避免冲突。');
        return;
    }

    isPolling = true;
    try {
        // 每次轮询前重新加载配置，以获取最新的 autoSend 设置
        config = loadConfig(); 
        TELEGRAM_BOT_TOKEN = config.telegram.activeToken; // 确保使用最新的 activeToken
        TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

        console.log(`正在轮询 Telegram API，offset: ${lastUpdateId} (使用 Token: ${TELEGRAM_BOT_TOKEN.substring(0, 10)}...)`);
        const response = await axios.get(`${TELEGRAM_API_URL}/getUpdates`, {
            params: {
                offset: lastUpdateId,
                timeout: 30 // 长轮询，等待30秒
            }
        });

        const updates = response.data.result;
        if (updates.length > 0) {
            console.log(`收到 ${updates.length} 条新消息。`);
            for (const update of updates) { // 使用 for...of 循环以便 await sendToDifyWorkflow
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

                    let from = '未知用户';
                    let userNameForDify = "abc-123"; // Dify 的 user 字段的默认值

                    if (messageContent) {
                        if (messageContent.from) {
                            // 优先尝试组合 first_name 和 last_name
                            if (messageContent.from.first_name && messageContent.from.last_name) {
                                from = `${messageContent.from.first_name} ${messageContent.from.last_name}`;
                                userNameForDify = from;
                            } else if (messageContent.from.first_name) {
                                from = messageContent.from.first_name;
                                userNameForDify = from;
                            } else if (messageContent.from.username) { // 如果没有first/last name，尝试username
                                from = messageContent.from.username;
                                userNameForDify = from;
                            }
                        } else if (messageContent.sender_chat && messageContent.sender_chat.title) {
                            // 对于频道消息 (channel_post)，从 sender_chat.title 中提取频道名称
                            from = messageContent.sender_chat.title;
                            userNameForDify = messageContent.sender_chat.title;
                        }
                        
                        const originalText = messageContent.text || '[非文本消息]'; // 保存原始文本
                        const date = new Date(messageContent.date * 1000).toLocaleString('zh-CN');
                        const chatId = messageContent.chat ? String(messageContent.chat.id) : '未知'; // 强制转换为字符串
                        let autoSent = false; // 标记是否自动发送
                        
                        // 检查是否符合自动发送条件 (使用 originalText 进行判断)
                        if (config.autoSend.enabled && config.autoSend.filterKeyword && originalText.startsWith(config.autoSend.filterKeyword)) {
                            const textToSend = originalText.substring(config.autoSend.filterKeyword.length).trim(); // 移除关键词
                            console.log(`消息符合自动发送条件，已移除关键词。原始: "${originalText}", 处理后: "${textToSend}"`);
                            
                            try {
                                // 自动发送到 Dify，传递 userNameForDify
                                await sendToDifyWorkflow(textToSend, chatId, TELEGRAM_BOT_TOKEN, userNameForDify, true);
                                autoSent = true;
                                console.log('消息已自动发送到 Dify。');
                            } catch (difyError) {
                                console.error('自动发送到 Dify 失败:', difyError.message);
                                // 即使自动发送失败，消息也应该显示在前端
                            }
                        }

                        const logEntry = `[${date}] [UpdateID: ${update.update_id}] [ChatID: ${chatId}] ${from}: ${originalText}${autoSent ? ' (自动发送)' : ''}\n`;

                        // 写入消息日志文件
                        fs.appendFileSync(MESSAGE_LOG_FILE, logEntry, 'utf8');
                        console.log(`新消息已写入日志: ${logEntry.trim()}`);

                        // 添加到内存中的消息列表，并标记是否自动发送
                        messages.push({ 
                            id: update.update_id, 
                            chatId: chatId, 
                            from: from, 
                            text: originalText, // 前端显示原始文本
                            date: date,
                            autoSent: autoSent // 添加自动发送标记
                        });
                        // 可以限制messages数组的大小，例如只保留最新的50条消息
                        if (messages.length > 50) {
                            messages.shift(); 
                        }
                    } else {
                        console.log('收到非消息更新，跳过处理。');
                    }
                }
            }
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
app.use(express.json()); // 用于解析 POST 请求的 JSON body

// API 接口，用于前端获取消息
app.get('/api/messages', (req, res) => {
    // 返回内存中的消息列表
    res.json(messages);
});

// API 接口，用于前端获取配置（包括所有 Token 和当前激活的 Token）
app.get('/api/config', (req, res) => {
    // 每次请求时重新加载配置，确保获取最新状态
    config = loadConfig(); 
    res.json({
        telegramTokens: config.telegram.tokens,
        activeTelegramToken: config.telegram.activeToken,
        difyApiUrl: config.dify.apiUrl,
        difyApiKey: config.dify.apiKey,
        autoSendEnabled: config.autoSend.enabled, // 新增
        autoSendFilterKeyword: config.autoSend.filterKeyword // 新增
    });
});

// API 接口，用于前端添加新的 Telegram Token
app.post('/api/tokens', (req, res) => {
    const newToken = req.body.token;
    config = loadConfig(); // 重新加载配置以获取最新状态
    if (newToken && !config.telegram.tokens.includes(newToken)) {
        config.telegram.tokens.push(newToken);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        res.json({ success: true, message: 'Token 添加成功。', tokens: config.telegram.tokens });
    } else {
        res.status(400).json({ success: false, message: 'Token 无效或已存在。' });
    }
});

// API 接口，用于前端设置当前激活的 Telegram Token
app.put('/api/tokens/active', (req, res) => {
    const newActiveToken = req.body.token;
    config = loadConfig(); // 重新加载配置以获取最新状态
    if (newActiveToken && config.telegram.tokens.includes(newActiveToken)) {
        config.telegram.activeToken = newActiveToken;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        TELEGRAM_BOT_TOKEN = newActiveToken; // 更新内存中的 Token
        TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`; // 更新 API URL
        lastUpdateId = 0; // 重置 offset，从头开始获取新 Token 的消息
        isPolling = false; // 停止当前轮询，让 setTimeout 重新启动
        messages = []; // 清空内存中的消息
        console.log(`Telegram Bot Token 已更新为: ${newActiveToken.substring(0, 10)}...`);
        res.json({ success: true, message: '激活 Token 更新成功，轮询将重启。', activeToken: newActiveToken });
    } else {
        res.status(400).json({ success: false, message: 'Token 无效或不在列表中。' });
    }
});

// API 接口，用于将消息发送到 Dify
app.post('/api/send-to-dify', async (req, res) => {
    const { content, chatId, telToken } = req.body;
    try {
        // 调用封装的 Dify 发送函数，标记为非自动发送
        // 从请求体中获取 userName
        const userName = req.body.userName; 
        await sendToDifyWorkflow(content, chatId, telToken, userName, false, res); // 传递 userName 和 res 对象
    } catch (error) {
        // sendToDifyWorkflow 已经处理了错误日志和响应，这里不需要额外处理
        // 如果 sendToDifyWorkflow 抛出错误，说明在发送响应之前发生了严重错误
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: error.message || '发送到 Dify 失败。' });
        }
    }
});

// API 接口，用于获取自动发送设置
app.get('/api/autosend/settings', (req, res) => {
    config = loadConfig(); // 重新加载配置以获取最新状态
    res.json({
        enabled: config.autoSend.enabled,
        filterKeyword: config.autoSend.filterKeyword
    });
});

// API 接口，用于更新自动发送设置
app.put('/api/autosend/settings', (req, res) => {
    const { enabled, filterKeyword } = req.body;
    config = loadConfig(); // 重新加载配置以获取最新状态
    config.autoSend.enabled = enabled;
    config.autoSend.filterKeyword = filterKeyword;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('自动发送设置已更新:', config.autoSend);
    res.json({ success: true, message: '自动发送设置已保存。', settings: config.autoSend });
});


// SSE 接口，用于前端监听 Dify 状态更新
app.get('/api/dify-status/:workflowRunId', (req, res) => {
    const workflowRunId = req.params.workflowRunId;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // 将客户端响应对象添加到 Map 中
    if (!clients.has(workflowRunId)) {
        clients.set(workflowRunId, []);
    }
    clients.get(workflowRunId).push(res);

    req.on('close', () => {
        console.log(`客户端断开连接: ${workflowRunId}`);
        // 在尝试过滤之前，先检查 workflowRunId 对应的客户端列表是否存在
        if (clients.has(workflowRunId)) {
            clients.set(workflowRunId, clients.get(workflowRunId).filter(client => client !== res));
            if (clients.get(workflowRunId).length === 0) {
                clients.delete(workflowRunId);
            }
        }
    });
});


// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`请访问 http://localhost:${PORT} 查看消息。`);
});
