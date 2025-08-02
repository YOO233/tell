document.addEventListener('DOMContentLoaded', () => {
    const messagesContainer = document.getElementById('messages-container');
    const telegramTokenSelect = document.getElementById('telegramTokenSelect');
    const newTelegramTokenInput = document.getElementById('newTelegramToken');
    const addTokenButton = document.getElementById('addTokenButton');
    const autoSendToggle = document.getElementById('autoSendToggle');
    const filterKeywordInput = document.getElementById('filterKeywordInput');
    const saveAutoSendSettingsButton = document.getElementById('saveAutoSendSettings');

    let lastMessageId = null; // 用于跟踪最后一条消息的ID，防止重复显示
    let currentDifyConfig = {}; // 存储 Dify API 配置
    let currentActiveTelegramToken = ''; // 存储当前激活的 Telegram Token

    // --- 配置管理功能 (包括 Token 和自动发送) ---
    async function fetchConfig() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            currentDifyConfig = {
                apiUrl: config.difyApiUrl,
                apiKey: config.difyApiKey
            };
            currentActiveTelegramToken = config.activeTelegramToken; // 更新当前激活的 Token

            populateTokenSelect(config.telegramTokens, config.activeTelegramToken);
            
            // 设置自动发送开关和关键词
            autoSendToggle.checked = config.autoSendEnabled;
            filterKeywordInput.value = config.autoSendFilterKeyword;

        } catch (error) {
            console.error('获取配置失败:', error);
            alert('无法加载配置，请检查后端服务。');
        }
    }

    function populateTokenSelect(tokens, activeToken) {
        telegramTokenSelect.innerHTML = ''; // 清空现有选项
        tokens.forEach(token => {
            const option = document.createElement('option');
            option.value = token;
            option.textContent = `${token.substring(0, 10)}...`; // 显示部分 Token
            if (token === activeToken) {
                option.selected = true;
            }
            telegramTokenSelect.appendChild(option);
        });
    }

    addTokenButton.addEventListener('click', async () => {
        const newToken = newTelegramTokenInput.value.trim();
        if (newToken) {
            try {
                const response = await fetch('/api/tokens', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: newToken })
                });
                const result = await response.json();
                if (result.success) {
                    alert(result.message);
                    newTelegramTokenInput.value = '';
                    fetchConfig(); // 重新加载配置以更新下拉菜单
                } else {
                    alert(result.message);
                }
            } catch (error) {
                console.error('添加 Token 失败:', error);
                alert('添加 Token 失败，请检查网络或后端。');
            }
        } else {
            alert('请输入有效的 Token。');
        }
    });

    telegramTokenSelect.addEventListener('change', async () => {
        const selectedToken = telegramTokenSelect.value;
        if (selectedToken) {
            try {
                const response = await fetch('/api/tokens/active', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: selectedToken })
                });
                const result = await response.json();
                if (result.success) {
                    alert(result.message);
                    // 重新加载页面或刷新消息，因为后端轮询已重启
                    lastMessageId = null; // 重置，以便获取新 Token 的消息
                    messagesContainer.innerHTML = '<p class="placeholder">等待接收 Telegram 消息...</p>'; // 清空消息显示
                    fetchMessages(); // 立即获取新 Token 的消息
                } else {
                    alert(result.message);
                }
            } catch (error) {
                console.error('切换 Token 失败:', error);
                alert('切换 Token 失败，请检查网络或后端。');
            }
        }
    });

    // --- 消息获取和显示功能 ---
    async function fetchMessages() {
        try {
            const response = await fetch('/api/messages');
            const messages = await response.json();

            // 过滤掉已经显示过的消息
            const newMessages = messages.filter(msg => msg.id > lastMessageId);

            if (newMessages.length > 0) {
                // 移除占位符
                const placeholder = messagesContainer.querySelector('.placeholder');
                if (placeholder) {
                    messagesContainer.removeChild(placeholder);
                }

                newMessages.forEach(msg => {
                    const messageElement = document.createElement('div');
                    messageElement.classList.add('message-item');
                    messageElement.innerHTML = `
                        <div class="message-header">
                            <strong>${msg.from}:</strong>
                            <span class="message-meta">UpdateID: ${msg.id} | ChatID: ${msg.chatId}</span>
                        </div>
                        <div class="message-body">${msg.text}</div>
                        <span class="timestamp">${msg.date}</span>
                        <div class="message-actions">
                            <button class="send-to-dify-button" 
                                    data-content="${encodeURIComponent(msg.text)}" 
                                    data-chatid="${msg.chatId}"
                                    data-teltoken="${currentActiveTelegramToken}"
                                    data-from="${encodeURIComponent(msg.from)}"
                                    ${msg.autoSent ? 'disabled' : ''}>
                                ${msg.autoSent ? '已自动发送' : '发送到 Dify'}
                            </button>
                        </div>
                    `;
                    messagesContainer.appendChild(messageElement);

                    // 如果是自动发送的消息，立即设置其按钮样式
                    if (msg.autoSent) {
                        const autoSentButton = messageElement.querySelector('.send-to-dify-button');
                        if (autoSentButton) {
                            autoSentButton.classList.add('succeeded'); // 标记为成功发送的样式
                        }
                    }
                });

                // 更新最后一条消息的ID
                lastMessageId = newMessages[newMessages.length - 1].id;

                // 滚动到底部
                messagesContainer.scrollTop = messagesContainer.scrollHeight;

                // 为新添加的按钮绑定事件
                document.querySelectorAll('.send-to-dify-button:not([disabled])').forEach(button => {
                    button.onclick = sendToDify;
                });
            }
        } catch (error) {
            console.error('获取消息失败:', error);
            // 可以在这里显示一个错误消息给用户
        }
    }

    // --- 发送到 Dify 功能 ---
    async function sendToDify(event) {
        const button = event.target;
        const content = decodeURIComponent(button.dataset.content);
        const chatId = button.dataset.chatid;
        const telToken = button.dataset.teltoken; // 获取当前激活的 Telegram Token
        const userName = decodeURIComponent(button.dataset.from); // 获取发送者名称

        button.disabled = true;
        button.textContent = '发送中...';
        button.classList.add('sending'); // 添加发送中的样式

        try {
            const response = await fetch('/api/send-to-dify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, chatId, telToken, userName }) // 包含 userName
            });
            const result = await response.json();

            if (result.success && result.workflow_run_id) {
                button.textContent = '工作流已启动...';
                button.classList.remove('sending');
                button.classList.add('started'); // 添加启动中的样式

                // 连接 SSE 监听 Dify 状态
                const eventSource = new EventSource(`/api/dify-status/${result.workflow_run_id}`);

                eventSource.onmessage = function(event) {
                    const eventData = JSON.parse(event.data);
                    console.log('收到 Dify SSE 事件:', eventData);

                    if (eventData.event === 'workflow_finished') {
                        eventSource.close(); // 关闭 SSE 连接
                        if (eventData.data.status === 'succeeded') {
                            button.textContent = '已成功';
                            button.classList.remove('started', 'failed');
                            button.classList.add('succeeded'); // 添加成功样式
                        } else {
                            button.textContent = '已失败';
                            button.classList.remove('started', 'succeeded');
                            button.classList.add('failed'); // 添加失败样式
                            alert('Dify 工作流执行失败: ' + (eventData.data.error || '未知错误'));
                        }
                    } else if (eventData.event === 'node_started' || eventData.event === 'node_finished') {
                        // 简化处理中状态显示，避免因缺少数据而显示不完整
                        button.textContent = '处理中...';
                    }
                    // 其他事件可以根据需要处理
                };

                eventSource.onerror = function(err) {
                    console.error('SSE 连接错误:', err);
                    eventSource.close();
                    button.textContent = '连接错误';
                    button.classList.remove('sending', 'started', 'succeeded');
                    button.classList.add('failed');
                    alert('Dify 状态更新连接失败。');
                };

            } else {
                button.textContent = '发送失败';
                button.classList.remove('sending', 'started', 'succeeded');
                button.classList.add('failed');
                alert('发送到 Dify 失败: ' + (result.message || '未知错误'));
            }
        } catch (error) {
            console.error('发送到 Dify 失败:', error);
            button.textContent = '发送失败';
            button.classList.remove('sending', 'started', 'succeeded');
            button.classList.add('failed');
            alert('发送到 Dify 失败，请检查网络或后端。');
        }
    }

    // --- 自动发送设置保存功能 ---
    saveAutoSendSettingsButton.addEventListener('click', async () => {
        const enabled = autoSendToggle.checked;
        const filterKeyword = filterKeywordInput.value.trim();

        try {
            const response = await fetch('/api/autosend/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled, filterKeyword })
            });
            const result = await response.json();
            if (result.success) {
                alert(result.message);
                // 重新加载配置以确保前端状态同步
                fetchConfig(); 
            } else {
                alert(result.message);
            }
        } catch (error) {
            console.error('保存自动发送设置失败:', error);
            alert('保存自动发送设置失败，请检查网络或后端。');
        }
    });


    // 首次加载时获取配置和消息
    fetchConfig();
    fetchMessages();

    // 每隔3秒轮询一次消息
    setInterval(fetchMessages, 3000);
});
