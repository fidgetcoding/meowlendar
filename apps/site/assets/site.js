/* meowlendar.com: fits the hook to one line, sizes the hero grid's hours to the fold, draws the wires
   between prompt, call and grid, plays the intro once, reveals sections, and runs the Copy buttons.
   The pages read fine without it (the html.js class gates every hidden-until-animated state). */
(function () {
  'use strict';
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOB = () => innerWidth < 820;
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  /* ---------- the hook: largest size that keeps it on one line ---------- */
  function fitHooks() {
    document.querySelectorAll('.hook').forEach((el) => {
      const max = +el.dataset.max || 120;
      el.style.whiteSpace = 'nowrap'; el.style.fontSize = max + 'px';
      const avail = el.clientWidth, w = el.scrollWidth;
      let fs = w > avail ? Math.floor(max * avail / w * 0.985 * 10) / 10 : max;
      if (MOB() && fs < 34) { el.style.whiteSpace = 'normal'; fs = 46; }
      el.style.fontSize = fs + 'px';
    });
  }

  /* ---------- the hero sub: one line from 1120 up, 19px or the largest size that fits beside the buttons ---------- */
  function fitSub() {
    const s = document.querySelector('.top .sub');
    if (!s) return;
    s.style.fontSize = '';
    if (innerWidth < 1120) return;
    const row = s.parentElement, c = row.querySelector('.ctas'), stacked = getComputedStyle(row).flexDirection === 'column';
    const avail = stacked ? row.clientWidth : row.clientWidth - c.offsetWidth - (parseFloat(getComputedStyle(row).columnGap) || 0);
    s.style.fontSize = '19px';
    const w = s.scrollWidth;
    if (w > avail) s.style.fontSize = Math.floor(19 * avail / w * 0.99 * 10) / 10 + 'px';
  }

  /* ---------- the hero grid: grow the hour height so the card ends just above the fold ---------- */
  function fillGrid() {
    const g = document.querySelector('.gridin');
    if (!g) return;
    // 80px hours make a half-hour card 38px, the least that holds its two lines inside it; phones stay at that
    const hours = parseFloat(g.style.getPropertyValue('--hours')) || 7, MIN = 80, MAX = 104;
    let H = MIN;
    if (!MOB()) {
      const top = g.getBoundingClientRect().top + scrollY, head = g.querySelector('.gbody').getBoundingClientRect().top - g.getBoundingClientRect().top;
      H = Math.max(MIN, Math.min(MAX, Math.floor((Math.max(innerHeight, 720) - 36 - top - head) / hours)));
      g.style.setProperty('--H', H + 'px');
      // when the prompt column sets a taller row, grow the hours into the card instead of leaving a blank strip at the bottom
      const card = g.closest('.gcard'), spare = card ? card.clientHeight - g.offsetHeight : 0;
      if (spare >= hours) H = Math.min(MAX, H + Math.floor(spare / hours));
    }
    g.style.setProperty('--H', H + 'px');
    // the app's card sizes: under 30px a card is one line, under 62px it drops its meta line (an agent card its time too)
    g.querySelectorAll('.ev').forEach((ev) => {
      const h = parseFloat(ev.style.getPropertyValue('--d')) * H;
      ev.classList.remove('fit1');
      ev.classList.toggle('tiny', h < 30);
      ev.classList.toggle('short', h < 62);
    });
    // an agent card under 62px: the title on line 1, then "By your agent" (and the half-hour task's time, if it fits) on line 2
    g.querySelectorAll('.ev.agent').forEach((ev) => {
      const half = parseFloat(ev.style.getPropertyValue('--d')) * H < 62;
      ev.classList.toggle('half', half);
      ev.classList.remove('notime');
      if (!half) return;
      ev.classList.remove('tiny', 'short');
      const ag = ev.querySelector('.ag');
      if (ag.scrollWidth > ag.clientWidth + 1) ev.classList.add('notime');
    });
  }

  /* ---------- the loaf never covers event text (the app's fitLoaf): every text line of a today card that
     crosses the loaf's drawn box ends before it; a title that still doesn't fit gets an ellipsis ---------- */
  function fitLoaf() {
    const cat = document.querySelector('.col.today .nowcat svg');
    if (!cat) return;
    const evs = [...cat.closest('.col').querySelectorAll('.ev')];
    evs.forEach((ev) => { ev.classList.remove('fit1'); ev.querySelectorAll(':scope > *').forEach((p) => (p.style.marginRight = '')); });
    const r = cat.getBoundingClientRect();
    const L = { left: r.left + r.width * 3 / 120 - 4, top: r.top + r.height * 15 / 66 - 3, bottom: r.bottom + 2 };
    for (const ev of evs) {
      const er = ev.getBoundingClientRect();
      if (er.bottom <= L.top || er.top >= L.bottom || er.right <= L.left) continue;
      const edge = er.right - parseFloat(getComputedStyle(ev).paddingRight);
      const parts = [...ev.children];
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const p of parts) {
          const pr = p.getBoundingClientRect();
          if (!pr.height) continue;
          const hit = pr.bottom > L.top && pr.top < L.bottom;
          const want = hit ? Math.ceil(Math.max(0, edge - L.left)) + 'px' : '';
          if (p.style.marginRight !== want) { p.style.marginRight = want; moved = true; }
        }
        const sp = ev.querySelector('.t span');
        if (sp && !ev.classList.contains('fit1') && sp.scrollWidth > sp.clientWidth + 1) { ev.classList.add('fit1'); moved = true; }
        if (!moved) break;
      }
    }
  }

  /* ---------- the wires, measured from the three stations ---------- */
  const WD = [0, 0];
  function wire() {
    const box = document.querySelector('.wired'), svg = document.querySelector('.wires');
    if (!box || !svg) return;
    const p = box.querySelector('.st1 .card1'), t = box.querySelector('.st2 .term'), k = box.querySelector('.st3 .ev.t1');
    if (!p || !t || !k) return;
    const r0 = box.getBoundingClientRect();
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - r0.left, r: r.right - r0.left, t: r.top - r0.top, b: r.bottom - r0.top, w: r.width, h: r.height }; };
    const a = R(p), b = R(t), c = R(k);
    if (k.classList.contains('landing')) { c.t += 18; c.b += 18; }
    svg.setAttribute('viewBox', `0 0 ${r0.width} ${r0.height}`);
    let d1, d2, e1, e2;
    if (MOB()) {
      const x = 22, ya = a.t + a.h / 2, yb = b.t + 34, yb2 = b.b - 40, yc = c.t + Math.min(c.h / 2, 24);
      d1 = `M${a.l} ${ya} H${x} V${yb} H${b.l}`; e1 = [a.l, ya, b.l, yb];
      d2 = `M${b.l} ${yb2} H${x} V${yc} H${c.l}`; e2 = [b.l, yb2, c.l, yc];
    } else {
      const y1 = a.t + a.h * .62, y2 = b.t + 40, mx = (a.r + b.l) / 2;
      d1 = `M${a.r} ${y1} C${mx + 10} ${y1} ${mx - 10} ${y2} ${b.l} ${y2}`; e1 = [a.r, y1, b.l, y2];
      const y3 = b.t + b.h * .55, y4 = c.t + Math.min(c.h / 2, 26), nx = (b.r + c.l) / 2;
      d2 = `M${b.r} ${y3} C${nx + 30} ${y3} ${nx - 30} ${y4} ${c.l} ${y4}`; e2 = [b.r, y3, c.l, y4];
    }
    const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="4.5" class="nd"/>`;
    const dn = (i) => (RM || WD[i] ? 'drawn' : '');
    const spark = (d) => `<circle r="5.5" class="spark"><animateMotion dur=".8s" begin="indefinite" fill="freeze" path="${d}" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines=".22 .7 .18 1"/></circle>`;
    svg.innerHTML = `<path class="w ${dn(0)}" d="${d1}" pathLength="1"/><path class="w ${dn(1)}" d="${d2}" pathLength="1"/>${dot(e1[0], e1[1])}${dot(e1[2], e1[3])}${dot(e2[0], e2[1])}${dot(e2[2], e2[3])}${spark(d1)}${spark(d2)}`;
  }
  function drawWire(i) {
    WD[i] = 1;
    const p = document.querySelectorAll('.wires path.w')[i], sp = document.querySelectorAll('.wires .spark')[i];
    if (p) p.classList.add('draw');
    if (sp) { sp.classList.add('go'); const m = sp.querySelector('animateMotion'); if (m && m.beginElement) m.beginElement(); }
  }

  /* ---------- any card whose text still runs past its bottom edge (a two-line title in a narrow column) takes the
     app's short form (one-line title and label, no meta line), then, if it must, a one-line title ---------- */
  const spills = (ev) => {
    const kids = [...ev.children].filter((c) => c.offsetHeight && getComputedStyle(c).display !== 'none');
    return kids.length && kids[kids.length - 1].getBoundingClientRect().bottom > ev.getBoundingClientRect().bottom + 1;
  };
  function fitCards() {
    const evs = [...document.querySelectorAll('.gridin .ev:not(.tiny):not(.half)')];
    let changed = false;
    evs.forEach((ev) => { if (!ev.classList.contains('short') && spills(ev)) { ev.classList.add('short'); changed = true; } });
    if (changed) fitLoaf();
    evs.forEach((ev) => { if (spills(ev)) ev.classList.add('fit1'); });
  }

  /* ---------- the paw print behind the terminal: keep 16px clear of the scroll kitty (where it sits at the top
     of the page), the price tag, the grid and the wires; shrink it, then give up, if it can't ---------- */
  function placePaw() {
    const paw = document.querySelector('.pawbg');
    if (!paw) return;
    paw.classList.remove('off'); paw.style.removeProperty('--pw');
    if (MOB()) return;
    const box = document.querySelector('.wired').getBoundingClientRect();
    const keep = [...document.querySelectorAll('.ptag, .price .eb, .gcard, .card1, .st .lab')].map((e) => e.getBoundingClientRect());
    document.querySelectorAll('.wires path.w').forEach((p) => { const b = p.getBBox(); keep.push({ left: box.left + b.x, top: box.top + b.y, right: box.left + b.x + b.width, bottom: box.top + b.y + b.height }); });
    const k = document.querySelector('.scrollcat');
    if (k && getComputedStyle(k).position === 'fixed') { const r = k.getBoundingClientRect(); keep.push({ left: r.left, right: r.right, top: r.top - scrollY, bottom: r.bottom - scrollY }); }
    const clear = () => { const r = paw.getBoundingClientRect(); return keep.every((q) => r.right + 16 <= q.left || r.left - 16 >= q.right || r.bottom + 16 <= q.top || r.top - 16 >= q.bottom); };
    for (const pw of [116, 100, 86]) { paw.style.setProperty('--pw', pw + 'px'); if (clear()) return; }
    paw.classList.add('off');
  }

  /* ---------- the intro, once per load: prompt, call, the task lands, the wires draw ---------- */
  function playDemo() {
    const rows = [...document.querySelectorAll('[data-s]')];
    if (!rows.length) return;
    const S = (n) => rows.filter((r) => +r.dataset.s === n);
    if (RM) {
      rows.forEach((r) => r.classList.add('on'));
      WD[0] = WD[1] = 1;
      document.querySelectorAll('.landing').forEach((c) => c.classList.remove('landing'));
      wire();
      return;
    }
    at(250, () => S(1).forEach((r) => r.classList.add('on')));
    at(550, () => drawWire(0));
    at(1300, () => S(2).forEach((r) => r.classList.add('on')));
    at(1680, () => drawWire(1));
    at(2500, () => {
      document.querySelectorAll('.landing').forEach((c) => { c.classList.remove('landing'); if (c.classList.contains('ev')) c.classList.add('landed'); });
      document.querySelectorAll('.loaf').forEach((c) => c.classList.add('twitch'));
    });
    at(3300, () => S(3).forEach((r) => r.classList.add('on')));
  }

  /* ---------- reveal sections as they scroll in ---------- */
  function reveal() {
    const els = [...document.querySelectorAll('.rv')];
    if (RM || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- Copy buttons (setup) ---------- */
  function copy(btn) {
    const el = document.getElementById(btn.dataset.copy), txt = el ? el.textContent : '';
    const done = () => {
      const sp = btn.querySelector('span'); if (!sp) return;
      if (!btn.dataset.label) btn.dataset.label = sp.textContent;
      sp.textContent = 'Copied';
      clearTimeout(btn._t); btn._t = setTimeout(() => (sp.textContent = btn.dataset.label), 1400);
    };
    const fb = () => {
      const t = document.createElement('textarea');
      t.value = txt; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
      t.remove(); done();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fb); else fb();
  }
  document.addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) copy(c); });

  /* ---------- the scroll kitty: shown at the top of the page only when there is more below and it clears
     the hero's pieces; fades once the page scrolls past 80px; click (or Enter) goes to "What it does" ---------- */
  const kitty = document.querySelector('.scrollcat');
  const KEEP = '.ptag, .gcard, .srule, .term, .card1, .hloaf .loaf, .price .eb, .feat .sh';
  // where the kitty sits at the top of the page: full size, compact (46px) if that clears, or not at all.
  // Measured against the page at scroll 0, so it doesn't change size while the reader scrolls.
  let kittyFits = false;
  function kittyPlace() {
    if (!kitty) return;
    kitty.classList.remove('compact');
    const more = document.documentElement.scrollHeight - innerHeight > 80;
    const clashes = () => {
      if (MOB()) return false;
      const r = kitty.getBoundingClientRect();
      return [...document.querySelectorAll(KEEP)].some((el) => { const q = el.getBoundingClientRect(); return q.width && r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + scrollY + 4 && r.bottom > q.top + scrollY - 4; });
    };
    kittyFits = more && !clashes();
    if (more && !kittyFits) { kitty.classList.add('compact'); kittyFits = !clashes(); if (!kittyFits) kitty.classList.remove('compact'); }
    kittyShow();
  }
  function kittyShow() { if (kitty) kitty.classList.toggle('gone', !kittyFits || scrollY > 80); }
  if (kitty) {
    kitty.addEventListener('click', () => {
      const t = document.getElementById('what-it-does'); if (!t) return;
      t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
      t.focus({ preventScroll: true });
    });
    let sq = 0;
    addEventListener('scroll', () => { if (!sq) sq = requestAnimationFrame(() => { sq = 0; kittyShow(); }); }, { passive: true });
  }

  /* ---------- run ---------- */
  function layout() { fitHooks(); fitSub(); fillGrid(); fitLoaf(); fitCards(); wire(); kittyPlace(); placePaw(); }
  layout();
  playDemo();
  reveal();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 80); });
})();
