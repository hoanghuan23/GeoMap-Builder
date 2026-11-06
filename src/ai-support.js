export function initializeAiSupport(document) {
  const builderNav = document.getElementById('map-builder-nav');
  const supportNav = document.getElementById('ai-support-nav');
  const sidebar = document.getElementById('map-builder-sidebar');
  const panel = document.getElementById('ai-support');
  const form = document.getElementById('ai-support-form');
  const input = document.getElementById('ai-support-input');
  const send = document.getElementById('ai-support-send');
  const status = document.getElementById('ai-support-status');
  if (!builderNav || !supportNav || !sidebar || !panel || !form || !input || !send || !status) return;

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
    send.disabled = !input.value.trim();
    status.hidden = true;
    input.style.height = '35px';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (input.value.trim()) form.requestSubmit();
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim()) return;
    status.textContent = 'Chưa thể gửi yêu cầu vì AI hỗ trợ chưa được kết nối. Nội dung bạn nhập vẫn được giữ lại.';
    status.hidden = false;
  });
}
