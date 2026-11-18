/* Google Ads measurement with consent (UK PECR): nothing is stored until the visitor accepts.
   Consent mode starts "denied"; the banner asks once and remembers the answer in this browser. */
(function () {
  var AW = 'AW-18582430154';
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  var saved = null;
  try { saved = localStorage.getItem('ha_consent'); } catch (e) {}
  var granted = saved === 'granted' ? 'granted' : 'denied';
  gtag('consent', 'default', { ad_storage: granted, ad_user_data: granted, ad_personalization: granted, analytics_storage: granted, wait_for_update: 500 });
  gtag('set', 'url_passthrough', true);
  gtag('js', new Date());
  gtag('config', AW);
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + AW;
  document.head.appendChild(s);

  // Carry the Google Ads click id into Stripe checkout (client_reference_id), so a sale can be reported back to
  // Google from our server. Nothing is stored in the browser: the id comes from this page's URL (or Google's own
  // cookie when the visitor accepted cookies).
  function clickId() {
    var m = location.search.match(/[?&]gclid=([A-Za-z0-9_-]{10,180})/);
    if (m) return m[1];
    var c = document.cookie.match(/(?:^|; )_gcl_aw=GCL\.\d+\.([A-Za-z0-9_-]{10,180})/);
    return c ? c[1] : null;
  }
  function tagLinks() {
    var id = clickId();
    if (!id) return;
    var links = document.querySelectorAll('a[href^="https://buy.stripe.com/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (/client_reference_id=/.test(a.href)) continue;
      a.href += (a.href.indexOf('?') < 0 ? '?' : '&') + 'client_reference_id=g-' + id;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tagLinks); else tagLinks();
  window.addEventListener('pageshow', tagLinks);

  if (saved) return;
  function choose(v) {
    try { localStorage.setItem('ha_consent', v); } catch (e) {}
    if (v === 'granted') gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
    var b = document.getElementById('ha-cookie'); if (b) b.remove();
  }
  function show() {
    var b = document.createElement('div');
    b.id = 'ha-cookie';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Cookies');
    b.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:50;max-width:560px;margin:0 auto;background:#2a241e;color:#f6f1e7;border-radius:14px;padding:14px 16px;font:14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    b.innerHTML = '<span style="flex:1 1 260px">We use cookies to see which of our adverts work. Nothing else. <a href="/privacy" style="color:#f6f1e7">More</a></span>' +
      '<button type="button" data-v="denied" style="background:transparent;color:#f6f1e7;border:1.5px solid #f6f1e7;border-radius:999px;padding:7px 14px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer">No thanks</button>' +
      '<button type="button" data-v="granted" style="background:#9c3f2a;color:#fff;border:0;border-radius:999px;padding:8px 16px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer">Accept</button>';
    b.addEventListener('click', function (e) { var v = e.target && e.target.getAttribute && e.target.getAttribute('data-v'); if (v) choose(v); });
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
