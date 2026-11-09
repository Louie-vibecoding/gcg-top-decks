(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WeeklyPie = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CARD_ASPECT = 600 / 838;

  function layoutPie(groups, options) {
    const opt = options || {};
    const width = opt.width || 560;
    const height = opt.height || 460;
    const cx = opt.cx == null ? width / 2 : opt.cx;
    const cy = opt.cy == null ? height / 2 : opt.cy;
    const r = opt.r || 132;
    const cardAspect = opt.cardAspect || CARD_ASPECT;
    const usable = (groups || []).filter((group) => group && group.total > 0);
    const total = usable.reduce((sum, group) => sum + group.total, 0);
    const layout = { width, height, cx, cy, r, total, cardAspect, sectors: [] };
    if (!total) return layout;

    let angle = -Math.PI / 2;
    layout.sectors = usable.map((group) => {
      const sweep = (group.total / total) * Math.PI * 2;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      const cards = (group.cards || []).filter((card) => card && card.card_id).slice(0, 2);
      const percent = percentText(group.percent);
      return {
        name: group.name || "",
        total: group.total,
        percent,
        unconfirmed: Boolean(group.unconfirmed),
        start,
        end,
        sweep,
        fullCircle: sweep > Math.PI * 2 - 1e-3,
        parts: splitParts(cx, cy, r, start, end, cards, cardAspect),
        labelText: percent ? group.total + "套 · " + percent + "%" : group.total + "套",
        showLabel: false,
        label: null,
      };
    });
    placeLabels(layout.sectors, {
      cx,
      cy,
      r,
      width,
      height,
      minSweep: opt.minSweep == null ? 0.18 : opt.minSweep,
      maxLabelShift: opt.maxLabelShift == null ? 26 : opt.maxLabelShift,
      labelGap: opt.labelGap == null ? 6 : opt.labelGap,
      labelHeight: opt.labelHeight == null ? 16 : opt.labelHeight,
      fontSize: opt.fontSize || 13,
    });
    return layout;
  }

  function percentText(value) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value);
    return /^\d+(\.\d+)?$/.test(text) ? text : "";
  }

  function splitParts(cx, cy, r, start, end, cards, aspect) {
    if (!cards.length) return [];
    if (cards.length === 1) return [part(cx, cy, r, start, end, cards[0], aspect)];
    const mid = (start + end) / 2;
    return [
      part(cx, cy, r, start, mid, cards[0], aspect),
      part(cx, cy, r, mid, end, cards[1], aspect),
    ];
  }

  function part(cx, cy, r, start, end, card, aspect) {
    const sweep = Math.max(end - start, 1e-6);
    const mid = (start + end) / 2;
    const alpha = sweep / 2;
    const dist = (2 * r * Math.sin(alpha)) / (3 * alpha);
    const px = cx + Math.cos(mid) * dist;
    const py = cy + Math.sin(mid) * dist;
    let coverH = 1;
    wedgePoints(cx, cy, r, start, end).forEach((point) => {
      coverH = Math.max(coverH, Math.abs(point[1] - py) * 2, (Math.abs(point[0] - px) * 2) / aspect);
    });
    coverH *= 1.02;
    const coverW = coverH * aspect;
    return {
      cardId: card.card_id,
      name: card.name || card.card_id,
      start,
      end,
      x: px - coverW / 2,
      y: py - coverH / 2,
      width: coverW,
      height: coverH,
    };
  }

  function wedgePoints(cx, cy, r, start, end) {
    const points = [[cx, cy]];
    const steps = Math.max(2, Math.ceil((end - start) / (Math.PI / 24)));
    for (let i = 0; i <= steps; i += 1) {
      const theta = start + ((end - start) * i) / steps;
      points.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
    }
    return points;
  }

  function textWidth(text, fontSize) {
    let width = 0;
    for (const ch of String(text)) width += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.62;
    return width;
  }

  function placeLabels(sectors, opt) {
    const sides = { left: [], right: [] };
    sectors.forEach((sector) => {
      if (sector.sweep < opt.minSweep) return;
      const mid = (sector.start + sector.end) / 2;
      sector._mid = mid;
      sector._side = Math.cos(mid) >= 0 ? "right" : "left";
      sector._idealY = opt.cy + Math.sin(mid) * (opt.r + 20);
      sector._y = sector._idealY;
      sides[sector._side].push(sector);
    });
    Object.keys(sides).forEach((side) => {
      const items = sides[side].sort((a, b) => a._y - b._y);
      const step = opt.labelHeight + opt.labelGap;
      for (let i = 1; i < items.length; i += 1) {
        if (items[i]._y < items[i - 1]._y + step) items[i]._y = items[i - 1]._y + step;
      }
      const maxY = opt.height - 14;
      if (items.length && items[items.length - 1]._y > maxY) {
        items[items.length - 1]._y = maxY;
        for (let i = items.length - 2; i >= 0; i -= 1) {
          if (items[i]._y > items[i + 1]._y - step) items[i]._y = items[i + 1]._y - step;
        }
      }
      items.forEach((sector) => {
        const width = textWidth(sector.labelText, opt.fontSize);
        const anchor = side === "right" ? "start" : "end";
        const x = side === "right" ? opt.cx + opt.r + 26 : opt.cx - opt.r - 26;
        const left = anchor === "end" ? x - width : x;
        const right = left + width;
        const inside = left >= 2 && right <= opt.width - 2 && sector._y >= 16 && sector._y <= opt.height - 8;
        if (!inside || Math.abs(sector._y - sector._idealY) > opt.maxLabelShift) {
          sector.showLabel = false;
          sector.label = null;
          return;
        }
        const arcX = opt.cx + Math.cos(sector._mid) * opt.r;
        const arcY = opt.cy + Math.sin(sector._mid) * opt.r;
        const outX = opt.cx + Math.cos(sector._mid) * (opt.r + 12);
        const outY = opt.cy + Math.sin(sector._mid) * (opt.r + 12);
        sector.showLabel = true;
        sector.label = {
          text: sector.labelText,
          x,
          y: sector._y,
          anchor,
          width,
          height: opt.labelHeight,
          leader: [arcX, arcY, outX, outY, x + (side === "right" ? -6 : 6), sector._y - 4],
        };
      });
    });
    sectors.forEach((sector) => {
      delete sector._mid;
      delete sector._side;
      delete sector._idealY;
      delete sector._y;
    });
  }

  function hitSector(layout, x, y) {
    if (!layout || !layout.sectors.length) return null;
    const dx = x - layout.cx;
    const dy = y - layout.cy;
    if (Math.hypot(dx, dy) > layout.r) return null;
    let angle = Math.atan2(dy, dx);
    if (angle < -Math.PI / 2) angle += Math.PI * 2;
    return layout.sectors.find((sector) => angle >= sector.start - 1e-6 && angle <= sector.end + 1e-6) || null;
  }

  return { CARD_ASPECT, layoutPie, hitSector };
});
