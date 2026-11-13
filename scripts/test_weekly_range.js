const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { summarize, eachDay, unionWeekDates, gapsBetween, addDays } = require("../weekly-range.js");

const report = JSON.parse(readFileSync("data/weekly-top.json", "utf8"));
const records = JSON.parse(readFileSync("data/weekly-records.json", "utf8"));

function datesOf(view) {
  return eachDay(view.start, view.end);
}

function expectView(region, view) {
  const got = summarize(records.regions[region], datesOf(view));
  assert.equal(got.events, view.events, view.id);
  assert.equal(got.included_decks, view.included_decks, view.id);
  assert.equal(got.champions, view.champions, view.id);
  assert.equal(got.runners_up, view.runners_up, view.id);
  assert.equal(got.quarantined_decks, view.quarantined_decks, view.id);
  assert.equal(got.isolated_decks, view.isolated_decks, view.id);
  assert.equal(got.unconfirmed_decks, view.unconfirmed_decks, view.id);
  assert.equal(got.sum_matches_denominator, true, view.id);
  const expected = new Map(view.groups.map((group) => [group.name, [group.total, group.champion, group.runner_up, group.percent]]));
  const actual = new Map(got.groups.map((group) => [group.name, [group.total, group.champion, group.runner_up, group.percent]]));
  assert.deepEqual(actual, expected, view.id);
}

test("每个已发布周次和特别窗口都能用单套记录重算出来", () => {
  Object.entries(report.regions).forEach(([region, blob]) => {
    blob.weeks.concat(blob.special_windows).forEach((view) => expectView(region, view));
  });
});

test("只取周内一天，不会把整周套数加进去", () => {
  const japan = report.regions["日本"];
  const week = japan.weeks.find((view) => view.included_decks > 0);
  const one = summarize(records.regions["日本"], [week.start]);
  assert.ok(one.included_decks < week.included_decks);
});

test("不相邻的两周不把中间周算进去", () => {
  const weeks = report.regions["日本"].weeks.filter((view) => view.included_decks > 0);
  const left = weeks[weeks.length - 3];
  const gap = weeks[weeks.length - 2];
  const right = weeks[weeks.length - 1];
  const selected = unionWeekDates([left, right]);
  const gapDays = eachDay(gap.start, gap.end);
  assert.equal(selected.some((day) => gapDays.includes(day)), false);
  const union = summarize(records.regions["日本"], selected);
  assert.equal(union.included_decks, left.included_decks + right.included_decks);
  const holes = gapsBetween([left, right], report.regions["日本"].weeks);
  assert.ok(holes.some((item) => item.id === gap.id));
});

test("同一周再叠加里面的特别窗口不会重复计数", () => {
  const japan = report.regions["日本"];
  const window = japan.special_windows.find((view) => view.included_decks > 0);
  const week = japan.weeks.find((view) => view.start <= window.start && view.end >= window.end);
  const union = summarize(records.regions["日本"], unionWeekDates([week, window]));
  assert.equal(union.included_decks, week.included_decks);
  assert.equal(union.events, week.events);
});

test("空区间和单日都能算", () => {
  const empty = summarize(records.regions["日本"], []);
  assert.equal(empty.included_decks, 0);
  assert.equal(empty.chart_empty, true);
  const day = summarize(records.regions["日本"], ["2026-11-10"]);
  assert.equal(day.date_count, 1);
  assert.equal(day.start, "2026-11-10");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
