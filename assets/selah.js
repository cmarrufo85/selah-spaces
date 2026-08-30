/* ─────────────────────────────────────────────────────────────────────────
   selah.js — shared attribution, analytics, and lead capture.

   Every page on selahspaces.io loads this. It does three jobs:

     1. Remembers where a visitor came from (UTM tags, ?ref= referral codes,
        Facebook's fbclid) for the whole visit, so a lead submitted eight
        minutes and four page-views later still credits the right source.
     2. Loads the Meta Pixel and GA4 — but only if their IDs are filled in
        below. Blank IDs are a no-op, so this file is safe to ship before
        the accounts exist.
     3. Sends leads to the Twilio funnel endpoint, falls back to Supabase,
        and — critically — TELLS THE CALLER WHETHER IT WORKED. The old
        inline version swallowed every error and showed "thank you" anyway,
        which meant a lead lost during an outage was lost invisibly.

   ───────────────────────────────────────────────────────────────────────── */
(function (w, d) {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────
  // Fill these in once the Meta and Google accounts exist. Leave blank to
  // disable that tracker entirely — no network calls, no console noise.
  var CONFIG = {
    PIXEL_ID: '',            // Meta Pixel, e.g. '1234567890123456'
    GA4_ID: '',              // Google Analytics 4, e.g. 'G-XXXXXXXXXX'
    LEAD_ENDPOINT: 'https://selah-voice-5007-prod.twil.io/lead',
    SUPABASE_URL: 'https://upfvakfjfyzvqnnqvgpq.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwZnZha2ZqZnl6dnFubnF2Z3BxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDI0MjAsImV4cCI6MjA5NzMxODQyMH0.BO_ZUG3xKKbWkoIbrrG8vRXb9agO03hwkaL9ie_8yg0',
    CONSENT_TEXT: 'I agree to receive text messages from Selah Spaces about my assessment and service. Msg & data rates may apply. Reply STOP to opt out.'
  };

  // ── ATTRIBUTION ───────────────────────────────────────────────────────
  // Captured once on first page of the visit, then read from sessionStorage.
  // sessionStorage (not localStorage) on purpose: a visit is the unit of
  // attribution. A visitor who comes back next month from Google should not
  // still be credited to a Facebook post.
  var ATTR_KEY = 'selah_attr';
  var ATTR_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function readStored() {
    try { return JSON.parse(sessionStorage.getItem(ATTR_KEY) || '{}'); } catch (e) { return {}; }
  }
  function store(obj) {
    try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  var ATTRIBUTION = (function () {
    var q = new URLSearchParams(w.location.search);
    var stored = readStored();
    var fresh = {};

    ATTR_FIELDS.forEach(function (f) { if (q.get(f)) fresh[f] = q.get(f); });
    if (q.get('ref')) fresh.ref = q.get('ref');
    if (q.get('fbclid')) { fresh.fbclid = q.get('fbclid'); if (!fresh.utm_source) fresh.utm_source = 'facebook'; }
    if (q.get('gclid')) { fresh.gclid = q.get('gclid'); if (!fresh.utm_source) fresh.utm_source = 'google'; }

    // A new campaign tag mid-visit wins; otherwise keep what we already had.
    var merged = Object.keys(fresh).length ? Object.assign({}, stored, fresh) : stored;

    if (!merged.landing_page) merged.landing_page = w.location.pathname;
    if (!merged.referrer && d.referrer && d.referrer.indexOf(w.location.hostname) === -1) {
      merged.referrer = d.referrer.slice(0, 300);
    }
    // Facebook and Instagram in-app browsers often strip the referrer but
    // keep fbclid — and sometimes neither. Catch the obvious host cases.
    if (!merged.utm_source && /facebook|instagram|fb\.me|l\.facebook/i.test(merged.referrer || '')) {
      merged.utm_source = 'facebook';
      merged.utm_medium = merged.utm_medium || 'organic_social';
    }

    store(merged);
    return merged;
  })();

  // Legacy: the referral redirect and older pages read `selah_ref` directly.
  if (ATTRIBUTION.ref) { try { sessionStorage.setItem('selah_ref', ATTRIBUTION.ref); } catch (e) {} }

  // ── META PIXEL ────────────────────────────────────────────────────────
  if (CONFIG.PIXEL_ID) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(w, d, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    w.fbq('init', CONFIG.PIXEL_ID);
    w.fbq('track', 'PageView');
  }

  // ── GA4 ───────────────────────────────────────────────────────────────
  if (CONFIG.GA4_ID) {
    var g = d.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + CONFIG.GA4_ID;
    d.head.appendChild(g);
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', CONFIG.GA4_ID);
  }

  /**
   * Fire one conversion event to every tracker that is configured.
   * Safe to call when nothing is configured — it simply does nothing.
   */
  function track(event, params) {
    params = params || {};
    try { if (w.fbq) w.fbq('track', event, params); } catch (e) {}
    try { if (w.gtag) w.gtag('event', event.toLowerCase(), params); } catch (e) {}
  }

  // ── LEAD CAPTURE ──────────────────────────────────────────────────────
  /**
   * Send a lead. Resolves to true only if it actually landed somewhere.
   * Callers MUST branch on the result — never show a success state blindly.
   */
  async function saveLead(payload) {
    var clean = {};
    Object.keys(payload).forEach(function (k) {
      clean[k] = payload[k] == null ? '' : String(payload[k]);
    });

    // Attribution rides along on every submission.
    Object.keys(ATTRIBUTION).forEach(function (k) {
      if (ATTRIBUTION[k]) clean[k] = String(ATTRIBUTION[k]);
    });
    clean.page = w.location.pathname;
    // Needed server-side for the Meta Conversions API match quality.
    clean.user_agent = String(navigator.userAgent || '').slice(0, 400);

    var delivered = false;

    try {
      var r = await fetch(CONFIG.LEAD_ENDPOINT, {
        method: 'POST',
        body: new URLSearchParams(clean)
      });
      if (!r.ok) throw new Error('lead endpoint HTTP ' + r.status);
      delivered = true;
    } catch (err) {
      console.error('Lead endpoint failed, trying Supabase fallback:', err);
      try {
        // NOTE: the RLS policy on selah_leads requires sms_consent = true on
        // insert. Forms that collect consent pass it through; forms that do
        // not will be rejected here and the caller shows the error state.
        var res = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/selah_leads', {
          method: 'POST',
          headers: {
            'apikey': CONFIG.SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            name: clean.name,
            phone: clean.phone,
            email: clean.email || null,
            service: clean.service || null,
            message: clean.message || null,
            source: clean.source || 'website',
            status: 'new',
            sms_consent: clean.sms_consent === 'true',
            consent_text: clean.consent_text || null,
            consented_at: clean.sms_consent === 'true' ? new Date().toISOString() : null,
            utm_source: clean.utm_source || null,
            utm_medium: clean.utm_medium || null,
            utm_campaign: clean.utm_campaign || null,
            utm_content: clean.utm_content || null,
            referral_code: clean.ref || null,
            landing_page: clean.landing_page || null
          })
        });
        if (!res.ok) throw new Error('supabase HTTP ' + res.status);
        delivered = true;
      } catch (err2) {
        console.error('Fallback lead write failed:', err2);
      }
    }

    if (delivered) {
      track('Lead', {
        content_name: clean.service || 'free_assessment',
        source: clean.source || 'website'
      });
    }
    return delivered;
  }

  // ── PHONE CLICKS ──────────────────────────────────────────────────────
  // A tap-to-call is a conversion too, and it is the only one that leaves no
  // database row — so the pixel is the only place it can ever be counted.
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (a) track('Contact', { method: 'phone' });
  });

  // ── EXPORTS ───────────────────────────────────────────────────────────
  w.Selah = {
    saveLead: saveLead,
    track: track,
    attribution: ATTRIBUTION,
    CONSENT_TEXT: CONFIG.CONSENT_TEXT
  };
})(window, document);
