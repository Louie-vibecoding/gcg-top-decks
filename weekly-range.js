(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WeeklyRange = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  function percentOf(numerator, denominator) {
    if (denominator <= 0) return "";
    const rounded = Math.floor((numerator * 2000 + denominator) / (denominator * 2));
    return (rounded / 10).toFixed(1);
  }

  function parseDay(value) {
    if (!ISO_DAY.test(value || "")) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return value;
  }

  function addDays(iso, count) {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + count));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function eachDay(start, end) {
    if (!parseDay(start) || !parseDay(end) || start > end) return [];
    const days = [];
    let cursor = start;
    while (cursor <= end) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return days;
  }

  function weekDates(week) {
    return eachDay(week.start, week.end);
  }

  function unionWeekDates(weeks) {
    const dates = new Set();
    (weeks || []).forEach((week) => weekDates(week).forEach((day) => dates.add(day)));
    return [...dates].sort();
  }

  function gapsBetween(selectedWeeks, allWeeks) {
    const chosen = (selectedWeeks || []).filter((week) => week && week.kind !== "special");
    if (chosen.length < 2) return [];
    const starts = chosen.map((week) => week.start).sort();
    const selected = new Set(chosen.map((week) => week.id));
    return (allWeeks || [])
      .filter((week) => week.kind !== "special" && week.start > starts[0] && week.start < starts[starts.length - 1] && !selected.has(week.id))
      .map((week) => ({ id: week.id, start: week.start, end: week.end }));
  }

  function summarize(pack, dates) {
    const wanted = new Set(dates || []);
    const seen = new Set();
    const chosen = [];
    (pack && pack.records ? pack.records : []).forEach((row) => {
      if (!row || !wanted.has(row.date)) return;
      const key = [row.strong_event_id || "", row.player || "", String(row.rank)].join("\u0001");
      if (seen.has(key)) return;
      seen.add(key);
      chosen.push(row);
    });
    const included = chosen.filter((row) => row.status === "included");
    const quarantined = chosen.filter((row) => row.status === "quarantined");
    const isolated = chosen.filter((row) => row.status === "isolated");
    const grouped = new Map();
    included.forEach((row) => {
      const name = row.archetype || "";
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(row);
    });
    const reps = (pack && pack.representatives) || {};
    const groups = [...grouped.entries()].map(([name, rows]) => {
      const cards = ((reps[name] || {}).cards || []).map((card) => ({
        card_id: card.card_id,
        name_zh: card.name_zh || "",
      }));
      return {
        name,
        unconfirmed: Boolean(rows[0].unconfirmed),
        total: rows.length,
        champion: rows.filter((row) => row.rank === 1).length,
        runner_up: rows.filter((row) => row.rank === 2).length,
        percent: percentOf(rows.length, included.length),
        representative: cards.length ? { cards } : null,
        decks: rows
          .slice()
          .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.rank || 99) - (b.rank || 99) || (a.player || "").localeCompare(b.player || ""))
          .map((row) => ({
            event_id: row.event_id || "",
            date: row.date || "",
            store: row.store || "店铺未标注",
            player: row.player || "",
            rank: row.rank,
            event_type: row.event_type || "",
            source_url: row.source_url || "",
          })),
      };
    });
    groups.sort((a, b) => b.total - a.total || b.champion - a.champion || a.name.localeCompare(b.name, "zh"));
    const eventIds = (rows) => new Set(rows.map((row) => row.event_id).filter(Boolean)).size;
    const days = [...wanted].sort();
    return {
      kind: "custom",
      start: days[0] || "",
      end: days[days.length - 1] || "",
      date_count: days.length,
      events: eventIds(included),
      raw_events: eventIds(chosen),
      raw_decks: chosen.length,
      included_decks: included.length,
      champions: included.filter((row) => row.rank === 1).length,
      runners_up: included.filter((row) => row.rank === 2).length,
      unconfirmed_decks: included.filter((row) => row.unconfirmed).length,
      quarantined_decks: quarantined.length,
      isolated_decks: isolated.length,
      denominator: included.length,
      group_total_sum: groups.reduce((sum, group) => sum + group.total, 0),
      groups,
      quarantine: quarantined.map((row) => ({
        date: row.date || "",
        store: row.store || "",
        player: row.player || "",
        stored_rank: row.rank,
        reason: row.quarantine_reason || "",
        verification: row.verification || "实际冠亚口径未核实",
        would_be_archetype: row.archetype || "",
        source_url: row.source_url || "",
        official_url: row.official_url || "",
        gcg_stats_url: row.gcg_stats_url || "",
        secondary_url: row.secondary_url || "",
        chart_included: false,
      })),
      isolated: isolated.map((row) => ({
        date: row.date || "",
        store: row.store || "",
        player: row.player || "",
        reason: row.isolate_reason || "",
        reason_zh: row.reason_zh || row.isolate_reason || "",
        source_url: row.source_url || "",
        verification: "未核实",
        chart_included: false,
      })),
      chart_empty: groups.length === 0,
      sum_matches_denominator: groups.reduce((sum, group) => sum + group.total, 0) === included.length,
    };
  }

  return { parseDay, addDays, eachDay, weekDates, unionWeekDates, gapsBetween, summarize, percentOf };
});
