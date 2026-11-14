/* Dota Hub — локальный сайт с билдами. Данные: data/data.js (генерирует update.py) */
(() => {
  const D = window.DOTA_DATA;
  const app = document.getElementById("app");
  if (!D) {
    app.innerHTML = `<div class="panel empty">Нет данных. Запусти <code>python update.py</code> в папке сайта.</div>`;
    return;
  }
  D.matchups = D.matchups || {};
  D.patches = D.patches || {};
  D.item_keys = D.item_keys || {};
  D.players.forEach((p) => { p.matches = p.matches || []; p.history = p.history || []; p.duo = p.duo || {}; });

  // ------------------------------------------------------------ constants
  const POS = { "pos 1": "Керри", "pos 2": "Мид", "pos 3": "Оффлейн", "pos 4": "Саппорт 4", "pos 5": "Саппорт 5" };
  const POS_SHORT = { "pos 1": "1", "pos 2": "2", "pos 3": "3", "pos 4": "4", "pos 5": "5" };
  const MEDALS = ["", "Рекрут", "Страж", "Рыцарь", "Герой", "Легенда", "Властелин", "Божество", "Титан"];
  const MODES = { 1: "All Pick", 2: "Captains Mode", 3: "Random Draft", 4: "Single Draft", 5: "All Random", 16: "Captains Draft", 18: "Ability Draft", 22: "All Pick", 23: "Turbo" };
  const LANES = { 1: "Лёгкая", 2: "Мид", 3: "Сложная", 4: "Лес" };
  const BENCH = {
    gold_per_min: "GPM", xp_per_min: "XPM", kills_per_min: "Убийства/мин", last_hits_per_min: "Добивания/мин",
    hero_damage_per_min: "Урон героям/мин", tower_damage: "Урон по строениям", hero_healing_per_min: "Лечение/мин",
  };

  // ------------------------------------------------------------ storage (per-browser)
  const store = {
    get(k, d) { try { const v = localStorage.getItem("dh." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("dh." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const favs = new Set(store.get("favs", []).map(String));
  const notes = store.get("notes", {});
  const toggleFav = (id) => { id = String(id); favs.has(id) ? favs.delete(id) : favs.add(id); store.set("favs", [...favs]); };

  // ------------------------------------------------------------ helpers
  const hero = (id) => D.heroes[id];
  const heroByNpc = (npc) => Object.values(D.heroes).find((h) => h.npc === npc);
  const item = (id) => D.items[id] || { name: "#" + id };
  const abil = (id) => D.abilities[id] || { name: "#" + id };
  const pct = (x, d = 1) => (x == null || isNaN(x) ? "—" : (x * 100).toFixed(d) + "%");
  const sgn = (x, d = 1) => (x == null ? "—" : (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%");
  const wrCls = (x) => (x == null ? "" : x >= 0.52 ? "good" : x < 0.48 ? "bad" : "");
  const dCls = (x) => (x == null ? "" : x > 0.01 ? "good" : x < -0.01 ? "bad" : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const minFmt = (m) => (m == null ? "" : Math.round(m) + "'");
  const tFmt = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`);
  const posKey = (s) => (s || "").replace(/^pos ?/, "pos ").trim();
  const posSlug = (s) => (s || "").replace(" ", "");
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const allMains = new Set(D.players.flatMap((p) => p.mains.map((m) => String(m.hero_id))));
  const playerById = (aid) => D.players.find((x) => String(x.account_id) === String(aid));
  const mode = (m) => (m.lobby === 7 ? "Рейтинг" : MODES[m.mode] || "Матч");

  function medal(rt) {
    if (!rt) return "Без ранга";
    const m = Math.floor(rt / 10), s = rt % 10;
    return MEDALS[m] + (m < 8 && s ? " " + s : "");
  }
  function ago(ts) {
    if (!ts) return "—";
    const d = (Date.now() / 1000 - ts) / 86400;
    if (d < 1) return "сегодня";
    if (d < 2) return "вчера";
    if (d < 30) return Math.floor(d) + " дн. назад";
    return Math.floor(d / 30) + " мес. назад";
  }
  function itemIc(id, extra = "", cls = "") {
    const it = item(id);
    return `<div class="it ${cls}" title="${esc(it.name)}${it.cost ? " · " + it.cost + " з." : ""}">
      ${it.img ? `<img src="${it.img}" alt="" loading="lazy">` : `<img alt="">`}
      ${extra ? `<span class="t">${extra}</span>` : ""}
    </div>`;
  }
  const attrDot = (h) => `<span class="attr ${h.attr}" title="${h.attr}"></span>`;
  function bestPos(h) {
    if (!h || !h.meta) return null;
    return Object.entries(h.meta.pos).sort((a, b) => b[1].matches - a[1].matches)[0][0];
  }
  const firstPos = (hid) => Object.keys(D.builds[hid] || {})[0] || bestPos(hero(hid)) || "pos 1";
  const heroLink = (hid, aid) => `#/h/${hid}/${posSlug(firstPos(hid))}${aid ? "/" + aid : ""}`;
  const favBtn = (hid) => `<button class="fav ${favs.has(String(hid)) ? "on" : ""}" data-fav="${hid}" title="В избранное">★</button>`;
  function bindFavs(root = app) {
    root.querySelectorAll("[data-fav]").forEach((b) => (b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleFav(b.dataset.fav);
      b.classList.toggle("on", favs.has(b.dataset.fav));
      if (b.dataset.label) b.innerHTML = favs.has(b.dataset.fav) ? "★ В избранном" : "☆ В избранное";
    }));
  }
  // все разобранные матчи (по всем игрокам) на герое
  function myMatchesOn(hid, aid) {
    const out = [];
    D.players.forEach((p) => {
      if (aid && String(p.account_id) !== String(aid)) return;
      p.matches.forEach((m) => m.hero_id == hid && out.push({ ...m, player: p }));
    });
    return out.sort((a, b) => b.start - a.start);
  }

  // ------------------------------------------------------------ header
  const upd = new Date(D.updated);
  document.getElementById("meta").innerHTML =
    `Патч <b>${esc(D.patch || "?")}</b><br>обновлено ${upd.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  document.getElementById("theme").onclick = () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    try { localStorage.setItem("dh.theme", next); } catch { /* */ }
  };

  // ------------------------------------------------------------ charts (inline SVG)
  function lineChart(series, { h = 140, zero = false, fmt = (v) => Math.round(v) } = {}) {
    const W = 600, P = { l: 34, r: 8, t: 8, b: 18 };
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    if (!all.length) return `<div class="dim small">нет данных</div>`;
    let lo = Math.min(...all), hi = Math.max(...all);
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const n = Math.max(...series.map((s) => s.values.length));
    const x = (i) => P.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - P.l - P.r));
    const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (h - P.t - P.b);
    const grid = [lo, (lo + hi) / 2, hi].map((v) =>
      `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${P.l - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join("");
    const zl = zero ? `<line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>` : "";
    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
      const dots = s.dots ? s.values.map((v, i) => v == null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.dotColor ? s.dotColor(i) : s.color}"/>`).join("") : "";
      return `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" points="${pts.join(" ")}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>${dots}`;
    }).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">${grid}${zl}${paths}</svg>`;
  }
  const rolling = (a, k) => a.map((_, i) => { const s = a.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null); return s.length ? avg(s) : null; });
  function hbars(rows) {
    const max = Math.max(...rows.map((r) => r.max ?? r.v), 0.0001);
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${r.label}</span>
      <div class="track"><div class="fill" style="width:${Math.max(2, (r.v / max) * 100)}%;background:${r.color || "var(--accent)"}"></div></div>
      <span class="v">${r.text}</span></div>`).join("")}</div>`;
  }

  // ============================================================ VIEWS
  function viewHome() {
    const favList = [...favs].map((id) => hero(id)).filter(Boolean);
    app.innerHTML = `
      <h2>Игроки</h2>
      <div class="players">
        ${D.players.map((p) => `
          <a class="panel pcard" href="#/p/${p.account_id}">
            <img src="${p.avatar || ""}" alt="">
            <div>
              ${p.label ? `<div class="lb">${esc(p.label)}</div>` : ""}
              <div class="nm">${esc(p.name)}</div>
              <div class="heroes-mini">${p.mains.slice(0, 6).map((m) => `<img src="${hero(m.hero_id)?.img}" alt="">`).join("") || `<small class="dim">нет данных о героях</small>`}</div>
            </div>
          </a>`).join("")}
      </div>
      <div class="note plain">Добавить игрока: <code>python update.py --add &lt;Steam64 / ID / ссылка&gt;</code> или вставь его ID в поиск сверху.</div>

      <h2>Избранное <small>звёздочка на карточке героя · хранится в этом браузере</small></h2>
      ${favList.length ? `<div class="hgrid">${favList.map((h) => simpleHeroCard(h)).join("")}</div>`
        : `<div class="panel empty">Пока пусто. Нажми ★ на любом герое.</div>`}`;
    bindFavs();
  }

  function simpleHeroCard(h, aid) {
    const pos = firstPos(h.id), pm = h.meta?.pos?.[pos];
    return `<a class="hcard" href="${heroLink(h.id, aid)}">
      <img class="pic" src="${h.img}" alt="">${favBtn(h.id)}
      <span class="pos">${POS[pos] || ""}</span>
      <div class="body"><div class="nm">${attrDot(h)}${esc(h.name)}</div>
      <div class="row"><span>Мета</span><b>${pm ? `<span class="${wrCls(pm.wr)}">${pct(pm.wr)}</span> · ${pm.rating.toFixed(0)}/100` : "—"}</b></div>
      ${notes[h.id] ? `<div class="row"><span>📝 ${esc(notes[h.id].slice(0, 40))}${notes[h.id].length > 40 ? "…" : ""}</span></div>` : ""}</div></a>`;
  }

  // ------------------------------------------------------------ player
  function viewPlayer(aid) {
    const p = playerById(aid);
    if (!p) return viewMissing(aid);
    const msgs = [];
    if (p.source === "none")
      msgs.push(`OpenDota не видит матчей игрока. Скорее всего в Dota выключено <b>«Общедоступная история матчей»</b> (Настройки → Социальное). Включи и запусти <code>python update.py</code> через пару часов. Пока героев можно прописать вручную в <code>config.json → extra_heroes</code>.`);
    if (p.source === "recent" || p.source === "history_partial")
      msgs.push(`OpenDota ещё собирает полную историю. Мейны посчитаны по последним ${p.history.length} матчам; после индексации станет точнее.`);
    // пока OpenDota не доиндексировал профиль, его W/L меньше, чем у нас матчей
    let wl = { w: p.win, l: p.lose, note: "" };
    if (p.history.length > p.win + p.lose) {
      const w = p.history.filter((r) => r.win).length;
      wl = { w, l: p.history.length - w, note: ` (последние ${p.history.length})` };
    }
    const wr = wl.w + wl.l ? wl.w / (wl.w + wl.l) : null;
    const others = D.players.filter((x) => x !== p);

    app.innerHTML = `
      <div class="panel phead">
        <img src="${p.avatar || ""}" alt="">
        <div>
          ${p.label ? `<div class="lb">${esc(p.label)}</div>` : ""}
          <h1>${esc(p.name)}</h1>
          <div class="sub">
            <span>${medal(p.rank_tier)}</span>
            ${wr != null ? `<span>${wl.w}W / ${wl.l}L · <b class="${wrCls(wr)}">${pct(wr)}</b>${wl.note}</span>` : ""}
            <span>ID ${p.account_id}</span>
          </div>
        </div>
        <div class="acts">
          <a class="btn" target="_blank" rel="noopener" href="https://www.opendota.com/players/${p.account_id}">OpenDota</a>
          <a class="btn" target="_blank" rel="noopener" href="https://stratz.com/players/${p.account_id}">STRATZ</a>
          ${p.profile_url ? `<a class="btn" target="_blank" rel="noopener" href="${p.profile_url}">Steam</a>` : ""}
        </div>
      </div>
      ${msgs.map((n) => `<div class="note">${n}</div>`).join("")}

      <h2>Мейн-герои</h2>
      ${p.mains.length ? `<div class="hgrid">${p.mains.map((m) => heroCard(m, p)).join("")}</div>` : `<div class="panel empty">Пока пусто.</div>`}

      <h2>Тренды <small>последние ${(p.history.length || p.matches.length)} игр</small></h2>
      ${trends(p)}

      ${others.length ? `<h2>С друзьями</h2>${others.map((o) => duoBlock(p, o)).join("")}` : ""}

      <h2>Последние матчи <small>клик — разбор матча</small></h2>
      ${p.matches.length ? `<div class="mlist">${p.matches.map((m) => matchRow(m, p)).join("")}</div>` : `<div class="panel empty">Нет матчей.</div>`}`;
    bindFavs();
  }

  function heroCard(m, p) {
    const h = hero(m.hero_id);
    if (!h) return "";
    const bp = firstPos(h.id), pm = h.meta?.pos?.[bp];
    const wr = m.games ? m.win / m.games : null;
    return `
      <a class="hcard" href="${heroLink(h.id, p.account_id)}">
        <img class="pic" src="${h.img}" alt="">${favBtn(h.id)}
        <span class="pos">${POS[bp] || ""}</span>
        <div class="body">
          <div class="nm">${attrDot(h)}${esc(h.name)}</div>
          <div class="row"><span>Игры</span><b>${m.games || "—"}${wr != null ? ` · <span class="${wrCls(wr)}">${pct(wr, 0)}</span>` : ""}</b></div>
          <div class="row"><span>Мета (${POS_SHORT[bp] || "?"})</span><b>${pm ? `<span class="${wrCls(pm.wr)}">${pct(pm.wr)}</span> · ${pm.rating.toFixed(0)}/100` : "—"}</b></div>
          <div class="row"><span>Последняя</span><b>${ago(m.last_played)}</b></div>
        </div>
      </a>`;
  }

  function matchRow(m, p) {
    const h = hero(m.hero_id);
    return `<a class="mrow ${m.win ? "w" : ""}" href="#/m/${m.match_id}/${p.account_id}">
      <img src="${h?.img}" alt="">
      <div><b>${esc(h?.name)}</b> <span class="badge ${m.win ? "w" : "l"}">${m.win ? "Победа" : "Поражение"}</span>
        <div class="sm">${mode(m)} · ${LANES[m.lane_role] || ""} · ${ago(m.start)}${m.party > 1 ? " · пати " + m.party : ""}</div></div>
      <div class="k">${m.k}/${m.d}/${m.a}</div>
      <div class="sm hide-sm">${m.gpm} GPM</div>
      <div class="sm hide-sm">${tFmt(m.duration)}</div>
      <div class="hide-sm">${m.parsed ? `<span class="badge" title="Реплей разобран: есть тайминги">разбор ✓</span>` : `<span class="badge" title="OpenDota ещё не разобрал реплей">базовые</span>`}</div>
    </a>`;
  }

  // ---- #10 тренды
  function trends(p) {
    const rows = (p.history.length ? p.history : p.matches.map((m) => ({ ...m }))).slice().sort((a, b) => a.start - b.start);
    if (!rows.length) return `<div class="panel empty">Нет данных.</div>`;
    const wins = rows.filter((r) => r.win).length;
    const kda = rows.map((r) => (r.k + r.a) / Math.max(1, r.d));
    let streak = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].win === rows[rows.length - 1].win; i--) streak++;
    const last = rows[rows.length - 1].win;
    const groupWR = (keyFn, labelFn) => {
      const g = {};
      rows.forEach((r) => { const k = keyFn(r); if (k == null) return; (g[k] = g[k] || { n: 0, w: 0 }); g[k].n++; g[k].w += r.win ? 1 : 0; });
      return Object.entries(g).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ label: labelFn(k), v: v.w / v.n, max: 1, text: `${pct(v.w / v.n, 0)} · ${v.n}`, color: v.w / v.n >= 0.5 ? "var(--good)" : "var(--bad)" }));
    };
    const byHero = groupWR((r) => r.hero_id, (k) => esc(hero(k)?.name || k)).slice(0, 6);
    const solo = rows.filter((r) => r.party != null);
    return `
      <div class="panel">
        <div class="kpis">
          <div class="kpi"><div class="v ${wrCls(wins / rows.length)}">${pct(wins / rows.length, 0)}</div><div class="k">Винрейт</div></div>
          <div class="kpi"><div class="v">${avg(kda).toFixed(2)}</div><div class="k">Средний KDA</div></div>
          <div class="kpi"><div class="v">${Math.round(avg(rows.map((r) => r.gpm).filter(Boolean)) || 0)}</div><div class="k">GPM</div></div>
          <div class="kpi"><div class="v">${Math.round(avg(rows.map((r) => r.xpm).filter(Boolean)) || 0)}</div><div class="k">XPM</div></div>
          <div class="kpi"><div class="v ${last ? "good" : "bad"}">${streak} ${last ? "W" : "L"}</div><div class="k">Текущая серия</div></div>
          <div class="kpi"><div class="v">${tFmt(Math.round(avg(rows.map((r) => r.duration).filter(Boolean)) || 0))}</div><div class="k">Средняя длительность</div></div>
        </div>
        <div class="grid2" style="margin-top:16px">
          <div>
            <h3>GPM и KDA по играм <small>линия — среднее за 5 игр</small></h3>
            ${lineChart([
              { values: rows.map((r) => r.gpm), color: "var(--accent-2)", width: 1, dots: true, dotColor: (i) => rows[i].win ? "var(--good)" : "var(--bad)" },
              { values: rolling(rows.map((r) => r.gpm), 5), color: "var(--accent)", width: 2.5 },
            ])}
            <div class="legend"><span><i style="background:var(--accent-2)"></i>GPM (точка: зелёная — победа)</span><span><i style="background:var(--accent)"></i>среднее</span></div>
            ${lineChart([{ values: rolling(kda, 5), color: "var(--int)", width: 2.5 }, { values: kda, color: "var(--int)", width: 1, dash: "2 3" }], { h: 100, fmt: (v) => v.toFixed(1) })}
            <div class="legend"><span><i style="background:var(--int)"></i>KDA</span></div>
            <h3 style="margin-top:12px">Серия <small>старые → новые</small></h3>
            <div class="streak">${rows.map((r) => `<i class="${r.win ? "w" : ""}" title="${esc(hero(r.hero_id)?.name)} ${r.k}/${r.d}/${r.a}"></i>`).join("")}</div>
          </div>
          <div>
            <h3>Винрейт по линиям</h3>${hbars(groupWR((r) => r.lane_role, (k) => LANES[k] || "?"))}
            <h3 style="margin-top:14px">По режимам</h3>${hbars(groupWR((r) => r.mode, (k) => MODES[k] || "Режим " + k))}
            <h3 style="margin-top:14px">По героям</h3>${hbars(byHero)}
            ${solo.length ? `<h3 style="margin-top:14px">Соло и пати</h3>${hbars(groupWR((r) => (r.party > 1 ? "party" : "solo"), (k) => (k === "party" ? "В пати" : "Соло")))}` : ""}
          </div>
        </div>
      </div>`;
  }

  // ---- #11 игры вместе
  function duoBlock(p, o) {
    const list = p.duo[String(o.account_id)] || [];
    const hidden = o.source === "none" || o.history_hidden;
    if (!list.length)
      return `<div class="panel"><b>${esc(o.name)}</b>: совместных игр не найдено.
        ${hidden ? `<div class="note">У ${esc(o.name)} скрыта история матчей, поэтому в матчах он отображается как «Аноним» и совместные игры не определить. Нужно включить «Общедоступная история матчей» в настройках Dota.</div>` : ""}</div>`;
    const w = list.filter((r) => r.win).length;
    const pairs = {};
    list.forEach((r) => { if (!r.other_hero) return; const k = r.hero + "-" + r.other_hero; (pairs[k] = pairs[k] || { a: r.hero, b: r.other_hero, n: 0, w: 0 }); pairs[k].n++; pairs[k].w += r.win; });
    return `<div class="panel">
      <h3>${esc(p.name)} + ${esc(o.name)} <small>${list.length} игр · <span class="${wrCls(w / list.length)}">${pct(w / list.length, 0)}</span></small></h3>
      <div class="streak">${list.slice().reverse().map((r) => `<i class="${r.win ? "w" : ""}" title="${esc(hero(r.hero)?.name)} · ${ago(r.start)}"></i>`).join("")}</div>
      ${Object.keys(pairs).length ? `<h3 style="margin-top:14px">Лучшие связки</h3><div class="mlist">${Object.values(pairs).sort((a, b) => b.n - a.n).slice(0, 6).map((x) => `
        <div class="mrow ${x.w / x.n >= 0.5 ? "w" : ""}" style="grid-template-columns:64px 64px 1fr auto"><img src="${hero(x.a)?.img}"><img src="${hero(x.b)?.img}">
        <div>${esc(hero(x.a)?.name)} + ${esc(hero(x.b)?.name)}</div><div class="k ${wrCls(x.w / x.n)}">${pct(x.w / x.n, 0)} · ${x.n}</div></div>`).join("")}</div>` : ""}
    </div>`;
  }

  // ------------------------------------------------------------ all heroes table
  const tableState = { pos: "all", attr: "all", sort: "rating", dir: -1, q: "", favOnly: false };
  function viewHeroes() {
    app.innerHTML = `
      <h2>Все герои <small>мета ${esc(D.patch || "")} · ★ — мейн, ♥ — избранное</small></h2>
      <div class="tools">
        ${[["all", "Все"], ...Object.entries(POS)].map(([k, v]) => `<button class="chip ${tableState.pos === k ? "on" : ""}" data-pos="${k}">${v}</button>`).join("")}
        <span style="width:12px"></span>
        ${[["all", "Все"], ["str", "Сила"], ["agi", "Ловкость"], ["int", "Интеллект"], ["all_", "Универсал"]].map(([k, v]) => `<button class="chip ${tableState.attr === k ? "on" : ""}" data-attr="${k}">${v}</button>`).join("")}
        <button class="chip ${tableState.favOnly ? "on" : ""}" data-favonly>♥ Избранное</button>
        <input id="tq" placeholder="Фильтр по имени" value="${esc(tableState.q)}" style="margin-left:auto">
      </div>
      <div class="panel" style="padding:4px 6px;overflow-x:auto"><table class="t"><thead><tr>
        <th data-s="name">Герой</th>
        <th data-s="rating" class="num">Рейтинг D2PT</th>
        <th data-s="wr" class="num">Винрейт</th>
        <th data-s="matches" class="num hide-sm">Матчи</th>
        <th class="hide-sm">Позиции</th>
        <th class="num">Билд</th>
      </tr></thead><tbody id="tb"></tbody></table></div>`;

    app.querySelectorAll("[data-pos]").forEach((b) => (b.onclick = () => { tableState.pos = b.dataset.pos; viewHeroes(); }));
    app.querySelectorAll("[data-attr]").forEach((b) => (b.onclick = () => { tableState.attr = b.dataset.attr; viewHeroes(); }));
    app.querySelector("[data-favonly]").onclick = () => { tableState.favOnly = !tableState.favOnly; viewHeroes(); };
    app.querySelectorAll("th[data-s]").forEach((th) => {
      if (th.dataset.s === tableState.sort) th.classList.add("sorted");
      th.onclick = () => {
        tableState.dir = tableState.sort === th.dataset.s ? -tableState.dir : th.dataset.s === "name" ? 1 : -1;
        tableState.sort = th.dataset.s; viewHeroes();
      };
    });
    const tq = document.getElementById("tq");
    tq.oninput = () => { tableState.q = tq.value; fill(); };
    fill();

    function fill() {
      const rows = Object.values(D.heroes).filter((h) => h.meta).map((h) => {
        const s = tableState.pos === "all" ? h.meta : h.meta.pos[tableState.pos];
        return { h, rating: s.rating, wr: s.wr, matches: s.matches, name: h.name };
      }).filter((r) => (tableState.attr === "all" || r.h.attr === tableState.attr.replace("_", ""))
        && r.name.toLowerCase().includes(tableState.q.toLowerCase())
        && (!tableState.favOnly || favs.has(String(r.h.id)))
        && (tableState.pos === "all" || r.matches >= 50));
      rows.sort((a, b) => (a[tableState.sort] > b[tableState.sort] ? 1 : -1) * tableState.dir);
      const maxR = Math.max(...rows.map((r) => r.rating), 1);
      document.getElementById("tb").innerHTML = rows.map((r) => {
        const h = r.h, pos = tableState.pos === "all" ? bestPos(h) : tableState.pos;
        const tot = Object.values(h.meta.pos).reduce((a, b) => a + b.matches, 0) || 1;
        const has = D.builds[h.id] && Object.keys(D.builds[h.id]).length;
        return `<tr data-h="${h.id}" data-p="${posSlug(pos)}">
          <td><div class="hn"><img src="${h.img}" alt="" loading="lazy">${attrDot(h)}${esc(h.name)}
            ${allMains.has(String(h.id)) ? `<span class="star" title="Мейн">★</span>` : ""}${favs.has(String(h.id)) ? `<span class="star" title="Избранное">♥</span>` : ""}</div></td>
          <td class="num"><span class="bar" style="width:${(r.rating / maxR) * 60}px"></span>${r.rating.toFixed(1)}</td>
          <td class="num ${wrCls(r.wr)}">${pct(r.wr)}</td>
          <td class="num hide-sm">${r.matches.toLocaleString("ru-RU")}</td>
          <td class="hide-sm muted small">${Object.entries(h.meta.pos).filter(([, v]) => v.matches / tot > 0.1).map(([k, v]) => `${POS_SHORT[k]} <small>${Math.round(v.matches / tot * 100)}%</small>`).join(" · ")}</td>
          <td class="num">${has ? "✓" : `<span class="dim">—</span>`}</td>
        </tr>`;
      }).join("");
      document.querySelectorAll("#tb tr").forEach((tr) => (tr.onclick = () => (location.hash = `#/h/${tr.dataset.h}/${tr.dataset.p}`)));
    }
  }

  // ------------------------------------------------------------ hero page
  function viewHero(hid, pos, aid) {
    const h = hero(hid);
    if (!h) return viewMissing();
    const hb = D.builds[hid] || {};
    const positions = Object.keys(hb);
    pos = posKey(pos);
    if (!hb[pos]) pos = positions[0] || pos;
    const b = hb[pos];
    const p = aid && playerById(aid);
    const mine = p && p.mains.find((m) => String(m.hero_id) === String(hid));
    const pm = h.meta?.pos?.[pos];
    const isFav = favs.has(String(hid));
    const cardUrl = `#/c/${hid}/${posSlug(pos)}`;

    const head = `
      <div class="panel hhead">
        <img class="bgpic" src="${h.img}" alt="">
        <img class="portrait" src="${h.img}" alt="">
        <div>
          ${p ? `<a href="#/p/${p.account_id}" class="muted small">← ${esc(p.name)}</a>` : `<a href="#/heroes" class="muted small">← все герои</a>`}
          <h1>${attrDot(h)}${esc(h.name)}</h1>
          <div class="muted small">${(h.roles || []).join(" · ")}</div>
          <div class="stats">
            ${b ? `<div class="stat"><div class="v ${wrCls(b.wr)}">${pct(b.wr)}</div><div class="k">Винрейт билда</div></div>
            <div class="stat"><div class="v">${(b.matches || 0).toLocaleString("ru-RU")}</div><div class="k">Матчей в выборке</div></div>` : ""}
            ${pm ? `<div class="stat"><div class="v">${pm.rating.toFixed(0)}</div><div class="k">Рейтинг D2PT</div></div>` : ""}
            ${mine && mine.games ? `<div class="stat"><div class="v ${wrCls(mine.win / mine.games)}">${mine.games} · ${pct(mine.win / mine.games, 0)}</div><div class="k">Игры ${esc(p.name)}</div></div>` : ""}
          </div>
        </div>
        <div class="acts">
          <button class="btn ${isFav ? "on" : ""}" data-fav="${hid}" data-label="1">${isFav ? "★ В избранном" : "☆ В избранное"}</button>
          <a class="btn" href="${cardUrl}" id="cardbtn" title="Компактная карточка: открой в отдельном окне на втором мониторе">🗔 Карточка на игру</a>
          <a class="btn" target="_blank" rel="noopener" href="https://dota2protracker.com/hero/${encodeURIComponent(h.name)}">D2PT ↗</a>
        </div>
      </div>
      <div class="tabs">${positions.map((k) => `<a class="tab ${k === pos ? "on" : ""}" href="#/h/${hid}/${posSlug(k)}${aid ? "/" + aid : ""}">${POS[k]} <small>${(hb[k].matches || 0).toLocaleString("ru-RU")}</small></a>`).join("")}</div>`;

    if (!b) {
      app.innerHTML = head + `<div class="panel empty">Билд для этого героя ещё не скачан.<br><br><code>python update.py --hero ${h.id}</code></div>` + notesPanel(hid) + patchPanel(hid);
      bindFavs(); bindNotes(hid); bindCardBtn(cardUrl);
      return;
    }
    const mm = myMatchesOn(hid, aid);

    app.innerHTML = head + `
      <div class="grid2">
        <div class="panel">
          <h3>Прокачка скиллов <small>${pct(b.skill_orders[0]?.pr, 0)} игроков · WR ${pct(b.skill_orders[0]?.wr)}</small></h3>
          <div id="skills"></div>
          ${b.skill_orders.length > 1 ? `<div class="alts">${b.skill_orders.map((s, i) => `<button class="chip ${i === 0 ? "on" : ""}" data-so="${i}">Вариант ${i + 1} · ${pct(s.pr, 0)} · WR ${pct(s.wr)}</button>`).join("")}</div>` : ""}
        </div>
        <div class="panel">
          <h3>Таланты</h3>
          ${talentsHtml(b)}
        </div>

        <div class="panel">
          <h3>Стартовые предметы</h3>
          ${b.starting.map((s) => `<div class="opt"><div class="items">${countItems(s.items)}</div>
            <div class="wr"><b class="${wrCls(s.wr)}">${pct(s.wr)}</b><br>${s.n} игр${s.lane != null ? ` · лайн ${s.lane > 0 ? "+" : ""}${s.lane}` : ""}</div></div>`).join("")}
        </div>
        <div class="panel">
          <h3>Поздняя игра <small>типичный инвентарь</small></h3>
          <div class="late">${Object.entries(b.late).map(([k, ids]) => `<div class="lr"><span>${k}</span><div class="items">${ids.map((i) => itemIc(i, "", "sm")).join("")}</div></div>`).join("")}</div>
        </div>

        <div class="panel span2">
          <h3>Кор-билд <small>средняя минута покупки · % игроков</small></h3>
          <div class="items" style="gap:4px">${b.core.map((c, i) => (i ? `<span class="arrow">›</span>` : "") + itemIc(c.id, `<b>${minFmt(c.min)}</b> ${pct(c.pr, 0)}`)).join("")}</div>
          <h3 style="margin-top:18px">Ситуативные <small>по времени покупки · винрейт</small></h3>
          <div class="items">${b.situational.map((c) => itemIc(c.id, `<b>${minFmt(c.min)}</b> <span class="${wrCls(c.wr)}">${pct(c.wr, 0)}</span>`)).join("")}</div>
        </div>

        <div class="panel">
          <h3>Нейтральные предметы <small>популярность · WR</small></h3>
          <div class="tiers">${b.neutrals.map(tierRow).join("")}</div>
        </div>
        <div class="panel">
          <h3>Энчанты нейтралок</h3>
          <div class="tiers">${b.enchants.map(tierRow).join("")}</div>
        </div>

        ${matchupPanel(hid, pos, b)}
        ${mm.length ? comparePanel(hid, b, mm) : `<div class="panel"><h3>Мои игры на герое</h3><div class="dim small">В последних разобранных матчах этого героя нет. Скрипт берёт последние 20 матчей каждого игрока.</div></div>`}
      </div>
      <div class="grid2">${notesPanel(hid)}${patchPanel(hid)}</div>
      <div class="dim small" style="margin-top:10px">Патч ${esc(b.patch || "")} · данные D2PT обновлены ${b.updated_at ? new Date(b.updated_at).toLocaleString("ru-RU") : "—"}</div>`;

    const renderSkills = (i) => (document.getElementById("skills").innerHTML = skillGrid(b.skill_orders[i].seq));
    renderSkills(0);
    app.querySelectorAll("[data-so]").forEach((btn) => (btn.onclick = () => {
      app.querySelectorAll("[data-so]").forEach((x) => x.classList.toggle("on", x === btn));
      renderSkills(+btn.dataset.so);
    }));
    bindFavs(); bindNotes(hid); bindCardBtn(cardUrl);
  }

  function bindCardBtn(url) {
    const a = document.getElementById("cardbtn");
    if (a) a.onclick = (e) => {
      e.preventDefault();
      const w = window.open(location.pathname + url, "dotahub-card", "width=560,height=980");
      if (!w) location.hash = url;
    };
  }

  function talentsHtml(b) {
    return `<div class="talents">${[...b.talents].sort((a, c) => c.lvl - a.lvl).map((t) => `
      <div class="tal">
        <div class="s l ${t.left_pr >= t.right_pr ? "pick" : ""}">${esc(t.left)}<em>${pct(t.left_pr, 0)} · WR ${pct(t.left_wr)}</em></div>
        <div class="lvl">${t.lvl}</div>
        <div class="s ${t.right_pr > t.left_pr ? "pick" : ""}">${esc(t.right)}<em>${pct(t.right_pr, 0)} · WR ${pct(t.right_wr)}</em></div>
      </div>`).join("")}</div>`;
  }

  function countItems(ids) {
    const c = new Map();
    ids.forEach((i) => c.set(i, (c.get(i) || 0) + 1));
    return [...c].map(([id, n]) => itemIc(id, n > 1 ? `×${n}` : "", "sm")).join("");
  }
  function tierRow(t, top) {
    const list = top ? t.items.slice(0, top) : t.items;
    return `<div class="tier"><div class="tn">Тир ${t.tier}</div>
      <div class="items">${list.map((r) => itemIc(r.id, `<b>${pct(r.pr, 0)}</b><br><span class="${wrCls(r.wr)}">WR ${pct(r.wr, 0)}</span>`, "sm")).join("") || `<span class="dim">—</span>`}</div></div>`;
  }

  // сетка прокачки; cmp — эталон (мета) для подсветки расхождений
  function skillGrid(seq, cmp) {
    const isTal = (a) => abil(a).talent || /special_bonus/.test(abil(a).key || "");
    const order = [];
    seq.forEach((a) => !isTal(a) && !order.includes(a) && order.push(a));
    const ult = seq[5];
    order.sort((a, b) => (a === ult) - (b === ult));
    const n = seq.length;
    const lv = `<div class="skrow lv" style="--n:${n}"><div></div>${seq.map((_, i) => `<div class="c">${i + 1}</div>`).join("")}</div>`;
    const diff = (i) => cmp && cmp[i] != null && cmp[i] !== seq[i] ? "diff" : "";
    const rows = order.map((a) => {
      const ab = abil(a);
      return `<div class="skrow" style="--n:${n}"><div class="ic" title="${esc(ab.name)}\n${esc(ab.desc || "")}">${ab.img ? `<img src="${ab.img}" alt="">` : esc(ab.name.slice(0, 3))}</div>
        ${seq.map((x, i) => `<div class="c ${x === a ? (a === ult ? "ult" : "on") + " " + diff(i) : ""}">${x === a ? i + 1 : ""}</div>`).join("")}</div>`;
    });
    if (seq.some(isTal))
      rows.push(`<div class="skrow" style="--n:${n}"><div class="ic t">ТАЛ</div>${seq.map((x, i) => `<div class="c ${isTal(x) ? "tal " + diff(i) : ""}" title="${isTal(x) ? esc(abil(x).name) : ""}">${isTal(x) ? i + 1 : ""}</div>`).join("")}</div>`);
    return `<div class="skills">${lv}${rows.join("")}</div>
      <div class="dim small" style="margin-top:8px">${order.map((a) => esc(abil(a).name)).join(" · ")}${cmp ? ` · <span class="bad">красная рамка</span> — не как в мете` : ""}</div>`;
  }

  // ---- #1 матчапы
  function matchupPanel(hid, pos, b) {
    const mu = D.matchups[hid]?.[pos];
    if (!mu) return `<div class="panel span2"><h3>Матчапы</h3><div class="dim small">Нет данных. Они скачиваются для мейнов: <code>python update.py</code></div></div>`;
    const base = b?.wr ?? hero(hid).meta?.pos?.[pos]?.wr ?? 0.5;
    const vs = mu.vs.filter((r) => r[1] >= 50).map((r) => ({ id: r[0], n: r[1], d: r[2] - base }));
    const wi = mu.with.filter((r) => r[1] >= 50).map((r) => ({ id: r[0], n: r[1], d: r[2] - base }));
    const lane = (mu.lane_vs || []).filter((r) => r[1] >= 30).map((r) => ({ id: r[0], n: r[1], d: r[3] }));
    const grid = (list, fmt = (x) => sgn(x.d), cls = (x) => dCls(x.d)) => `<div class="mu">${list.map((x) => `
      <a href="${heroLink(x.id)}" title="${esc(hero(x.id)?.name)} · ${x.n} игр"><img src="${hero(x.id)?.img}" alt=""><b class="${cls(x)}">${fmt(x)}</b>${esc(hero(x.id)?.name || "")}</a>`).join("")}</div>`;
    const by = (a, dir) => a.slice().sort((x, y) => dir * (x.d - y.d)).slice(0, 8);
    return `<div class="panel span2">
      <h3>Матчапы <small>разница винрейта против базового ${pct(base)} · только пары от 50 игр</small></h3>
      <div class="grid3" style="margin-top:0">
        <div class="mu-sec"><h4>😖 Тебя контрят</h4>${grid(by(vs, 1))}</div>
        <div class="mu-sec"><h4>😎 Ты контришь</h4>${grid(by(vs, -1))}</div>
        <div class="mu-sec"><h4>🤝 Лучшие союзники</h4>${grid(by(wi, -1))}</div>
      </div>
      ${lane.length ? `<div class="mu-sec" style="margin-top:14px"><h4>Самые тяжёлые линии <small class="dim">(преимущество на линии, чем ниже — тем хуже)</small></h4>
        ${grid(by(lane, 1), (x) => (x.d > 0 ? "+" : "") + x.d.toFixed(1), (x) => (x.d > 0 ? "good" : x.d < 0 ? "bad" : ""))}</div>` : ""}
    </div>`;
  }

  // ---- #3, #4 сравнение моих игр с метой
  function comparePanel(hid, b, mm) {
    const last = mm[0];
    const metaSeq = b.skill_orders[0]?.seq || [];
    const lvls = Math.min(metaSeq.length, 10);
    const skillMatch = (m) => { let ok = 0; for (let i = 0; i < lvls; i++) ok += m.skills[i] === metaSeq[i] ? 1 : 0; return ok / lvls; };
    const avgSkill = avg(mm.filter((m) => m.skills.length >= lvls).map(skillMatch));
    const metaIds = new Set([...b.core.map((c) => c.id), ...b.situational.map((c) => c.id)]);
    const had = (m, id) => m.items.includes(id) || (m.purchases || []).some((x) => x[1] === id);
    const firstBuy = (m, id) => { const x = (m.purchases || []).find((p) => p[1] === id); return x ? x[0] / 60 : null; };
    const rows = b.core.map((c) => {
      const n = mm.filter((m) => had(m, c.id)).length;
      const times = mm.map((m) => firstBuy(m, c.id)).filter((x) => x != null);
      const my = avg(times);
      const turboOnly = mm.every((m) => m.mode === 23);
      return { id: c.id, meta: c.min, my, n, d: my != null && c.min != null && !turboOnly ? my - c.min : null };
    });
    const extra = {};
    mm.forEach((m) => m.items.forEach((i) => { if (!metaIds.has(i) && (item(i).cost || 0) >= 1500) extra[i] = (extra[i] || 0) + 1; }));
    const extraList = Object.entries(extra).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const parsedN = mm.filter((m) => m.parsed).length;
    const turbo = mm.filter((m) => m.mode === 23).length;
    return `<div class="panel span2">
      <h3>Мои игры против меты <small>${mm.length} игр${parsedN < mm.length ? ` · тайминги есть в ${parsedN} (разобранные реплеи)` : ""}</small></h3>
      ${turbo ? `<div class="note" style="margin:0 0 12px">${turbo} из ${mm.length} игр — Turbo. Мета D2PT собрана по обычным играм высокого рейтинга, в Turbo предметы приходят заметно раньше.</div>` : ""}
      <div class="grid2" style="margin-top:0">
        <div>
          <h3>Прокачка в последней игре <small>совпадение с метой: ${pct(skillMatch(last), 0)} · в среднем ${pct(avgSkill, 0)}</small></h3>
          ${last.skills.length ? skillGrid(last.skills.slice(0, 18), metaSeq) : `<div class="dim small">нет данных о прокачке</div>`}
        </div>
        <div>
          <h3>Кор-предметы</h3>
          <table class="cmp"><thead><tr><th>Предмет</th><th>Мета</th><th>Я</th><th>Разница</th><th>Собирал</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td><div class="iname"><img src="${item(r.id).img || ""}" alt="">${esc(item(r.id).name)}</div></td>
            <td>${minFmt(r.meta)}</td><td>${r.my != null ? minFmt(r.my) : "—"}</td>
            <td class="${r.d == null ? "" : r.d > 2 ? "bad" : r.d < -1 ? "good" : ""}">${r.d == null ? "—" : (r.d > 0 ? "+" : "") + Math.round(r.d) + " мин"}</td>
            <td class="${r.n / mm.length < 0.4 ? "bad" : ""}">${r.n}/${mm.length}</td></tr>`).join("")}
          </tbody></table>
          ${extraList.length ? `<h3 style="margin-top:14px">Собираю, а в мете редко <small>игр с предметом</small></h3>
            <div class="items">${extraList.map(([id, n]) => itemIc(+id, `${n}/${mm.length}`, "sm")).join("")}</div>` : ""}
        </div>
      </div>
      <h3 style="margin-top:12px">Матчи на герое</h3>
      <div class="mlist">${mm.slice(0, 6).map((m) => matchRow(m, m.player)).join("")}</div>
    </div>`;
  }

  // ---- #13 заметки
  function notesPanel(hid) {
    return `<div class="panel"><h3>Мои заметки <small>сохраняются в этом браузере</small></h3>
      <textarea class="notes" id="notes" placeholder="Например: против Bristleback сразу Spirit Vessel; на линии держаться у вышки до 3 лвл…">${esc(notes[hid] || "")}</textarea>
      <div class="dim small" id="notes-st" style="margin-top:4px"></div></div>`;
  }
  function bindNotes(hid) {
    const t = document.getElementById("notes"), st = document.getElementById("notes-st");
    if (!t) return;
    let timer;
    t.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (t.value.trim()) notes[hid] = t.value; else delete notes[hid];
        store.set("notes", notes);
        st.textContent = "сохранено " + new Date().toLocaleTimeString("ru-RU");
      }, 400);
    };
  }

  // ---- #16 патчноуты
  function patchPanel(hid) {
    const list = D.patches[hid];
    if (!list) return `<div class="panel"><h3>Изменения в патчах</h3><div class="dim small">Нет данных.</div></div>`;
    return `<div class="panel pn"><h3>Изменения в патчах <small><a class="muted" href="https://www.dota2.com/patches/${esc(list[0].patch)}" target="_blank" rel="noopener">dota2.com ↗</a></small></h3>
      ${list.map((p, i) => `<details ${i === 0 ? "open" : ""}><summary>Патч ${esc(p.patch)}</summary>
        ${p.blocks.map(([title, lines]) => `${title ? `<h5>${esc(title)}</h5>` : ""}<ul>${lines.filter((l) => l && l !== "<br>").map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("")}
      </details>`).join("")}</div>`;
  }

  // ------------------------------------------------------------ #7 карточка на второй монитор
  function viewCard(hid, pos) {
    document.body.classList.add("card-mode");
    const h = hero(hid), hb = D.builds[hid] || {};
    pos = posKey(pos);
    if (!hb[pos]) pos = Object.keys(hb)[0];
    const b = hb[pos];
    if (!h || !b) { app.innerHTML = `<div class="panel empty">Нет билда. <a href="#/">На главную</a></div>`; return; }
    const mu = D.matchups[hid]?.[pos];
    const counters = mu ? mu.vs.filter((r) => r[1] >= 50).map((r) => ({ id: r[0], d: r[2] - b.wr })).sort((a, c) => a.d - c.d).slice(0, 6) : [];
    app.innerHTML = `<div class="gc">
      <div class="panel ghead"><img src="${h.img}" alt=""><div><h1>${esc(h.name)}</h1><div class="muted">${POS[pos]} · WR ${pct(b.wr)} · ${esc(b.patch || "")}</div></div>
        <a class="btn" style="margin-left:auto" href="#/h/${hid}/${posSlug(pos)}" onclick="document.body.classList.remove('card-mode')">Полный ↗</a></div>
      <div class="panel"><h3>Прокачка</h3>${skillGrid(b.skill_orders[0].seq)}</div>
      <div class="panel"><h3>Старт</h3><div class="items">${countItems(b.starting[0]?.items || [])}</div></div>
      <div class="panel"><h3>Кор-билд <small>минута</small></h3><div class="items">${b.core.map((c) => itemIc(c.id, `<b>${minFmt(c.min)}</b>`, "sm")).join("")}</div>
        <h3 style="margin-top:12px">Ситуативно</h3><div class="items">${b.situational.slice(0, 10).map((c) => itemIc(c.id, minFmt(c.min), "xs")).join("")}</div></div>
      <div class="panel"><h3>Таланты</h3>${talentsHtml(b)}</div>
      <div class="panel"><h3>Нейтралки</h3><div class="tiers">${b.neutrals.map((t) => tierRow(t, 2)).join("")}</div></div>
      ${counters.length ? `<div class="panel"><h3>Опасные враги</h3><div class="mu">${counters.map((x) => `<a><img src="${hero(x.id)?.img}"><b class="bad">${sgn(x.d)}</b>${esc(hero(x.id)?.name)}</a>`).join("")}</div></div>` : ""}
      ${notes[hid] ? `<div class="panel"><h3>Заметка</h3><div style="white-space:pre-wrap">${esc(notes[hid])}</div></div>` : ""}
    </div>`;
  }

  // ------------------------------------------------------------ #2 помощник драфта
  const COUNTER_TAGS = {
    invis: { label: "невидимость", items: ["dust", "ward_sentry", "gem"], heroes: ["riki", "clinkz", "bounty_hunter", "nyx_assassin", "weaver", "mirana", "invoker", "treant", "sand_king", "templar_assassin"] },
    evasion: { label: "уклонение", items: ["monkey_king_bar", "bloodthorn"], heroes: ["phantom_assassin", "brewmaster", "windrunner", "faceless_void"] },
    heal: { label: "лечение и реген", items: ["spirit_vessel", "skadi", "shivas_guard"], heroes: ["necrolyte", "alchemist", "huskar", "oracle", "dazzle", "omniknight", "chen", "witch_doctor", "wisp", "undying", "abaddon", "morphling", "dragon_knight", "warlock", "lifestealer", "life_stealer", "tidehunter", "timbersaw", "shredder"] },
    illusions: { label: "иллюзии и призывы", items: ["mjollnir", "bfury", "radiance", "maelstrom", "crimson_guard"], heroes: ["phantom_lancer", "naga_siren", "terrorblade", "chaos_knight", "meepo", "lycan", "broodmother", "furion", "beastmaster", "visage", "enigma", "arc_warden", "spectre"] },
    magic: { label: "магический урон", items: ["black_king_bar", "pipe", "glimmer_cape", "eternal_shroud"], heroes: ["lion", "lina", "zuus", "tinker", "skywrath_mage", "leshrac", "queenofpain", "storm_spirit", "puck", "nyx_assassin", "invoker", "ogre_magi", "death_prophet", "jakiro", "pugna", "techies"] },
    disable: { label: "контроль", items: ["black_king_bar", "lotus_orb", "sphere", "manta", "aeon_disk"], heroes: ["bane", "doom_bringer", "shadow_shaman", "lion", "silencer", "enigma", "faceless_void", "batrider", "magnataur", "tidehunter", "legion_commander", "pudge", "grimstroke", "disruptor"] },
    physical: { label: "физический урон", items: ["ghost", "heavens_halberd", "shivas_guard", "assault", "blade_mail", "crimson_guard", "solar_crest"], heroes: ["phantom_assassin", "sven", "troll_warlord", "juggernaut", "ursa", "slardar", "monkey_king", "life_stealer", "faceless_void", "chaos_knight", "luna", "drow_ranger", "medusa", "gyrocopter", "muerta", "kez"] },
    mobile: { label: "мобильность", items: ["orchid", "bloodthorn", "abyssal_blade", "sheepstick", "rod_of_atos", "gungir"], heroes: ["storm_spirit", "queenofpain", "antimage", "ember_spirit", "void_spirit", "puck", "weaver", "slark", "morphling", "faceless_void", "mirana", "earth_spirit", "pangolier", "marci", "hoodwink"] },
    passive: { label: "пассивки (break)", items: ["silver_edge"], heroes: ["bristleback", "spectre", "phantom_assassin", "huskar", "slark", "tiny", "sniper", "troll_warlord", "legion_commander", "axe", "faceless_void", "ursa"] },
    saves: { label: "сейвы и защита", items: ["nullifier", "sheepstick"], heroes: ["oracle", "dazzle", "omniknight", "abaddon", "shadow_demon", "wisp", "winter_wyvern", "vengefulspirit"] },
  };
  const draft = { aid: store.get("draft.aid", D.players[0]?.account_id), enemies: [], allies: [], pool: "mains" };

  function viewDraft() {
    const p = playerById(draft.aid) || D.players[0];
    const pool = draft.pool === "mains" ? [...new Set([...(p?.mains || []).map((m) => m.hero_id), ...[...favs].map(Number)])]
      : Object.keys(D.matchups).filter((k) => Object.keys(D.matchups[k]).length).map(Number);
    const res = pool.map((hid) => scoreHero(hid)).filter(Boolean).sort((a, b) => b.score - a.score);
    const tagHits = {};
    draft.enemies.forEach((e) => {
      const npc = hero(e)?.npc;
      Object.entries(COUNTER_TAGS).forEach(([k, t]) => t.heroes.includes(npc) && (tagHits[k] = [...(tagHits[k] || []), e]));
    });
    app.innerHTML = `
      <h2>Помощник драфта <small>какого героя взять и что собрать</small></h2>
      <div class="panel">
        <div class="tools">
          <span class="muted">Чей пул:</span>
          ${D.players.map((x) => `<button class="chip ${String(x.account_id) === String(p?.account_id) ? "on" : ""}" data-aid="${x.account_id}">${esc(x.label || x.name)}</button>`).join("")}
          <span style="width:10px"></span>
          <button class="chip ${draft.pool === "mains" ? "on" : ""}" data-pool="mains">Мейны + избранное</button>
          <button class="chip ${draft.pool === "all" ? "on" : ""}" data-pool="all">Все герои с матчапами (${Object.values(D.matchups).filter((v) => Object.keys(v).length).length})</button>
        </div>
        <div class="grid2" style="margin-top:8px">
          <div><h3>Враги <small>до 5</small></h3><div class="picks">${pickList(draft.enemies, "enemies")}${draft.enemies.length < 5 ? pickSearch("enemies") : ""}</div></div>
          <div><h3>Союзники <small>до 4</small></h3><div class="picks">${pickList(draft.allies, "allies")}${draft.allies.length < 4 ? pickSearch("allies") : ""}</div></div>
        </div>
      </div>
      <div class="grid2">
        <div class="panel">
          <h3>Рекомендации <small>сумма разницы винрейта против врагов и с союзниками</small></h3>
          ${!draft.enemies.length && !draft.allies.length ? `<div class="dim small" style="margin-bottom:8px">Добавь героев, чтобы увидеть расчёт.</div>` : ""}
          ${res.length ? res.slice(0, 15).map((r) => `
            <a class="drow" href="${heroLink(r.hid, p?.account_id)}">
              <img class="h" src="${hero(r.hid).img}" alt="">
              <div><b>${esc(hero(r.hid).name)}</b> <span class="dim small">${POS[r.pos]}</span>
                <div class="vs">${r.parts.map((x) => `<span title="${x.n} игр"><img src="${hero(x.id)?.img}">${x.ally ? "🤝" : "⚔"} <b class="${dCls(x.d)}">${sgn(x.d)}</b></span>`).join("")}</div></div>
              <div class="score ${dCls(r.score)}">${sgn(r.score)}</div>
            </a>`).join("") : `<div class="dim small">Нет данных матчапов для этого пула. Запусти <code>python update.py</code>.</div>`}
        </div>
        <div class="panel">
          <h3>Что собирать против этого драфта <small>общие подсказки</small></h3>
          ${Object.keys(tagHits).length ? Object.entries(tagHits).map(([k, list]) => `
            <div class="opt"><div style="min-width:130px"><b>${COUNTER_TAGS[k].label}</b><div class="heroes-mini">${list.map((e) => `<img src="${hero(e)?.img}">`).join("")}</div></div>
            <div class="items">${COUNTER_TAGS[k].items.map((key) => D.item_keys[key] ? itemIc(D.item_keys[key], "", "sm") : "").join("")}</div></div>`).join("")
            : `<div class="dim small">Добавь врагов: здесь появятся предметы против невидимости, иллюзий, магического урона и т.п.</div>`}
        </div>
      </div>`;

    app.querySelectorAll("[data-aid]").forEach((b) => (b.onclick = () => { draft.aid = b.dataset.aid; store.set("draft.aid", draft.aid); viewDraft(); }));
    app.querySelectorAll("[data-pool]").forEach((b) => (b.onclick = () => { draft.pool = b.dataset.pool; viewDraft(); }));
    app.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { const [side, id] = b.dataset.rm.split(":"); draft[side] = draft[side].filter((x) => x != id); viewDraft(); }));
    app.querySelectorAll(".dsearch input").forEach((inp) => {
      const box = inp.nextElementSibling, side = inp.dataset.side;
      inp.oninput = () => {
        const s = inp.value.trim().toLowerCase();
        if (!s) { box.hidden = true; return; }
        const taken = new Set([...draft.enemies, ...draft.allies].map(String));
        const list = Object.values(D.heroes).filter((h) => h.name.toLowerCase().includes(s) && !taken.has(String(h.id))).slice(0, 7);
        box.innerHTML = list.map((h, i) => `<a data-add="${h.id}" class="${i === 0 ? "sel" : ""}"><img class="hero-ic" src="${h.img}">${esc(h.name)}</a>`).join("") || `<div class="hint">не найдено</div>`;
        box.hidden = false;
        box.querySelectorAll("[data-add]").forEach((a) => (a.onclick = () => add(side, +a.dataset.add)));
      };
      inp.onkeydown = (e) => { if (e.key === "Enter" || e.keyCode === 13) { const a = box.querySelector("[data-add]"); if (a) add(side, +a.dataset.add); } };
    });
    function add(side, id) { draft[side].push(id); viewDraft(); setTimeout(() => app.querySelector(`.dsearch input[data-side="${side}"]`)?.focus(), 0); }
  }
  const pickList = (ids, side) => ids.map((id) => `<div class="pick" title="${esc(hero(id)?.name)}"><img src="${hero(id)?.img}"><button data-rm="${side}:${id}">×</button></div>`).join("");
  const pickSearch = (side) => `<div class="dsearch"><input class="inp" data-side="${side}" placeholder="+ герой" autocomplete="off"><div class="suggest" hidden></div></div>`;

  function scoreHero(hid) {
    const mus = D.matchups[hid];
    if (!mus) return null;
    let best = null;
    Object.entries(mus).forEach(([pos, mu]) => {
      const base = D.builds[hid]?.[pos]?.wr ?? hero(hid)?.meta?.pos?.[pos]?.wr ?? 0.5;
      const parts = [];
      draft.enemies.forEach((e) => { const r = mu.vs.find((x) => x[0] == e); if (r && r[1] >= 30) parts.push({ id: e, d: r[2] - base, n: r[1] }); });
      draft.allies.forEach((a) => { const r = mu.with.find((x) => x[0] == a); if (r && r[1] >= 30) parts.push({ id: a, d: r[2] - base, n: r[1], ally: true }); });
      const score = parts.reduce((s, x) => s + x.d, 0);
      if (!best || score > best.score) best = { hid, pos, parts, score };
    });
    if (best && [...draft.enemies, ...draft.allies].includes(hid)) return null;
    return best;
  }

  // ------------------------------------------------------------ #12 разбор матча
  function viewMatch(mid, aid) {
    let p = playerById(aid), m = p?.matches.find((x) => String(x.match_id) === String(mid));
    if (!m) D.players.some((pp) => (m = pp.matches.find((x) => String(x.match_id) === String(mid))) && (p = pp));
    if (!m) { app.innerHTML = `<div class="panel empty">Матч не найден в локальных данных. <a class="ext" href="https://www.opendota.com/matches/${esc(mid)}" target="_blank">OpenDota ↗</a></div>`; return; }
    const h = hero(m.hero_id);
    const pos = { 1: "pos 1", 2: "pos 2", 3: "pos 3" }[m.lane_role] && D.builds[m.hero_id]?.[{ 1: "pos 1", 2: "pos 2", 3: "pos 3" }[m.lane_role]] ? { 1: "pos 1", 2: "pos 2", 3: "pos 3" }[m.lane_role] : firstPos(m.hero_id);
    const b = D.builds[m.hero_id]?.[pos];
    const isCore = ["pos 1", "pos 2", "pos 3"].includes(pos);
    const tips = matchTips(m, b, isCore);
    const npcSelf = h?.npc;
    const bench = Object.entries(BENCH).filter(([k]) => m.bench[k] != null);

    app.innerHTML = `
      <div class="panel hhead" style="min-height:0">
        <img class="bgpic" src="${h?.img}" alt="">
        <img class="portrait" style="width:160px" src="${h?.img}" alt="">
        <div>
          <a href="#/p/${p.account_id}" class="muted small">← ${esc(p.name)}</a>
          <h1>${esc(h?.name)} <span class="badge ${m.win ? "w" : "l"}" style="font-size:14px">${m.win ? "Победа" : "Поражение"}</span></h1>
          <div class="muted small">${mode(m)} · ${tFmt(m.duration)} · счёт ${m.score?.join(" : ")} · ${new Date(m.start * 1000).toLocaleString("ru-RU")} · ${LANES[m.lane_role] || ""}</div>
          <div class="stats">
            <div class="stat"><div class="v">${m.k}/${m.d}/${m.a}</div><div class="k">KDA</div></div>
            <div class="stat"><div class="v">${m.gpm}</div><div class="k">GPM</div></div>
            <div class="stat"><div class="v">${m.xpm}</div><div class="k">XPM</div></div>
            <div class="stat"><div class="v">${m.lh}/${m.dn}</div><div class="k">Добивания</div></div>
            ${m.lh10 != null ? `<div class="stat"><div class="v">${m.lh10}</div><div class="k">LH к 10 мин</div></div>` : ""}
            <div class="stat"><div class="v">${(m.nw || 0).toLocaleString("ru-RU")}</div><div class="k">Net worth</div></div>
          </div>
        </div>
        <div class="acts">
          <a class="btn" target="_blank" rel="noopener" href="https://www.opendota.com/matches/${m.match_id}">OpenDota ↗</a>
          <a class="btn" target="_blank" rel="noopener" href="https://stratz.com/matches/${m.match_id}">STRATZ ↗</a>
        </div>
      </div>
      ${!m.parsed ? `<div class="note">Реплей ещё не разобран OpenDota: нет таймингов предметов, графика золота и добиваний по минутам. Скрипт уже отправил запрос на разбор. Запусти <code>python update.py</code> через 10–30 минут.</div>` : ""}

      <div class="grid2">
        <div class="panel">
          <h3>Вывод</h3>
          ${tips.length ? `<ul class="tips">${tips.map((t) => `<li class="${t.cls}">${t.text}</li>`).join("")}</ul>` : `<div class="dim small">Нечего добавить: всё в пределах нормы.</div>`}
          <div class="teams" style="margin-top:14px">
            <div><div class="dim small">Союзники</div><div class="side"><img class="me" src="${h?.img}" title="${esc(h?.name)}">${m.allies.map((x) => `<img src="${hero(x)?.img}" title="${esc(hero(x)?.name)}">`).join("")}</div></div>
            <div><div class="dim small">Враги</div><div class="side">${m.enemies.map((x) => `<a href="${heroLink(x)}"><img src="${hero(x)?.img}" title="${esc(hero(x)?.name)}"></a>`).join("")}</div></div>
          </div>
        </div>
        <div class="panel">
          <h3>Сравнение с игроками на этом герое <small>перцентиль OpenDota</small></h3>
          ${bench.length ? hbars(bench.map(([k, l]) => ({ label: l, v: m.bench[k], max: 1, text: Math.round(m.bench[k] * 100) + "%", color: m.bench[k] >= 0.6 ? "var(--good)" : m.bench[k] < 0.35 ? "var(--bad)" : "var(--accent-2)" }))) : `<div class="dim small">нет данных</div>`}
        </div>

        ${m.gold_adv.length ? `<div class="panel span2"><h3>Преимущество команды <small>золото и опыт, + — у нас</small></h3>
          ${lineChart([{ values: m.gold_adv, color: "var(--accent-2)" }, { values: m.xp_adv, color: "var(--int)", width: 1.5 }], { h: 160, zero: true, fmt: (v) => (v / 1000).toFixed(0) + "k" })}
          <div class="legend"><span><i style="background:var(--accent-2)"></i>золото</span><span><i style="background:var(--int)"></i>опыт</span><span>по минутам</span></div></div>` : ""}

        <div class="panel">
          <h3>Предметы <small>${m.purchases.length ? "минута покупки vs мета" : "итоговый инвентарь"}</small></h3>
          <div class="items">${m.items.map((i) => itemIc(i, "", "sm")).join("")}${m.neutral ? itemIc(m.neutral, "нейтр.", "sm") : ""}</div>
          ${m.purchases.length ? `<table class="cmp" style="margin-top:12px"><thead><tr><th>Покупка</th><th>Я</th><th>Мета</th><th></th></tr></thead><tbody>
            ${m.purchases.filter((x) => (item(x[1]).cost || 0) >= 1000).map(([t, id]) => { const c = b?.core.find((x) => x.id === id) || b?.situational.find((x) => x.id === id); const d = c?.min != null && m.mode !== 23 ? t / 60 - c.min : null;
              return `<tr><td><div class="iname"><img src="${item(id).img || ""}">${esc(item(id).name)}</div></td><td>${tFmt(t)}</td><td>${c ? minFmt(c.min) : "—"}</td>
              <td class="${d == null ? "" : d > 3 ? "bad" : d < -1 ? "good" : ""}">${d == null ? "" : (d > 0 ? "+" : "") + Math.round(d) + " мин"}</td></tr>`; }).join("")}
          </tbody></table>` : ""}
        </div>
        <div class="panel span2">
          <h3>Прокачка <small>${b ? "красная рамка — не как в мете" : ""}</small></h3>
          ${m.skills.length ? skillGrid(m.skills.slice(0, 18), b?.skill_orders[0]?.seq) : `<div class="dim small">нет данных</div>`}
        </div>

        ${Object.keys(m.killed_by || {}).length || m.kills_log?.length ? `<div class="panel span2"><div class="grid2" style="margin-top:0">
          <div><h3>Кто меня убивал</h3><div class="mu">${Object.entries(m.killed_by).sort((a, c) => c[1] - a[1]).map(([npc, n]) => { const eh = heroByNpc(npc); return `<a><img src="${eh?.img}"><b class="bad">×${n}</b>${esc(eh?.name || npc)}</a>`; }).join("") || `<span class="dim small">никто</span>`}</div></div>
          <div><h3>Мои убийства <small>по времени</small></h3><div class="mu">${(m.kills_log || []).map(([t, npc]) => { const eh = heroByNpc(npc); return `<a><img src="${eh?.img}"><b>${tFmt(t)}</b>${esc(eh?.name || npc)}</a>`; }).join("") || `<span class="dim small">нет</span>`}</div></div>
        </div></div>` : ""}
      </div>
      <div class="note plain">Нужен разбор драк, позиционирования и смертей по реплею? Спроси Claude: <i>«разбери матч ${m.match_id}»</i>. У него подключён <code>dota-replay</code>.</div>`;
  }

  function matchTips(m, b, isCore) {
    const t = [];
    const min = m.duration / 60;
    const turbo = m.mode === 23;
    if (m.bench.gold_per_min != null) {
      if (m.bench.gold_per_min < 0.3) t.push({ cls: "bad", text: `Фарм ниже, чем у ${Math.round((1 - m.bench.gold_per_min) * 100)}% игроков на этом герое (GPM ${m.gpm}).` });
      else if (m.bench.gold_per_min > 0.75) t.push({ cls: "good", text: `Отличный фарм: GPM ${m.gpm}, лучше ${Math.round(m.bench.gold_per_min * 100)}% игроков на герое.` });
    }
    if (isCore && m.lh10 != null && !turbo) {
      if (m.lh10 < 35) t.push({ cls: "bad", text: `${m.lh10} добиваний к 10 минуте: слабая линия. Для кора ориентир 50+.` });
      else if (m.lh10 >= 55) t.push({ cls: "good", text: `${m.lh10} добиваний к 10 минуте: линия выиграна.` });
    }
    const dpm = m.d / Math.max(1, min);
    if (m.d >= 8 || dpm > 0.25) {
      const top = Object.entries(m.killed_by || {}).sort((a, c) => c[1] - a[1])[0];
      t.push({ cls: "bad", text: `Много смертей (${m.d}).${top ? ` Чаще всего убивал ${esc(heroByNpc(top[0])?.name || top[0])} (×${top[1]}): стоит держаться дальше от него или купить защиту.` : ""}` });
    }
    if (b && m.purchases.length) {
      b.core.slice(0, 4).forEach((c) => {
        const x = m.purchases.find((p) => p[1] === c.id);
        if (x && c.min && x[0] / 60 - c.min > 5 && !turbo)
          t.push({ cls: "bad", text: `${esc(item(c.id).name)} на ${Math.round(x[0] / 60 - c.min)} мин позже, чем в мете (${minFmt(x[0] / 60)} против ${minFmt(c.min)}).` });
      });
    }
    if (b && m.skills.length >= 6) {
      const seq = b.skill_orders[0].seq;
      let diff = 0;
      for (let i = 0; i < Math.min(seq.length, m.skills.length, 10); i++) diff += seq[i] !== m.skills[i] ? 1 : 0;
      if (diff >= 4) t.push({ cls: "", text: `Прокачка заметно отличается от популярной (${diff} уровней из 10 не совпадают). Сверь с сеткой ниже.` });
    }
    if (m.tf != null && m.tf < 0.4 && min > 25) t.push({ cls: "bad", text: `Мало участия в драках: ${pct(m.tf, 0)} убийств команды.` });
    if (!isCore && m.obs != null && m.obs + (m.sen || 0) < min / 4) t.push({ cls: "bad", text: `Мало вардов для саппорта: ${m.obs || 0} обсов и ${m.sen || 0} сентри.` });
    if (turbo) t.push({ cls: "", text: "Turbo: сравнение таймингов с метой обычных игр отключено." });
    return t;
  }

  // ------------------------------------------------------------ missing player
  function viewMissing(aid) {
    app.innerHTML = `<div class="panel empty">
      ${aid ? `Игрок <b>${esc(aid)}</b> ещё не добавлен.<br><br>Запусти: <code>python update.py --add ${esc(aid)}</code>` : "Не найдено."}
      <div id="live" style="margin-top:16px"></div></div>`;
    if (aid) livePreview(aid, document.getElementById("live"));
  }
  async function livePreview(aid, el) {
    try {
      const r = await fetch(`https://api.opendota.com/api/players/${encodeURIComponent(aid)}`).then((r) => r.json());
      if (r.profile) el.innerHTML = `<div style="display:inline-flex;gap:10px;align-items:center"><img src="${esc(r.profile.avatarmedium)}" style="border-radius:6px"> <b>${esc(r.profile.personaname)}</b></div>`;
    } catch { /* offline */ }
  }

  // ------------------------------------------------------------ search
  const q = document.getElementById("q"), sug = document.getElementById("suggest");
  let sel = 0;
  function toAccountId(s) {
    const m = String(s).match(/(\d{6,})/);
    if (!m) return null;
    const n = BigInt(m[1]);
    return String(n > 76561197960265728n ? n - 76561197960265728n : n);
  }
  q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { sug.hidden = true; return; }
    const res = [];
    const id = toAccountId(s);
    D.players.forEach((p) => {
      if (p.name.toLowerCase().includes(s) || (p.label || "").toLowerCase().includes(s) || String(p.account_id) === id)
        res.push(`<a href="#/p/${p.account_id}"><img src="${p.avatar || ""}" alt="">${esc(p.name)}<small>${esc(p.label || "игрок")}</small></a>`);
    });
    Object.values(D.heroes).filter((h) => h.name.toLowerCase().includes(s)).slice(0, 6).forEach((h) => {
      res.push(`<a href="${heroLink(h.id)}"><img class="hero-ic" src="${h.img}" alt="">${esc(h.name)}<small>${allMains.has(String(h.id)) ? "★ мейн" : favs.has(String(h.id)) ? "♥ избранное" : "герой"}</small></a>`);
    });
    if (id && !D.players.some((p) => String(p.account_id) === id))
      res.push(`<a href="#/p/${id}"><span style="width:32px;text-align:center">＋</span>Игрок ${id}<small>не добавлен</small></a>`);
    sel = 0;
    sug.innerHTML = res.join("") || `<div class="hint">Ничего. Можно вставить ID / Steam64 / ссылку профиля.</div>`;
    sug.querySelector("a")?.classList.add("sel");
    sug.hidden = false;
  };
  q.onkeydown = (e) => {
    const links = [...sug.querySelectorAll("a")];
    if (!links.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links.forEach((a, i) => a.classList.toggle("sel", i === sel));
    } else if (e.key === "Enter" && links[sel]) { location.hash = links[sel].getAttribute("href"); close(); }
    else if (e.key === "Escape") close();
  };
  sug.onclick = () => close();
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) sug.hidden = true;
    if (!e.target.closest(".dsearch")) app.querySelectorAll(".dsearch .suggest").forEach((x) => (x.hidden = true));
  });
  function close() { sug.hidden = true; q.value = ""; q.blur(); }
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  });

  // ------------------------------------------------------------ router
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    sug.hidden = true;
    if (parts[0] !== "c") document.body.classList.remove("card-mode");
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on",
      (a.dataset.nav === "heroes" && parts[0] === "heroes") || (a.dataset.nav === "draft" && parts[0] === "draft")
      || (a.dataset.nav === "home" && ["", "p"].includes(parts[0]))));
    if (parts[0] === "p") viewPlayer(parts[1]);
    else if (parts[0] === "heroes") viewHeroes();
    else if (parts[0] === "h") viewHero(parts[1], parts[2], parts[3]);
    else if (parts[0] === "c") viewCard(parts[1], parts[2]);
    else if (parts[0] === "draft") viewDraft();
    else if (parts[0] === "m") viewMatch(parts[1], parts[2]);
    else viewHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();
})();
