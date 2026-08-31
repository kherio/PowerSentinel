// Shared helpers for XtremeBS WebUI (status / conf / log pages)

var ICONS = {
  cpu: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"></path></svg>',
  wifi: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5a16 16 0 0 1 20 0"></path><path d="M5.5 12.5a11 11 0 0 1 13 0"></path><path d="M9 16.5a6 6 0 0 1 6 0"></path><circle cx="12" cy="20" r="1"></circle></svg>',
  moon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path></svg>',
  ram: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="16" height="7" rx="1"></rect><path d="M7 9V6M11 9V6M15 9V6M17 9V6"></path></svg>',
  warn: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"></path><path d="M12 10v4M12 17h.01"></path></svg>',
  bolt: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"></path></svg>',
  leaf: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 9-11 0 6 2 8 2 12a6 6 0 0 1-4 6z"></path></svg>',
  power: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"></path><path d="M18.4 6.6a9 9 0 1 1-12.8 0"></path></svg>',
  plug: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v4M15 2v4M7 6h10v4a5 5 0 0 1-10 0V6z"></path><path d="M12 15v3M9 22h6"></path></svg>',
  manual: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
  save: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"></path><path d="M8 3v6h8V3M8 21v-7h8v7"></path></svg>',
  reload: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"></path><path d="M3 21v-5h5"></path></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path><path d="M10 11v6M14 11v6"></path></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>',
  download: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"></path><path d="M4 19h16"></path></svg>',
  filter: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16l-6 8v6l-4-2v-4z"></path></svg>'
};

function toast(message, type) {
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  var el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.innerHTML = '<span class="t-dot"></span><span></span>';
  el.querySelector('span:last-child').textContent = message;
  container.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('show'); });
  setTimeout(function () {
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 200);
  }, 2600);
}

function xbsFetch(url, options) {
  return fetch(url, options).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- Swipe-to-navigate between tabs (Estado / Config / Log) ----
// Any page can opt in with initSwipeNav('/'|'/conf'|'/log'). A page with
// unsaved-changes protection (currently only /conf) exposes
// window.XBS_CONFIRM_LEAVE(): return false from it to cancel the swipe nav.
var XBS_TAB_ORDER = ['/', '/conf', '/log'];

function xbsNavigateTo(path) {
  if (typeof window.XBS_CONFIRM_LEAVE === 'function' && !window.XBS_CONFIRM_LEAVE()) return;
  document.body.classList.add('nav-fade-out');
  setTimeout(function () { window.location.href = path; }, 120);
}

// Also guard direct taps on the top tab bar (not just swipes) with the same
// unsaved-changes confirmation, when the current page defines one. Runs
// immediately (not on DOMContentLoaded) since this script tag sits at the
// end of <body>, after the nav markup already exists in the DOM.
(function () {
  var links = document.querySelectorAll('nav.tabs a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (e) {
      if (typeof window.XBS_CONFIRM_LEAVE === 'function' && !window.XBS_CONFIRM_LEAVE()) {
        e.preventDefault();
      }
    });
  }
})();

function initSwipeNav(currentPath) {
  var idx = XBS_TAB_ORDER.indexOf(currentPath);
  if (idx === -1) return;
  var startX = null, startY = null, tracking = false;
  var THRESHOLD = 70;

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (!tracking || startX === null) return;
    tracking = false;
    var touch = e.changedTouches[0];
    var dx = touch.clientX - startX;
    var dy = touch.clientY - startY;
    startX = null; startY = null;

    if (Math.abs(dx) < THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.3) return; // mostly-vertical drag, treat as scroll

    var targetIdx = dx < 0 ? idx + 1 : idx - 1; // swipe left -> next tab, right -> previous
    if (targetIdx < 0 || targetIdx >= XBS_TAB_ORDER.length) return;
    xbsNavigateTo(XBS_TAB_ORDER[targetIdx]);
  }, { passive: true });
} // end initSwipeNav

// Real viewport height in px, kept in --app-vh. Some Android WebViews either
// don't support the "dvh" unit or compute it wrong, which can push content
// (like a Save button) below the visible area. window.innerHeight is old and
// universally supported, so it's used as the source of truth whenever it's
// available, with 100dvh only as a pre-JS fallback in the CSS.
(function () {
  function syncViewportHeight() {
    var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    if (h) document.documentElement.style.setProperty('--app-vh', h + 'px');
  }
  syncViewportHeight();
  window.addEventListener('resize', syncViewportHeight);
  window.addEventListener('orientationchange', syncViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportHeight);
  }
})();
