(() => {
  "use strict";

  const PAGE_SIZE = 20;
  const CARD_IMG = "https://gcg-stats.com/images/cards/{CARD_ID}.webp";

  const TYPE_LABELS = {
    NTC: "NTC",
    SERIAL: "编号卡",
    TOURNAMENT: "锦标赛",
    CS: "民间CS",
  };

  const TYPE_BADGE_CLASS = {
    NTC: "badge-ntc",
    SERIAL: "badge-serial",
    TOURNAMENT: "badge-tournament",
    CS: "badge-cs",
  };

  // Fixed color order for sorting 卡组类型 options
  const DECK_TYPE_ORDER = ["红", "蓝", "绿", "白", "紫"];

  const state = {
    region: "all",
    month: "",
    eventType: "",
    deckType: "",
    page: 1,
    allEvents: [],
    filtered: [],
  };

  const el = {
    status: document.getElementById("status"),
    empty: document.getElementById("empty-state"),
    list: document.getElementById("event-list"),
    pagination: document.getElementById("pagination"),
    month: document.getElementById("month-filter"),
    type: document.getElementById("type-filter"),
    deckType: document.getElementById("deck-type-filter"),
    chinaNote: document.getElementById("china-note"),
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cardImageUrl(cardId) {
    return CARD_IMG.replace("{CARD_ID}", encodeURIComponent(cardId));
  }

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  async function loadAllData() {
    const [japan, china, eu, japanCs] = await Promise.all([
      loadJson("data/japan-events.json"),
      loadJson("data/china.json"),
      loadJson("data/eu.json"),
      loadJson("data/japan-cs.json"),
    ]);

    // Tag CS events if any; keep empty for now
    const csTagged = (japanCs || []).map((e) => ({
      ...e,
      event_type: e.event_type || "CS",
      region_tag: e.region_tag || "日本",
    }));

    const events = [
      ...(china || []),
      ...(japan || []),
      ...(eu || []),
      ...csTagged,
    ];

    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.id || "").localeCompare(b.id || "");
    });

    // 丢弃没有任何牌表/卡组图的场次（如仅有选手名的欧美 NTC）
    state.allEvents = events.filter((e) => {
      const placements = e.placements || [];
      return placements.some((p) => {
        if (Array.isArray(p.cards) && p.cards.length > 0) return true;
        if (p.deck_photo || p.photo) return true;
        return false;
      });
    });
    const kept = state.allEvents;
    return {
      japan: kept.filter((e) => (e.region_tag || e.region) === "日本").length,
      china: kept.filter((e) => (e.region_tag || e.region) === "中国").length,
      eu: kept.filter((e) => (e.region_tag || e.region) === "欧美").length,
      japanCs: kept.filter((e) => e.event_type === "CS").length,
      total: kept.length,
      dropped: events.length - kept.length,
    };
  }

  function populateMonthOptions() {
    const months = new Set();
    for (const e of state.allEvents) {
      if (e.month) months.add(e.month);
      else if (e.date) months.add(e.date.slice(0, 7));
    }
    const sorted = [...months].sort().reverse();
    el.month.innerHTML =
      '<option value="">全部月份</option>' +
      sorted
        .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
        .join("");
  }

  function deckTypeSortKey(label) {
    // Sort by first color in fixed order, then second, then length
    const chars = [...String(label || "")];
    const idxs = chars.map((c) => {
      const i = DECK_TYPE_ORDER.indexOf(c);
      return i === -1 ? 99 : i;
    });
    while (idxs.length < 3) idxs.push(99);
    return idxs.join("-") + "-" + chars.length;
  }

  function populateDeckTypeOptions() {
    if (!el.deckType) return;
    const types = new Set();
    for (const e of state.allEvents) {
      for (const p of e.placements || []) {
        if (p.deck_type && placementHasDeck(p)) types.add(p.deck_type);
      }
    }
    const sorted = [...types].sort((a, b) =>
      deckTypeSortKey(a).localeCompare(deckTypeSortKey(b))
    );
    const prev = state.deckType;
    el.deckType.innerHTML =
      '<option value="">全部</option>' +
      sorted
        .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join("");
    if (prev && types.has(prev)) {
      el.deckType.value = prev;
      state.deckType = prev;
    } else {
      state.deckType = "";
    }
  }

  function matchesRegion(event) {
    if (state.region === "all") return true;
    const tag = event.region_tag || event.region || "";
    return tag === state.region;
  }

  function matchesMonth(event) {
    if (!state.month) return true;
    const m = event.month || (event.date ? event.date.slice(0, 7) : "");
    return m === state.month;
  }

  function matchesType(event) {
    if (!state.eventType) return true;
    return event.event_type === state.eventType;
  }

  /** 有卡表（卡号+数量）或卡组实物图才算可用 */
  function placementHasDeck(p) {
    if (!p) return false;
    if (Array.isArray(p.cards) && p.cards.length > 0) return true;
    if (p.deck_photo || p.photo) return true;
    return false;
  }

  /** 整场至少有一个冠/亚有牌表或图，否则不展示 */
  function eventHasDeckInfo(event) {
    const placements = event.placements || [];
    return placements.some(placementHasDeck);
  }

  function placementMatchesDeckType(p) {
    if (!state.deckType) return true;
    return p && p.deck_type === state.deckType;
  }

  /** Visible placements for an event under current filters (deck info + deck type). */
  function visiblePlacements(event) {
    return (event.placements || [])
      .filter(placementHasDeck)
      .filter(placementMatchesDeckType)
      .slice()
      .sort((a, b) => (a.rank || 99) - (b.rank || 99));
  }

  function applyFilters() {
    state.filtered = state.allEvents
      .filter(
        (e) =>
          eventHasDeckInfo(e) &&
          matchesRegion(e) &&
          matchesMonth(e) &&
          matchesType(e)
      )
      .map((e) => {
        if (!state.deckType) return e;
        const placements = visiblePlacements(e);
        if (!placements.length) return null;
        return { ...e, placements };
      })
      .filter(Boolean);
    state.page = 1;
    render();
  }

  function emptyMessage() {
    if (state.region === "欧美") {
      return {
        title: "暂无匹配欧美赛事",
        body: "仅展示有牌表或卡组图的场次；可调整月份或类型筛选。",
      };
    }
    if (state.region === "日本" && state.eventType === "CS") {
      return {
        title: "暂无匹配的民间 CS",
        body: "当前筛选下没有≥50人的日本民间 CS。可切换月份或清空类型筛选。",
      };
    }
    if (state.eventType === "CS" && !state.filtered.length) {
      return {
        title: "暂无匹配的民间 CS",
        body: "当前筛选下没有≥50人的日本民间 CS。可切换月份或清空类型筛选。",
      };
    }
    if (state.region === "中国" && !state.filtered.length) {
      return {
        title: "中国区信息较少",
        body: "完整赛果与卡组请使用「万代卡牌」App 查询；也可调整月份或类型筛选。",
      };
    }
    return {
      title: "暂无匹配赛事",
      body: "试试调整地区、月份、赛事类型或卡组类型筛选。",
    };
  }

  function renderCardGrid(cards) {
    if (!cards || !cards.length) return "";
    return (
      '<div class="card-grid">' +
      cards
        .map((c) => {
          const id = c.card_id || "";
          const count = c.count ?? "";
          return (
            `<div class="card-cell">` +
            `<img loading="lazy" decoding="async" src="${escapeHtml(cardImageUrl(id))}" alt="${escapeHtml(id)}" />` +
            `<div class="card-id">${escapeHtml(id)}</div>` +
            `<div class="card-count">×${escapeHtml(count)}</div>` +
            `</div>`
          );
        })
        .join("") +
      "</div>"
    );
  }

  const placementCardStore = new Map();
  let placementSeq = 0;

  function renderPlacement(p) {
    const rankClass = p.rank === 1 ? "rank-1" : "rank-2";
    const rankText = p.rank === 1 ? "冠军" : "亚军";
    const hasCards = Array.isArray(p.cards) && p.cards.length > 0;
    const photo = p.deck_photo;
    const note = p.photo_note || (photo && !hasCards ? "牌表为实物图，OCR 待补" : "");

    let body = "";
    let storeKey = "";
    if (hasCards) {
      storeKey = `p${++placementSeq}`;
      placementCardStore.set(storeKey, p.cards);
      body = `<div class="deck-cards" data-pending="1"></div>`;
    } else if (photo) {
      body =
        (note ? `<p class="photo-note">${escapeHtml(note)}</p>` : "") +
        `<div class="deck-photo-wrap"><img src="${escapeHtml(photo)}" alt="${escapeHtml(p.deck_name || rankText)}" loading="lazy" /></div>`;
    } else {
      body = `<p class="photo-note">暂无牌表</p>`;
    }

    const keyAttr = storeKey ? ` data-store-key="${storeKey}"` : "";

    const typeBadge = p.deck_type
      ? `<span class="deck-type-badge" title="卡组类型">${escapeHtml(p.deck_type)}</span>`
      : "";

    return (
      `<div class="placement"${keyAttr}>` +
      `<div class="placement-head">` +
      `<span class="rank-label ${rankClass}">${rankText}</span>` +
      (p.player_name
        ? `<span class="player-name">${escapeHtml(p.player_name)}</span>`
        : "") +
      typeBadge +
      (p.deck_name
        ? `<span class="deck-name">${escapeHtml(p.deck_name)}</span>`
        : "") +
      `</div>${body}</div>`
    );
  }

  function renderEvent(event) {
    const type = event.event_type || "";
    const badgeClass = TYPE_BADGE_CLASS[type] || "badge-other";
    const badgeLabel = TYPE_LABELS[type] || type || "未知";
    const venue = event.store_name || event.event_name || event.series_name || "—";
    const area = event.area || "";
    const entrants = event.entrants ? `${event.entrants}人` : "";
    const nameLine = event.event_name || event.series_name || "";
    const placements = (event.placements || [])
      .slice()
      .sort((a, b) => (a.rank || 99) - (b.rank || 99));

    return (
      `<article class="event-card" data-event-id="${escapeHtml(event.id || "")}">` +
      `<button type="button" class="event-summary" aria-expanded="false">` +
      `<span class="event-date">${escapeHtml(event.date || "")}</span>` +
      `<div class="event-meta">` +
      `<span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>` +
      `<span class="event-venue">${escapeHtml(venue)}</span>` +
      (area ? `<span class="event-area">· ${escapeHtml(area)}</span>` : "") +
      (entrants ? `<span class="event-area">· ${escapeHtml(entrants)}</span>` : "") +
      `<span class="chevron" aria-hidden="true">▼</span>` +
      `</div>` +
      (nameLine && nameLine !== venue
        ? `<div class="event-name-line">${escapeHtml(nameLine)}</div>`
        : "") +
      `</button>` +
      `<div class="event-detail">` +
      `<div class="placements">${placements.filter(placementHasDeck).map(renderPlacement).join("")}</div>` +
      (event.source_url
        ? `<a class="source-link" href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener noreferrer">来源链接 ↗</a>`
        : "") +
      `</div></article>`
    );
  }

  function hydrateExpandedDecks(card) {
    card.querySelectorAll(".placement[data-store-key]").forEach((placement) => {
      const pending = placement.querySelector(".deck-cards[data-pending]");
      if (!pending) return;
      const key = placement.getAttribute("data-store-key");
      const cards = placementCardStore.get(key) || [];
      pending.outerHTML = renderCardGrid(cards);
      placement.removeAttribute("data-store-key");
      placementCardStore.delete(key);
    });
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) {
      el.pagination.classList.add("hidden");
      el.pagination.innerHTML = "";
      return;
    }
    el.pagination.classList.remove("hidden");
    el.pagination.innerHTML =
      `<button type="button" data-page-action="prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button>` +
      `<span class="page-info">${state.page} / ${totalPages}</span>` +
      `<button type="button" data-page-action="next" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>`;
  }

  function render() {
    if (el.chinaNote) {
      el.chinaNote.classList.toggle("hidden", state.region !== "中国");
    }

    const total = state.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = state.filtered.slice(start, start + PAGE_SIZE);

    // Special empty states for EU / CS even when filter yields zero
    const showEuEmpty = state.region === "欧美";
    const showCsEmpty =
      state.eventType === "CS" &&
      !pageItems.length &&
      (state.region === "all" || state.region === "日本");

    if (!pageItems.length) {
      const msg = emptyMessage();
      el.empty.classList.remove("hidden");
      el.empty.innerHTML = `<strong>${escapeHtml(msg.title)}</strong><span>${escapeHtml(msg.body)}</span>`;
      el.list.innerHTML = "";
      // Still show EU empty when on EU tab
      if (showEuEmpty || showCsEmpty || true) {
        /* empty already set */
      }
    } else {
      el.empty.classList.add("hidden");
      el.empty.innerHTML = "";
      placementCardStore.clear();
      el.list.innerHTML = pageItems.map(renderEvent).join("");
    }

    const regionLabel =
      state.region === "all" ? "全部" : state.region;
    el.status.textContent = `共 ${total} 场赛事 · 当前：${regionLabel} · 第 ${state.page}/${totalPages} 页（每页 ${PAGE_SIZE}）`;

    renderPagination(totalPages);
  }

  function bindUI() {
    document.querySelectorAll(".region-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".region-tabs .tab").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        state.region = btn.dataset.region;
        applyFilters();
      });
    });

    el.month.addEventListener("change", () => {
      state.month = el.month.value;
      applyFilters();
    });

    el.type.addEventListener("change", () => {
      state.eventType = el.type.value;
      applyFilters();
    });

    if (el.deckType) {
      el.deckType.addEventListener("change", () => {
        state.deckType = el.deckType.value;
        applyFilters();
      });
    }

    el.list.addEventListener("click", (ev) => {
      const summary = ev.target.closest(".event-summary");
      if (!summary) return;
      const card = summary.closest(".event-card");
      if (!card) return;
      const open = card.classList.toggle("open");
      summary.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) hydrateExpandedDecks(card);
    });

    el.pagination.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-page-action]");
      if (!btn || btn.disabled) return;
      const action = btn.dataset.pageAction;
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
      if (action === "prev" && state.page > 1) state.page -= 1;
      if (action === "next" && state.page < totalPages) state.page += 1;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function init() {
    bindUI();
    try {
      const counts = await loadAllData();
      populateMonthOptions();
      populateDeckTypeOptions();
      applyFilters();
      console.info(
        `[gcg-preview] loaded japan=${counts.japan} china=${counts.china} eu=${counts.eu} cs=${counts.japanCs} total=${counts.total}`
      );
    } catch (err) {
      el.status.textContent = "数据加载失败：" + (err.message || err);
      el.empty.classList.remove("hidden");
      el.empty.innerHTML =
        "<strong>无法加载数据</strong><span>请确认通过本地 HTTP 服务打开（不要用 file://）。</span>";
      console.error(err);
    }
  }

  init();
})();
