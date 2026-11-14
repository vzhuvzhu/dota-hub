"""
Обновляет данные локального сайта Dota Hub:
  - профили, мейн-герои, матчи игроков из config.json (OpenDota)
  - актуальные билды и матчапы по этим героям (dota2protracker.com)
  - патчноуты героев (OpenDota constants)
  - картинки героев / скиллов / предметов (Steam CDN), кэшируются в img/

Запуск:           python update.py
Добавить игрока:  python update.py --add 76561199802208567   (Steam64, ID друга или ссылка на профиль)
Доп. герой:       python update.py --hero 1 --hero Juggernaut
Все герои:        python update.py --all-heroes
Только кэш:       python update.py --offline
Только Python 3.9+, без внешних библиотек.
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "config.json"
DATA_DIR = ROOT / "data"
IMG_DIR = ROOT / "img"
CACHE_DIR = DATA_DIR / "cache"
MATCH_DIR = CACHE_DIR / "matches"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
OPENDOTA = "https://api.opendota.com/api"
D2PT_SITE = "https://dota2protracker.com"
D2PT = D2PT_SITE + "/api"
CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react"
STEAM64_BASE = 76561197960265728
OD_PAUSE = 1.1          # OpenDota без ключа: ~60 запросов в минуту
D2PT_PAUSE = 2.5        # dota2protracker за Cloudflare: не чаще раза в 2.5 с
WEEK = 24 * 7

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------- http
def get(url, as_json=True, tries=2, pause=0.0):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            if pause:
                time.sleep(pause)
            return json.loads(body.decode("utf-8")) if as_json else body
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                break
            if e.code in (403, 429):  # Cloudflare / rate-limit: подождать подольше
                wait = 20 * (i + 1)
                print(f"  … сайт притормозил ({e.code}), жду {wait} с")
                time.sleep(wait)
                continue
            time.sleep(2 + i * 3)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + i * 3)
    raise RuntimeError(f"GET {url} failed: {last}")


def post(url):
    try:
        req = urllib.request.Request(url, method="POST", data=b"", headers={"User-Agent": UA})
        urllib.request.urlopen(req, timeout=20).read()
        time.sleep(OD_PAUSE)
        return True
    except Exception:  # noqa: BLE001
        return False


def cached(name, url, max_age_h=24, pause=0.0, offline=False):
    """JSON с диска, если свежий; иначе скачать. При ошибке — старый кэш."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / name
    if p.exists() and (offline or time.time() - p.stat().st_mtime < max_age_h * 3600):
        return json.loads(p.read_text(encoding="utf-8"))
    if offline:
        raise RuntimeError("нет в кэше")
    try:
        data = get(url, pause=pause)
    except RuntimeError:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
        raise
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def download_img(url, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        dest.write_bytes(get(url, as_json=False, tries=2))
        return True
    except RuntimeError:
        return False


class D2PTClient:
    """Запросы к dota2protracker с защитой от блокировки Cloudflare."""

    def __init__(self, offline, max_age):
        self.blocked = offline
        self.fails = 0
        self.max_age = max_age

    def fetch(self, fname, url, max_age=None):
        try:
            data = cached(fname, url, self.max_age if max_age is None else max_age,
                          pause=D2PT_PAUSE, offline=self.blocked)
            self.fails = 0
            return data
        except RuntimeError as e:
            if not self.blocked:
                print("  ! ", e)
                self.fails += 1
                if self.fails >= 3:
                    self.blocked = True
                    print("  ! dota2protracker ограничил запросы — дальше беру только кэш, "
                          "остальное докачается при следующем запуске")
            return None


# ---------------------------------------------------------------- helpers
def to_account_id(raw: str) -> int:
    m = re.search(r"(\d{6,})", str(raw))
    if not m:
        raise ValueError(f"Не понял ID: {raw}")
    n = int(m.group(1))
    return n - STEAM64_BASE if n > STEAM64_BASE else n


def load_config():
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def save_config(cfg):
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def is_win(m):
    return (m["player_slot"] < 128) == m["radiant_win"]


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", action="append", default=[], help="Steam64 / account id / ссылка профиля")
    ap.add_argument("--hero", action="append", default=[], help="доп. герой (id или имя) для всех игроков")
    ap.add_argument("--all-heroes", action="store_true", help="скачать билды для ВСЕХ героев (долго)")
    ap.add_argument("--fresh", action="store_true", help="игнорировать кэш")
    ap.add_argument("--offline", action="store_true", help="билды/матчапы только из кэша, без запросов к D2PT")
    ap.add_argument("--matches", type=int, default=None, help="сколько последних матчей разбирать (по умолч. из config)")
    args = ap.parse_args()

    cfg = load_config()
    for raw in args.add:
        aid = to_account_id(raw)
        if not any(p["account_id"] == aid for p in cfg["players"]):
            cfg["players"].append({"account_id": aid, "label": ""})
            print(f"+ игрок {aid} добавлен в config.json")
    save_config(cfg)

    max_age = 0 if args.fresh else 24
    const_age = 0 if args.fresh else WEEK
    print("• Справочники (OpenDota constants)…")
    od_heroes = cached("od_heroes.json", f"{OPENDOTA}/constants/heroes", const_age)
    od_items = cached("od_items.json", f"{OPENDOTA}/constants/items", const_age)
    od_item_ids = cached("od_item_ids.json", f"{OPENDOTA}/constants/item_ids", const_age)
    od_abil_ids = cached("od_ability_ids.json", f"{OPENDOTA}/constants/ability_ids", const_age)
    od_abils = cached("od_abilities.json", f"{OPENDOTA}/constants/abilities", const_age)
    od_patchnotes = cached("od_patchnotes.json", f"{OPENDOTA}/constants/patchnotes", const_age)
    item_key_to_id = {k: v["id"] for k, v in od_items.items() if isinstance(v, dict) and "id" in v}

    d2 = D2PTClient(args.offline, max_age)
    print("• Список героев и меты (dota2protracker)…")
    d2_list = d2.fetch("d2pt_heroes.json", f"{D2PT}/heroes/list") or []
    meta, d2_names = {}, {}
    for h in d2_list:
        pos = {}
        for i in range(1, 6):
            k = f"pos {i}"
            pos[k] = {"matches": h.get(f"{k} matches", 0), "wr": h.get(f"{k} winrate", 0),
                      "rating": float(h.get(f"{k} d2pt rating") or 0)}
        meta[h["hero_id"]] = {"matches": h.get("all matches", 0), "wr": h.get("all winrate", 0),
                              "rating": float(h.get("all d2pt rating") or 0), "pos": pos}
        d2_names[h["hero_id"]] = h.get("displayName")

    heroes = {}
    for hid, h in od_heroes.items():
        npc = h["name"].replace("npc_dota_hero_", "")
        heroes[int(hid)] = {
            "id": int(hid), "npc": npc, "name": h["localized_name"],
            "attr": h.get("primary_attr"), "roles": h.get("roles", []),
            "attack": h.get("attack_type"),
            "img": f"img/heroes/{npc}.png", "meta": meta.get(int(hid)),
        }
    name_to_id = {h["name"].lower(): i for i, h in heroes.items()} | {h["npc"]: i for i, h in heroes.items()}

    used_items, used_abils = set(), set()
    n_matches = args.matches or cfg.get("analyze_matches", 20)
    parse_budget = [cfg.get("parse_requests_per_run", 10)]
    tracked_ids = {p["account_id"] for p in cfg["players"]}

    # ---- игроки
    players = []
    wanted = {}
    for p in cfg["players"]:
        aid = p["account_id"]
        print(f"• Игрок {aid}…")
        prof = get(f"{OPENDOTA}/players/{aid}", pause=OD_PAUSE)
        wl = get(f"{OPENDOTA}/players/{aid}/wl", pause=OD_PAUSE)
        days = cfg.get("history_days", 180)
        hstats = get(f"{OPENDOTA}/players/{aid}/heroes?date={days}", pause=OD_PAUSE)
        if not any(h["games"] for h in hstats):
            hstats = get(f"{OPENDOTA}/players/{aid}/heroes", pause=OD_PAUSE)
        hstats = [h for h in hstats if h["games"] > 0]
        recent = []
        try:
            recent = get(f"{OPENDOTA}/players/{aid}/recentMatches", pause=OD_PAUSE)
        except RuntimeError:
            pass
        history = fetch_history(aid)
        source = "history"
        if not hstats:
            post(f"{OPENDOTA}/players/{aid}/refresh")  # просим OpenDota собрать историю
            base = history or recent
            agg = {}
            for m in base:
                a = agg.setdefault(m["hero_id"], {"hero_id": m["hero_id"], "games": 0, "win": 0, "last_played": 0})
                a["games"] += 1
                a["win"] += int(is_win(m))
                a["last_played"] = max(a["last_played"], m["start_time"])
            hstats = list(agg.values())
            source = ("history_partial" if history else "recent") if hstats else "none"
        # пока OpenDota не доиндексировал профиль, дополняем героями из списка последних матчей
        merged = {int(h["hero_id"]): h for h in hstats}
        extra_agg = {}
        for m in {x["match_id"]: x for x in history + recent}.values():
            a = extra_agg.setdefault(m["hero_id"], {"hero_id": m["hero_id"], "games": 0, "win": 0, "last_played": 0})
            a["games"] += 1
            a["win"] += int(is_win(m))
            a["last_played"] = max(a["last_played"], m["start_time"])
        for hid_, a in extra_agg.items():
            if hid_ not in merged or merged[hid_]["games"] < a["games"]:
                merged[hid_] = a
        hstats = list(merged.values())
        hstats.sort(key=lambda h: (h["games"], h["last_played"]), reverse=True)
        main_ids = [int(h["hero_id"]) for h in hstats[: cfg.get("main_heroes_count", 8)]]
        for x in cfg.get("extra_heroes", {}).get(str(aid), []) + args.hero:
            hid = int(x) if str(x).isdigit() else name_to_id.get(str(x).lower())
            if hid and hid not in main_ids:
                main_ids.append(hid)
        stat_by_id = {int(h["hero_id"]): h for h in hstats}

        # подробный разбор последних матчей
        base_list = sorted({m["match_id"]: m for m in (recent + history)}.values(),
                           key=lambda m: -m["start_time"])[:n_matches]
        details = []
        for i, m in enumerate(base_list, 1):
            print(f"  матч {i}/{len(base_list)} {m['match_id']}", end="\r")
            md = fetch_match(m["match_id"], parse_budget)
            if md:
                c = compact_match(md, aid, tracked_ids, item_key_to_id, od_items,
                                  slot=m.get("player_slot"), hero_id=m.get("hero_id"))
                if c:
                    details.append(c)
                    used_items.update(c["items"])
                    used_items.update(x[1] for x in c.get("purchases", []))
                    used_abils.update(c.get("skills", []))
        print()

        # игры с другими отслеживаемыми игроками
        duo = {}
        for other in tracked_ids - {aid}:
            rows = []
            try:
                rows = get(f"{OPENDOTA}/players/{aid}/matches?included_account_id={other}&limit=200"
                           "&project=hero_id&project=start_time&project=duration&project=game_mode",
                           pause=OD_PAUSE)
            except RuntimeError:
                pass
            seen = {r["match_id"]: {"match_id": r["match_id"], "start": r["start_time"], "win": is_win(r),
                                    "hero": r["hero_id"], "mode": r.get("game_mode")} for r in rows}
            for c in details:  # если в деталях матча нашёлся второй игрок
                if str(other) in c.get("tracked", {}):
                    seen.setdefault(c["match_id"], {"match_id": c["match_id"], "start": c["start"], "win": c["win"],
                                                    "hero": c["hero_id"], "mode": c["mode"]})
                    seen[c["match_id"]]["other_hero"] = c["tracked"][str(other)]
            duo[str(other)] = sorted(seen.values(), key=lambda r: -r["start"])

        pr = prof.get("profile") or {}
        hist_src = list({m["match_id"]: m for m in history + recent}.values())
        players.append({
            "account_id": aid,
            "label": p.get("label", ""),
            "name": pr.get("personaname") or str(aid),
            "avatar": pr.get("avatarfull"),
            "profile_url": pr.get("profileurl"),
            "rank_tier": prof.get("rank_tier"),
            "leaderboard_rank": prof.get("leaderboard_rank"),
            "win": wl.get("win", 0), "lose": wl.get("lose", 0),
            "history_hidden": bool(pr.get("fh_unavailable")),
            "source": source,
            "mains": [{
                "hero_id": hid,
                "games": stat_by_id.get(hid, {}).get("games", 0),
                "win": stat_by_id.get(hid, {}).get("win", 0),
                "last_played": stat_by_id.get(hid, {}).get("last_played", 0),
            } for hid in main_ids],
            # короткая история для трендов (до 100 игр)
            "history": [{
                "match_id": m["match_id"], "hero_id": m["hero_id"], "win": is_win(m),
                "k": m.get("kills"), "d": m.get("deaths"), "a": m.get("assists"),
                "gpm": m.get("gold_per_min"), "xpm": m.get("xp_per_min"),
                "duration": m.get("duration"), "start": m["start_time"],
                "lane_role": m.get("lane_role"), "mode": m.get("game_mode"),
                "party": m.get("party_size"),
            } for m in sorted(hist_src, key=lambda m: -m["start_time"])[:100]],
            "matches": details,
            "duo": duo,
        })
        for hid in main_ids:
            wanted.setdefault(hid, True)
        for c in details:
            wanted.setdefault(c["hero_id"], False)  # для сравнения билда в разборе матча

    if args.all_heroes:
        for hid in heroes:
            wanted.setdefault(hid, False)
    # герои, чьи билды уже лежат в кэше, попадают на сайт бесплатно (без запросов)
    for f in CACHE_DIR.glob("build_*_pos*.json"):
        wanted.setdefault(int(f.name.split("_")[1]), False)
    for x in args.hero:
        hid = int(x) if str(x).isdigit() else name_to_id.get(str(x).lower())
        if hid:
            wanted[hid] = True

    # ---- билды + матчапы
    builds, matchups = {}, {}
    for n, hid in enumerate(sorted(wanted), 1):
        m = meta.get(hid)
        if not m:
            continue
        tot = sum(v["matches"] for v in m["pos"].values()) or 1
        positions = [k for k, v in m["pos"].items() if v["matches"] / tot >= cfg.get("min_position_share", 0.15)]
        if not positions:
            positions = [max(m["pos"], key=lambda k: m["pos"][k]["matches"])]
        positions.sort(key=lambda k: -m["pos"][k]["matches"])
        builds[hid], matchups[hid] = {}, {}
        for pos in positions:
            q = urllib.parse.quote(pos)
            bfile = f"build_{hid}_{pos.replace(' ', '')}.json"
            important = wanted[hid] or args.all_heroes
            if not important and not (CACHE_DIR / bfile).exists():
                continue
            print(f"• {heroes[hid]['name']} [{pos}] ({n}/{len(wanted)})")
            # не-мейны из кэша обновляем раз в неделю, чтобы не упираться в лимит D2PT
            raw = d2.fetch(bfile, f"{D2PT}/hero/{hid}/builds?position={q}",
                           max_age=None if important else (0 if args.fresh else WEEK))
            if raw:
                b = parse_build(raw[0], used_items, used_abils)
                if b:
                    builds[hid][pos] = b
            # матчапы: для мейнов всегда, для остальных — если уже есть в кэше или --all-heroes
            nm = urllib.parse.quote(d2_names.get(hid) or heroes[hid]["name"])
            mu_url = f"{D2PT_SITE}/hero/{nm}/api/matchup-payload?heroId={hid}&position={urllib.parse.quote_plus(pos)}"
            fname = f"mu_{hid}_{pos.replace(' ', '')}.json"
            if wanted[hid] or args.all_heroes or (CACHE_DIR / fname).exists():
                mu = d2.fetch(fname, mu_url, max_age=72 if not args.fresh else 0)
                if mu:
                    matchups[hid][pos] = parse_matchups(mu)

    # ---- патчноуты
    patches = hero_patchnotes(od_patchnotes, heroes, set(wanted) | {h for h in heroes if builds.get(h)}, od_abils)

    # ---- справочник предметов/скиллов + картинки
    print("• Картинки…")
    for k in COUNTER_ITEM_KEYS:
        if k in item_key_to_id:
            used_items.add(item_key_to_id[k])
    items = {}
    for iid in used_items:
        key = od_item_ids.get(str(iid))
        it = od_items.get(key, {}) if key else {}
        items[iid] = {
            "id": iid, "key": key, "name": it.get("dname") or key or f"#{iid}",
            "cost": it.get("cost"), "tier": it.get("tier"),
            "img": f"img/items/{key}.png" if key else None,
        }
        if key:
            src = ("https://cdn.cloudflare.steamstatic.com" + it["img"].split("?")[0]) if it.get("img") else f"{CDN}/items/{key}.png"
            if not download_img(src, IMG_DIR / "items" / f"{key}.png"):
                download_img(f"{D2PT_SITE}/static/items/{key}.png", IMG_DIR / "items" / f"{key}.png")
    abilities = {}
    for ab_id in used_abils:
        key = od_abil_ids.get(str(ab_id))
        ab = od_abils.get(key, {}) if key else {}
        abilities[ab_id] = {
            "id": ab_id, "key": key, "name": ab.get("dname") or key or f"#{ab_id}",
            "desc": (ab.get("desc") or "")[:300],
            "talent": bool(key and key.startswith("special_bonus")),
            "img": f"img/abilities/{key}.png" if key and not key.startswith("special_bonus") else None,
        }
        if key and not key.startswith("special_bonus"):
            download_img(f"{CDN}/abilities/{key}.png", IMG_DIR / "abilities" / f"{key}.png")
    for hid, h in heroes.items():
        download_img(f"{CDN}/heroes/{h['npc']}.png", IMG_DIR / "heroes" / f"{h['npc']}.png")

    patch = None
    for hb in builds.values():
        for b in hb.values():
            patch = patch or b.get("patch")
    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "patch": patch,
        "players": players,
        "heroes": heroes,
        "builds": builds,
        "matchups": matchups,
        "patches": patches,
        "items": items,
        "item_keys": {k: v for k, v in item_key_to_id.items() if v in items},
        "abilities": abilities,
    }
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "data.js").write_text(
        "window.DOTA_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    nb = sum(1 for v in builds.values() if v)
    print(f"✓ Готово: {len(players)} игрок(а), билды для {nb} героев. "
          f"{'(D2PT ограничил запросы — запусти позже ещё раз) ' if d2.blocked and not args.offline else ''}"
          "Открой index.html")


# ---------------------------------------------------------------- matches
def fetch_history(aid):
    fields = ["hero_id", "start_time", "duration", "kills", "deaths", "assists", "gold_per_min",
              "xp_per_min", "lane_role", "game_mode", "party_size", "player_slot", "radiant_win"]
    q = "&".join(f"project={f}" for f in fields)
    try:
        return get(f"{OPENDOTA}/players/{aid}/matches?limit=100&{q}", pause=OD_PAUSE)
    except RuntimeError:
        return []


def fetch_match(mid, parse_budget):
    """Детали матча. Разобранные матчи кэшируются навсегда, неразобранные — на 6 часов."""
    MATCH_DIR.mkdir(parents=True, exist_ok=True)
    p = MATCH_DIR / f"{mid}.json"
    if p.exists():
        d = json.loads(p.read_text(encoding="utf-8"))
        parsed = (d.get("od_data") or {}).get("has_parsed")
        if parsed or time.time() - p.stat().st_mtime < 6 * 3600 or d.get("_parse_requested", 0) > 3:
            return d
    try:
        d = get(f"{OPENDOTA}/matches/{mid}", pause=OD_PAUSE)
    except RuntimeError:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    if not (d.get("od_data") or {}).get("has_parsed") and parse_budget[0] > 0:
        # просим OpenDota разобрать реплей: при следующем запуске появятся тайминги и графики
        if post(f"{OPENDOTA}/request/{mid}"):
            parse_budget[0] -= 1
        prev = json.loads(p.read_text(encoding="utf-8")).get("_parse_requested", 0) if p.exists() else 0
        d["_parse_requested"] = prev + 1
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return d


def compact_match(md, aid, tracked_ids, item_key_to_id, od_items, slot=None, hero_id=None):
    me = next((x for x in md.get("players", []) if x.get("account_id") == aid), None)
    if not me and slot is not None:  # аккаунт скрыт в матче: ищем по слоту и герою из списка матчей
        me = next((x for x in md.get("players", [])
                   if x.get("player_slot") == slot and (hero_id is None or x.get("hero_id") == hero_id)), None)
    if not me:
        return None
    rad = me["player_slot"] < 128
    win = rad == md["radiant_win"]
    parsed = bool((md.get("od_data") or {}).get("has_parsed"))
    allies = [x["hero_id"] for x in md["players"] if (x["player_slot"] < 128) == rad and x is not me]
    enemies = [x["hero_id"] for x in md["players"] if (x["player_slot"] < 128) != rad]
    tracked = {str(x["account_id"]): x["hero_id"] for x in md["players"]
               if x.get("account_id") in tracked_ids and x.get("account_id") != aid}
    items = [me.get(f"item_{i}") for i in range(6)]
    purchases = []
    for pl in me.get("purchase_log") or []:
        iid = item_key_to_id.get(pl.get("key"))
        it = od_items.get(pl.get("key"), {})
        if iid and (it.get("cost") or 0) >= 500 and pl.get("time", 0) > 0:
            purchases.append([pl["time"], iid])
    bench = {k: round(v.get("pct", 0), 3) for k, v in (me.get("benchmarks") or {}).items()}
    lh_t = me.get("lh_t") or []
    dn_t = me.get("dn_t") or []
    gold_adv = md.get("radiant_gold_adv") or []
    xp_adv = md.get("radiant_xp_adv") or []
    sign = 1 if rad else -1
    kills_log = [[k["time"], k["key"].replace("npc_dota_hero_", "")] for k in (me.get("kills_log") or [])]
    killed_by = {k.replace("npc_dota_hero_", ""): v for k, v in (me.get("killed_by") or {}).items()
                 if k.startswith("npc_dota_hero_")}
    return {
        "match_id": md["match_id"], "start": md["start_time"], "duration": md["duration"],
        "mode": md.get("game_mode"), "lobby": md.get("lobby_type"), "parsed": parsed,
        "hero_id": me["hero_id"], "win": win, "radiant": rad,
        "k": me["kills"], "d": me["deaths"], "a": me["assists"],
        "gpm": me.get("gold_per_min"), "xpm": me.get("xp_per_min"),
        "lh": me.get("last_hits"), "dn": me.get("denies"), "nw": me.get("net_worth"),
        "hd": me.get("hero_damage"), "td": me.get("tower_damage"), "hh": me.get("hero_healing"),
        "level": me.get("level"), "lane_role": me.get("lane_role"), "party": me.get("party_size"),
        "items": [i for i in items if i], "neutral": me.get("item_neutral"),
        "skills": me.get("ability_upgrades_arr") or [],
        "purchases": purchases,
        "bench": bench,
        "lh10": lh_t[10] if len(lh_t) > 10 else None,
        "dn10": dn_t[10] if len(dn_t) > 10 else None,
        "gold_adv": [sign * g for g in gold_adv],
        "xp_adv": [sign * g for g in xp_adv],
        "kills_log": kills_log, "killed_by": killed_by,
        "obs": me.get("obs_placed"), "sen": me.get("sen_placed"),
        "stuns": round(me["stuns"], 1) if me.get("stuns") else None,
        "tf": me.get("teamfight_participation"), "apm": me.get("actions_per_min"),
        "allies": allies, "enemies": enemies, "tracked": tracked,
        "score": [md.get("radiant_score"), md.get("dire_score")] if rad else [md.get("dire_score"), md.get("radiant_score")],
    }


# ---------------------------------------------------------------- d2pt parsing
def parse_matchups(mu):
    def agg(rows, lane=False):
        acc = {}
        for r in rows or []:
            a = acc.setdefault(r["other_hero_id"], [0, 0, 0.0])
            a[0] += r.get("matches", 0)
            a[1] += r.get("wins", 0)
            if lane:
                a[2] += (r.get("lane_adv") or 0) * r.get("matches", 0)
        out = []
        for hid, (m, w, la) in acc.items():
            if m < 15:
                continue
            out.append([hid, m, round(w / m, 4)] + ([round(la / m, 2)] if lane else []))
        out.sort(key=lambda x: -x[1])
        return out
    return {
        "vs": agg(mu.get("matchups")),
        "with": agg(mu.get("synergies")),
        "lane_vs": agg(mu.get("matchupsLanes"), lane=True),
    }


def parse_build(row, used_items, used_abils):
    bd = row.get("build_data") or {}
    if not bd:
        return None

    def take_items(ids):
        for i in ids:
            used_items.add(int(i))
        return [int(i) for i in ids]

    skill_orders = []
    for seq, st in (bd.get("abilities_new") or [])[:3]:
        for a in seq:
            used_abils.add(int(a))
        skill_orders.append({"seq": seq, "pr": st.get("pr"), "wr": st.get("win_rate"), "n": st.get("count")})

    talents = []
    for t in bd.get("talents") or []:
        talents.append({
            "lvl": t["lvl"],
            "left": t["left"]["displayName"], "right": t["right"]["displayName"],
            "left_pr": t.get("left_pr"), "right_pr": t.get("right_pr"),
            "left_wr": t.get("left_win_rate"), "right_wr": t.get("right_win_rate"),
        })

    starting = []
    for ids, st in (bd.get("starting_items_new") or [])[:3]:
        starting.append({"items": take_items(ids), "wr": st.get("win_rate"), "n": st.get("count"),
                         "lane": st.get("lane_advantage")})

    def timed(lst):
        res = []
        for it in lst or []:
            res.append({"id": int(it["raw_item_id"]), "min": it.get("avg_minute"), "pr": it.get("pr"),
                        "wr": it.get("win_rate")})
            used_items.add(int(it["raw_item_id"]))
        return res

    core = timed(bd.get("anchor_items"))
    mid_late = timed(bd.get("items_mid_late"))
    mid_late.sort(key=lambda x: x["min"] or 99)

    def tiers(stats, top):
        out = []
        for tier in sorted(stats or {}, key=int):
            rows = [{"id": int(k), "pr": v.get("pick_rate"), "wr": v.get("win_rate"), "n": v.get("count")}
                    for k, v in stats[tier].items() if v.get("count", 0) >= 10]
            rows.sort(key=lambda r: -(r["pr"] or 0))
            rows = rows[:top]
            for r in rows:
                used_items.add(r["id"])
            out.append({"tier": int(tier) + 1, "items": rows})
        return out

    late = {k: take_items(v) for k, v in (bd.get("anchor_lategame_inventories") or {}).items()}
    scope = bd.get("data_scope") or row.get("data_scope") or {}
    return {
        "matches": row.get("num_matches"), "wins": row.get("num_wins"),
        "wr": bd.get("win_rate"), "pr": row.get("pick_rate"),
        "patch": (scope.get("patch_versions") or [None])[-1],
        "updated_at": row.get("updated_at"),
        "skill_orders": skill_orders,
        "talents": talents,
        "starting": starting,
        "core": core,
        "situational": mid_late,
        "late": late,
        "neutrals": tiers(bd.get("neutral_stats"), 4),
        "enchants": tiers(bd.get("enhancement_stats"), 3),
    }


def hero_patchnotes(pn, heroes, hero_ids, od_abils, last_n=3):
    """Последние изменения героя: до 3 патчей, где он менялся."""
    keys = list(pn.keys())
    out = {}
    for hid in hero_ids:
        h = heroes.get(hid)
        if not h:
            continue
        res = []
        for ver in reversed(keys):
            notes = (pn[ver].get("heroes") or {}).get(h["npc"])
            if not notes:
                continue
            blocks = []
            if isinstance(notes, list):
                blocks.append(["", notes])
            else:
                for k, lines in notes.items():
                    if k == "general":
                        title = "Общее"
                    elif k.startswith("special_bonus") or k in ("talent", "talents"):
                        title = "Таланты"
                    else:
                        title = (od_abils.get(k) or {}).get("dname") or k
                    blocks.append([title, lines if isinstance(lines, list) else [str(lines)]])
            res.append({"patch": ver.replace("_", "."), "blocks": blocks})
            if len(res) >= last_n:
                break
        if res:
            out[hid] = res
    return out


# предметы для подсказок драфта (ключи OpenDota), картинки качаются заранее
COUNTER_ITEM_KEYS = [
    "black_king_bar", "monkey_king_bar", "spirit_vessel", "shivas_guard", "skadi", "dust", "ward_sentry",
    "gem", "mjollnir", "bfury", "radiance", "maelstrom", "pipe", "glimmer_cape", "lotus_orb", "manta",
    "cyclone", "orchid", "bloodthorn", "abyssal_blade", "sheepstick", "nullifier", "silver_edge",
    "ghost", "heavens_halberd", "assault", "blade_mail", "force_staff", "sphere", "blink", "gungir",
    "diffusal_blade", "crimson_guard", "eternal_shroud", "solar_crest", "wind_waker", "satanic",
    "aeon_disk", "harpoon", "rod_of_atos", "boots_of_bearing",
]


if __name__ == "__main__":
    main()
