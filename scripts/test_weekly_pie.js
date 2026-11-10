const assert = require("node:assert/strict");
const test = require("node:test");
const { layoutPie, hitSector, CARD_ASPECT } = require("../weekly-pie.js");

function group(name, total, extra) {
  return Object.assign({ name, total, percent: "", cards: [], unconfirmed: false }, extra || {});
}

test("扇区角度按套数分配，总和为一圈", () => {
  const layout = layoutPie([
    group("甲", 33, { percent: "22.8" }),
    group("乙", 24, { percent: "16.6" }),
    group("丙", 21, { percent: "14.5" }),
  ], { minSweep: 0 });
  const total = 78;
  assert.equal(layout.total, total);
  layout.sectors.forEach((sector) => {
    assert.ok(Math.abs(sector.sweep / (Math.PI * 2) - sector.total / total) < 1e-12);
  });
  const sweep = layout.sectors.reduce((sum, sector) => sum + sector.sweep, 0);
  assert.ok(Math.abs(sweep - Math.PI * 2) < 1e-9);
  assert.equal(layout.sectors[0].labelText, "33套 · 22.8%");
});

test("没有算出来的占比不编一个百分数", () => {
  const layout = layoutPie([group("甲", 3, { percent: "" }), group("乙", 1)], { minSweep: 0 });
  assert.equal(layout.sectors[0].labelText, "3套");
  assert.equal(layout.sectors[0].percent, "");
  assert.equal(layoutPie([group("甲", 3, { percent: "约两成" })]).sectors[0].percent, "");
});

test("没有代表机体的扇区不配图，双核心保留两张卡号", () => {
  const layout = layoutPie([
    group("未知", 4, { unconfirmed: true }),
    group("红白", 10, { cards: [{ card_id: "GD05-033", name: "尊者高达" }, { card_id: "GD05-066", name: "闪光高达" }] }),
  ], { minSweep: 0 });
  assert.equal(layout.sectors[0].parts.length, 0);
  assert.equal(layout.sectors[0].unconfirmed, true);
  assert.deepEqual(layout.sectors[1].parts.map((part) => part.cardId), ["GD05-033", "GD05-066"]);
});

test("裁切矩形保持卡图比例并盖住扇区", () => {
  const layout = layoutPie([
    group("甲", 10, { cards: [{ card_id: "GD05-017", name: "ν高达" }] }),
    group("乙", 3, { cards: [{ card_id: "ST02-001", name: "飞翼高达" }, { card_id: "GD05-067", name: "飞翼高达零式（EW）" }] }),
  ], { width: 560, height: 460, cx: 250, cy: 230, r: 132, minSweep: 0 });
  layout.sectors.forEach((sector) => {
    sector.parts.forEach((part) => {
      assert.ok(Math.abs(part.width / part.height - CARD_ASPECT) < 1e-9);
      const steps = 8;
      for (let i = 0; i <= steps; i += 1) {
        const theta = part.start + ((part.end - part.start) * i) / steps;
        const x = layout.cx + Math.cos(theta) * layout.r;
        const y = layout.cy + Math.sin(theta) * layout.r;
        assert.ok(x >= part.x - 0.5 && x <= part.x + part.width + 0.5);
        assert.ok(y >= part.y - 0.5 && y <= part.y + part.height + 0.5);
      }
    });
  });
});

test("小扇区不标外侧数字，留下来的标签互不重叠", () => {
  const groups = [group("大组", 40, { percent: "40.0", cards: [{ card_id: "GD05-002", name: "强袭自由高达" }] })];
  for (let i = 0; i < 12; i += 1) groups.push(group("小组" + i, 5, { percent: "5.0" }));
  const layout = layoutPie(groups, {
    width: 440,
    height: 400,
    cx: 214,
    cy: 196,
    r: 102,
    minSweep: 0.42,
    maxLabelShift: 18,
    fontSize: 12,
  });
  const shown = layout.sectors.filter((sector) => sector.showLabel);
  assert.ok(shown.some((sector) => sector.name === "大组"));
  assert.equal(shown.some((sector) => sector.total === 5), false);
  ["left", "right"].forEach((side) => {
    const labels = shown.filter((sector) => (sector.label.anchor === "start") === (side === "right"));
    labels.sort((a, b) => a.label.y - b.label.y);
    for (let i = 1; i < labels.length; i += 1) {
      assert.ok(labels[i].label.y - labels[i - 1].label.y >= labels[i].label.height + 5);
    }
  });
});

test("点击落在扇区内部才命中对应体系", () => {
  const layout = layoutPie([
    group("甲", 3),
    group("乙", 1),
  ], { width: 560, height: 460, cx: 250, cy: 230, r: 120, minSweep: 0 });
  const first = layout.sectors[0];
  const mid = (first.start + first.end) / 2;
  const x = layout.cx + Math.cos(mid) * layout.r * 0.55;
  const y = layout.cy + Math.sin(mid) * layout.r * 0.55;
  assert.equal(hitSector(layout, x, y).name, "甲");
  assert.equal(hitSector(layout, 0, 0), null);
});
