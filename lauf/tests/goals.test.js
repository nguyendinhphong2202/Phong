// Run with:  node --test lauf/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../goals.js');

const TODAY = new Date(2026, 10, 11); // Mittwoch, 11. Nov 2026
const goal = (text) => G.finalize(G.parseGoalText(text, TODAY), TODAY);

test('Natürliche Eingabe: Beispiele aus der Praxis', () => {
  assert.deepEqual(G.parseGoalText('60km diese Woche', TODAY), { metric: 'km', target: 60, period: 'week', recurring: false });
  assert.deepEqual(G.parseGoalText('10 km heute', TODAY), { metric: 'km', target: 10, period: 'day', recurring: false });
  assert.deepEqual(G.parseGoalText('3 Läufe pro Woche', TODAY), { metric: 'runs', target: 3, period: 'week', recurring: true });
  assert.deepEqual(G.parseGoalText('100 km diesen Monat', TODAY), { metric: 'km', target: 100, period: 'month', recurring: false });
  assert.deepEqual(G.parseGoalText('1000 km dieses Jahr', TODAY), { metric: 'km', target: 1000, period: 'year', recurring: false });
  assert.deepEqual(G.parseGoalText('5 Stunden im Monat', TODAY), { metric: 'time', target: 18000, period: 'month', recurring: false });
  assert.deepEqual(G.parseGoalText('jeden Tag 30 min', TODAY), { metric: 'time', target: 1800, period: 'day', recurring: true });
  assert.deepEqual(G.parseGoalText('25,5 km wöchentlich', TODAY), { metric: 'km', target: 25.5, period: 'week', recurring: true });
});

test('Einzellauf-Ziele und Datumsangaben', () => {
  assert.deepEqual(G.parseGoalText('Halbmarathon bis 31.12.', TODAY),
    { metric: 'single', target: 21.1, period: 'custom', recurring: false, start: '2026-11-11', end: '2026-12-31' });
  assert.deepEqual(G.parseGoalText('einen 15-km-Lauf bis Sonntag', TODAY),
    { metric: 'single', target: 15, period: 'custom', recurring: false, start: '2026-11-11', end: '2026-11-15' });
  assert.deepEqual(G.parseGoalText('8 km morgen', TODAY),
    { metric: 'km', target: 8, period: 'custom', recurring: false, start: '2026-11-12', end: '2026-11-12' });
  const nw = G.parseGoalText('40 km nächste Woche', TODAY);
  assert.equal(nw.start, '2026-11-16');
  assert.equal(G.parseGoalText('Lauf über 12 km', TODAY).metric, 'single');
});

test('Unbrauchbare Eingabe', () => {
  assert.equal(G.parseGoalText('mehr laufen', TODAY), null);
  assert.equal(G.parseGoalText('', TODAY), null);
});

test('Einmalige Ziele werden auf ihren Zeitraum festgelegt', () => {
  const g = goal('60 km diese Woche');
  assert.equal(g.start, '2026-11-09');
  assert.equal(g.end, '2026-11-15');
  const d = goal('10 km heute');
  assert.equal(d.start, '2026-11-11');
  assert.equal(d.end, '2026-11-11');
  const r = goal('3 Läufe pro Woche');
  assert.equal(r.start, undefined); // wiederkehrend → immer aktuelle Woche
});

test('Fortschritt, Restmenge und Soll-Stand', () => {
  const runs = [
    { date: '2026-11-09', distanceKm: 10, durationSec: 3000 },
    { date: '2026-11-10', distanceKm: 12.5, durationSec: 3900 },
    { date: '2026-11-08', distanceKm: 20, durationSec: 6600 }, // Vorwoche
    { date: '2026-11-11', distanceKm: 3, type: 'Gehen' },     // zählt nicht
  ];
  const p = G.progress(goal('60 km diese Woche'), runs, TODAY);
  assert.equal(p.value, 22.5);
  assert.equal(p.remaining, 37.5);
  assert.equal(p.status, 'active');
  assert.equal(p.daysLeft, 5); // Mi–So
  assert.equal(p.perDay, 7.5);
  assert.ok(Math.abs(p.expected - 60 * 2 / 7) < 1e-9); // Mo + Di abgeschlossen

  const runsGoal = G.progress(goal('2 Läufe pro Woche'), runs, TODAY);
  assert.equal(runsGoal.status, 'done');

  const single = G.progress(goal('einen 12-km-Lauf bis Sonntag'), runs, TODAY);
  assert.equal(single.status, 'active'); // 12,5 km war am 10. – vor dem Start des Ziels (11.)

  const past = G.finalize({ metric: 'km', target: 50, period: 'week', start: '2026-11-02' }, TODAY);
  const pp = G.progress(past, runs, TODAY);
  assert.equal(pp.status, 'missed');
  assert.equal(pp.value, 20);
});

test('Beschreibung', () => {
  assert.equal(G.describe(goal('60 km diese Woche'), TODAY), '60 km diese Woche');
  assert.equal(G.describe(goal('10 km heute'), TODAY), '10 km heute');
  assert.equal(G.describe(goal('3 Läufe pro Woche'), TODAY), '3 Läufe pro Woche');
  assert.equal(G.describe(goal('5 h im Monat'), TODAY), '5 h Laufzeit diesen Monat');
  assert.equal(G.describe(goal('Halbmarathon bis 31.12.'), TODAY), 'Ein Lauf über 21,1 km bis 31. Dez.');
  assert.equal(G.describe(goal('8 km morgen'), TODAY), '8 km morgen');
  // ein einmaliges Ziel aus der Vorwoche
  const g = goal('60 km diese Woche');
  assert.equal(G.describe(g, new Date(2026, 10, 20)), '60 km in KW 46');
});
