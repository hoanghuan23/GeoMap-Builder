export function initializeAiSupport(document, { getEditor } = {}) {
  const builderNav = document.getElementById('map-builder-nav');
  const supportNav = document.getElementById('ai-support-nav');
  const sidebar = document.getElementById('map-builder-sidebar');
  const panel = document.getElementById('ai-support');
  const form = document.getElementById('ai-support-form');
  const input = document.getElementById('ai-support-input');
  const send = document.getElementById('ai-support-send');
  const status = document.getElementById('ai-support-status');
  if (!builderNav || !supportNav || !sidebar || !panel || !form || !input || !send || !status) return;
  const conversation = panel.querySelector('.ai-support-conversation');
  if (!conversation) return;
  const transcript = document.createElement('div');
  conversation.append(transcript);
  const sessions = new Map();
  let groupId = null; let busy = false;
  const messagesFor = id => { if (!sessions.has(id)) sessions.set(id, []); return sessions.get(id); };
  function renderMessages() {
    transcript.replaceChildren(...messagesFor(groupId).map(message => {
      const row = document.createElement('div');
      row.className = `ai-support-message ai-support-message-${message.role}`;
      const bubble = document.createElement('div'); bubble.className = 'ai-support-bubble ai-support-chat-text';
      bubble.textContent = message.content;
      row.append(bubble); return row;
    }));
    conversation.scrollTop = conversation.scrollHeight;
  }
  document.addEventListener('map-workspace-change', event => {
    if (groupId === event.detail.groupId) return;
    groupId = event.detail.groupId;
    status.hidden = true; renderMessages();
  });

  function showSupport(show) {
    sidebar.hidden = show;
    panel.hidden = !show;
    builderNav.classList.toggle('active', !show);
    supportNav.classList.toggle('active', show);
    const active = show ? supportNav : builderNav;
    const inactive = show ? builderNav : supportNav;
    active.setAttribute('aria-current', 'page');
    inactive.removeAttribute('aria-current');
    if (show) input.focus({ preventScroll: true });
  }

  builderNav.addEventListener('click', event => { event.preventDefault(); showSupport(false); });
  supportNav.addEventListener('click', event => { event.preventDefault(); showSupport(true); });

  input.addEventListener('input', () => {
    send.disabled = busy || !input.value.trim();
    status.hidden = true;
    input.style.height = '35px';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!busy && input.value.trim()) form.requestSubmit();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !input.value.trim()) return;
    const content = input.value.trim();
    input.value = ''; input.style.height = '35px';
    let userMessage; let origin;
    busy = true; send.disabled = true; input.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'AI đang xử lý yêu cầu chỉnh sửa…'; status.hidden = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 125_000);
    try {
      const editor = await getEditor?.();
      if (!editor) throw new Error('Chưa kết nối được bản đồ. Hãy tải lại trang.');
      const context = editor.getContext();
      origin = context.groupId; groupId = origin;
      const messages = messagesFor(origin);
      const history = messages.filter(message => !message.failed).map(({ role, content }) => ({ role, content }));
      userMessage = { role: 'user', content };
      messages.push(userMessage); renderMessages();
      const result = await editor.chat(content, history, { signal: controller.signal });
      messages.push({ role: 'assistant', content: result.message });
      status.hidden = true;
      renderMessages();
    } catch (error) {
      if (userMessage) userMessage.failed = true;
      input.value = content;
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
      status.textContent = error.name === 'AbortError' ? 'AI xử lý quá lâu. Nội dung vẫn được giữ để bạn gửi lại.' : error.message;
      status.hidden = false;
    } finally {
      clearTimeout(timer); busy = false; input.disabled = false;
      send.disabled = !input.value.trim(); form.removeAttribute('aria-busy');
      if (!panel.hidden) input.focus({ preventScroll: true });
    }
  });
}
