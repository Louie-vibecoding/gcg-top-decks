(() => {
  "use strict";

  const REGION_ORDER = ["日本", "中国", "欧美"];
  const ROLE = { rule_core: "规则核心", cooccurring_unit: "同场机体", unconfirmed_unit: "待确认机体" };
  const imageCache = new Map();
  let chartToken = 0;

  const state = { report: null, region: "日本", viewId: "" };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, location.origin);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch (err) {
      return "";
    }
    return "";
  }

  function cardImage(cardId) {
    if (!/^[A-Z]{1,4}\d{0,2}-\d{3}$/.test(cardId || "")) return "";
    const embedded = window.__CARD_DATA__ && window.__CARD_DATA__[cardId];
    if (embedded) return embedded;
    return `weekly-cards/${cardId}.webp`;
  }

  function loadCard(cardId) {
    const src = cardImage(cardId);
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    const pending = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth ? img : null);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, pending);
    return pending;
  }

  function displayName(card) {
    return card.name_zh || card.name_en || card.card_id;
  }

  function avgCopies(card) {
    if (!card.decks_with_card) return "";
    return (card.copies_sum / card.decks_with_card).toFixed(1);
  }

  function viewsOf(region) {
    const pack = state.report.regions[region];
    const weeks = pack.weeks.slice().reverse();
    return {
      complete: weeks.filter((week) => week.complete),
      partial: weeks.filter((week) => !week.complete),
      special: pack.special_windows || [],
    };
  }

  function flatViews(region) {
    const groups = viewsOf(region);
    return [...groups.complete, ...groups.partial, ...groups.special];
  }

  function findView(region, viewId) {
    return flatViews(region).find((view) => view.id === viewId) || null;
  }

  function currentView() {
    return findView(state.region, state.viewId);
  }

  function optionLabel(view) {
    if (view.kind === "special") return `${view.title} · 不是整周 · 纳入 ${view.included_decks} 套`;
    const flag = view.complete ? "完整周" : "非完整周";
    return `${view.start} 至 ${view.end} · ${flag} · 纳入 ${view.included_decks} 套`;
  }

  function renderSwitch() {
    const regionHost = $("region-switch");
    regionHost.innerHTML = REGION_ORDER.filter((name) => state.report.regions[name]).map((name) => {
      const selected = name === state.region;
      return `<button type="button" role="tab" data-region="${escapeHtml(name)}" aria-selected="${selected ? "true" : "false"}">${escapeHtml(name)}</button>`;
    }).join("");

    const groups = viewsOf(state.region);
    const groupHtml = (label, views) => views.length
      ? `<optgroup label="${escapeHtml(label)}">${views.map((view) => `<option value="${escapeHtml(view.id)}"${view.id === state.viewId ? " selected" : ""}>${escapeHtml(optionLabel(view))}</option>`).join("")}</optgroup>`
      : "";
    $("view-select").innerHTML = groupHtml("完整周", groups.complete) + groupHtml("非完整周", groups.partial) + groupHtml("特别窗口（不是整周总数）", groups.special);
  }

  function renderBanner(view) {
    const host = $("banner");
    const windows = state.report.regions[state.region].special_windows || [];
    const contained = view.kind === "week"
      ? windows.find((item) => item.start >= view.start && item.end <= view.end)
      : null;
    let html = "";
    if (view.kind === "special") {
      html = `<p><strong>特别窗口，不是完整周。</strong> ${escapeHtml(view.note || view.coverage_note)} 原始 ${view.raw_decks} 套，保守口径纳入 ${view.included_decks} 套。</p>`;
    } else if (!view.complete) {
      html = `<p><strong>这一档不是完整周。</strong> ${escapeHtml(view.coverage_note)}</p>`;
    } else if (contained) {
      html = `<p>这是 ${escapeHtml(view.start)} 至 ${escapeHtml(view.end)} 的完整周总数。其中 ${escapeHtml(contained.start)} 至 ${escapeHtml(contained.end)} 另有特别窗口，两套数字不能互相代替。</p><button type="button" class="nav-btn" data-open-view="${escapeHtml(contained.id)}">查看特别窗口</button>`;
    }
    host.hidden = !html;
    host.innerHTML = html;
  }

  function metric(label, lines, wide) {
    const body = (Array.isArray(lines) ? lines : [lines])
      .map((line) => `<span class="metric-line">${escapeHtml(line)}</span>`)
      .join("");
    return `<div class="metric${wide ? " metric-wide" : ""}"><span>${escapeHtml(label)}</span><strong>${body}</strong></div>`;
  }

  function timeLines(label) {
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (北京时间)$/.exec(label || "");
    if (!match) return [label || ""];
    return [`${match[1]} ${match[2]}`, match[3]];
  }

  function renderSummary(view) {
    const meta = state.report.meta;
    const kind = view.kind === "special" ? "特别窗口" : (view.complete ? "完整周" : "非完整周");
    $("summary").hidden = false;
    $("distribution").hidden = false;
    $("method").hidden = false;
    $("summary").innerHTML = [
      metric("日期", [view.start, `至 ${view.end}`], true),
      metric("地区", [state.region, kind], true),
      metric("纳入样本", `${view.included_decks} 套`),
      metric("冠军 / 亚军", `${view.champions} / ${view.runners_up}`),
      metric("赛事", `${view.events} 场`),
      metric("体系待确认", `${view.unconfirmed_decks} 套`),
      metric("名次争议", `${view.quarantined_decks} 套`),
      metric("异常隔离", `${view.isolated_decks} 套`),
      metric("更新时间", timeLines(meta.generated_at_label), true),
    ].join("");
  }

  function figure(card) {
    const src = cardImage(card.card_id);
    const name = displayName(card);
    const avg = avgCopies(card);
    const img = src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(name + " " + card.card_id)}" width="600" height="838" decoding="sync" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'img-fallback',textContent:this.alt}))" />`
      : `<div class="img-fallback">${escapeHtml(card.card_id)}</div>`;
    return { img, caption: `<figcaption><span class="role">${escapeHtml(ROLE[card.role] || "机体")}</span><span class="cname">${escapeHtml(name)}</span><span class="cid">${escapeHtml(card.card_id)}${avg ? ` · 平均 ${escapeHtml(avg)} 张` : ""}</span><span class="mini">${escapeHtml(String(card.decks_with_card))}/${escapeHtml(String(card.group_size))} 套有这张</span></figcaption>` };
  }

  function artOf(group) {
    const rep = group.representative || {};
    const cards = rep.cards || [];
    if (!cards.length) {
      return `<div class="rep-note rep-note-only"><strong>没有可用的双机体代表</strong><p>${escapeHtml(rep.reason || "")}</p></div>`;
    }
    const drawn = cards.map(figure);
    let frame = drawn.map((item) => item.img).join("");
    if (cards.length === 1) {
      frame += `<div class="rep-note"><strong>没有第二台</strong><p>另一台没有通过同场、投入和外挂检验。不用驾驶员凑数。</p></div>`;
    }
    const captions = drawn.map((item) => item.caption).join("") + (cards.length === 1 ? "<figcaption></figcaption>" : "");
    const together = rep.co_occurrence
      ? `<p class="mini">两台同场 ${escapeHtml(String(rep.co_occurrence.decks))}/${escapeHtml(String(rep.co_occurrence.group_size))} 套</p>`
      : "";
    return `<div class="art"><div class="art-frame">${frame}</div><div class="captions">${captions}</div>${together}</div>`;
  }

  function tile(group, className) {
    const badges = [
      group.unconfirmed ? `<span class="badge warn">体系待确认</span>` : "",
      group.ambiguous ? `<span class="badge warn">多规则未硬判</span>` : "",
      group.representative && group.representative.mode === "single_core" ? `<span class="badge">单核心</span>` : "",
    ].join("");
    return `<button type="button" class="tile ${className}" data-group="${escapeHtml(group.name)}">
      <div class="tile-body">
        ${artOf(group)}
        <div class="copy">
          <h3>${escapeHtml(group.name)}</h3>
          <div class="badges">${badges}</div>
          <p class="count-xl">${escapeHtml(String(group.total))}<small>套</small></p>
          <p>冠军 ${escapeHtml(String(group.champion))} · 亚军 ${escapeHtml(String(group.runner_up))}${group.percent ? ` · 占纳入样本 ${escapeHtml(group.percent)}%` : ""}</p>
          <p class="reason">${escapeHtml((group.representative && group.representative.reason) || "")}</p>
        </div>
      </div>
    </button>`;
  }

  function renderDistribution(view) {
    const host = $("distribution");
    if (view.chart_empty) {
      host.innerHTML = `<h2>体系分布</h2><p class="hint">按纳入套数排列。空周不补百分比。</p><div class="rep-note rep-note-only"><strong>这一档没有分布图</strong><p>${escapeHtml(view.chart_empty_reason || "")}</p></div>`;
      return;
    }
    const lead = [];
    const mid = [];
    const rest = [];
    view.groups.forEach((group, index) => {
      if (index < 2 && group.total >= 8) lead.push(group);
      else if (index < 6 && group.total >= 3) mid.push(group);
      else rest.push(group);
    });
    const band = (title, note, groups, className) => groups.length
      ? `<h3 class="band-title">${escapeHtml(title)}</h3>${note ? `<p class="band-title">${escapeHtml(note)}</p>` : ""}${groups.map((group) => tile(group, className)).join("")}`
      : "";
    host.innerHTML = `<h2>体系分布</h2><p class="hint">各组套数之和 ${view.group_total_sum} = 分母 ${view.denominator}。点击一组可看里面的赛事和来源。图是机体，不是驾驶员。</p><div class="dist">${band("套数较多", "只按样本套数分栏，不是强度", lead, "lead")}${band("中间数量", "", mid, "mid")}${band("其余分布", "", rest, "rest")}</div>`;
  }

  function legendIcon(card) {
    const src = cardImage(card.card_id);
    const name = displayName(card);
    if (!src) return `<span class="pie-ph">无图</span>`;
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" width="600" height="838" decoding="sync" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pie-ph',textContent:this.alt}))" />`;
  }

  function pieSpec() {
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    return mobile
      ? { width: 440, height: 400, cx: 214, cy: 196, r: 102, minSweep: 0.42, maxLabelShift: 18, fontSize: 12 }
      : { width: 640, height: 520, cx: 320, cy: 260, r: 150, minSweep: 0.2, maxLabelShift: 24, fontSize: 13 };
  }

  function drawPie(canvas, layout, images) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.aspectRatio = `${layout.width} / ${layout.height}`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, layout.width, layout.height);
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    let missing = 0;

    function clipWedge(start, end, full) {
      ctx.beginPath();
      if (full) {
        ctx.arc(layout.cx, layout.cy, layout.r, 0, Math.PI * 2);
      } else {
        ctx.moveTo(layout.cx, layout.cy);
        ctx.arc(layout.cx, layout.cy, layout.r, start, end);
      }
      ctx.closePath();
      ctx.clip();
    }

    layout.sectors.forEach((sector) => {
      if (!sector.parts.length) {
        ctx.save();
        clipWedge(sector.start, sector.end, sector.fullCircle);
        ctx.fillStyle = "#e7eef6";
        ctx.fillRect(layout.cx - layout.r, layout.cy - layout.r, layout.r * 2, layout.r * 2);
        if (sector.sweep > 0.55) {
          const mid = (sector.start + sector.end) / 2;
          const dist = layout.r * 0.55;
          ctx.fillStyle = "#8a4b12";
          ctx.font = `700 12px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("待确认", layout.cx + Math.cos(mid) * dist, layout.cy + Math.sin(mid) * dist);
        }
        ctx.restore();
        return;
      }
      sector.parts.forEach((part) => {
        const image = images.get(part.cardId);
        ctx.save();
        clipWedge(part.start, part.end, sector.fullCircle && sector.parts.length === 1);
        if (!image) {
          missing += 1;
          ctx.fillStyle = "#e7eef6";
          ctx.fillRect(part.x, part.y, part.width, part.height);
          ctx.fillStyle = "#10233f";
          ctx.font = `700 11px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(part.name, part.x + part.width / 2, part.y + part.height / 2);
        } else {
          ctx.drawImage(image, part.x, part.y, part.width, part.height);
        }
        ctx.restore();
      });
    });

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.lineJoin = "round";
    layout.sectors.forEach((sector) => {
      ctx.beginPath();
      if (sector.fullCircle) {
        ctx.arc(layout.cx, layout.cy, layout.r, 0, Math.PI * 2);
      } else {
        ctx.moveTo(layout.cx, layout.cy);
        ctx.arc(layout.cx, layout.cy, layout.r, sector.start, sector.end);
        ctx.closePath();
      }
      ctx.stroke();
      if (sector.parts.length === 2) {
        const mid = (sector.start + sector.end) / 2;
        ctx.beginPath();
        ctx.moveTo(layout.cx, layout.cy);
        ctx.lineTo(layout.cx + Math.cos(mid) * layout.r, layout.cy + Math.sin(mid) * layout.r);
        ctx.stroke();
      }
    });

    ctx.strokeStyle = "#7d91ab";
    ctx.fillStyle = "#10233f";
    ctx.lineWidth = 1;
    ctx.font = `600 ${pieSpec().fontSize}px ${font}`;
    ctx.textBaseline = "middle";
    layout.sectors.forEach((sector) => {
      if (!sector.showLabel || !sector.label) return;
      const [x1, y1, x2, y2, x3, y3] = sector.label.leader;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.stroke();
      ctx.textAlign = sector.label.anchor === "end" ? "end" : "start";
      ctx.fillText(sector.label.text, sector.label.x, sector.label.y);
    });
    canvas._pieLayout = layout;
    canvas.dataset.ready = "1";
    canvas.dataset.missing = String(missing);
  }

  async function renderChart(view) {
    const host = $("chart");
    const token = ++chartToken;
    if (!view.groups.length) {
      host.innerHTML = "";
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const spec = pieSpec();
    const input = view.groups.map((group) => ({
      name: group.name,
      total: group.total,
      percent: group.percent,
      unconfirmed: group.unconfirmed,
      cards: (((group.representative || {}).cards) || []).map((card) => ({ card_id: card.card_id, name: displayName(card) })),
    }));
    const layout = WeeklyPie.layoutPie(input, spec);
    const legend = view.groups.map((group) => {
      const cards = ((group.representative || {}).cards) || [];
      const icons = cards.length
        ? cards.map(legendIcon).join("")
        : `<span class="pie-ph">${group.unconfirmed ? "待确认" : "无代表机体"}</span>`;
      const badge = group.unconfirmed ? `<span class="badge warn">待确认</span>` : "";
      const num = `${group.total}套${group.percent ? ` · ${group.percent}%` : ""}`;
      return `<button type="button" class="pie-legend-item" data-group="${escapeHtml(group.name)}" role="listitem"><span class="pie-icons">${icons}</span><span class="pie-name">${escapeHtml(group.name)} ${badge}</span><span class="pie-num">${escapeHtml(num)}</span></button>`;
    }).join("");
    host.innerHTML = `<h2>样本占比</h2><p class="hint">实心扇区面积按纳入套数。图是该组选出的机体；双色优先同一卡表里的两台核心，没有第二台或未知体系时不配凑数图。外侧只标放得下的套数和占比，小扇区看右侧图例。点击扇区或图例可看赛事来源。</p><div class="chart-layout"><div class="pie-stage"><canvas class="pie-canvas" role="img" aria-label="按纳入套数划分的实心饼图，扇区用机体卡图填满"></canvas></div><div class="pie-legend" role="list">${legend}</div></div>`;
    const canvas = host.querySelector("canvas");
    const ids = [];
    layout.sectors.forEach((sector) => sector.parts.forEach((part) => ids.push(part.cardId)));
    const loaded = await Promise.all(ids.map((cardId) => loadCard(cardId)));
    if (token !== chartToken) return;
    const images = new Map();
    ids.forEach((cardId, index) => { if (loaded[index]) images.set(cardId, loaded[index]); });
    drawPie(canvas, layout, images);
  }

  function link(url, label) {
    const href = safeUrl(url);
    return href ? `<a class="source" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : "";
  }

  function renderQuarantine(view) {
    const host = $("quarantine");
    if (!view.quarantine || !view.quarantine.length) {
      host.innerHTML = "";
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const items = view.quarantine.map((row) => `<li>
      <strong>${escapeHtml(row.date)} · ${escapeHtml(row.store)} · ${escapeHtml(row.player)}</strong>
      <p>库存名次 ${escapeHtml(String(row.stored_rank))}。${escapeHtml(row.verification)}。${escapeHtml(row.reason || "")}</p>
      <p class="mini">若只按卡号规则，会落在「${escapeHtml(row.would_be_archetype || "未能分类")}」，但本口径不计入，也不改判冠军。</p>
      <p>${link(row.official_url, "TCG+ 页面")} ${link(row.gcg_stats_url || row.source_url, "gcg-stats")} ${link(row.secondary_url, "独立来源")}</p>
    </li>`).join("");
    host.innerHTML = `<h2>名次争议，未进入分母</h2><p class="hint">${escapeHtml(state.report.meta.policy || "")}</p><ul class="audit-list">${items}</ul>`;
  }

  function renderIsolated(view) {
    const host = $("isolated");
    const rows = view.isolated || [];
    if (!rows.length) {
      host.innerHTML = "";
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const items = rows.map((row) => `<li>
      <strong>${escapeHtml(row.date || "日期缺失")} · ${escapeHtml(row.store || "店铺未标注")} · ${escapeHtml(row.player || "选手缺失")}</strong>
      <p>${escapeHtml(row.reason_zh || row.reason)} ${escapeHtml(row.verification)}。</p>
      <p>${link(row.source_url, "来源")}</p>
    </li>`).join("");
    host.innerHTML = `<h2>异常隔离，未进入分母</h2><ul class="audit-list">${items}</ul>`;
  }

  function renderMethod(view) {
    const meta = state.report.meta;
    $("method").innerHTML = `<h2>口径</h2>
      <p>纳入 ${escapeHtml(String(view.included_decks))} 套，各组相加 ${escapeHtml(String(view.group_total_sum))} 套。原始冠亚记录 ${escapeHtml(String(view.raw_decks))} 套，差额是名次争议和缺字段，不是删掉后假装没有。</p>
      <p>${escapeHtml((meta.not_claims || []).join("。"))}。</p>
      <p>${escapeHtml(meta.attendance_policy || "")}</p>
      <p>${escapeHtml(meta.baseline_note || "")} 当前店赛文件 ${escapeHtml(String((meta.japan_events_file || {}).events || ""))} 场 / ${escapeHtml(String((meta.japan_events_file || {}).placements || ""))} 条名次。</p>
      <p>团队赛已排除 ${escapeHtml(String((meta.excluded_team_events || []).length))} 场。官方 1on1 只计冠亚，不把淘汰赛其余名次算进分布。生成于 ${escapeHtml(meta.generated_at_label || "")}。</p>
      <p>代表图先取规则里的两台机体；只有一张核心时，才看组内同场、投入张数和是不是通用外挂。同一机体的不同形态不拼成两张。未知体系不借用别的体系的代表。</p>`;
  }

  function ruleLine(group) {
    if (!group.rule || !group.rule.minimum_cards) return "";
    const text = Object.entries(group.rule.minimum_cards).map(([cardId, count]) => `${cardId}×${count}`).join("、");
    return `<p class="mini">分类规则按卡号数量：${escapeHtml(text)}。不是只看颜色。</p>`;
  }

  function openGroup(name) {
    const view = currentView();
    const group = (view.groups || []).find((item) => item.name === name);
    if (!group) return;
    $("dialog-title").textContent = group.name;
    const decks = (group.decks || []).map((deck) => {
      const attendance = deck.attendance
        ? `<span class="mini">实到 ${escapeHtml(String(deck.attendance.attendance))}（原文「${escapeHtml(deck.attendance.quote)}」，容量 ${escapeHtml(String(deck.attendance.ignored_capacity))} 不采用）</span>`
        : "";
      const rank = deck.rank === 1 ? "冠军" : deck.rank === 2 ? "亚军" : `第${deck.rank}名`;
      return `<li class="deck-row"><span class="rank rank-${deck.rank === 1 ? "1" : "2"}">${escapeHtml(rank)}</span><span>${escapeHtml(deck.date)}</span><span class="player">${escapeHtml(deck.player)}</span><span class="store">${escapeHtml(deck.store)}</span><span class="mini">${escapeHtml(deck.event_type || "")}</span>${attendance}${link(deck.source_url, "来源")}</li>`;
    }).join("");
    const alternatives = ((group.representative || {}).alternatives || []).map((item) => `<li class="mini">${escapeHtml(displayName(item))} ${escapeHtml(item.card_id)}：${escapeHtml(item.detail || "")}</li>`).join("");
    $("dialog-body").innerHTML = `${ruleLine(group)}<p>${escapeHtml((group.representative && group.representative.reason) || "")}</p>${alternatives ? `<p class="mini">没有入选的邻近卡</p><ul class="audit-list">${alternatives}</ul>` : ""}<p class="hint">${group.decks.length} 套。同卡表若来自不同赛事，会各算一套。</p><p class="mini"><a class="source" href="index.html">返回赛事列表</a></p><ul class="deck-list">${decks}</ul>`;
    $("deck-dialog").showModal();
  }

  function render() {
    const view = currentView();
    $("status").textContent = view ? `${state.region} · ${view.title || optionLabel(view)}` : "没有这一档数据";
    if (!view) return;
    renderSwitch();
    renderBanner(view);
    renderSummary(view);
    renderDistribution(view);
    renderChart(view);
    renderQuarantine(view);
    renderIsolated(view);
    renderMethod(view);
    const params = new URLSearchParams({ region: state.region, view: state.viewId });
    history.replaceState(null, "", `?${params.toString()}`);
  }

  function setRegion(region) {
    state.region = region;
    if (!findView(region, state.viewId)) state.viewId = state.report.regions[region].default_view;
    render();
  }

  function move(step) {
    const list = flatViews(state.region);
    const index = list.findIndex((view) => view.id === state.viewId);
    const next = list[index + step];
    if (!next) return;
    state.viewId = next.id;
    render();
  }

  function bind() {
    $("region-switch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-region]");
      if (button) setRegion(button.dataset.region);
    });
    $("view-select").addEventListener("change", () => {
      state.viewId = $("view-select").value;
      render();
    });
    $("prev-view").addEventListener("click", () => move(-1));
    $("next-view").addEventListener("click", () => move(1));
    $("banner").addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-view]");
      if (!button) return;
      state.viewId = button.dataset.openView;
      render();
    });
    $("distribution").addEventListener("click", (event) => {
      const button = event.target.closest("[data-group]");
      if (button) openGroup(button.dataset.group);
    });
    $("chart").addEventListener("click", (event) => {
      const button = event.target.closest("[data-group]");
      if (button && button.dataset.group) {
        openGroup(button.dataset.group);
        return;
      }
      const canvas = event.target.closest("canvas");
      if (!canvas || !canvas._pieLayout) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * canvas._pieLayout.width) / rect.width;
      const y = ((event.clientY - rect.top) * canvas._pieLayout.height) / rect.height;
      const sector = WeeklyPie.hitSector(canvas._pieLayout, x, y);
      if (sector) openGroup(sector.name);
    });
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      if (!state.report) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const view = currentView();
        if (view) renderChart(view);
      }, 150);
    });
    $("dialog-close").addEventListener("click", () => $("deck-dialog").close());
  }

  async function init() {
    bind();
    try {
      const response = await fetch("data/weekly-top.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
      state.report = await response.json();
      const params = new URLSearchParams(location.search);
      const region = params.get("region");
      state.region = state.report.regions[region] ? region : (state.report.meta.default_region || "日本");
      const requested = params.get("view");
      state.viewId = findView(state.region, requested) ? requested : state.report.regions[state.region].default_view;
      render();
    } catch (err) {
      $("status").textContent = "统计没有载入。请从站点根目录打开 weekly.html。";
      console.error(err);
    }
  }

  init();
})();
