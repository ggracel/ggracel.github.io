// foqs.si/memecoins: posnetke zbira strežnik (Supabase cron vsakih 30 s -> tabela memecoin_snapshots), tudi ko je stran zaprta.
// Brskalnik ob odprtju naloži zadnjo uro posnetkov, potem bere samo nove. Pravila v1.0 tečejo v brskalniku.
const HISTORY_MIN = 60;
let lastSnapshotT = 0,
  primed = false,
  noData = false;
import { pattern, result, overview, netReturnPercent, tradeSize, parseStake, entryPoint, PROFILES, DEFAULT_PROFILE, exitPlan, stepExit, markToMarket } from "./engine.mjs?v=6";
const $ = (s) => document.querySelector(s),
  money = (x) =>
    Number.isFinite(x)
      ? new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", maximumSignificantDigits: 6 }).format(x)
      : "-",
  time = (x) => new Date(x).toLocaleString("sl-SI");
// Market cap kot na Axiomu: 41,6K $, 1,2M $. Cena na kovanec ostane v drobnem tisku.
const compact = (x) => {
  if (!Number.isFinite(x)) return "-";
  const f = (v, d) => v.toLocaleString("sl-SI", { maximumFractionDigits: d });
  return (x >= 1e9 ? f(x / 1e9, 2) + "B" : x >= 1e6 ? f(x / 1e6, 2) + "M" : x >= 1e3 ? f(x / 1e3, 1) + "K" : f(x, 0)) + " $";
};
// MC pri poljubni ceni istega kovanca (supply je konstanten): mcap/price * cena
const mcAt = (c, price) => (c && Number.isFinite(c.mcap) && c.price > 0 && Number.isFinite(price) ? (c.mcap / c.price) * price : null);
const mcText = (c, price) => (mcAt(c, price) !== null ? "MC " + compact(mcAt(c, price)) : money(price));
const age = (ts) => {
  if (!ts) return "starost neznana";
  const m = Math.floor((Date.now() - ts) / 60000);
  return "star " + (m < 60 ? m + " min" : m < 1440 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : Math.floor(m / 1440) + " d");
};
let mode = "live",
  view = "market",
  selected = null,
  coins = new Map(),
  healthy = false,
  last = 0,
  busy = false,
  alerts = [],
  announced = new Map(),
  step = 0;
let trades = [];
try {
  trades = JSON.parse(localStorage.getItem("solana-demo-v1") || "[]");
  if (!Array.isArray(trades)) trades = [];
} catch {}
function save() {
  try {
    localStorage.setItem("solana-demo-v1", JSON.stringify(trades));
  } catch {
    $("#feedback").textContent = "Shranjevanje ni uspelo. Izvozi dnevnik pred zapiranjem.";
  }
  scheduleRemote();
}
let stake = 0.1,
  boardSelected = null,
  profile = DEFAULT_PROFILE;
try {
  stake = parseStake(localStorage.getItem("solana-stake-v1")) || 0.1;
  const p = localStorage.getItem("solana-profile-v1");
  if (PROFILES[p]) profile = p;
} catch {}

// Dnevnik in nastavitve so na profilu (Supabase tabela memecoin_state, vsak uporabnik samo svojo vrstico).
// Brskalnik je samo predpomnilnik: ob prijavi naložimo profil, vsaka sprememba gre nazaj gor.
const db = window.memecoinsClient || null;
let remoteUser = null,
  remoteAuto = null,
  syncTimer = null;
function syncNote(text, bad) {
  const el = $("#syncState");
  if (!el) return;
  el.textContent = text;
  el.className = bad ? "negative" : "muted";
}
async function loadRemote() {
  if (!db) return;
  try {
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return;
    remoteUser = user;
    const { data, error } = await db.from("memecoin_state").select("trades,stake,auto_entries,profile,updated_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const remote = Array.isArray(data?.trades) ? data.trades : [];
    const remoteKeys = new Set(remote.map((t) => t.key));
    const added = trades.filter((t) => t.key && !remoteKeys.has(t.key)).length;
    trades = mergeTrades(trades, remote);
    if (data) {
      const st = Number(data.stake);
      if (Number.isFinite(st) && st > 0) stake = st;
      if (PROFILES[data.profile]) profile = data.profile;
      remoteAuto = !!data.auto_entries;
    }
    if (!data || added) await pushRemote(true);
    else syncNote("Dnevnik s profila · " + time(new Date(data.updated_at).getTime()) + (added ? " · preneseno " + added + " lokalnih zapisov" : ""));
  } catch {
    syncNote("Profil trenutno ni dosegljiv, uporabljam lokalni dnevnik.", true);
  }
}
// Združitev dveh dnevnikov (ta brskalnik + profil). Isti ključ: zmaga zapis, ki je dlje (izbrisan > zaključen > prekinjen > odprt),
// pri enakem stanju tisti z novejšim opazovanjem. Obnova po izbrisu premaga starejši izbris.
// Če sta na istem paru dva odprta posla (dva brskalnika sta vstopila hkrati), ostane samo prvi.
function tradeRank(t) {
  return t.deletedAt ? 3 : t.closed ? 2 : t.interrupted ? 1 : 0;
}
function pickTrade(a, b) {
  if (a.deletedAt && (b.restoredAt || 0) > a.deletedAt) return b;
  if (b.deletedAt && (a.restoredAt || 0) > b.deletedAt) return a;
  const ra = tradeRank(a),
    rb = tradeRank(b);
  if (ra !== rb) return ra > rb ? a : b;
  return (a.lastObserved || 0) >= (b.lastObserved || 0) ? a : b;
}
function mergeTrades(local, remote) {
  const byKey = new Map();
  for (const t of [...remote, ...local]) {
    if (!t?.key) continue;
    byKey.set(t.key, byKey.has(t.key) ? pickTrade(byKey.get(t.key), t) : t);
  }
  const merged = [...byKey.values()].sort((a, b) => (a.opened || 0) - (b.opened || 0));
  const seenOpen = new Set();
  for (const t of merged) {
    if (t.deletedAt || t.closed || t.interrupted || t.practice) continue;
    if (seenOpen.has(t.id)) {
      t.deletedAt = Date.now();
      t.deleteReason = "Podvojen vstop: isti kovanec je bil odprt v dveh brskalnikih hkrati.";
    } else seenOpen.add(t.id);
  }
  return merged;
}
// Občasna ponovna združitev s profilom, da drug brskalnik (telefon, drug zavihek) vidi iste posle.
async function syncRemote() {
  if (!db || !remoteUser) return;
  try {
    const { data, error } = await db.from("memecoin_state").select("trades").eq("user_id", remoteUser.id).maybeSingle();
    if (error || !Array.isArray(data?.trades)) return;
    const before = JSON.stringify(trades);
    trades = mergeTrades(trades, data.trades);
    if (JSON.stringify(trades) !== before) {
      save();
      draw();
    }
  } catch {}
}
setInterval(syncRemote, 45000);
let lastPushed = "";
async function pushRemote(force = false) {
  if (!db || !remoteUser) return;
  // Pred pisanjem še enkrat združimo s profilom, da ne povozimo poslov iz drugega brskalnika.
  try {
    const { data } = await db.from("memecoin_state").select("trades").eq("user_id", remoteUser.id).maybeSingle();
    if (Array.isArray(data?.trades)) trades = mergeTrades(trades, data.trades);
  } catch {}
  const row = { user_id: remoteUser.id, trades, stake, auto_entries: !!$("#auto")?.checked, profile };
  const fingerprint = JSON.stringify(row);
  if (!force && fingerprint === lastPushed) return; // nič novega, ne pošiljaj vsakih 30 s
  try {
    const { error } = await db.from("memecoin_state").upsert({ ...row, updated_at: new Date().toISOString() });
    if (error) throw error;
    lastPushed = fingerprint;
    syncNote("Shranjeno v profil · " + new Date().toLocaleTimeString("sl-SI"));
  } catch {
    syncNote("Shranjevanje v profil ni uspelo (lokalno je shranjeno).", true);
  }
}
function scheduleRemote() {
  if (!db || !remoteUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushRemote, 600);
}
await loadRemote();
function current() {
  return coins.get(selected);
}
function fresh(c) {
  return c && (c.practice || (healthy && Date.now() - c.time < 75000));
}
// Filter vstopov v1.2 (samo za samodejne vstope in opozorila): iz 161 demo poslov 16. do 17. 9. 2026 so bili vstopi
// v pare, stare 30 do 90 min, ki v zadnji uri niso bili v minusu, edini z jasno pozitivnim pričakovanjem.
// Vrne razlog, zakaj kovanec NE gre skozi filter, ali null.
const FILTER = { minAge: 30, maxAge: 90, minMcap: 20000, maxMcap: 300000 };
function entryFilter(c) {
  if (!c || c.practice) return null;
  if (!c.created) return "starost para ni znana";
  const age = (Date.now() - c.created) / 60000;
  if (age < FILTER.minAge) return "par je mlajši od " + FILTER.minAge + " min (" + Math.floor(age) + " min)";
  if (age > FILTER.maxAge) return "par je starejši od " + FILTER.maxAge + " min (" + (age < 1440 ? Math.floor(age / 60) + " h " + Math.floor(age % 60) + " min" : Math.floor(age / 1440) + " d") + ")";
  if (Number.isFinite(c.change1h) && c.change1h < 0) return "v zadnji uri je v minusu (" + pct1(c.change1h) + ")";
  if (Number.isFinite(c.mcap) && (c.mcap < FILTER.minMcap || c.mcap > FILTER.maxMcap)) return "MC izven 20K do 300K $ (" + compact(c.mcap) + ")";
  return null;
}
function signal(c) {
  if (!fresh(c)) return { name: "Premor", reason: "Ni svežih podatkov. Demo vstop in samodejni izstop sta ustavljena." };
  if (c.liquidity < 10000 || !c.liquidity || !(c.volume > 0))
    return { name: "Brez signala", reason: "Potrebujemo vsaj 10.000 USD likvidnosti in pozitiven petminutni promet." };
  return pattern(c.history, c.practice ? c.history.at(-1).t : Date.now());
}
function draw() {
  let interruptedNow = false;
  for (const t of trades) {
    if (!t.practice && !t.deletedAt && !t.closed && !t.interrupted && primed && lastSnapshotT - t.lastObserved > 75000) {
      interruptTrade(t, "Strežnik za ta par ni imel podatkov več kot 75 sekund");
      interruptedNow = true;
    }
  }
  if (interruptedNow) save();
  dashboard();
  watching();
  renderOpenTrades();
  renderBoardGraph();
  $("#autoPanel").hidden = mode === "practice";
  const c = current();
  $("#source").textContent = mode === "practice" ? "IZMIŠLJENA VAJA" : "ŽIVI POSNETKI";
  $("#scope").textContent =
    mode === "practice" ? "Vaja: napreduješ ročno. Podatki so izmišljeni." : "Strežnik zbira posnetke vsakih 30 s, tudi ko je stran zaprta · ob odprtju naložim zadnjo uro";
  $("#refresh").hidden = mode === "practice";
  $("#coins").replaceChildren();
  const list = [...coins.values()].sort((a, b) => (b.created || 0) - (a.created || 0));
  if (!list.length) $("#coins").textContent = "Ni razpoložljivih podatkov. Počakaj na nov prejem ali izberi Osveži.";
  for (const v of list) {
    const b = document.createElement("button");
    b.className = "coin" + (c?.id === v.id ? " active" : "");
    const head = document.createElement("span");
    head.className = "coinHead";
    const sym = document.createElement("b");
    sym.textContent = v.symbol;
    const mc = document.createElement("span");
    mc.className = "coinMc";
    mc.textContent = Number.isFinite(v.mcap) ? "MC " + compact(v.mcap) : money(v.price);
    head.append(sym, mc);
    b.append(head);
    const s = document.createElement("small");
    const st = v.practice ? { title: "Vaja" } : cardState(v);
    s.textContent = v.practice
      ? "Odboj → demo vstop → naslednja cena"
      : `${st.title} · ${age(v.created)} · likv. ${compact(v.liquidity)}${fresh(v) ? "" : " · podatki zastareli"}`;
    b.append(s);
    b.onclick = () => {
      selected = v.id;
      draw();
    };
    $("#coins").append(b);
  }
  renderManual(c, "#open", "#liveManualState");
  if (!c) return;
  $("#name").textContent = c.symbol + (c.name && c.name !== c.symbol ? " · " + c.name : "");
  $("#address").textContent = c.practice
    ? "Korak " +
      (step + 1) +
      " · " +
      (step === 0
        ? "Preveri vzorec in odpri demo."
        : step === 1
          ? "Odpri naslednji demo za primer izgube."
          : "Vajo lahko začneš znova z gumbom Vodena vaja.")
    : "CA: " + c.token + " · " + age(c.created);
  $("#mcap").textContent = Number.isFinite(c.mcap) ? compact(c.mcap) : "-";
  $("#price").textContent = money(c.price);
  $("#liquidity").textContent = compact(c.liquidity);
  $("#volume").textContent = compact(c.volume);
  const sig = signal(c);
  $("#pattern").textContent = sig.name;
  $("#reason").textContent = sig.reason;
  $("#chartnote").textContent = c.practice
    ? "Izmišljene cene v USD. Naslednji izidi so učni primeri."
    : `${c.history.length} posnetkov na 30 s · ${c.history.length ? new Date(c.history[0].t).toLocaleTimeString("sl-SI") : ""} do ${c.history.length ? new Date(c.history.at(-1).t).toLocaleTimeString("sl-SI") : ""} · os kaže market cap · to niso borzne sveče (pravi graf: gumb zgoraj)`;
  renderEntry(c, "#entry");
  chart(c, "#chart", "#chartLegend");
  renderConditions(c, "#conditions");
  renderTools(c);
  $("#alerts").replaceChildren();
  for (const a of alerts.slice(0, 12)) {
    const p = document.createElement("p");
    p.textContent = a;
    $("#alerts").append(p);
  }
  if (!alerts.length) $("#alerts").textContent = "Še ni opozoril. Stran mora ostati odprta.";
  journal();
}
// Graf: os v market capu (kot Axiom), cena v drobnem tisku. Riše samo črte, ki jih razloži legenda.
function chart(c, target = "#chart", legendTarget = "#chartLegend", opts = {}) {
  const svg = typeof target === "string" ? $(target) : target;
  svg.replaceChildren();
  const legend = typeof legendTarget === "string" ? $(legendTarget) : legendTarget;
  if (legend) legend.replaceChildren();
  const add = (tag, attrs, text) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    svg.append(el);
    return el;
  };
  const h = c?.history || [];
  // Pri odprtem poslu pokažemo pot od 5 min pred vstopom naprej (največ 160 posnetkov), sicer zadnjih 80.
  const p = (opts.from ? h.filter((v) => v.t >= opts.from - 5 * 60000).slice(-160) : h.slice(-80)).filter((v) => Number.isFinite(v.p) && v.p > 0);
  if (p.length < 2) {
    add("text", { x: 25, y: 110, fill: "#a7b7ca" }, "Čakam na drugi cenovni posnetek (30 s) …");
    return;
  }
  const sig = signal(c),
    ep = fresh(c) && !c.practice ? entryPoint(c.history) : null,
    open = trades.find((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === c.id);
  const lines = [];
  if (sig.levels && !opts.simple) {
    lines.push({ key: "support", value: sig.levels.support, color: "#edc687", dash: "6 5", label: "Podpora (najnižja cena v oknu)" });
    lines.push({ key: "resistance", value: sig.levels.resistance, color: "#bba7f8", dash: "6 5", label: "Odpor (najvišja cena v oknu)" });
  }
  if (open) lines.push(...tradeLines(open, c));
  else if (ep?.state === "ready") {
    lines.push({ key: "buy", value: ep.price, color: "#ffffff", dash: "", width: 2.5, label: "Vstopna točka: bot vstopi, če naslednja cena preseže " + mcText(c, ep.price) });
  }
  const refs = lines.map((l) => l.value).filter((v) => Number.isFinite(v)),
    min = Math.min(...p.map((v) => v.p), ...refs),
    max = Math.max(...p.map((v) => v.p), ...refs),
    pad = (max - min || max * 0.01) * 0.12,
    lo = min - pad,
    hi = max + pad,
    y = (v) => 185 - ((v - lo) / (hi - lo)) * 160,
    axis = (v) => (mcAt(c, v) !== null ? compact(mcAt(c, v)) : money(v));
  for (let i = 0; i < 3; i++) {
    const value = lo + ((hi - lo) * i) / 2,
      yy = y(value);
    add("line", { x1: 110, x2: 680, y1: yy, y2: yy, stroke: "#334155" });
    add("text", { x: 3, y: yy + 4, fill: "#a7b7ca", "font-size": 11 }, axis(value));
  }
  add("text", { x: 110, y: 218, fill: "#a7b7ca", "font-size": 12 }, new Date(p[0].t).toLocaleTimeString("sl-SI"));
  add("text", { x: 600, y: 218, fill: "#a7b7ca", "font-size": 12 }, new Date(p.at(-1).t).toLocaleTimeString("sl-SI"));
  for (const l of lines) {
    if (!Number.isFinite(l.value)) continue;
    add("line", { x1: 110, x2: 680, y1: y(l.value), y2: y(l.value), stroke: l.color, "stroke-width": l.width || 1.5, "stroke-dasharray": l.dash });
    const tag = l.tag ?? (l.key === "buy" ? "VSTOP" : l.key === "target" ? "CILJ" : l.key === "stop" ? "MEJA" : l.key === "entry" ? "VSTOPIL" : "");
    if (tag) add("text", { x: 676, y: y(l.value) - 4, fill: l.color, "font-size": 10, "text-anchor": "end", "font-weight": 700 }, tag);
  }
  add("polyline", {
    points: p.map((v, i) => `${110 + (i / (p.length - 1)) * 570},${y(v.p)}`).join(" "),
    fill: "none",
    stroke: "#9bedcf",
    "stroke-width": 3,
  });
  const lastPt = p.at(-1);
  add("circle", { cx: 680, cy: y(lastPt.p), r: 4, fill: "#9bedcf" });
  if (legend) {
    const items = [{ color: "#9bedcf", dash: "", label: "Cena (naši posnetki na 30 s)" }, ...lines];
    for (const it of items) {
      const span = document.createElement("span");
      const sw = document.createElement("i");
      sw.style.borderTopColor = it.color;
      sw.style.borderTopStyle = it.dash ? "dashed" : "solid";
      span.append(sw, document.createTextNode(it.label));
      legend.append(span);
    }
  }
}

// Opis ravni odprtega posla: stari posli (fiksni cilj/meja) in posli s profilom (pol prodaje, sledilna meja).
function tradeLevels(t, c) {
  const p = t.plan;
  if (!p) return { kind: "fixed", targetLabel: "Cilj +10 %", stopLabel: "Meja -5 %", targetValue: t.target, stopValue: t.stop, trailing: false, summary: "cilj " + mcText(c, t.target) + " (+10 %) · meja " + mcText(c, t.stop) + " (-5 %). Zapre se ob prvi ceni čez eno od njiju." };
  const trailing = !p.halfAt || t.halfSold;
  const stopLabel = trailing ? "Sledilna meja" : "Trda meja -" + Math.round(p.hardStop * 100) + " %";
  const targetLabel = !p.halfAt ? "Vrh" : t.halfSold ? "Pol prodano" : "Pol prodaje +" + Math.round(p.halfAt * 100) + " %";
  const targetValue = !p.halfAt ? Math.max(t.peak || t.entry, t.entry) : t.halfSold ? t.halfPrice : t.target;
  const name = (PROFILES[t.profile] || {}).name || t.profile;
  const summary =
    (p.halfAt
      ? t.halfSold
        ? "polovica že prodana pri " + mcText(c, t.halfPrice) + " · ostanek proda, ko cena pade " + Math.round(p.trail * 100) + " % z vrha (zdaj meja " + mcText(c, t.stop) + ")"
        : "pol proda pri " + mcText(c, t.target) + " (+" + Math.round(p.halfAt * 100) + " %), potem sledi vrhu · trda meja " + mcText(c, t.stop) + " (-" + Math.round(p.hardStop * 100) + " %)"
      : "brez cilja: proda, ko cena pade " + Math.round(p.trail * 100) + " % z vrha (zdaj meja " + mcText(c, t.stop) + ")") + " · profil " + name + ".";
  return { kind: "profile", targetLabel, stopLabel, targetValue, stopValue: t.stop, trailing, summary };
}
function tradeLines(t, c) {
  const L = tradeLevels(t, c);
  const lines = [{ key: "entry", value: t.entry, color: "#e2e8f0", dash: "", label: "Tvoj vstop " + mcText(c, t.entry) }];
  if (L.kind === "fixed") {
    lines.push({ key: "target", value: t.target, color: "#62e4b3", dash: "2 4", label: "Cilj +10 % " + mcText(c, t.target) });
    lines.push({ key: "stop", value: t.stop, color: "#ff858e", dash: "2 4", label: "Meja izgube -5 % " + mcText(c, t.stop) });
    return lines;
  }
  if (t.plan.halfAt && !t.halfSold) lines.push({ key: "target", tag: "POL", value: t.target, color: "#62e4b3", dash: "2 4", label: "Pol prodaje +" + Math.round(t.plan.halfAt * 100) + " % " + mcText(c, t.target) });
  if (t.halfSold) lines.push({ key: "half", tag: "POL ✓", value: t.halfPrice, color: "#8beacb", dash: "1 5", label: "Pol prodano " + mcText(c, t.halfPrice) });
  lines.push({ key: "stop", tag: L.trailing ? "SLED" : "MEJA", value: t.stop, color: L.trailing ? "#ecbf69" : "#ff858e", dash: "2 4", label: (L.trailing ? "Sledilna meja " : "Trda meja ") + mcText(c, t.stop) });
  return lines;
}
// "Kaj bot čaka": ena jasna poved za laika, nad grafom.
function renderEntry(c, target) {
  const el = $(target);
  if (!el) return;
  el.className = "entryLine";
  if (!c || c.practice) {
    el.textContent = "";
    return;
  }
  const open = trades.find((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === c.id);
  if (open) {
    el.textContent = "Demo je odprt · vstop " + mcText(c, open.entry) + " · " + tradeLevels(open, c).summary;
    el.classList.add("open");
    return;
  }
  if (!fresh(c)) {
    el.textContent = "Brez sveže cene ni vstopne točke. Čakam na nov prejem podatkov.";
    return;
  }
  if (c.liquidity < 10000 || !c.liquidity || !(c.volume > 0)) {
    el.textContent = "Ta kovanec ne gre skozi filtre bota: potrebuje vsaj 10.000 $ likvidnosti in promet v zadnjih 5 minutah. Vstopa ne bo.";
    return;
  }
  const blocked = entryFilter(c);
  if (blocked) {
    el.textContent = "Izven filtra vstopov: " + blocked + ". Bot sam ne bo vstopil (filter v1.2: starost 30 do 90 min, brez minusa na 1 h, MC 20K do 300K). Ročni vstop je dovoljen.";
    return;
  }
  const ep = entryPoint(c.history);
  if (ep.state === "collecting") el.textContent = `Zbiram podatke: ${ep.have}/16 posnetkov. Vstopna točka se pokaže čez približno ${Math.ceil(((16 - ep.have) * 30) / 60)} min.`;
  else if (ep.state === "paused") el.textContent = "Premor: v podatkih je vrzel. Vstopna točka se izračuna, ko je 16 posnetkov spet neprekinjenih.";
  else if (ep.state === "signal") {
    el.textContent = `Vzorec "${ep.pattern}" je pravkar izpolnjen pri ${mcText(c, ep.price)}. ${$("#auto").checked ? "Samodejni demo vstop se sproži ob tem prejemu." : "Samodejni vstopi so izključeni; vstopiš lahko ročno."}`;
    el.classList.add("ready");
  } else if (ep.state === "ready") {
    el.textContent = `Bot vstopi, če naslednja cena (čez 30 s) preseže ${mcText(c, ep.price)} (cena ${money(ep.price)}) · vzorec: ${ep.pattern}. Zdaj: ${mcText(c, ep.last)}.`;
    el.classList.add("ready");
  } else el.textContent = `Vstopne točke še ni. Najbližje je vzorec "${ep.pattern}", manjka: ${ep.missing.join("; ")}. Zdaj: ${mcText(c, ep.last)} · podpora ${mcText(c, ep.support)} · odpor ${mcText(c, ep.resistance)}.`;
}

// Kontrolni seznam pogojev za vse tri vzorce (✓ izpolnjeno / ○ čaka).
function renderConditions(c, target) {
  const host = $(target);
  if (!host) return;
  host.replaceChildren();
  if (!c || c.practice) return;
  const sig = signal(c);
  const add = (text, cls) => {
    const el = document.createElement("p");
    el.textContent = text;
    if (cls) el.className = cls;
    host.append(el);
  };
  const ageMin = c.created ? (Date.now() - c.created) / 60000 : null;
  const filters = [
    [fresh(c), "sveža cena (mlajša od 75 s)"],
    [c.liquidity >= 10000, "likvidnost vsaj 10.000 $ (zdaj " + compact(c.liquidity) + ")"],
    [c.volume > 0, "promet v zadnjih 5 min (zdaj " + compact(c.volume) + ")"],
    [ageMin !== null && ageMin >= FILTER.minAge && ageMin <= FILTER.maxAge, "starost para 30 do 90 min (zdaj " + (ageMin === null ? "neznana" : ageMin < 120 ? Math.floor(ageMin) + " min" : Math.floor(ageMin / 60) + " h") + ")"],
    [!Number.isFinite(c.change1h) || c.change1h >= 0, "v zadnji uri ni v minusu (zdaj " + (Number.isFinite(c.change1h) ? pct1(c.change1h) : "ni podatka") + ")"],
    [!Number.isFinite(c.mcap) || (c.mcap >= FILTER.minMcap && c.mcap <= FILTER.maxMcap), "MC 20K do 300K $ (zdaj " + compact(c.mcap) + ")"],
    [c.history.length >= 16, "16 zaporednih posnetkov (zdaj " + Math.min(c.history.length, 16) + "/16)"],
  ];
  const h = document.createElement("h4");
  h.textContent = "Filtri bota";
  host.append(h);
  for (const [ok, label] of filters) add((ok ? "✓ " : "○ ") + label, ok ? "ok" : "wait");
  if (!sig.checks) {
    add("Vzorce preverjam šele, ko so vsi filtri izpolnjeni.", "muted");
    return;
  }
  for (const group of sig.checks) {
    const gh = document.createElement("h4");
    const done = group.items.every((i) => i.ok);
    gh.textContent = group.name + (done ? " · IZPOLNJEN" : " · " + group.items.filter((i) => i.ok).length + "/" + group.items.length);
    host.append(gh);
    for (const item of group.items) add((item.ok ? "✓ " : "○ ") + item.label, item.ok ? "ok" : "wait");
  }
  add(`Podpora ${mcText(c, sig.levels.support)} · odpor ${mcText(c, sig.levels.resistance)} (najnižja in najvišja cena prvih 10 od zadnjih 16 posnetkov). Okno se premakne ob vsakem posnetku.`, "muted");
}

// Orodja ob kovancu za ročno trgovanje: kopiraj CA, odpri DEX Screener, pravi graf s svečami.
let realChartFor = null;
function renderTools(c) {
  const host = $("#tools");
  if (!host) return;
  host.replaceChildren();
  if (!c || c.practice) {
    $("#realChart").hidden = true;
    return;
  }
  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    host.append(b);
    return b;
  };
  btn("Kopiraj CA", async (e) => {
    try {
      await navigator.clipboard.writeText(c.token);
      e.target.textContent = "Kopirano ✓";
      setTimeout(() => (e.target.textContent = "Kopiraj CA"), 1500);
    } catch {
      e.target.textContent = "Kopiranje ni uspelo";
    }
  });
  const a = document.createElement("a");
  a.href = c.url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = "Odpri na DEX Screener ↗";
  a.className = "linkBtn";
  host.append(a);
  const showing = realChartFor === c.id;
  btn(showing ? "Skrij pravi graf" : "Pravi graf s svečami (DEX Screener)", () => {
    realChartFor = showing ? null : c.id;
    draw();
  });
  const box = $("#realChart");
  if (showing) {
    const want = "https://dexscreener.com/solana/" + c.id + "?embed=1&theme=dark&trades=0&info=0";
    if (box.dataset.src !== want) {
      box.replaceChildren();
      const f = document.createElement("iframe");
      f.src = want;
      f.title = "DEX Screener graf " + c.symbol;
      f.loading = "lazy";
      f.allow = "clipboard-write";
      box.append(f);
      box.dataset.src = want;
    }
    box.hidden = false;
  } else {
    box.hidden = true;
    box.replaceChildren();
    box.dataset.src = "";
  }
}

function closeAt(t, price, tm, reason) {
  t.closed = Date.now();
  t.exit = price;
  t.pnl = markToMarket(t, price);
  t.outcome = reason + (t.halfSold && Number.isFinite(t.halfPrice) ? " · pol prodano pri " + pct1((t.halfPrice / t.entry - 1) * 100) : "");
  t.exitObserved = tm || Date.now();
  save();
}
function close(t, c, reason) {
  closeAt(t, c.price, c.time, reason);
}
function coinFromRow(r, history) {
  return {
    id: r.pair,
    token: r.token,
    symbol: r.symbol || "Neznan",
    name: r.name || "",
    price: r.price,
    mcap: Number.isFinite(r.mcap) ? r.mcap : null,
    liquidity: r.liquidity,
    volume: r.volume5m,
    created: r.pair_created_ms,
    change1h: Number.isFinite(r.change1h) ? r.change1h : null,
    buys: Number.isFinite(r.buys5m) ? r.buys5m : null,
    sells: Number.isFinite(r.sells5m) ? r.sells5m : null,
    image: r.image || "",
    url: r.url || "https://dexscreener.com/solana/" + r.pair,
    time: new Date(r.t).getTime(),
    history,
  };
}
// Supabase vrne največ 1000 vrstic na klic, zato beremo po straneh (urejeno po t in pair, da so strani stabilne).
const PAGE = 1000;
async function pagedRows(build, maxPages = 8) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build().range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
async function fetchRows(sinceMs) {
  return pagedRows(() =>
    db
      .from("memecoin_snapshots")
      .select("pair,t,token,symbol,name,price,mcap,liquidity,volume5m,pair_created_ms,image,url,change1h,buys5m,sells5m")
      .gt("t", new Date(sinceMs).toISOString())
      .order("t", { ascending: true })
      .order("pair", { ascending: true }),
  );
}
// Pravila za en nov posnetek kovanca c ob času tm: zapiranje odprtih poslov, samodejni vstop, opozorila.
function applyTradeLogic(c, tm) {
  const id = c.id,
    price = c.price;
  for (const t of trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === id)) {
    if (tm - t.lastObserved > 75000) interruptTrade(t, "Strežnik za ta par ni imel podatkov več kot 75 sekund");
    t.lastObserved = tm;
    if (!t.interrupted) {
      const why = stepExit(t, price);
      if (why) closeAt(t, price, tm, why);
    }
  }
  const s = signal(c);
  const blocked = s.signal ? entryFilter(c) : null;
  if (
    s.signal &&
    !blocked &&
    $("#auto").checked &&
    !trades.some((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === id) &&
    trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).length < 5
  ) {
    enter(c, s, true);
  }
  if (s.signal && Date.now() - (announced.get(id) || 0) > 300000) {
    alerts.unshift(`${time(Date.now())} · ${c.symbol} · ${s.name}` + (blocked ? " · brez vstopa, izven filtra: " + blocked : ""));
    announced.set(id, Date.now());
  }
}
// Odprti posli ob vrnitvi na stran: strežnik je cene videl tudi, ko brskalnik ni bil odprt, zato jih preigramo.
async function reconcileOpenTrades() {
  let changed = false;
  for (const t of trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice)) {
    try {
      const from = t.lastObserved || t.opened;
      const data = await pagedRows(() =>
        db.from("memecoin_snapshots").select("t,price").eq("pair", t.id).gt("t", new Date(from).toISOString()).order("t", { ascending: true }),
      );
      let prev = from;
      for (const r of data) {
        const tm = new Date(r.t).getTime();
        if (tm - prev > 75000) {
          interruptTrade(t, "Strežnik za ta par ni imel podatkov več kot 75 sekund");
          break;
        }
        prev = tm;
        t.lastObserved = tm;
        const why = stepExit(t, r.price);
        if (why) {
          closeAt(t, r.price, tm, why);
          break;
        }
      }
      if (!t.closed && !t.interrupted && lastSnapshotT - t.lastObserved > 75000) interruptTrade(t, "Strežnik za ta par nima svežih podatkov");
      changed = true;
      if (!t.closed && !t.interrupted) registerWatch({ id: t.id, token: t.token });
    } catch {
      /* pustimo odprt; naslednji prejem bo videl */
    }
  }
  if (changed) save();
}
async function registerWatch(c) {
  if (!db || !remoteUser || !c) return;
  try {
    await db.from("memecoin_watch").upsert({ pair: c.id, token: c.token, added_by: remoteUser.id, expires_at: new Date(Date.now() + 12 * 3600000).toISOString() });
  } catch {}
}
async function poll() {
  if (busy) return;
  busy = true;
  $("#refresh").disabled = true;
  try {
    if (!db) throw Error("brez povezave s profilom");
    const since = primed ? lastSnapshotT : Date.now() - HISTORY_MIN * 60000;
    const rows = await fetchRows(since);
    noData = !primed && !rows.length;
    const groups = new Map();
    for (const r of rows) {
      const tm = new Date(r.t).getTime();
      if (!groups.has(tm)) groups.set(tm, []);
      groups.get(tm).push(r);
    }
    const times = [...groups.keys()].sort((a, b) => a - b);
    for (const tm of times) {
      for (const r of groups.get(tm)) {
        const old = coins.get(r.pair);
        const history = old?.history || [];
        if (!history.length || tm > history.at(-1).t) {
          history.push({ p: r.price, t: tm });
          if (history.length > 160) history.shift();
        }
        const c = coinFromRow(r, history);
        coins.set(r.pair, c);
        if (primed) applyTradeLogic(c, tm);
      }
      lastSnapshotT = Math.max(lastSnapshotT, tm);
    }
    last = lastSnapshotT;
    healthy = lastSnapshotT > 0 && Date.now() - lastSnapshotT < 75000;
    if (!primed) {
      primed = true;
      await reconcileOpenTrades();
    }
    if (!selected) selected = coins.keys().next().value;
    save();
  } catch {
    healthy = false;
  } finally {
    busy = false;
    $("#refresh").disabled = false;
    status();
    draw();
  }
}
function status() {
  $("#status").className = "notice " + (mode === "practice" ? "practice" : healthy && Date.now() - last < 75000 ? "connected" : "stopped");
  if (mode === "practice") $("#status").textContent = "IZMIŠLJENA VAJA · najprej primer rasti, nato primer izgube. To ni napoved.";
  else if (noData) $("#status").textContent = "Strežnik še nima posnetkov za zadnjo uro ali ta račun nima dostopa do podatkov. Poskusi Osveži čez minuto.";
  else
    $("#status").textContent =
      healthy && Date.now() - last < 75000
        ? "Strežnik zbira 24/7 · zadnji posnetek " + time(last) + " · zakasnitev ponudnika ni znana."
        : "PREMOR · strežnik nima svežega posnetka (ali brskalnik nima povezave). Opozorila in vstopi počakajo na nov posnetek.";
}
function navigate(v, m = mode) {
  if (m !== mode) $("#feedback").textContent = "";
  view = v;
  mode = m;
  $("#market").hidden = v !== "market";
  $("#journal").hidden = v !== "journal";
  $("#info").hidden = v !== "info";
  $("#watching").hidden = v !== "watching";
  $("#dashboard").hidden = v !== "dashboard";
  $("#comparison").hidden = v !== "comparison";
  for (const id of ["live", "history", "about", "watch", "overview", "compare"])
    $("#" + id).classList.toggle(
      "active",
      id ===
        (v === "dashboard"
          ? "overview"
          : v === "watching"
            ? "watch"
            : v === "journal"
              ? "history"
              : v === "info"
                ? "about"
                : v === "comparison"
                  ? "compare"
                  : m),
    );
  status();
  draw();
}
$("#live").onclick = () => navigate("market", "live");
$("#history").onclick = () => navigate("journal");
$("#about").onclick = () => navigate("info");
$("#compare").onclick = () => {
  navigate("comparison", "live");
  loadShadow();
};
$("#refresh").onclick = poll;
function enter(c, s, automatic) {
  if (
    (automatic && !s.signal) ||
    manualBlock(c) ||
    trades.some((t) => (t.token === c.token || t.id === c.id) && !t.deletedAt && !t.interrupted && !t.closed) ||
    (automatic && trades.some((t) => t.id === c.id && t.signalAt === c.time)) ||
    trades.filter((t) => !t.practice && !t.closed && !t.interrupted && !t.deletedAt).length >= 5
  )
    return false;
  trades.push({
    key: crypto.randomUUID(),
    id: c.id,
    token: c.token,
    symbol: c.symbol,
    practice: !!c.practice,
    opened: Date.now(),
    lastObserved: c.time || Date.now(),
    entry: c.price,
    entryMcap: Number.isFinite(c.mcap) ? c.mcap : null,
    ...exitPlan(profile, c.price),
    reason: automatic ? s.name : "Lastna odločitev · " + s.name,
    automatic,
    signalAt: c.time || Date.now(),
    sizeSOL: stake,
    slippagePerSide: 0.01,
    feePerSide: 0.005,
    networkSOL: 0.00001,
  });
  save();
  registerWatch(c);
  return true;
}
$("#open").onclick = () => manualEntry(current(), "#feedback");

function journal() {
  renderReview();
  renderDeleted();
  renderEvents();
  $("#rows").replaceChildren();
  for (const t of trades.filter((t) => !t.deletedAt && !t.interrupted).reverse()) {
    const tr = document.createElement("tr");
    const vals = [
      `${t.symbol} · ${t.practice ? "VAJA" : "ŽIVI POSNETKI"} · vložek ${tradeSize(t).toLocaleString("sl-SI")} SOL`,
      `${time(t.opened)} · ${t.reason} · ${t.ruleVersion || "1.0"} · ${t.automatic ? "samodejno" : "ročno"}${t.closed ? " → " + time(t.closed) : ""}`,
      `${money(t.entry)}${Number.isFinite(t.entryMcap) ? " (MC " + compact(t.entryMcap) + ")" : ""} → ${t.closed ? money(t.exit) + (Number.isFinite(t.entryMcap) && t.entry > 0 ? " (MC " + compact((t.entryMcap / t.entry) * t.exit) + ")" : "") : "-"}`,
      t.closed
        ? `${t.interrupted ? "PO VRZELI · " : ""}${t.outcome} · ${signed(t.pnl)} SOL · ${returnText(t)}`
        : t.interrupted
          ? "Prekinjeno · izid med vrzeljo neznan"
          : "Odprto",
    ];
    for (const [i, v] of vals.entries()) {
      const td = document.createElement("td");
      td.textContent = v;
      if (i === 3 && t.closed) td.className = tone(t.pnl);
      tr.append(td);
    }
    const td = document.createElement("td");
    if (!t.deletedAt && !t.interrupted && !t.closed && !t.practice) {
      const b = document.createElement("button");
      b.textContent = t.interrupted ? "Preglej prekinitev" : "Preglej / zapri";
      b.onclick = () => reviewTrade(t.key);
      td.append(b);
    }
    const manage = document.createElement("button");
    manage.textContent = "Uredi zapis";
    manage.onclick = () => reviewTrade(t.key);
    td.append(manage);
    tr.append(td);
    $("#rows").append(tr);
  }
  if (!trades.some((t) => !t.deletedAt && !t.interrupted)) $("#rows").textContent = "Še ni demo poslov.";
  $("#totals").textContent = ["ŽIVI POSNETKI", "VAJA"]
    .map(
      (label, i) =>
        `${label}: ${trades
          .filter((t) => !t.deletedAt && !t.interrupted && t.closed && !!t.practice === !!i)
          .reduce((s, t) => s + t.pnl, 0)
          .toFixed(6)} SOL neto`,
    )
    .join(" · ");
  const closed = trades.filter((t) => !t.deletedAt && !t.interrupted && t.closed && !t.practice).sort((a, b) => a.closed - b.closed),
    win = closed.filter((t) => t.pnl > 0),
    loss = closed.filter((t) => t.pnl < 0);
  let balance = 0,
    peak = 0,
    dd = 0;
  for (const t of closed) {
    balance += t.pnl;
    peak = Math.max(peak, balance);
    dd = Math.max(dd, peak - balance);
  }
  const avg = (a) => (a.length ? (a.reduce((s, t) => s + t.pnl, 0) / a.length).toFixed(6) : "-");
  $("#stats").textContent =
    `Živi demo: ${closed.length} zaključenih · povprečni dobitek ${avg(win)} SOL · povprečna izguba ${avg(loss)} SOL · povprečni neto posel ${avg(closed)} SOL · največji padec zaključenega stanja ${dd.toFixed(6)} SOL. Odprte izgube niso vključene v ta padec. Začetno virtualno stanje za to metriko: 0 SOL; brez omejenega demo proračuna. Učenje pravil še ni izvedeno.`;
}
$("#export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          assumptions: "SOL/USD nespremenjen; cene opaženih posnetkov, ne zagotovljena izvršitev.",
          trades,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "demo-dnevnik.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
try {
  const saved = localStorage.getItem("solana-auto-v1");
  $("#auto").checked = saved === "on";
  $("#autoSaved").textContent =
    saved === null
      ? "Izbira še ni shranjena. Stara različica vklopa ni pomnila; po želji ga izberi enkrat."
      : "Naložena shranjena izbira v tem brskalniku.";
} catch {
  $("#auto").checked = false;
  $("#autoSaved").textContent = "Shranjevanje ni dosegljivo. Izbira se po osvežitvi morda ne bo ohranila.";
}
if (remoteAuto !== null) {
  $("#auto").checked = remoteAuto;
  $("#autoSaved").textContent = "Nastavitev s profila (velja v vseh brskalnikih).";
}
$("#autoState").textContent = $("#auto").checked ? "VKLJUČENI" : "IZKLJUČENI";
poll();
setInterval(poll, 30000);
setInterval(() => {
  if (view === "comparison" && !document.hidden) loadShadow();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) poll();
});
setInterval(() => {
  status();
  if (mode === "live") draw();
}, 5000);

$("#auto").onchange = () => {
  try {
    const value = $("#auto").checked ? "on" : "off";
    localStorage.setItem("solana-auto-v1", value);
    if (localStorage.getItem("solana-auto-v1") !== value) throw Error();
    $("#autoSaved").textContent =
      "Izbira shranjena: " + (value === "on" ? "vključeno" : "izključeno") + ". Ostane po osvežitvi v tem brskalniku.";
  } catch {
    $("#autoSaved").textContent = "Izbire ni bilo mogoče shraniti. Velja samo v tem odprtem zavihku.";
  }
  $("#autoState").textContent = $("#auto").checked ? "VKLJUČENI" : "IZKLJUČENI";
  scheduleRemote();
  watching();
};

$("#watch").onclick = () => navigate("watching", "live");
let watchSignature = "",
  showAllColumns = false;
function watching() {
  const signature = JSON.stringify([
    [...coins.values()].map((c) => [c.id, c.time, fresh(c)]),
    healthy,
    showAllColumns,
    $("#boardFilter").value,
    $("#auto").checked,
    trades.map((t) => [t.key, t.closed, t.interrupted, t.signalAt]),
  ]);
  if (signature === watchSignature) return;
  watchSignature = signature;
  const host = $("#watchCards");
  const top = $("#watchTop");
  const expanded = new Set([...document.querySelectorAll("#watchCards details[open], #watchTop details[open]")].map((d) => d.dataset.id));
  host.replaceChildren();
  top.replaceChildren();
  $("#watchStatus").textContent =
    `Posodobitev pogleda: ${time(Date.now())}. Zadnji prejem vira: ${last ? time(last) : "še čakamo"}. Samodejni demo vstopi: ${$("#auto").checked ? "vključeni" : "izključeni"}.`;
  if (!coins.size) {
    $("#watchEmpty").textContent = "Še ni kandidatov. Počakaj na povezavo .";
    host.textContent = "Še ni kandidatov. Vir morda še nalaga podatke ali ni dosegljiv. Poskusi Živi izbor → Osveži .";
    return;
  }
  const ranked = [...coins.values()].map((c) => ({ c, ...cardState(c) })).sort((a, b) => b.rank - a.rank || a.c.id.localeCompare(b.c.id));
  const filtered = ranked.filter((x) => $("#boardFilter").value !== "fresh" || fresh(x.c));
  const columns = new Map();
  const chosen = [];
  for (const title of ["Zbiranje podatkov", "Čakanje na vstop", "Brez signala"]) {
    const items = filtered.filter((x) => boardColumn(x) === title);
    const col = document.createElement("section");
    col.className = "boardColumn";
    const h = document.createElement("h3");
    h.textContent = title + " · " + items.length;
    col.append(h);
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Trenutno ni kovancev.";
      col.append(p);
    }
    columns.set(title, col);
    top.append(col);
    chosen.push(...items.slice(0, showAllColumns ? items.length : 3));
  }
  $("#watchEmpty").textContent = ranked.some((x) => x.rank >= 10)
    ? "Kartice se ob novih podatkih samodejno premaknejo. Razvrstitev ni ocena dobička."
    : "Trenutno ni kandidata za vstop. Program zbira podatke ali čaka na izpolnjene filtre.";
  for (const { c } of ranked) {
    const d = document.createElement("details");
    d.dataset.id = c.id;
    d.open = expanded.has(c.id);
    const summary = document.createElement("summary"),
      sig = signal(c);
    summary.textContent = c.symbol + " · " + sig.name;
    d.append(summary);
    const add = (text) => {
      const p = document.createElement("p");
      p.textContent = text;
      d.append(p);
    };
    add(sig.reason);
    add("Kovanec: " + c.token + " · par: " + c.id);
    add("Zadnji prejem: " + time(c.time) + " · " + Math.min(c.history.length, 16) + "/16 potrebnih posnetkov.");
    add((fresh(c) ? "Izpolnjeno: " : "Manjka: ") + "svež odgovor vira (manj kot 75 sekund). Dejanska zakasnitev ponudnika ni znana.");
    add(
      (c.liquidity >= 10000 ? "Izpolnjeno: " : "Manjka: ") +
        "vsaj 10.000 USD likvidnosti; trenutno " +
        money(c.liquidity) +
        ". Likvidnost pomeni sredstva v trgovalnem paru.",
    );
    add((c.volume > 0 ? "Izpolnjeno: " : "Manjka: ") + "pozitiven promet v zadnjih 5 minutah; trenutno " + money(c.volume) + ".");
    if (sig.checks) {
      add(
        "Podpora: " +
          money(sig.levels.support) +
          " · Odpor: " +
          money(sig.levels.resistance) +
          ". To sta najnižja in najvišja cena prvih desetih od zadnjih 16 posnetkov.",
      );
      for (const group of sig.checks) {
        const h = document.createElement("h3");
        h.textContent = group.name;
        d.append(h);
        for (const item of group.items) add((item.ok ? "Izpolnjeno: " : "Manjka: ") + item.label);
      }
    } else
      add("Cenovnih vzorcev trenutno ne preverjamo: najprej morajo biti izpolnjeni zgornji filtri in zbranih 16 neprekinjenih posnetkov.");
    const open = trades.find((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === c.id);
    if (open)
      add(
        `Demo že odprt: ${open.reason}, ${time(open.opened)} (${open.automatic ? "samodejno" : "ročno"}). ${open.interrupted ? "Spremljanje je bilo prekinjeno; izid v vrzeli je neznan." : "Čakamo na cilj ali mejo izgube."}`,
      );
    else if (!sig.signal) add("Brez demo vstopa: vzorec ali podatkovni pogoji še niso izpolnjeni.");
    else if (!$("#auto").checked) add("Vzorec je izpolnjen. Samodejni demo vstopi so izključeni; možen je ročni pregled na grafu.");
    else if (trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).length >= 5)
      add("Samodejni demo čaka: odprtih je že pet poslov.");
    else add("Pogoji za samodejni demo so izpolnjeni. Ponovno jih preverimo ob naslednjem prejemu podatkov.");
    const b = document.createElement("button");
    b.textContent = "Poglej cenovni graf";
    b.onclick = () => openBoardGraph(c.id);
    d.append(b);
    host.append(d);
    const state = chosen.find((x) => x.c.id === c.id);
    if (state && !state.open) {
      const card = document.createElement("article");
      const h = document.createElement("h3");
      h.textContent = c.symbol;
      card.append(h);
      const title = document.createElement("strong");
      title.textContent = state.title;
      card.append(title);
      const mcLine = document.createElement("p");
      mcLine.className = "cardMc";
      mcLine.textContent = (Number.isFinite(c.mcap) ? "MC " + compact(c.mcap) : money(c.price)) + " · " + age(c.created) + " · likv. " + compact(c.liquidity);
      card.append(mcLine);
      const reason = document.createElement("p");
      reason.textContent = state.reason;
      card.append(reason);
      if (!state.open && !state.collect && fresh(c) && c.history.length >= 16 && c.liquidity >= 10000 && c.volume > 0) {
        const ep = entryPoint(c.history);
        const e = document.createElement("p");
        e.className = "cardEntry";
        e.textContent =
          ep.state === "ready"
            ? "Vstop, če naslednja cena > " + mcText(c, ep.price) + " (" + ep.pattern + ")"
            : ep.state === "signal"
              ? "Vzorec izpolnjen: " + ep.pattern
              : ep.state === "waiting"
                ? "Manjka: " + ep.missing[0]
                : "";
        if (e.textContent) card.append(e);
      }
      if (state.collect) {
        const bar = document.createElement("progress");
        bar.max = 16;
        bar.value = Math.min(c.history.length, 16);
        bar.setAttribute("aria-label", "Napredek zbiranja");
        card.append(bar);
      }
      const action = document.createElement("button");
      action.textContent = state.open ? "Poglej demo posel" : "Poglej graf";
      action.onclick = () => {
        if (state.open) navigate("journal", "live");
        else openBoardGraph(c.id);
      };
      card.append(action);
      const more = document.createElement("details");
      more.dataset.id = "top-" + c.id;
      more.open = expanded.has(more.dataset.id);
      const label = document.createElement("summary");
      label.textContent = "Podrobnosti";
      more.append(label);
      for (const child of d.children) {
        if (child.tagName !== "SUMMARY" && child.tagName !== "BUTTON") more.append(child.cloneNode(true));
      }
      card.append(more);
      columns.get(boardColumn(state)).append(card);
    }
  }
}

function cardState(c) {
  const open = trades.find((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === c.id),
    sig = signal(c);
  if (open)
    return {
      rank: 1000,
      open: true,
      title: "Demo odprt",
      reason:
        open.interrupted || !fresh(c)
          ? "Podatki so bili prekinjeni. Preveri posel v dnevniku."
          : "Spremljam, ali cena doseže cilj ali mejo izgube.",
    };
  if (!fresh(c) || c.liquidity < 10000 || !c.liquidity || !(c.volume > 0) || sig.name === "Premor")
    return {
      rank: 0,
      title: !fresh(c) ? "Čakam na sveže podatke" : sig.name === "Premor" ? "Prekinjeni podatki" : "Brez signala",
      reason: !fresh(c)
        ? "Vir ni poslal svežih podatkov. Vstop je ustavljen."
        : sig.name === "Premor"
          ? "V cenah je vrzel. Čakam na neprekinjene podatke."
          : !c.liquidity || c.liquidity < 10000
            ? "Ni dovolj podatkov o likvidnosti ali je prenizka."
            : "V zadnjih petih minutah ni prometa.",
    };
  const blocked = entryFilter(c);
  if (blocked)
    return {
      rank: 0,
      filtered: true,
      title: "Izven filtra vstopov",
      reason: "Bot sam ne vstopi: " + blocked + ". Ročni vstop je dovoljen.",
    };
  if (c.history.length < 16)
    return {
      rank: 1 + c.history.length / 16,
      collect: true,
      title: "Zbiram podatke",
      reason: "Pusti stran odprto. Še približno " + Math.ceil(((16 - c.history.length) * 30) / 60) + " min ob rednem osveževanju.",
    };
  if (sig.signal) {
    const full = trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).length >= 5;
    return {
      rank: 100,
      title: "Vzorec zaznan",
      reason: !$("#auto").checked
        ? "Samodejni demo je izklopljen. Na grafu lahko preveriš vstop."
        : full
          ? "Čakam, da se sprosti eno od petih mest za demo."
          : "Ob naslednjih podatkih ponovno preverim pogoje za demo vstop.",
    };
  }
  const groups = sig.checks || [],
    best = [...groups].sort(
      (a, b) => b.items.filter((x) => x.ok).length / b.items.length - a.items.filter((x) => x.ok).length / a.items.length,
    )[0];
  const bounce = groups.find((g) => g.name === "Odboj od podpore");
  const waitingBounce = bounce?.items[0].ok && !bounce.items[1].ok;
  return {
    rank: 10 + (best ? best.items.filter((x) => x.ok).length / best.items.length : 0),
    title: waitingBounce ? "Čakam na odboj" : "Čakam na vzorec",
    reason: waitingBounce
      ? "Cena je blizu podpore. Čakam, da ponovno zraste."
      : "Cena še ne izpolnjuje vseh pogojev. Za zdaj samo opazujem.",
  };
}

function boardColumn(state) {
  return state.open ? "Demo odprt" : state.collect ? "Zbiranje podatkov" : state.rank === 0 ? "Brez signala" : "Čakanje na vstop";
}
$("#boardFilter").onchange = () => watching();
$("#boardMore").onclick = () => {
  showAllColumns = !showAllColumns;
  $("#boardMore").textContent = showAllColumns ? "Pokaži manj" : "Pokaži več v vseh stolpcih";
  watching();
};

$("#overview").onclick = () => navigate("dashboard", "live");
$("#period").onchange = dashboard;
$("#quality").onchange = dashboard;
$("#usdRate").oninput = dashboard;
function dashboard() {
  const rate = Number($("#usdRate").value),
    prices = new Map([...coins.values()].map((c) => [c.id, { price: c.price, fresh: fresh(c) }]));
  const o = overview(trades, {
    period: $("#period").value || "all",
    quality: $("#quality").value || "all",
    rate: rate > 0 ? rate : null,
    prices,
  });
  $("#excludedNote").textContent =
    o.excluded + " dogodkov izgube podatkov je ločenih od poslov in rezultatov. Običajne izgube ostajajo vključene.";
  $("#dashNet").textContent = signed(o.net) + " SOL";
  $("#dashNet").className = tone(o.net);
  $("#dashNet").setAttribute(
    "aria-label",
    (o.net > 0 ? "Dobiček " : o.net < 0 ? "Izguba " : "Nevtralno ") + signed(o.net) + " SOL po stroških",
  );
  $("#winFill").style.width = (o.success === null ? 0 : o.success * 100) + "%";
  $("#dashUsd").textContent =
    o.usd === null
      ? "USD: znesek ni izračunan, vnesi tečaj spodaj."
      : "≈ " + money(o.usd) + " pri ročno vnesenem tečaju " + money(rate) + " / SOL";
  $("#dashSuccess").textContent =
    o.success === null ? "Še ni podatkov" : (o.success * 100).toLocaleString("sl-SI", { maximumFractionDigits: 1 }) + " %";
  $("#dashDenominator").textContent = o.closed.length
    ? o.wins + " dobičkonosnih od " + o.closed.length + " zaključenih poslov"
    : "Ni zaključenih živih demo poslov v tem obdobju.";
  $("#dashDenominator").textContent +=
    " · " +
    o.open.length +
    " odprtih ni v deležu, od tega " +
    o.marks.filter((m) => m.pnl === null).length +
    " z neznanim izidom. Dodatno " +
    o.excluded +
    " izločenih izgub podatkov; to ni uspešnost vseh poskusov.";
  $("#dashCounts").textContent = o.closed.length + " / " + o.open.length;
  $("#dashOutcomes").textContent = o.wins + " dobitkov · " + o.losses + " izgub · " + o.flat + " brez spremembe";
  $("#dashOpen").textContent = !o.open.length
    ? "Ni odprtih poslov"
    : o.unrealized === null
      ? "Neznano: manjkajo sveže cene ali je spremljanje prekinjeno."
      : signed(o.unrealized) + " SOL (ocena)";
  $("#dashOpen").className = o.unrealized === null ? "neutral" : tone(o.unrealized);
  const positions = $("#dashPositions");
  positions.replaceChildren();
  for (const m of o.marks) {
    const p = document.createElement("p");
    p.textContent =
      m.trade.symbol + " · " + (m.pnl === null ? "Neznano, prekinjeno ali brez sveže cene" : signed(m.pnl) + " SOL (odprto)") + (Number.isFinite(m.trade.entryMcap) ? " · vstop MC " + compact(m.trade.entryMcap) : "");
    p.className = m.pnl === null ? "neutral" : tone(m.pnl);
    positions.append(p);
    const b = document.createElement("button");
    b.textContent = m.trade.interrupted ? "Preglej prekinitev" : "Pokaži graf";
    b.onclick = () => (m.trade.interrupted ? reviewTrade(m.trade.key) : showOpenTrades());
    positions.append(b);
  }
  $("#dashActivity").textContent =
    (healthy && Date.now() - last < 75000 ? "VIR POVEZAN" : "SPREMLJANJE V PREMORU") +
    " · " +
    [...coins.values()].filter((c) => fresh(c)).length +
    " kovancev s svežim prejemom · " +
    (last ? "zadnji prejem " + time(last) : "čakam na prvi prejem") +
    ". Samodejni demo: " +
    ($("#auto").checked ? "vključen" : "izključen") +
    ".";
  const rows = $("#dashRecent");
  rows.replaceChildren();
  for (const t of [...o.closed].reverse().slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "tradeRow";
    const name = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = t.symbol;
    const when = document.createElement("small");
    when.textContent = time(t.closed);
    name.append(title);
    name.append(when);
    row.append(name);
    const outcome = document.createElement("small");
    outcome.textContent = (t.interrupted ? "PO VRZELI · neprimerljivo z neprekinjenim izidom · " : "") + (t.outcome || "Zaključeno");
    row.append(outcome);
    const profit = document.createElement("div");
    profit.className = "return " + tone(t.pnl);
    const sol = document.createElement("strong");
    sol.textContent = (t.pnl > 0 ? "↑ Dobiček " : t.pnl < 0 ? "↓ Izguba " : "• Nevtralno ") + signed(t.pnl) + " SOL";
    profit.append(sol);
    const pct = document.createElement("span");
    pct.className = "returnTag";
    pct.textContent = returnText(t);
    profit.append(pct);
    row.append(profit);
    rows.append(row);
  }
  rows.className = o.closed.length ? "" : "empty";
  if (!o.closed.length) rows.textContent = "Za izbrano obdobje še ni zaključenih živih demo poslov. Vaje so samo v dnevniku.";
  const svg = $("#dashCurve");
  svg.replaceChildren();
  if (o.curve.length) {
    const values = [0, ...o.curve.map((p) => p.pnl)],
      lo = Math.min(...values),
      hi = Math.max(...values),
      range = hi - lo || 0.001;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute(
      "points",
      values.map((v, i) => `${25 + (i / (values.length - 1)) * 650},${195 - ((v - lo) / range) * 160}`).join(" "),
    );
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", o.net < 0 ? "#ff858e" : "#62e4b3");
    line.setAttribute("stroke-width", "3");
    for (const v of [lo, 0, hi]) {
      const y = 195 - ((v - lo) / range) * 160;
      const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
      for (const [k, x] of Object.entries({ x1: 25, x2: 675, y1: y, y2: y, stroke: "#33465e", "stroke-dasharray": "4 5" }))
        grid.setAttribute(k, x);
      svg.append(grid);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", "28");
      label.setAttribute("y", Math.max(16, y - 6));
      label.setAttribute("fill", "#a0b5d1");
      label.setAttribute("font-size", "13");
      label.textContent = v.toFixed(4) + " SOL";
      svg.append(label);
    }
    svg.append(line);
    $("#curveNote").textContent =
      "Od 0 do " + o.net.toFixed(6) + " SOL · vsak korak je zaključen posel v izbranem obdobju; razmiki ne predstavljajo časa.";
  } else $("#curveNote").textContent = "Krivulja se pojavi po prvem zaključenem živem demo poslu.";
}

function tone(n) {
  return n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
}
function signed(n) {
  return (n > 0 ? "+" : "") + n.toFixed(6);
}
function returnText(t) {
  const p = netReturnPercent(t);
  return p === null
    ? "Donos % ni znan (manjka vložek)"
    : (p > 0 ? "+" : "") + p.toLocaleString("sl-SI", { maximumFractionDigits: 2 }) + " % neto";
}

function interruptTrade(t, reason) {
  if (!t.interrupted) {
    t.gaps = t.gaps || [];
    t.gaps.push({ detectedAt: Date.now(), lastObserved: t.lastObserved || null, reason });
  }
  t.interrupted = true;
}
let reviewingKey = null,
  confirmingDelete = null;
function reviewTrade(key) {
  reviewingKey = key;
  navigate("journal", "live");
  $("#tradeReview").scrollIntoView?.({ block: "nearest" });
}
function renderReview() {
  const panel = $("#tradeReview");
  panel.replaceChildren();
  const t = trades.find((t) => t.key === reviewingKey);
  panel.hidden = !t;
  if (!t) return;
  const add = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    panel.append(e);
    return e;
  };
  addDeleteControl(t, panel);
  add("h3", t.symbol + " · " + (t.closed ? "Zaključen demo" : t.interrupted ? "Prekinjeno spremljanje" : "Odprti demo"));
  if (t.interrupted) {
    add(
      "p",
      "Izguba podatkov: izid neznan. Ta zapis je samo dogodek; ne vpliva na P&L ali uspešnost. Zapiranje po novi ceni ni omogočeno.",
    );
    add("small", "Vstop " + time(t.opened) + " · cena " + money(t.entry));
    return;
  }
  if (t.interrupted)
    add(
      "p",
      "Med vrzeljo ne vemo, ali bi bil dosežen cilj ali meja izgube. Nova povezava te zgodovine ne more obnoviti. Spanje je le eden od možnih vzrokov.",
    );
  for (const g of t.gaps || [])
    add(
      "small",
      "Zaznano " + time(g.detectedAt) + " · " + g.reason + (g.lastObserved ? " · zadnji prejem pred vrzeljo " + time(g.lastObserved) : ""),
    );
  if (t.interrupted && !t.gaps?.length) add("small", "Starejši zapis prekinitve: čas in vzrok nista bila shranjena.");
  if (t.closed) {
    add("p", "Ročni zaključek ostane v dnevniku skupaj z oznako prekinitve.");
    return;
  }
  const c = coins.get(t.id);
  add("p", "Vstop " + mcText(c, t.entry) + " (" + money(t.entry) + ") · " + tradeLevels(t, c).summary);
  if (fresh(c)) {
    add("p", "Nova opažena cena: " + mcText(c, c.price) + " (" + money(c.price) + ") · prejeto " + time(c.time));
    add(
      "p",
      "Če zdaj zaključiš demo: približno " +
        signed(result(t.entry, c.price, tradeSize(t))) +
        " SOL po stroških. To je izid ob sedanji ceni, ne rekonstruiran izstop v vrzeli.",
    );
  } else add("p", "Za ta isti trgovalni par še ni sveže cene. Počakaj na nov prejem; zaključek je začasno onemogočen.");
  const b = add("button", "Zaključi demo po novi opaženi ceni");
  b.disabled = !fresh(c);
  b.onclick = () => {
    const latest = coins.get(t.id);
    if (t.closed || !fresh(latest)) {
      renderReview();
      return;
    }
    close(t, latest, t.interrupted ? "Ročno po prekinitvi · zgodovina vrzeli neznana" : "Ročni izstop");
    draw();
  };
}

function addDeleteControl(t, panel) {
  const b = document.createElement("button");
  if (confirmingDelete === t.key) {
    const p = document.createElement("p");
    p.textContent = "Izbris izloči samo ta zapis. Obnoviš ga lahko pod Izbrisani zapisi.";
    panel.append(p);
    b.textContent = "Potrdi izbris: " + t.symbol;
    b.onclick = () => {
      t.deletedAt = Date.now();
      save();
      reviewingKey = null;
      confirmingDelete = null;
      draw();
    };
    const cancel = document.createElement("button");
    cancel.textContent = "Prekliči";
    cancel.onclick = () => {
      confirmingDelete = null;
      renderReview();
    };
    panel.append(cancel);
  } else {
    b.textContent = "Izbriši ta zapis";
    b.onclick = () => {
      confirmingDelete = t.key;
      renderReview();
    };
  }
  panel.append(b);
}

function renderDeleted() {
  const root = $("#deletedRows");
  root.replaceChildren();
  for (const t of trades.filter((t) => t.deletedAt)) {
    const p = document.createElement("p");
    p.textContent = t.symbol + " · izbrisano " + time(t.deletedAt);
    const b = document.createElement("button");
    b.textContent = "Obnovi zapis";
    b.onclick = () => {
      delete t.deletedAt;
      t.restoredAt = Date.now();
      if (!t.closed) interruptTrade(t, "Obnovitev izbrisanega odprtega posla");
      save();
      draw();
    };
    p.append(b);
    root.append(p);
  }
}

function renderEvents() {
  const host = $("#dataEvents");
  host.replaceChildren();
  const events = trades.filter((t) => t.interrupted && !t.deletedAt && !t.practice);
  $("#eventsCount").textContent = "Izguba podatkov: izid neznan · " + events.length;
  for (const t of events) {
    const p = document.createElement("p");
    p.textContent = t.symbol + " · vstop " + time(t.opened) + " · " + money(t.entry) + " · izid neznan";
    const b = document.createElement("button");
    b.textContent = "Uredi / izbriši dogodek";
    b.onclick = () => reviewTrade(t.key);
    p.append(b);
    host.append(p);
  }
  if (!events.length) host.textContent = "Ni zabeleženih izgub podatkov.";
}

function stakeLabels() {
  const text = stake.toLocaleString("sl-SI", { maximumSignificantDigits: 21, useGrouping: false });
  $("#stakeBadge").textContent = "Novi demo · " + text + " SOL";
  renderManual(current(), "#open", "#liveManualState");
  renderManual(coins.get(boardSelected), "#boardManual", "#boardManualState");
  $("#stakeInput").value = text;
  $("#stakeCurrent").textContent = "Za nove posle: " + text + " SOL. Obstoječi vložki ostanejo enaki.";
}
function setStake(value) {
  const next = parseStake(value);
  if (next === null) {
    $("#stakeMessage").textContent = "Vnesi veljavno pozitivno število, na primer 0,2.";
    return;
  }
  stake = next;
  try {
    localStorage.setItem("solana-stake-v1", String(stake));
    $("#stakeMessage").textContent = "Vložek shranjen.";
  } catch {
    $("#stakeMessage").textContent = "Vložek velja v tej seji; shranjevanje ni uspelo.";
  }
  scheduleRemote();
  stakeLabels();
}
$("#stakeSave").onclick = () => setStake($("#stakeInput").value);
$("#stakeSmall").onclick = () => setStake("0.1");
$("#stakeLarge").onclick = () => setStake("0.2");
stakeLabels();
function openBoardGraph(id) {
  if (boardSelected !== id) $("#boardManualFeedback").textContent = "";
  boardSelected = id;
  renderBoardGraph();
  $("#boardGraphPanel").hidden = false;
}
$("#boardGraphClose").onclick = () => {
  boardSelected = null;
  $("#boardGraphPanel").hidden = true;
};
function manualBlock(c) {
  if (!fresh(c) || !Number.isFinite(c?.price) || c.price <= 0) return "Ročni vstop čaka na svežo pozitivno ceno.";
  if (trades.some((t) => !t.deletedAt && !t.interrupted && !t.closed && (t.id === c.id || t.token === c.token)))
    return "Ta kovanec že ima odprt demo posel.";
  if (trades.filter((t) => !t.practice && !t.deletedAt && !t.interrupted && !t.closed).length >= 5)
    return "Dosežena je meja petih odprtih poslov.";
  return "";
}
function manualEntry(c, feedback) {
  const blocked = manualBlock(c);
  if (blocked) {
    $(feedback).textContent = blocked;
    draw();
    return false;
  }
  if (!enter(c, signal(c), false)) return false;
  const just = trades.at(-1);
  $(feedback).textContent = "Ročni demo zabeležen za " + c.symbol + " · " + stake.toLocaleString("sl-SI") + " SOL. Vstop " + mcText(c, c.price) + " · " + tradeLevels(just, c).summary;
  draw();
  return true;
}
function renderManual(c, button, state) {
  $(button).textContent =
    "Ročni demo vstop · " + stake.toLocaleString("sl-SI", { maximumSignificantDigits: 21, useGrouping: false }) + " SOL";
  $(button).disabled = !!manualBlock(c);
  $(state).textContent =
    "Zdaj: " + (c ? mcText(c, c.price) + " (" + money(c.price) + ")" : "-") + " · " + (manualBlock(c) || "Na voljo · lastna odločitev, tudi brez signala.");
}
$("#boardManual").onclick = () => manualEntry(coins.get(boardSelected), "#boardManualFeedback");

function renderBoardGraph() {
  const c = coins.get(boardSelected);
  if (!c) return;
  const sig = signal(c);
  $("#boardGraphName").textContent = c.symbol + " · " + (Number.isFinite(c.mcap) ? "MC " + compact(c.mcap) : money(c.price)) + " · " + age(c.created);
  $("#boardGraphReason").textContent = "Bot: " + sig.name + " · " + sig.reason;
  $("#boardGraphNote").textContent =
    "Prejeto " +
    time(c.time) +
    " · os kaže market cap, cena na kovanec " +
    money(c.price) +
    ". To niso borzne sveče. Ravni pojasnjujejo ZADNJI izračun; ob novem posnetku se okno premakne. Sam dotik ravni ne zagotovi vstopa.";
  renderEntry(c, "#boardEntry");
  chart(c, "#boardChart", "#boardLegend");
  renderConditions(c, "#boardConditions");
  renderManual(c, "#boardManual", "#boardManualState");
}

// Primerjava: senčni posli, ki jih strežnik (edge funkcija collect, datoteka shadow.ts) piše v tabelo memecoin_shadow_trades.
// Brskalnik jih samo bere in sešteje. Pravila so v strežniku zamrznjena; tu se nič ne odloča.
const SHADOW_STRATEGIES = ["v1.0", "v1.2-filter", "v2.0", "v2.0-brez-holderjev", "v2.1-preboj"];
const SHADOW_LABEL = { "v1.0": "v1.0 (staro: +10 / -5)", "v1.2-filter": "v1.2 (v aplikaciji)", "v2.0": "v2.0", "v2.0-brez-holderjev": "v2.0 brez holderjev", "v2.1-preboj": "v2.1 preboj" };
const SHADOW_COLOR = { "v1.0": "#9fb0c8", "v1.2-filter": "#f0a6ff", "v2.0": "#62e4b3", "v2.0-brez-holderjev": "#ecbf69", "v2.1-preboj": "#6fa5ff" };
const SHADOW_START = Date.parse("2026-09-17T06:44:00Z"); // zagon senčnega testa (collect v3, prvi senčni posel)
const SHADOW_MIN_TRADES = 100,
  SHADOW_MIN_DAYS = 14,
  SHADOW_MIN_PF = 1.3,
  SHADOW_MIN_EXP = 2;
let shadowTrades = [],
  shadowError = "",
  shadowBusy = false;
// Negativne številke z navadnim minusom "-" (locale sicer vrne znak U+2212).
const plainMinus = (s) => s.replace(/\u2212/g, "-");
const pct1 = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + plainMinus(x.toLocaleString("sl-SI", { maximumFractionDigits: 1 })) + " %" : "-");
const sol4 = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + plainMinus(x.toLocaleString("sl-SI", { minimumFractionDigits: 4, maximumFractionDigits: 4 })) + " SOL" : "-");

async function loadShadow() {
  if (!db || shadowBusy) return;
  shadowBusy = true;
  try {
    const days = $("#cmpPeriod").value;
    let q = db
      .from("memecoin_shadow_trades")
      .select("id,strategy,pair,token,symbol,opened_at,entry_price,entry_mcap,size_sol,peak,half_sold,closed_at,exit_price,outcome,pnl_gross_pct,pnl_net_sol,entry_reason,status")
      .order("opened_at", { ascending: false })
      .limit(3000);
    if (days !== "all") q = q.gte("opened_at", new Date(Date.now() - Number(days) * 86400000).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    shadowTrades = data || [];
    shadowError = "";
  } catch (e) {
    shadowError = "Senčnih poslov ni bilo mogoče naložiti: " + (e?.message || e);
  } finally {
    shadowBusy = false;
  }
  renderComparison();
}

// Statistika ene strategije: dobitki, faktor dobička, pričakovanje, največji padec, krivulja (čas, kumulativni SOL).
function shadowStats(list) {
  const closed = list.filter((t) => t.status === "closed" && Number.isFinite(t.pnl_net_sol)).sort((a, b) => Date.parse(a.closed_at) - Date.parse(b.closed_at));
  const open = list.filter((t) => t.status === "open");
  const wins = closed.filter((t) => t.pnl_net_sol > 0),
    losses = closed.filter((t) => t.pnl_net_sol < 0);
  const sum = (arr, f) => arr.reduce((a, t) => a + f(t), 0);
  const netPct = (t) => (t.size_sol > 0 ? (100 * t.pnl_net_sol) / t.size_sol : 0);
  const winSol = sum(wins, (t) => t.pnl_net_sol),
    lossSol = -sum(losses, (t) => t.pnl_net_sol);
  let cum = 0,
    peak = 0,
    dd = 0;
  const curve = [];
  for (const t of closed) {
    cum += t.pnl_net_sol;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    curve.push({ t: Date.parse(t.closed_at), v: cum });
  }
  return {
    closed,
    open,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : null,
    avgWin: wins.length ? sum(wins, netPct) / wins.length : null,
    avgLoss: losses.length ? sum(losses, netPct) / losses.length : null,
    pf: lossSol > 0 ? winSol / lossSol : winSol > 0 ? Infinity : null,
    expectancy: closed.length ? sum(closed, netPct) / closed.length : null,
    net: cum,
    maxDD: dd,
    rug: closed.filter((t) => (t.outcome || "").startsWith("Rug")).length,
    gap: closed.filter((t) => (t.outcome || "").startsWith("Vrzel")).length,
    curve,
  };
}

function renderComparison() {
  if ($("#comparison").hidden) return;
  const daysRun = (Date.now() - SHADOW_START) / 86400000;
  const statusEl = $("#cmpStatus");
  const total = shadowTrades.length,
    openNow = shadowTrades.filter((t) => t.status === "open").length;
  if (shadowError) {
    statusEl.className = "notice stopped";
    statusEl.textContent = shadowError;
  } else if (!total) {
    statusEl.className = "notice";
    statusEl.textContent =
      "Senčni test teče od 17. 9. 2026 (dan " +
      Math.max(1, Math.ceil(daysRun)) +
      " od " +
      SHADOW_MIN_DAYS +
      "). Strežnik še ni odprl nobenega senčnega posla v izbranem obdobju: posel nastane šele, ko kak kovanec izpolni pogoje pravil (v2 potrebuje vsaj 15 minut posnetkov).";
  } else {
    statusEl.className = "notice connected";
    statusEl.textContent =
      "Senčni test teče od 17. 9. 2026 · dan " +
      Math.max(1, Math.ceil(daysRun)) +
      " od " +
      SHADOW_MIN_DAYS +
      " · " +
      total +
      " senčnih poslov v obdobju, " +
      openNow +
      " trenutno odprtih · osvežitev na 60 s.";
  }
  const stats = new Map(SHADOW_STRATEGIES.map((s) => [s, shadowStats(shadowTrades.filter((t) => t.strategy === s))]));
  let lead = null;
  for (const [s, st] of stats) if (st.closed.length && (!lead || st.net > stats.get(lead).net)) lead = s;
  const rows = $("#cmpRows");
  rows.replaceChildren();
  for (const s of SHADOW_STRATEGIES) {
    const st = stats.get(s);
    const tr = document.createElement("tr");
    if (s === lead && st.net > 0) tr.className = "lead";
    const enough = st.closed.length >= SHADOW_MIN_TRADES || daysRun >= SHADOW_MIN_DAYS;
    const pfOk = st.pf !== null && st.pf > SHADOW_MIN_PF,
      expOk = st.expectancy !== null && st.expectancy > SHADOW_MIN_EXP;
    const ok = enough && pfOk && expOk;
    const crit = document.createElement("span");
    crit.className = "crit" + (ok ? " ok" : "");
    crit.textContent = ok
      ? "✓ izpolnjeni"
      : !st.closed.length
        ? "○ ni poslov"
        : !enough
          ? "○ " + st.closed.length + "/" + SHADOW_MIN_TRADES + " poslov" + (pfOk && expOk ? " (vmes v redu)" : "")
          : "✗ " + [!pfOk ? "faktor" : "", !expOk ? "pričakovanje" : ""].filter(Boolean).join(" in ") + " pod ciljem";
    const cells = [
      SHADOW_LABEL[s],
      st.closed.length + " / " + st.open.length,
      st.winRate === null ? "-" : (st.winRate * 100).toLocaleString("sl-SI", { maximumFractionDigits: 0 }) + " % (" + st.wins + ")",
      pct1(st.avgWin),
      pct1(st.avgLoss),
      st.pf === null ? "-" : st.pf === Infinity ? "∞" : st.pf.toLocaleString("sl-SI", { maximumFractionDigits: 2 }),
      pct1(st.expectancy),
      sol4(st.net),
      st.closed.length ? "-" + st.maxDD.toLocaleString("sl-SI", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + " SOL" : "-",
      st.rug + " / " + st.gap,
      crit,
    ];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      if (c instanceof Node) td.append(c);
      else td.textContent = c;
      if (i === 7) td.className = tone(st.net);
      if (i === 6) td.className = st.expectancy === null ? "" : tone(st.expectancy);
      if (i === 0) td.style.color = SHADOW_COLOR[s];
      tr.append(td);
    });
    rows.append(tr);
  }
  // Krivulja: x je čas, y kumulativni neto SOL; vsaka strategija svoja črta z isto lestvico.
  const svg = $("#cmpCurve");
  svg.replaceChildren();
  const legend = $("#cmpLegend");
  legend.replaceChildren();
  const all = [...stats.values()].flatMap((st) => st.curve);
  if (!all.length) {
    $("#cmpCurveNote").textContent = "Krivulje se pojavijo po prvih zaključenih senčnih poslih.";
  } else {
    const t0 = Math.min(...all.map((p) => p.t)),
      t1 = Math.max(Date.now(), ...all.map((p) => p.t)),
      span = Math.max(1, t1 - t0);
    const values = [0, ...all.map((p) => p.v)],
      lo = Math.min(...values),
      hi = Math.max(...values),
      range = hi - lo || 0.001;
    const x = (t) => 25 + ((t - t0) / span) * 650,
      y = (v) => 195 - ((v - lo) / range) * 160;
    for (const v of [lo, 0, hi]) {
      if (v !== 0 && Math.abs(v) < range * 0.12) continue; // oznaka bi se prekrila z ničlo
      if (v === 0 && (lo > 0 || hi < 0)) continue;
      const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
      for (const [k, val] of Object.entries({ x1: 25, x2: 675, y1: y(v), y2: y(v), stroke: "#33465e", "stroke-dasharray": "4 5" })) grid.setAttribute(k, val);
      svg.append(grid);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", "28");
      label.setAttribute("y", Math.max(16, y(v) - 6));
      label.setAttribute("fill", "#a0b5d1");
      label.setAttribute("font-size", "13");
      label.textContent = v.toFixed(4) + " SOL";
      svg.append(label);
    }
    for (const s of SHADOW_STRATEGIES) {
      const st = stats.get(s);
      const pts = [{ t: t0, v: 0 }, ...st.curve];
      if (st.curve.length) pts.push({ t: t1, v: st.net });
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("points", pts.map((p) => `${x(p.t)},${y(p.v)}`).join(" "));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", SHADOW_COLOR[s]);
      line.setAttribute("stroke-width", s === lead ? "3" : "2");
      if (!st.curve.length) line.setAttribute("stroke-dasharray", "3 6");
      svg.append(line);
      const item = document.createElement("span");
      const i = document.createElement("i");
      i.style.borderColor = SHADOW_COLOR[s];
      item.append(i, SHADOW_LABEL[s] + " · " + sol4(st.net) + (st.curve.length ? "" : " (še brez zaključkov)"));
      legend.append(item);
    }
    $("#cmpCurveNote").textContent =
      "Od " + time(t0) + " do zdaj · vsak lom je zaključen senčni posel · vse črte imajo isto lestvico, zato jih lahko primerjaš neposredno.";
  }
  // Zadnji senčni posli (filter po pravilih), največ 40.
  const filter = $("#cmpFilter").value;
  const body = $("#cmpTrades");
  body.replaceChildren();
  const listed = shadowTrades.filter((t) => filter === "all" || t.strategy === filter).slice(0, 40);
  for (const t of listed) {
    const tr = document.createElement("tr");
    const peakPct = t.entry_price > 0 && Number.isFinite(t.peak) ? (100 * t.peak) / t.entry_price - 100 : null;
    const netPct = t.status === "closed" && t.size_sol > 0 ? (100 * t.pnl_net_sol) / t.size_sol : null;
    const cells = [
      time(t.opened_at),
      SHADOW_LABEL[t.strategy] || t.strategy,
      t.symbol || t.token?.slice(0, 6) || "?",
      Number.isFinite(t.entry_mcap) ? compact(t.entry_mcap) : money(t.entry_price),
      peakPct === null ? "-" : "+" + peakPct.toLocaleString("sl-SI", { maximumFractionDigits: 0 }) + " %" + (t.half_sold ? " · pol prodano" : ""),
      t.status === "closed" ? (t.outcome || "Zaključeno") + " · " + time(t.closed_at) : "ODPRT · zadnji vzorec " + new Date(t.last_observed || t.opened_at).toLocaleTimeString("sl-SI"),
      t.status === "closed" ? sol4(t.pnl_net_sol) + " (" + pct1(netPct) + ")" : "-",
    ];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      if (i === 1) td.style.color = SHADOW_COLOR[t.strategy] || "";
      if (i === 6 && netPct !== null) td.className = tone(netPct);
      if (i === 6 || i === 3) td.style.whiteSpace = "nowrap";
      tr.append(td);
    });
    if (t.entry_reason) tr.title = "Razlog vstopa: " + t.entry_reason;
    body.append(tr);
  }
  $("#cmpTradesNote").textContent = listed.length
    ? "Prikazanih " + listed.length + " od " + shadowTrades.filter((t) => filter === "all" || t.strategy === filter).length + " · Vstop MC = market cap ob vstopu · Vrh = najvišja cena med poslom glede na vstop · s kazalcem nad vrstico vidiš razlog vstopa."
    : "V izbranem obdobju ni senčnih poslov za ta filter.";
}
$("#cmpPeriod").onchange = loadShadow;
$("#cmpFilter").onchange = renderComparison;


// Odprti demo posli: vrsta kartic z grafi na vrhu zavihka Kaj program spremlja.
// Vsaka kartica: rezultat v živo, graf s črtami VSTOPIL / CILJ / MEJA, razdalja do cilja in meje, ročni izstop.
let confirmClose = null,
  confirmCloseTimer = null;
function showOpenTrades() {
  navigate("watching", "live");
  $("#openRow").scrollIntoView({ behavior: "smooth", block: "start" });
}
function manualClose(t, feedbackEl) {
  const c = coins.get(t.id);
  if (!c || !(c.price > 0)) {
    feedbackEl.textContent = "Ni znane cene za ta kovanec, izstop ni mogoč.";
    return;
  }
  const stale = !fresh(c);
  closeAt(t, c.price, c.time, stale ? "Ročni izstop (po zadnji znani ceni)" : "Ročni izstop");
  confirmClose = null;
  $("#feedback").textContent = "Ročni izstop zabeležen za " + t.symbol + " po " + mcText(c, c.price) + " · neto " + signed(t.pnl) + " SOL.";
  draw();
}
function renderOpenTrades() {
  const row = $("#openRow"),
    host = $("#openCards");
  if (!row || !host) return;
  const open = trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).sort((a, b) => b.opened - a.opened);
  row.hidden = !open.length;
  if (!open.length) {
    host.replaceChildren();
    return;
  }
  if ($("#watching").hidden) return; // ne rišemo skritih grafov
  $("#openRowTitle").textContent = "Odprti demo posli";
  $("#openRowCount").textContent = open.length;
  host.replaceChildren();
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  for (const t of open) {
    const c = coins.get(t.id);
    const price = c?.price,
      live = c && fresh(c) && price > 0,
      pnl = c && price > 0 ? markToMarket(t, price) : null,
      pct = pnl === null ? null : (pnl / tradeSize(t)) * 100,
      minutes = Math.max(0, Math.round((Date.now() - t.opened) / 60000)),
      dur = minutes < 60 ? minutes + " min" : Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
    const card = el("article", "openCard " + (pnl === null ? "flat" : pnl >= 0 ? "up" : "down"));
    // glava: ime + oznake levo, rezultat desno
    const head = el("div", "ocHead");
    const name = el("div", "ocName");
    const h = el("h3", "", t.symbol);
    const pill = el("span", "pill " + (t.automatic ? "auto" : "manual"), t.automatic ? "SAMODEJNO" : "ROČNO");
    const prof = el("span", "pill profile", t.plan ? (PROFILES[t.profile]?.name || t.profile).toUpperCase() : "FIKSNO +10 / -5");
    const title = el("div", "ocTitle");
    title.append(h, pill, prof);
    name.append(title, el("small", "", t.reason.replace("Lastna odločitev · ", "") + " · vstop " + new Date(t.opened).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" }) + " · odprt " + dur));
    const res = el("div", "ocPnl " + (pnl === null ? "neutral" : tone(pnl)));
    res.append(el("strong", "", pnl === null ? "brez cene" : pct1(pct)), el("small", "", pnl === null ? "čakam na posnetek" : sol4(pnl) + " · vložek " + tradeSize(t).toLocaleString("sl-SI") + " SOL"));
    head.append(name, res);
    card.append(head);
    // štiri ploščice: MC zdaj, vstop, cilj, meja
    const stats = el("div", "ocStats");
    const tile = (cls, label, value, note) => {
      const d = el("div", "tile " + cls);
      d.append(el("small", "", label), el("strong", "", value));
      if (note) d.append(el("em", "", note));
      return d;
    };
    const L = tradeLevels(t, c);
    // desni rob traku: fiksni cilj / raven delne prodaje / vrh (ko meja sledi vrhu)
    const rightRaw = L.kind === "fixed" ? t.target : t.plan.halfAt && !t.halfSold ? t.target : Math.max(t.peak || t.entry, price || 0);
    const right = Number.isFinite(rightRaw) && rightRaw > t.stop * 1.002 ? rightRaw : t.stop * 1.05;
    const toTarget = price > 0 && L.kind === "fixed" ? (t.target / price - 1) * 100 : null,
      toStop = price > 0 ? (t.stop / price - 1) * 100 : null,
      peakPct = t.plan && t.peak > 0 ? (t.peak / t.entry - 1) * 100 : null;
    const targetNote =
      L.kind === "fixed"
        ? toTarget === null
          ? ""
          : "še " + pct1(toTarget)
        : !t.plan.halfAt
          ? "najvišje " + pct1(peakPct) + " · sled " + Math.round(t.plan.trail * 100) + " %"
          : t.halfSold
            ? "zaklenjeno " + pct1((t.halfPrice / t.entry - 1) * 100)
            : price > 0
              ? "še " + pct1((t.target / price - 1) * 100)
              : "";
    stats.append(
      tile("now", "MC zdaj", c && Number.isFinite(c.mcap) ? compact(c.mcap) : "-", live ? "posnetek " + new Date(c.time).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : c ? "zastarelo · " + new Date(c.time).toLocaleTimeString("sl-SI") : "ni podatkov"),
      tile("entry", "Vstop", Number.isFinite(t.entryMcap) ? compact(t.entryMcap) : money(t.entry), money(t.entry) + " / kovanec"),
      tile("target", L.targetLabel, c && Number.isFinite(L.targetValue) ? mcText(c, L.targetValue).replace("MC ", "") : money(L.targetValue), targetNote),
      tile("stop", L.stopLabel + (L.trailing ? " (sledi vrhu)" : ""), c ? mcText(c, t.stop).replace("MC ", "") : money(t.stop), toStop === null ? "" : pct1(toStop) + " do meje"),
    );
    card.append(stats);
    // trak: kje je cena med mejo (levo) in ciljem / vrhom (desno)
    const track = el("div", "ocTrack");
    const span = right - t.stop || 1;
    const pos = (v) => Math.max(0, Math.min(100, ((v - t.stop) / span) * 100));
    const entryOnTrack = t.entry >= t.stop && t.entry <= right;
    const entryMark = el("span", "trackEntry");
    entryMark.style.left = pos(t.entry) + "%";
    entryMark.title = "Vstop";
    if (entryOnTrack) track.append(entryMark);
    if (price > 0) {
      const now = el("span", "trackNow " + (pnl >= 0 ? "positive" : "negative"));
      now.style.left = pos(price) + "%";
      now.title = "Trenutna cena";
      track.append(now);
    }
    const labels = el("div", "trackLabels");
    const lEntry = el("span", "lEntry", "VSTOP");
    lEntry.style.left = pos(t.entry) + "%";
    labels.append(el("span", "negative lStop", L.kind === "fixed" ? "MEJA -5 %" : L.trailing ? "SLEDILNA MEJA" : "MEJA -" + Math.round(t.plan.hardStop * 100) + " %"));
    if (entryOnTrack) labels.append(lEntry);
    labels.append(el("span", "positive lTarget", L.kind === "fixed" ? "CILJ +10 %" : t.plan.halfAt && !t.halfSold ? "POL +" + Math.round(t.plan.halfAt * 100) + " %" : "VRH"));
    const trackWrap = el("div", "ocTrackWrap");
    trackWrap.append(track, labels);
    card.append(trackWrap);
    // graf
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "chart");
    svg.setAttribute("viewBox", "0 0 700 230");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Cena posla " + t.symbol + " z vstopom, ciljem in mejo izgube");
    card.append(svg);
    const legend = el("div", "legend");
    card.append(legend);
    if (c) chart(c, svg, legend, { from: t.opened, simple: true });
    else {
      const ns = document.createElementNS("http://www.w3.org/2000/svg", "text");
      ns.setAttribute("x", 25);
      ns.setAttribute("y", 110);
      ns.setAttribute("fill", "#a7b7ca");
      ns.textContent = "Strežnik za ta par še nima posnetkov v zadnji uri.";
      svg.append(ns);
    }
    // noga: gumbi
    const foot = el("div", "ocFoot");
    const actions = el("div", "actions");
    const closeBtn = el("button", confirmClose === t.key ? "danger" : "", confirmClose === t.key ? "Potrdi izstop po " + (c ? mcText(c, price) : "zadnji ceni") : "Zapri zdaj");
    closeBtn.disabled = !c || !(price > 0);
    const fb = el("small", "muted");
    closeBtn.onclick = () => {
      if (confirmClose === t.key) {
        clearTimeout(confirmCloseTimer);
        manualClose(t, fb);
        return;
      }
      confirmClose = t.key;
      clearTimeout(confirmCloseTimer);
      confirmCloseTimer = setTimeout(() => {
        confirmClose = null;
        renderOpenTrades();
      }, 8000);
      renderOpenTrades();
    };
    const link = el("a", "", "DEX Screener");
    link.href = "https://dexscreener.com/solana/" + t.id;
    link.target = "_blank";
    link.rel = "noreferrer";
    const copy = el("button", "ghost", "Kopiraj CA");
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(t.token);
        copy.textContent = "Kopirano";
        setTimeout(() => (copy.textContent = "Kopiraj CA"), 1500);
      } catch {
        fb.textContent = "Kopiranje ni uspelo: " + t.token;
      }
    };
    actions.append(closeBtn, link, copy);
    foot.append(actions, fb);
    card.append(foot);
    host.append(card);
  }
}

// Profil izstopa: izbira v Živem izboru z razlago, shranjeno na profil (memecoin_state.profile) in lokalno.
function renderProfile() {
  const p = PROFILES[profile] || PROFILES[DEFAULT_PROFILE];
  for (const b of document.querySelectorAll("#profileButtons button")) {
    const on = b.dataset.profile === p.key;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  }
  $("#rulesSummary").textContent =
    "Največ 5 odprtih poslov, en na kovanec. Vstop: vzorci v1.0 (Odboj, Višje dno, Preboj/retest) + filter v1.2 (starost 30 do 90 min, v zadnji uri ni v minusu, MC 20K do 300K). Izstop za nove posle: profil " +
    p.name +
    ". Odprti posli obdržijo profil, s katerim so bili odprti.";
  const box = $("#profileInfo");
  if (!box) return;
  box.replaceChildren();
  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const left = mk("div");
  const h = mk("h4", "", p.name + " ");
  h.append(mk("span", "pill", p.tagline));
  left.append(h);
  const how = mk("p");
  how.append(mk("b", "", "Kako deluje: "), p.how);
  const who = mk("p");
  who.append(mk("b", "", "Za koga: "), p.who);
  left.append(how, who);
  const grid = mk("div", "pStats");
  for (const [label, value, cls] of [
    ["Dobitni posli", p.stats.win + " %", ""],
    ["Povp. dobiček", "+" + p.stats.avgWin + " %", "positive"],
    ["Povp. izguba", p.stats.avgLoss + " %", "negative"],
    ["Na posel", pct1(p.stats.perTrade), p.stats.perTrade > 0 ? "positive" : "negative"],
  ]) {
    const d = mk("div");
    d.append(mk("small", "", label), mk("strong", cls, value));
    grid.append(d);
  }
  left.append(grid);
  left.append(mk("p", "note", "Številke: 123 tvojih demo poslov (16. do 17. 9. 2026) z istimi vstopi, odigrani s tem profilom, stroški 1 % zdrsa + 0,5 % provizije na stran. En dan podatkov, zato so optimistične; senčni test jih bo preveril."));
  const right = mk("div");
  right.append(mk("h4", "", "Vsi trije na istih poslih"));
  const table = mk("table");
  const thead = mk("thead");
  const hr = mk("tr");
  for (const t of ["Profil", "Dobitni", "Povp. +", "Povp. -", "Na posel"]) hr.append(mk("th", "", t));
  thead.append(hr);
  table.append(thead);
  const tb = mk("tbody");
  for (const q of Object.values(PROFILES)) {
    const tr = mk("tr", q.key === p.key ? "current" : "");
    tr.append(mk("td", "", q.name), mk("td", "", q.stats.win + " %"), mk("td", "positive", "+" + q.stats.avgWin + " %"), mk("td", "negative", q.stats.avgLoss + " %"), mk("td", q.stats.perTrade > 0 ? "positive" : "negative", pct1(q.stats.perTrade)));
    tb.append(tr);
  }
  table.append(tb);
  right.append(table);
  right.append(mk("p", "note", "Za primerjavo: dosedanji fiksni cilj +10 % / meja -5 % je na istih poslih dal 42 % dobitnih, +17 % / -13 %, -0,5 % na posel. Meja -5 % je v resnici izstopila povprečno pri -11 %, ker cena med posnetkoma preskoči."));
  right.append(mk("p", "note", "Vstopi so pri vseh profilih enaki. Profil se uporabi ob vstopu; že odprti posli se ne spremenijo. Senčni test na strežniku teče ločeno in se s to izbiro ne spremeni."));
  box.append(left, right);
}
for (const b of document.querySelectorAll("#profileButtons button"))
  b.onclick = () => {
    if (!PROFILES[b.dataset.profile]) return;
    profile = b.dataset.profile;
    try {
      localStorage.setItem("solana-profile-v1", profile);
    } catch {}
    renderProfile();
    $("#stakeMessage").textContent = "Profil " + PROFILES[profile].name + " velja za nove demo posle (shranjeno na profil).";
    scheduleRemote();
    draw();
  };
renderProfile();
