/* ============================================================
   Laufbuch — Ziele
   Goal model, natural-language goal input ("60 km diese Woche"),
   period ranges and progress. Browser (window.Goals) + Node.
   ============================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Goals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Goal:
   *  { id, metric: 'km' | 'runs' | 'time' | 'single',
   *    target,            // km | count | seconds | km (single run)
   *    period: 'day' | 'week' | 'month' | 'year' | 'custom',
   *    recurring: bool,   // applies to every day/week/month/year
   *    start, end,        // ISO dates (one-off and custom goals)
   *    createdAt }
   */

  const METRICS = ['km', 'runs', 'time', 'single'];
  const PERIODS = ['day', 'week', 'month', 'year', 'custom'];
  const MI = 1.609344;

  const nf = (d) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const nf1 = nf(1);
  const nf2 = nf(2);

  // ---------- Dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  function mondayOf(d) { const x = dayStart(d); return addDays(x, -((x.getDay() + 6) % 7)); }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 864e5 + 1) / 7);
  }

  /** Calendar range of a period that contains `ref`. */
  function periodRange(period, ref = new Date()) {
    const d = dayStart(ref);
    switch (period) {
      case 'day': return { start: iso(d), end: iso(d) };
      case 'week': { const m = mondayOf(d); return { start: iso(m), end: iso(addDays(m, 6)) }; }
      case 'month': return { start: iso(new Date(d.getFullYear(), d.getMonth(), 1)), end: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
      case 'year': return { start: `${d.getFullYear()}-01-01`, end: `${d.getFullYear()}-12-31` };
      default: return { start: iso(d), end: iso(d) };
    }
  }

  /** The date range a goal currently refers to. */
  function rangeFor(goal, today = new Date()) {
    if (goal.recurring && goal.period !== 'custom') return periodRange(goal.period, today);
    if (goal.start && goal.end) return { start: goal.start, end: goal.end };
    return periodRange(goal.period, today);
  }

  /** Create a complete goal from a draft, pinning one-off goals to their period. */
  function finalize(draft, today = new Date()) {
    const g = {
      metric: METRICS.includes(draft.metric) ? draft.metric : 'km',
      target: +draft.target,
      period: PERIODS.includes(draft.period) ? draft.period : 'week',
      recurring: !!draft.recurring && draft.period !== 'custom',
    };
    if (g.period === 'custom') {
      g.start = draft.start || iso(today);
      g.end = draft.end && draft.end >= g.start ? draft.end : g.start;
    } else if (!g.recurring) {
      const r = periodRange(g.period, draft.start ? parseISO(draft.start) : today);
      g.start = r.start; g.end = r.end;
    }
    return g;
  }

  // ---------- Progress ----------
  function valueOf(metric, runs) {
    switch (metric) {
      case 'runs': return runs.length;
      case 'time': return runs.reduce((a, r) => a + (r.durationSec || 0), 0);
      case 'single': return runs.reduce((a, r) => Math.max(a, r.distanceKm || 0), 0);
      default: return runs.reduce((a, r) => a + (r.distanceKm || 0), 0);
    }
  }

  /**
   * @returns {{ value, target, pct, remaining, range, status, daysLeft, totalDays,
   *             elapsedPct, expected, perDay, isCurrent }}
   * status: 'done' | 'active' | 'missed' | 'upcoming'
   */
  function progress(goal, runs, today = new Date()) {
    const range = rangeFor(goal, today);
    const t = iso(today);
    const inRange = runs.filter((r) => r.date >= range.start && r.date <= range.end && r.type !== 'Gehen');
    const value = valueOf(goal.metric, inRange);
    const target = goal.target;
    const pct = target > 0 ? Math.min(1, value / target) : 0;
    const remaining = Math.max(0, target - value);
    const totalDays = daysBetween(range.start, range.end) + 1;
    let status;
    if (value >= target - 1e-9) status = 'done';
    else if (t > range.end) status = 'missed';
    else if (t < range.start) status = 'upcoming';
    else status = 'active';
    const daysLeft = t > range.end ? 0 : t < range.start ? totalDays : daysBetween(t, range.end) + 1;
    // Target pace measured at the start of today (days already completed), so a fresh week starts "im Plan"
    const elapsedDays = Math.min(totalDays, Math.max(0, totalDays - daysLeft));
    const elapsedPct = status === 'upcoming' ? 0 : elapsedDays / totalDays;
    const expected = target * elapsedPct;
    const perDay = (goal.metric === 'km' || goal.metric === 'time') && daysLeft > 1 && remaining > 0 ? remaining / daysLeft : null;
    const isCurrent = t >= range.start && t <= range.end;
    return { value, target, pct, remaining, range, status, daysLeft, totalDays, elapsedPct, expected, perDay, isCurrent, runs: inRange.length };
  }

  // ---------- Formatting ----------
  function formatAmount(metric, v, { unit = true } = {}) {
    switch (metric) {
      case 'runs': {
        const n = Math.round(v);
        return unit ? `${n} ${n === 1 ? 'Lauf' : 'Läufe'}` : String(n);
      }
      case 'time': {
        const min = Math.round(v / 60);
        if (min < 60) return unit ? `${min} min` : String(min);
        const h = Math.floor(min / 60), m = min % 60;
        return m ? `${h}:${pad(m)} h` : `${h} h`;
      }
      default: {
        const s = v >= 100 ? nf1.format(Math.round(v)) : v % 1 ? nf2.format(v) : String(v);
        return unit ? `${s} km` : s;
      }
    }
  }

  const MONTHS_SHORT = { day: 'numeric', month: 'short' };
  function describe(goal, today = new Date()) {
    const r = rangeFor(goal, today);
    const p = progress(goal, [], today);
    let what;
    if (goal.metric === 'single') what = `Ein Lauf über ${formatAmount('km', goal.target)}`;
    else if (goal.metric === 'time') what = `${formatAmount('time', goal.target)} Laufzeit`;
    else what = formatAmount(goal.metric, goal.target);

    let when;
    if (goal.recurring) {
      when = { day: 'pro Tag', week: 'pro Woche', month: 'pro Monat', year: 'pro Jahr' }[goal.period];
    } else if (goal.period === 'custom') {
      const end = parseISO(r.end);
      if (r.start === r.end) {
        const t = iso(today), tm = iso(addDays(dayStart(today), 1));
        when = r.end === t ? 'heute' : r.end === tm ? 'morgen' : `am ${end.toLocaleDateString('de-DE', MONTHS_SHORT)}`;
      } else {
        when = `bis ${end.toLocaleDateString('de-DE', end.getFullYear() === today.getFullYear() ? MONTHS_SHORT : { ...MONTHS_SHORT, year: 'numeric' })}`;
      }
    } else if (p.isCurrent) {
      when = { day: 'heute', week: 'diese Woche', month: 'diesen Monat', year: 'dieses Jahr' }[goal.period];
    } else {
      const s = parseISO(r.start);
      const tm = iso(addDays(dayStart(today), 1));
      when = {
        day: r.start === tm ? 'morgen' : `am ${s.toLocaleDateString('de-DE', MONTHS_SHORT)}`,
        week: `in KW ${isoWeek(s)}`,
        month: `im ${s.toLocaleDateString('de-DE', { month: 'long' })}`,
        year: `im Jahr ${s.getFullYear()}`,
      }[goal.period];
    }
    return `${what} ${when}`;
  }

  // ---------- Natural language ----------
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  /**
   * "60 km diese Woche", "10km heute", "3 Läufe pro Woche", "5 Stunden im Monat",
   * "1000 km dieses Jahr", "Halbmarathon bis 31.12.", "einen 15-km-Lauf bis Sonntag"
   * → goal draft, or null if nothing usable was found.
   */
  function parseGoalText(text, today = new Date()) {
    let t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
    if (!/\d|marathon|halbmarathon/.test(t)) return null;
    const draft = { metric: null, target: null, period: null, recurring: false };

    // --- what ---
    let m;
    if (/halb\s*-?\s*marathon|half\s*marathon/.test(t)) { draft.metric = 'single'; draft.target = 21.1; }
    else if (/marathon/.test(t)) { draft.metric = 'single'; draft.target = 42.2; }
    else if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*-?\s*(km|kilometer)\s*-?\s*(lauf|run)\b/)) && /\bein(en)?\b/.test(t)) {
      draft.metric = 'single'; draft.target = num(m[1]);
    } else if ((m = t.match(/(?:lauf|run)\s+(?:über|von|mit|>=?)\s*(\d+(?:[.,]\d+)?)\s*(km|kilometer|mi)/))) {
      draft.metric = 'single'; draft.target = num(m[1]) * (m[2] === 'mi' ? MI : 1);
    } else if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(km|kilometer)\s*(am stück|an einem stück|in einem lauf|einzellauf)/))) {
      draft.metric = 'single'; draft.target = num(m[1]);
    } else if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(km|kilometer|kilometern)\b/))) {
      draft.metric = 'km'; draft.target = num(m[1]);
    } else if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(mi|meilen|miles)\b/))) {
      draft.metric = 'km'; draft.target = Math.round(num(m[1]) * MI * 10) / 10;
    } else if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(h|std\.?|stunden?|hours?)\b(?:\s*(\d+)\s*(min|minuten)\b)?/))) {
      draft.metric = 'time'; draft.target = Math.round(num(m[1]) * 3600 + (m[3] ? +m[3] * 60 : 0));
    } else if ((m = t.match(/(\d+)\s*(min|minuten|minutes)\b/))) {
      draft.metric = 'time'; draft.target = +m[1] * 60;
    } else if ((m = t.match(/(\d+)\s*(?:x|mal)?\s*(läufe|lauf|laufen|einheiten|einheit|runs?|trainings?)\b/)) || (m = t.match(/(\d+)\s*(x|mal)\b/))) {
      draft.metric = 'runs'; draft.target = +m[1];
    } else if ((m = t.match(/(?<![\d.])(\d+(?:[.,]\d+)?)(?![\d.])/))) {
      draft.metric = 'km'; draft.target = num(m[1]);
    }
    if (!draft.target || !(draft.target > 0)) return null;

    // --- recurring? ---
    draft.recurring = /\b(jede[nrs]?|pro|je|wöchentlich|täglich|monatlich|jährlich|immer|every|per)\b/.test(t);

    // --- when ---
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if ((m = t.match(/\bbis\s+(?:zum\s+|ende\s+)?(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/))) {
      let y = m[3] ? +m[3] : d0.getFullYear();
      if (y < 100) y += 2000;
      let end = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && end < d0) end = new Date(y + 1, +m[2] - 1, +m[1]);
      draft.period = 'custom'; draft.start = iso(d0); draft.end = iso(end); draft.recurring = false;
    } else if ((m = t.match(/\bbis\s+(?:zum\s+|nächsten\s+|kommenden\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/))) {
      const target = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'].indexOf(m[1]);
      let diff = (target - d0.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      draft.period = 'custom'; draft.start = iso(d0); draft.end = iso(addDays(d0, diff)); draft.recurring = false;
    } else if (/\bmorgen\b|\btomorrow\b/.test(t)) {
      const tm = iso(addDays(d0, 1));
      draft.period = 'custom'; draft.start = tm; draft.end = tm; draft.recurring = false;
    } else if (/\b(heute|today|tag|täglich|daily)\b/.test(t)) {
      draft.period = 'day';
    } else if (/(woche|wöchentlich|\bweek)/.test(t)) {
      draft.period = 'week';
      if (/nächste[nr]? woche|kommende[nr]? woche|next week/.test(t)) { draft.start = iso(addDays(mondayOf(d0), 7)); draft.recurring = false; }
    } else if (/(monat|monatlich|\bmonth)/.test(t)) {
      draft.period = 'month';
      if (/nächste[nrm]? monat|next month/.test(t)) { draft.start = iso(new Date(d0.getFullYear(), d0.getMonth() + 1, 1)); draft.recurring = false; }
    } else if (/(jahr|jährlich|\byear|\b20\d\d\b)/.test(t)) {
      draft.period = 'year';
    } else {
      draft.period = draft.metric === 'single' ? 'month' : 'week';
    }
    return draft;
  }

  return { METRICS, PERIODS, periodRange, rangeFor, finalize, progress, describe, formatAmount, parseGoalText, iso, parseISO };
});
