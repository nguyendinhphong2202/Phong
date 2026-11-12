// WHOOP-style activity screenshots (OCR output), multi-photo merging and tile reconstruction.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

const REF = new Date(2026, 10, 11);

const WHOOP_EN = `9:41
RUNNING
Today
6:02 AM - 6:49 AM
12.4
STRAIN
DURATION
47:12
CALORIES
512
AVG HR
152
MAX HR
178
HEART RATE ZONES
ZONE 5 (178-197 bpm) 0:00 0%
ZONE 4 (159-177 bpm) 4:10 9%
ZONE 3 (141-158 bpm) 21:48 46%
ZONE 2 (122-140 bpm) 15:02 32%
ZONE 1 (104-121 bpm) 5:12 11%
ZONE 0 1:00 2%`;

test('WHOOP (English): strain, duration, HR, calories, zones – zone legends are ignored', () => {
  const r = P.parseRunText(WHOOP_EN, { referenceDate: REF });
  assert.equal(r.app, 'WHOOP');
  assert.equal(r.strain, 12.4);
  assert.equal(r.durationSec, 47 * 60 + 12);
  assert.equal(r.calories, 512);
  assert.equal(r.avgHr, 152);
  assert.equal(r.maxHr, 178);
  assert.equal(r.startTime, '06:02');
  assert.equal(r.date, '2026-11-11');
  assert.equal(r.zones.length, 6);
  assert.deepEqual(r.zones.find((z) => z.zone === 3), { zone: 3, sec: 21 * 60 + 48, pct: 46 });
  assert.equal(r.type, 'Lauf');
});

const WHOOP_DE_1 = `Laufen
Mi., 11. Nov.
06:02 – 06:49
12,4
Belastung
47:12
Dauer
512
Kalorien
152
Ø Herzfrequenz
178
Max. Herzfrequenz`;
const WHOOP_DE_2 = `Herzfrequenzzonen
Zone 5  90–100 %  0:00
Zone 4  80–90 %  4:10
Zone 3  70–80 %  21:48
Zone 2  60–70 %  15:02
Zone 1  50–60 %  5:12`;
const WHOOP_DE_3 = `Distanz 8,21 km
Dauer 47:12
Tempo 5:45 /km`;

test('WHOOP (Deutsch, Werte über der Beschriftung) in drei Screenshots → eine Einheit', () => {
  const r = P.parseRunText([WHOOP_DE_1, WHOOP_DE_2, WHOOP_DE_3], { referenceDate: REF });
  assert.equal(r.strain, 12.4);
  assert.equal(r.durationSec, 2832);
  assert.equal(r.calories, 512);
  assert.equal(r.avgHr, 152);
  assert.equal(r.maxHr, 178);
  assert.equal(r.distanceKm, 8.21);
  assert.equal(r.paceSecPerKm, 345);
  assert.equal(r.date, '2026-11-11');
  assert.equal(r.zones.length, 5);
  const z3 = r.zones.find((z) => z.zone === 3);
  assert.equal(z3.sec, 1308);
  assert.ok(Math.abs(z3.pct - 47.1) < 0.2, `pct ${z3.pct}`); // computed from the zone times; ranges "70–80 %" ignored
  assert.equal(r.warnings.length, 0);
});

test('Only a single photo of the set: the others still parse on their own', () => {
  const r = P.parseRunText(WHOOP_DE_2);
  assert.equal(r.durationSec, 2772); // sum of zone times
  assert.equal(r.source.durationSec, 'calc');
  assert.equal(r.avgHr, undefined); // zone ranges are never taken as heart rate
});

test('Duration from a start–end clock range', () => {
  assert.equal(P.parseRunText('Running\n6:02 AM - 6:49 AM\n10.8 Strain').durationSec, 47 * 60);
  assert.equal(P.parseRunText('Lauf\n18:30 bis 19:15 Uhr').durationSec, 45 * 60);
  assert.equal(P.parseRunText('Run\n11:30 - 12:15 PM').durationSec, 45 * 60);
  assert.equal(P.parseRunText('Run\n11:30 - 12:15 PM').startTime, '11:30');
  assert.equal(P.parseRunText('Run\n11:50 PM - 12:20 AM').durationSec, 30 * 60);
});

test('Day strain or strain target is not the activity strain', () => {
  const r = P.parseRunText('Day Strain 15.8\nActivity\n12.1\nStrain\nOptimal Strain 14.0 - 16.5');
  assert.equal(r.strain, 12.1);
});

test('Tile reconstruction pairs labels with values via word positions', () => {
  const W = (text, x0, x1, y0, y1) => ({ text, bbox: { x0, x1, y0, y1 } });
  const words = [
    W('AVG', 50, 100, 100, 120), W('HR', 106, 130, 100, 120), W('MAX', 400, 450, 100, 120), W('HR', 456, 480, 100, 120), W('CALORIES', 700, 850, 100, 120),
    W('152', 60, 120, 130, 180), W('178', 410, 470, 130, 180), W('512', 720, 800, 130, 180),
    W('4:10', 60, 130, 300, 350), W('ZONE', 60, 120, 360, 380), W('4', 126, 136, 360, 380),
  ];
  const synthetic = P.cellsToLines(words);
  assert.deepEqual(synthetic.split('\n').slice(0, 3), ['AVG HR 152', 'MAX HR 178', 'CALORIES 512']);
  // Row-wise OCR alone loses the pairing; together with the rebuilt tiles it is right
  const r = P.parseRunText(['AVG HR MAX HR CALORIES\n152 178 512', synthetic]);
  assert.equal(r.avgHr, 152);
  assert.equal(r.maxHr, 178);
  assert.equal(r.calories, 512);
});

test('Zones list with OCR-garbled zone numbers is completed from its neighbours', () => {
  const text = `HEART RATE ZONES
ZONE 5
90-100% 9      0:00   0%
ZONE A   ®     4:10   9%
ZU aa          21:48 46%
ZONE 2  Ga     15:02  32%
En  ®          5:12   11%
ZONEO 8        1:00   2%
0-50%`;
  const r = P.parseRunText(text);
  assert.deepEqual(r.zones.map((z) => [z.zone, z.sec, z.pct]), [[0, 60, 2], [1, 312, 11], [2, 902, 32], [3, 1308, 46], [4, 250, 9], [5, 0, 0]]);
});
