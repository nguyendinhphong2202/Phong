/* ============================================================
   Laufbuch — app
   Vanilla JS, no build step. Runs are stored on-device in
   IndexedDB; OCR runs in the browser via Tesseract.js.
   ============================================================ */

(() => {
  'use strict';

  const P = window.RunParser;
  const G = window.Goals;
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const PREF_KEY = 'laufbuch.prefs.v1';
  const GOAL_KEY = 'laufbuch.goals.v1';
  const NS = 'http://www.w3.org/2000/svg';

  // ---------- Small helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const km1 = (v) => nf1.format(v || 0);
  const km2 = (v) => nf2.format(v || 0);
  const pace = (r) => (r.distanceKm && r.durationSec ? r.durationSec / r.distanceKm : null);

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  function s(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    return el;
  }

  const parseISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => P.iso(new Date());
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 864e5 + 1) / 7);
  }
  const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    parseISO(iso).toLocaleDateString('de-DE', opts);
  function fmtHours(sec) {
    const hrs = Math.floor(sec / 3600);
    const min = Math.round((sec % 3600) / 60);
    return hrs ? `${hrs} h ${min} min` : `${min} min`;
  }

  // ---------- Flitzi, the mascot ----------
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** mood: 'idle' (waves), 'run', 'cheer' */
  function mascot(mood = 'idle', size = 96) {
    const wrap = document.createElement('span');
    wrap.innerHTML = `<svg class="mascot mascot--${mood}" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
      <ellipse class="m-shadow" cx="60" cy="112" rx="24" ry="4.5"/>
      <g class="m-all">
        <g class="m-leg m-leg-l"><path class="m-limb" d="M49 88v13"/><ellipse class="m-shoe" cx="51.5" cy="104" rx="8.5" ry="5"/></g>
        <g class="m-leg m-leg-r"><path class="m-limb" d="M71 88v13"/><ellipse class="m-shoe" cx="73.5" cy="104" rx="8.5" ry="5"/></g>
        <g class="m-body">
          <path class="m-limb m-arm-l" d="M28 64q-9 5-11 15"/>
          <path class="m-limb m-arm-r" d="M92 64q9 5 11 15"/>
          <ellipse class="m-blob" cx="60" cy="60" rx="36" ry="33"/>
          <ellipse class="m-shine" cx="44" cy="40" rx="9" ry="5" transform="rotate(-28 44 40)"/>
          <path class="m-band" d="M27 47q33-13 66 0l-1.5 8.5q-31.5-11.5-63 0z"/>
          <path class="m-knot" d="M91 47l13-7-3 10 8 6-14 1z"/>
          <g class="m-eyes">
            <ellipse class="m-eye" cx="47" cy="66" rx="4.2" ry="5.6"/><ellipse class="m-eye" cx="73" cy="66" rx="4.2" ry="5.6"/>
            <circle class="m-glint" cx="48.5" cy="64" r="1.5"/><circle class="m-glint" cx="74.5" cy="64" r="1.5"/>
            <path class="m-happy" d="M42 67q5-7 10 0M68 67q5-7 10 0"/>
          </g>
          <circle class="m-cheek" cx="37" cy="76" r="6"/><circle class="m-cheek" cx="83" cy="76" r="6"/>
          <path class="m-mouth" d="M54 76q6 6 12 0"/>
          <path class="m-mouth-open" d="M52 75q8 12 16 0z"/>
        </g>
      </g>
    </svg>`;
    return wrap.firstElementChild;
  }
  function setMascot(el, mood, size) {
    if (el.dataset.mood === mood) return;
    el.dataset.mood = mood;
    el.replaceChildren(mascot(mood, size || +el.dataset.size || 96));
  }

  function confetti(n = 80) {
    if (reducedMotion()) return;
    const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    const colors = ['#ff8fab', '#86dcc0', '#ffcf5c', '#a9c8ff', '#c9b6ff', '#ffb38a'];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) {
      const heart = i % 10 === 0;
      const el = h('i', { class: heart ? 'heart emo' : i % 3 === 0 ? 'round' : '', text: heart ? '💖' : '' });
      el.style.cssText = `left:${rnd(0, 100)}%;--x:${rnd(-140, 140)}px;--r:${rnd(-900, 900)}deg;--t:${rnd(1.8, 3.4)}s;--d:${rnd(0, .5)}s;` +
        (heart ? '' : `background:${colors[i % colors.length]};width:${rnd(8, 15)}px;height:${rnd(8, 18)}px`);
      box.append(el);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 4400);
  }

  /** Big happy moment: Flitzi jumps, confetti falls. */
  function celebrate(title, strongText, rest = '') {
    $('.cheer')?.remove();
    const overlay = h('div', { class: 'cheer', role: 'status' },
      h('div', { class: 'cheer-card' }, mascot('cheer', 132), h('h2', { text: title }),
        h('p', {}, h('strong', { text: strongText }), rest)));
    const close = () => { overlay.classList.add('out'); setTimeout(() => overlay.remove(), 350); };
    overlay.addEventListener('click', close);
    document.body.append(overlay);
    confetti();
    setTimeout(close, 4000);
  }

  /** Counts a number up to its new value. */
  function countTo(el, value, fmt) {
    const from = el._v ?? 0;
    el._v = value;
    cancelAnimationFrame(el._raf);
    if (reducedMotion() || from === value || !isFinite(value)) { el.textContent = fmt(value); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 900);
      el.textContent = fmt(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
  }

  // ---------- Storage (IndexedDB, falls back to memory + localStorage) ----------
  const DB = (() => {
    let dbp = null;
    let memory = null;
    const LS_KEY = 'laufbuch.runs.fallback';
    function open() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          if (!('indexedDB' in window)) return rej(new Error('no idb'));
          const r = indexedDB.open('laufbuch', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('runs', { keyPath: 'id' });
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    }
    function useMemory() {
      if (!memory) {
        try { memory = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { memory = []; }
      }
      const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(memory.map(({ photo, ...r }) => r))); } catch {} };
      return {
        all: async () => memory.slice(),
        put: async (run) => { memory = memory.filter((r) => r.id !== run.id).concat(run); persist(); },
        del: async (id) => { memory = memory.filter((r) => r.id !== id); persist(); },
      };
    }
    async function tx(mode, fn) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('runs', mode);
        const req = fn(t.objectStore('runs'));
        t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }
    const wrap = (name, fn) => async (...a) => {
      try { return await fn(...a); } catch (e) { console.warn('IndexedDB unavailable, using fallback', e); return useMemory()[name](...a); }
    };
    return {
      all: wrap('all', () => tx('readonly', (st) => st.getAll())),
      put: wrap('put', (run) => tx('readwrite', (st) => st.put(run))),
      del: wrap('del', (id) => tx('readwrite', (st) => st.delete(id))),
    };
  })();

  // ---------- State ----------
  let runs = [];
  let prefs = { theme: null };
  let goals = [];
  const queue = []; // { id, file, el, form, status }

  function loadPrefs() {
    try { prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; } catch {}
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(GOAL_KEY)); } catch {}
    if (Array.isArray(stored)) goals = stored.filter((g) => g && G.METRICS.includes(g.metric) && g.target > 0);
    else if (prefs.goalKm) {
      // Migration: the former single weekly goal becomes a recurring weekly goal
      goals = [{ id: uid(), metric: 'km', target: prefs.goalKm, period: 'week', recurring: true, createdAt: Date.now() }];
      saveGoals();
    }
    delete prefs.goalKm;
  }
  function saveGoals() { try { localStorage.setItem(GOAL_KEY, JSON.stringify(goals)); } catch {} }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }
  const sortedRuns = () => runs.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  // ---------- Theme ----------
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = prefs.theme || (mq.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = t;
    $('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#211a25' : '#fff6ee');
  }
  mq.addEventListener?.('change', () => { if (!prefs.theme) { applyTheme(); renderOverview(); } });
  $('#themeToggle').addEventListener('click', () => {
    prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    savePrefs(); applyTheme(); renderOverview();
  });

  // ---------- Tabs ----------
  const TAB_HASH = { overview: '#uebersicht', add: '#erfassen', runs: '#einheiten' };
  function showTab(tab, push = true) {
    if (!TAB_HASH[tab]) tab = 'overview';
    $$('.tab-btn').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${tab}`));
    if (push && location.hash !== TAB_HASH[tab]) history.replaceState(null, '', TAB_HASH[tab]);
    if (tab === 'overview') renderOverview();
    window.scrollTo({ top: 0 });
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab-btn'); if (b) showTab(b.dataset.tab); });
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto); });
  window.addEventListener('hashchange', () => {
    const tab = Object.keys(TAB_HASH).find((k) => TAB_HASH[k] === location.hash);
    if (tab) showTab(tab, false);
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    $('#toastMsg').textContent = msg;
    const a = $('#toastAction');
    a.hidden = !action;
    a.onclick = null;
    if (action) { a.textContent = action.label; a.onclick = () => { action.fn(); t.classList.remove('show'); }; }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3000);
  }

  // ---------- Tooltip ----------
  const tip = $('#tooltip');
  function showTip(x, y, value, label) {
    tip.replaceChildren(h('strong', { text: value }), h('span', { text: label }));
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(x, w / 2 + 8), window.innerWidth - w / 2 - 8) + 'px';
    tip.style.top = Math.max(y, tip.offsetHeight + 20) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  window.addEventListener('scroll', hideTip, { passive: true });

  // ============================================================
  //  Statistics
  // ============================================================
  function stats() {
    const now = new Date();
    const thisMonday = mondayOf(now);
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(thisMonday); start.setDate(start.getDate() - i * 7);
      weeks.push({ start, key: P.iso(start), km: 0, count: 0, sec: 0 });
    }
    const byWeek = new Map(weeks.map((w) => [w.key, w]));
    const allWeeks = new Map();
    let totalKm = 0, totalSec = 0, paceKm = 0, paceSec = 0;
    const thisMonth = { km: 0 }, lastMonth = { km: 0 };
    const day = now.getDate();
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    for (const r of runs) {
      const d = parseISO(r.date);
      const wk = P.iso(mondayOf(d));
      const km = r.distanceKm || 0;
      totalKm += km;
      totalSec += r.durationSec || 0;
      if (r.distanceKm && r.durationSec) { paceKm += r.distanceKm; paceSec += r.durationSec; }
      const w = byWeek.get(wk);
      if (w) { w.km += km; w.count++; w.sec += r.durationSec || 0; }
      allWeeks.set(wk, (allWeeks.get(wk) || 0) + km);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth.km += km;
      if (d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth() && d.getDate() <= day) lastMonth.km += km;
    }

    // Streak: consecutive weeks with at least one run (current week may still be empty)
    let streak = 0;
    const cursor = new Date(thisMonday);
    if (!allWeeks.has(P.iso(cursor))) cursor.setDate(cursor.getDate() - 7);
    while (allWeeks.has(P.iso(cursor))) { streak++; cursor.setDate(cursor.getDate() - 7); }

    let bestWeek = null;
    for (const [k, v] of allWeeks) if (!bestWeek || v > bestWeek.km) bestWeek = { key: k, km: v };

    return {
      weeks, current: weeks[weeks.length - 1], totalKm, totalSec, count: runs.length,
      avgPace: paceKm ? paceSec / paceKm : null, streak, thisMonth, lastMonth, bestWeek,
    };
  }

  // ============================================================
  //  Overview
  // ============================================================
  function renderOverview() {
    const empty = runs.length === 0;
    $('#overviewEmpty').hidden = !empty;
    $('#overviewContent').hidden = empty;
    $('#demoBar').hidden = !runs.some((r) => r.demo) && !goals.some((g) => g.demo);
    const st = stats();
    renderHero(st);
    renderGoals(st);
    if (empty) return;

    // KPIs
    countTo($('#kpiKm'), st.totalKm, (v) => (st.totalKm >= 1000 ? nf0.format(v) : km1(v)));
    countTo($('#kpiRuns'), st.count, (v) => nf0.format(Math.round(v)));
    countTo($('#kpiTime'), st.totalSec, (v) => (st.totalSec >= 10 * 3600 ? `${nf1.format(v / 3600)} h` : fmtHours(v)));
    if (st.avgPace) countTo($('#kpiPace'), st.avgPace, (v) => P.formatPace(v));
    else $('#kpiPace').textContent = '–';

    renderWeekChart(st);
    renderPaceChart();
    renderRecords(st);

    const recent = $('#recentList');
    recent.replaceChildren(...sortedRuns().slice(0, 5).map((r) => runItem(r)));
  }

  function renderHero(st) {
    const hr = new Date().getHours();
    const [greet, emo] = hr < 5 || hr >= 22 ? ['Hallo, Nachteule!', '🌙'] : hr < 11 ? ['Guten Morgen!', '☀️'] : hr < 17 ? ['Hallo!', '👋'] : ['Guten Abend!', '🌇'];
    $('#heroTitle').textContent = `${greet} ${emo}`;
    const ranToday = runs.some((r) => r.date === todayISO());
    let sub;
    if (!runs.length) sub = 'Ich bin Flitzi! Zeig mir deinen ersten Lauf, dann legen wir zusammen los.';
    else if (ranToday) sub = 'Du warst heute schon laufen – ich bin richtig stolz auf dich! 💖';
    else if (st.streak >= 2) sub = `${st.streak} Wochen in Folge aktiv – bleib dran, du machst das toll!`;
    else sub = 'Schön, dass du da bist. Lust auf eine kleine Runde?';
    $('#heroSub').textContent = sub;
    setMascot($('.hero-mascot'), ranToday ? 'cheer' : 'run');
  }

  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * p;
  }

  function roundedTopBar(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    if (hgt <= 0) return '';
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }

  let animateCharts = true; // off while re-rendering on resize
  function renderWeekChart(st) {
    const box = $('#chartWeeks');
    box.classList.toggle('animate', animateCharts && !reducedMotion());
    const W = box.clientWidth || 480, H = box.clientHeight || 220;
    const m = { t: 18, r: 8, b: 24, l: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const goal = weeklyKmGoal();
    const maxKm = Math.max(...st.weeks.map((w) => w.km));
    const top = Math.max(maxKm, goal || 0, 5) * 1.08;
    const tick = niceMax(top / 4);
    const ticks = Math.max(2, Math.ceil(top / tick));
    const yMax = tick * ticks;
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const band = iw / st.weeks.length;
    const bw = Math.max(6, Math.min(36, band * 0.62));

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Wochenkilometer der letzten 12 Wochen' });
    const axis = s('g', { class: 'axis' });
    for (let i = 0; i <= ticks; i++) {
      const v = tick * i;
      if (i > 0) svg.append(s('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      const t = s('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = nf0.format(v);
      axis.append(t);
    }
    svg.append(axis);
    svg.append(s('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));

    const maxIdx = st.weeks.findIndex((w) => w.km === maxKm && maxKm > 0);
    const labelEvery = band < 30 ? 3 : band < 48 ? 2 : 1;
    st.weeks.forEach((w, i) => {
      const cx = m.l + band * i + band / 2;
      const x = cx - bw / 2;
      const isCur = i === st.weeks.length - 1;
      const end = new Date(w.start); end.setDate(end.getDate() + 6);
      const label = `KW ${isoWeek(w.start)} · ${w.start.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}–${end.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`;
      const value = `${km1(w.km)} km · ${w.count} ${w.count === 1 ? 'Lauf' : 'Läufe'}`;
      const hit = s('rect', { class: 'hit', x: m.l + band * i, y: m.t, width: band, height: ih, tabindex: 0, 'aria-label': `${label}: ${value}` });
      const onShow = () => { const r = hit.getBoundingClientRect(); showTip(r.left + r.width / 2, Math.min(r.top + (y(w.km) - m.t) * (r.height / ih), r.bottom - 10), value, label); };
      hit.addEventListener('pointerenter', onShow);
      hit.addEventListener('focus', onShow);
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
      svg.append(hit);
      svg.append(s('path', { class: 'bar' + (isCur ? ' current' : ''), d: roundedTopBar(x, y(w.km), bw, y(0) - y(w.km), Math.min(10, bw / 2)), style: `animation-delay:${i * 45}ms` }));
      if ((isCur || i === maxIdx) && w.km > 0) {
        const t = s('text', { class: 'bar-label', x: cx, y: y(w.km) - 6, 'text-anchor': 'middle' });
        t.textContent = km1(w.km);
        svg.append(t);
      }
      if ((st.weeks.length - 1 - i) % labelEvery === 0) {
        const t = s('text', { x: cx, y: H - 6, 'text-anchor': 'middle' });
        t.textContent = isCur ? 'Diese' : w.start.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
        axis.append(t);
      }
    });

    if (goal) {
      svg.append(s('line', { class: 'goal-line', x1: m.l, x2: W - m.r, y1: y(goal), y2: y(goal) }));
      const gl = s('text', { class: 'goal-label', x: m.l + 4, y: y(goal) - 5 });
      gl.textContent = `Ziel ${G.formatAmount('km', goal)}`;
      svg.append(gl);
    }
    box.replaceChildren(svg);
  }

  function renderPaceChart() {
    const box = $('#chartPace');
    const pts = runs.filter((r) => r.type !== 'Gehen' && pace(r) && pace(r) < 1200)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0))
      .slice(-20)
      .map((r) => ({ r, p: pace(r) }));
    const trendEl = $('#paceTrend');
    if (pts.length < 2) {
      trendEl.textContent = 'letzte 20 Läufe';
      box.replaceChildren(h('div', { class: 'chart-empty' }, h('i', { class: 'emo', text: '🐣' }),
        h('span', { text: 'Nach zwei Läufen zeige ich dir hier, wie du immer flotter wirst.' })));
      return;
    }
    box.classList.toggle('animate', animateCharts && !reducedMotion());
    const W = box.clientWidth || 480, H = box.clientHeight || 220;
    const m = { t: 14, r: 12, b: 24, l: 42 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let lo = Math.min(...pts.map((d) => d.p)), hi = Math.max(...pts.map((d) => d.p));
    const pad = Math.max(8, (hi - lo) * 0.12);
    const step = [10, 15, 20, 30, 60, 120, 300].find((st) => (hi - lo + 2 * pad) / st <= 5) || 600;
    lo = Math.floor((lo - pad) / step) * step; hi = Math.ceil((hi + pad) / step) * step;
    const x = (i) => m.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const y = (p) => m.t + ((p - lo) / (hi - lo)) * ih; // faster (smaller) = higher

    // Linear trend
    const n = pts.length;
    const mx = (n - 1) / 2, my = pts.reduce((a, d) => a + d.p, 0) / n;
    let num = 0, den = 0;
    pts.forEach((d, i) => { num += (i - mx) * (d.p - my); den += (i - mx) ** 2; });
    const slope = den ? num / den : 0;
    const t0 = my - slope * mx, t1 = my + slope * (n - 1 - mx);
    const change = Math.round(t1 - t0);
    trendEl.textContent = n < 3 ? `letzte ${n} Läufe` : change < -2 ? `Trend: ${Math.abs(change)} s/km schneller` : change > 2 ? `Trend: ${change} s/km langsamer` : 'Trend: stabil';

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Pace der letzten ${n} Läufe, oben ist schneller` });
    const axis = s('g', { class: 'axis' });
    const steps = Math.round((hi - lo) / step);
    for (let i = 0; i <= steps; i++) {
      const v = lo + step * i;
      svg.append(s('line', { class: i === steps ? 'baseline' : 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      const t = s('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = P.formatPace(v);
      axis.append(t);
    }
    [[0, 'start'], [n - 1, 'end']].forEach(([i, anchor]) => {
      const t = s('text', { x: x(i), y: H - 6, 'text-anchor': anchor });
      t.textContent = fmtDate(pts[i].r.date, { day: 'numeric', month: 'short' });
      axis.append(t);
    });
    const hint = s('text', { class: 'legend-inline', x: W - m.r, y: m.t - 2, 'text-anchor': 'end' });
    hint.textContent = '↑ schneller';
    svg.append(axis, hint);

    const path = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.p).toFixed(1)}`).join('');
    svg.append(s('path', { class: 'area', d: `${path}L${x(n - 1)},${y(hi)}L${x(0)},${y(hi)}Z` }));
    if (n >= 3) svg.append(s('line', { class: 'trend', x1: x(0), y1: y(t0), x2: x(n - 1), y2: y(t1) }));
    svg.append(s('path', { class: 'line', d: path, pathLength: 1 }));
    const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    svg.append(cross);
    const dots = pts.map((d, i) => { const c = s('circle', { class: 'dot', cx: x(i), cy: y(d.p), r: 4.5, style: `animation-delay:${200 + i * 45}ms` }); svg.append(c); return c; });

    // Crosshair + tooltip: nearest point to the pointer
    const overlay = s('rect', { class: 'hit', x: m.l - 10, y: 0, width: iw + 20, height: H, tabindex: 0, 'aria-label': 'Pace-Verlauf – mit Pfeiltasten durchgehen' });
    let active = n - 1;
    const activate = (i) => {
      active = i;
      dots.forEach((c, j) => c.classList.toggle('active', j === i));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      const d = pts[i];
      const rect = svg.getBoundingClientRect();
      const sx = rect.width / W, sy = rect.height / H;
      showTip(rect.left + x(i) * sx, rect.top + y(d.p) * sy, `${P.formatPace(d.p)} /km`,
        `${fmtDate(d.r.date)} · ${km2(d.r.distanceKm)} km`);
    };
    const clear = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((c) => c.classList.remove('active')); hideTip(); };
    overlay.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.round(((px - m.l) / iw) * (n - 1));
      activate(Math.max(0, Math.min(n - 1, i)));
    });
    overlay.addEventListener('pointerleave', clear);
    overlay.addEventListener('focus', () => activate(active));
    overlay.addEventListener('blur', clear);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { activate(Math.max(0, active - 1)); e.preventDefault(); }
      if (e.key === 'ArrowRight') { activate(Math.min(n - 1, active + 1)); e.preventDefault(); }
    });
    svg.append(overlay);
    box.replaceChildren(svg);
  }

  function renderRecords(st) {
    const list = runs.filter((r) => r.type !== 'Gehen');
    const by = (fn, filter = () => true) => list.filter(filter).reduce((b, r) => (fn(r) != null && (!b || fn(r) > fn(b)) ? r : b), null);
    const longest = by((r) => r.distanceKm);
    const minDist = list.some((r) => r.distanceKm >= 3 && pace(r)) ? 3 : 0;
    const fastest = by((r) => (pace(r) ? -pace(r) : null), (r) => r.distanceKm >= minDist);
    const longestTime = by((r) => r.durationSec || null);
    const items = [
      longest && ['🏅 Längster Lauf', km2(longest.distanceKm), 'km', fmtDate(longest.date, { day: 'numeric', month: 'short', year: 'numeric' })],
      fastest && [`🚀 Schnellste Pace${minDist ? ' (ab 3 km)' : ''}`, P.formatPace(pace(fastest)), '/km', `${km2(fastest.distanceKm)} km · ${fmtDate(fastest.date, { day: 'numeric', month: 'short', year: 'numeric' })}`],
      longestTime && ['⏳ Längste Dauer', P.formatDuration(longestTime.durationSec), '', fmtDate(longestTime.date, { day: 'numeric', month: 'short', year: 'numeric' })],
      st.bestWeek && ['💪 Stärkste Woche', km1(st.bestWeek.km), 'km', `KW ${isoWeek(parseISO(st.bestWeek.key))} · ${parseISO(st.bestWeek.key).getFullYear()}`],
    ].filter(Boolean);
    $('#records').replaceChildren(...items.map(([label, value, unit, date]) =>
      h('div', { class: 'record' },
        h('div', { class: 'record-label', text: label }),
        h('div', { class: 'record-value' }, value, unit ? h('small', { text: unit }) : null),
        h('div', { class: 'record-date', text: date }))));
  }

  // ============================================================
  //  Run list
  // ============================================================
  const TYPE_EMOJI = { Lauf: '🏃', Intervall: '⚡', Trail: '🌲', Laufband: '🏠', Wettkampf: '🏅', Gehen: '🚶' };
  const runPhotos = (r) => (r.photos && r.photos.length ? r.photos : r.photo ? [r.photo] : []);
  function runItem(r) {
    const p = pace(r);
    const pics = runPhotos(r);
    const thumb = pics.length
      ? h('span', { class: 'run-thumb-wrap' }, h('img', { class: 'run-thumb', src: pics[0], alt: '', loading: 'lazy' }),
        pics.length > 1 ? h('span', { class: 'run-thumb-count', text: pics.length, title: `${pics.length} Fotos` }) : null)
      : h('div', { class: 'run-thumb', 'data-type': r.type || 'Lauf', 'aria-hidden': 'true', text: parseISO(r.date).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') });
    const meta = [
      r.durationSec ? P.formatDuration(r.durationSec) : null,
      p ? `${P.formatPace(p)} /km` : null,
      r.avgHr ? `♥ ${r.avgHr}` : null,
      r.strain != null ? `Strain ${nfStrain.format(r.strain)}` : null,
      r.elevationM ? `↗ ${r.elevationM} m` : null,
    ].filter(Boolean);
    return h('li', {},
      h('button', { class: 'run-item', type: 'button', onclick: () => openEdit(r.id) },
        thumb,
        h('div', { class: 'run-main' },
          h('div', { class: 'run-title', text: `${TYPE_EMOJI[r.type] || '🏃'} ${r.type || 'Lauf'} · ${fmtDate(r.date)}${r.startTime ? ', ' + r.startTime : ''}${r.note ? ' · ' + r.note : ''}` }),
          h('div', { class: 'run-meta' }, ...meta.map((t) => h('span', { text: t })))),
        h('div', { class: 'run-km' }, km2(r.distanceKm), h('small', { text: 'km' }))));
  }

  function renderRuns() {
    const list = sortedRuns();
    $('#runsEmpty').hidden = list.length > 0;
    $$('.runs-tools .btn').slice(0, 2).forEach((b) => (b.disabled = !list.length));
    const groups = new Map();
    for (const r of list) {
      const k = r.date.slice(0, 7);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    $('#runGroups').replaceChildren(...[...groups].map(([k, rs]) => {
      const kmSum = rs.reduce((a, r) => a + (r.distanceKm || 0), 0);
      const secSum = rs.reduce((a, r) => a + (r.durationSec || 0), 0);
      const title = parseISO(k + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      return h('section', { class: 'month-group' },
        h('div', { class: 'month-head' },
          h('h2', { text: title }),
          h('span', { text: `${rs.length} ${rs.length === 1 ? 'Lauf' : 'Läufe'} · ${km1(kmSum)} km · ${fmtHours(secSum)}` })),
        h('div', { class: 'card' }, h('ul', { class: 'run-list' }, ...rs.map(runItem))));
    }));
  }

  function renderAll() { renderOverview(); renderRuns(); }

  // ---------- Demo data ----------
  function demoRuns() {
    const out = [];
    const now = new Date();
    let paceBase = 352; // gets faster over time
    for (let i = 84; i >= 1; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const wd = d.getDay();
      if (![2, 4, 6, 0].includes(wd) || (wd === 4 && i % 3 === 0)) continue;
      const long = wd === 0;
      const interval = wd === 4;
      const km = Math.round((long ? 11 + (84 - i) / 14 : interval ? 6.2 : 5 + ((i * 7) % 20) / 10) * 100) / 100;
      const p = paceBase + (long ? 25 : interval ? -22 : 0) + ((i * 13) % 17) - 8;
      paceBase -= 1.1;
      out.push({
        id: 'demo-' + i, demo: true, date: P.iso(d), type: interval ? 'Intervall' : 'Lauf',
        distanceKm: km, durationSec: Math.round(km * p), avgHr: Math.round(long ? 148 : interval ? 162 : 152 - (84 - i) / 12),
        calories: Math.round(km * 68), elevationM: Math.round(km * (6 + (i % 5))), cadence: 166 + (i % 7), createdAt: d.getTime(),
      });
    }
    return out;
  }
  $('#demoBtn').addEventListener('click', async () => {
    for (const r of demoRuns()) await DB.put(r);
    runs = await DB.all();
    if (!goals.length) {
      const now = new Date();
      ['25 km pro Woche', '10 km heute', '120 km diesen Monat', 'Halbmarathon bis 31.12.'].forEach((t) =>
        goals.push({ id: uid(), demo: true, ...G.finalize(G.parseGoalText(t, now), now), createdAt: Date.now() }));
      saveGoals();
    }
    renderAll();
  });
  $('#demoRemove').addEventListener('click', async () => {
    for (const r of runs.filter((x) => x.demo)) await DB.del(r.id);
    runs = await DB.all();
    goals = goals.filter((g) => !g.demo);
    saveGoals();
    renderAll();
    toast('Beispieldaten entfernt');
  });

  // ============================================================
  //  Run form
  // ============================================================
  const FIELD_KEYS = ['date', 'type', 'distanceKm', 'durationSec', 'avgHr', 'maxHr', 'calories', 'elevationM', 'cadence', 'strain', 'note'];
  const INT_FIELDS = { avgHr: [30, 250], maxHr: [30, 250], calories: [0, 20000], elevationM: [0, 9000], cadence: [40, 260] };
  const AUTO_FIELDS = ['date', 'distanceKm', 'durationSec', 'avgHr', 'maxHr', 'calories', 'elevationM', 'cadence', 'strain'];
  const nfStrain = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /**
   * The run form. `fill()` lets photo recognition (re)write values – but never a field the
   * person has typed into, and never a value that was already there when editing a saved run.
   */
  function createRunForm(values = {}, sources = {}) {
    const form = $('#runFormTpl').content.firstElementChild.cloneNode(true);
    const f = form.elements;
    const src = {};          // where each value came from: 'ocr' | 'calc' | 'auto' (date default) | undefined (user/saved)
    const touched = new Set();
    f.date.max = todayISO();

    const badge = (name, s) => {
      const field = (f[name] || form.querySelector(`[name="${name}"]`)).closest('.field');
      const i = field.querySelector('.src');
      if (!i) return;
      i.className = 'src' + (s === 'ocr' || s === 'calc' ? ' ' + s : '');
      i.textContent = s === 'ocr' ? 'erkannt' : s === 'calc' ? 'berechnet' : '';
      i.title = s === 'ocr' ? 'Automatisch aus dem Foto gelesen' : s === 'calc' ? 'Aus anderen Werten berechnet' : '';
      field.classList.toggle('is-ocr', s === 'ocr');
    };
    const display = (k, v) => {
      if (v == null || v === '') return '';
      if (k === 'distanceKm') return String(v).replace('.', ',');
      if (k === 'durationSec') return P.formatDuration(v);
      if (k === 'strain') return nfStrain.format(v);
      return String(v);
    };
    const setField = (k, v, s) => {
      f[k].value = display(k, v);
      src[k] = s;
      badge(k, s);
      f[k].closest('.field').classList.remove('is-invalid');
      if (s === 'ocr' || s === 'calc') {
        const field = f[k].closest('.field');
        field.classList.remove('just-filled'); void field.offsetWidth; field.classList.add('just-filled');
      }
    };

    // initial values
    f.date.value = values.date || todayISO();
    src.date = values.date ? sources.date : 'auto';
    badge('date', src.date);
    f.type.value = values.type || 'Lauf';
    for (const k of AUTO_FIELDS) if (k !== 'date' && values[k] != null) { f[k].value = display(k, values[k]); src[k] = sources[k]; badge(k, sources[k]); }
    if (values.note) f.note.value = values.note;
    let ocrPace = sources.paceSecPerKm === 'ocr' ? values.paceSecPerKm : null;

    const updatePace = () => {
      const d = parseFloat(f.distanceKm.value.replace(',', '.'));
      const t = P.parseDuration(f.durationSec.value);
      if (d > 0 && t > 0) {
        f.pace.value = `${P.formatPace(t / d)} /km`;
        badge('pace', ocrPace && Math.abs(t / d - ocrPace) / ocrPace < 0.03 ? 'ocr' : 'calc');
      } else {
        f.pace.value = '–';
        badge('pace', '');
      }
    };
    updatePace();

    form.addEventListener('input', (e) => {
      const name = e.target.name;
      if (!name) return;
      touched.add(name);
      if (AUTO_FIELDS.includes(name)) { src[name] = undefined; badge(name, ''); }
      e.target.closest('.field')?.classList.remove('is-invalid');
      if (name === 'distanceKm' || name === 'durationSec') updatePace();
    });

    /** Apply recognised values; returns how many fields changed. */
    function fill(vals, srcs = {}) {
      let n = 0;
      for (const k of AUTO_FIELDS) {
        if (vals[k] == null || touched.has(k)) continue;
        const cur = f[k].value.trim();
        const replaceable = !cur || src[k] === 'ocr' || src[k] === 'calc' || src[k] === 'auto';
        if (!replaceable) continue;
        const s = srcs[k] || 'ocr';
        if (cur === display(k, vals[k]) && src[k] === s) continue;
        setField(k, vals[k], s);
        n++;
      }
      if (vals.type && vals.type !== 'Lauf' && !touched.has('type') && f.type.value === 'Lauf') f.type.value = vals.type;
      if (srcs.paceSecPerKm === 'ocr') ocrPace = vals.paceSecPerKm;
      updatePace();
      return n;
    }

    function read() {
      const err = [];
      const out = { date: f.date.value, type: f.type.value, note: f.note.value.trim() || undefined };
      const mark = (name) => f[name].closest('.field').classList.add('is-invalid');
      if (!out.date) { err.push('Datum fehlt'); mark('date'); }
      const d = parseFloat(f.distanceKm.value.replace(',', '.'));
      if (!(d >= 0.05 && d <= 400)) { err.push('Bitte eine gültige Distanz in km angeben'); mark('distanceKm'); } else out.distanceKm = Math.round(d * 100) / 100;
      const t = P.parseDuration(f.durationSec.value);
      if (!(t >= 30 && t <= 72 * 3600)) { err.push('Bitte die Dauer angeben (z. B. 45:30 oder 1:02:10)'); mark('durationSec'); } else out.durationSec = t;
      for (const [k, [lo, hi]] of Object.entries(INT_FIELDS)) {
        const raw = f[k].value.trim().replace(/[.\s]/g, '');
        if (!raw) continue;
        const v = parseInt(raw, 10);
        if (!(v >= lo && v <= hi)) { err.push(`Wert für „${f[k].closest('.field').querySelector('.field-label').firstChild.textContent.trim()}“ prüfen`); mark(k); } else out[k] = v;
      }
      const sr = f.strain.value.trim();
      if (sr) {
        const v = parseFloat(sr.replace(',', '.'));
        if (!(v >= 0 && v <= 21)) { err.push('Strain liegt zwischen 0 und 21'); mark('strain'); } else out.strain = Math.round(v * 10) / 10;
      }
      const box = form.querySelector('.form-error');
      box.hidden = !err.length;
      box.textContent = err.join(' · ');
      return err.length ? null : out;
    }
    form.addEventListener('submit', (e) => e.preventDefault());
    return { form, read, fill, actions: form.querySelector('.form-actions'), zonesBox: form.querySelector('.zones-box') };
  }

  // Heart-rate zones: ordinal, so one hue from light (easy) to dark (hard); every segment is also labelled.
  const ZONE_COLORS = ['#f3e3e8', '#fcc6d4', '#f79ab3', '#ea7094', '#d23c69', '#9e2449'];
  function renderZones(box, zones) {
    const list = (zones || []).filter((z) => (z.pct || 0) > 0 || (z.sec || 0) > 0);
    box.hidden = !list.length;
    if (!list.length) { box.replaceChildren(); return; }
    const total = list.reduce((a, z) => a + (z.pct != null ? z.pct : 0), 0) || 100;
    const bar = h('div', { class: 'zone-bar', role: 'img', 'aria-label': 'Zeit in Herzfrequenzzonen' });
    const legend = h('ul', { class: 'zone-legend' });
    for (const z of list.slice().sort((a, b) => b.zone - a.zone)) {
      const pct = z.pct != null ? z.pct : 0;
      const label = `Zone ${z.zone}`;
      const val = [z.sec != null ? P.formatDuration(z.sec) : null, z.pct != null ? `${nf0.format(z.pct)} %` : null].filter(Boolean).join(' · ');
      legend.append(h('li', {}, h('i', { style: `background:${ZONE_COLORS[z.zone]}` }), h('span', { class: 'zl', text: label }), h('span', { class: 'zv', text: val })));
    }
    for (const z of list.slice().sort((a, b) => a.zone - b.zone)) {
      if (!(z.pct > 0)) continue;
      const seg = h('span', { style: `width:${(z.pct / total) * 100}%;background:${ZONE_COLORS[z.zone]}`, title: `Zone ${z.zone}: ${nf0.format(z.pct)} %` });
      if (z.pct >= 9) seg.textContent = z.zone;
      bar.append(seg);
    }
    box.replaceChildren(h('div', { class: 'field-label', text: 'Herzfrequenzzonen' }), bar, legend);
  }

  // ============================================================
  //  Edit dialog
  // ============================================================
  const dlg = $('#editDialog');
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

  function openEdit(id) {
    const r = runs.find((x) => x.id === id);
    if (!r) return;
    $('#editTitle').textContent = 'Einheit bearbeiten';
    const ed = createEditor({ run: r });
    ed.actions.append(
      h('button', { class: 'btn btn-primary', type: 'submit', text: 'Speichern', onclick: async () => {
        if (ed.busy()) return toast('Einen Moment – Flitzi liest noch 📖');
        const updated = ed.build(r);
        if (!updated) return;
        const reached = await saveRun(updated);
        dlg.close();
        if (reached.length) celebrate('Juhu, geschafft!', G.describe(reached[0]), ' – Ziel erreicht!');
        else toast('Gespeichert ✨');
      } }),
      h('button', { class: 'btn', type: 'button', text: 'Abbrechen', onclick: () => dlg.close() }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-danger', type: 'button', text: 'Löschen', onclick: async () => {
        dlg.close();
        await deleteRun(r.id);
        toast('Einheit gelöscht', { label: 'Rückgängig', fn: () => saveRun(r) });
      } }));
    $('#editBody').replaceChildren(ed.el);
    openEditor = ed;
    dlg.showModal();
  }
  let openEditor = null;
  dlg.addEventListener('close', () => { openEditor = null; });

  // ============================================================
  //  Goals
  // ============================================================
  const PERIOD_ORDER = { day: 0, week: 1, month: 2, year: 3, custom: 4 };
  const CHIP_GOALS = ['10 km heute', '30 km diese Woche', '3 Läufe pro Woche', '100 km diesen Monat', 'Halbmarathon bis 31.12.'];

  function currentGoals() {
    const t = todayISO();
    return goals.filter((g) => g.recurring || !g.end || g.end >= t);
  }
  function pastGoals() {
    const t = todayISO();
    return goals.filter((g) => !g.recurring && g.end && g.end < t).sort((a, b) => b.end.localeCompare(a.end));
  }
  /** Weekly km goal for the chart's goal line (recurring, or one-off for this week). */
  function weeklyKmGoal() {
    const wk = G.periodRange('week');
    const g = goals.find((x) => x.metric === 'km' && x.period === 'week' && (x.recurring || x.start === wk.start));
    return g ? g.target : null;
  }
  function amount(metric, v, unit = true) {
    if (metric === 'single' || metric === 'km') return G.formatAmount('km', Math.round(v * 10) / 10, { unit });
    return G.formatAmount(metric, v, { unit });
  }
  function shortValue(metric, v) {
    if (metric === 'time') { const min = Math.round(v / 60); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; }
    return amount(metric, v, false);
  }

  function addGoal(draft, extra = {}) {
    const g = { id: uid(), ...G.finalize(draft), createdAt: Date.now(), ...extra };
    goals.push(g);
    saveGoals();
    renderOverview();
    return g;
  }
  function removeGoal(id) {
    goals = goals.filter((g) => g.id !== id);
    saveGoals();
    renderOverview();
  }

  function goalCard(g, p) {
    const { status } = p;
    const pct = Math.floor(p.pct * 100);
    let meta;
    let plan = null;
    if (status === 'done') {
      meta = p.isCurrent ? 'Geschafft – du bist super! 🎉' : `Erreicht mit ${amount(g.metric, p.value)}`;
    } else if (status === 'upcoming') {
      const tm = new Date(); tm.setDate(tm.getDate() + 1);
      meta = `startet ${p.range.start === P.iso(tm) ? 'morgen' : 'am ' + fmtDate(p.range.start, { day: 'numeric', month: 'short' })}`;
    } else if (status === 'missed') {
      meta = `Nicht erreicht – ${amount(g.metric, p.value)} von ${amount(g.metric, g.target)}`;
    } else {
      const parts = [];
      if (g.metric === 'single') parts.push(p.value ? `längster Lauf bisher ${amount('km', p.value)}` : 'noch kein passender Lauf');
      else parts.push(`noch ${amount(g.metric, p.remaining)}`);
      parts.push(p.daysLeft === 1 ? 'nur noch heute' : `${p.daysLeft} Tage übrig`);
      if (p.perDay) parts.push(`≈ ${amount(g.metric, p.perDay)}/Tag`);
      meta = parts.join(' · ');
      if (p.totalDays > 1 && g.metric !== 'single') {
        const diff = p.value - p.expected;
        if (Math.abs(diff) <= g.target * 0.03) plan = ['👍 Voll im Plan', ''];
        else if (diff > 0) plan = [`🚀 ${amount(g.metric, diff)} vor Plan`, 'ahead'];
        else plan = [`${amount(g.metric, -diff)} hinter Plan – du packst das! 💪`, 'behind'];
      }
    }
    const showMarker = status === 'active' && p.totalDays > 1 && g.metric !== 'single';
    const ico = { km: '🛣️', runs: '👟', time: '⏱️', single: '🏅' }[g.metric];
    return h('button', { class: `goal is-${status}`, 'data-metric': g.metric, type: 'button', onclick: () => openGoal(g.id) },
      h('div', { class: 'goal-head' }, h('span', { class: 'goal-ico emo', 'aria-hidden': 'true', text: ico }), h('span', { class: 'goal-title', text: G.describe(g) })),
      h('div', { class: 'goal-value' },
        h('strong', { text: shortValue(g.metric, p.value) }),
        h('span', { class: 'goal-of', text: `/ ${amount(g.metric, g.target)}` }),
        h('span', { class: 'goal-pct', text: status === 'done' ? '✓' : `${pct} %` })),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': G.describe(g), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
        h('span', { style: `width:${p.pct * 100}%` }),
        showMarker ? h('i', { class: 'expected', style: `left:${p.elapsedPct * 100}%`, title: 'Soll-Stand zu Beginn des heutigen Tages' }) : null),
      h('div', { class: 'goal-meta', text: meta }),
      plan ? h('div', { class: 'goal-plan ' + plan[1], text: plan[0] }) : null);
  }

  function renderGoals(st) {
    const cur = currentGoals().map((g) => ({ g, p: G.progress(g, runs) })).sort((a, b) =>
      (a.p.status === 'upcoming') - (b.p.status === 'upcoming') ||
      PERIOD_ORDER[a.g.period] - PERIOD_ORDER[b.g.period] ||
      a.p.range.end.localeCompare(b.p.range.end));
    $('#goalList').replaceChildren(...cur.map(({ g, p }) => goalCard(g, p)));
    $('#goalList').hidden = !cur.length;
    $('#goalEmpty').hidden = cur.length > 0;
    if (!cur.length) {
      $('#goalChips').replaceChildren(...CHIP_GOALS.map((t) => h('button', { class: 'chip', type: 'button', text: '+ ' + t, onclick: () => {
        const g = addGoal(G.parseGoalText(t, new Date()));
        toast(`Ziel gesetzt: ${G.describe(g)} 🎯`, { label: 'Rückgängig', fn: () => removeGoal(g.id) });
      } })));
    }

    const past = pastGoals();
    $('#pastGoals').hidden = !past.length;
    $('#pastCount').textContent = `(${past.length})`;
    $('#pastGoalList').replaceChildren(...past.slice(0, 20).map((g) => {
      const p = G.progress(g, runs);
      const ok = p.status === 'done';
      return h('li', {}, h('button', { type: 'button', onclick: () => openGoal(g.id) },
        h('span', { class: 'mark ' + (ok ? 'ok' : 'no'), text: ok ? '✓' : '–', title: ok ? 'erreicht' : 'nicht erreicht' }),
        h('span', { class: 'past-title', text: G.describe(g) }),
        h('span', { class: 'past-val', text: `${amount(g.metric, p.value)} / ${amount(g.metric, g.target)}` })));
    }));

    $('#streakPill').textContent = st.streak >= 2 ? `🔥 ${st.streak} Wochen in Folge aktiv` : '';
    let mt = '';
    if (runs.length) {
      mt = `📅 ${new Date().toLocaleDateString('de-DE', { month: 'long' })}: ${km1(st.thisMonth.km)} km`;
      if (st.lastMonth.km > 0) {
        const diff = Math.round(((st.thisMonth.km - st.lastMonth.km) / st.lastMonth.km) * 100);
        mt += ` · ${diff >= 0 ? '+' : '−'}${Math.abs(diff)} % zum Vormonat`;
      }
    }
    $('#monthPill').textContent = mt;
  }

  function openGoal(id, presetText) {
    const existing = id ? goals.find((g) => g.id === id) : null;
    $('#editTitle').textContent = existing ? 'Ziel bearbeiten' : 'Neues Ziel';
    let draftStart = existing ? existing.start || null : null;
    const HINT = 'Schreib einfach, was du vorhast – oder stell es unten ein.';

    const nl = h('input', { type: 'text', placeholder: 'z. B. 60 km diese Woche', autocomplete: 'off', enterkeyhint: 'done' });
    const preview = h('div', { class: 'nl-preview', 'aria-live': 'polite', text: HINT });
    const metric = h('select', {}, ...[['km', 'Kilometer'], ['runs', 'Anzahl Läufe'], ['time', 'Laufzeit'], ['single', 'Einzellauf']]
      .map(([v, t]) => h('option', { value: v, text: t })));
    const target = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: '0' });
    const unit = h('span', { class: 'unit-suffix' });
    const period = h('select', {}, ...[['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr'], ['custom', 'Bis zu einem Datum']]
      .map(([v, t]) => h('option', { value: v, text: t })));
    const endDate = h('input', { type: 'date', min: todayISO() });
    const endField = h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Bis einschließlich' }), endDate);
    const recurring = h('input', { type: 'checkbox' });
    const recurringText = h('span');
    const recurringLabel = h('label', { class: 'check' }, recurring, recurringText);
    const err = h('div', { class: 'form-error', hidden: true });

    const read = () => {
      const t = parseFloat(String(target.value).replace(',', '.'));
      if (!(t > 0)) return null;
      const d = {
        metric: metric.value,
        target: metric.value === 'time' ? Math.round(t * 3600) : metric.value === 'runs' ? Math.max(1, Math.round(t)) : Math.round(t * 100) / 100,
        period: period.value,
        recurring: recurring.checked,
      };
      if (d.period === 'custom') {
        if (!endDate.value) return null;
        d.start = draftStart && draftStart <= endDate.value ? draftStart : todayISO();
        d.end = endDate.value;
      } else if (draftStart && !d.recurring) d.start = draftStart;
      return d;
    };
    const sync = () => {
      unit.textContent = { km: 'km', runs: 'Läufe', time: 'Std.', single: 'km' }[metric.value];
      target.step = metric.value === 'runs' ? '1' : metric.value === 'time' ? '0.25' : 'any';
      endField.hidden = period.value !== 'custom';
      recurringLabel.hidden = period.value === 'custom';
      recurringText.textContent = { day: 'Jeden Tag wiederholen', week: 'Jede Woche wiederholen', month: 'Jeden Monat wiederholen', year: 'Jedes Jahr wiederholen' }[period.value] || '';
      if (!nl.value.trim()) {
        const d = read();
        preview.className = 'nl-preview' + (d ? ' ok' : '');
        preview.textContent = d ? '→ ' + G.describe(G.finalize(d)) : HINT;
      }
    };
    const fill = (d) => {
      metric.value = d.metric;
      target.value = d.target ? (d.metric === 'time' ? +(d.target / 3600).toFixed(2) : d.target) : '';
      period.value = d.period;
      recurring.checked = !!d.recurring;
      endDate.value = d.end || '';
      draftStart = d.start || null;
      sync();
    };

    nl.addEventListener('input', () => {
      err.hidden = true;
      const d = G.parseGoalText(nl.value, new Date());
      if (d) {
        fill(d);
        preview.className = 'nl-preview ok';
        preview.textContent = '→ ' + G.describe(G.finalize(d));
      } else {
        preview.className = 'nl-preview';
        preview.textContent = nl.value.trim() ? 'Noch nicht verstanden – z. B. „10 km heute“ oder „3 Läufe pro Woche“.' : HINT;
      }
    });
    [metric, target, period, recurring, endDate].forEach((el) => el.addEventListener(el === target ? 'input' : 'change', () => {
      err.hidden = true;
      if (el === period) draftStart = null;
      nl.value = '';
      sync();
    }));

    const form = h('form', { class: 'run-form goal-form', novalidate: true },
      h('label', { class: 'field nl' }, h('span', { class: 'field-label', text: 'Dein Ziel in eigenen Worten' }), nl, preview),
      h('div', { class: 'divider', text: 'oder genau einstellen' }),
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Was' }), metric),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Ziel' }), h('div', { class: 'unit-wrap' }, target, unit)),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Zeitraum' }), period),
        endField),
      recurringLabel,
      err,
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn btn-primary', type: 'submit', text: existing ? 'Speichern' : 'Ziel setzen' }),
        h('button', { class: 'btn', type: 'button', text: 'Abbrechen', onclick: () => dlg.close() }),
        existing ? h('span', { class: 'spacer' }) : null,
        existing ? h('button', { class: 'btn btn-danger', type: 'button', text: 'Löschen', onclick: () => {
          dlg.close();
          const backup = existing;
          removeGoal(existing.id);
          toast('Ziel gelöscht', { label: 'Rückgängig', fn: () => { goals.push(backup); saveGoals(); renderOverview(); } });
        } }) : null));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = read();
      if (!d) {
        err.hidden = false;
        err.textContent = period.value === 'custom' && !endDate.value ? 'Bitte ein Enddatum wählen.' : 'Bitte einen Zielwert eingeben.';
        return;
      }
      if (existing) {
        const i = goals.findIndex((g) => g.id === existing.id);
        goals[i] = { id: existing.id, createdAt: existing.createdAt, ...(existing.demo ? { demo: true } : {}), ...G.finalize(d) };
        saveGoals();
        renderOverview();
        toast('Ziel aktualisiert');
      } else {
        const g = addGoal(d);
        toast(`Ziel gesetzt: ${G.describe(g)} 🎯`);
      }
      dlg.close();
    });

    fill(existing || { metric: 'km', target: null, period: 'week', recurring: false });
    $('#editBody').replaceChildren(form);
    dlg.showModal();
    if (presetText) { nl.value = presetText; nl.dispatchEvent(new Event('input')); }
    if (!existing) nl.focus();
  }

  $('#addGoalBtn').addEventListener('click', () => openGoal(null));

  /** Toast after saving a run: celebrate reached goals, otherwise show what's left. */
  function runSavedToast(run, reached) {
    const go = { label: 'Ansehen', fn: () => showTab('overview') };
    if (reached.length) return celebrate('Juhu, geschafft!', G.describe(reached[0]), reached.length > 1 ? ` und ${reached.length - 1} weiteres Ziel erreicht` : ' – Ziel erreicht!');
    const next = currentGoals().map((g) => ({ g, p: G.progress(g, runs) }))
      .filter(({ g, p }) => p.status === 'active' && g.metric !== 'single' && run.date >= p.range.start && run.date <= p.range.end)
      .sort((a, b) => a.p.remaining / a.g.target - b.p.remaining / b.g.target)[0];
    toast(`Super, ${km2(run.distanceKm)} km gespeichert! 👟` + (next ? ` · noch ${amount(next.g.metric, next.p.remaining)} bis „${G.describe(next.g)}“` : ''), go);
  }

  // ============================================================
  //  Persistence actions
  // ============================================================
  /** Saves a run; returns the goals this run has just completed. */
  async function saveRun(run) {
    const doneBefore = new Set(currentGoals().filter((g) => G.progress(g, runs).status === 'done').map((g) => g.id));
    await DB.put(run);
    runs = runs.filter((r) => r.id !== run.id).concat(run);
    renderAll();
    return currentGoals().filter((g) => !doneBefore.has(g.id) && G.progress(g, runs).status === 'done');
  }
  async function deleteRun(id) {
    await DB.del(id);
    runs = runs.filter((r) => r.id !== id);
    renderAll();
  }

  // ============================================================
  //  Photo intake & OCR
  // ============================================================
  let tesseractPromise = null;
  let workerPromise = null;
  let ocrChain = Promise.resolve();
  let currentLogger = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractPromise) {
      tesseractPromise = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = TESSERACT_URL;
        sc.crossOrigin = 'anonymous';
        sc.onload = () => res(window.Tesseract);
        sc.onerror = () => { tesseractPromise = null; rej(new Error('Texterkennung konnte nicht geladen werden. Bist du online?')); };
        document.head.append(sc);
      });
    }
    return tesseractPromise;
  }
  function getWorker() {
    if (!workerPromise) {
      workerPromise = loadTesseract()
        .then((T) => T.createWorker(['deu', 'eng'], 1, { logger: (m) => currentLogger && currentLogger(m) }))
        .then(async (w) => { await w.setParameters({ preserve_interword_spaces: '1' }); return w; })
        .catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  /**
   * OCR one prepared image (one worker, jobs run one after another).
   * Returns several readings of the same picture – the parser keeps, per value, the reading it
   * trusts most:
   *  1. automatic page layout (PSM 3)
   *  2. sparse text (PSM 11) – finds lone numbers inside rings and tiles
   *  3. tiles rebuilt from word positions ("AVG HR" above "152" → "AVG HR 152")
   */
  function recognize(canvas, onProgress) {
    const job = ocrChain.then(async () => {
      currentLogger = (m) => onProgress(m);
      try {
        const w = await getWorker();
        const out = { text: true, blocks: true, hocr: false, tsv: false };
        await w.setParameters({ tessedit_pageseg_mode: '3' });
        const a = await w.recognize(canvas, {}, out);
        onProgress({ status: 'second pass', progress: 0 });
        await w.setParameters({ tessedit_pageseg_mode: '11' });
        const b = await w.recognize(canvas, {}, out);
        const tiles = [P.cellsToLines(a.data.words), P.cellsToLines(b.data.words)].filter(Boolean).join('\n');
        return [a.data.text, b.data.text, tiles].filter((t) => t && t.trim());
      } finally { currentLogger = null; }
    });
    ocrChain = job.catch(() => {});
    return job;
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function drawScaled(img, maxDim, minWidth = 0) {
    let w = img.naturalWidth, hgt = img.naturalHeight;
    let scale = Math.min(1, maxDim / Math.max(w, hgt));
    if (minWidth && w * scale < minWidth) scale = Math.min(3, minWidth / w);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(hgt * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  /**
   * Make text black on white for the OCR.
   * Apps like WHOOP show coloured numbers (blue strain, green/red zones) on near-black: plain
   * grey-scaling turns a bright blue into dark grey. So on dark backgrounds we take the
   * brightest channel (any coloured text becomes bright) and invert; on light backgrounds the
   * darkest channel (coloured text becomes dark). Then stretch the contrast.
   */
  function prepareForOcr(img) {
    const c = drawScaled(img, 2600, 1100);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const px = id.data;
    const total = px.length / 4;
    let lum = 0;
    for (let i = 0; i < px.length; i += 16) lum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const dark = lum / (total / 4) < 110;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const v = dark ? Math.max(r, g, b) : Math.min(r, g, b);
      px[i] = v; hist[v]++;
    }
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    const range = Math.max(40, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      let v = ((px[i] - lo) * 255) / range;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (dark) v = 255 - v;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  /** Minimal EXIF reader: DateTimeOriginal from JPEG photos (screenshots usually have none). */
  async function exifDate(file) {
    try {
      if (!/jpe?g/i.test(file.type)) return null;
      const buf = await file.slice(0, 128 * 1024).arrayBuffer();
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xffd8) return null;
      let off = 2;
      while (off + 4 < v.byteLength) {
        const marker = v.getUint16(off);
        const len = v.getUint16(off + 2);
        if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
          const tiff = off + 10;
          const le = v.getUint16(tiff) === 0x4949;
          const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
          const readStr = (o, n) => { let str = ''; for (let i = 0; i < n - 1; i++) str += String.fromCharCode(v.getUint8(o + i)); return str; };
          const scan = (ifd, tags) => {
            const n = u16(ifd); const found = {};
            for (let i = 0; i < n; i++) {
              const e = ifd + 2 + i * 12; const tag = u16(e);
              if (tags.includes(tag)) found[tag] = e;
            }
            return found;
          };
          const ifd0 = tiff + u32(tiff + 4);
          const t0 = scan(ifd0, [0x8769, 0x0132]);
          let dt = null;
          if (t0[0x8769]) {
            const exif = tiff + u32(t0[0x8769] + 8);
            const t1 = scan(exif, [0x9003]);
            if (t1[0x9003]) dt = readStr(tiff + u32(t1[0x9003] + 8), 20);
          }
          if (!dt && t0[0x0132]) dt = readStr(tiff + u32(t0[0x0132] + 8), 20);
          const m = dt && dt.match(/^(\d{4}):(\d{2}):(\d{2})/);
          return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + len;
      }
    } catch {}
    return null;
  }

  const STATUS_TEXT = {
    'loading tesseract core': 'Flitzi setzt die Lesebrille auf …',
    'initializing tesseract': 'Flitzi setzt die Lesebrille auf …',
    'loading language traineddata': 'Flitzi lernt noch schnell lesen (nur beim ersten Mal) …',
    'initializing api': 'Flitzi macht sich bereit …',
    'recognizing text': 'Flitzi liest',
    'second pass': 'Flitzi schaut noch mal ganz genau hin',
  };
  const MAX_PHOTOS = 8;
  const isImageFile = (f) => f && (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name || ''));

  // ============================================================
  //  Run editor: one unit (Einheit) = one form + any number of photos
  //  Used for new units (queue) and for editing a saved run.
  // ============================================================
  function createEditor({ run = null } = {}) {
    const photos = [];          // { id, url, texts: string[]|null, state: 'loading'|'done'|'error', exif, lastModified }
    let zones = run && run.zones ? run.zones : null;
    let startTime = run ? run.startTime || null : null;
    let app = run ? run.app || null : null;
    let lastParsed = null;
    const ed = {};

    const { form, read, fill, actions, zonesBox } = createRunForm(run || {}, {});
    renderZones(zonesBox, zones);

    const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const strip = h('div', { class: 'photo-strip' });
    const statusText = h('span', { text: '' });
    const status = h('div', { class: 'q-status', hidden: true }, mascot('run', 44), statusText);
    const bar = h('div', { class: 'q-progress', hidden: true }, h('span'));
    const notices = h('div', { class: 'notices' });
    const dupBox = h('div', { class: 'notice warn', hidden: true });
    const raw = h('details', { class: 'raw', hidden: true }, h('summary', { text: 'Erkannten Text anzeigen' }), h('pre'));
    const el = h('div', { class: 'editor' }, strip, picker, status, bar, notices, dupBox, form, raw);

    // existing photos of a saved run
    const savedPhotos = run ? (run.photos && run.photos.length ? run.photos : run.photo ? [run.photo] : []) : [];
    savedPhotos.forEach((url, i) => photos.push({ id: uid(), url, texts: (run.ocrTexts && run.ocrTexts[i]) || [], state: 'done' }));

    function renderStrip() {
      const tiles = photos.map((p, i) => {
        const tile = h('div', { class: `ph is-${p.state}` },
          p.url ? h('img', { src: p.url, alt: `Foto ${i + 1}` }) : h('div', { class: 'ph-empty' }),
          p.state === 'loading' ? h('span', { class: 'ph-badge' }, h('span', { class: 'ph-spin' })) : null,
          p.state === 'error' ? h('span', { class: 'ph-badge err', text: '!' , title: 'Konnte nicht gelesen werden' }) : null,
          h('button', { class: 'ph-x', type: 'button', 'aria-label': `Foto ${i + 1} entfernen`, onclick: () => removePhoto(p.id) }, '×'));
        tile.addEventListener('click', (e) => { if (!e.target.closest('.ph-x') && p.url) previewPhoto(p.url); });
        return tile;
      });
      const canAdd = photos.length < MAX_PHOTOS;
      const add = canAdd ? h('button', { class: 'ph ph-add', type: 'button', onclick: () => picker.click() },
        h('span', { class: 'ph-plus', text: '+' }), h('span', { text: photos.length ? 'Foto' : 'Foto hinzufügen' })) : null;
      strip.replaceChildren(...tiles, ...(add ? [add] : []));
      strip.classList.toggle('is-empty', !photos.length);
    }

    function setBusy() {
      const loading = photos.filter((p) => p.state === 'loading');
      status.hidden = bar.hidden = !loading.length;
      el.classList.toggle('is-busy', loading.length > 0);
      if (ed.onState) ed.onState();
    }

    function progressFor(p) {
      const idx = photos.indexOf(p) + 1;
      const label = photos.length > 1 ? ` Foto ${idx} von ${photos.length}` : ' dein Foto';
      return (m) => {
        const txt = STATUS_TEXT[m.status];
        if (!txt) return;
        const reading = m.status === 'recognizing text' || m.status === 'second pass';
        statusText.textContent = reading ? `${txt}${label} … ${Math.round((m.progress || 0) * 100)} %` : txt;
        const pr = m.status === 'recognizing text' ? m.progress * 0.5 : m.status === 'second pass' ? 0.5 + (m.progress || 0) * 0.5 : (m.progress || 0) * 0.1;
        bar.firstChild.style.width = Math.round(pr * 100) + '%';
      };
    }

    async function addFile(file) {
      if (photos.length >= MAX_PHOTOS) { toast(`Maximal ${MAX_PHOTOS} Fotos pro Einheit`); return; }
      const p = { id: uid(), url: null, texts: null, state: 'loading', lastModified: file.lastModified };
      photos.push(p);
      renderStrip(); setBusy();
      try {
        const [img, exif] = await Promise.all([loadImage(file), exifDate(file)]);
        p.exif = exif;
        p.url = drawScaled(img, 900).toDataURL('image/jpeg', 0.8);
        renderStrip();
        const canvas = prepareForOcr(img);
        statusText.textContent = 'Gleich bist du dran …';
        if (!photos.includes(p)) return; // removed meanwhile
        p.texts = await recognize(canvas, (m) => { if (photos.includes(p)) progressFor(p)(m); });
        p.state = 'done';
      } catch (e) {
        console.error(e);
        p.state = 'error';
        p.texts = [];
        const offline = e && e.message && /online|geladen/.test(e.message);
        notices.prepend(h('div', { class: 'notice warn', text: offline ? e.message + ' Du kannst die Werte trotzdem von Hand eintragen.' : 'Ups, ein Bild konnte ich nicht lesen 🙈 Trag fehlende Werte bitte kurz selbst ein.' }));
      }
      if (!photos.includes(p)) return;
      renderStrip(); setBusy();
      reparse();
    }

    ed.addFiles = (files) => {
      const imgs = [...files].filter(isImageFile);
      if (!imgs.length) { toast('Bitte ein Bild (Screenshot oder Foto) wählen'); return; }
      const free = MAX_PHOTOS - photos.length;
      if (imgs.length > free) toast(`Maximal ${MAX_PHOTOS} Fotos pro Einheit`);
      imgs.slice(0, free).forEach(addFile);
    };
    picker.addEventListener('change', () => { ed.addFiles(picker.files); picker.value = ''; });

    function removePhoto(id) {
      const i = photos.findIndex((p) => p.id === id);
      if (i < 0) return;
      photos.splice(i, 1);
      renderStrip(); setBusy();
      reparse(true);
    }

    /** Combine the readings of all photos into one set of values. */
    function reparse(afterRemove = false) {
      const texts = photos.flatMap((p) => p.texts || []);
      raw.hidden = !texts.length;
      raw.lastChild.textContent = photos.map((p, i) => (p.texts && p.texts.length ? `— Foto ${i + 1} —\n${p.texts[0].trim()}` : '')).filter(Boolean).join('\n\n');
      if (!texts.length) { if (!afterRemove) notices.replaceChildren(); checkDup(); return; }
      const parsed = P.parseRunText(texts, { referenceDate: new Date() });
      lastParsed = parsed;
      const sources = { ...parsed.source };
      if (!parsed.date) {
        const ex = photos.find((p) => p.exif);
        if (ex) { parsed.date = ex.exif; sources.date = 'ocr'; }
        else if (!run) {
          const lm = photos.find((p) => p.lastModified && Date.now() - p.lastModified < 400 * 864e5);
          if (lm) { parsed.date = P.iso(new Date(lm.lastModified)); sources.date = 'auto'; }
        }
      }
      fill(parsed, sources);
      if (parsed.zones) zones = parsed.zones;
      if (parsed.startTime) startTime = parsed.startTime;
      if (parsed.app) app = parsed.app;
      renderZones(zonesBox, zones);

      const done = photos.filter((p) => p.state !== 'loading').length;
      const msgs = [];
      if (!photos.some((p) => p.state === 'loading')) {
        if (!parsed.isRun) msgs.push(['warn', 'Hm, hier habe ich keine Laufdaten gefunden 🙈 Trag die Werte einfach unten ein.']);
        else {
          const what = [parsed.app === 'WHOOP' ? 'WHOOP-Aktivität' : null, parsed.zones ? 'Herzfrequenzzonen' : null].filter(Boolean).join(' mit ');
          msgs.push(['good', `✨ ${parsed.recognized} ${parsed.recognized === 1 ? 'Wert' : 'Werte'} aus ${done} ${done === 1 ? 'Foto' : 'Fotos'} erkannt${what ? ` (${what})` : ''} – schau kurz drüber, ob alles stimmt.`]);
          const missing = [];
          if (parsed.distanceKm == null) missing.push('Distanz');
          if (parsed.durationSec == null) missing.push('Dauer');
          if (missing.length) msgs.push(['warn', `${missing.join(' und ')} ${missing.length > 1 ? 'fehlen' : 'fehlt'} noch – trag ${missing.length > 1 ? 'sie' : 'sie'} ein oder füg mit „+ Foto“ einen weiteren Screenshot hinzu (z. B. die Karte mit Distanz & Pace).`]);
        }
        parsed.warnings.forEach((w) => msgs.push(['warn', w]));
      }
      notices.replaceChildren(...msgs.map(([cls, text]) => h('div', { class: `notice ${cls}`, text })));
      checkDup();
    }

    function checkDup() {
      const date = form.elements.date.value;
      const d = parseFloat(form.elements.distanceKm.value.replace(',', '.'));
      const dup = runs.find((r) => (!run || r.id !== run.id) && r.date === date && Math.abs((r.distanceKm || 0) - d) < 0.06);
      dupBox.hidden = !dup;
      dupBox.textContent = dup ? `Am ${fmtDate(dup.date)} ist bereits ein Lauf über ${km2(dup.distanceKm)} km gespeichert – evtl. doppelt?` : '';
    }
    form.addEventListener('input', checkDup);

    // drop more pictures straight onto this unit
    el.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('drag'); } });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag'); });
    el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drag'); ed.addFiles(e.dataTransfer.files); });

    /** The run to save (merged with `base` when editing), or null if the form is incomplete. */
    ed.build = (base = null) => {
      const v = read();
      if (!v) return null;
      const keep = photos.filter((p) => p.url && p.state !== 'loading');
      const out = { ...(base || { id: uid(), createdAt: Date.now() }), ...v, updatedAt: base ? Date.now() : undefined };
      for (const k of [...Object.keys(INT_FIELDS), 'strain', 'note']) if (v[k] == null) delete out[k];
      delete out.photo;
      if (keep.length) { out.photos = keep.map((p) => p.url); out.ocrTexts = keep.map((p) => p.texts || []); }
      else { delete out.photos; delete out.ocrTexts; }
      if (zones && zones.length) out.zones = zones; else delete out.zones;
      if (startTime) out.startTime = startTime;
      if (app) out.app = app;
      if (!base) delete out.updatedAt;
      delete out.rawText;
      return out;
    };
    ed.busy = () => photos.some((p) => p.state === 'loading');
    ed.photoCount = () => photos.length;
    ed.el = el;
    ed.form = form;
    ed.actions = actions;
    ed.focusFirst = () => form.querySelector('input[name=distanceKm]')?.focus();
    renderStrip();
    checkDup();
    return ed;
  }

  function previewPhoto(url) {
    const ov = h('button', { class: 'photo-preview', type: 'button', 'aria-label': 'Vorschau schließen' }, h('img', { src: url, alt: 'Foto' }));
    ov.addEventListener('click', () => ov.remove());
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', esc); } });
    (dlg.open ? dlg : document.body).append(ov);
  }

  // ---------- Queue of new units ----------
  function updateQueueHead() {
    const ready = queue.filter((q) => !q.editor.busy()).length;
    $('#queueHead').hidden = queue.length === 0;
    $('#queueCount').textContent = queue.length ? `(${queue.length})` : '';
    $('#saveAllBtn').hidden = queue.length < 2;
    $('#saveAllBtn').textContent = `Alle speichern (${ready})`;
  }

  /** A new unit. Every press on "+" / every selection from the drop zone creates exactly one. */
  function newUnit(files = null) {
    const editor = createEditor();
    const item = { id: uid(), editor };
    const head = h('div', { class: 'unit-head' },
      h('span', { class: 'unit-badge', text: 'Neue Einheit' }),
      h('span', { class: 'unit-hint', text: 'Alle Fotos hier gehören zu diesem einen Lauf.' }));
    item.el = h('article', { class: 'card q-item' }, head, editor.el);
    editor.onState = updateQueueHead;
    item.save = async () => {
      if (editor.busy()) { toast('Einen Moment – Flitzi liest noch 📖'); return false; }
      const run = editor.build();
      if (!run) return false;
      const reached = await saveRun(run);
      removeQueueItem(item);
      return { run, reached };
    };
    editor.actions.append(
      h('button', { class: 'btn btn-primary', type: 'submit', text: 'Einheit speichern', onclick: async () => {
        const res = await item.save();
        if (res) runSavedToast(res.run, res.reached);
      } }),
      h('button', { class: 'btn', type: 'button', text: 'Verwerfen', onclick: () => removeQueueItem(item) }));
    queue.unshift(item);
    $('#queue').prepend(item.el);
    updateQueueHead();
    if (files) editor.addFiles(files);
    else editor.focusFirst();
    return item;
  }

  function removeQueueItem(item) {
    const i = queue.indexOf(item);
    if (i >= 0) queue.splice(i, 1);
    item.el.remove();
    updateQueueHead();
  }

  function handleFiles(files) {
    const imgs = [...files].filter(isImageFile);
    if (!imgs.length) { toast('Bitte ein Bild (Screenshot oder Foto) wählen'); return; }
    showTab('add');
    newUnit(imgs);
  }

  $('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#cameraInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#manualBtn').addEventListener('click', () => newUnit());
  $('#saveAllBtn').addEventListener('click', async () => {
    let ok = 0, fail = 0;
    const reached = [];
    for (const item of queue.slice()) {
      const res = await item.save();
      if (res) { ok++; reached.push(...res.reached); } else fail++;
    }
    if (reached.length) celebrate('Juhu, geschafft!', G.describe(reached[0]), ' – Ziel erreicht!');
    toast(fail ? `${ok} gespeichert, bei ${fail} fehlt noch etwas` : `${ok} ${ok === 1 ? 'Einheit' : 'Einheiten'} gespeichert 🎉`);
  });

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  // Pasting adds to the newest open unit (e.g. paste three screenshots one after another); otherwise starts one.
  document.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(isImageFile);
    if (!files.length) return;
    e.preventDefault();
    if (dlg.open && openEditor) { openEditor.addFiles(files); return; }
    showTab('add');
    if (queue[0]) { queue[0].editor.addFiles(files); toast('Zur neuesten Einheit hinzugefügt 📎'); }
    else newUnit(files);
  });

  // ============================================================
  //  Export / import
  // ============================================================
  async function download(name, content, type) {
    if (isIOS() && navigator.canShare) {
      const file = new File([content], name, { type: type.split(';')[0] });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); } catch {}
        return;
      }
    }
    const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#exportCsvBtn').addEventListener('click', () => {
    const esc = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = [['Datum', 'Start', 'Art', 'Distanz (km)', 'Dauer', 'Pace (min/km)', 'Ø HF', 'Max HF', 'Kalorien', 'Höhenmeter', 'Schrittfrequenz', 'Strain', ...[0, 1, 2, 3, 4, 5].map((z) => `Zone ${z} (min)`), 'Fotos', 'Notiz']];
    for (const r of sortedRuns().reverse()) {
      const zt = (z) => { const x = (r.zones || []).find((q) => q.zone === z); return x && x.sec != null ? nf1.format(x.sec / 60) : ''; };
      rows.push([r.date, r.startTime, r.type, km2(r.distanceKm), P.formatDuration(r.durationSec), P.formatPace(pace(r)), r.avgHr, r.maxHr, r.calories, r.elevationM, r.cadence,
        r.strain != null ? nfStrain.format(r.strain) : '', ...[0, 1, 2, 3, 4, 5].map(zt), runPhotos(r).length || '', r.note]);
    }
    download(`laufbuch-${todayISO()}.csv`, '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  });
  $('#exportJsonBtn').addEventListener('click', () => {
    download(`laufbuch-backup-${todayISO()}.json`, JSON.stringify({ app: 'laufbuch', version: 2, exportedAt: new Date().toISOString(), runs, goals }, null, 1), 'application/json');
  });
  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.runs;
      if (!Array.isArray(list)) throw new Error('format');
      let n = 0;
      for (const r of list) {
        if (!r || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !(r.distanceKm > 0)) continue;
        const clean = { id: typeof r.id === 'string' ? r.id : uid(), date: r.date, type: String(r.type || 'Lauf'), distanceKm: +r.distanceKm, createdAt: +r.createdAt || Date.now() };
        for (const k of ['durationSec', 'avgHr', 'maxHr', 'calories', 'elevationM', 'cadence']) if (Number.isFinite(+r[k]) && r[k] != null) clean[k] = +r[k];
        if (typeof r.note === 'string') clean.note = r.note;
        const pics = (Array.isArray(r.photos) ? r.photos : [r.photo]).filter((u) => typeof u === 'string' && u.startsWith('data:image/'));
        if (pics.length) {
          clean.photos = pics.slice(0, MAX_PHOTOS);
          if (Array.isArray(r.ocrTexts)) clean.ocrTexts = r.ocrTexts.slice(0, clean.photos.length).map((t) => (Array.isArray(t) ? t.filter((x) => typeof x === 'string') : []));
        }
        if (Number.isFinite(+r.strain) && r.strain != null && +r.strain >= 0 && +r.strain <= 21) clean.strain = +r.strain;
        if (typeof r.startTime === 'string' && /^\d{2}:\d{2}$/.test(r.startTime)) clean.startTime = r.startTime;
        if (r.app === 'WHOOP') clean.app = 'WHOOP';
        if (Array.isArray(r.zones)) {
          const zs = r.zones.filter((z) => z && Number.isInteger(+z.zone) && +z.zone >= 0 && +z.zone <= 5)
            .map((z) => ({ zone: +z.zone, ...(Number.isFinite(+z.sec) && z.sec != null ? { sec: +z.sec } : {}), ...(Number.isFinite(+z.pct) && z.pct != null ? { pct: +z.pct } : {}) }));
          if (zs.length) clean.zones = zs;
        }
        await DB.put(clean);
        n++;
      }
      let ng = 0;
      if (Array.isArray(data.goals)) {
        for (const g of data.goals) {
          if (!g || !G.METRICS.includes(g.metric) || !(g.target > 0) || !G.PERIODS.includes(g.period)) continue;
          const clean = { id: typeof g.id === 'string' ? g.id : uid(), metric: g.metric, target: +g.target, period: g.period, recurring: !!g.recurring, createdAt: +g.createdAt || Date.now() };
          if (/^\d{4}-\d{2}-\d{2}$/.test(g.start || '') && /^\d{4}-\d{2}-\d{2}$/.test(g.end || '')) { clean.start = g.start; clean.end = g.end; }
          goals = goals.filter((x) => x.id !== clean.id).concat(clean);
          ng++;
        }
        saveGoals();
      }
      runs = await DB.all();
      renderAll();
      toast(`${n} ${n === 1 ? 'Einheit' : 'Einheiten'}${ng ? ` und ${ng} ${ng === 1 ? 'Ziel' : 'Ziele'}` : ''} importiert`);
    } catch {
      toast('Die Datei konnte nicht gelesen werden');
    }
  });

  // ---------- Resize charts ----------
  let rz;
  const ro = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if ($('#view-overview').classList.contains('is-active') && runs.length) { animateCharts = false; renderWeekChart(stats()); renderPaceChart(); animateCharts = true; } }, 120); });
  ro.observe($('#chartWeeks'));

  // Escape closes dialog is native; Esc also hides tooltip
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  // ============================================================
  //  Install on the home screen
  //  iPhone/iPad: no install prompt exists – people add the app via
  //  Safari's share menu, so we show them how. Android and desktop
  //  Chrome offer a native prompt (beforeinstallprompt).
  // ============================================================
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installEvent = null;

  function updateInstallCard() {
    const show = !isStandalone() && !prefs.installDismissed && (isIOS() || !!installEvent);
    $('#installCard').hidden = !show;
    $('#installBtn').textContent = installEvent ? 'Installieren' : "So geht's";
  }

  function showIosInstallSteps() {
    $('#editTitle').textContent = 'Laufbuch aufs iPhone holen';
    const shareIcon = s('svg', { class: 'ios-share', viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': 'true' });
    shareIcon.append(s('path', { fill: 'currentColor', d: 'M12 2.5l4.2 4.2-1.4 1.4L13 6.3V15h-2V6.3L9.200 8.100 7.800 6.700 12 2.5zM6 10h3v2H7v7h10v-7h-2v-2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z' }));
    const body = h('div', {},
      h('ol', { class: 'steps' },
        h('li', {}, h('div', {}, 'Tippe in Safari unten auf ', shareIcon, h('strong', { text: ' Teilen' }),
          h('small', { text: 'Das Quadrat mit dem Pfeil nach oben.' }))),
        h('li', {}, h('div', {}, 'Wähle ', h('strong', { text: '„Zum Home-Bildschirm“' }),
          h('small', { text: 'Dafür in der Liste etwas nach unten scrollen.' }))),
        h('li', {}, h('div', {}, 'Tippe oben rechts auf ', h('strong', { text: '„Hinzufügen“' }),
          h('small', { text: 'Fertig – Flitzi wartet dann auf deinem Home-Bildschirm! 🎉' })))),
      h('p', { class: 'install-note', text: 'Kein Teilen-Symbol zu sehen? Dann öffne diese Seite zuerst in Safari.' }),
      h('p', { class: 'install-note', text: 'Gut zu wissen: Die App auf dem Home-Bildschirm hat ihren eigenen Speicher. Läufe, die du schon hier im Browser gespeichert hast, nimmst du über „Einheiten → Backup“ und danach „Importieren“ mit.' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'Alles klar!', onclick: () => dlg.close() })));
    $('#editBody').replaceChildren(body);
    dlg.showModal();
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; updateInstallCard(); });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    updateInstallCard();
    celebrate('Juhu, installiert!', 'Laufbuch', ' wohnt jetzt auf deinem Home-Bildschirm.');
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!installEvent) return showIosInstallSteps();
    installEvent.prompt();
    try { await installEvent.userChoice; } catch {}
    installEvent = null;
    updateInstallCard();
  });
  $('#installDismiss').addEventListener('click', () => {
    prefs.installDismissed = true;
    savePrefs();
    updateInstallCard();
    toast(isIOS() ? 'Okay! Später findest du es im Teilen-Menü von Safari.' : 'Okay! Später findest du es im Menü deines Browsers.');
  });

  // Offline support (needs https or localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker', e)));
  }

  // ---------- Boot ----------
  async function init() {
    loadPrefs();
    applyTheme();
    $$('[data-mascot]').forEach((el) => setMascot(el, el.dataset.mascot));
    runs = await DB.all();
    // Ask the browser to keep the logbook safe from automatic clean-ups
    if (runs.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    updateInstallCard();
    renderRuns();
    const tab = Object.keys(TAB_HASH).find((k) => TAB_HASH[k] === location.hash) || 'overview';
    showTab(tab, false);
  }
  init();

  // Exposed for debugging / tests
  window.Laufbuch = { get runs() { return runs; }, get goals() { return goals; }, saveRun, deleteRun };
})();
