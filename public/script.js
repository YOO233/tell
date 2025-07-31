document.addEventListener('DOMContentLoaded', () => {
    const messagesContainer = document.getElementById('messages-container');
    let lastMessageId = null; // 用于跟踪最后一条消息的ID，防止重复显示

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
                    `;
                    messagesContainer.appendChild(messageElement);
                });

                // 更新最后一条消息的ID
                lastMessageId = newMessages[newMessages.length - 1].id;

                // 滚动到底部
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (error) {
            console.error('获取消息失败:', error);
            // 可以在这里显示一个错误消息给用户
        }
    }

    // 首次加载时获取消息
    fetchMessages();

    // 每隔3秒轮询一次
    setInterval(fetchMessages, 3000);
});
