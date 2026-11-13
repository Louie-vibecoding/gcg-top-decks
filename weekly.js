(() => {
  "use strict";

  const REGION_ORDER = ["日本", "中国", "欧美"];
  const ROLE = { rule_core: "规则核心", cooccurring_unit: "同场机体", unconfirmed_unit: "待确认机体" };
  const imageCache = new Map();
  let chartToken = 0;

  const state = {
    report: null,
    records: null,
    products: null,
    region: "日本",
    viewId: "",
    display: "distribution",
    calendarOpen: false,
    mode: "week",
    rangeStart: "",
    rangeEnd: "",
    selectedWeekIds: [],
    customView: null,
    rangeError: "",
    releaseMonth: "2026-11",
    releaseKind: "all",
    releaseWhen: "all",
    history: "replace",
  };
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
    if (state.mode !== "week" && state.customView) return state.customView;
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
    const select = $("view-select");
    select.innerHTML = groupHtml("完整周", groups.complete) + groupHtml("非完整周", groups.partial);
    if (state.mode !== "week") {
      select.insertAdjacentHTML("afterbegin", `<option value="">当前不是单周</option>`);
      select.value = "";
    }
  }

  function renderBanner(view) {
    const host = $("banner");
    let html = "";
    if (view.kind === "custom") {
      html = `<p><strong>${escapeHtml(view.range_label || "自定义区间")}</strong> ${escapeHtml(view.coverage_note || "")}</p>`;
    } else if (!view.complete) {
      html = `<p><strong>这一档不是完整周。</strong> ${escapeHtml(view.coverage_note)}</p>`;
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
    const kind = view.kind === "custom" ? (view.range_label || "自定义区间") : view.kind === "special" ? "特别窗口" : (view.complete ? "完整周" : "非完整周");
    const counted = view.kind === "custom" && view.date_count && view.start && view.end && view.date_count !== WeeklyRange.eachDay(view.start, view.end).length;
    const dateLines = [view.start || "—", view.end ? `至 ${view.end}` : "至 —"];
    if (counted) dateLines.push(`计入 ${view.date_count} 天`);
    $("summary").hidden = false;
    $("method").hidden = false;
    $("toolbar").hidden = false;
    const switcher = $("display-switch");
    switcher.querySelectorAll("[data-display]").forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.display === state.display ? "true" : "false");
    });
    $("summary").innerHTML = [
      metric("日期", dateLines, true),
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

  function portrait(cardId, alt) {
    const src = cardImage(cardId);
    if (!src) return `<span class="img-fallback">${escapeHtml(cardId)}</span>`;
    const frame = WeeklyPie.avatarFrame(cardId);
    const style = `--fw:${frame.fw.toFixed(3)};--left:${frame.left.toFixed(3)};--top:${frame.top.toFixed(3)}`;
    return `<span class="avatar" style="${style}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="600" height="838" decoding="sync" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'img-fallback',textContent:this.alt}))" /></span>`;
  }

  function figure(card) {
    const name = displayName(card);
    const avg = avgCopies(card);
    const img = portrait(card.card_id, name + " " + card.card_id);
    const seen = card.decks_with_card ? `<span class="mini">${escapeHtml(String(card.decks_with_card))}/${escapeHtml(String(card.group_size))} 套有这张</span>` : "";
    return { img, caption: `<figcaption><span class="role">${escapeHtml(ROLE[card.role] || "机体")}</span><span class="cname">${escapeHtml(name)}</span><span class="cid">${escapeHtml(card.card_id)}${avg ? ` · 平均 ${escapeHtml(avg)} 张` : ""}</span>${seen}</figcaption>` };
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
    return portrait(card.card_id, name);
  }

  function pieSpec() {
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    return mobile
      ? { width: 470, height: 420, cx: 230, cy: 206, r: 102, minSweep: 0.42, maxLabelShift: 22, fontSize: 12 }
      : { width: 640, height: 520, cx: 320, cy: 260, r: 150, minSweep: 0.2, maxLabelShift: 24, fontSize: 13 };
  }

  function drawPie(canvas, layout, images) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.aspectRatio = `${layout.width} / ${layout.height}`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = getComputedStyle(document.body);
    const ink = theme.getPropertyValue("--sm-ink").trim() || "#111111";
    const muted = theme.getPropertyValue("--sm-muted").trim() || "#646c74";
    const wash = theme.getPropertyValue("--sm-wash").trim() || "#f6f7f8";
    const line = theme.getPropertyValue("--sm-line").trim() || "#dfe3e7";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, layout.width, layout.height);
    const font = theme.fontFamily || "sans-serif";
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
        ctx.fillStyle = sector.others ? line : wash;
        ctx.fillRect(layout.cx - layout.r, layout.cy - layout.r, layout.r * 2, layout.r * 2);
        if (sector.others) {
          const mid = (sector.start + sector.end) / 2;
          const half = Math.min(sector.sweep, Math.PI) / 2;
          const sine = Math.max(0.08, Math.sin(half));
          let size = 15;
          let dist = layout.r * 0.62;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          while (size >= 10) {
            ctx.font = `700 ${size}px ${font}`;
            const need = ctx.measureText("others").width;
            const fitted = need / (2 * sine * 0.88);
            if (fitted <= layout.r * 0.8) {
              dist = Math.max(layout.r * 0.42, fitted);
              break;
            }
            size -= 1;
          }
          ctx.font = `700 ${size}px ${font}`;
          ctx.fillStyle = ink;
          ctx.fillText("others", layout.cx + Math.cos(mid) * dist, layout.cy + Math.sin(mid) * dist);
        }
        ctx.restore();
        return;
      }
      ctx.save();
      clipWedge(sector.start, sector.end, sector.fullCircle);
      // 两台机体的裁剪边在中线重叠约 1.5px，盖住抗锯齿露出的白底。重叠只留在本组扇区里。
      const seam = sector.parts.length > 1 ? 1.5 / layout.r : 0;
      sector.parts.forEach((part, index) => {
        const image = images.get(part.cardId);
        ctx.save();
        if (seam) {
          const start = index === 0 ? part.start : Math.max(sector.start, part.start - seam);
          const end = index === sector.parts.length - 1 ? part.end : Math.min(sector.end, part.end + seam);
          clipWedge(start, end, false);
        }
        if (!image) {
          missing += 1;
          ctx.fillStyle = wash;
          ctx.fillRect(part.x, part.y, part.width, part.height);
          ctx.fillStyle = ink;
          ctx.font = `700 11px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(part.name, part.x + part.width / 2, part.y + part.height / 2);
        } else {
          const crop = WeeklyPie.sourceCrop(image.naturalWidth, image.naturalHeight, part.focusX, part.focusY, part.end - part.start, part.cardId);
          ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, part.x, part.y, part.width, part.height);
        }
        ctx.restore();
      });
      ctx.restore();
    });

    // 白线只描不同体系之间的边界，不在同一体系的机体中线再画一条。
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
    });

    ctx.strokeStyle = muted;
    ctx.fillStyle = ink;
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
      const lines = sector.label.lines && sector.label.lines.length ? sector.label.lines : [sector.label.text];
      const lineH = sector.label.height / lines.length;
      lines.forEach((lineText, index) => {
        const y = sector.label.y - sector.label.height / 2 + lineH * (index + 0.5);
        ctx.fillText(lineText, sector.label.x, y);
      });
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
    const input = view.groups.map((group) => {
      const cards = (((group.representative || {}).cards) || []).map((card) => ({ card_id: card.card_id, name: displayName(card) }));
      return {
        name: group.name,
        total: group.total,
        percent: group.percent,
        unconfirmed: group.unconfirmed,
        blank: cards.length === 0,
        cards,
      };
    });
    const layout = WeeklyPie.layoutPie(input, spec);
    const legend = view.groups.map((group) => {
      const cards = ((group.representative || {}).cards) || [];
      const icons = cards.length
        ? cards.map(legendIcon).join("")
        : `<span class="pie-ph">待确认</span>`;
      const badge = group.unconfirmed ? `<span class="badge warn">待确认</span>` : "";
      const merged = cards.length === 0 ? `<span class="mini">饼图归入 others</span>` : "";
      const num = `${group.total}套${group.percent ? ` · ${group.percent}%` : ""}`;
      return `<button type="button" class="pie-legend-item" data-group="${escapeHtml(group.name)}" role="listitem"><span class="pie-icons">${icons}</span><span class="pie-name">${escapeHtml(group.name)} ${badge}${merged}</span><span class="pie-num">${escapeHtml(num)}</span></button>`;
    }).join("");
    host.innerHTML = `<h2>样本占比</h2><p class="hint">实心扇区面积按纳入套数。大扇区尽量放进该机体的头；扇区太窄时完整的头看右侧图例，不改面积，也不换机体。没有代表图的扇区合成一块 others，外侧和扇区都写 others。右侧仍按原体系分开，待确认可以点开。点击扇区或图例可看赛事来源。</p><div class="chart-layout"><div class="pie-stage"><canvas class="pie-canvas" role="img" aria-label="按纳入套数划分的实心饼图。没有代表图的部分标为 others。窄扇区看右侧图例里的机体头像"></canvas></div><div class="pie-legend" role="list">${legend}</div></div>`;
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
      <p>卡组分布和占比饼图用的是同一份套数。代表图先取规则里的两台机体；只有一张核心时，才看组内同场、投入张数和是不是通用外挂。同一机体的不同形态不拼成两张。未知体系不借用别的体系的代表。切换展示时只保留当前这一屏的大图。</p>
      <p>起止日期和合并周次都按单套筛选。跨不完整的几天时，不会把那一周的整周快照相加。没勾选的中间周不计入。同一套若同时落在所选周和特别窗口里，只计一次。体系待确认仍在分母里，名次争议和异常隔离仍不进入分布。</p>`;
  }

  function ruleLine(group) {
    if (!group.rule || !group.rule.minimum_cards) return "";
    const text = Object.entries(group.rule.minimum_cards).map(([cardId, count]) => `${cardId}×${count}`).join("、");
    return `<p class="mini">分类规则按卡号数量：${escapeHtml(text)}。不是只看颜色。</p>`;
  }

  function openOthers(members) {
    const rows = (members || []).map((member) => `<li><button type="button" class="nav-btn" data-group="${escapeHtml(member.name)}">${escapeHtml(member.name)} · ${escapeHtml(String(member.total))}套${member.unconfirmed ? " · 待确认" : ""}</button></li>`).join("");
    $("dialog-title").textContent = "others";
    $("dialog-body").innerHTML = `<p>这些体系没有代表机体，饼图合成一块 others。面积是套数之和，分母不变。点一组可看原来的赛事。</p><ul class="audit-list">${rows}</ul>`;
    $("deck-dialog").showModal();
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

  function renderActiveDisplay(view) {
    const dist = $("distribution");
    const chart = $("chart");
    if (!view.groups.length) {
      chartToken += 1;
      chart.hidden = true;
      chart.innerHTML = "";
      renderDistribution(view);
      dist.hidden = false;
      return;
    }
    if (state.display === "pie") {
      dist.hidden = true;
      dist.innerHTML = "";
      renderChart(view);
      return;
    }
    chartToken += 1;
    chart.hidden = true;
    chart.innerHTML = "";
    renderDistribution(view);
    dist.hidden = false;
  }

  function recordPack() {
    return state.records && state.records.regions[state.region];
  }

  function todayIso() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function emptyCustom(reason) {
    const view = WeeklyRange.summarize({ records: [] }, []);
    view.kind = "custom";
    view.title = "无效区间";
    view.range_label = "无效区间";
    view.coverage_note = reason;
    view.chart_empty_reason = reason;
    view.complete = false;
    return view;
  }

  function publishedForDates(dates) {
    const wanted = dates.slice().sort();
    return flatViews(state.region).find((view) => {
      const days = WeeklyRange.eachDay(view.start, view.end);
      return days.length === wanted.length && days.every((day, index) => day === wanted[index]);
    }) || null;
  }

  function coverageNote(dates, extra) {
    const pack = recordPack();
    const start = dates[0] || "";
    const end = dates[dates.length - 1] || "";
    const maxDate = (pack && pack.max_date) || "";
    const parts = [`含首尾 ${start} 至 ${end}，共 ${dates.length} 天。按单套计入，不是把整周快照相加。`];
    if (extra) parts.push(extra);
    if (maxDate && end > maxDate) parts.push(`这一地区收录到 ${maxDate}，更晚的日子还没有赛事。`);
    if (maxDate && start > maxDate) parts.push("这段日期还没有收录。");
    const meta = state.report.meta;
    const file = meta.japan_events_file || {};
    parts.push(`统计生成于 ${meta.generated_at_label || ""}。店赛文件 ${file.events || ""} 场 / ${file.placements || ""} 条名次。`);
    return parts.join("");
  }

  function finishCustom(dates, extra) {
    const sorted = dates.slice().sort();
    if (!sorted.length) {
      state.customView = emptyCustom("没有可统计的日期。");
      return;
    }
    const note = coverageNote(sorted, extra);
    const match = publishedForDates(sorted);
    if (match) {
      state.customView = Object.assign({}, match, {
        kind: "custom",
        range_label: state.mode === "weeks" ? "合并周次" : "自定义日期",
        coverage_note: `${note} 这组日期正好是已发布的「${match.title || optionLabel(match)}」，数字与那一档相同。`,
      });
      return;
    }
    const view = WeeklyRange.summarize(recordPack(), sorted);
    view.kind = "custom";
    view.title = `${sorted[0]} 至 ${sorted[sorted.length - 1]}`;
    view.range_label = state.mode === "weeks" ? "合并周次" : "自定义日期";
    view.coverage_note = note;
    view.chart_empty_reason = view.included_decks ? "" : "这段日期没有纳入的冠亚样本。";
    view.complete = false;
    state.customView = view;
  }

  function applyMode() {
    state.rangeError = "";
    if (state.mode !== "dates") state.preset = false;
    if (state.mode === "week") {
      state.customView = null;
      return;
    }
    if (!recordPack()) {
      state.rangeError = "单套记录还没有载入，自定义区间暂时不能计算。";
      state.customView = emptyCustom(state.rangeError);
      return;
    }
    if (state.mode === "dates") {
      const start = WeeklyRange.parseDay(state.rangeStart);
      const end = WeeklyRange.parseDay(state.rangeEnd);
      if (!start || !end) {
        state.rangeError = "请填写有效的开始日和结束日。";
        state.customView = emptyCustom(state.rangeError);
        return;
      }
      if (start > end) {
        state.rangeError = "结束日不能早于开始日。";
        state.customView = emptyCustom(state.rangeError);
        return;
      }
      finishCustom(WeeklyRange.eachDay(start, end), "");
      return;
    }
    const weeks = flatViews(state.region).filter((view) => state.selectedWeekIds.includes(view.id));
    if (!weeks.length) {
      state.rangeError = "请至少选择一周。";
      state.customView = emptyCustom(state.rangeError);
      return;
    }
    const gaps = WeeklyRange.gapsBetween(weeks, flatViews(state.region).filter((view) => view.kind !== "special"));
    const gapText = gaps.length
      ? `未计入中间的 ${gaps.map((item) => `${item.start} 至 ${item.end}`).join("、")}。`
      : "所选周次之间没有跳过的周。";
    const names = weeks.map((view) => (view.kind === "special" ? view.title : `${view.start} 至 ${view.end}`)).join("、");
    finishCustom(WeeklyRange.unionWeekDates(weeks), `合并 ${names}。${gapText}`);
  }

  function renderRangeControls() {
    const host = $("range-switch");
    if (!host) return;
    host.querySelectorAll("[data-mode]").forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.mode === state.mode ? "true" : "false");
    });
    const panel = $("range-panel");
    panel.hidden = state.mode === "week";
    $("date-range").hidden = state.mode !== "dates";
    $("week-merge").hidden = state.mode !== "weeks";
    if (document.activeElement !== $("range-start")) $("range-start").value = state.rangeStart || "";
    if (document.activeElement !== $("range-end")) $("range-end").value = state.rangeEnd || "";
    const error = $("range-error");
    error.hidden = !state.rangeError;
    error.textContent = state.rangeError || "";
    if (state.mode !== "weeks") return;
    const weeks = flatViews(state.region).filter((view) => view.kind !== "special");
    const box = (view) => {
      const checked = state.selectedWeekIds.includes(view.id) ? " checked" : "";
      return `<label class="week-check"><input type="checkbox" data-week="${escapeHtml(view.id)}"${checked} /> <span>${escapeHtml(optionLabel(view))}</span></label>`;
    };
    $("week-merge").innerHTML = `<p class="hint">勾选要合并的周。中间没勾的周不会算进去。</p>${weeks.map(box).join("")}`;
  }

  function productsOf() {
    return (state.products && state.products.products) || [];
  }

  function boundaryDays() {
    return [...new Set(productsOf()
      .filter((item) => item.environment_boundary_eligible && item.release_date_precision === "exact_day" && item.release_date_iso)
      .map((item) => item.release_date_iso))].sort();
  }

  function monthLabel(month) {
    const [year, mon] = month.split("-");
    return `${year}年${Number(mon)}月`;
  }

  function shiftMonth(month, delta) {
    const [year, mon] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function productVisible(product, today) {
    const bucket = product.kind === "新卡补充包" ? "booster" : product.kind === "预组" ? "starter" : "other";
    if (state.releaseKind !== "all" && state.releaseKind !== bucket) return false;
    if (state.releaseWhen === "released" && product.sale_status !== "已发售") return false;
    if (state.releaseWhen === "scheduled" && product.sale_status !== "预定") return false;
    if (state.releaseWhen === "past" && !(product.release_date_iso && product.release_date_iso < today)) return false;
    if (state.releaseWhen === "upcoming" && !(product.release_date_iso && product.release_date_iso >= today)) return false;
    return true;
  }

  function renderReleases() {
    const host = $("releases");
    if (!host) return;
    host.hidden = false;
    const catalog = state.products || {};
    const today = todayIso();
    const exact = productsOf().filter((item) => item.release_date_precision === "exact_day" && item.release_date_iso && productVisible(item, today));
    const uncertain = productsOf().filter((item) => !(item.release_date_precision === "exact_day" && item.release_date_iso) && productVisible(item, today));
    const [year, month] = state.releaseMonth.split("-").map(Number);
    const first = `${state.releaseMonth}-01`;
    const nextMonth = shiftMonth(state.releaseMonth, 1);
    const byDay = new Map();
    exact.forEach((item) => {
      if (item.release_date_iso < first || item.release_date_iso >= `${nextMonth}-01`) return;
      if (!byDay.has(item.release_date_iso)) byDay.set(item.release_date_iso, []);
      byDay.get(item.release_date_iso).push(item);
    });
    const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const pad = (lead + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < pad; i += 1) cells.push(`<div class="cal-cell cal-empty"></div>`);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${state.releaseMonth}-${String(day).padStart(2, "0")}`;
      const items = byDay.get(iso) || [];
      const codes = items.map((item) => {
        const bucket = item.kind === "新卡补充包" ? "booster" : item.kind === "预组" ? "starter" : "other";
        const code = item.product_code || "商品";
        return `<span class="cal-code kind-${bucket}">${escapeHtml(code)}</span>`;
      }).join("");
      cells.push(`<div class="cal-cell${items.length ? " cal-has" : ""}"><span class="cal-day">${day}</span>${codes ? `<span class="cal-codes">${codes}</span>` : ""}</div>`);
    }
    const monthDays = [...byDay.keys()].sort();
    const monthList = monthDays.length
      ? monthDays.map((iso) => `<section class="day-group"><h4>${escapeHtml(iso)}</h4>${byDay.get(iso).map((item) => releaseCard(item, today)).join("")}</section>`).join("")
      : `<p class="hint">这个月没有精确到日的商品。</p>`;
    const kindButton = (id, label) => `<button type="button" data-kind="${id}" aria-pressed="${state.releaseKind === id ? "true" : "false"}">${label}</button>`;
    const whenButton = (id, label) => `<button type="button" data-when="${id}" aria-pressed="${state.releaseWhen === id ? "true" : "false"}">${label}</button>`;
    const uncertainHtml = uncertain.length
      ? uncertain.map((item) => releaseCard(item, today, true)).join("")
      : `<p class="hint">当前筛选下没有日期不精确的商品。</p>`;
    const open = state.calendarOpen;
    host.classList.toggle("is-collapsed", !open);
    host.innerHTML = `<div class="cal-head">
        <div>
          <h2 id="releases-title">日本官方发售日历</h2>
          <p class="hint">只使用日本官网商品列表和详情页，核对日 ${escapeHtml(catalog.checked_on || "")}。发售日不是赛事合法生效日。这些日期不会自动套到中国或欧美。</p>
        </div>
        <button type="button" class="nav-btn cal-toggle" data-calendar-toggle aria-expanded="${open ? "true" : "false"}" aria-controls="releases-body">${open ? "收起" : "展开"}</button>
      </div>
      <div id="releases-body"${open ? "" : " hidden"}>
      <p class="hint">同一天的商品放在同一格。预约开始、发货月和会场顺次不写进日历格子。</p>
      <div class="cal-tools">
        <button type="button" class="nav-btn" data-month="-1">上一月</button>
        <strong>${escapeHtml(monthLabel(state.releaseMonth))}</strong>
        <button type="button" class="nav-btn" data-month="1">下一月</button>
      </div>
      <div class="cal-filters" role="group" aria-label="商品类别">${kindButton("all", "全部")}${kindButton("booster", "补充包")}${kindButton("starter", "预组")}${kindButton("other", "其他商品")}</div>
      <div class="cal-filters" role="group" aria-label="发售状态">${whenButton("all", "全部状态")}${whenButton("released", "已发售")}${whenButton("scheduled", "预定")}${whenButton("past", "已过发售日")}${whenButton("upcoming", "未到发售日")}</div>
      <div class="cal-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      <div class="cal-grid">${cells.join("")}</div>
      <h3>这个月的发售</h3>
      <div class="month-list">${monthList}</div>
      <h3>日期不精确，不放进日历</h3>
      <div class="uncertain-list">${uncertainHtml}</div>
      </div>`;
  }

  function readCalendarOpen() {
    try {
      return localStorage.getItem("gcg-weekly-calendar") === "open";
    } catch (err) {
      return false;
    }
  }

  function writeCalendarOpen(open) {
    try {
      localStorage.setItem("gcg-weekly-calendar", open ? "open" : "closed");
    } catch (err) {
      /* 浏览器不允许保存时，这一次访问仍按当前开关显示。 */
    }
  }

  function releaseCard(item, today, loose) {
    const bucket = item.kind === "新卡补充包" ? "booster" : item.kind === "预组" ? "starter" : "other";
    const label = item.kind === "新卡补充包" ? "补充包" : item.kind === "预组" ? "预组" : "其他";
    const when = item.release_date_iso && item.release_date_iso < today ? "已过发售日" : item.release_date_iso ? "未到发售日" : "";
    const href = safeUrl(item.detail_url);
    const name = item.product_code ? `[${item.product_code}] ${item.name_official_jp_site}` : item.name_official_jp_site;
    const link = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>` : escapeHtml(name);
    const preset = item.environment_boundary_eligible && item.release_date_iso
      ? `<button type="button" class="nav-btn preset-btn" data-preset="${escapeHtml(item.release_date_iso)}"${state.region === "日本" ? "" : " disabled"}>用这个发售日截取日本统计</button>`
      : "";
    const dateText = loose
      ? (item.release_date_original || "详情页没有精确到日的发售日")
      : item.release_date_iso;
    return `<article class="release-card kind-${bucket}">
      <p class="release-meta"><span>${escapeHtml(label)}</span><span>${escapeHtml(item.sale_status || "")}</span>${when ? `<span>${escapeHtml(when)}</span>` : ""}</p>
      <p class="release-name">${link}</p>
      <p class="mini">${escapeHtml(dateText || "")}${item.environment_boundary_eligible ? " · 可作为日本统计的发售切点" : ""}</p>
      ${preset}
    </article>`;
  }

  function applyReleasePreset(date) {
    if (state.region !== "日本") return;
    const next = boundaryDays().find((day) => day > date) || "";
    const end = next ? WeeklyRange.addDays(next, -1) : date;
    state.mode = "dates";
    state.rangeStart = date;
    state.rangeEnd = end;
    state.preset = true;
    state.history = "push";
    applyMode();
    if (state.customView) {
      state.customView.range_label = "按发售日截取";
      const span = next ? `${date} 至下一次新卡发售日前一天 ${end}` : `${date} 起，这份记录里还没有更晚的新卡发售日`;
      state.customView.coverage_note = `区间 ${span}。这是按日本官方发售日截取的统计区间，不是官方赛事合法生效日。纯再录、周边和 β 版不会自动切开环境。${state.customView.coverage_note}`;
    }
    render();
    const summary = $("summary");
    if (summary) summary.scrollIntoView({ block: "start" });
  }

  function writeUrl() {
    const params = new URLSearchParams({ region: state.region, display: state.display, mode: state.mode });
    if (state.mode === "week") params.set("view", state.viewId);
    if (state.mode === "dates") {
      if (state.rangeStart) params.set("from", state.rangeStart);
      if (state.rangeEnd) params.set("to", state.rangeEnd);
    }
    if (state.mode === "weeks") params.set("weeks", state.selectedWeekIds.join(","));
    const next = `?${params.toString()}`;
    if (state.history === "push" && location.search !== next) history.pushState({ weekly: 1 }, "", next);
    else if (state.history !== "skip") history.replaceState({ weekly: 1 }, "", next);
    state.history = "replace";
  }

  function weekChoices(region) {
    return flatViews(region).filter((view) => view.kind !== "special");
  }

  function contiguousDates(views) {
    const dates = WeeklyRange.unionWeekDates(views);
    if (!dates.length) return null;
    const span = WeeklyRange.eachDay(dates[0], dates[dates.length - 1]);
    if (span.length !== dates.length) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  }

  function readParams() {
    const params = new URLSearchParams(location.search);
    const region = params.get("region");
    state.region = state.report.regions[region] ? region : (state.report.meta.default_region || "日本");
    const requested = findView(state.region, params.get("view"));
    const fallback = state.report.regions[state.region].default_view;
    state.viewId = requested && requested.kind !== "special" ? requested.id : fallback;
    state.display = params.get("display") === "pie" ? "pie" : "distribution";
    const mode = params.get("mode");
    state.mode = mode === "dates" || mode === "weeks" ? mode : "week";
    state.rangeStart = params.get("from") || "";
    state.rangeEnd = params.get("to") || "";
    const requestedWeeks = (params.get("weeks") || "").split(",").map((id) => findView(state.region, id)).filter(Boolean);
    const specials = requestedWeeks.filter((view) => view.kind === "special");
    state.selectedWeekIds = requestedWeeks.filter((view) => view.kind !== "special").map((view) => view.id);
    if (requested && requested.kind === "special" && state.mode !== "weeks") specials.push(requested);
    if (specials.length) {
      const mapped = contiguousDates(state.mode === "weeks" ? requestedWeeks : specials);
      if (mapped) {
        state.mode = "dates";
        state.rangeStart = mapped.start;
        state.rangeEnd = mapped.end;
      }
    }
    if (state.mode === "weeks" && !state.selectedWeekIds.length) state.selectedWeekIds = [state.viewId];
    if (!state.selectedWeekIds.length) state.selectedWeekIds = [state.viewId];
    state.selectedWeekIds = state.selectedWeekIds.filter((id) => weekChoices(state.region).some((view) => view.id === id));
    if (!state.selectedWeekIds.length) state.selectedWeekIds = [state.viewId];
  }

  function render() {
    const view = currentView();
    $("status").textContent = view ? `${state.region} · ${view.title || optionLabel(view)}` : "没有这一档数据";
    if (!view) return;
    renderSwitch();
    renderRangeControls();
    renderBanner(view);
    renderSummary(view);
    renderActiveDisplay(view);
    renderQuarantine(view);
    renderIsolated(view);
    renderMethod(view);
    renderReleases();
    writeUrl();
  }

  function setRegion(region) {
    if (state.preset && region !== "日本") {
      state.preset = false;
      state.mode = "week";
    }
    state.region = region;
    if (!findView(region, state.viewId)) state.viewId = state.report.regions[region].default_view;
    state.selectedWeekIds = state.selectedWeekIds.filter((id) => findView(region, id));
    if (!state.selectedWeekIds.length) state.selectedWeekIds = [state.viewId];
    state.history = "push";
    applyMode();
    render();
  }

  function bind() {
    $("display-switch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-display]");
      if (!button || button.dataset.display === state.display) return;
      state.display = button.dataset.display;
      state.history = "push";
      render();
    });
    $("region-switch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-region]");
      if (button) setRegion(button.dataset.region);
    });
    $("view-select").addEventListener("change", () => {
      state.mode = "week";
      state.viewId = $("view-select").value;
      state.selectedWeekIds = [state.viewId];
      state.history = "push";
      applyMode();
      render();
    });
    $("range-switch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button || button.dataset.mode === state.mode) return;
      state.mode = button.dataset.mode;
      if (state.mode === "dates" && (!WeeklyRange.parseDay(state.rangeStart) || !WeeklyRange.parseDay(state.rangeEnd))) {
        const view = findView(state.region, state.viewId);
        state.rangeStart = view.start;
        state.rangeEnd = view.end;
      }
      if (state.mode === "weeks" && !state.selectedWeekIds.length) state.selectedWeekIds = [state.viewId];
      state.history = "push";
      applyMode();
      render();
    });
    $("range-start").addEventListener("change", () => {
      state.mode = "dates";
      state.preset = false;
      state.rangeStart = $("range-start").value;
      state.history = "push";
      applyMode();
      render();
    });
    $("range-end").addEventListener("change", () => {
      state.mode = "dates";
      state.preset = false;
      state.rangeEnd = $("range-end").value;
      state.history = "push";
      applyMode();
      render();
    });
    $("week-merge").addEventListener("change", (event) => {
      const box = event.target.closest("[data-week]");
      if (!box) return;
      const id = box.dataset.week;
      const chosen = new Set(state.selectedWeekIds);
      if (box.checked) chosen.add(id);
      else chosen.delete(id);
      state.mode = "weeks";
      state.selectedWeekIds = [...chosen];
      state.history = "push";
      applyMode();
      render();
    });
    $("releases").addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-calendar-toggle]");
      if (toggle) {
        state.calendarOpen = !state.calendarOpen;
        writeCalendarOpen(state.calendarOpen);
        renderReleases();
        const next = document.querySelector("[data-calendar-toggle]");
        if (next) next.focus();
        return;
      }
      const month = event.target.closest("[data-month]");
      if (month) {
        state.releaseMonth = shiftMonth(state.releaseMonth, Number(month.dataset.month));
        renderReleases();
        return;
      }
      const kind = event.target.closest("[data-kind]");
      if (kind) {
        state.releaseKind = kind.dataset.kind;
        renderReleases();
        return;
      }
      const when = event.target.closest("[data-when]");
      if (when) {
        state.releaseWhen = when.dataset.when;
        renderReleases();
        return;
      }
      const preset = event.target.closest("[data-preset]");
      if (preset && !preset.disabled) applyReleasePreset(preset.dataset.preset);
    });
    window.addEventListener("popstate", () => {
      if (!state.report) return;
      readParams();
      state.history = "skip";
      applyMode();
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
      if (!sector) return;
      if (sector.others) openOthers(sector.members);
      else openGroup(sector.name);
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
    $("deck-dialog").addEventListener("click", (event) => {
      const button = event.target.closest("[data-group]");
      if (button) openGroup(button.dataset.group);
    });
  }

  async function init() {
    bind();
    try {
      const [reportResponse, recordsResponse, productsResponse] = await Promise.all([
        fetch("data/weekly-top.json", { cache: "no-cache" }),
        fetch("data/weekly-records.json", { cache: "no-cache" }),
        fetch("data/jp-official-products.json", { cache: "no-cache" }),
      ]);
      if (!reportResponse.ok) throw new Error(String(reportResponse.status));
      state.report = await reportResponse.json();
      state.records = recordsResponse.ok ? await recordsResponse.json() : null;
      state.products = productsResponse.ok ? await productsResponse.json() : null;
      state.calendarOpen = readCalendarOpen();
      readParams();
      applyMode();
      render();
    } catch (err) {
      $("status").textContent = "统计没有载入。请从站点根目录打开 weekly.html。";
      console.error(err);
    }
  }

  init();
})();
