export function toast(message, type) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.innerHTML = '<span class="t-dot"></span><span></span>';
  el.querySelector('span:last-child').textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Real viewport height in px, kept in --app-vh (same rationale as the
// old httpd-era app.js: some Android WebViews get 100dvh wrong).
export function initViewportFix() {
  function sync() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (h) document.documentElement.style.setProperty('--app-vh', h + 'px');
  }
  sync();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', sync);
}
