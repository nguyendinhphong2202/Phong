// Run with:  node --test lauf/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

const REF = new Date(2026, 10, 11); // 11. Nov 2026

test('Strava (Deutsch)', () => {
  const r = P.parseRunText(`9:41
Morgenlauf
8. November 2026 um 07:12 · Berlin
Distanz          Pace           Zeit
10,02 km         5:21 /km       53:38
Höhenmeter       Kalorien       Ø Herzfrequenz
48 m             712 Cal        152 bpm`, { referenceDate: REF });
  assert.equal(r.distanceKm, 10.02);
  assert.equal(r.durationSec, 53 * 60 + 38);
  assert.equal(r.paceSecPerKm, 5 * 60 + 21);
  assert.equal(r.date, '2026-11-08');
  assert.equal(r.calories, 712);
  assert.equal(r.avgHr, 152);
  assert.equal(r.elevationM, 48);
  assert.equal(r.warnings.length, 0);
});

test('Garmin Connect (label under value)', () => {
  const r = P.parseRunText(`Laufen
03.11.2026
5,01
Distanz (km)
0:27:44
Zeit
5:32
Ø Pace (min/km)
148
Ø Herzfrequenz
171
Max. Herzfrequenz
168 spm
Ø Schrittfrequenz
22 m
Anstieg`, { referenceDate: REF });
  assert.equal(r.distanceKm, 5.01);
  assert.equal(r.durationSec, 27 * 60 + 44);
  assert.equal(r.paceSecPerKm, 5 * 60 + 32);
  assert.equal(r.date, '2026-11-03');
  assert.equal(r.avgHr, 148);
  assert.equal(r.maxHr, 171);
  assert.equal(r.cadence, 168);
  assert.equal(r.elevationM, 22);
});

test('Apple Fitness (English, 1h+ run)', () => {
  const r = P.parseRunText(`Outdoor Run
Sun, Oct 26
Workout Time   Distance
1:42:10        21.10KM
Active Calories   Total Calories
1,384CAL          1,560CAL
Avg. Heart Rate   Avg. Pace
158BPM            4'50"/KM
Elevation Gain
112M`, { referenceDate: REF });
  assert.equal(r.distanceKm, 21.1);
  assert.equal(r.durationSec, 3600 + 42 * 60 + 10);
  assert.equal(r.paceSecPerKm, 4 * 60 + 50);
  assert.equal(r.date, '2026-10-26');
  assert.equal(r.calories, 1384);
  assert.equal(r.avgHr, 158);
  assert.equal(r.elevationM, 112);
});

test('Nike Run Club (miles, no time-of-day confusion)', () => {
  const r = P.parseRunText(`Thursday Evening Run
3.11
Miles
8'45"
Avg. Pace
27:12
Time
312
Calories`, { referenceDate: REF });
  assert.equal(r.distanceKm, 5.01);
  assert.equal(r.durationSec, 27 * 60 + 12);
  assert.equal(r.paceSecPerKm, 8 * 60 + 45);
  assert.equal(r.calories, 312);
});

test('Miles are converted to km', () => {
  const r = P.parseRunText('Distance 6.2 mi\nTime 50:00\nPace 8:04 /mi');
  assert.equal(r.distanceKm, 9.98);
  assert.equal(r.paceSecPerKm, Math.round((8 * 60 + 4) / 1.609344));
});

test('Pace derived when missing', () => {
  const r = P.parseRunText('Lauf\n8,00 km\nDauer 40:00');
  assert.equal(r.paceSecPerKm, 300);
  assert.equal(r.source.paceSecPerKm, 'calc');
});

test('Distance derived from duration and pace', () => {
  const r = P.parseRunText('Zeit 1:00:00\nØ Tempo 6:00 /km');
  assert.equal(r.distanceKm, 10);
  assert.equal(r.source.distanceKm, 'calc');
});

test('Splits table does not override total distance', () => {
  const r = P.parseRunText(`Distanz 7,45 km  Zeit 38:20
Splits
1 km 5:10 /km
2 km 5:08 /km
3 km 5:15 /km`);
  assert.equal(r.distanceKm, 7.45);
  assert.equal(r.durationSec, 38 * 60 + 20);
});

test('Status bar clock and start time are not taken as duration', () => {
  const r = P.parseRunText(`14:05
Abendlauf · heute um 18:30 Uhr
6,3 km
Bewegungszeit 34:51`, { referenceDate: REF });
  assert.equal(r.durationSec, 34 * 60 + 51);
  assert.equal(r.date, '2026-11-11');
});

test('Common OCR confusions (O → 0, l → 1)', () => {
  const r = P.parseRunText('Distanz 1O,O5 km\nZeit 5l:2O');
  assert.equal(r.distanceKm, 10.05);
  assert.equal(r.durationSec, 51 * 60 + 20);
});

test('"1h 05min" style and kcal with thousands separator', () => {
  const r = P.parseRunText('Training\nDauer 1h 05min 12s\n12,5 km\n1.023 kcal');
  assert.equal(r.durationSec, 3600 + 5 * 60 + 12);
  assert.equal(r.calories, 1023);
});

test('Speed km/h falls back to pace', () => {
  const r = P.parseRunText('Ø Geschwindigkeit 12,0 km/h\nDistanz 6,0 km');
  assert.equal(r.paceSecPerKm, 300);
  assert.equal(r.distanceKm, 6);
});

test('Non-run photo yields nothing useful', () => {
  const r = P.parseRunText('Einkaufsliste\nMilch\nBrot\nÄpfel');
  assert.equal(r.isRun, false);
  assert.equal(r.recognized, 0);
});

test('Duration helpers', () => {
  assert.equal(P.parseDuration('1:02:03'), 3723);
  assert.equal(P.parseDuration('45:10'), 2710);
  assert.equal(P.parseDuration('1h 5m'), 3900);
  assert.equal(P.parseDuration('30'), 1800);
  assert.equal(P.formatDuration(3723), '1:02:03');
  assert.equal(P.formatDuration(2710), '45:10');
  assert.equal(P.parsePace("5'12\""), 312);
  assert.equal(P.formatPace(312), '5:12');
});
