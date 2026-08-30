/* ─────────────────────────────────────────────────────────────────────────
   landing.js — behavior shared by every landing page.

   Two jobs: the EN/ES toggle, and submitting the single form on the page
   through window.Selah.saveLead (from selah.js) with honest success/failure
   states. A page opts in by giving its form id="lp-form" and setting
   data-source / data-service on it.
   ───────────────────────────────────────────────────────────────────────── */
(function (w, d) {
  'use strict';

  // ── MENU ──────────────────────────────────────────────────────────────
  // The links are always in the DOM so crawlers see them; this only drives
  // the mobile open/closed state.
  d.addEventListener('DOMContentLoaded', function () {
    var t = d.getElementById('lp-nav-toggle'), m = d.getElementById('lp-menu');
    if (!t || !m) return;
    t.addEventListener('click', function () {
      var open = m.classList.toggle('open');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // ── LANGUAGE ──────────────────────────────────────────────────────────
  function setLang(lang) {
    var en = d.getElementById('btn-en'), es = d.getElementById('btn-es');
    if (en) en.classList.toggle('active', lang === 'en');
    if (es) es.classList.toggle('active', lang === 'es');

    d.querySelectorAll('[data-en]').forEach(function (el) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      var val = el.getAttribute('data-' + lang);
      if (val) el.innerHTML = val;
    });
    d.querySelectorAll('[data-placeholder-en]').forEach(function (el) {
      el.placeholder = el.getAttribute('data-placeholder-' + lang) || el.placeholder;
    });
    d.documentElement.lang = lang;
    try { sessionStorage.setItem('selah_lang', lang); } catch (e) {}
  }
  w.setLang = setLang;

  // Spanish-speaking visitors shouldn't have to find the toggle themselves.
  d.addEventListener('DOMContentLoaded', function () {
    var stored = null;
    try { stored = sessionStorage.getItem('selah_lang'); } catch (e) {}
    var lang = stored || (/^es/i.test(navigator.language || '') ? 'es' : 'en');
    if (lang === 'es') setLang('es');
  });

  // ── FORM ──────────────────────────────────────────────────────────────
  d.addEventListener('submit', async function (e) {
    var form = e.target;
    if (!form.matches('#lp-form')) return;
    e.preventDefault();

    var data = Object.fromEntries(new FormData(form));
    var btn = form.querySelector('button[type="submit"]');
    var errEl = d.getElementById('lp-error');
    var okEl = d.getElementById('lp-success');

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    if (errEl) errEl.style.display = 'none';

    // Optional qualifying fields (name="q_*") ride along inside the message.
    // The Supabase fallback writes a fixed schema, so anything not folded in
    // here is lost the moment the primary endpoint is down — which is exactly
    // when we least want to drop a commercial lead.
    var extras = Object.keys(data)
      .filter(function (k) { return k.indexOf('q_') === 0 && data[k]; })
      .map(function (k) {
        var el = form.querySelector('[name="' + k + '"]');
        var label = (el && el.getAttribute('data-label')) || k.slice(2).replace(/_/g, ' ');
        return label + ': ' + data[k];
      });
    var message = extras.length
      ? extras.join('\n') + (data.message ? '\n\n' + data.message : '')
      : (data.message || '');

    var consented = data.sms_consent === 'true';
    var ok = await w.Selah.saveLead({
      name: (data.name || ((data.first_name || '') + ' ' + (data.last_name || ''))).trim(),
      phone: data.phone || '',
      email: data.email || '',
      message: message,
      service: data.service || form.dataset.service || '',
      source: form.dataset.source || 'landing_page',
      company: data.company || '',
      sms_consent: consented ? 'true' : 'false',
      consent_text: consented ? w.Selah.CONSENT_TEXT : ''
    });

    if (btn) { btn.disabled = false; btn.style.opacity = ''; }

    if (!ok) {
      if (errEl) errEl.style.display = 'block';
      return;
    }

    form.style.display = 'none';
    if (okEl) okEl.style.display = 'block';

    // The lead magnet pages hand over a file once we have the contact.
    if (form.dataset.deliver) w.location.href = form.dataset.deliver;
  });
})(window, document);
