/**
 * NexusTrack — Frontend JS
 * Vanilla JS SPA: client-side router, API client, auth state, components
 */

'use strict';

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════
const API_BASE = '/api';

// ═══════════════════════════════════════════════════════════
//  API CLIENT
// ═══════════════════════════════════════════════════════════
const api = {
  async _req(method, path, body, opts = {}) {
    const token = Store.get('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
        ...opts,
      });

      const json = await res.json().catch(() => ({ ok: false, error: 'Invalid server response' }));

      if (!res.ok && res.status === 401) {
        Store.clear();
        Router.go('/login');
      }

      return { ok: res.ok, status: res.status, ...json };
    } catch (e) {
      return { ok: false, error: 'Network error — please check your connection' };
    }
  },

  get:    (path)       => api._req('GET',   path),
  post:   (path, body) => api._req('POST',  path, body),
  patch:  (path, body) => api._req('PATCH', path, body),
  delete: (path)       => api._req('DELETE',path),

  // Typed endpoints
  auth: {
    register: (data)    => api.post('/auth/register', data),
    login:    (data)    => api.post('/auth/login', data),
    logout:   ()        => api.post('/auth/logout'),
    me:       ()        => api.get('/auth/me'),
    changePw: (data)    => api.post('/auth/change-password', data),
  },
  bookings: {
    create:   (data)    => api.post('/bookings/demo', data),
    list:     ()        => api.get('/bookings/demo'),
    update:   (id, data)=> api.patch(`/bookings/demo/${id}`, data),
  },
  contact:   (data)    => api.post('/contact', data),
  newsletter:(email)   => api.post('/newsletter/subscribe', { email }),
  plans:     ()        => api.get('/plans'),
  integrations: (params='') => api.get(`/integrations${params}`),
  testimonials: (params='') => api.get(`/testimonials${params}`),
  dashboard: ()        => api.get('/dashboard/stats'),
  admin: {
    stats:   () => api.get('/admin/stats'),
    users:   () => api.get('/admin/users'),
    messages:() => api.get('/contact'),
    bookings:() => api.get('/bookings/demo'),
  },
};

// ═══════════════════════════════════════════════════════════
//  STORE (localStorage-backed)
// ═══════════════════════════════════════════════════════════
const Store = {
  get:   (key)       => { try { return JSON.parse(localStorage.getItem(`nx_${key}`)); } catch { return null; } },
  set:   (key, val)  => localStorage.setItem(`nx_${key}`, JSON.stringify(val)),
  del:   (key)       => localStorage.removeItem(`nx_${key}`),
  clear: ()          => { Store.del('token'); Store.del('user'); },

  get user() { return Store.get('user'); },
  get token(){ return Store.get('token'); },
  setAuth(user, token) {
    Store.set('user', user);
    Store.set('token', token);
    EventBus.emit('auth:change', user);
  },
  clearAuth() {
    Store.clear();
    EventBus.emit('auth:change', null);
  },
};

// ═══════════════════════════════════════════════════════════
//  EVENT BUS
// ═══════════════════════════════════════════════════════════
const EventBus = {
  _listeners: {},
  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
    return () => this.off(event, cb);
  },
  off(event, cb) {
    this._listeners[event] = (this._listeners[event] || []).filter(x => x !== cb);
  },
  emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  },
};

// ═══════════════════════════════════════════════════════════
//  CLIENT-SIDE ROUTER
// ═══════════════════════════════════════════════════════════
const Router = {
  routes: [],
  currentPath: null,

  register(pattern, handler, { auth = false, guest = false } = {}) {
    this.routes.push({ pattern, handler, auth, guest });
  },

  go(path, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', path);
    else         history.pushState(null, '', path);
    this._resolve(path);
  },

  _resolve(path) {
    this.currentPath = path;
    const route = this.routes.find(r => {
      if (typeof r.pattern === 'string') return r.pattern === path;
      return r.pattern.test(path);
    });

    if (!route) { this._render(Pages.notFound()); return; }

    if (route.auth && !Store.token) { Router.go('/login', { replace: true }); return; }
    if (route.guest && Store.token) { Router.go('/dashboard', { replace: true }); return; }

    const match = typeof route.pattern === 'string'
      ? {}
      : (path.match(route.pattern) || []).slice(1).reduce((a, v, i) => ({ ...a, [`$${i}`]: v }), {});

    Promise.resolve(route.handler(match)).then(html => this._render(html));
  },

  _render(html) {
    const app = document.getElementById('app');
    if (app) { app.innerHTML = html; this._afterRender(); }
  },

  _afterRender() {
    // Re-attach link listeners
    document.querySelectorAll('[data-link]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        Router.go(el.getAttribute('href') || el.dataset.href);
      });
    });
    // Re-attach nav state
    Nav.update();
    // Run page init
    if (typeof window.__pageInit === 'function') {
      window.__pageInit();
      window.__pageInit = null;
    }
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Run reveal observers
    initReveal();
  },

  init() {
    window.addEventListener('popstate', () => this._resolve(location.pathname));
    this._resolve(location.pathname);
  },
};

// ═══════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
const Toast = {
  container: null,
  init() {
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position:fixed; top:20px; right:20px; z-index:9999;
      display:flex; flex-direction:column; gap:10px;
      pointer-events:none;
    `;
    document.body.appendChild(this.container);
  },
  show(message, type = 'success', duration = 4000) {
    const colors = {
      success: 'var(--emerald)',
      error:   '#ef4444',
      info:    '#3b82f6',
      warning: 'var(--gold)',
    };
    const toast = document.createElement('div');
    toast.style.cssText = `
      background: var(--surface-2);
      border: 1px solid ${colors[type]}44;
      border-left: 3px solid ${colors[type]};
      border-radius: 8px;
      padding: 14px 18px;
      color: var(--text-1);
      font-size: 14px;
      font-family: var(--font-sans);
      max-width: 360px;
      pointer-events: all;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      animation: toastIn 0.3s cubic-bezier(0.16,1,0.3,1) both;
      display: flex; align-items: center; gap: 10px;
    `;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `
      <span style="color:${colors[type]};font-weight:600;font-size:15px;flex-shrink:0;">${icons[type]}</span>
      <span>${message}</span>
    `;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.25s ease forwards';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  },
  success: (m) => Toast.show(m, 'success'),
  error:   (m) => Toast.show(m, 'error'),
  info:    (m) => Toast.show(m, 'info'),
};

// ═══════════════════════════════════════════════════════════
//  SCROLL REVEAL
// ═══════════════════════════════════════════════════════════
function initReveal() {
  const els = document.querySelectorAll('.reveal:not(.visible)');
  if (!els.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
  els.forEach(el => obs.observe(el));
}

// ═══════════════════════════════════════════════════════════
//  ANIMATED COUNTER
// ═══════════════════════════════════════════════════════════
function initCounters() {
  document.querySelectorAll('.counter[data-target]').forEach(el => {
    const target = parseFloat(el.dataset.target);
    const decimal = el.dataset.decimal === 'true';
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      const start = performance.now();
      const tick  = (now) => {
        const p = Math.min((now - start) / 1800, 1);
        const v = (1 - Math.pow(1-p, 3)) * target;
        el.textContent = decimal ? v.toFixed(1) : Math.round(v).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      obs.unobserve(el);
    }, { threshold: 0.5 });
    obs.observe(el);
  });
}

// ═══════════════════════════════════════════════════════════
//  FORM HELPERS
// ═══════════════════════════════════════════════════════════
function formData(formEl) {
  const fd = new FormData(formEl);
  return Object.fromEntries(fd.entries());
}

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spin"></span> Loading...`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.origText || 'Submit';
    btn.disabled = false;
  }
}

function showError(formEl, message) {
  const el = formEl.querySelector('.form-error');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}
function clearError(formEl) {
  const el = formEl.querySelector('.form-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

// ═══════════════════════════════════════════════════════════
//  NAV COMPONENT
// ═══════════════════════════════════════════════════════════
const Nav = {
  update() {
    const user = Store.user;
    const nav  = document.getElementById('nav');
    if (!nav) return;

    // Scroll effect
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
    window.removeEventListener('scroll', Nav._onScroll);
    Nav._onScroll = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Mobile hamburger
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobile-menu');
    if (hamburger && mobileMenu) {
      hamburger.onclick = () => {
        const open = mobileMenu.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', open);
        const spans = hamburger.querySelectorAll('span');
        if (open) {
          spans[0].style.transform = 'rotate(45deg) translate(4px, 4px)';
          spans[1].style.opacity = '0';
          spans[2].style.transform = 'rotate(-45deg) translate(4px, -4px)';
        } else {
          spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
        }
      };
    }

    // Auth state in nav
    const navAuth = document.getElementById('nav-auth');
    if (navAuth) {
      if (user) {
        navAuth.innerHTML = `
          <a href="/dashboard" data-link class="nav-right-link">Dashboard</a>
          <button class="btn btn-ghost" id="nav-logout">Logout</button>
        `;
        navAuth.querySelector('#nav-logout').onclick = async () => {
          await api.auth.logout();
          Store.clearAuth();
          Router.go('/');
          Toast.success('Logged out successfully');
        };
      } else {
        navAuth.innerHTML = `
          <a href="/login" data-link class="nav-right-link">Login</a>
          <a href="/demo" data-link class="btn btn-outline-gold">Book a Demo</a>
          <a href="/signup" data-link class="btn btn-primary">Start Free Trial</a>
        `;
      }
      // Re-attach data-link
      navAuth.querySelectorAll('[data-link]').forEach(el => {
        el.addEventListener('click', e => { e.preventDefault(); Router.go(el.getAttribute('href')); });
      });
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  SHARED HTML COMPONENTS
// ═══════════════════════════════════════════════════════════
const Components = {
  nav: () => `
<nav class="nav" id="nav" aria-label="Main navigation">
  <div class="nav-inner">
    <a href="/" data-link class="nav-logo" aria-label="NexusTrack home">
      <svg class="nav-logo-mark" width="34" height="34" viewBox="0 0 34 34" fill="none">
        <rect width="34" height="34" rx="8" fill="rgba(74,140,110,0.12)" stroke="rgba(74,140,110,0.3)" stroke-width="1"/>
        <path d="M9 25L14 17L19 21L24 11" stroke="#4a8c6e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="24" cy="11" r="2.5" fill="#4a8c6e"/>
      </svg>
      <div>
        <span class="nav-logo-text">NexusTrack</span>
        <span class="nav-logo-sub">Attribution</span>
      </div>
    </a>

    <ul class="nav-links" role="list">
      <li class="nav-item" role="none">
        <span class="nav-link" tabindex="0">Product
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <div class="nav-dropdown nav-dropdown-wide" role="menu">
          <a href="/features/ai-ads" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="#4a8c6e" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div><div class="nav-dd-label">AI Ads Manager</div><div class="nav-dd-sub">Track, manage &amp; optimize ads</div></div></a>
          <a href="/features/ai-chat" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="#4a8c6e" stroke-width="1.3"/></svg></div><div><div class="nav-dd-label">AI Chat <span class="new-badge">New</span></div><div class="nav-dd-sub">Chat with your ads data</div></div></a>
          <a href="/features/attribution" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="#4a8c6e" stroke-width="1.3"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="#4a8c6e" stroke-width="1.3"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="#4a8c6e" stroke-width="1.3"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="#4a8c6e" stroke-width="1.3"/></svg></div><div><div class="nav-dd-label">Multi-Touch Attribution</div><div class="nav-dd-sub">Every touchpoint, measured</div></div></a>
          <a href="/features/analytics" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13V9M6 13V6M9 13V4M12 13V7" stroke="#4a8c6e" stroke-width="1.3" stroke-linecap="round"/></svg></div><div><div class="nav-dd-label">Analytics</div><div class="nav-dd-sub">Custom dashboards &amp; reports</div></div></a>
          <a href="/integrations" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="#4a8c6e" stroke-width="1.3"/><circle cx="12" cy="4" r="2" stroke="#4a8c6e" stroke-width="1.3"/><circle cx="12" cy="12" r="2" stroke="#4a8c6e" stroke-width="1.3"/><path d="M6 8h2M10 4.5L8 7.5M10 11.5L8 8.5" stroke="#4a8c6e" stroke-width="1.1" stroke-linecap="round"/></svg></div><div><div class="nav-dd-label">Integrations</div><div class="nav-dd-sub">100+ apps &amp; connections</div></div></a>
          <a href="/features/conversion-sync" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 0 1 10 0" stroke="#4a8c6e" stroke-width="1.3" stroke-linecap="round"/><path d="M13 8a5 5 0 0 1-10 0" stroke="#4a8c6e" stroke-width="1.3" stroke-linecap="round"/></svg></div><div><div class="nav-dd-label">Conversion Sync</div><div class="nav-dd-sub">Feed ad platforms better data</div></div></a>
        </div>
      </li>
      <li class="nav-item" role="none">
        <span class="nav-link" tabindex="0">Solutions
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <div class="nav-dropdown" role="menu">
          <a href="/solutions/saas" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 4H14l-3.5 2.5L12 13 8 10.5 4 13l1.5-4.5L2 6h4.5z" stroke="#4a8c6e" stroke-width="1.2"/></svg></div><div><div class="nav-dd-label">B2B SaaS</div><div class="nav-dd-sub">Pipeline &amp; revenue tracking</div></div></a>
          <a href="/solutions/ecommerce" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h2l2 8h8l1.5-5H6" stroke="#4a8c6e" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div><div class="nav-dd-label">Ecommerce</div><div class="nav-dd-sub">ROAS &amp; purchase attribution</div></div></a>
          <a href="/solutions/agencies" data-link class="nav-dd-item"><div class="nav-dd-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="6" r="3" stroke="#4a8c6e" stroke-width="1.2"/><circle cx="11" cy="11" r="3" stroke="#4a8c6e" stroke-width="1.2"/></svg></div><div><div class="nav-dd-label">Agencies</div><div class="nav-dd-sub">Multi-client reporting</div></div></a>
        </div>
      </li>
      <li role="none"><a href="/integrations" data-link class="nav-link">Integrations</a></li>
      <li role="none"><a href="/pricing" data-link class="nav-link">Pricing</a></li>
      <li role="none"><a href="/blog" data-link class="nav-link">Blog</a></li>
    </ul>

    <div class="nav-right" id="nav-auth" aria-label="Account actions">
      <a href="/login" data-link class="nav-right-link">Login</a>
      <a href="/demo" data-link class="btn btn-outline-gold">Book a Demo</a>
      <a href="/signup" data-link class="btn btn-primary">Start Free Trial</a>
    </div>

    <button class="nav-hamburger" id="hamburger" aria-label="Toggle menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<div class="nav-mobile" id="mobile-menu" aria-hidden="true">
  <ul class="nav-mobile-links">
    <li><a href="/" data-link>Home</a></li>
    <li><a href="/integrations" data-link>Integrations</a></li>
    <li><a href="/pricing" data-link>Pricing</a></li>
    <li><a href="/blog" data-link>Blog</a></li>
    <li><a href="/demo" data-link>Book a Demo</a></li>
  </ul>
  <div class="nav-mobile-bottom">
    <a href="/login" data-link class="btn btn-ghost">Login</a>
    <a href="/signup" data-link class="btn btn-primary">Start Free Trial</a>
  </div>
</div>`,

  footer: () => `
<footer>
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <a href="/" data-link class="footer-logo">
          <svg width="22" height="22" viewBox="0 0 34 34" fill="none"><rect width="34" height="34" rx="8" fill="rgba(74,140,110,0.12)" stroke="rgba(74,140,110,0.3)" stroke-width="1"/><path d="M9 25L14 17L19 21L24 11" stroke="#4a8c6e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="11" r="2.5" fill="#4a8c6e"/></svg>
          NexusTrack
        </a>
        <p class="footer-tagline">Smarter marketing attribution powered by AI. Know what's working and scale with confidence.</p>
        <div class="footer-socials">
          <a href="#" class="footer-social">𝕏</a>
          <a href="#" class="footer-social">in</a>
          <a href="#" class="footer-social">▶</a>
        </div>
      </div>
      <div>
        <div class="footer-col-title">Product</div>
        <ul class="footer-links">
          <li><a href="/features/ai-ads" data-link class="footer-link">AI Ads Manager</a></li>
          <li><a href="/features/ai-chat" data-link class="footer-link">AI Chat</a></li>
          <li><a href="/features/attribution" data-link class="footer-link">Attribution</a></li>
          <li><a href="/features/analytics" data-link class="footer-link">Analytics</a></li>
          <li><a href="/pricing" data-link class="footer-link">Pricing</a></li>
        </ul>
      </div>
      <div>
        <div class="footer-col-title">Company</div>
        <ul class="footer-links">
          <li><a href="/about" data-link class="footer-link">About Us</a></li>
          <li><a href="/customers" data-link class="footer-link">Customers</a></li>
          <li><a href="/blog" data-link class="footer-link">Blog</a></li>
          <li><a href="/contact" data-link class="footer-link">Contact</a></li>
        </ul>
      </div>
      <div>
        <div class="footer-col-title">Resources</div>
        <ul class="footer-links">
          <li><a href="/blog" data-link class="footer-link">Blog</a></li>
          <li><a href="/integrations" data-link class="footer-link">Integrations</a></li>
          <li><a href="/demo" data-link class="footer-link">Book a Demo</a></li>
          <li><a href="/contact" data-link class="footer-link">Help Center</a></li>
        </ul>
      </div>
      <div>
        <div class="footer-col-title">Solutions</div>
        <ul class="footer-links">
          <li><a href="/solutions/saas" data-link class="footer-link">B2B SaaS</a></li>
          <li><a href="/solutions/ecommerce" data-link class="footer-link">Ecommerce</a></li>
          <li><a href="/solutions/agencies" data-link class="footer-link">Agencies</a></li>
        </ul>
        <div class="footer-newsletter" style="margin-top:20px;">
          <form id="footer-newsletter-form" style="display:flex;gap:8px;margin-top:8px;">
            <input type="email" name="email" placeholder="Your email" class="form-input" style="flex:1;font-size:13px;padding:8px 12px;" required/>
            <button type="submit" class="btn btn-primary" style="padding:8px 14px;font-size:13px;">Join</button>
          </form>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <p class="footer-copy">© 2026 NexusTrack Inc. All rights reserved.</p>
      <nav class="footer-legal">
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/terms">Terms</a>
        <a href="/legal/cookies">Cookies</a>
      </nav>
    </div>
  </div>
</footer>`,

  starRating: (n = 5) => Array(n).fill(0).map(() =>
    `<svg style="width:13px;height:13px;" viewBox="0 0 13 13" fill="var(--gold)"><path d="M6.5 1l1.4 4.2H12L8.6 7.8l1.3 4-3.4-2.5-3.4 2.5 1.3-4L1 5.2h4.1z"/></svg>`
  ).join(''),

  spinner: () => `<div class="spinner-wrap" style="display:flex;align-items:center;justify-content:center;min-height:300px;"><div class="spin" style="width:32px;height:32px;border-width:3px;"></div></div>`,
};

// ═══════════════════════════════════════════════════════════
//  PAGES
// ═══════════════════════════════════════════════════════════
const Pages = {

  // ──────────────────────────────────────────────────────
  //  HOME
  // ──────────────────────────────────────────────────────
  async home() {
    const [plansRes, testiRes, integRes] = await Promise.all([
      api.plans(),
      api.testimonials('?featured=1'),
      api.integrations('?featured=1'),
    ]);

    const plans = plansRes.ok ? plansRes.data : [];
    const testimonials = testiRes.ok ? testiRes.data : [];
    const integrations = integRes.ok ? integRes.data : [];

    window.__pageInit = () => {
      initReveal();
      initCounters();
      // Nav scroll ticker
      const tickerTrack = document.querySelector('.ticker-track');
      if (tickerTrack) {
        // duplicate already done in HTML
      }
      // Footer newsletter
      const fnForm = document.getElementById('footer-newsletter-form');
      if (fnForm) {
        fnForm.onsubmit = async (e) => {
          e.preventDefault();
          const btn = fnForm.querySelector('button');
          setLoading(btn, true);
          const res = await api.newsletter(fnForm.email.value);
          setLoading(btn, false);
          res.ok ? Toast.success(res.message || 'Subscribed!') : Toast.error(res.error || 'Error');
          if (res.ok) fnForm.reset();
        };
      }
    };

    return `
${Components.nav()}

<!-- HERO -->
<section class="hero" id="hero">
  <div class="hero-bg">
    <div class="hero-grid"></div>
    <div class="hero-bg-radial"></div>
    <div class="hero-bg-radial-2"></div>
  </div>
  <div class="hero-content">
    <div class="hero-left">
      <div class="hero-announce">
        <div class="hero-announce-dot"></div>
        New — AI Chat with your ads data. Try it now →
      </div>
      <h1 class="hero-headline">Smarter Marketing<br><em>Attribution.</em><br>Powered by AI.</h1>
      <p class="hero-sub">NexusTrack transforms your marketing and sales data into insights, decisions, and scalable results by accurately attributing every conversion to its true source.</p>
      <div class="hero-actions">
        <a href="/signup" data-link class="btn btn-primary" style="font-size:15px;padding:13px 28px;">Start Free Trial <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <a href="/demo" data-link class="btn btn-ghost" style="font-size:15px;padding:13px 28px;">Book a Demo</a>
      </div>
      <div class="hero-pills">
        <span class="hero-pill"><span class="hero-pill-dot"></span>AI Ads Manager</span>
        <span class="hero-pill"><span class="hero-pill-dot"></span>Multi-Touch Attribution</span>
        <span class="hero-pill"><span class="hero-pill-dot"></span>Server-Side Tracking</span>
        <span class="hero-pill"><span class="hero-pill-dot"></span>Conversion Sync</span>
        <span class="hero-pill"><span class="hero-pill-dot"></span>Analytics</span>
      </div>
    </div>
    <div class="hero-right">
      <div class="hero-dashboard">
        <div class="dash-topbar"><div class="dash-dots"><div class="dash-dot dash-dot-r"></div><div class="dash-dot dash-dot-y"></div><div class="dash-dot dash-dot-g"></div></div><span class="dash-topbar-title">NexusTrack — Ads Manager</span></div>
        <div class="dash-body">
          <div class="dash-stats">
            <div class="dash-stat"><div class="dash-stat-label">Revenue</div><div class="dash-stat-val">$84.2k</div><div class="dash-stat-chg">↑ 24.1%</div></div>
            <div class="dash-stat"><div class="dash-stat-label">ROAS</div><div class="dash-stat-val">5.8×</div><div class="dash-stat-chg">↑ 11.3%</div></div>
            <div class="dash-stat"><div class="dash-stat-label">Conversions</div><div class="dash-stat-val">1,247</div><div class="dash-stat-chg">↑ 8.6%</div></div>
          </div>
          <div class="dash-chart">
            <div class="dash-chart-header"><span class="dash-chart-title">Revenue by Campaign</span><span class="dash-chart-range">Last 30 days</span></div>
            <div class="dash-bars">
              ${[40,60,45,80,55,90,70,50,85,65,95,75].map((h,i) => `<div class="dash-bar" style="height:${h}%;background:${h>70?'var(--emerald)':h>55?'var(--emerald-dim)':'var(--surface-4)'};animation-delay:${0.1+i*0.05}s;"></div>`).join('')}
            </div>
          </div>
          <div class="dash-table">
            ${[['Meta Ads','$31,240','37%','#3b82f6'],['Google Ads','$24,810','29%','#ef4444'],['Organic','$18,150','21%','var(--emerald)'],['Email','$10,000','13%','var(--gold)']].map(([src,val,pct,col]) => `<div class="dash-tr"><div class="dash-tr-source"><div class="dash-tr-dot" style="background:${col};"></div>${src}</div><div class="dash-tr-val">${val}</div><div class="dash-tr-pct">${pct}</div></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="hero-ai-chip"><div class="hero-ai-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="rgba(255,255,255,0.8)" stroke-width="1.2"/><path d="M7 4v3l2 2" stroke="rgba(255,255,255,0.8)" stroke-width="1.2" stroke-linecap="round"/></svg></div><div class="hero-ai-text"><strong>AI Insight</strong><span>Campaign 9 — scale now</span></div></div>
      <div class="hero-trust-chip"><div class="chip-num">98%</div><div class="chip-label">Client Satisfaction</div></div>
    </div>
  </div>
</section>

<!-- TICKER -->
<div class="ticker-section">
  <div class="ticker-label">Trusted by thousands of growth teams worldwide</div>
  <div class="ticker-track">
    ${['Trainual','ClickFunnels','Instantly','Arcads','SkinnyFit','Design Pickle','Book Your Data','AdOutreach','SaaSRise','Clicks Geek','Trainual','ClickFunnels','Instantly','Arcads','SkinnyFit','Design Pickle','Book Your Data','AdOutreach','SaaSRise','Clicks Geek'].map(b=>`<span class="ticker-item">${b}</span><span class="ticker-sep"></span>`).join('')}
  </div>
</div>

<!-- FEATURED QUOTE -->
<div class="quote-section">
  <div class="container">
    <div class="quote-inner reveal">
      <span class="quote-mark">"</span>
      <blockquote class="quote-text">NexusTrack gave us something we've never had before: confidence in our data. Now we know exactly what's working and with AI, we're optimizing in real time with smart recommendations on where to shift budget and how to scale faster.</blockquote>
      <div class="quote-author"><div class="quote-avatar">JP</div><div><div class="quote-name">John Parkes</div><div class="quote-title">CMO at ClickFunnels</div></div></div>
      <div class="badges-row">
        ${[['★ 4.9','G2 Rating'],['High','Performer'],['#1','Momentum'],['Easy','Admin'],['98%','Recommend']].map(([v,l])=>`<div class="badge-item"><div class="badge-item-val">${v}</div><div class="badge-item-label">${l}</div></div>`).join('')}
      </div>
    </div>
  </div>
</div>

<!-- VALUE PROPS -->
<section class="value-section">
  <div class="container">
    <div class="value-header reveal">
      <div class="section-eyebrow">Why NexusTrack</div>
      <h2 class="section-title">Better Attribution. Smarter AI. <em>Stronger Results.</em></h2>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">Track every touchpoint, enrich every conversion, and let our attribution engine power AI that works for you.</p>
    </div>
    <div class="value-grid">
      ${[
        ['M3 10h14M10 3v14','Capture Every Touchpoint','From ad clicks to CRM events, NexusTrack tracks it all — providing AI a complete, enriched view of every customer journey across every channel.'],
        ['M4 16l4-4 3 3 5-7','Know What\'s Really Driving Revenue','Go beyond surface-level metrics. Connect every touchpoint to conversions so you can see which sources, ads, and campaigns actually convert.'],
        ['M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0','Get Recommendations From AI','Use AI to identify high-performing ads and campaigns across every ad channel. Then scale with confidence knowing the data is accurate.'],
        ['M5 10h10M5 6h10M5 14h7','Feed Ad Platform AI Better Data','Send enriched, conversion-ready events back to Meta, Google, and more — improving targeting, optimization, and ad ROI automatically.'],
      ].map(([icon, title, body], i) => `
      <div class="value-card reveal${i > 0 ? ` reveal-delay-${i}` : ''}">
        <div class="value-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="${icon}" stroke="var(--emerald)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h3 class="value-title">${title}</h3>
        <p class="value-body">${body}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- FEATURES -->
<section id="features">
  <div class="container">
    <div class="features-header reveal">
      <div class="section-eyebrow">Features</div>
      <h2 class="section-title">Measure conversions from <em>every source</em></h2>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">Unify all your marketing data into one platform for smarter, faster decisions.</p>
    </div>
    <div class="features-grid">
      ${[
        ['M3 14l4-4 3 2 5-6','AI Ads Manager','Manage and optimize ad campaigns with accurate data. Control budgets and make better scaling decisions using AI.','features/ai-ads',false],
        ['M9 9m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0','AI Chat','Chat with your ad and conversion data for actionable insights and recommendations in plain English.','features/ai-chat',true],
        ['M3 4h12v4H3zM3 10h12v4H3z','Server-Side Tracking','Built-in server-side tracking with easy one-click integrations. Zero code required.','features/server-side',false],
        ['M4 9a2 2 0 1 0 4 0a2 2 0 0 0-4 0M10 5a2 2 0 1 0 4 0a2 2 0 0 0-4 0M10 13a2 2 0 1 0 4 0a2 2 0 0 0-4 0','Multi-Touch Attribution','View data with a variety of attribution models and windows. Uncover hidden touchpoints.','features/attribution',false],
        ['M3 15V10M6.5 15V7M10 15V4M13.5 15V8','Analytics','Build custom reports and dashboards to measure organic, paid, email, outbound, and any other source.','features/analytics',false],
        ['M5 9a4 4 0 0 1 8 0','Conversion Sync','One-click setup to sync accurate conversion data with ad platforms to get better ad results.','features/conversion-sync',false],
      ].map(([icon, title, body, href, isNew], i) => `
      <article class="feat-card reveal reveal-delay-${i % 3}">
        <div class="feat-icon"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="${icon}" stroke="var(--emerald)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        ${isNew ? `<span class="feat-badge"><span class="new-badge">New</span></span>` : ''}
        <h3 class="feat-title">${title}</h3>
        <p class="feat-body">${body}</p>
        <a href="/${href}" data-link class="feat-link">Learn more <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 6h6M7 4l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
      </article>`).join('')}
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="testimonials-section">
  <div class="container" style="margin-bottom:0;padding-bottom:0;">
    <div class="testimonials-header reveal">
      <div class="section-eyebrow">Social Proof</div>
      <h2 class="section-title">Don't just take our <em>word for it</em></h2>
    </div>
  </div>
  <div class="testimonials-track-wrap">
    <div class="testimonials-track" id="testimonials-track">
      ${[...testimonials, ...testimonials].map(t => `
      <article class="testi-card">
        <div class="testi-stars">${Components.starRating(t.rating)}</div>
        <p class="testi-quote">"${t.quote}"</p>
        <div class="testi-author">
          <div class="testi-avatar">${t.initials}</div>
          <div><div class="testi-name">${t.name}</div><div class="testi-role">${t.role}, ${t.company}</div></div>
        </div>
      </article>`).join('')}
    </div>
  </div>
</section>

<!-- ANALYTICS SECTION -->
<section class="analytics-section">
  <div class="container">
    <div class="analytics-inner">
      <div>
        <div class="section-eyebrow reveal">Powerful Analytics</div>
        <h2 class="section-title reveal">Finally understand what's<br>driving your <em>growth</em></h2>
        <p class="section-body reveal reveal-delay-1" style="margin-top:16px;">See the real impact of your ads, emails, and campaigns — all in one place. Build custom reports to track what actually moves revenue.</p>
        <div class="analytics-stats reveal reveal-delay-2">
          <div class="analytics-stat"><div class="analytics-stat-num"><span class="counter" data-target="15">0</span><span>+</span></div><div class="analytics-stat-label">Years of experience</div></div>
          <div class="analytics-stat"><div class="analytics-stat-num"><span class="counter" data-target="98">0</span><span>%</span></div><div class="analytics-stat-label">Client satisfaction</div></div>
          <div class="analytics-stat"><div class="analytics-stat-num"><span class="counter" data-target="100">0</span><span>%</span></div><div class="analytics-stat-label">Dedication to quality</div></div>
          <div class="analytics-stat"><div class="analytics-stat-num"><span class="counter" data-target="10">0</span><span>k+</span></div><div class="analytics-stat-label">Companies served</div></div>
        </div>
        <div class="reveal reveal-delay-3" style="margin-top:28px;"><a href="/features/analytics" data-link class="btn btn-primary">Learn About Analytics</a></div>
      </div>
      <div class="analytics-dash-wrap reveal reveal-delay-1">
        <div class="analytics-dash">
          <div class="adash-header">
            <span class="adash-tab active">Overview</span>
            <span class="adash-tab">Campaigns</span>
            <span class="adash-tab">Attribution</span>
          </div>
          <div class="adash-body">
            <div class="adash-line-chart">
              <svg viewBox="0 0 500 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4a8c6e" stop-opacity="0.25"/><stop offset="100%" stop-color="#4a8c6e" stop-opacity="0"/></linearGradient></defs>
                <line x1="0" y1="30" x2="500" y2="30" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                <line x1="0" y1="60" x2="500" y2="60" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                <line x1="0" y1="90" x2="500" y2="90" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                <path d="M0,100 L0,80 C30,75 60,60 90,65 C120,70 150,50 180,40 C210,30 240,45 270,30 C300,15 330,25 360,18 C390,12 420,20 450,10 C470,6 490,15 500,12 L500,100 Z" fill="url(#cg)"/>
                <path d="M0,80 C30,75 60,60 90,65 C120,70 150,50 180,40 C210,30 240,45 270,30 C300,15 330,25 360,18 C390,12 420,20 450,10 C470,6 490,15 500,12" fill="none" stroke="#4a8c6e" stroke-width="2" stroke-linecap="round"/>
                <circle cx="500" cy="12" r="3" fill="#5ea882"/>
              </svg>
            </div>
            <div class="adash-sources">
              ${[['Meta Ads','#3b82f6',72],['Google Ads','#ef4444',55],['Organic','var(--emerald)',38],['Email','var(--gold-dim)',24],['TikTok Ads','var(--text-4)',18]].map(([n,c,p])=>`
              <div class="adash-source-row">
                <div class="adash-source-name">${n}</div>
                <div class="adash-source-bar-wrap"><div class="adash-source-bar" style="width:${p}%;background:${c};"></div></div>
                <div class="adash-source-pct">${p}%</div>
              </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="how-section">
  <div class="container">
    <div style="text-align:center;margin-bottom:64px;" class="reveal">
      <div class="section-eyebrow">How It Works</div>
      <h2 class="section-title">Launch with <em>expert help</em></h2>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">Getting started is fast — but you're not doing it alone.</p>
    </div>
    <div class="how-inner">
      <div class="how-steps">
        ${[
          ['Capture website activity','Install the NexusTrack Pixel and automatically start tracking all activity — visits, form fills, clicks.'],
          ['Connect your marketing & sales tools','Connect your ad accounts, CRM, and payment tools in just a few clicks to track what matters most.'],
          ['Activate Conversion Sync','Built-in server-side tracking — sync conversions to ad platforms with a single toggle. No devs needed.'],
          ['Analyze & act on accurate data','Start analyzing in real time. Find out exactly which channels and ads are working to make smarter decisions.'],
          ['Use AI to chat with your data','Ask questions about your ad performance in plain English and get actionable insights instantly.'],
        ].map(([title, body], i) => `
        <div class="how-step reveal reveal-delay-${Math.min(i,4)}" data-step="${i}">
          <div class="how-step-num">${i+1}</div>
          <div class="how-step-content">
            <h3 class="how-step-title">${title}</h3>
            <p class="how-step-body">${body}</p>
          </div>
        </div>`).join('')}
      </div>
      <div class="how-visual reveal reveal-delay-2">
        <div class="how-visual-panel">
          <div class="how-visual-inner">
            <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin-bottom:12px;">
              <div style="font-size:11px;color:var(--text-4);margin-bottom:8px;font-family:var(--font-mono);">&lt;!-- NexusTrack Pixel --&gt;</div>
              <div style="font-size:12px;font-family:var(--font-mono);color:var(--emerald-light);line-height:1.8;">&lt;script&gt;<br>&nbsp;&nbsp;nx.init('NX-XXXX')<br>&lt;/script&gt;</div>
            </div>
            ${[
              ['var(--emerald)','Pixel detected &amp; active','2s ago'],
              ['var(--emerald)','Meta Ads connected','Active'],
              ['#3b82f6','Conversion Sync: enabled','Syncing'],
              ['var(--gold-dim)','124 events tracked today','↑ 34%'],
            ].map(([c,l,s])=>`<div style="background:var(--surface-4);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:8px;"><div style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0;"></div><span style="color:var(--text-2);">${l}</span><span style="margin-left:auto;font-size:11px;color:var(--text-4);">${s}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- INTEGRATIONS -->
<section id="integrations">
  <div class="container">
    <div class="integrations-header reveal">
      <div class="section-eyebrow">Integrations</div>
      <h2 class="section-title">Connect your <em>entire stack</em></h2>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">With 100+ apps in our directory, your team's favourite tools are just a click away.</p>
    </div>
    <div class="integrations-grid reveal">
      ${integrations.map(i=>`<a href="/integrations/${i.slug}" data-link class="int-item" title="${i.name}">${i.name}</a>`).join('')}
      <a href="/integrations" data-link class="int-item" style="color:var(--emerald);">+ 85 more</a>
    </div>
    <div class="integrations-cta reveal"><a href="/integrations" data-link class="btn btn-ghost">Browse All Integrations →</a></div>
  </div>
</section>

<!-- PRICING TEASER -->
<section class="pricing-section">
  <div class="container">
    <div class="pricing-header reveal">
      <div class="section-eyebrow">Pricing</div>
      <h2 class="section-title">Simple, transparent <em>pricing</em></h2>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">Start free. Scale as you grow. No hidden fees.</p>
    </div>
    <div class="pricing-grid">
      ${plans.map((p, i) => `
      <div class="price-card ${p.is_popular ? 'featured' : ''} reveal reveal-delay-${i}">
        ${p.is_popular ? '<div class="price-popular">Most Popular</div>' : ''}
        <div class="price-tier">${p.name}</div>
        <div class="price-amount">${p.price_monthly > 0 ? `<sup>$</sup>${p.price_monthly}<span>/mo</span>` : 'Custom'}</div>
        <p class="price-desc">${p.description}</p>
        <div class="price-divider"></div>
        <ul class="price-features">
          ${p.features.map(f=>`<li class="price-feature"><div class="price-check"><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-3" stroke="#5ea882" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>${f}</li>`).join('')}
        </ul>
        <a href="${p.slug === 'enterprise' ? '/contact' : '/signup'}" data-link class="btn ${p.is_popular ? 'btn-primary' : p.slug === 'enterprise' ? 'btn-outline-gold' : 'btn-ghost'} price-btn">${p.cta_label}</a>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- FINAL CTA -->
<section class="cta-section">
  <div class="container">
    <div class="cta-inner reveal">
      <h2 class="cta-title">See NexusTrack<br><em class="grad-text">in Action</em></h2>
      <p class="cta-sub">Get a live walkthrough of how NexusTrack helps marketing teams get clear, accurate attribution — and make smarter decisions that drive growth.</p>
      <div class="cta-actions">
        <a href="/demo" data-link class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Book a Demo</a>
        <a href="/signup" data-link class="btn btn-ghost" style="font-size:15px;padding:14px 32px;">Start Free Trial</a>
      </div>
      <p class="cta-note">No credit card required · Free 14-day trial · Cancel anytime</p>
    </div>
  </div>
</section>

${Components.footer()}`;
  },

  // ──────────────────────────────────────────────────────
  //  PRICING PAGE
  // ──────────────────────────────────────────────────────
  async pricing() {
    const res = await api.plans();
    const plans = res.ok ? res.data : [];

    window.__pageInit = () => {
      initReveal();
      // Toggle annual/monthly
      const toggle = document.getElementById('billing-toggle');
      const labels = document.querySelectorAll('.billing-label');
      if (toggle) {
        toggle.onchange = () => {
          const annual = toggle.checked;
          document.querySelectorAll('.price-monthly').forEach(el => el.style.display = annual ? 'none' : '');
          document.querySelectorAll('.price-annual').forEach(el => el.style.display = annual ? '' : 'none');
          labels[0].style.opacity = annual ? '0.5' : '1';
          labels[1].style.opacity = annual ? '1' : '0.5';
        };
      }
    };

    return `
${Components.nav()}
<div style="padding-top:var(--nav-h);">
<section class="pricing-section" style="padding-top:80px;">
  <div class="container">
    <div class="pricing-header reveal">
      <div class="section-eyebrow">Pricing</div>
      <h2 class="section-title">Simple, transparent <em>pricing</em></h2>
      <p class="section-body" style="margin:16px auto 16px;text-align:center;">Start free. Scale as you grow. No hidden fees or surprises.</p>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:24px;">
        <span class="billing-label" style="font-size:14px;color:var(--text-2);">Monthly</span>
        <label style="position:relative;width:44px;height:24px;cursor:pointer;">
          <input type="checkbox" id="billing-toggle" style="opacity:0;width:0;height:0;position:absolute;">
          <span style="position:absolute;inset:0;background:var(--emerald-dim);border-radius:12px;transition:background 0.2s;border:1px solid var(--emerald);"></span>
          <span id="toggle-thumb" style="position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform 0.2s;"></span>
        </label>
        <span class="billing-label" style="font-size:14px;color:var(--text-3);">Annual <span style="color:var(--emerald);font-size:12px;font-weight:500;">Save 20%</span></span>
      </div>
    </div>
    <div class="pricing-grid" style="max-width:960px;margin:0 auto;">
      ${plans.map((p, i) => `
      <div class="price-card ${p.is_popular ? 'featured' : ''} reveal reveal-delay-${i}">
        ${p.is_popular ? '<div class="price-popular">Most Popular</div>' : ''}
        <div class="price-tier">${p.name}</div>
        <div class="price-amount price-monthly">${p.price_monthly > 0 ? `<sup>$</sup>${p.price_monthly}<span>/mo</span>` : 'Custom'}</div>
        <div class="price-amount price-annual" style="display:none;">${p.price_annual > 0 ? `<sup>$</sup>${p.price_annual}<span>/mo</span>` : 'Custom'}</div>
        <p class="price-desc">${p.description}</p>
        <div class="price-divider"></div>
        <ul class="price-features">
          ${p.features.map(f=>`<li class="price-feature"><div class="price-check"><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2 3-3" stroke="#5ea882" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>${f}</li>`).join('')}
        </ul>
        <a href="${p.slug === 'enterprise' ? '/contact' : '/signup'}" data-link class="btn ${p.is_popular ? 'btn-primary' : p.slug === 'enterprise' ? 'btn-outline-gold' : 'btn-ghost'} price-btn">${p.cta_label}</a>
      </div>`).join('')}
    </div>

    <!-- FAQ -->
    <div style="max-width:720px;margin:80px auto 0;" class="reveal">
      <h3 class="section-title" style="font-size:32px;text-align:center;margin-bottom:40px;">Frequently asked <em>questions</em></h3>
      ${[
        ['Is there a free trial?','Yes — all paid plans include a 14-day free trial. No credit card required to start.'],
        ['Can I switch plans later?','Absolutely. You can upgrade or downgrade at any time. Changes take effect immediately.'],
        ['What counts as a conversion?','Any tracked event: purchase, form submit, lead capture, signup, phone call — anything you define.'],
        ['Do you support multiple ad accounts?','Yes. The Growth and Enterprise plans support unlimited ad platform connections across all major networks.'],
        ['How does Conversion Sync work?','We send enriched conversion data server-side directly to Meta, Google, and TikTok — bypassing browser limitations and improving match rates by up to 40%.'],
      ].map(([q, a]) => `
      <div style="border-bottom:1px solid var(--border);padding:20px 0;">
        <details style="cursor:pointer;list-style:none;">
          <summary style="font-size:16px;font-weight:500;color:var(--text-1);display:flex;justify-content:space-between;align-items:center;">
            ${q}
            <span style="color:var(--emerald);font-size:20px;font-weight:300;flex-shrink:0;margin-left:16px;">+</span>
          </summary>
          <p style="font-size:14px;color:var(--text-3);line-height:1.7;margin-top:12px;">${a}</p>
        </details>
      </div>`).join('')}
    </div>
  </div>
</section>
</div>
${Components.footer()}`;
  },

  // ──────────────────────────────────────────────────────
  //  DEMO BOOKING
  // ──────────────────────────────────────────────────────
  demo() {
    window.__pageInit = () => {
      const form = document.getElementById('demo-form');
      if (!form) return;

      form.onsubmit = async (e) => {
        e.preventDefault();
        clearError(form);
        const btn = form.querySelector('button[type=submit]');
        setLoading(btn, true);
        const data = formData(form);
        const res  = await api.bookings.create(data);
        setLoading(btn, false);

        if (res.ok) {
          Toast.success(res.message || 'Demo booked!');
          document.getElementById('demo-form-wrap').innerHTML = `
            <div style="text-align:center;padding:60px 20px;">
              <div style="width:64px;height:64px;border-radius:50%;background:var(--emerald-dim);border:2px solid var(--emerald);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px;">✓</div>
              <h3 style="font-family:var(--font-serif);font-size:28px;color:var(--text-1);margin-bottom:10px;">You're booked!</h3>
              <p style="color:var(--text-3);font-size:15px;">We'll be in touch within 24 hours to confirm your demo time.</p>
              <a href="/" data-link class="btn btn-ghost" style="margin-top:24px;">Back to home</a>
            </div>`;
        } else {
          showError(form, res.error || 'Something went wrong. Please try again.');
        }
      };
    };

    return `
${Components.nav()}
<div style="padding-top:var(--nav-h);min-height:100vh;display:flex;align-items:center;">
  <div class="container" style="padding:80px 40px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:start;max-width:960px;margin:0 auto;">
      <div>
        <div class="section-eyebrow">Book a Demo</div>
        <h1 class="section-title" style="margin-bottom:16px;">See NexusTrack <em>in action</em></h1>
        <p class="section-body">Get a personalised walkthrough from one of our attribution experts. We'll show you exactly how NexusTrack works for your business.</p>
        <div style="margin-top:36px;display:flex;flex-direction:column;gap:16px;">
          ${[
            ['30-min walkthrough','Personalized to your business and ad channels'],
            ['Live attribution demo','See real data flowing through the platform'],
            ['Q&A with an expert','Get answers to your specific questions'],
            ['No commitment','Just a conversation — zero pressure'],
          ].map(([title, body]) => `
          <div style="display:flex;gap:14px;align-items:flex-start;">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--emerald-dim);border:1px solid var(--emerald);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="var(--emerald-light)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <div style="font-size:14px;font-weight:500;color:var(--text-1);">${title}</div>
              <div style="font-size:13px;color:var(--text-3);margin-top:2px;">${body}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <div id="demo-form-wrap" class="card" style="padding:36px;">
        <h3 style="font-size:18px;font-weight:500;color:var(--text-1);margin-bottom:24px;">Book your demo</h3>
        <form id="demo-form" autocomplete="on">
          <div class="form-error" style="display:none;color:#ef4444;font-size:13px;margin-bottom:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);padding:10px 14px;border-radius:6px;"></div>
          <div class="form-group">
            <label class="form-label">Full name *</label>
            <input type="text" name="name" class="form-input" placeholder="Alex Johnson" required autocomplete="name"/>
          </div>
          <div class="form-group">
            <label class="form-label">Work email *</label>
            <input type="email" name="email" class="form-input" placeholder="alex@company.com" required autocomplete="email"/>
          </div>
          <div class="form-group">
            <label class="form-label">Company *</label>
            <input type="text" name="company" class="form-input" placeholder="Acme Inc." required autocomplete="organization"/>
          </div>
          <div class="form-group">
            <label class="form-label">Team size *</label>
            <select name="team_size" class="form-input form-select" required>
              <option value="">Select team size</option>
              <option value="1-5">1-5 people</option>
              <option value="6-20">6-20 people</option>
              <option value="21-50">21-50 people</option>
              <option value="51-200">51-200 people</option>
              <option value="200+">200+ people</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">What are you hoping to solve? <span style="color:var(--text-4);">(optional)</span></label>
            <textarea name="message" class="form-input" rows="3" placeholder="Tell us about your current attribution challenges..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:15px;margin-top:8px;">Book My Demo</button>
          <p style="font-size:12px;color:var(--text-4);text-align:center;margin-top:12px;">No spam. We'll only contact you about your demo.</p>
        </form>
      </div>
    </div>
  </div>
</div>
${Components.footer()}`;
  },

  // ──────────────────────────────────────────────────────
  //  CONTACT
  // ──────────────────────────────────────────────────────
  contact() {
    window.__pageInit = () => {
      const form = document.getElementById('contact-form');
      if (!form) return;
      form.onsubmit = async (e) => {
        e.preventDefault();
        clearError(form);
        const btn = form.querySelector('button[type=submit]');
        setLoading(btn, true);
        const res = await api.contact(formData(form));
        setLoading(btn, false);
        if (res.ok) {
          Toast.success(res.message || 'Message sent!');
          form.reset();
        } else {
          showError(form, res.error || 'Something went wrong.');
        }
      };
    };

    return `
${Components.nav()}
<div style="padding-top:calc(var(--nav-h) + 80px);min-height:100vh;">
  <div class="container" style="max-width:720px;padding-bottom:100px;">
    <div class="section-eyebrow">Contact</div>
    <h1 class="section-title" style="margin-bottom:16px;">Get in <em>touch</em></h1>
    <p class="section-body" style="margin-bottom:48px;">We typically respond within 1 business day.</p>
    <div class="card" style="padding:40px;">
      <form id="contact-form">
        <div class="form-error" style="display:none;color:#ef4444;font-size:13px;margin-bottom:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);padding:10px 14px;border-radius:6px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="form-group"><label class="form-label">Name *</label><input type="text" name="name" class="form-input" required/></div>
          <div class="form-group"><label class="form-label">Email *</label><input type="email" name="email" class="form-input" required/></div>
        </div>
        <div class="form-group"><label class="form-label">Subject *</label><input type="text" name="subject" class="form-input" required/></div>
        <div class="form-group"><label class="form-label">Message *</label><textarea name="message" class="form-input" rows="6" required></textarea></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:15px;">Send Message</button>
      </form>
    </div>
  </div>
</div>
${Components.footer()}`;
  },

  // ──────────────────────────────────────────────────────
  //  INTEGRATIONS PAGE
  // ──────────────────────────────────────────────────────
  async integrations() {
    const res = await api.integrations();
    const integrations = res.ok ? res.data : [];
    const categories = [...new Set(integrations.map(i => i.category))];

    window.__pageInit = () => {
      initReveal();
      // Filter by category
      document.querySelectorAll('.cat-btn').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const cat = btn.dataset.cat;
          document.querySelectorAll('.int-card').forEach(card => {
            card.style.display = (!cat || card.dataset.cat === cat) ? '' : 'none';
          });
        };
      });

      // Newsletter
      const nf = document.getElementById('footer-newsletter-form');
      if (nf) {
        nf.onsubmit = async (e) => {
          e.preventDefault();
          const btn = nf.querySelector('button');
          setLoading(btn, true);
          const res = await api.newsletter(nf.email.value);
          setLoading(btn, false);
          res.ok ? Toast.success(res.message) : Toast.error(res.error);
          if (res.ok) nf.reset();
        };
      }
    };

    return `
${Components.nav()}
<div style="padding-top:var(--nav-h);">
<section style="padding:80px 0 40px;">
  <div class="container">
    <div style="text-align:center;margin-bottom:48px;" class="reveal">
      <div class="section-eyebrow">Integrations</div>
      <h1 class="section-title">Connect your <em>entire stack</em></h1>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">With 100+ apps, your team's favourite tools are just a click away.</p>
    </div>

    <!-- Category filter -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:40px;" class="reveal">
      <button class="cat-btn btn btn-ghost active" data-cat="" style="font-size:13px;padding:7px 16px;">All</button>
      ${categories.map(c=>`<button class="cat-btn btn btn-ghost" data-cat="${c}" style="font-size:13px;padding:7px 16px;">${c.charAt(0).toUpperCase()+c.slice(1)}</button>`).join('')}
    </div>

    <!-- Integration cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;" class="reveal">
      ${integrations.map(i=>`
      <div class="int-card card" data-cat="${i.category}" style="text-align:center;padding:24px 16px;cursor:pointer;"
           onclick="Router.go('/integrations/${i.slug}')">
        <div style="width:48px;height:48px;border-radius:12px;background:${i.color}22;border:1px solid ${i.color}44;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:18px;font-weight:600;color:${i.color};">${i.name.charAt(0)}</div>
        <div style="font-size:14px;font-weight:500;color:var(--text-1);">${i.name}</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:4px;text-transform:capitalize;">${i.category}</div>
        ${i.is_featured ? `<div style="margin-top:8px;"><span class="new-badge" style="background:rgba(74,140,110,0.15);color:var(--emerald-light);">Featured</span></div>` : ''}
      </div>`).join('')}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-top:64px;padding:48px;background:var(--surface-2);border:1px solid var(--border-mid);border-radius:var(--radius-xl);" class="reveal">
      <h3 style="font-family:var(--font-serif);font-size:28px;color:var(--text-1);margin-bottom:10px;">Don't see your tool?</h3>
      <p style="color:var(--text-3);font-size:15px;margin-bottom:24px;">We're always adding new integrations. Request yours and we'll prioritize it.</p>
      <a href="/contact" data-link class="btn btn-primary">Request an Integration</a>
    </div>
  </div>
</section>
</div>
${Components.footer()}`;
  },

  // ──────────────────────────────────────────────────────
  //  LOGIN
  // ──────────────────────────────────────────────────────
  login() {
    window.__pageInit = () => {
      const form = document.getElementById('login-form');
      if (!form) return;
      form.onsubmit = async (e) => {
        e.preventDefault();
        clearError(form);
        const btn = form.querySelector('button[type=submit]');
        setLoading(btn, true);
        const res = await api.auth.login(formData(form));
        setLoading(btn, false);
        if (res.ok) {
          Store.setAuth(res.data, res.token);
          Toast.success(`Welcome back, ${res.data.name}!`);
          Router.go('/dashboard');
        } else {
          showError(form, res.error || 'Invalid credentials');
        }
      };
    };

    return `
${Components.nav()}
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:120px 20px;">
  <div style="width:100%;max-width:420px;">
    <div style="text-align:center;margin-bottom:32px;">
      <a href="/" data-link style="display:inline-flex;align-items:center;gap:8px;margin-bottom:24px;">
        <svg width="28" height="28" viewBox="0 0 34 34" fill="none"><rect width="34" height="34" rx="8" fill="rgba(74,140,110,0.12)" stroke="rgba(74,140,110,0.3)" stroke-width="1"/><path d="M9 25L14 17L19 21L24 11" stroke="#4a8c6e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="11" r="2.5" fill="#4a8c6e"/></svg>
        <span style="font-family:var(--font-serif);font-size:18px;color:var(--text-1);">NexusTrack</span>
      </a>
      <h1 style="font-family:var(--font-serif);font-size:30px;color:var(--text-1);font-weight:400;margin-bottom:8px;">Welcome back</h1>
      <p style="font-size:14px;color:var(--text-3);">Sign in to your NexusTrack account</p>
    </div>
    <div class="card" style="padding:32px;">
      <form id="login-form" autocomplete="on">
        <div class="form-error" style="display:none;color:#ef4444;font-size:13px;margin-bottom:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);padding:10px 14px;border-radius:6px;"></div>
        <div class="form-group"><label class="form-label">Email</label><input type="email" name="email" class="form-input" placeholder="you@company.com" required autocomplete="email"/></div>
        <div class="form-group"><label class="form-label">Password</label><input type="password" name="password" class="form-input" placeholder="••••••••" required autocomplete="current-password"/></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:15px;margin-top:8px;">Sign In</button>
      </form>
      <div style="text-align:center;margin-top:20px;font-size:13px;color:var(--text-4);">
        Don't have an account? <a href="/signup" data-link style="color:var(--emerald);">Start free trial</a>
      </div>
    </div>
  </div>
</div>`;
  },

  // ──────────────────────────────────────────────────────
  //  SIGNUP
  // ──────────────────────────────────────────────────────
  signup() {
    window.__pageInit = () => {
      const form = document.getElementById('signup-form');
      if (!form) return;
      form.onsubmit = async (e) => {
        e.preventDefault();
        clearError(form);
        const data = formData(form);
        if (data.password !== data.confirm_password) {
          return showError(form, 'Passwords do not match');
        }
        const btn = form.querySelector('button[type=submit]');
        setLoading(btn, true);
        const res = await api.auth.register({ name: data.name, email: data.email, password: data.password });
        setLoading(btn, false);
        if (res.ok) {
          Store.setAuth(res.data, res.token);
          Toast.success(`Welcome to NexusTrack, ${res.data.name}!`);
          Router.go('/dashboard');
        } else {
          showError(form, res.error || 'Registration failed');
        }
      };
    };

    return `
${Components.nav()}
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:120px 20px;">
  <div style="width:100%;max-width:460px;">
    <div style="text-align:center;margin-bottom:32px;">
      <a href="/" data-link style="display:inline-flex;align-items:center;gap:8px;margin-bottom:24px;">
        <svg width="28" height="28" viewBox="0 0 34 34" fill="none"><rect width="34" height="34" rx="8" fill="rgba(74,140,110,0.12)" stroke="rgba(74,140,110,0.3)" stroke-width="1"/><path d="M9 25L14 17L19 21L24 11" stroke="#4a8c6e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="11" r="2.5" fill="#4a8c6e"/></svg>
        <span style="font-family:var(--font-serif);font-size:18px;color:var(--text-1);">NexusTrack</span>
      </a>
      <h1 style="font-family:var(--font-serif);font-size:30px;color:var(--text-1);font-weight:400;margin-bottom:8px;">Start your free trial</h1>
      <p style="font-size:14px;color:var(--text-3);">14 days free. No credit card required.</p>
    </div>
    <div class="card" style="padding:32px;">
      <form id="signup-form" autocomplete="on">
        <div class="form-error" style="display:none;color:#ef4444;font-size:13px;margin-bottom:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);padding:10px 14px;border-radius:6px;"></div>
        <div class="form-group"><label class="form-label">Full name</label><input type="text" name="name" class="form-input" placeholder="Alex Johnson" required autocomplete="name"/></div>
        <div class="form-group"><label class="form-label">Work email</label><input type="email" name="email" class="form-input" placeholder="alex@company.com" required autocomplete="email"/></div>
        <div class="form-group"><label class="form-label">Password <span style="color:var(--text-4);font-size:12px;">(min 8 characters)</span></label><input type="password" name="password" class="form-input" placeholder="••••••••" required autocomplete="new-password" minlength="8"/></div>
        <div class="form-group"><label class="form-label">Confirm password</label><input type="password" name="confirm_password" class="form-input" placeholder="••••••••" required autocomplete="new-password"/></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:15px;margin-top:8px;">Create Account</button>
        <p style="font-size:12px;color:var(--text-4);text-align:center;margin-top:12px;">By signing up you agree to our <a href="/legal/terms" data-link style="color:var(--emerald);">Terms</a> and <a href="/legal/privacy" data-link style="color:var(--emerald);">Privacy Policy</a></p>
      </form>
      <div style="text-align:center;margin-top:20px;font-size:13px;color:var(--text-4);">
        Already have an account? <a href="/login" data-link style="color:var(--emerald);">Sign in</a>
      </div>
    </div>
  </div>
</div>`;
  },

  // ──────────────────────────────────────────────────────
  //  DASHBOARD
  // ──────────────────────────────────────────────────────
  async dashboard() {
    const user = Store.user;
    const res  = await api.dashboard();
    const d    = res.ok ? res.data : null;

    window.__pageInit = () => {
      initCounters();
      // Logout
      document.getElementById('dash-logout')?.addEventListener('click', async () => {
        await api.auth.logout();
        Store.clearAuth();
        Router.go('/');
        Toast.success('Logged out successfully');
      });
      // Animate chart bars
      document.querySelectorAll('.chart-bar-inner').forEach((bar, i) => {
        setTimeout(() => {
          bar.style.height = bar.dataset.h;
        }, 100 + i * 60);
      });
    };

    const maxRevenue = d ? Math.max(...d.chart.map(c => c.revenue)) : 1;

    return `
<div style="display:flex;min-height:100vh;">
  <!-- Sidebar -->
  <aside style="width:240px;flex-shrink:0;background:var(--surface-1);border-right:1px solid var(--border);padding:24px 0;position:sticky;top:0;height:100vh;overflow-y:auto;">
    <div style="padding:0 20px 24px;border-bottom:1px solid var(--border);">
      <a href="/" data-link style="display:flex;align-items:center;gap:8px;">
        <svg width="26" height="26" viewBox="0 0 34 34" fill="none"><rect width="34" height="34" rx="8" fill="rgba(74,140,110,0.12)" stroke="rgba(74,140,110,0.3)" stroke-width="1"/><path d="M9 25L14 17L19 21L24 11" stroke="#4a8c6e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="11" r="2.5" fill="#4a8c6e"/></svg>
        <span style="font-family:var(--font-serif);font-size:16px;color:var(--text-1);">NexusTrack</span>
      </a>
    </div>
    <nav style="padding:16px 12px;" aria-label="Dashboard navigation">
      ${[
        ['dashboard','Overview','/dashboard'],
        ['ads','Ads Manager','/dashboard/ads'],
        ['attribution','Attribution','/dashboard/attribution'],
        ['analytics','Analytics','/dashboard/analytics'],
        ['integrations','Integrations','/integrations'],
        ['settings','Settings','/dashboard/settings'],
      ].map(([id, label, href]) => `
      <a href="${href}" data-link style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--radius-md);font-size:14px;color:${Router.currentPath === href ? 'var(--text-1)' : 'var(--text-3)'};background:${Router.currentPath === href ? 'var(--surface-3)' : 'transparent'};margin-bottom:2px;transition:all 0.15s;" class="dash-nav-item">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
        ${label}
      </a>`).join('')}
    </nav>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:16px 12px;border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--radius-md);background:var(--surface-3);">
        <div style="width:30px;height:30px;border-radius:50%;background:var(--emerald-dim);border:1px solid var(--emerald);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--emerald-light);flex-shrink:0;">${(user?.name||'U')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user?.name || 'User'}</div>
          <div style="font-size:11px;color:var(--text-4);text-transform:capitalize;">${user?.plan || 'free'} plan</div>
        </div>
        <button id="dash-logout" title="Logout" style="background:none;border:none;color:var(--text-4);cursor:pointer;padding:4px;border-radius:4px;transition:color 0.15s;" onmouseenter="this.style.color='var(--text-2)'" onmouseleave="this.style.color='var(--text-4)'">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2h3v10H9M5 10l-3-3 3-3M2 7h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <main style="flex:1;overflow:auto;background:var(--black);">
    <!-- Top bar -->
    <div style="padding:20px 32px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--surface-1);position:sticky;top:0;z-index:10;">
      <div>
        <h1 style="font-size:18px;font-weight:500;color:var(--text-1);">Dashboard</h1>
        <p style="font-size:13px;color:var(--text-4);">Last 30 days · Updated 2 min ago</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <select class="form-input form-select" style="font-size:13px;padding:7px 12px;width:auto;">
          <option>Last 30 days</option>
          <option>Last 7 days</option>
          <option>Last 90 days</option>
          <option>This year</option>
        </select>
        <a href="/demo" data-link class="btn btn-primary" style="font-size:13px;padding:8px 16px;">Upgrade Plan</a>
      </div>
    </div>

    <div style="padding:32px;">
      ${!d ? `<div style="text-align:center;padding:60px;color:var(--text-4);">Could not load dashboard data.</div>` : `

      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px;">
        ${[
          ['Total Revenue',`$${(d.revenue/1000).toFixed(1)}k`,`↑ ${d.revenue_chg}%`,'var(--emerald)'],
          ['ROAS',`${d.roas}×`,`↑ ${d.roas_chg}%`,'var(--emerald)'],
          ['Conversions',d.conversions.toLocaleString(),`↑ ${d.conv_chg}%`,'var(--emerald)'],
          ['Ad Spend',`$${(d.ad_spend/1000).toFixed(1)}k`,`↓ ${Math.abs(d.spend_chg)}%`,'#ef4444'],
        ].map(([label, val, chg, col]) => `
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;">
          <div style="font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-4);margin-bottom:8px;">${label}</div>
          <div style="font-family:var(--font-serif);font-size:28px;font-weight:400;color:var(--text-1);line-height:1;">${val}</div>
          <div style="font-size:12px;color:${col};margin-top:4px;">${chg} vs last period</div>
        </div>`).join('')}
      </div>

      <!-- Chart + Sources -->
      <div style="display:grid;grid-template-columns:1fr 340px;gap:16px;margin-bottom:28px;">
        <!-- Revenue chart -->
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-size:15px;font-weight:500;color:var(--text-1);">Revenue Over Time</h3>
            <div style="display:flex;gap:12px;font-size:12px;color:var(--text-4);">
              <span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:2px;background:var(--emerald);display:inline-block;border-radius:1px;"></span>Revenue</span>
              <span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:2px;background:var(--gold-dim);display:inline-block;border-radius:1px;border-style:dashed;"></span>Ad Spend</span>
            </div>
          </div>
          <div style="display:flex;align-items:flex-end;gap:6px;height:140px;padding-bottom:24px;position:relative;">
            ${d.chart.map((c, i) => {
              const revH = Math.round((c.revenue / maxRevenue) * 120);
              const spdH = Math.round((c.spend  / maxRevenue) * 120);
              return `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end;">
                <div style="display:flex;gap:2px;align-items:flex-end;width:100%;justify-content:center;">
                  <div class="chart-bar-inner" data-h="${revH}px" style="width:45%;height:4px;background:var(--emerald);border-radius:2px 2px 0 0;transition:height 0.6s cubic-bezier(0.16,1,0.3,1);transition-delay:${i*50}ms;"></div>
                  <div class="chart-bar-inner" data-h="${spdH}px" style="width:45%;height:4px;background:var(--gold-dim);border-radius:2px 2px 0 0;transition:height 0.6s cubic-bezier(0.16,1,0.3,1);transition-delay:${i*50+25}ms;opacity:0.7;"></div>
                </div>
                <div style="font-size:9px;color:var(--text-4);white-space:nowrap;transform:rotate(-45deg);margin-top:4px;">${c.day.replace('Apr ','')}</div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Attribution sources -->
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;">
          <h3 style="font-size:15px;font-weight:500;color:var(--text-1);margin-bottom:20px;">Revenue by Source</h3>
          ${d.sources.map(s => `
          <div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0;"></div>
                <span style="font-size:13px;color:var(--text-2);">${s.name}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:13px;font-weight:500;color:var(--text-1);">$${(s.revenue/1000).toFixed(1)}k</span>
                <span style="font-size:12px;color:var(--text-4);margin-left:6px;">${s.pct}%</span>
              </div>
            </div>
            <div style="height:5px;background:var(--surface-4);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${s.pct}%;background:${s.color};border-radius:3px;transition:width 0.8s var(--ease-out);"></div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <!-- Quick actions -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${[
          ['Connect Integrations','Link your ad accounts and CRM to start tracking.','/integrations'],
          ['Book a Demo','Get a walkthrough from an attribution expert.','/demo'],
          ['View Pricing','Upgrade for unlimited data and AI features.','/pricing'],
        ].map(([title, body, href]) => `
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;">
          <h4 style="font-size:15px;font-weight:500;color:var(--text-1);margin-bottom:8px;">${title}</h4>
          <p style="font-size:13px;color:var(--text-3);margin-bottom:16px;">${body}</p>
          <a href="${href}" data-link class="btn btn-ghost" style="font-size:13px;padding:8px 16px;">${title} →</a>
        </div>`).join('')}
      </div>
      `}
    </div>
  </main>
</div>`;
  },

  // ──────────────────────────────────────────────────────
  //  BLOG
  // ──────────────────────────────────────────────────────
  blog() {
    const posts = [
      { slug:'multi-touch-attribution-guide', title:'The Complete Guide to Multi-Touch Attribution in 2026', category:'Attribution', date:'Apr 10, 2026', read:'8 min', excerpt:'Multi-touch attribution is the practice of assigning credit for a conversion across all touchpoints in the customer journey.' },
      { slug:'server-side-tracking-ios', title:'Why Server-Side Tracking is Essential After iOS 17', category:'Tracking', date:'Apr 5, 2026', read:'6 min', excerpt:'Browser-based tracking has been in decline since iOS 14. Here\'s why server-side is now the only reliable option.' },
      { slug:'facebook-ads-attribution', title:'How to Fix Facebook Ads Attribution in 2026', category:'Meta Ads', date:'Mar 28, 2026', read:'7 min', excerpt:'Facebook\'s native attribution is notoriously unreliable. Here\'s how to get accurate data using Conversion API.' },
      { slug:'roas-vs-mroas', title:'ROAS vs. mROAS: Which Metric Actually Matters?', category:'Analytics', date:'Mar 20, 2026', read:'5 min', excerpt:'Most marketers track ROAS, but marginal ROAS (mROAS) is what actually tells you where to allocate budget.' },
      { slug:'ai-marketing-analytics', title:'How AI is Transforming Marketing Analytics', category:'AI', date:'Mar 15, 2026', read:'9 min', excerpt:'From anomaly detection to natural language queries, AI is making marketing analytics accessible to every team.' },
      { slug:'utm-parameters-guide', title:'The Ultimate UTM Parameters Guide for 2026', category:'Tracking', date:'Mar 8, 2026', read:'6 min', excerpt:'UTM parameters are the foundation of campaign tracking. Here\'s how to set them up for maximum attribution accuracy.' },
    ];

    window.__pageInit = () => initReveal();

    return `
${Components.nav()}
<div style="padding-top:var(--nav-h);">
<section style="padding:80px 0;">
  <div class="container">
    <div style="margin-bottom:56px;" class="reveal">
      <div class="section-eyebrow">Blog</div>
      <h1 class="section-title">Marketing Attribution <em>Insights</em></h1>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;" class="reveal">
      ${posts.map((p, i) => `
      <article class="card" style="cursor:pointer;display:flex;flex-direction:column;" onclick="Router.go('/blog/${p.slug}')">
        <div style="background:var(--surface-3);border-radius:var(--radius-md);aspect-ratio:16/9;margin-bottom:16px;display:flex;align-items:center;justify-content:center;">
          <div style="font-family:var(--font-serif);font-size:32px;color:var(--emerald-dim);">${i+1}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--emerald);">${p.category}</span>
          <span style="color:var(--text-4);">·</span>
          <span style="font-size:12px;color:var(--text-4);">${p.read} read</span>
        </div>
        <h2 style="font-family:var(--font-serif);font-size:20px;font-weight:400;color:var(--text-1);line-height:1.3;margin-bottom:10px;">${p.title}</h2>
        <p style="font-size:13px;color:var(--text-3);line-height:1.6;flex:1;margin-bottom:16px;">${p.excerpt}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:12px;color:var(--text-4);">${p.date}</span>
          <span style="font-size:13px;color:var(--emerald);">Read more →</span>
        </div>
      </article>`).join('')}
    </div>
  </div>
</section>
</div>
${Components.footer()}`;
  },

  // ──────────────────────────────────────────────────────
  //  404
  // ──────────────────────────────────────────────────────
  notFound() {
    return `
${Components.nav()}
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:120px 20px;">
  <div>
    <div style="font-family:var(--font-serif);font-size:120px;font-weight:300;color:var(--surface-4);line-height:1;margin-bottom:16px;">404</div>
    <h1 style="font-family:var(--font-serif);font-size:36px;color:var(--text-1);font-weight:400;margin-bottom:12px;">Page not found</h1>
    <p style="font-size:16px;color:var(--text-3);margin-bottom:32px;">The page you're looking for doesn't exist or has been moved.</p>
    <a href="/" data-link class="btn btn-primary">← Back to home</a>
  </div>
</div>`;
  },

  // ──────────────────────────────────────────────────────
  //  LEGAL (Privacy / Terms)
  // ──────────────────────────────────────────────────────
  legal(type = 'privacy') {
    const titles = { privacy: 'Privacy Policy', terms: 'Terms of Service', cookies: 'Cookie Policy' };
    return `
${Components.nav()}
<div style="padding-top:calc(var(--nav-h)+80px);min-height:100vh;padding-bottom:100px;">
  <div class="container" style="max-width:760px;">
    <h1 style="font-family:var(--font-serif);font-size:40px;color:var(--text-1);font-weight:400;margin-bottom:8px;">${titles[type]}</h1>
    <p style="color:var(--text-4);font-size:14px;margin-bottom:40px;">Last updated: April 12, 2026</p>
    <div style="color:var(--text-2);font-size:15px;line-height:1.8;">
      <p>This ${titles[type]} describes how NexusTrack Inc. ("NexusTrack", "we", "us") collects, uses, and shares information about you when you use our services.</p>
      <h2 style="font-family:var(--font-serif);font-size:24px;color:var(--text-1);font-weight:400;margin:32px 0 12px;">Information We Collect</h2>
      <p>We collect information you provide directly to us, including when you create an account, book a demo, or contact support. This may include your name, email address, company name, and billing information.</p>
      <h2 style="font-family:var(--font-serif);font-size:24px;color:var(--text-1);font-weight:400;margin:32px 0 12px;">How We Use Your Information</h2>
      <p>We use the information we collect to provide, maintain, and improve our services, process transactions, send service notifications, and respond to your comments and questions.</p>
      <h2 style="font-family:var(--font-serif);font-size:24px;color:var(--text-1);font-weight:400;margin:32px 0 12px;">Data Security</h2>
      <p>We take reasonable measures to help protect information about you from loss, theft, misuse, unauthorized access, disclosure, alteration, and destruction. All data is encrypted in transit and at rest.</p>
      <h2 style="font-family:var(--font-serif);font-size:24px;color:var(--text-1);font-weight:400;margin:32px 0 12px;">Contact Us</h2>
      <p>If you have any questions about this policy, please <a href="/contact" data-link style="color:var(--emerald);">contact us</a>.</p>
    </div>
  </div>
</div>
${Components.footer()}`;
  },
};

// ═══════════════════════════════════════════════════════════
//  ROUTE DEFINITIONS
// ═══════════════════════════════════════════════════════════
function initRoutes() {
  Router.register('/',                    Pages.home);
  Router.register('/pricing',             Pages.pricing);
  Router.register('/demo',                Pages.demo);
  Router.register('/contact',             Pages.contact);
  Router.register('/integrations',        Pages.integrations);
  Router.register('/blog',                Pages.blog);
  Router.register('/login',               Pages.login,     { guest: true });
  Router.register('/signup',              Pages.signup,    { guest: true });
  Router.register('/dashboard',           Pages.dashboard, { auth: true });
  Router.register('/legal/privacy',       () => Pages.legal('privacy'));
  Router.register('/legal/terms',         () => Pages.legal('terms'));
  Router.register('/legal/cookies',       () => Pages.legal('cookies'));

  // Pattern routes
  Router.register(/^\/blog\/(.+)$/,       () => Pages.blog());
  Router.register(/^\/integrations\/(.+)$/, () => Pages.integrations());
  Router.register(/^\/features\/(.+)$/,   Pages.home);
  Router.register(/^\/solutions\/(.+)$/,  Pages.home);
  Router.register(/^\/dashboard\/.+$/,    Pages.dashboard, { auth: true });
}

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Init toast system
  Toast.init();

  // Add toast CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes toastIn  { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
    @keyframes toastOut { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(20px); } }
    .spin { display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    details > summary::-webkit-details-marker { display:none; }
    details[open] summary span:last-child { transform:rotate(45deg); }
    details summary span:last-child { display:inline-block; transition:transform 0.2s; }
    .dash-nav-item:hover { background:var(--surface-3) !important; color:var(--text-1) !important; }
    .cat-btn.active { background:var(--emerald-dim) !important; border-color:var(--emerald) !important; color:var(--emerald-light) !important; }
    .adash-tab { cursor:pointer; transition:all 0.15s; }
    .adash-tab.active { background:var(--surface-4); color:var(--text-1); }
    .adash-tab:hover { color:var(--text-2); }
  `;
  document.head.appendChild(style);

  // Try to refresh user session silently
  if (Store.token) {
    const res = await api.auth.me();
    if (res.ok) Store.set('user', res.data);
    else Store.clearAuth();
  }

  // Init routes and router
  initRoutes();
  Router.init();

  // Listen for auth changes
  EventBus.on('auth:change', () => Nav.update());
});


// ═══════════════════════════════════════════════════════════
//  NEW PAGES — NEXUSTRACK UPGRADES
// ═══════════════════════════════════════════════════════════

// ── Shared dashboard layout wrapper ──────────────────────────────────────
function dashLayout(title, subtitle, content, activeRoute = '') {
  const user = Store.user;
  const navItems = [
    ['Overview',       '/dashboard',              'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z'],
    ['Attribution',    '/dashboard/attribution',  'M4 12l2-6 3 4 2-3 3 5'],
    ['Campaigns',      '/dashboard/campaigns',    'M3 13V9M6 13V6M9 13V4M12 13V7'],
    ['Contacts',       '/dashboard/contacts',     'M8 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0M4 19c0-3.3 2.7-6 6-6h4'],
    ['Events',         '/dashboard/events',       'M9 12l2 2 4-4M7.8 2A3 3 0 0 0 5 5v1H3a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a1 1 0 0 0-1-1h-2V5a3 3 0 0 0-2.8-3'],
    ['Alerts',         '/dashboard/alerts',       'M15 17h5l-1.4-1.4A2 2 0 0 1 18 14V9a6 6 0 0 0-5-5.9V2a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 9v5a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 0 1-6 0v-1'],
    ['Sync Status',    '/dashboard/sync',         'M4 4v5h5M20 20v-5h-5M4.1 9A9 9 0 0 1 19.9 15M19.9 9A9 9 0 0 1 4.1 15'],
    ['Integrations',   '/integrations',           'M12 5v14M5 12h14'],
    ['Settings',       '/dashboard/settings',     'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 0 1 0 2.8 2 2 0 0 1-2.8 0l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.1A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.65 1.65 0 0 0 4.7 15a1.65 1.65 0 0 0-1.5-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.1A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1A1.65 1.65 0 0 0 9 4.7a1.65 1.65 0 0 0 1-1.5V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.1A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.5 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.1a1.65 1.65 0 0 0-1.5 1z'],
  ];
  const currentPath = Router.currentPath;

  return `
<div style="display:flex;min-height:100vh;background:var(--black);">
  <aside style="width:224px;flex-shrink:0;background:var(--surface-1);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;" id="dash-sidebar">
    <div style="padding:20px 16px 16px;border-bottom:1px solid var(--border);">
      <a href="/" data-link style="display:flex;align-items:center;gap:8px;">
        <svg width="26" height="26" viewBox="0 0 34 34" fill="none"><rect width="34" height="34" rx="8" fill="rgba(74,140,110,0.12)" stroke="rgba(74,140,110,0.3)" stroke-width="1"/><path d="M9 25L14 17L19 21L24 11" stroke="#4a8c6e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="11" r="2.5" fill="#4a8c6e"/></svg>
        <span style="font-family:var(--font-serif);font-size:16px;color:var(--text-1);letter-spacing:0.02em;">NexusTrack</span>
      </a>
    </div>
    <nav style="padding:10px 8px;flex:1;" aria-label="Dashboard">
      ${navItems.map(([label, href, icon]) => {
        const active = currentPath === href || currentPath.startsWith(href + '/');
        return `<a href="${href}" data-link style="display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:var(--radius-md);font-size:13.5px;color:${active ? 'var(--text-1)' : 'var(--text-3)'};background:${active ? 'var(--surface-3)' : 'transparent'};margin-bottom:1px;transition:all 0.15s;text-decoration:none;font-weight:${active ? '500' : '400'};" class="dash-nav-item">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;"><path d="${icon}" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${label}
          ${href === '/dashboard/alerts' ? '<span style="margin-left:auto;background:var(--emerald-dim);color:var(--emerald-light);font-size:10px;padding:1px 6px;border-radius:8px;">3</span>' : ''}
        </a>`;
      }).join('')}
    </nav>
    <div style="padding:12px 8px;border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:var(--radius-md);background:var(--surface-3);">
        <div style="width:28px;height:28px;border-radius:50%;background:var(--emerald-dim);border:1px solid var(--emerald);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--emerald-light);flex-shrink:0;">${(user?.name||'U')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:500;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user?.name||'User'}</div>
          <div style="font-size:10px;color:var(--text-4);text-transform:capitalize;">${user?.plan||'free'} plan</div>
        </div>
        <button id="dash-logout" title="Logout" style="background:none;border:none;color:var(--text-4);cursor:pointer;padding:4px;border-radius:4px;flex-shrink:0;">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9 2h3v10H9M5 10l-3-3 3-3M2 7h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  </aside>
  <main style="flex:1;overflow:auto;display:flex;flex-direction:column;">
    <div style="padding:18px 28px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--surface-1);position:sticky;top:0;z-index:10;">
      <div>
        <h1 style="font-size:16px;font-weight:500;color:var(--text-1);">${title}</h1>
        <p style="font-size:12px;color:var(--text-4);margin-top:1px;">${subtitle}</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;" id="dash-topbar-actions"></div>
    </div>
    <div style="padding:24px 28px;flex:1;" id="dash-content">
      ${content}
    </div>
  </main>
</div>`;
}

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: ATTRIBUTION MODEL SWITCHER
// ─────────────────────────────────────────────────────────────────────────
Pages.attributionDashboard = async function() {
  const res = await api.get('/attribution?model=linear');
  const d   = res.ok ? res.data : null;

  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });

    // Model switcher
    document.querySelectorAll('.model-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.model-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const model = btn.dataset.model;

        // Show loading
        const chart = document.getElementById('attribution-bars');
        if (chart) chart.style.opacity = '0.4';

        const r = await api.get(`/attribution?model=${model}`);
        if (!r.ok) return;
        const data = r.data;

        // Update description
        const desc = document.getElementById('model-description');
        if (desc) desc.textContent = data.description;

        // Update bars
        const barContainer = document.getElementById('attribution-bars');
        if (barContainer) {
          barContainer.style.opacity = '1';
          barContainer.innerHTML = data.sources.map(s => `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
              <div style="width:110px;font-size:12px;color:var(--text-3);flex-shrink:0;">${s.name}</div>
              <div style="flex:1;height:8px;background:var(--surface-4);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${s.pct}%;background:${s.color};border-radius:4px;transition:width 0.6s var(--ease-out);"></div>
              </div>
              <div style="width:60px;text-align:right;font-size:13px;font-weight:500;color:var(--text-1);">$${(s.revenue/1000).toFixed(1)}k</div>
              <div style="width:36px;text-align:right;font-size:12px;color:var(--text-3);">${s.pct}%</div>
            </div>
          `).join('');
        }

        // Update total
        const tot = document.getElementById('attr-total');
        if (tot) tot.textContent = `$${(data.total_revenue/1000).toFixed(1)}k`;
      });
    });

    // Comparison table — show all models side by side
    document.getElementById('compare-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('compare-btn');
      if (btn.dataset.loaded) return;
      btn.textContent = 'Loading...';
      const r = await api.get('/attribution?model=linear');
      const comparison = r.ok ? r.data.model_comparison : {};
      btn.dataset.loaded = '1';
      const table = document.getElementById('comparison-table');
      if (!table || !r.ok) return;
      const sources = r.data.sources.map(s => s.name);
      const models  = Object.keys(comparison);
      const labels  = {first_touch:'First Touch',last_touch:'Last Touch',linear:'Linear',time_decay:'Time Decay',position:'Position-Based',data_driven:'Data-Driven'};
      table.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text-3);font-weight:500;">Model</th>
                ${sources.map(s=>`<th style="text-align:right;padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text-3);font-weight:500;">${s}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${models.map(m=>`
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text-2);font-weight:500;">${labels[m]||m}</td>
                  ${sources.map(s=>`<td style="text-align:right;padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text-1);">$${((comparison[m][s]||0)/1000).toFixed(1)}k</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      btn.textContent = 'Hide comparison';
      btn.dataset.loaded = '2';
    });
  };

  const models = [
    ['linear','Linear','Equal credit to all'],
    ['first_touch','First Touch','100% to first click'],
    ['last_touch','Last Touch','100% to last click'],
    ['time_decay','Time Decay','More credit near conversion'],
    ['position','Position-Based','40/20/40 split'],
    ['data_driven','Data-Driven','ML-weighted','new-badge'],
  ];

  const content = !d ? `<p style="color:var(--text-3);">Could not load attribution data.</p>` : `
    <!-- Model Tabs -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;">
      ${models.map(([id,label,desc,badge]) => `
      <button class="model-tab btn btn-ghost${id==='linear'?' active':''}" data-model="${id}"
              style="font-size:12px;padding:7px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:1px;height:auto;">
        <span style="font-weight:500;display:flex;align-items:center;gap:6px;">${label}${badge?`<span class="new-badge">AI</span>`:''}</span>
        <span style="font-size:10px;color:var(--text-4);font-weight:400;">${desc}</span>
      </button>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;">
      <!-- Main chart -->
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h3 style="font-size:15px;font-weight:500;color:var(--text-1);">Revenue by Source</h3>
          <span style="font-family:var(--font-serif);font-size:22px;color:var(--text-1);" id="attr-total">$${(d.total_revenue/1000).toFixed(1)}k</span>
        </div>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:20px;" id="model-description">${d.description}</p>
        <div id="attribution-bars">
          ${d.sources.map(s => `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
            <div style="width:110px;font-size:12px;color:var(--text-3);flex-shrink:0;">${s.name}</div>
            <div style="flex:1;height:8px;background:var(--surface-4);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${s.pct}%;background:${s.color};border-radius:4px;transition:width 0.6s var(--ease-out);"></div>
            </div>
            <div style="width:60px;text-align:right;font-size:13px;font-weight:500;color:var(--text-1);">$${(s.revenue/1000).toFixed(1)}k</div>
            <div style="width:36px;text-align:right;font-size:12px;color:var(--text-3);">${s.pct}%</div>
          </div>`).join('')}
        </div>
        <button id="compare-btn" class="btn btn-ghost" style="margin-top:16px;font-size:12px;width:100%;">Compare all models side by side</button>
        <div id="comparison-table" style="margin-top:16px;"></div>
      </div>

      <!-- Info panel -->
      <div style="display:flex;flex-direction:column;gap:16px;">
        ${[
          ['What is this?','Attribution models determine how credit is distributed across the touchpoints that led to a conversion. Different models reveal different truths about your marketing.'],
          ['Which to use?','Use Linear to get started. Switch to Time Decay for high-consideration products. Use Data-Driven once you have 500+ monthly conversions.'],
          ['Pro tip','Compare First Touch vs Last Touch side-by-side — the gap reveals which channels assist vs close your deals.'],
        ].map(([t,b]) => `
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;">
          <div style="font-size:13px;font-weight:500;color:var(--text-1);margin-bottom:6px;">${t}</div>
          <div style="font-size:12px;color:var(--text-3);line-height:1.65;">${b}</div>
        </div>`).join('')}
      </div>
    </div>`;

  return dashLayout('Attribution Modeling','Compare how credit is assigned across your marketing touchpoints', content, '/dashboard/attribution');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: CONTACTS + JOURNEY TIMELINE
// ─────────────────────────────────────────────────────────────────────────
Pages.contacts = async function() {
  const res = await api.get('/contacts');
  const contacts = res.ok ? res.data.contacts : [];

  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });
    // Search
    const searchInput = document.getElementById('contact-search');
    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const q = searchInput.value.trim();
          const r = await api.get(`/contacts?q=${encodeURIComponent(q)}`);
          const list = document.getElementById('contacts-list');
          if (!r.ok || !list) return;
          list.innerHTML = renderContactRows(r.data.contacts);
          attachContactClicks();
        }, 300);
      });
    }
    attachContactClicks();
  };

  function renderContactRows(list) {
    if (!list.length) return `<div style="text-align:center;padding:40px;color:var(--text-4);">No contacts found</div>`;
    return list.map(c => `
      <div class="contact-row" data-id="${c.id}" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 80px;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--surface-3)'" onmouseleave="this.style.background=''">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--emerald-dim);border:1px solid var(--emerald);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--emerald-light);flex-shrink:0;">${(c.name||c.email||'?')[0].toUpperCase()}</div>
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--text-1);">${c.name||'Anonymous'}</div>
            <div style="font-size:11px;color:var(--text-4);">${c.email||c.company||''}</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-3);">${c.first_source||'—'} → ${c.last_source||'—'}</div>
        <div style="font-size:13px;color:var(--text-1);font-weight:500;">${c.converted?`$${c.revenue.toLocaleString()}`:'—'}</div>
        <div>
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="height:5px;width:50px;background:var(--surface-4);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${c.match_score}%;background:${c.match_score>=90?'var(--emerald)':c.match_score>=70?'var(--gold-dim)':'#ef4444'};border-radius:3px;"></div>
            </div>
            <span style="font-size:11px;color:var(--text-3);">${c.match_score}%</span>
          </div>
        </div>
        <div><span style="font-size:11px;padding:3px 8px;border-radius:4px;background:${c.converted?'var(--emerald-dim)':'var(--surface-4)'};color:${c.converted?'var(--emerald-light)':'var(--text-4)'};">${c.converted?'Converted':'Lead'}</span></div>
      </div>`).join('');
  }

  function attachContactClicks() {
    document.querySelectorAll('.contact-row').forEach(row => {
      row.addEventListener('click', () => Router.go(`/dashboard/contacts/${row.dataset.id}`));
    });
  }

  const content = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="display:flex;gap:10px;align-items:center;">
        <input id="contact-search" type="text" class="form-input" placeholder="Search contacts..." style="width:260px;font-size:13px;padding:8px 12px;"/>
      </div>
      <div style="font-size:13px;color:var(--text-4);">${res.ok ? res.data.total : 0} contacts</div>
    </div>
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 80px;gap:12px;padding:10px 16px;background:var(--surface-3);border-bottom:1px solid var(--border);">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-4);">Contact</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-4);">Journey</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-4);">Revenue</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-4);">Match Score</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-4);">Status</div>
      </div>
      <div id="contacts-list">${renderContactRows(contacts)}</div>
    </div>`;

  return dashLayout('Contacts','Track individual visitor journeys and conversion paths', content, '/dashboard/contacts');
};

Pages.contactDetail = async function(match) {
  const id = match?.$0 || location.pathname.split('/').pop();
  const res = await api.get(`/contacts/${id}`);
  if (!res.ok) return dashLayout('Contact Not Found','', `<p style="color:var(--text-3);">Contact not found.</p>`);

  const { contact: c, touchpoints } = res.data;
  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });
  };

  const channelColors = {'Meta Ads':'#3b82f6','Google Ads':'#ef4444','Organic':'#4a8c6e','Email':'#c9a96e','TikTok Ads':'#6366f1','Direct':'#888','LinkedIn':'#0ea5e9'};

  const content = `
    <div style="display:grid;grid-template-columns:280px 1fr;gap:20px;">
      <!-- Profile card -->
      <div>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:16px;">
          <div style="width:52px;height:52px;border-radius:50%;background:var(--emerald-dim);border:2px solid var(--emerald);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;color:var(--emerald-light);margin:0 auto 14px;">${(c.name||c.email||'?')[0].toUpperCase()}</div>
          <div style="text-align:center;margin-bottom:16px;">
            <div style="font-size:15px;font-weight:500;color:var(--text-1);">${c.name||'Anonymous'}</div>
            <div style="font-size:12px;color:var(--text-4);margin-top:2px;">${c.email||''}</div>
            <div style="font-size:11px;color:var(--text-4);">${c.company||''}</div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:14px;">
            ${[
              ['First Source', c.first_source||'—'],
              ['Last Source', c.last_source||'—'],
              ['Total Touches', c.total_touches],
              ['Revenue', c.converted?`$${c.revenue.toLocaleString()}`:'—'],
              ['Status', c.converted?'Converted':'Lead'],
            ].map(([k,v]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:11px;color:var(--text-4);">${k}</span>
              <span style="font-size:12px;color:var(--text-1);font-weight:500;">${v}</span>
            </div>`).join('')}
          </div>
        </div>
        <!-- Match Score Ring -->
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;text-align:center;">
          <div style="font-size:11px;color:var(--text-4);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.1em;">Match Score</div>
          <div style="position:relative;width:80px;height:80px;margin:0 auto 10px;">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface-4)" stroke-width="6"/>
              <circle cx="40" cy="40" r="34" fill="none" stroke="${c.match_score>=90?'#4a8c6e':c.match_score>=70?'#c9a96e':'#ef4444'}" stroke-width="6"
                stroke-dasharray="${Math.round(2*3.14159*34*c.match_score/100)} ${Math.round(2*3.14159*34)}"
                stroke-dashoffset="${Math.round(2*3.14159*34*0.25)}"
                stroke-linecap="round"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-serif);font-size:20px;color:var(--text-1);">${c.match_score}%</div>
          </div>
          <div style="font-size:11px;color:var(--text-3);">Identity confidence score</div>
        </div>
      </div>

      <!-- Journey timeline -->
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;">
        <h3 style="font-size:15px;font-weight:500;color:var(--text-1);margin-bottom:20px;">Customer Journey Timeline</h3>
        <div style="position:relative;padding-left:24px;">
          <div style="position:absolute;left:8px;top:0;bottom:0;width:1px;background:var(--border);"></div>
          ${touchpoints.map((tp, i) => `
          <div style="position:relative;margin-bottom:24px;${i===touchpoints.length-1?'margin-bottom:0;':''}">
            <div style="position:absolute;left:-20px;width:12px;height:12px;border-radius:50%;background:${channelColors[tp.channel]||'var(--text-4)'};border:2px solid var(--surface-2);top:3px;"></div>
            <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:12px;font-weight:600;color:${channelColors[tp.channel]||'var(--text-2)'};">${tp.channel}</span>
                <span style="font-size:11px;color:var(--text-4);">${tp.occurred_at}</span>
              </div>
              <div style="font-size:12px;color:var(--text-2);margin-bottom:4px;text-transform:capitalize;">${tp.event_type.replace('_',' ')}</div>
              ${tp.campaign?`<div style="font-size:11px;color:var(--text-4);">Campaign: ${tp.campaign}</div>`:''}
              ${tp.page_url?`<div style="font-size:11px;color:var(--text-4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tp.page_url}</div>`:''}
              ${tp.revenue>0?`<div style="font-size:13px;font-weight:600;color:var(--emerald);margin-top:6px;">💰 $${tp.revenue.toLocaleString()}</div>`:''}
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>`;

  return dashLayout(`${c.name||'Anonymous Contact'}`, `${c.email||''} · ${c.total_touches} touchpoints`, content, '/dashboard/contacts');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: CAMPAIGNS + CREATIVE ANALYTICS
// ─────────────────────────────────────────────────────────────────────────
Pages.campaigns = async function() {
  const res = await api.get('/campaigns');
  const { campaigns = [], totals = {} } = res.ok ? res.data : {};

  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });
    // Platform filter
    document.querySelectorAll('.platform-filter').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.platform-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const plat = btn.dataset.platform;
        const url = plat ? `/campaigns?platform=${encodeURIComponent(plat)}` : '/campaigns';
        const r = await api.get(url);
        const list = document.getElementById('campaigns-grid');
        if (!r.ok || !list) return;
        list.innerHTML = renderCampaignCards(r.data.campaigns);
      });
    });
  };

  function renderCampaignCards(list) {
    if (!list.length) return `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-4);">No campaigns found</div>`;
    return list.map(c => {
      const profitColor = c.revenue - c.spend > 0 ? 'var(--emerald)' : '#ef4444';
      const statusColor = {active:'var(--emerald)',paused:'var(--gold-dim)',ended:'var(--text-4)'}[c.status]||'var(--text-4)';
      const platformColor = {'Meta Ads':'#3b82f6','Google Ads':'#ef4444','TikTok Ads':'#6366f1','LinkedIn Ads':'#0ea5e9'}[c.platform]||'var(--text-3)';
      return `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;transition:all 0.2s;" onmouseenter="this.style.borderColor='rgba(74,140,110,0.3)';this.style.transform='translateY(-2px)'" onmouseleave="this.style.borderColor='';this.style.transform=''">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
          <div>
            <span style="font-size:10px;font-weight:600;letter-spacing:0.08em;color:${platformColor};background:${platformColor}22;padding:2px 7px;border-radius:3px;text-transform:uppercase;">${c.platform}</span>
            <span style="margin-left:6px;font-size:10px;color:${statusColor};background:${statusColor}22;padding:2px 7px;border-radius:3px;text-transform:capitalize;">${c.status}</span>
          </div>
          <span style="font-size:10px;color:var(--text-4);background:var(--surface-3);padding:2px 7px;border-radius:3px;text-transform:capitalize;">${c.creative_type||'image'}</span>
        </div>
        <div style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:4px;line-height:1.3;">${c.name}</div>
        ${c.headline?`<div style="font-size:11px;color:var(--text-4);font-style:italic;margin-bottom:14px;">"${c.headline}"</div>`:'<div style="margin-bottom:14px;"></div>'}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding-top:12px;border-top:1px solid var(--border);">
          ${[['Revenue',`$${(c.revenue/1000).toFixed(1)}k`,'var(--text-1)'],['ROAS',`${c.roas}×`,c.roas>=4?'var(--emerald)':c.roas>=2?'var(--gold)':'#ef4444'],['CPA',`$${c.cpa.toFixed(0)}`,c.cpa<50?'var(--emerald)':'var(--text-1)'],['Spend',`$${(c.spend/1000).toFixed(1)}k`,'var(--text-2)'],['Conv.',c.conversions,'var(--text-2)'],['CTR',`${c.ctr}%`,'var(--text-2)']].map(([k,v,col])=>`
          <div><div style="font-size:10px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">${k}</div><div style="font-size:14px;font-weight:500;color:${col};">${v}</div></div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  const platforms = [...new Set(campaigns.map(c=>c.platform))];
  const content = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
      ${[['Total Revenue',`$${((totals.revenue||0)/1000).toFixed(1)}k`,''],['Total Spend',`$${((totals.spend||0)/1000).toFixed(1)}k`,''],['Blended ROAS',`${totals.roas||0}×`,'var(--emerald)'],['Conversions',(totals.conversions||0).toLocaleString(),'']].map(([l,v,c])=>`
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-4);margin-bottom:6px;">${l}</div>
        <div style="font-family:var(--font-serif);font-size:24px;color:${c||'var(--text-1)'};">${v}</div>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="platform-filter btn btn-ghost active" data-platform="" style="font-size:12px;padding:6px 14px;">All</button>
      ${platforms.map(p=>`<button class="platform-filter btn btn-ghost" data-platform="${p}" style="font-size:12px;padding:6px 14px;">${p}</button>`).join('')}
    </div>
    <div id="campaigns-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">
      ${renderCampaignCards(campaigns)}
    </div>`;

  return dashLayout('Campaign Manager','Track creative performance and ROAS across all ad platforms', content, '/dashboard/campaigns');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: EVENTS MANAGER
// ─────────────────────────────────────────────────────────────────────────
Pages.eventsManager = async function() {
  const res = await api.get('/events');
  const events = res.ok ? res.data : [];

  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });
    // Create event form
    document.getElementById('create-event-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      setLoading(btn, true);
      const data = formData(e.target);
      const r = await api.post('/events', data);
      setLoading(btn, false);
      if (r.ok) { Toast.success('Event created!'); Router.go('/dashboard/events'); }
      else showError(e.target, r.error);
    });
    // Delete / toggle events
    document.querySelectorAll('.evt-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this event?')) return;
        const id = btn.dataset.id;
        const r = await api.delete(`/events/${id}`);
        if (r.ok) { Toast.success('Deleted'); Router.go('/dashboard/events'); }
        else Toast.error(r.error);
      });
    });
    document.querySelectorAll('.evt-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const r = await api.patch(`/events/${id}`, { is_active: btn.dataset.active === '1' ? 0 : 1 });
        if (r.ok) Router.go('/dashboard/events');
        else Toast.error(r.error);
      });
    });
  };

  const typeColors = {conversion:'var(--emerald)',lead:'#3b82f6',engagement:'var(--gold-dim)',pageview:'var(--text-4)',custom:'#6366f1'};

  const content = `
    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;">
      <div>
        <h3 style="font-size:15px;font-weight:500;color:var(--text-1);margin-bottom:16px;">Your Events <span style="font-size:12px;color:var(--text-4);font-weight:400;">(${events.length})</span></h3>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">
          ${!events.length ? `<div style="text-align:center;padding:40px;color:var(--text-4);">No events yet. Create your first one →</div>` :
          events.map(e => `
          <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);">
            <div style="width:8px;height:8px;border-radius:50%;background:${typeColors[e.event_type]||'var(--text-4)'};flex-shrink:0;"></div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:500;color:${e.is_active?'var(--text-1)':'var(--text-4)'};">${e.name}</div>
              <div style="font-size:11px;color:var(--text-4);margin-top:1px;text-transform:capitalize;">${e.event_type} · Fired ${e.fire_count.toLocaleString()} times${e.last_fired?' · Last: '+e.last_fired:''}</div>
            </div>
            ${e.value>0?`<div style="font-size:13px;color:var(--emerald);">$${e.value}</div>`:''}
            <div style="display:flex;gap:6px;">
              <button class="evt-toggle btn btn-ghost" data-id="${e.id}" data-active="${e.is_active}" style="font-size:11px;padding:4px 10px;">${e.is_active?'Pause':'Enable'}</button>
              <button class="evt-delete btn btn-ghost" data-id="${e.id}" style="font-size:11px;padding:4px 10px;color:#ef4444;border-color:rgba(239,68,68,0.2);">Delete</button>
            </div>
          </div>`).join('')}
        </div>
      </div>
      <!-- Create event -->
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:22px;align-self:start;">
        <h3 style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:16px;">Create New Event</h3>
        <form id="create-event-form">
          <div class="form-error" style="display:none;color:#ef4444;font-size:12px;margin-bottom:12px;"></div>
          <div class="form-group"><label class="form-label">Event Name *</label><input type="text" name="name" class="form-input" placeholder="e.g. Purchase, Trial Signup" required/></div>
          <div class="form-group">
            <label class="form-label">Event Type *</label>
            <select name="event_type" class="form-input form-select">
              <option value="conversion">Conversion</option>
              <option value="lead">Lead</option>
              <option value="engagement">Engagement</option>
              <option value="pageview">Page View</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Revenue Value <span style="color:var(--text-4);font-size:11px;">(optional)</span></label><input type="number" name="value" class="form-input" placeholder="0.00" min="0" step="0.01"/></div>
          <div class="form-group"><label class="form-label">Description</label><textarea name="description" class="form-input" rows="2" placeholder="What does this event track?"></textarea></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Create Event</button>
        </form>
      </div>
    </div>`;

  return dashLayout('Events Manager','Define and monitor your conversion events', content, '/dashboard/events');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: SMART ALERTS
// ─────────────────────────────────────────────────────────────────────────
Pages.alerts = async function() {
  const res = await api.get('/alerts');
  const { alerts = [], logs = [] } = res.ok ? res.data : {};

  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });
    document.getElementById('create-alert-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      setLoading(btn, true);
      const r = await api.post('/alerts', formData(e.target));
      setLoading(btn, false);
      if (r.ok) { Toast.success('Alert created!'); Router.go('/dashboard/alerts'); }
      else showError(e.target, r.error);
    });
    document.querySelectorAll('.alert-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await api.delete(`/alerts/${btn.dataset.id}`);
        if (r.ok) { Toast.success('Alert deleted'); Router.go('/dashboard/alerts'); }
      });
    });
    document.querySelectorAll('.alert-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await api.post(`/alerts/${btn.dataset.id}/toggle`);
        if (r.ok) Router.go('/dashboard/alerts');
      });
    });
  };

  const metricLabels = {roas:'ROAS',spend:'Daily Spend',conversions:'Conversions',revenue:'Revenue',cpa:'CPA',ctr:'CTR'};
  const content = `
    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;">
      <div>
        <h3 style="font-size:15px;font-weight:500;color:var(--text-1);margin-bottom:16px;">Active Alerts <span style="font-size:12px;color:var(--text-4);font-weight:400;">(${alerts.length})</span></h3>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:20px;">
          ${!alerts.length ? `<div style="text-align:center;padding:40px;color:var(--text-4);">No alerts yet. Create one to get notified automatically.</div>` :
          alerts.map(a => `
          <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);">
            <div style="width:10px;height:10px;border-radius:50%;background:${a.is_active?'var(--emerald)':'var(--text-4)'};flex-shrink:0;${a.is_active?'box-shadow:0 0 6px var(--emerald-glow);':''}" class="${a.is_active?'pulse-dot':''}"></div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:500;color:var(--text-1);">${a.name}</div>
              <div style="font-size:11px;color:var(--text-3);">${metricLabels[a.metric]||a.metric} ${a.operator} ${a.threshold} · via ${a.channel}</div>
            </div>
            <span style="font-size:11px;color:var(--text-4);">Fired ${a.fire_count}×</span>
            <div style="display:flex;gap:6px;">
              <button class="alert-toggle btn btn-ghost" data-id="${a.id}" style="font-size:11px;padding:4px 10px;">${a.is_active?'Pause':'Enable'}</button>
              <button class="alert-delete btn btn-ghost" data-id="${a.id}" style="font-size:11px;padding:4px 10px;color:#ef4444;border-color:rgba(239,68,68,0.2);">Delete</button>
            </div>
          </div>`).join('')}
        </div>
        ${logs.length ? `
        <h3 style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:12px;">Recent Triggers</h3>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">
          ${logs.map(l=>`<div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-3);">Alert #${l.alert_id}: ${l.metric} was ${l.value} (threshold: ${l.threshold}) · ${l.fired_at}</div>`).join('')}
        </div>` : ''}
      </div>
      <!-- Create alert -->
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:22px;align-self:start;">
        <h3 style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:16px;">Create Alert</h3>
        <form id="create-alert-form">
          <div class="form-error" style="display:none;color:#ef4444;font-size:12px;margin-bottom:12px;"></div>
          <div class="form-group"><label class="form-label">Alert Name *</label><input type="text" name="name" class="form-input" placeholder="e.g. ROAS Drop Alert" required/></div>
          <div class="form-group">
            <label class="form-label">Metric *</label>
            <select name="metric" class="form-input form-select">
              ${Object.entries(metricLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Condition *</label>
            <select name="operator" class="form-input form-select">
              <option value="below">Falls Below</option>
              <option value="above">Rises Above</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Threshold *</label><input type="number" name="threshold" class="form-input" placeholder="e.g. 3.0" required step="0.01"/></div>
          <div class="form-group">
            <label class="form-label">Notify via</label>
            <select name="channel" class="form-input form-select">
              <option value="email">Email</option>
              <option value="slack">Slack Webhook</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Create Alert</button>
        </form>
      </div>
    </div>`;

  return dashLayout('Smart Alerts','Get notified when your key metrics cross your thresholds', content, '/dashboard/alerts');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: CONVERSION SYNC STATUS
// ─────────────────────────────────────────────────────────────────────────
Pages.syncStatus = async function() {
  const res = await api.get('/sync/status');
  const d = res.ok ? res.data : null;

  window.__pageInit = () => {
    document.getElementById('dash-logout')?.addEventListener('click', async () => {
      await api.auth.logout(); Store.clearAuth(); Router.go('/'); Toast.success('Logged out');
    });
    // Live refresh every 15s
    const interval = setInterval(async () => {
      const r = await api.get('/sync/status');
      if (!r.ok) return;
      const list = document.getElementById('live-events');
      if (!list) { clearInterval(interval); return; }
      list.innerHTML = renderEventFeed(r.data.recent_events);
    }, 15000);
  };

  function renderEventFeed(evts) {
    return evts.map(e => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);">
        <div style="width:7px;height:7px;border-radius:50%;background:${e.matched?'var(--emerald)':'#ef4444'};flex-shrink:0;"></div>
        <div style="flex:1;">
          <span style="font-size:12px;font-weight:500;color:var(--text-1);">${e.type}</span>
          <span style="font-size:11px;color:var(--text-4);margin-left:8px;">${e.source}</span>
        </div>
        ${e.value>0?`<span style="font-size:12px;color:var(--emerald);">$${e.value}</span>`:''}
        <span style="font-size:11px;color:${e.matched?'var(--emerald)':'#ef4444'};background:${e.matched?'var(--emerald-glow)':'rgba(239,68,68,0.1)'};padding:2px 7px;border-radius:4px;">${e.matched?'Matched':'Unmatched'}</span>
        <span style="font-size:10px;color:var(--text-4);">${e.time}</span>
      </div>`).join('');
  }

  const content = !d ? `<p style="color:var(--text-3);">Could not load sync data.</p>` : `
    <!-- Overall score + KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;text-align:center;">
        <div style="position:relative;width:64px;height:64px;margin:0 auto 8px;">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="27" fill="none" stroke="var(--surface-4)" stroke-width="5"/>
            <circle cx="32" cy="32" r="27" fill="none" stroke="var(--emerald)" stroke-width="5"
              stroke-dasharray="${Math.round(2*3.14159*27*d.overall_match_score/100)} ${Math.round(2*3.14159*27)}"
              stroke-dashoffset="${Math.round(2*3.14159*27*0.25)}" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--text-1);">${d.overall_match_score}%</div>
        </div>
        <div style="font-size:11px;color:var(--text-4);">Overall Match Score</div>
      </div>
      ${[['Events / 24h',d.events_last_24h.toLocaleString()],['Match Rate',`${d.match_rate}%`],['Platforms',d.platforms.length]].map(([l,v])=>`
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-4);margin-bottom:6px;">${l}</div>
        <div style="font-family:var(--font-serif);font-size:26px;color:var(--text-1);">${v}</div>
      </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;">
      <!-- Platform cards -->
      <div>
        <h3 style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:12px;">Platform Status</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${d.platforms.map(p => `
          <div style="background:var(--surface-2);border:1px solid ${p.status==='warning'?'rgba(201,169,110,0.4)':'var(--border)'};border-radius:var(--radius-lg);padding:18px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:9px;height:9px;border-radius:50%;background:${p.status==='syncing'?'var(--emerald)':'var(--gold)'};${p.status==='syncing'?'animation:pulse-dot 2s ease-in-out infinite;':''}"></div>
                <span style="font-size:14px;font-weight:500;color:var(--text-1);">${p.name}</span>
              </div>
              <span style="font-size:11px;padding:3px 8px;border-radius:4px;background:${p.status==='syncing'?'var(--emerald-glow)':'rgba(201,169,110,0.1)'};color:${p.status==='syncing'?'var(--emerald-light)':'var(--gold)'};">${p.status==='syncing'?'● Syncing':'⚠ Warning'}</span>
            </div>
            ${p.warning?`<div style="font-size:11px;color:var(--gold);background:rgba(201,169,110,0.08);border:1px solid rgba(201,169,110,0.2);border-radius:5px;padding:8px 10px;margin-bottom:10px;">${p.warning}</div>`:''}
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
              ${[['Match Score',`${p.match_score}%`],['Events Sent',p.events_sent],['Matched',p.events_matched],['Latency',`${p.latency_ms}ms`]].map(([k,v])=>`
              <div><div style="font-size:10px;color:var(--text-4);margin-bottom:2px;">${k}</div><div style="font-size:13px;font-weight:500;color:var(--text-1);">${v}</div></div>`).join('')}
            </div>
            <div style="margin-top:10px;height:5px;background:var(--surface-4);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${p.match_score}%;background:${p.match_score>=90?'var(--emerald)':p.match_score>=75?'var(--gold)':'#ef4444'};border-radius:3px;"></div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <!-- Live event feed -->
      <div>
        <h3 style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:12px;">Live Event Feed <span style="font-size:11px;color:var(--emerald);background:var(--emerald-glow);padding:2px 8px;border-radius:8px;margin-left:6px;">● Live</span></h3>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;" id="live-events">
          ${renderEventFeed(d.recent_events)}
        </div>
        <div style="text-align:center;font-size:11px;color:var(--text-4);margin-top:8px;">Refreshes every 15 seconds</div>
      </div>
    </div>`;

  return dashLayout('Conversion Sync','Real-time server-side event tracking and platform sync status', content, '/dashboard/sync');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: UTM BUILDER
// ─────────────────────────────────────────────────────────────────────────
Pages.utmBuilder = async function() {
  const tmplRes = await api.get('/utm/templates');
  const templates = tmplRes.ok ? tmplRes.data : [];

  window.__pageInit = () => {
    const form   = document.getElementById('utm-form');
    const output = document.getElementById('utm-output');
    const urlBox = document.getElementById('utm-url-display');
    const tipBox = document.getElementById('utm-tips');

    async function rebuild() {
      if (!form) return;
      const data = formData(form);
      if (!data.url || !data.source || !data.medium || !data.campaign) {
        if (urlBox) urlBox.textContent = 'Fill in the required fields to generate your URL';
        return;
      }
      const r = await api.post('/utm/build', data);
      if (!r.ok) { if (urlBox) urlBox.textContent = r.error; return; }
      if (urlBox) urlBox.textContent = r.data.url;
      if (tipBox && r.data.tips.length) {
        tipBox.innerHTML = r.data.tips.map(t=>`<div style="font-size:11px;color:var(--gold);margin-top:4px;">⚡ ${t}</div>`).join('');
      } else if (tipBox) tipBox.innerHTML = '';
    }

    form?.querySelectorAll('input,select').forEach(el => el.addEventListener('input', rebuild));

    // Copy button
    document.getElementById('copy-utm')?.addEventListener('click', () => {
      const url = urlBox?.textContent;
      if (!url || url.startsWith('Fill')) return;
      navigator.clipboard.writeText(url).then(() => Toast.success('URL copied to clipboard!'));
    });

    // Template buttons
    document.querySelectorAll('.tpl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = templates[parseInt(btn.dataset.idx)];
        if (!tpl || !form) return;
        const now = new Date();
        const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
        ['source','medium','campaign','content'].forEach(k => {
          const el = form.querySelector(`[name="${k}"]`);
          if (el && tpl[k]) el.value = tpl[k].replace('{{date}}', date);
        });
        rebuild();
        Toast.info('Template applied!');
      });
    });
  };

  const content = `
    <div style="display:grid;grid-template-columns:1fr 280px;gap:20px;">
      <div>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:16px;">
          <form id="utm-form">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div class="form-group" style="grid-column:1/-1"><label class="form-label">Destination URL *</label><input type="url" name="url" class="form-input" placeholder="https://nexustrack.io/landing" required/></div>
              <div class="form-group"><label class="form-label">Campaign Source * <span style="color:var(--text-4);font-size:10px;">utm_source</span></label><input type="text" name="source" class="form-input" placeholder="facebook, google, email"/></div>
              <div class="form-group"><label class="form-label">Campaign Medium * <span style="color:var(--text-4);font-size:10px;">utm_medium</span></label><input type="text" name="medium" class="form-input" placeholder="cpc, email, social"/></div>
              <div class="form-group" style="grid-column:1/-1"><label class="form-label">Campaign Name * <span style="color:var(--text-4);font-size:10px;">utm_campaign</span></label><input type="text" name="campaign" class="form-input" placeholder="spring_sale_2026"/></div>
              <div class="form-group"><label class="form-label">Term <span style="color:var(--text-4);font-size:10px;">utm_term (optional)</span></label><input type="text" name="term" class="form-input" placeholder="attribution software"/></div>
              <div class="form-group"><label class="form-label">Content <span style="color:var(--text-4);font-size:10px;">utm_content (optional)</span></label><input type="text" name="content" class="form-input" placeholder="video_v1, hero_cta"/></div>
            </div>
          </form>
        </div>

        <!-- Generated URL -->
        <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-size:12px;font-weight:500;color:var(--text-2);">Generated URL</span>
            <button id="copy-utm" class="btn btn-primary" style="font-size:12px;padding:6px 14px;">Copy URL</button>
          </div>
          <div id="utm-url-display" style="font-size:12px;font-family:var(--font-mono);color:var(--emerald-light);word-break:break-all;line-height:1.6;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;">Fill in the required fields to generate your URL</div>
          <div id="utm-tips"></div>
        </div>
      </div>

      <!-- Templates -->
      <div>
        <h3 style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:12px;">Quick Templates</h3>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${templates.map((t,i) => `
          <button class="tpl-btn" data-idx="${i}" style="text-align:left;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer;transition:all 0.15s;" onmouseenter="this.style.borderColor='rgba(74,140,110,0.3)'" onmouseleave="this.style.borderColor=''">
            <div style="font-size:12px;font-weight:500;color:var(--text-1);">${t.name}</div>
            <div style="font-size:10px;color:var(--text-4);margin-top:2px;">${t.source} / ${t.medium}</div>
          </button>`).join('')}
        </div>

        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-top:16px;">
          <div style="font-size:12px;font-weight:500;color:var(--text-1);margin-bottom:8px;">UTM Best Practices</div>
          ${['Always use lowercase — "Facebook" ≠ "facebook"','Use underscores not spaces in values','Be consistent with source names across campaigns','Include date in campaign name for easy filtering','Use utm_content to A/B test creatives'].map(tip=>`<div style="font-size:11px;color:var(--text-3);margin-bottom:5px;padding-left:10px;border-left:2px solid var(--emerald-dim);">${tip}</div>`).join('')}
        </div>
      </div>
    </div>`;

  return dashLayout('UTM Builder','Generate perfectly structured tracking URLs for every campaign', content, '/dashboard/utm');
};

// ─────────────────────────────────────────────────────────────────────────
//  PAGE: ROI CALCULATOR (public)
// ─────────────────────────────────────────────────────────────────────────
Pages.roiCalculator = function() {
  window.__pageInit = () => {
    const form    = document.getElementById('roi-form');
    const results = document.getElementById('roi-results');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      setLoading(btn, true);
      const data = formData(form);
      data.monthly_spend = parseFloat(data.monthly_spend);
      data.current_roas  = parseFloat(data.current_roas);
      data.channels      = parseInt(data.channels);
      const r = await api.post('/roi/calculate', data);
      setLoading(btn, false);

      if (!r.ok) { Toast.error(r.error); return; }
      const d = r.data.results;
      const fmt = n => n.toLocaleString('en-US', {maximumFractionDigits:0});

      if (results) {
        results.style.display = 'block';
        results.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px;">
            ${[
              ['Annual Revenue Gain',`$${fmt(d.annual_gain)}`,'var(--emerald)'],
              ['New ROAS',`${d.new_roas}×`,'var(--text-1)'],
              ['ROI on NexusTrack',`${fmt(d.roi_on_tool)}×`,'var(--gold)'],
            ].map(([l,v,c]) => `
            <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;text-align:center;">
              <div style="font-family:var(--font-serif);font-size:32px;color:${c};margin-bottom:6px;">${v}</div>
              <div style="font-size:12px;color:var(--text-3);">${l}</div>
            </div>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;">
              <div style="font-size:13px;font-weight:500;color:var(--text-1);margin-bottom:12px;">Monthly Breakdown</div>
              ${[
                ['Current Revenue',`$${fmt(d.current_revenue)}`,'var(--text-2)'],
                ['Projected Revenue',`$${fmt(d.new_revenue)}`,'var(--emerald)'],
                ['Monthly Gain',`+$${fmt(d.monthly_revenue_gain)}`,'var(--emerald)'],
                ['Wasted Spend Saved',`$${fmt(d.wasted_spend_saved)}`,'var(--gold)'],
                ['Hours Saved / Mo',`${d.time_saved_monthly} hrs`,'var(--text-2)'],
              ].map(([k,v,c]) => `
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
                <span style="font-size:12px;color:var(--text-3);">${k}</span>
                <span style="font-size:13px;font-weight:500;color:${c};">${v}</span>
              </div>`).join('')}
            </div>
            <div style="background:var(--surface-3);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;">
              <div style="font-size:13px;font-weight:500;color:var(--text-1);margin-bottom:12px;">Where the Gains Come From</div>
              ${[
                ['Better Attribution','Better budget allocation',r.data.breakdown.better_attribution],
                ['Waste Elimination','Stop funding losing channels',r.data.breakdown.waste_elimination],
                ['Improved Targeting','Higher CAPI match rates',r.data.breakdown.improved_targeting],
              ].map(([k,sub,v]) => `
              <div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                  <div><div style="font-size:12px;font-weight:500;color:var(--text-1);">${k}</div><div style="font-size:10px;color:var(--text-4);">${sub}</div></div>
                  <span style="font-size:13px;font-weight:500;color:var(--emerald);">$${fmt(v)}/mo</span>
                </div>
                <div style="height:5px;background:var(--surface-4);border-radius:3px;"><div style="height:100%;width:${Math.round(v/(d.monthly_revenue_gain+d.wasted_spend_saved)*100)}%;background:var(--emerald);border-radius:3px;"></div></div>
              </div>`).join('')}
            </div>
          </div>
          <div style="text-align:center;margin-top:20px;">
            <p style="font-size:14px;color:var(--text-2);margin-bottom:16px;">Ready to capture <strong style="color:var(--text-1);">$${fmt(d.annual_gain)}</strong> in additional annual value?</p>
            <a href="/signup" data-link class="btn btn-primary" style="font-size:15px;padding:13px 32px;margin-right:10px;">Start Free Trial</a>
            <a href="/demo" data-link class="btn btn-ghost" style="font-size:15px;padding:13px 32px;">Book a Demo</a>
          </div>`;
      }
    });

    // Live ROAS update
    ['monthly_spend','current_roas'].forEach(name => {
      document.querySelector(`[name="${name}"]`)?.addEventListener('input', () => {
        const spend = parseFloat(document.querySelector('[name=monthly_spend]')?.value || 0);
        const roas  = parseFloat(document.querySelector('[name=current_roas]')?.value || 0);
        const el    = document.getElementById('current-rev-preview');
        if (el && spend > 0 && roas > 0) el.textContent = `Current monthly revenue: $${(spend*roas).toLocaleString(undefined,{maximumFractionDigits:0})}`;
      });
    });
  };

  return `
${Components.nav()}
<div style="padding-top:var(--nav-h);">
<section style="padding:80px 0;min-height:calc(100vh - var(--nav-h));">
  <div class="container" style="max-width:860px;">
    <div style="text-align:center;margin-bottom:48px;">
      <div class="section-eyebrow">ROI Calculator</div>
      <h1 class="section-title">How Much Is Bad Attribution <em>Costing You?</em></h1>
      <p class="section-body" style="margin:16px auto 0;text-align:center;">Enter your current numbers and see exactly what NexusTrack would return.</p>
    </div>

    <div class="card" style="padding:36px;margin-bottom:20px;">
      <form id="roi-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="form-group">
            <label class="form-label">Monthly Ad Spend *</label>
            <div style="position:relative;">
              <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-4);font-size:14px;">$</span>
              <input type="number" name="monthly_spend" class="form-input" style="padding-left:26px;" placeholder="10000" min="100" required/>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Current ROAS *</label>
            <input type="number" name="current_roas" class="form-input" placeholder="3.5" min="0.1" step="0.1" required/>
          </div>
          <div class="form-group">
            <label class="form-label">Ad Channels</label>
            <select name="channels" class="form-input form-select">
              <option value="1">1 channel</option>
              <option value="2">2 channels</option>
              <option value="3" selected>3 channels</option>
              <option value="4">4 channels</option>
              <option value="5">5+ channels</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Industry</label>
            <select name="industry" class="form-input form-select">
              <option value="saas">B2B SaaS</option>
              <option value="ecommerce">Ecommerce</option>
              <option value="agency">Agency</option>
              <option value="health">Health & Wellness</option>
              <option value="education">Education</option>
            </select>
          </div>
        </div>
        <div id="current-rev-preview" style="font-size:12px;color:var(--text-4);margin-bottom:16px;"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:15px;">Calculate My ROI</button>
      </form>
    </div>

    <div id="roi-results" style="display:none;"></div>
  </div>
</section>
</div>
${Components.footer()}`;
};


// ═══════════════════════════════════════════════════════════
//  PATCH: initRoutes — add all new routes
// ═══════════════════════════════════════════════════════════
const _origInitRoutes = initRoutes;
initRoutes = function() {
  _origInitRoutes();
  // New feature routes
  Router.register('/dashboard/attribution',      Pages.attributionDashboard, { auth: true });
  Router.register('/dashboard/contacts',         Pages.contacts,             { auth: true });
  Router.register('/dashboard/campaigns',        Pages.campaigns,            { auth: true });
  Router.register('/dashboard/events',           Pages.eventsManager,        { auth: true });
  Router.register('/dashboard/alerts',           Pages.alerts,               { auth: true });
  Router.register('/dashboard/sync',             Pages.syncStatus,           { auth: true });
  Router.register('/dashboard/utm',              Pages.utmBuilder,           { auth: true });
  Router.register('/roi',                        Pages.roiCalculator);
  Router.register(/^\/dashboard\/contacts\/(\d+)$/, Pages.contactDetail,    { auth: true });
};

// ═══════════════════════════════════════════════════════════
//  API EXTENSIONS
// ═══════════════════════════════════════════════════════════
Object.assign(api, {
  attribution:  (model='linear') => api.get(`/attribution?model=${model}`),
  events:       { list: () => api.get('/events'), create: d => api.post('/events',d), remove: id => api.delete(`/events/${id}`), toggle: (id,v) => api.patch(`/events/${id}`,{is_active:v}) },
  alerts:       { list: () => api.get('/alerts'), create: d => api.post('/alerts',d), remove: id => api.delete(`/alerts/${id}`), toggle: id => api.post(`/alerts/${id}/toggle`) },
  contacts:     { list: (q='') => api.get(`/contacts${q?'?q='+encodeURIComponent(q):''}`), get: id => api.get(`/contacts/${id}`) },
  campaigns:    { list: (p) => api.get(`/campaigns${p?'?platform='+encodeURIComponent(p):''}`) },
  utm:          { build: d => api.post('/utm/build',d), templates: () => api.get('/utm/templates') },
  roi:          { calculate: d => api.post('/roi/calculate',d) },
  sync:         { status: () => api.get('/sync/status') },
});
