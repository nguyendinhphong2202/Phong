/* ============================================================
   Laufbuch — Parser
   Turns raw OCR text from a run screenshot / photo (Strava,
   Garmin Connect, Apple Fitness, Nike Run Club, Polar, Coros,
   Samsung Health, watch displays …) into structured run data.
   Works in the browser (window.RunParser) and in Node (tests).
   ============================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MI = 1.609344;

  // ---------- Keyword dictionaries (DE + EN) ----------
  const KW = {
    distance: /(distanz|distance|strecke|entfernung|kilometer|gesamtdistanz|dist\.)/i,
    time: /(zeit|dauer|time|duration|elapsed|laufzeit|gesamtzeit|trainingszeit|bewegungszeit|moving|aktivit[aä]tszeit|workout time)/i,
    moving: /(bewegungszeit|moving)/i,
    elapsed: /(verstrichene|elapsed|gesamtzeit|total time)/i,
    pace: /(pace|tempo|min\s*\/\s*km|durchschnittstempo|avg\.?\s*pace|ø\s*tempo)/i,
    paceBest: /(best|schnellst|max|beste)/i,
    avg: /(ø|⌀|avg|durchschn|average|mittel|schnitt)/i,
    max: /(max)/i,
    hr: /(herzfrequenz|herz|puls|heart|hf\b|hr\b|bpm)/i,
    calories: /(kalorien|calories|kcal|energie|energy|aktive kal|active cal)/i,
    elevation: /(h[oö]henmeter|anstieg|aufstieg|h[oö]hengewinn|elevation|elev\.?|ascent|steigung|h[oö]he|gain)/i,
    cadence: /(kadenz|schrittfrequenz|cadence|schritte\s*\/\s*min|spm)/i,
    speed: /(geschwindigkeit|speed|km\s*\/\s*h)/i,
  };

  const MONTHS = {
    jan: 1, januar: 1, january: 1, jän: 1, jänner: 1,
    feb: 2, februar: 2, february: 2,
    mär: 3, märz: 3, mar: 3, mrz: 3, march: 3, maerz: 3,
    apr: 4, april: 4,
    mai: 5, may: 5,
    jun: 6, juni: 6, june: 6,
    jul: 7, juli: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    okt: 10, oct: 10, oktober: 10, october: 10,
    nov: 11, november: 11,
    dez: 12, dec: 12, dezember: 12, december: 12,
  };
  const MONTH_RE = '(jan(?:uar|uary)?|jän(?:ner)?|feb(?:ruar|ruary)?|m(?:ä|ae)rz|mär|mrz|mar(?:ch)?|apr(?:il)?|mai|may|jun[ie]?|jul[iy]?|aug(?:ust)?|sept?(?:ember)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dez(?:ember)?|dec(?:ember)?)';

  // ---------- Helpers ----------
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  function normalize(text) {
    let t = String(text || '')
      .replace(/\r/g, '')
      .replace(/[   ]/g, ' ')
      .replace(/[’‘′`´]/g, "'")
      .replace(/[″“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/[：]/g, ':');
    // Common OCR confusions inside numbers: O→0, l/I/|→1, S→5 (only between digits / colons)
    t = t.replace(/(?<=[\d:.,])[Oo](?=[\d:.,\s'"]|$)/gm, '0')
         .replace(/(?<=[\d:])[Oo](?=\d)/g, '0')
         .replace(/(?<=\d)[lI|](?=[\d:.,])/g, '1')
         .replace(/(?<=[:.,])[lI|](?=\d)/g, '1');
    // "5 . 02 km" → "5.02 km",  "26 : 07" → "26:07"
    t = t.replace(/(\d)\s*([.,:])\s+(?=\d)/g, '$1$2').replace(/(\d)\s+([.,:])(?=\d)/g, '$1$2');
    return t;
  }

  function linesOf(text) {
    const lines = normalize(text).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    lines.layout = detectLayout(lines);
    return lines;
  }

  // A line that holds only a value (+ unit), e.g. "5,01", "148 bpm", "0:27:44"
  const VALUE_ONLY = /^[\d.,:'"\s]+(?:\s*(?:km|mi|m|hm|ft|bpm|spm|kcal|cal|min|s|h|%|\/\s*km|\/\s*mi|min\s*\/\s*km))?$/i;
  const isValueOnly = (l) => !!l && /\d/.test(l) && VALUE_ONLY.test(l);
  const isLabelOnly = (l) => !!l && !/\d/.test(l.replace(/\([^)]*\)/g, ''));

  /**
   * Apps put labels either above ("Distanz" ↵ "5,01") or below ("5,01" ↵ "Distanz")
   * their values. Detect which convention the screenshot uses.
   */
  function detectLayout(lines) {
    const anyKw = new RegExp([KW.distance, KW.time, KW.pace, KW.hr, KW.calories, KW.elevation, KW.cadence].map((r) => r.source).join('|'), 'i');
    let below = 0, above = 0;
    lines.forEach((l, j) => {
      if (!isLabelOnly(l) || !anyKw.test(l)) return;
      if (isValueOnly(lines[j - 1])) below++;
      if (isValueOnly(lines[j + 1])) above++;
    });
    return below > above ? 'below' : 'above';
  }

  /** Does a keyword occur in line i or in its label neighbour? Returns a weight. */
  function nearKw(lines, i, re) {
    if (re.test(lines[i])) return 3;
    const pref = lines.layout === 'below' ? 1 : -1;
    const a = lines[i + pref];
    const b = lines[i - pref];
    if (isValueOnly(lines[i])) {
      if (a && isLabelOnly(a) && re.test(a)) return 2;
      if (b && isLabelOnly(b) && re.test(b)) return 1;
      return 0;
    }
    if ((a && re.test(a)) || (b && re.test(b))) return 2;
    return 0;
  }

  /** The label text that describes line i. */
  function labelOf(lines, i) {
    if (!isValueOnly(lines[i])) return lines[i];
    const pref = lines.layout === 'below' ? 1 : -1;
    if (isLabelOnly(lines[i + pref])) return lines[i + pref];
    if (isLabelOnly(lines[i - pref])) return lines[i - pref];
    return '';
  }

  function* matchAll(line, re) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(line))) {
      yield m;
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }

  function best(cands) {
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score || (b.tie || 0) - (a.tie || 0));
    return cands[0];
  }

  // ---------- Duration helpers ----------
  function parseDuration(str) {
    if (str == null) return null;
    const s = String(str).trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d+):([0-5]?\d):([0-5]\d)$/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    m = s.match(/^(\d+):([0-5]\d)$/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:m|min))?\s*(?:(\d+)\s*s)?$/);
    if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    m = s.match(/^\d+(?:[.,]\d+)?$/);
    if (m) return Math.round(num(s) * 60); // bare number = minutes
    return null;
  }

  function formatDuration(sec) {
    if (sec == null || !isFinite(sec)) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  function parsePace(str) {
    if (str == null) return null;
    const s = String(str).trim().replace(/["\s]|min|\/km/gi, '').replace("'", ':');
    const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
    if (m) return +m[1] * 60 + +m[2];
    return null;
  }

  function formatPace(secPerKm) {
    if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '';
    let r = Math.round(secPerKm);
    return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  }

  // ---------- Field extractors ----------
  function findDistance(lines) {
    const cands = [];
    const re = /(?<![\d:.,])(\d{1,3}(?:[.,]\d{1,3})?)\s*(km|kilometer|mi|miles?|meilen)\b(?!\s*\/\s*h)/i;
    lines.forEach((line, i) => {
      for (const m of matchAll(line, re)) {
        const before = line.slice(Math.max(0, m.index - 2), m.index);
        if (/[\/:]\s*$/.test(before)) continue;
        let km = num(m[1]);
        const isMi = /^mi|meil/i.test(m[2]);
        if (isMi) km *= MI;
        if (!(km > 0)) continue;
        let score = nearKw(lines, i, KW.distance);
        if (/[.,]/.test(m[1])) score += 1;
        if (km < 0.2 || km > 120) score -= 4;
        if (KW.pace.test(line) && !KW.distance.test(line)) score -= 1;
        cands.push({ value: Math.round(km * 100) / 100, score, tie: km });
      }
    });
    // Bare number with a separate label, e.g. "Distanz" ↵ "10,02"  or  "3.11" ↵ "Miles"
    lines.forEach((line, i) => {
      const m = line.match(/^(\d{1,3}[.,]\d{1,3})$/);
      if (!m) return;
      const label = labelOf(lines, i);
      const unitMi = /^(miles?|meilen|mi)\b/i.test(label) || /\((mi|miles?)\)/i.test(label);
      if (!(KW.distance.test(label) || unitMi || /^(km|kilometer)\b/i.test(label))) return;
      let km = num(m[1]);
      if (unitMi) km *= MI;
      cands.push({ value: Math.round(km * 100) / 100, score: 3, tie: km });
    });
    return best(cands);
  }

  function findDuration(lines) {
    const cands = [];
    const push = (sec, i, line, idx, len, extra = 0) => {
      if (!(sec >= 60 && sec <= 24 * 3600)) return;
      const after = line.slice(idx + len, idx + len + 10);
      const before = line.slice(Math.max(0, idx - 4), idx);
      if (/^\s*(min)?\s*\/\s*(km|mi|100)/i.test(after)) return; // pace
      if (/^\s*['"]/.test(after) && sec < 3600) return;
      if (/^\s*(uhr|am|pm|a\.m|p\.m)\b/i.test(after)) return; // clock time
      if (/\bum\s*$/i.test(before)) return; // "um 07:30"
      let score = nearKw(lines, i, KW.time) + extra;
      if (KW.moving.test(labelOf(lines, i))) score += 1;
      if (KW.pace.test(labelOf(lines, i)) && !KW.time.test(labelOf(lines, i))) score -= 3;
      if (i <= 1 && score <= 0) score -= 2; // status-bar clock on phone screenshots
      cands.push({ value: sec, score, tie: sec });
    };
    lines.forEach((line, i) => {
      for (const m of matchAll(line, /(?<![\d:.,])(\d{1,2}):([0-5]\d):([0-5]\d)(?![\d:])/)) {
        push(+m[1] * 3600 + +m[2] * 60 + +m[3], i, line, m.index, m[0].length, 1);
      }
      for (const m of matchAll(line, /(?<![\d:.,])(\d{1,3}):([0-5]\d)(?![\d:])(?!\s*[.,]\d)/)) {
        push(+m[1] * 60 + +m[2], i, line, m.index, m[0].length);
      }
      for (const m of matchAll(line, /(?<!\d)(\d{1,2})\s*(?:h|std\.?)\s*(\d{1,2})\s*(?:m|min)\b\.?(?:\s*(\d{1,2})\s*s\b)?/i)) {
        push(+m[1] * 3600 + +m[2] * 60 + (+m[3] || 0), i, line, m.index, m[0].length, 1);
      }
      for (const m of matchAll(line, /(?<![\d:])(\d{1,3})\s*(?:m|min)\s*(\d{1,2})\s*s\b/i)) {
        push(+m[1] * 60 + +m[2], i, line, m.index, m[0].length, 1);
      }
      for (const m of matchAll(line, /(?<![\d:.,])(\d{1,3})\s*(?:min|minuten|minutes)\b(?!\s*\/)/i)) {
        push(+m[1] * 60, i, line, m.index, m[0].length);
      }
    });
    return best(cands);
  }

  function findPace(lines) {
    const cands = [];
    lines.forEach((line, i) => {
      // with explicit unit: 5:12 /km, 5'12" /km, 5:12 min/km, 8:20 /mi
      for (const m of matchAll(line, /(?<![\d:])(\d{1,2})\s*[:']\s*([0-5]\d)\s*"?\s*(?:min)?\s*\/\s*(km|mi)\b/i)) {
        let sec = +m[1] * 60 + +m[2];
        if (/mi/i.test(m[3])) sec /= MI;
        let score = 3 + nearKw(lines, i, KW.pace);
        if (KW.paceBest.test(line) && !KW.avg.test(line)) score -= 3;
        cands.push({ value: Math.round(sec), score });
      }
      // 5'12" without unit (typical watch / Nike)
      for (const m of matchAll(line, /(?<![\d:])(\d{1,2})'\s*([0-5]\d)"/)) {
        let score = 2 + nearKw(lines, i, KW.pace);
        if (KW.paceBest.test(line) && !KW.avg.test(line)) score -= 3;
        cands.push({ value: +m[1] * 60 + +m[2], score });
      }
    });
    // bare m:ss near a pace label, e.g. "Ø Pace" ↵ "5:12"
    lines.forEach((line, i) => {
      const w = nearKw(lines, i, KW.pace);
      if (!w) return;
      for (const m of matchAll(line, /(?<![\d:.,])(\d{1,2}):([0-5]\d)(?![\d:])/)) {
        const min = +m[1];
        if (min < 2 || min > 20) continue;
        const after = line.slice(m.index + m[0].length, m.index + m[0].length + 8);
        if (/^\s*(uhr|am|pm)/i.test(after)) continue;
        let score = w - 1;
        if (KW.time.test(line) && !KW.pace.test(line)) score -= 2;
        if (KW.paceBest.test(line) && !KW.avg.test(line)) score -= 3;
        cands.push({ value: min * 60 + +m[2], score });
      }
    });
    const b = best(cands);
    if (b && b.score > 0) return b;
    // Fallback: speed in km/h → pace
    const sp = [];
    lines.forEach((line, i) => {
      for (const m of matchAll(line, /(\d{1,2}[.,]\d{1,2})\s*km\s*\/\s*h/i)) {
        const v = num(m[1]);
        if (v > 3 && v < 30) sp.push({ value: Math.round(3600 / v), score: 1 + nearKw(lines, i, KW.avg) - (KW.max.test(line) ? 3 : 0) });
      }
    });
    return best(sp) || (b && b.score > -1 ? b : null);
  }

  function findHeartRate(lines) {
    const avg = [];
    const max = [];
    const consider = (v, i, line, baseScore) => {
      if (v < 50 || v > 230) return;
      const label = labelOf(lines, i);
      const isMax = KW.max.test(label) && !KW.avg.test(label);
      const score = baseScore + nearKw(lines, i, KW.hr) + (KW.avg.test(label) ? 1 : 0);
      (isMax ? max : avg).push({ value: v, score });
    };
    lines.forEach((line, i) => {
      for (const m of matchAll(line, /(?<![\d.,:])(\d{2,3})\s*(?:bpm|s\/min|schl[äa]ge(?:\s*\/\s*min)?|♥|❤)/i)) {
        consider(+m[1], i, line, 3);
      }
      if (KW.hr.test(labelOf(lines, i))) {
        for (const m of matchAll(line, /(?<![\d.,:\/])(\d{2,3})(?![\d.,:]|\s*(?:kcal|km|m\b|%|spm|min|s\b|cal))/i)) {
          consider(+m[1], i, line, 0);
        }
      }
    });
    const dedupe = (arr) => best(arr.filter((c) => c.score > 0));
    return { avg: dedupe(avg), max: dedupe(max) };
  }

  function findCalories(lines) {
    const cands = [];
    lines.forEach((line, i) => {
      for (const m of matchAll(line, /(?<![\d.,])(\d{1,2}[.,]\d{3}|\d{1,4})\s*(?:kcal|kalorien|calories|cal)\b/i)) {
        const v = parseInt(m[1].replace(/[.,]/g, ''), 10);
        if (v >= 10 && v <= 10000) cands.push({ value: v, score: 3 + nearKw(lines, i, KW.calories) });
      }
      if (isValueOnly(line) && KW.calories.test(labelOf(lines, i))) {
        const m = line.match(/^(\d{1,2}[.,]\d{3}|\d{2,4})$/);
        if (m) cands.push({ value: parseInt(m[1].replace(/[.,]/g, ''), 10), score: 2 });
      }
    });
    return best(cands);
  }

  function findElevation(lines) {
    const cands = [];
    lines.forEach((line, i) => {
      for (const m of matchAll(line, /(?<![\d.,:])(\d{1,2}[.,]\d{3}|\d{1,4})\s*(hm|m|ft|fuß)\b(?!\s*\/)/i)) {
        const w = nearKw(lines, i, KW.elevation);
        const unit = m[2].toLowerCase();
        if (!w && unit !== 'hm') continue;
        let v = parseInt(m[1].replace(/[.,]/g, ''), 10);
        if (unit === 'ft' || unit === 'fuß') v = Math.round(v * 0.3048);
        if (v > 9000) continue;
        let score = w + (unit === 'hm' ? 3 : 0);
        if (/(abstieg|descent|verlust|loss|min\.?|max\.?|tiefst|höchst)/i.test(line)) score -= 3;
        cands.push({ value: v, score });
      }
    });
    return best(cands.filter((c) => c.score > 0));
  }

  function findCadence(lines) {
    const cands = [];
    lines.forEach((line, i) => {
      for (const m of matchAll(line, /(?<![\d.,])(\d{2,3})\s*(?:spm|schritte\s*\/\s*min|steps\s*\/\s*min|s\/m\b)/i)) {
        const v = +m[1];
        if (v >= 100 && v <= 240) cands.push({ value: v, score: 3 + nearKw(lines, i, KW.cadence) - (KW.max.test(line) ? 3 : 0) });
      }
      if (nearKw(lines, i, KW.cadence) >= 2) {
        const m = line.match(/^(\d{3})$/);
        if (m && +m[1] >= 100 && +m[1] <= 240) cands.push({ value: +m[1], score: 2 });
      }
    });
    return best(cands);
  }

  function findDate(lines, ref) {
    const today = ref ? new Date(ref) : new Date();
    const cands = [];
    const add = (y, mo, d, score) => {
      if (y < 100) y += 2000;
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return;
      const dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1) return;
      if (y < 2000 || dt - today > 36 * 3600 * 1000) return;
      cands.push({ value: iso(dt), score });
    };
    const text = lines.join('\n');
    for (const m of matchAll(text, /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/)) add(+m[1], +m[2], +m[3], 3);
    for (const m of matchAll(text, /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.])/)) add(+m[3], +m[2], +m[1], 3);
    for (const m of matchAll(text, /(?<![\d\/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d\/])/)) {
      const a = +m[1], b = +m[2];
      if (a > 12) add(+m[3], b, a, 2); else add(+m[3], a, b, 2);
    }
    const monthRe = new RegExp(`(?<![\\w])(\\d{1,2})\\.?\\s+${MONTH_RE}\\.?(?:\\s+(\\d{4}))?`, 'i');
    for (const m of matchAll(text, monthRe)) {
      const mo = MONTHS[m[2].toLowerCase().replace('ae', 'ä')] || MONTHS[m[2].toLowerCase().slice(0, 3)];
      let y = m[3] ? +m[3] : today.getFullYear();
      if (!m[3] && new Date(y, mo - 1, +m[1]) - today > 36e5 * 36) y--;
      add(y, mo, +m[1], m[3] ? 3 : 2);
    }
    const monthFirstRe = new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?(?![\\d:])`, 'i');
    for (const m of matchAll(text, monthFirstRe)) {
      const mo = MONTHS[m[1].toLowerCase().replace('ae', 'ä')] || MONTHS[m[1].toLowerCase().slice(0, 3)];
      let y = m[3] ? +m[3] : today.getFullYear();
      if (!m[3] && new Date(y, mo - 1, +m[2]) - today > 36e5 * 36) y--;
      add(y, mo, +m[2], m[3] ? 3 : 2);
    }
    if (/\b(heute|today)\b/i.test(text)) cands.push({ value: iso(today), score: 2 });
    if (/\b(gestern|yesterday)\b/i.test(text)) {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      cands.push({ value: iso(y), score: 2 });
    }
    return best(cands);
  }

  function findType(text) {
    if (/(laufband|treadmill|indoor)/i.test(text)) return 'Laufband';
    if (/\btrail/i.test(text)) return 'Trail';
    if (/(intervall|interval|tempo-?lauf|bahn|track)/i.test(text)) return 'Intervall';
    if (/(wettkampf|race|rennen|marathon|halbmarathon|parkrun)/i.test(text)) return 'Wettkampf';
    if (/(spazier|walk|gehen|wandern|hike)/i.test(text) && !/(lauf|run)/i.test(text)) return 'Gehen';
    return 'Lauf';
  }

  function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------- Main ----------
  /**
   * @param {string} text   raw OCR output
   * @param {object} [opts] { referenceDate: Date }  (for "heute"/missing year)
   */
  function parseRunText(text, opts = {}) {
    const lines = linesOf(text);
    const found = {};
    const source = {};
    const set = (key, cand) => {
      if (cand && cand.value != null) { found[key] = cand.value; source[key] = 'ocr'; }
    };

    set('distanceKm', findDistance(lines));
    set('durationSec', findDuration(lines));
    set('paceSecPerKm', findPace(lines));
    const hr = findHeartRate(lines);
    set('avgHr', hr.avg);
    set('maxHr', hr.max);
    set('calories', findCalories(lines));
    set('elevationM', findElevation(lines));
    set('cadence', findCadence(lines));
    set('date', findDate(lines, opts.referenceDate));
    found.type = findType(lines.join(' '));

    const warnings = [];
    const { distanceKm: d, durationSec: t, paceSecPerKm: p } = found;

    if (d && t && p) {
      const expected = d * p;
      const diff = Math.abs(expected - t) / t;
      if (diff > 0.12) {
        // Which value is the odd one out? Trust the pair that agrees with physical bounds.
        const derivedPace = t / d;
        if (derivedPace >= 150 && derivedPace <= 1200 && Math.abs(derivedPace - p) / p > 0.12) {
          warnings.push('Distanz, Zeit und Pace passen nicht ganz zusammen (evtl. Gesamtzeit inkl. Pausen). Bitte prüfen.');
        }
      }
    } else if (d && t && !p) {
      found.paceSecPerKm = Math.round(t / d); source.paceSecPerKm = 'calc';
    } else if (d && p && !t) {
      found.durationSec = Math.round(d * p); source.durationSec = 'calc';
    } else if (t && p && !d) {
      found.distanceKm = Math.round((t / p) * 100) / 100; source.distanceKm = 'calc';
    }

    if (found.paceSecPerKm && (found.paceSecPerKm < 150 || found.paceSecPerKm > 1200)) {
      warnings.push('Die Pace wirkt unrealistisch – bitte kontrollieren.');
    }
    if (found.avgHr && found.maxHr && found.avgHr > found.maxHr) {
      [found.avgHr, found.maxHr] = [found.maxHr, found.avgHr];
    }

    const core = ['distanceKm', 'durationSec'].filter((k) => found[k] != null).length;
    const recognized = Object.keys(source).length;
    return {
      ...found,
      source,
      warnings,
      recognized,
      isRun: core > 0 || recognized >= 2,
      lines,
    };
  }

  return {
    parseRunText,
    parseDuration,
    formatDuration,
    parsePace,
    formatPace,
    normalize,
    iso,
  };
});
