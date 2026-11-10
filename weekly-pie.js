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
      const cards = (group.cards || []).filter((card) => card && card.card_id).slice(0, 2).map((card) => {
        const known = focusFor(card.card_id);
        return {
          card_id: card.card_id,
          name: card.name,
          focusX: card.focusX == null ? known.x : card.focusX,
          focusY: card.focusY == null ? known.y : card.focusY,
        };
      });
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
      focusX: card.focusX,
      focusY: card.focusY,
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

  // Head rectangle on the full card, read off the print: [left, top, right, bottom].
  // These are the whole head (crest through chin), not a single point on the chest.
  const HEAD_BOX = {
    "GD05-033": [0.14, 0.29, 0.38, 0.46],
    "GD05-066": [0.50, 0.11, 0.76, 0.30],
    "GD05-017": [0.32, 0.22, 0.56, 0.39],
    "GD05-029": [0.26, 0.09, 0.48, 0.25],
    "ST13-001": [0.46, 0.13, 0.64, 0.34],
    "GD05-049": [0.32, 0.05, 0.48, 0.25],
    "GD05-002": [0.30, 0.16, 0.50, 0.35],
    "ST04-001": [0.38, 0.19, 0.62, 0.38],
    "GD06-033": [0.40, 0.05, 0.64, 0.24],
    "GD06-064": [0.40, 0.10, 0.62, 0.35],
    "ST11-009": [0.22, 0.12, 0.74, 0.40],
    "GD02-054": [0.30, 0.14, 0.48, 0.30],
    "ST02-001": [0.24, 0.28, 0.42, 0.44],
    "GD05-067": [0.42, 0.16, 0.58, 0.28],
    "GD06-041": [0.48, 0.18, 0.68, 0.34],
    "GD06-034": [0.20, 0.34, 0.44, 0.50],
    "GD06-036": [0.42, 0.15, 0.60, 0.32],
    "GD04-050": [0.42, 0.30, 0.64, 0.48],
    "GD06-050": [0.60, 0.20, 0.80, 0.38],
    "ST14-006": [0.66, 0.30, 0.94, 0.50],
    "GD06-003": [0.32, 0.07, 0.56, 0.26],
    "GD05-004": [0.46, 0.06, 0.70, 0.26],
    "GD05-003": [0.40, 0.16, 0.64, 0.34],
    "GD04-006": [0.30, 0.20, 0.54, 0.40],
  };
  // 5:4 avatar: fraction width / fraction height on a 600×838 card.
  const FRAME_RATIO = (5 / 4) * (838 / 600);

  function focusFor(cardId) {
    const box = HEAD_BOX[cardId];
    if (!box) return { x: 0.5, y: 0.32, measured: false };
    return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, measured: true };
  }

  function fitHeadBox(box) {
    const hh = box[3] - box[1];
    const hw = box[2] - box[0];
    let winH = hh / 0.46;
    let winW = winH * FRAME_RATIO;
    if (hw / 0.5 > winW) {
      winW = hw / 0.5;
      winH = winW / FRAME_RATIO;
    }
    // A head wider than the card (Kapool's dome) cannot stay at 46% of a
    // 5:4 window. Shrink to the largest on-card window and keep the ratio,
    // so the crest-to-chin box stays inside instead of getting clamped flat.
    if (winW > 1 || winH > 1) {
      const scale = Math.min(1 / winW, 1 / winH);
      winW *= scale;
      winH *= scale;
    }
    let wy0 = box[1] - 0.24 * winH;
    let wx0 = (box[0] + box[2]) / 2 - winW / 2;
    let wy1 = wy0 + winH;
    let wx1 = wx0 + winW;
    if (wx0 < 0) { wx1 -= wx0; wx0 = 0; }
    if (wy0 < 0) { wy1 -= wy0; wy0 = 0; }
    if (wx1 > 1) { wx0 -= wx1 - 1; wx1 = 1; }
    if (wy1 > 1) { wy0 -= wy1 - 1; wy1 = 1; }
    return {
      x0: Math.max(0, wx0),
      y0: Math.max(0, wy0),
      x1: Math.min(1, wx1),
      y1: Math.min(1, wy1),
    };
  }

  function frameWindow(cardId) {
    if (HEAD_BOX[cardId]) return fitHeadBox(HEAD_BOX[cardId]);
    const winW = 0.72;
    const winH = winW / FRAME_RATIO;
    return { x0: (1 - winW) / 2, y0: 0.1, x1: (1 + winW) / 2, y1: 0.1 + winH };
  }

  function avatarFrame(cardId) {
    const win = frameWindow(cardId);
    const spanX = win.x1 - win.x0;
    const spanY = win.y1 - win.y0;
    return {
      x0: win.x0,
      y0: win.y0,
      x1: win.x1,
      y1: win.y1,
      fw: 100 / spanX,
      left: (-win.x0 / spanX) * 100,
      top: (-win.y0 / spanY) * 100,
      measured: Boolean(HEAD_BOX[cardId]),
    };
  }

  function clampUnit(value) {
    return Math.min(1, Math.max(0, value));
  }

  // Card-aspect crop. Measured heads keep the whole crest-to-chin box inside
  // the source. The wedge may still clip it; the legend uses avatarFrame.
  function sourceCrop(imgW, imgH, focusX, focusY, sweep, cardId) {
    const box = HEAD_BOX[cardId];
    let frac;
    let cx;
    let cy;
    if (box) {
      const padX = (box[2] - box[0]) * 0.28;
      const padTop = (box[3] - box[1]) * 0.4;
      const padBot = (box[3] - box[1]) * 0.7;
      const x0 = box[0] - padX;
      const y0 = box[1] - padTop;
      const x1 = box[2] + padX;
      const y1 = box[3] + padBot;
      frac = Math.min(0.7, Math.max(x1 - x0, y1 - y0, 0.34));
      cx = (Math.max(0, x0) + Math.min(1, x1)) / 2;
      cy = (Math.max(0, y0) + Math.min(1, y1)) / 2;
    } else {
      frac = 0.58;
      cx = 0.5;
      cy = 0.34;
    }
    let sx = cx - frac / 2;
    let sy = cy - frac / 2;
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + frac > 1) sx = 1 - frac;
    if (sy + frac > 1) sy = 1 - frac;
    if (box) {
      if (sx > box[0]) sx = Math.max(0, box[0] - 0.02);
      if (sy > box[1]) sy = Math.max(0, box[1] - 0.02);
      if (sx + frac < box[2]) frac = Math.min(1, box[2] - sx + 0.02);
      if (sy + frac < box[3]) frac = Math.min(1, box[3] - sy + 0.02);
      if (sx + frac > 1) sx = 1 - frac;
      if (sy + frac > 1) sy = 1 - frac;
    }
    return {
      sx: sx * imgW,
      sy: sy * imgH,
      sw: frac * imgW,
      sh: frac * imgH,
      focusX: clampUnit(cx),
      focusY: clampUnit(cy),
    };
  }

  return { CARD_ASPECT, HEAD_BOX, layoutPie, hitSector, focusFor, sourceCrop, frameWindow, avatarFrame };
});
