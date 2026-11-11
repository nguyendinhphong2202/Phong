/* ============================================================
   Laufbuch — app
   Vanilla JS, no build step. Runs are stored on-device in
   IndexedDB; OCR runs in the browser via Tesseract.js.
   ============================================================ */

(() => {
  'use strict';

  const P = window.RunParser;
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const PREF_KEY = 'laufbuch.prefs.v1';
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
  let prefs = { goalKm: 20, theme: null };
  const queue = []; // { id, file, el, form, status }

  function loadPrefs() {
    try { prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; } catch {}
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }
  const sortedRuns = () => runs.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  // ---------- Theme ----------
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = prefs.theme || (mq.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = t;
    $('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#121315' : '#f6f5f3');
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
    if (empty) return;
    $('#demoBar').hidden = !runs.some((r) => r.demo);
    const st = stats();

    // Week card
    const goal = prefs.goalKm || 20;
    const pct = Math.min(100, (st.current.km / goal) * 100);
    $('#weekKm').textContent = km1(st.current.km);
    $('#weekGoal').textContent = nf0.format(goal);
    const prog = $('#weekProgress');
    prog.querySelector('span').style.width = pct + '%';
    prog.classList.toggle('done', st.current.km >= goal);
    prog.setAttribute('aria-valuenow', Math.round(pct));
    const left = goal - st.current.km;
    $('#weekFoot').textContent = `${st.current.count} ${st.current.count === 1 ? 'Lauf' : 'Läufe'} · ${
      left > 0 ? `noch ${km1(left)} km bis zum Wochenziel` : 'Wochenziel erreicht – stark!'}`;
    const streak = $('#streakPill');
    streak.textContent = st.streak >= 2 ? `${st.streak} Wochen in Folge aktiv` : '';
    streak.className = 'pill good';
    const monthName = new Date().toLocaleDateString('de-DE', { month: 'long' });
    let mt = `${monthName}: ${km1(st.thisMonth.km)} km`;
    if (st.lastMonth.km > 0) {
      const diff = Math.round(((st.thisMonth.km - st.lastMonth.km) / st.lastMonth.km) * 100);
      mt += ` · ${diff >= 0 ? '+' : '−'}${Math.abs(diff)} % zum Vormonat`;
    }
    $('#monthPill').textContent = mt;

    // KPIs
    $('#kpiKm').textContent = st.totalKm >= 1000 ? nf0.format(st.totalKm) : km1(st.totalKm);
    $('#kpiRuns').textContent = nf0.format(st.count);
    $('#kpiTime').textContent = st.totalSec >= 10 * 3600 ? `${nf1.format(st.totalSec / 3600)} h` : fmtHours(st.totalSec);
    $('#kpiPace').textContent = st.avgPace ? P.formatPace(st.avgPace) : '–';

    renderWeekChart(st);
    renderPaceChart();
    renderRecords(st);

    const recent = $('#recentList');
    recent.replaceChildren(...sortedRuns().slice(0, 5).map((r) => runItem(r)));
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

  function renderWeekChart(st) {
    const box = $('#chartWeeks');
    const W = box.clientWidth || 480, H = box.clientHeight || 220;
    const m = { t: 18, r: 8, b: 24, l: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const goal = prefs.goalKm || 20;
    const maxKm = Math.max(...st.weeks.map((w) => w.km));
    const tick = niceMax(Math.max(maxKm, goal) * 1.08 / 4);
    const ticks = Math.max(2, Math.ceil(Math.max(maxKm, goal) * 1.08 / tick));
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
      svg.append(s('path', { class: 'bar' + (isCur ? ' current' : ''), d: roundedTopBar(x, y(w.km), bw, y(0) - y(w.km), 4) }));
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

    svg.append(s('line', { class: 'goal-line', x1: m.l, x2: W - m.r, y1: y(goal), y2: y(goal) }));
    const gl = s('text', { class: 'goal-label', x: m.l + 4, y: y(goal) - 5 });
    gl.textContent = `Ziel ${nf0.format(goal)} km`;
    svg.append(gl);
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
      box.replaceChildren(h('div', { class: 'chart-empty', text: 'Ab zwei Läufen siehst du hier, wie sich deine Pace entwickelt.' }));
      return;
    }
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
    svg.append(s('path', { class: 'line', d: path }));
    const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    svg.append(cross);
    const dots = pts.map((d, i) => { const c = s('circle', { class: 'dot', cx: x(i), cy: y(d.p), r: 4 }); svg.append(c); return c; });

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
      longest && ['Längster Lauf', km2(longest.distanceKm), 'km', fmtDate(longest.date, { day: 'numeric', month: 'short', year: 'numeric' })],
      fastest && [`Schnellste Pace${minDist ? ' (ab 3 km)' : ''}`, P.formatPace(pace(fastest)), '/km', `${km2(fastest.distanceKm)} km · ${fmtDate(fastest.date, { day: 'numeric', month: 'short', year: 'numeric' })}`],
      longestTime && ['Längste Dauer', P.formatDuration(longestTime.durationSec), '', fmtDate(longestTime.date, { day: 'numeric', month: 'short', year: 'numeric' })],
      st.bestWeek && ['Stärkste Woche', km1(st.bestWeek.km), 'km', `KW ${isoWeek(parseISO(st.bestWeek.key))} · ${parseISO(st.bestWeek.key).getFullYear()}`],
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
  function runItem(r) {
    const p = pace(r);
    const thumb = r.photo
      ? h('img', { class: 'run-thumb', src: r.photo, alt: '', loading: 'lazy' })
      : h('div', { class: 'run-thumb', 'aria-hidden': 'true', text: parseISO(r.date).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') });
    const meta = [
      r.durationSec ? P.formatDuration(r.durationSec) : null,
      p ? `${P.formatPace(p)} /km` : null,
      r.avgHr ? `♥ ${r.avgHr}` : null,
      r.elevationM ? `↗ ${r.elevationM} m` : null,
    ].filter(Boolean);
    return h('li', {},
      h('button', { class: 'run-item', type: 'button', onclick: () => openEdit(r.id) },
        thumb,
        h('div', { class: 'run-main' },
          h('div', { class: 'run-title', text: `${r.type || 'Lauf'} · ${fmtDate(r.date)}${r.note ? ' · ' + r.note : ''}` }),
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
    renderAll();
  });
  $('#demoRemove').addEventListener('click', async () => {
    for (const r of runs.filter((x) => x.demo)) await DB.del(r.id);
    runs = await DB.all();
    renderAll();
    toast('Beispieldaten entfernt');
  });

  // ============================================================
  //  Run form
  // ============================================================
  const FIELD_KEYS = ['date', 'type', 'distanceKm', 'durationSec', 'avgHr', 'maxHr', 'calories', 'elevationM', 'cadence', 'note'];
  const INT_FIELDS = { avgHr: [30, 250], maxHr: [30, 250], calories: [0, 20000], elevationM: [0, 9000], cadence: [40, 260] };

  function createRunForm(values = {}, sources = {}) {
    const form = $('#runFormTpl').content.firstElementChild.cloneNode(true);
    const f = form.elements;
    f.date.value = values.date || todayISO();
    f.date.max = todayISO();
    f.type.value = values.type || 'Lauf';
    if (values.distanceKm != null) f.distanceKm.value = String(values.distanceKm).replace('.', ',');
    if (values.durationSec != null) f.durationSec.value = P.formatDuration(values.durationSec);
    for (const k of Object.keys(INT_FIELDS)) if (values[k] != null) f[k].value = values[k];
    if (values.note) f.note.value = values.note;

    const badge = (name, src) => {
      const field = (f[name] || form.querySelector(`[name="${name}"]`)).closest('.field');
      const i = field.querySelector('.src');
      if (!i) return;
      i.className = 'src' + (src ? ' ' + src : '');
      i.textContent = src === 'ocr' ? 'erkannt' : src === 'calc' ? 'berechnet' : '';
      field.classList.toggle('is-ocr', src === 'ocr');
    };
    for (const k of FIELD_KEYS) if (sources[k]) badge(k, sources[k]);

    const ocrPace = values.paceSecPerKm;
    const updatePace = () => {
      const d = parseFloat(f.distanceKm.value.replace(',', '.'));
      const t = P.parseDuration(f.durationSec.value);
      const out = f.pace;
      if (d > 0 && t > 0) {
        out.value = `${P.formatPace(t / d)} /km`;
        const matchesOcr = ocrPace && Math.abs(t / d - ocrPace) / ocrPace < 0.03 && sources.paceSecPerKm === 'ocr';
        badge('pace', matchesOcr ? 'ocr' : 'calc');
      } else {
        out.value = '–';
        badge('pace', '');
      }
    };
    updatePace();
    form.addEventListener('input', (e) => {
      const name = e.target.name;
      if (name && name !== 'type' && name !== 'note') badge(name, '');
      e.target.closest('.field')?.classList.remove('is-invalid');
      if (name === 'distanceKm' || name === 'durationSec') updatePace();
    });

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
      const box = form.querySelector('.form-error');
      box.hidden = !err.length;
      box.textContent = err.join(' · ');
      return err.length ? null : out;
    }
    form.addEventListener('submit', (e) => e.preventDefault());
    return { form, read, actions: form.querySelector('.form-actions') };
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
    const { form, read, actions } = createRunForm(r);
    actions.append(
      h('button', { class: 'btn btn-primary', type: 'submit', text: 'Speichern', onclick: async () => {
        const v = read(); if (!v) return;
        const updated = { ...r, ...v, note: v.note, updatedAt: Date.now() };
        for (const k of Object.keys(INT_FIELDS)) if (v[k] == null) delete updated[k];
        await saveRun(updated);
        dlg.close(); toast('Änderungen gespeichert');
      } }),
      h('button', { class: 'btn', type: 'button', text: 'Abbrechen', onclick: () => dlg.close() }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-danger', type: 'button', text: 'Löschen', onclick: async () => {
        dlg.close();
        await deleteRun(r.id);
        toast('Einheit gelöscht', { label: 'Rückgängig', fn: () => saveRun(r) });
      } }));
    const body = $('#editBody');
    body.replaceChildren(...[r.photo ? h('img', { class: 'dialog-photo', src: r.photo, alt: 'Foto der Einheit' }) : null, form].filter(Boolean));
    dlg.showModal();
  }

  $('#goalBtn').addEventListener('click', () => {
    $('#editTitle').textContent = 'Wochenziel';
    const input = h('input', { type: 'number', min: 1, max: 500, step: 1, value: prefs.goalKm, inputmode: 'numeric', id: 'goalInput' });
    const form = h('form', { class: 'run-form' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Kilometer pro Woche' }), input),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn btn-primary', type: 'submit', text: 'Übernehmen' }),
        h('button', { class: 'btn', type: 'button', text: 'Abbrechen', onclick: () => dlg.close() })));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = parseInt(input.value, 10);
      if (v > 0 && v <= 500) { prefs.goalKm = v; savePrefs(); renderOverview(); }
      dlg.close();
    });
    $('#editBody').replaceChildren(form);
    dlg.showModal();
    input.select();
  });

  // ============================================================
  //  Persistence actions
  // ============================================================
  async function saveRun(run) {
    await DB.put(run);
    runs = runs.filter((r) => r.id !== run.id).concat(run);
    renderAll();
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

  /** Run OCR sequentially (one worker); a second, differently segmented pass fills gaps. */
  function recognize(canvas, onProgress) {
    const job = ocrChain.then(async () => {
      currentLogger = (m) => onProgress(m);
      try {
        const w = await getWorker();
        await w.setParameters({ tessedit_pageseg_mode: '3' });
        const a = await w.recognize(canvas);
        let text = a.data.text;
        const first = P.parseRunText(text);
        if (first.distanceKm == null || first.durationSec == null || first.recognized < 3) {
          onProgress({ status: 'second pass', progress: 0 });
          await w.setParameters({ tessedit_pageseg_mode: '11' });
          const b = await w.recognize(canvas);
          text += '\n\n' + b.data.text;
          return { text, first: a.data.text, second: b.data.text };
        }
        return { text, first: a.data.text };
      } finally { currentLogger = null; }
    });
    ocrChain = job.catch(() => {});
    return job;
  }

  function mergeParsed(primary, secondary) {
    if (!secondary) return primary;
    const out = { ...primary, source: { ...primary.source }, warnings: primary.warnings.slice() };
    for (const k of ['distanceKm', 'durationSec', 'paceSecPerKm', 'avgHr', 'maxHr', 'calories', 'elevationM', 'cadence', 'date']) {
      if ((out[k] == null || out.source[k] === 'calc') && secondary[k] != null && secondary.source[k] === 'ocr') {
        out[k] = secondary[k]; out.source[k] = 'ocr';
      }
    }
    // Re-derive pace/distance/duration consistency with merged values
    const { distanceKm: d, durationSec: t, paceSecPerKm: p } = out;
    if (d && t && out.source.paceSecPerKm !== 'ocr') { out.paceSecPerKm = Math.round(t / d); out.source.paceSecPerKm = 'calc'; }
    if (!d && t && p) { out.distanceKm = Math.round((t / p) * 100) / 100; out.source.distanceKm = 'calc'; }
    if (d && !t && p) { out.durationSec = Math.round(d * p); out.source.durationSec = 'calc'; }
    out.recognized = Object.values(out.source).filter((v) => v === 'ocr').length;
    out.isRun = primary.isRun || secondary.isRun;
    return out;
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

  /** Grayscale, invert dark-mode screenshots, stretch contrast. */
  function prepareForOcr(img) {
    const c = drawScaled(img, 2600, 1100);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const px = id.data;
    const hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      px[i] = l; hist[l]++; sum += l;
    }
    const total = px.length / 4;
    const invert = sum / total < 110;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    const range = Math.max(40, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      let v = ((px[i] - lo) * 255) / range;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (invert) v = 255 - v;
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
    'loading tesseract core': 'Texterkennung wird geladen …',
    'initializing tesseract': 'Texterkennung wird gestartet …',
    'loading language traineddata': 'Sprachdaten werden geladen (einmalig) …',
    'initializing api': 'Texterkennung wird gestartet …',
    'recognizing text': 'Text wird erkannt …',
    'second pass': 'Zweiter Durchgang für fehlende Werte …',
  };

  function updateQueueHead() {
    const ready = queue.filter((q) => q.status === 'ready').length;
    $('#queueHead').hidden = queue.length === 0;
    $('#queueCount').textContent = queue.length ? `(${queue.length})` : '';
    $('#saveAllBtn').hidden = ready < 2;
    $('#saveAllBtn').textContent = `Alle speichern (${ready})`;
  }

  function addQueueItem({ file = null, photo = null } = {}) {
    const item = { id: uid(), file, status: 'loading', photo };
    const photoBox = h('div', { class: 'q-photo' }, h('div', { class: 'no-photo', text: 'Ohne Foto' }));
    const status = h('div', { class: 'q-status' }, h('span', { class: 'spinner' }), h('span', { text: 'Bild wird vorbereitet …' }));
    const bar = h('div', { class: 'q-progress' }, h('span'));
    const body = h('div', { class: 'q-body' }, status, bar);
    item.el = h('article', { class: 'card q-item' }, photoBox, body);
    Object.assign(item, { photoBox, statusEl: status, bar, body });
    queue.unshift(item);
    $('#queue').prepend(item.el);
    updateQueueHead();
    return item;
  }

  function setStatus(item, text, progress) {
    item.statusEl.lastChild.textContent = text;
    if (progress != null) item.bar.firstChild.style.width = Math.round(progress * 100) + '%';
  }

  function removeQueueItem(item) {
    const i = queue.indexOf(item);
    if (i >= 0) queue.splice(i, 1);
    item.el.remove();
    updateQueueHead();
  }

  function showForm(item, parsed, rawText) {
    item.statusEl.remove();
    item.bar.remove();
    const notices = [];
    if (parsed) {
      if (!parsed.isRun) notices.push(h('div', { class: 'notice warn', text: 'In diesem Bild wurden keine Laufdaten gefunden. Du kannst die Werte unten selbst eintragen.' }));
      else notices.push(h('div', { class: 'notice good', text: `${parsed.recognized} ${parsed.recognized === 1 ? 'Wert' : 'Werte'} automatisch erkannt – bitte kurz prüfen.` }));
      parsed.warnings.forEach((w) => notices.push(h('div', { class: 'notice warn', text: w })));
    }
    const values = parsed || {};
    const sources = { ...(parsed ? parsed.source : {}) };
    if (!values.date && item.exifDate) { values.date = item.exifDate; sources.date = 'ocr'; }
    if (!values.date && item.file && item.file.lastModified) {
      const d = new Date(item.file.lastModified);
      if (Date.now() - d < 400 * 864e5) values.date = P.iso(d);
    }
    const { form, read, actions } = createRunForm(values, sources);
    const dupBox = h('div', { class: 'notice warn', hidden: true });
    const checkDup = () => {
      const v = { date: form.elements.date.value, d: parseFloat(form.elements.distanceKm.value.replace(',', '.')) };
      const dup = runs.find((r) => r.date === v.date && Math.abs((r.distanceKm || 0) - v.d) < 0.06);
      dupBox.hidden = !dup;
      dupBox.textContent = dup ? `Am ${fmtDate(dup.date)} ist bereits ein Lauf über ${km2(dup.distanceKm)} km gespeichert – evtl. doppelt?` : '';
    };
    form.addEventListener('input', checkDup);
    checkDup();

    item.save = async () => {
      const v = read();
      if (!v) return false;
      const run = { id: uid(), ...v, photo: item.photo || undefined, rawText: rawText || undefined, createdAt: Date.now() };
      await saveRun(run);
      removeQueueItem(item);
      return true;
    };
    actions.append(
      h('button', { class: 'btn btn-primary', type: 'submit', text: 'Speichern', onclick: async () => {
        if (await item.save()) toast(`Lauf über ${km2(runs[runs.length - 1].distanceKm)} km gespeichert`, { label: 'Ansehen', fn: () => showTab('overview') });
      } }),
      h('button', { class: 'btn', type: 'button', text: 'Verwerfen', onclick: () => removeQueueItem(item) }));

    const extra = rawText ? h('details', { class: 'raw' }, h('summary', { text: 'Erkannten Text anzeigen' }), h('pre', { text: rawText })) : null;
    item.body.append(...notices, dupBox, form, ...(extra ? [extra] : []));
    item.status = 'ready';
    updateQueueHead();
    const first = form.querySelector('.field.is-invalid input, input:not([type=date])');
    if (!parsed) first?.focus();
  }

  async function processFile(file) {
    const item = addQueueItem({ file });
    try {
      const [img, exif] = await Promise.all([loadImage(file), exifDate(file)]);
      item.exifDate = exif;
      const thumb = drawScaled(img, 640);
      item.photo = thumb.toDataURL('image/jpeg', 0.78);
      item.photoBox.replaceChildren(h('img', { src: item.photo, alt: 'Hochgeladenes Bild' }));
      const canvas = prepareForOcr(img);
      setStatus(item, 'Warte auf Texterkennung …', 0.02);
      const res = await recognize(canvas, (m) => {
        const txt = STATUS_TEXT[m.status];
        if (!txt) return;
        const pr = m.status === 'recognizing text' ? m.progress : m.status === 'second pass' ? 0 : (m.progress || 0) * 0.15;
        setStatus(item, txt + (m.status === 'recognizing text' ? ` ${Math.round(m.progress * 100)} %` : ''), pr);
      });
      const primary = P.parseRunText(res.first, { referenceDate: new Date() });
      const secondary = res.second ? P.parseRunText(res.second, { referenceDate: new Date() }) : null;
      showForm(item, mergeParsed(primary, secondary), res.first.trim() + (res.second ? '\n\n— 2. Durchgang —\n' + res.second.trim() : ''));
    } catch (e) {
      console.error(e);
      item.statusEl.remove();
      item.bar.remove();
      item.body.prepend(h('div', { class: 'notice warn', text: (e && e.message && /online|geladen/.test(e.message)) ? e.message + ' Du kannst die Werte trotzdem manuell eintragen.' : 'Das Bild konnte nicht ausgelesen werden. Trage die Werte bitte manuell ein.' }));
      showForm(item, null, '');
    }
  }

  function handleFiles(files) {
    const imgs = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!imgs.length) { toast('Bitte ein Bild (Screenshot oder Foto) wählen'); return; }
    showTab('add');
    imgs.forEach(processFile);
  }

  $('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#cameraInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#manualBtn').addEventListener('click', () => {
    const item = addQueueItem();
    showForm(item, null, '');
  });
  $('#saveAllBtn').addEventListener('click', async () => {
    let ok = 0, fail = 0;
    for (const item of queue.filter((q) => q.status === 'ready').slice()) {
      if (await item.save()) ok++; else fail++;
    }
    toast(fail ? `${ok} gespeichert, ${fail} unvollständig` : `${ok} Läufe gespeichert`);
  });

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { if (!dz.contains(e.target)) { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); } });
  document.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); handleFiles(files); }
  });

  // ============================================================
  //  Export / import
  // ============================================================
  function download(name, content, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#exportCsvBtn').addEventListener('click', () => {
    const esc = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = [['Datum', 'Art', 'Distanz (km)', 'Dauer', 'Pace (min/km)', 'Ø HF', 'Max HF', 'Kalorien', 'Höhenmeter', 'Schrittfrequenz', 'Notiz']];
    for (const r of sortedRuns().reverse()) {
      rows.push([r.date, r.type, km2(r.distanceKm), P.formatDuration(r.durationSec), P.formatPace(pace(r)), r.avgHr, r.maxHr, r.calories, r.elevationM, r.cadence, r.note]);
    }
    download(`laufbuch-${todayISO()}.csv`, '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  });
  $('#exportJsonBtn').addEventListener('click', () => {
    download(`laufbuch-backup-${todayISO()}.json`, JSON.stringify({ app: 'laufbuch', version: 1, exportedAt: new Date().toISOString(), runs }, null, 1), 'application/json');
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
        if (typeof r.photo === 'string' && r.photo.startsWith('data:image/')) clean.photo = r.photo;
        if (typeof r.rawText === 'string') clean.rawText = r.rawText;
        await DB.put(clean);
        n++;
      }
      runs = await DB.all();
      renderAll();
      toast(`${n} ${n === 1 ? 'Einheit' : 'Einheiten'} importiert`);
    } catch {
      toast('Die Datei konnte nicht gelesen werden');
    }
  });

  // ---------- Resize charts ----------
  let rz;
  const ro = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if ($('#view-overview').classList.contains('is-active') && runs.length) { renderWeekChart(stats()); renderPaceChart(); } }, 120); });
  ro.observe($('#chartWeeks'));

  // Escape closes dialog is native; Esc also hides tooltip
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  // ---------- Boot ----------
  async function init() {
    loadPrefs();
    applyTheme();
    runs = await DB.all();
    renderRuns();
    const tab = Object.keys(TAB_HASH).find((k) => TAB_HASH[k] === location.hash) || 'overview';
    showTab(tab, false);
  }
  init();

  // Exposed for debugging / tests
  window.Laufbuch = { get runs() { return runs; }, saveRun, deleteRun };
})();
