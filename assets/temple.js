(function(){
  "use strict";
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobile  = window.matchMedia('(max-width: 720px)').matches;
  var finePtr = window.matchMedia('(pointer: fine)').matches && !mobile;

  var canvas = document.getElementById('scene');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1;
  function resize(){
    DPR = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildClouds();
  }

  /* three camera angles, one location — plates fetched as base64 text assets */
  var plates = [new Image(), new Image(), new Image()];
  var SUN = [{u:0.72,v:0.16},{u:0.52,v:0.12},{u:0.74,v:0.10}];
  var loaded = 0;
  function onLoad(){ if(++loaded === 3){ start(); } }
  ['/assets/plates/ang1.jpg.b64',
   '/assets/plates/ang2.jpg.b64',
   '/assets/plates/ang3.jpg.b64'].forEach(function(url, i){
    fetch(url).then(function(r){ if(!r.ok) throw 0; return r.text(); }).then(function(t){
      plates[i].onload = onLoad; plates[i].onerror = function(){ onLoad(); };
      plates[i].src = t.trim();
    }).catch(function(){ onLoad(); });
  });

  var clouds = [];
  function makePuff(r){
    var c = document.createElement('canvas'); c.width = c.height = r * 2;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(252,246,232,0.5)');
    grad.addColorStop(0.55, 'rgba(250,240,220,0.18)');
    grad.addColorStop(1, 'rgba(250,240,220,0)');
    g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2);
    return c;
  }
  var puffA = makePuff(220), puffB = makePuff(150);
  function buildClouds(){
    clouds = [];
    var n = mobile ? 4 : 7;
    for(var i = 0; i < n; i++){
      clouds.push({
        img: i % 2 ? puffA : puffB,
        x: Math.random() * (W + 600) - 300,
        y: Math.random() * H * 0.45,
        s: 0.7 + Math.random() * 1.6,
        v: 5 + Math.random() * 11,
        a: 0.06 + Math.random() * 0.08,
        depth: 0.22 + Math.random() * 0.12
      });
    }
  }

  var motes = [];
  function buildMotes(){
    motes = [];
    var n = mobile ? 16 : 42;
    for(var i = 0; i < n; i++){
      motes.push({
        x: Math.random(), y: Math.random(),
        r: 0.8 + Math.random() * 2.0,
        vy: 0.008 + Math.random() * 0.02,
        ph: Math.random() * Math.PI * 2,
        sw: 8 + Math.random() * 22
      });
    }
  }

  var scrollP = 0, targetP = 0;
  var px = 0, py = 0, tpx = 0, tpy = 0;
  var t = 0, last = 0, running = false, started = false;

  function progress(){
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return Math.min(1, Math.max(0, window.scrollY / max));
  }
  if(finePtr && !reduced){
    window.addEventListener('pointermove', function(e){
      tpx = (e.clientX / W - 0.5); tpy = (e.clientY / H - 0.5);
    }, {passive:true});
  }
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){ running = false; }
    else if(started && !reduced){ running = true; last = performance.now(); requestAnimationFrame(frame); }
  });

  function coverDraw(img, cx, cy, scale, alpha, blurPx){
    var s = Math.max(W / img.width, H / img.height) * scale;
    var dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    if(blurPx){ try{ ctx.filter = 'blur(' + blurPx + 'px)'; }catch(e){} }
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    return {dw: dw, dh: dh};
  }

  function sstep(a, b, x){
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function localP(p, a, b){ return Math.min(1, Math.max(0, (p - a) / (b - a))); }

  function weights(p){
    var w1 = (1 - sstep(0.24, 0.40, p)) + sstep(0.84, 0.98, p);
    var w2 = sstep(0.24, 0.40, p) * (1 - sstep(0.60, 0.74, p));
    var w3 = sstep(0.60, 0.74, p) * (1 - sstep(0.84, 0.98, p));
    return [Math.min(1, Math.max(0, w1)), w2, w3];
  }

  function camFor(i, lp){
    if(i === 0) return {s: 1.07 + lp * 0.10, x: Math.sin(lp * Math.PI) * W * 0.020, y: -lp * H * 0.080};
    if(i === 1) return {s: 1.04 + lp * 0.20, x: Math.cos(lp * Math.PI) * W * 0.020, y: -lp * H * 0.120};
    return {s: 1.08 + lp * 0.12, x: Math.sin(lp * Math.PI * 0.8) * W * 0.025, y: -lp * H * 0.060};
  }

  function drawBeams(sx, sy, strength, time){
    var beams = mobile ? 5 : 7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(var i = 0; i < beams; i++){
      var spread = (i - (beams - 1) / 2);
      var ang = (-68 + spread * 10 + Math.sin(time * 0.30 + i * 1.7) * 2.2) * Math.PI / 180;
      var len = H * 1.25;
      var wdt = (44 + Math.abs(spread) * 30) * (0.9 + 0.2 * Math.sin(time * 0.4 + i));
      var a = strength * (0.60 + 0.40 * Math.sin(time * 0.45 + i * 2.1));
      var ex = sx + Math.cos(ang) * len, ey = sy + Math.abs(Math.sin(ang)) * len;
      var grad = ctx.createLinearGradient(sx, sy, ex, ey);
      grad.addColorStop(0, 'rgba(255,244,220,' + (a * 0.55).toFixed(3) + ')');
      grad.addColorStop(0.6, 'rgba(255,240,210,' + (a * 0.22).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = wdt; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    }
    var gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.42);
    gr.addColorStop(0, 'rgba(255,246,224,' + (strength * 0.75).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(255,246,224,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(sx - H * 0.45, sy - H * 0.45, H * 0.9, H * 0.9);
    ctx.restore();
  }

  function frame(now){
    if(!running) return;
    var dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    targetP = progress();
    scrollP += (targetP - scrollP) * 0.085;
    px += (tpx - px) * 0.05; py += (tpy - py) * 0.05;
    var p = scrollP;
    ctx.clearRect(0, 0, W, H);

    var w = weights(p);
    var lps = [localP(p, 0, 0.40), localP(p, 0.24, 0.74), localP(p, 0.60, 0.98)];
    var sunX = 0, sunY = 0, sunW = 0, i, c, cx, cy, dim;
    for(i = 0; i < 3; i++){
      if(w[i] < 0.004 || !plates[i].complete || !plates[i].naturalWidth) continue;
      c = camFor(i, lps[i]);
      cx = W / 2 + c.x + px * 9;
      cy = H / 2 + c.y - p * H * 0.02 + py * 7;
      dim = coverDraw(plates[i], cx, cy, c.s, w[i], 0);
      sunX += (cx + (SUN[i].u - 0.5) * dim.dw) * w[i];
      sunY += (cy + (SUN[i].v - 0.5) * dim.dh) * w[i];
      sunW += w[i];
    }
    if(sunW > 0){ sunX /= sunW; sunY /= sunW; }
    else { sunX = W * 0.72; sunY = H * 0.16; }

    ctx.fillStyle = 'rgba(240,226,196,' + (0.04 + p * 0.05).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);

    for(i = 0; i < clouds.length; i++){
      var cl = clouds[i];
      cl.x += cl.v * dt;
      if(cl.x - 320 * cl.s > W) cl.x = -320 * cl.s;
      var cyy = cl.y - p * H * cl.depth + py * 14 * cl.depth;
      var cw = 320 * cl.s, chh = 200 * cl.s;
      ctx.globalAlpha = cl.a;
      ctx.drawImage(cl.img, cl.x - cw / 2, cyy - chh / 2, cw, chh);
    }
    ctx.globalAlpha = 1;

    drawBeams(sunX, sunY, 0.26 + p * 0.30, t);

    ctx.fillStyle = '#FFF6E0';
    for(var m = 0; m < motes.length; m++){
      var mo = motes[m];
      mo.y -= mo.vy * dt; if(mo.y < -0.05) mo.y = 1.05;
      var mx = (mo.x * W) + Math.sin(t * 0.7 + mo.ph) * mo.sw + px * 18;
      var my = (mo.y * H) - p * H * 0.18;
      var tw = 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 1.6 + mo.ph));
      ctx.globalAlpha = tw;
      ctx.beginPath(); ctx.arc(mx, my, mo.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  function frozenFrame(){
    var p = 0.12, w = weights(p), lps = [localP(p, 0, 0.40), 0, 0];
    ctx.clearRect(0, 0, W, H);
    for(var i = 0; i < 3; i++){
      if(w[i] < 0.004 || !plates[i].complete || !plates[i].naturalWidth) continue;
      var c = camFor(i, lps[i]);
      var dim = coverDraw(plates[i], W / 2 + c.x, H / 2 + c.y, c.s, w[i], 0);
      if(i === 0){
        var sx = W / 2 + c.x + (SUN[0].u - 0.5) * dim.dw;
        var sy = H / 2 + c.y + (SUN[0].v - 0.5) * dim.dh;
        drawBeams(sx, sy, 0.30, 8);
      }
    }
    ctx.fillStyle = 'rgba(240,226,196,0.06)'; ctx.fillRect(0, 0, W, H);
  }

  function splitWords(){
    document.querySelectorAll('[data-split]').forEach(function(el){
      var words = el.textContent.trim().split(/\s+/);
      el.setAttribute('aria-label', el.textContent.trim());
      el.innerHTML = words.map(function(wd, i){
        return '<span class="w" style="--i:' + i + '" aria-hidden="true">' + wd + '</span>';
      }).join(' ');
    });
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, {threshold: 0.3});
    document.querySelectorAll('section').forEach(function(s){ io.observe(s); });
  }

  function start(){
    if(started) return; started = true;
    resize(); buildMotes();
    window.addEventListener('resize', resize);
    if(reduced){
      document.querySelectorAll('section').forEach(function(s){ s.classList.add('in'); });
      frozenFrame();
      window.addEventListener('scroll', frozenFrame, {passive:true});
    } else {
      splitWords();
      running = true; last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ resize(); });
  } else { resize(); }
})();
