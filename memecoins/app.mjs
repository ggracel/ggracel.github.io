// foqs.si/memecoins: posnetke zbira strežnik (Supabase cron vsakih 30 s -> tabela memecoin_snapshots), tudi ko je stran zaprta.
// Brskalnik ob odprtju naloži zadnjo uro posnetkov, potem bere samo nove. Pravila v1.0 tečejo v brskalniku.
const HISTORY_MIN = 60;
// Tečaj SOL za prikaz v USD: sproti z Jupitra (funkcija cene ga zapiše v memecoin_prices_now), sicer fiksen tečaj z 22. 9. 2026.
const SOL_MINT = "So11111111111111111111111111111111111111112",
  SOL_USD_FIXED = 117.4;
let solUsd = null;
let lastSnapshotT = 0,
  primed = false,
  noData = false;
import { pattern, result, overview, netReturnPercent, tradeSize, parseStake, entryPoint, PROFILES, DEFAULT_PROFILE, exitPlan, stepExit, markToMarket } from "./engine.mjs?v=15";
// Konstante senčnega testa so tu zgoraj, ker jih berejo funkcije, ki se kličejo že ob nalaganju modula (TDZ).
// Primerjava: senčni posli, ki jih strežnik (edge funkcija collect, datoteka shadow.ts) piše v tabelo memecoin_shadow_trades.
// Brskalnik jih samo bere in sešteje. Pravila so v strežniku zamrznjena; tu se nič ne odloča.
const SHADOW_STRATEGIES = ["v1.0", "v1.0-cisto", "v1.0-jup", "v1.2-filter", "v1.2-cilj10", "v1.2-cilj50", "v1.2-cilj70", "v1.2-cilj100", "v1.2-sled7", "v1.2-srednje", "v2.2-dip", "v3-mirno", "v3-kontrola", "v2.0", "v2.0-brez-holderjev", "v2.1-preboj", "v2.2-dip-siroko"];
// Ustavljene: ne odpirajo novih poslov, zgodovina in odprti posli ostanejo (glej shadow.ts PAUSED). Ta seznam mora ustrezati shadow.ts.
const SHADOW_PAUSED = { "v2.0": "20. 9.", "v2.0-brez-holderjev": "19. 9.", "v2.1-preboj": "20. 9.", "v2.2-dip-siroko": "20. 9.", "v1.2-srednje": "20. 9." };
const SHADOW_LABEL = { "v1.0": "v1.0 +10/-5", "v1.0-cisto": "v1.0 čisto (brez sumljivih posnetkov)", "v1.0-jup": "v1.0 Jupiter (cene na 6 s)", "v1.2-filter": "v1.2 staro Srednje (pol +25, sled 20)", "v1.2-cilj10": "v1.2 cilj +10 / meja -5", "v1.2-cilj50": "v1.2 Srednje + cilj +50 (profil Srednje)", "v1.2-cilj70": "v1.2 Srednje + cilj +70", "v1.2-cilj100": "v1.2 Srednje + cilj +100", "v1.2-sled7": "v1.2 Srednje, sled 7 %", "v1.2-srednje": "v1.2 Srednje brez cilja (pol +20, sled 15)", "v2.2-dip": "v2.2 dip s kupci", "v3-mirno": "v3 mirno", "v3-kontrola": "v3 kontrola (naključni vstop)", "v2.0": "v2.0", "v2.0-brez-holderjev": "v2.0 brez holderjev", "v2.1-preboj": "v2.1 preboj", "v2.2-dip-siroko": "v2.2 dip s kupci, široko" };
const SHADOW_COLOR = { "v1.0": "#9fb0c8", "v1.0-cisto": "#dbe6f5", "v1.0-jup": "#a8ff60", "v1.2-filter": "#f0a6ff", "v1.2-cilj10": "#ffb3c7", "v1.2-cilj50": "#ffd166", "v1.2-cilj70": "#ffa94d", "v1.2-cilj100": "#ff6b6b", "v1.2-sled7": "#b197fc", "v1.2-srednje": "#c98cff", "v2.2-dip": "#46bec5", "v3-mirno": "#74c0fc", "v3-kontrola": "#adb5bd", "v2.0": "#62e4b3", "v2.0-brez-holderjev": "#ecbf69", "v2.1-preboj": "#6fa5ff", "v2.2-dip-siroko": "#ff9f7a" };
// Kaj vsak set pravil gleda za vstop in kako izstopi. Besedilo mora ustrezati shadow.ts; ob spremembi pravil popravi oboje.
const SHADOW_RULES = {
  "v1.0": {
    vstop: [
      "Kovanec: likvidnost vsaj 10.000 $ in promet v zadnjih 5 min nad 0.",
      "Vzorec na zadnjih 16 posnetkih, dovolj je eden od treh.",
      "Odboj od podpore: cena se dotakne dna prvih desetih posnetkov (±2 %) in zraste vsaj 1,5 %.",
      "Višje dno: dve lokalni dni, drugo vsaj 1 % višje, nato rast vsaj 1 %.",
      "Preboj in retest: preboj starega vrha za 2,5 %, vrnitev nanj in rast 1 %.",
    ],
    izstop: [
      "Cilj: +10 %, proda vse naenkrat.",
      "Meja izgube: -5 %.",
      "Brez sledilne meje, brez časovne meje, brez rug izhoda.",
      "Največ 5 odprtih poslov, en na kovanec.",
    ],
  },
  "v1.2-filter": {
    vstop: [
      "Isti trije vzorci kot v1.0 (Odboj, Višje dno, Preboj in retest).",
      "Filter: par star 30 do 90 min.",
      "Filter: v zadnji uri ni v minusu.",
      "Filter: market cap med 20K in 300K $.",
      "Filter: likvidnost vsaj 10.000 $ in promet nad 0.",
    ],
    izstop: [
      "Pri +25 % proda polovico in premakne mejo na vstopno ceno.",
      "Nato sledilna meja 20 % pod najvišjo doseženo ceno.",
      "Trda meja izgube: -12 %.",
      "Brez časovne meje in brez rug izhoda (tako kot v aplikaciji).",
      "Največ 5 odprtih poslov, en na kovanec.",
    ],
  },
  "v2.0": {
    vstop: [
      "Kovanec: starost para 5 do 90 min, MC 8K do 80K $.",
      "Kovanec: likvidnost vsaj 10.000 $ in vsaj 15 % market capa.",
      "Kovanec: promet v 5 min vsaj 20 % likvidnosti, vsaj 15 nakupov, nakupi/prodaje vsaj 1,2, v 1 h največ +150 %.",
      "Run: vrh zadnjih 15 min vsaj +40 % nad dnom pred njim.",
      "Dip: cena je padla 35 do 55 % pod ta vrh.",
      "Dno drži: ni nastalo v zadnjih 2 posnetkih, ni starejše od 5 min in ni prebito.",
      "Odboj: cena od 4 do 12 % nad dnom in zadnji posnetek višji od prejšnjega.",
      "Imetniki: top 10 največ 30 % zaloge, nihče nad 8 %, brez bundla.",
    ],
    izstop: [
      "Pri +25 % proda polovico in premakne mejo na vstopno ceno.",
      "Nato sledilna meja 20 % pod najvišjo doseženo ceno.",
      "Trda meja izgube: -12 %.",
      "Časovna meja: če po 15 min ni bilo vsaj +8 %, zapre.",
      "Rug izhod: likvidnost pade za 25 % ali prodaje presežejo dvakratnik nakupov.",
      "Največ 3 odprti posli, 30 min brez ponovnega vstopa v isti kovanec, dnevna zavora.",
    ],
  },
  "v2.1-preboj": {
    vstop: [
      "Isti izbor kovancev kot v2.0.",
      "Preboj: cena preseže vrh zadnjih 15 min za 3 do 10 %.",
      "Nakupi/prodaje v 5 min vsaj 1,5.",
      "Promet v 5 min vsaj 30 % likvidnosti.",
      "Imetniki: isto preverjanje kot pri v2.0.",
    ],
    izstop: ["Enak kot v2.0: pol pri +25 %, sledilna 20 %, trda meja -12 %, časovna meja 15 min, rug izhod."],
  },
  "v2.2-dip": {
    vstop: [
      "Kovanec: MC 8K do 80K $, likvidnost vsaj 10.000 $, v 1 h največ +150 %. Brez omejitve starosti.",
      "Kupci morajo prevladovati: nakupi/prodaje v 5 min vsaj 2,0 in vsaj 10 nakupov. To je pogoj, ki v meritvah nosi vso prednost.",
      "Run: vrh zadnjih 15 min vsaj +40 % nad dnom pred njim.",
      "Dip: cena je padla 35 do 55 % pod ta vrh.",
      "Dno drži: ni nastalo v zadnjih 2 posnetkih, ni starejše od 5 min in ni prebito.",
      "Odboj: cena vsaj 4 % nad dnom, brez zgornje meje.",
      "Cena mora ostati pod 65 % vrha, sicer to ni več dip cona.",
      "Brez preverjanja imetnikov (pri v2.0 ni zavrnilo nobenega kovanca).",
    ],
    izstop: ["Enak kot v2.0, da je primerjava vstopov poštena: pol pri +25 %, sledilna 20 %, trda meja -12 %, časovna meja 15 min, rug izhod."],
  },
};
SHADOW_RULES["v2.0-brez-holderjev"] = { vstop: SHADOW_RULES["v2.0"].vstop.filter((x) => !x.startsWith("Imetniki")), izstop: SHADOW_RULES["v2.0"].izstop };
// 20. 9. 2026: dve varianti v1.2 z istim vstopom in stroški, razlika je samo izstop (cilj research 20. 9.).
SHADOW_RULES["v1.2-srednje"] = {
  vstop: SHADOW_RULES["v1.2-filter"].vstop,
  izstop: [
    "Pri +20 % proda polovico in premakne mejo na vstopno ceno.",
    "Nato sledilna meja 15 % pod najvišjo doseženo ceno. Brez cilja.",
    "Trda meja izgube: -12 %.",
    "Brez časovne meje in brez rug izhoda.",
    "Največ 5 odprtih poslov, en na kovanec.",
  ],
};
SHADOW_RULES["v1.2-cilj50"] = {
  vstop: SHADOW_RULES["v1.2-filter"].vstop,
  izstop: [
    "Pri +20 % proda polovico in premakne mejo na vstopno ceno.",
    "Cilj: pri +50 % proda vse preostalo.",
    "Do cilja sledilna meja 15 % pod najvišjo doseženo ceno.",
    "Trda meja izgube: -12 %.",
    "Brez časovne meje in brez rug izhoda. To je natanko profil Srednje v aplikaciji od 20. 9.",
    "Največ 5 odprtih poslov, en na kovanec.",
  ],
};
SHADOW_RULES["v2.2-dip-siroko"] = { vstop: SHADOW_RULES["v2.2-dip"].vstop.map((x) => (x.startsWith("Kovanec:") ? "Kovanec: likvidnost vsaj 10.000 $, v 1 h največ +150 %. Brez omejitve starosti IN BREZ omejitve market capa." : x)), izstop: SHADOW_RULES["v2.2-dip"].izstop };
// 20. 9. 2026: lestvica ciljev na vstopu v1.2 in družina v3 (vstop, ne izstop).
SHADOW_RULES["v1.2-cilj10"] = {
  vstop: SHADOW_RULES["v1.2-filter"].vstop,
  izstop: ["Proda vse pri +10 %.", "Meja izgube -5 %.", "Brez delne prodaje in brez sledi (geometrija v1.0 in profila Hitri).", "Največ 5 odprtih poslov, en na kovanec."],
};
SHADOW_RULES["v1.2-cilj70"] = { vstop: SHADOW_RULES["v1.2-filter"].vstop, izstop: SHADOW_RULES["v1.2-cilj50"].izstop.map((x) => x.replace("+50 %", "+70 %").replace(" To je natanko profil Srednje v aplikaciji od 20. 9.", "")) };
SHADOW_RULES["v1.2-cilj100"] = { vstop: SHADOW_RULES["v1.2-filter"].vstop, izstop: SHADOW_RULES["v1.2-cilj50"].izstop.map((x) => x.replace("+50 %", "+100 %").replace(" To je natanko profil Srednje v aplikaciji od 20. 9.", "")) };
SHADOW_RULES["v1.2-sled7"] = { vstop: SHADOW_RULES["v1.2-filter"].vstop, izstop: SHADOW_RULES["v1.2-cilj50"].izstop.map((x) => x.replace("15 %", "7 %").replace(" To je natanko profil Srednje v aplikaciji od 20. 9.", "")) };
SHADOW_RULES["v3-mirno"] = {
  vstop: ["Kovanec: likvidnost vsaj 20.000 $, vsaj 5 nakupov v 5 min.", "Premik cene v zadnjih 5 min med -3 in +3 %.", "Premik v zadnji uri med -20 in +30 %."],
  izstop: ["Cilj +25 %, proda vse.", "Trda meja -12 %.", "Časovna meja 120 min.", "Največ 5 odprtih poslov, en na kovanec, 30 min premora po zaprtju."],
};
SHADOW_RULES["v3-kontrola"] = {
  vstop: ["Naključni vstop v kovanec z likvidnostjo vsaj 10.000 $ in prometom nad 0.", "Ni strategija, ampak merilo: pravilo, ki ne premaga kontrole, ne zna ničesar."],
  izstop: SHADOW_RULES["v3-mirno"].izstop,
};
// 21. 9. 2026: čisti podatki in Jupiter. Isti vstop in izstop kot v1.0, razlika je samo v podatkih.
SHADOW_RULES["v1.0-cisto"] = {
  vstop: [...SHADOW_RULES["v1.0"].vstop, "Brez vstopa na sumljivem posnetku: cena z DEX Screenerja se od Jupitrove razlikuje za več kot polovico (brez Jupitra: skok za več kot 3-krat).", "Par z vsaj dvema sumljivima posnetkoma v zadnjih 22 min je izpuščen."],
  izstop: [...SHADOW_RULES["v1.0"].izstop, "Na sumljivem posnetku ne izstopi, počaka na naslednjega."],
};
SHADOW_RULES["v1.0-jup"] = {
  vstop: [...SHADOW_RULES["v1.0-cisto"].vstop, "Vstopna cena je sveža Jupitrova cena. Brez nje ni vstopa."],
  izstop: ["Cilj +10 % in meja -5 %, preverjeno na vsaki Jupitrovi ceni (beremo jih na 6 s, ne na 30).", "Če Jupiter za kovanec ne odgovarja, izstopi po DEX Screenerju, a samo na nesumljivem posnetku.", "Največ 5 odprtih poslov, en na kovanec."],
};
// Katere vrstice v Laboratoriju so raztegnjene; preživi samodejni izris na 60 s.
const shadowOpen = new Set();
const SHADOW_START = Date.parse("2026-09-17T06:44:00Z"); // zagon senčnega testa (collect v3, prvi senčni posel)
const SHADOW_MIN_TRADES = 100,
  SHADOW_MIN_DAYS = 14,
  SHADOW_MIN_PF = 1.3,
  SHADOW_MIN_EXP = 2,
  // Najmanj toliko zaključenih poslov, preden sploh izrečemo sodbo "pod ciljem".
  // Brez tega bi na dan 14 vsa pravila padla, tudi tista s komaj nekaj posli.
  SHADOW_MIN_JUDGE = 30,
  // Koliko dni prej opozorimo, da se bliža konec testa.
  SHADOW_WARN_DAYS = 3;
const $ = (s) => document.querySelector(s),
  money = (x) =>
    Number.isFinite(x)
      ? new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", maximumSignificantDigits: 6 }).format(x)
      : "-",
  time = (x) => new Date(x).toLocaleString("sl-SI");
// Slovenska dvojina: 1 pozicija, 2 poziciji, 3-4 pozicije, 5+ pozicij.
const plural = (n, one, two, few, many) => {
  const r = Math.abs(n) % 100;
  return n + " " + (r === 1 ? one : r === 2 ? two : r === 3 || r === 4 ? few : many);
};
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
  view = "watching",
  selected = null,
  coins = new Map(),
  healthy = false,
  last = 0,
  remoteStamp = 0,
  busy = false,
  alerts = [],
  announced = new Map(),
  showAllRecent = false,
  livePrices = new Map(),
  customFrom = null,
  customTo = null,
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
const OWNER_KEY = "solana-owner-v1";
let remoteUser = null,
  remoteAuto = null,
  syncTimer = null;
function syncNote(text, bad) {
  const el = $("#syncState");
  if (!el) return;
  el.textContent = text;
  el.className = "syncState" + (bad ? " negative" : "");
}
const hhmm = (ms) => new Date(ms).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
async function loadRemote() {
  if (!db) return;
  try {
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return;
    remoteUser = user;
    // Lokalni predpomnilnik velja samo, če pripada istemu računu. Če se je v tem brskalniku prijavil kdo drug
    // (ali je predpomnilnik iz starejše različice brez lastnika), ga zavržemo in velja izključno profil.
    let owner = null;
    try {
      owner = localStorage.getItem(OWNER_KEY);
    } catch {}
    const localTrusted = owner === user.id;
    if (!localTrusted) {
      trades = [];
      stake = 0.1;
      profile = DEFAULT_PROFILE;
      try {
        localStorage.setItem(OWNER_KEY, user.id);
        localStorage.removeItem("solana-demo-v1");
        localStorage.removeItem("solana-auto-v1");
      } catch {}
    }
    const { data, error } = await db.from("memecoin_state").select("trades,stake,auto_entries,profile,updated_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    remoteStamp = stampMs(data?.updated_at);
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
    else syncNote("profil naložen " + hhmm(new Date(data.updated_at).getTime()) + (added ? " · preneseno " + added + " lokalnih zapisov" : ""));
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
// Časovni žig profila, kot ga nazadnje poznamo. Profil (700 kB in več) beremo samo, kadar se je žig spremenil,
// sicer je vsak zavihek vsakih 30 do 45 s vlekel cel profil in to je stalo okrog 3 GB prenosa na dan (Supabase, 24. 9.).
// Spremenljivka remoteStamp je deklarirana zgoraj pri "last = 0", ker se profil bere pred to vrstico (TDZ).
// Žig primerjamo kot število, ne kot niz: baza vrne "+00:00", brskalnik piše "Z", nizovna primerjava bi bila vedno "drugačno".
const stampMs = (v) => (v ? new Date(v).getTime() || 0 : 0);
async function remoteChanged() {
  const { data, error } = await db.from("memecoin_state").select("updated_at").eq("user_id", remoteUser.id).maybeSingle();
  if (error) throw error;
  return !!data && stampMs(data.updated_at) !== remoteStamp;
}
async function syncRemote() {
  if (!db || !remoteUser) return;
  try {
    if (!(await remoteChanged())) return;
    const { data, error } = await db.from("memecoin_state").select("trades,updated_at").eq("user_id", remoteUser.id).maybeSingle();
    if (error || !Array.isArray(data?.trades)) return;
    remoteStamp = stampMs(data.updated_at) || remoteStamp;
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
  const snapshot = () => JSON.stringify({ user_id: remoteUser.id, trades, stake, auto_entries: !!$("#auto")?.checked, profile });
  if (!force && snapshot() === lastPushed) return; // nič novega, ne pošiljaj (in ne beri) vsakih 30 s
  // Pred pisanjem združimo s profilom, da ne povozimo poslov iz drugega brskalnika, ampak samo, če ga je kdo medtem spremenil.
  try {
    if (await remoteChanged()) {
      const { data } = await db.from("memecoin_state").select("trades,updated_at").eq("user_id", remoteUser.id).maybeSingle();
      if (Array.isArray(data?.trades)) {
        trades = mergeTrades(trades, data.trades);
        remoteStamp = stampMs(data.updated_at) || remoteStamp;
      }
    }
  } catch {}
  const row = { user_id: remoteUser.id, trades, stake, auto_entries: !!$("#auto")?.checked, profile };
  const fingerprint = JSON.stringify(row);
  try {
    const stamp = new Date().toISOString();
    const { error } = await db.from("memecoin_state").upsert({ ...row, updated_at: stamp });
    if (error) throw error;
    remoteStamp = stampMs(stamp);
    lastPushed = fingerprint;
    syncNote("sinhronizirano " + hhmm(Date.now()));
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
  miniDash();
  watching();
  renderOpenTrades();
  renderBoardGraph();
  $("#autoPanel").hidden = mode === "practice";
  const c = current();
  $("#source").textContent = mode === "practice" ? "IZMIŠLJENA VAJA" : "ŽIVI POSNETKI";
  $("#scope").textContent =
    mode === "practice" ? "Vaja: napreduješ ročno. Podatki so izmišljeni." : "Kandidati iz DEX Screener profilov in boostov · posnetek vsakih 30 s, tudi ko je stran zaprta · ob odprtju zadnja ura";
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
  renderFlags(c, "#flags");
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
  } else if (ep?.state === "waiting" && Number.isFinite(ep.estimate)) {
    if (ep.zone) lines.push({ key: "zone", zone: ep.zone, color: "#edc687", label: "Območje, kamor mora cena najprej priti (" + mcText(c, ep.zone[0]) + " do " + mcText(c, ep.zone[1]) + ")" });
    lines.push({ key: "buy", tag: "VSTOP ~", value: ep.estimate, color: "#ffffff", dash: "2 5", width: 2, label: "Ocenjen vstop ~" + mcText(c, ep.estimate) + " (" + ep.pattern + "; točna cena se določi, ko je pogoj izpolnjen)" });
  }
  const refs = lines.flatMap((l) => (l.zone ? l.zone : [l.value])).filter((v) => Number.isFinite(v)),
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
    if (l.zone) {
      add("rect", { x: 110, width: 570, y: y(l.zone[1]), height: Math.max(2, y(l.zone[0]) - y(l.zone[1])), fill: l.color, opacity: 0.16 });
      add("text", { x: 114, y: y(l.zone[1]) - 3, fill: l.color, "font-size": 10, "font-weight": 700 }, "CENA MORA SEM");
      continue;
    }
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
      if (it.zone) {
        sw.style.borderTop = "0";
        sw.style.height = "10px";
        sw.style.background = it.color;
        sw.style.opacity = "0.5";
      }
      span.append(sw, document.createTextNode(it.label));
      legend.append(span);
    }
  }
}

// Opis ravni odprtega posla: stari posli (fiksni cilj/meja) in posli s profilom (pol prodaje, sledilna meja).
function tradeLevels(t, c) {
  const p = t.plan;
  if (!p) return { kind: "fixed", targetLabel: "Cilj +10 %", stopLabel: "Meja -5 %", targetValue: t.target, stopValue: t.stop, trailing: false, summary: "cilj " + mcText(c, t.target) + " (+10 %) · meja " + mcText(c, t.stop) + " (-5 %). Zapre se ob prvi ceni čez eno od njiju." };
  const trailing = (!p.halfAt || t.halfSold) && !!p.trail;
  const stopLabel = trailing ? "Sledilna meja" : "Trda meja -" + Math.round(p.hardStop * 100) + " %";
  const targetLabel = !p.halfAt ? (p.cap && !p.trail ? "Cilj +" + Math.round(p.cap * 100) + " %" : "Vrh") : t.halfSold ? "Pol prodano" : "Pol prodaje +" + Math.round(p.halfAt * 100) + " %";
  const targetValue = !p.halfAt ? (p.cap && !p.trail ? t.cap : Math.max(t.peak || t.entry, t.entry)) : t.halfSold ? t.halfPrice : t.target;
  const name = (PROFILES[t.profile] || {}).name || t.profile;
  const summary =
    (p.halfAt
      ? t.halfSold
        ? "polovica že prodana pri " + mcText(c, t.halfPrice) + " · ostanek proda" + (p.cap ? " pri cilju " + mcText(c, t.cap) + " (+" + Math.round(p.cap * 100) + " %) ali" : "") + ", ko cena pade " + Math.round(p.trail * 100) + " % z vrha (zdaj meja " + mcText(c, t.stop) + ")"
        : "pol proda pri " + mcText(c, t.target) + " (+" + Math.round(p.halfAt * 100) + " %), potem sledi vrhu" + (p.cap ? " do cilja " + mcText(c, t.cap) + " (+" + Math.round(p.cap * 100) + " %)" : "") + " · trda meja " + mcText(c, t.stop) + " (-" + Math.round(p.hardStop * 100) + " %)"
      : !p.trail
        ? "cilj " + mcText(c, t.cap) + " (+" + Math.round(p.cap * 100) + " %) ali trda meja " + mcText(c, t.stop) + " (-" + Math.round(p.hardStop * 100) + " %) · brez delne prodaje in brez sledi"
        : (p.cap ? "cilj " + mcText(c, t.cap) + " (+" + Math.round(p.cap * 100) + " %) ali " : "brez cilja: ") + "proda, ko cena pade " + Math.round(p.trail * 100) + " % z vrha (zdaj meja " + mcText(c, t.stop) + ")") + " · profil " + name + ".";
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
  if (t.plan.cap && Number.isFinite(t.cap)) lines.push({ key: "cap", tag: "CILJ", value: t.cap, color: "#ffd166", dash: "6 3", label: "Cilj +" + Math.round(t.plan.cap * 100) + " % " + mcText(c, t.cap) });
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
  } else el.textContent = `Vstopne točke še ni. Najbližje je vzorec "${ep.pattern}", manjka: ${ep.missing.join("; ")}. ${Number.isFinite(ep.estimate) ? "Ocenjen vstop, ko bo pogoj izpolnjen: ~" + mcText(c, ep.estimate) + " (na grafu VSTOP ~). " : ""}Zdaj: ${mcText(c, ep.last)} · podpora ${mcText(c, ep.support)} · odpor ${mcText(c, ep.resistance)}.`;
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
    fdv: Number.isFinite(r.fdv) ? r.fdv : null,
    // Zastavice iz posnetka: samo opis, nič ne blokira vstopa.
    hasX: r.has_twitter ?? null,
    xStatus: r.twitter_status ?? null,
    hasTg: r.has_telegram ?? null,
    hasWeb: r.has_website ?? null,
    boost: Number(r.boost_total) || 0,
    source: r.source || null,
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
      .select("pair,t,token,symbol,name,price,mcap,fdv,liquidity,volume5m,pair_created_ms,image,url,change1h,buys5m,sells5m,has_twitter,twitter_status,has_telegram,has_website,boost_total,source,suspect")
      .gt("t", new Date(sinceMs).toISOString())
      .order("t", { ascending: true })
      .order("pair", { ascending: true }),
  );
}
// Sumljivi posnetki (21. 9. 2026): zbiralec posnetek označi, ko se cena z DEX Screenerja od Jupitrove razlikuje
// za več kot polovico (brez Jupitra: skok za več kot 3-krat). Takega posnetka aplikacija ne upošteva, par z vsaj
// dvema takima posnetkoma v zadnjih 22 minutah pa ne dobi samodejnega vstopa. Analiza 21. 9.: +1 točka na posel.
const suspectLog = new Map();
function noteSuspect(pair, tm) {
  const a = (suspectLog.get(pair) || []).filter((x) => tm - x <= 22 * 60000);
  a.push(tm);
  suspectLog.set(pair, a);
}
const unreliable = (pair, tm) => (suspectLog.get(pair) || []).filter((x) => tm - x <= 22 * 60000).length >= 2;
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
  const blocked = s.signal ? (unreliable(id, tm) ? "nezanesljivi podatki: DEX Screener in Jupiter se razhajata" : entryFilter(c)) : null;
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
        db.from("memecoin_snapshots").select("t,price,suspect").eq("pair", t.id).gt("t", new Date(from).toISOString()).order("t", { ascending: true }),
      );
      let prev = from;
      for (const r of data) {
        if (r.suspect) continue;
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
        if (r.suspect) {
          noteSuspect(r.pair, tm);
          continue;
        }
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
    try {
      const { data: sp } = await db.from("memecoin_prices_now").select("price,t").eq("token", SOL_MINT).maybeSingle();
      if (sp && sp.price > 0 && Date.now() - new Date(sp.t).getTime() < 3600000) solUsd = sp.price;
    } catch {}
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
  const freshNow = healthy && Date.now() - last < 75000;
  $("#status").className = "notice " + (mode === "practice" ? "practice" : freshNow ? "connected" : "stopped");
  if (mode === "practice") {
    $("#status").textContent = "IZMIŠLJENA VAJA · najprej primer rasti, nato primer izgube. To ni napoved.";
    return;
  }
  if (noData) {
    $("#status").textContent = "● BREZ PODATKOV · strežnik nima posnetkov za zadnjo uro ali ta račun nima dostopa · poskusi Osveži čez minuto";
    return;
  }
  const day = Math.max(1, Math.ceil((Date.now() - SHADOW_START) / 86400000));
  const active = SHADOW_STRATEGIES.filter((k) => !SHADOW_PAUSED[k]).length;
  $("#status").textContent = freshNow
    ? "● ZBIRALEC AKTIVEN · posnetek " + time(last) + " · " + coins.size + " kovancev · senca " + active + " pravil · dan " + day + " od " + SHADOW_MIN_DAYS
    : "● PREMOR · zadnji posnetek " + (last ? time(last) : "neznan") + " · vstopi in opozorila čakajo na nov posnetek";
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
  renderExportReminder();
}
$("#live").onclick = () => navigate("market", "live");
$("#history").onclick = () => navigate("journal");
$("#about").onclick = () => navigate("info");
// Povezave v besedilu: <button data-goto="info"> preskoci na zavihek.
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-goto]");
  if (!b) return;
  e.preventDefault();
  const v = b.dataset.goto;
  navigate(v, v === "market" ? "live" : mode);
  const target = b.dataset.scroll ? $(b.dataset.scroll) : null;
  // "Zakaj" samo pelje na razlago in vrstice ne pospravi; to naredi samo gumb "Videl sem".
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
});
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
    slippagePerSide: 0.001,
    feePerSide: 0.0025,
    networkSOL: 0.0002,
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
function exportJournal() {
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
}
for (const id of ["export", "cmpExport", "journalExport"]) {
  const b = $("#" + id);
  if (b) b.onclick = exportJournal;
}

// Opozorilo, da se bliža konec senčnega testa. Pokaže se 3 dni prej in odšteva.
// Izvoza ne sprožimo sami, samo pokažemo gumb; klikne ga uporabnik.
function renderExportReminder() {
  const daysRun = (Date.now() - SHADOW_START) / 86400000;
  const due = daysRun >= SHADOW_MIN_DAYS;
  const show = daysRun >= SHADOW_MIN_DAYS - SHADOW_WARN_DAYS;
  const left = Math.max(1, Math.ceil(SHADOW_MIN_DAYS - daysRun));
  const dni = left === 1 ? "1 dan" : left === 2 ? "2 dneva" : left + " dni";
  const text = due
    ? "Senčni test je dopolnil " + SHADOW_MIN_DAYS + " dni. Čas za izvoz dnevnika in pošiljanje."
    : "Senčni test se konča čez " + dni + ". Pripravi izvoz dnevnika za pošiljanje.";
  for (const id of ["cmpExportNote", "journalExportNote"]) {
    const el = $("#" + id);
    if (!el) continue;
    el.hidden = !show;
    el.className = "notice exportNote" + (due ? " due" : "");
    const span = el.querySelector("span");
    if (span) span.textContent = text;
  }
}
renderExportReminder();
try {
  const saved = localStorage.getItem("solana-auto-v1");
  $("#auto").checked = saved === "on";
  $("#autoSaved").textContent =
    saved === null
      ? "Izbira še ni shranjena. Izberi jo enkrat, potem se pomni."
      : "";
} catch {
  $("#auto").checked = false;
  $("#autoSaved").textContent = "Shranjevanje ni dosegljivo. Izbira se po osvežitvi morda ne bo ohranila.";
}
if (remoteAuto !== null) {
  $("#auto").checked = remoteAuto;
  $("#autoSaved").textContent = "Nastavitev s profila (velja v vseh brskalnikih).";
}
$("#autoState").textContent = $("#auto").checked ? "VKLJUČENI" : "IZKLJUČENI";
renderBotPill();
poll();
setInterval(poll, 30000);
// Prikaz odprtih pozicij se osvežuje na 6 s z Jupitrovimi cenami (tabela memecoin_prices_now), posnetki
// DEX Screenerja pa ostajajo na 30 s. To je SAMO prikaz: vstopi, izstopi in dnevnik še naprej tečejo po
// posnetkih, da ostanejo meritve primerljive s senco (pravilo v1.0-jup posebej meri, ali so Jupitrovi
// izstopi boljši).
async function fetchLive() {
  if (!db || document.hidden || mode === "practice" || view !== "watching") return;
  const tokens = [...new Set(trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).map((t) => t.token).filter(Boolean))];
  if (!tokens.length) return;
  try {
    const { data, error } = await db.from("memecoin_prices_now").select("token,price,t").in("token", tokens);
    if (error || !data) return;
    for (const r of data) if (r.price > 0) livePrices.set(r.token, { price: r.price, t: new Date(r.t).getTime() });
    renderOpenTrades();
  } catch {
    // prikaz je dodatek, napaka ne sme motiti ostalega
  }
}
setInterval(fetchLive, 6000);
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
    $("#autoSaved").textContent = "Shranjeno: bot " + (value === "on" ? "vstopa sam" : "ne vstopa sam") + ".";
  } catch {
    $("#autoSaved").textContent = "Izbire ni bilo mogoče shraniti. Velja samo v tem odprtem zavihku.";
  }
  $("#autoState").textContent = $("#auto").checked ? "VKLJUČENI" : "IZKLJUČENI";
  renderBotPill();
  scheduleRemote();
  watching();
};

// Pilula stanja bota v glavi: en pogled pove, ali bot vstopa sam, s kakšnim vložkom in katerim profilom. Klik odpre nastavitve.
function renderBotPill() {
  const pill = $("#botPill"), txt = $("#botPillText");
  if (!pill || !txt) return;
  const on = !!$("#auto").checked;
  const p = PROFILES[profile] || PROFILES[DEFAULT_PROFILE];
  const st = stake.toLocaleString("sl-SI", { maximumSignificantDigits: 21, useGrouping: false });
  txt.textContent = "BOT · " + (on ? "SAMODEJNO" : "ROČNO") + " · " + st + " SOL · " + p.name.toUpperCase();
  pill.classList.toggle("off", !on);
  pill.title = (on ? "Bot sam odpira demo posle." : "Bot ne odpira sam, vstopaš ročno.") + " Klik odpre nastavitve.";
}
// Odpiranje in zapiranje panela z nastavitvami. hidden ne da animirati (display:none),
// zato hidden samo odstranimo, razred .open pa sproži prehod; ob zapiranju hidden vrnemo po prehodu.
let botPopTimer = null;
function setBotPop(open) {
  const pop = $("#botPop"), scrim = $("#botScrim");
  if (!pop) return;
  clearTimeout(botPopTimer);
  if (open) {
    pop.hidden = false;
    if (scrim) scrim.hidden = false;
    // dva okvirja, da brskalnik zabeleži začetno stanje in prehod res steče
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pop.classList.add("open");
        scrim?.classList.add("open");
      }),
    );
  } else {
    pop.classList.remove("open");
    scrim?.classList.remove("open");
    botPopTimer = setTimeout(() => {
      pop.hidden = true;
      if (scrim) scrim.hidden = true;
    }, 220);
  }
  $("#botPill")?.setAttribute("aria-expanded", open ? "true" : "false");
}
const botPopOpen = () => !$("#botPop")?.hidden;
$("#botPill").onclick = (e) => {
  e.stopPropagation();
  setBotPop(!botPopOpen());
};
$("#botPopClose").onclick = () => setBotPop(false);
document.addEventListener("click", (e) => {
  const pop = $("#botPop");
  if (!pop || pop.hidden || pop.contains(e.target)) return;
  setBotPop(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && botPopOpen()) setBotPop(false);
});

$("#watch").onclick = () => navigate("watching", "live");
let watchSignature = "",
  showAllColumns = false,
  waitOpen = new Map(); // pair -> true/false (ročno odprt/zaprt graf); privzeto so odprti prvi štirje
function watching() {
  const signature = JSON.stringify([
    [...coins.values()].map((c) => [c.id, c.time, fresh(c)]),
    healthy,
    showAllColumns,
    [...waitOpen.entries()],
    $("#boardFilter").value,
    $("#auto").checked,
    trades.map((t) => [t.key, t.closed, t.interrupted, t.signalAt]),
  ]);
  if (signature === watchSignature) return;
  watchSignature = signature;
  const host = $("#watchCards");
  const expanded = new Set([...document.querySelectorAll("#watchCards details[open], #waitCards details[open]")].map((d) => d.dataset.id));
  host.replaceChildren();
  $("#watchStatus").textContent =
    "Osveženo " + time(Date.now()) + " · zadnji posnetek " + (last ? time(last) : "še čakamo") + " · bot " + ($("#auto").checked ? "vstopa sam" : "ne vstopa sam");
  const collectRow = $("#collectRow"),
    waitCards = $("#waitCards"),
    waitEmpty = $("#waitEmpty");
  $("#watchRows").replaceChildren();
  waitCards.replaceChildren();
  collectRow.hidden = false;
  if (!coins.size) {
    $("#watchEmpty").textContent = "Še ni kandidatov. Počakaj na povezavo.";
    host.textContent = "Še ni kandidatov. Vir morda še nalaga podatke ali ni dosegljiv. Poskusi Živi izbor > Osveži.";
    collectRow.hidden = true;
    waitEmpty.hidden = false;
    waitEmpty.textContent = "Še ni podatkov.";
    $("#waitCount").textContent = "0";
    return;
  }
  const ranked = [...coins.values()].map((c) => ({ c, ...cardState(c) })).sort((a, b) => b.rank - a.rank || a.c.id.localeCompare(b.c.id));
  const filtered = ranked.filter((x) => $("#boardFilter").value !== "fresh" || fresh(x.c));
  const hidden = filtered.filter((x) => boardColumn(x) === "Brez signala" && !fresh(x.c));
  const hiddenCount = hidden.length;
  // 1) Opazovanje (pod Čakanjem na vstop): tabela vseh svežih kovancev, ki niso pripravljeni na vstop
  const others = filtered.filter((x) => fresh(x.c) && !x.open && boardColumn(x) !== "Čakanje na vstop");
  const order = (x) => (x.collect ? 0 : x.filterReason ? 1 : 2);
  others.sort((a, b) => order(a) - order(b) || b.rank - a.rank || (b.c.volume || 0) - (a.c.volume || 0));
  const rowsHost = $("#watchRows");
  rowsHost.replaceChildren();
  $("#collectCount").textContent = others.length;
  $("#collectEmpty").hidden = !!others.length;
  $("#collectEmpty").textContent = "Trenutno ni drugih kovancev s svežimi podatki.";
  for (const x of others) {
    const c = x.c;
    const tr = document.createElement("tr");
    tr.className = x.young ? "young" : x.collect ? "collect" : x.filterReason ? "filtered" : "";
    const ageMin = c.created ? (Date.now() - c.created) / 60000 : null;
    const stateText = x.young
      ? "Premlad · vstop od " + FILTER.minAge + ". min"
      : x.collect
        ? "Zbiranje " + Math.min(c.history.length, 16) + "/16"
        : x.filterReason
          ? "Izven filtra: " + x.filterReason.replace(/ \(.*\)$/, "")
          : !c.liquidity || c.liquidity < 10000
            ? "Likvidnost pod 10K"
            : !(c.volume > 0)
              ? "Brez prometa 5 min"
              : x.title;
    const cells = [
      ["sym", c.symbol],
      ["state", stateText],
      ["num", ageMin === null ? "-" : ageMin < 60 ? Math.floor(ageMin) + " min" : ageMin < 1440 ? Math.floor(ageMin / 60) + " h " + Math.floor(ageMin % 60) + " min" : Math.floor(ageMin / 1440) + " d"],
      ["num", Number.isFinite(c.mcap) ? compact(c.mcap) : "-"],
      ["num", Number.isFinite(c.liquidity) ? compact(c.liquidity) : "-"],
      ["num", Number.isFinite(c.volume) ? compact(c.volume) : "-"],
      ["num", Number.isFinite(c.buys) ? c.buys + " / " + (c.sells ?? 0) : "-"],
      ["num " + (Number.isFinite(c.change1h) ? tone(c.change1h) : ""), Number.isFinite(c.change1h) ? pct1(c.change1h) : "-"],
    ];
    for (const [cls, text] of cells) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    if (x.collect) {
      const mini = document.createElement("i");
      mini.className = "mini";
      const em = document.createElement("em");
      em.style.width = (x.young ? Math.min(100, (ageMin / FILTER.minAge) * 100) : Math.min(100, (c.history.length / 16) * 100)) + "%";
      mini.append(em);
      tr.children[1].append(mini);
    }
    const act = document.createElement("td");
    const a = document.createElement("a");
    a.href = "https://dexscreener.com/solana/" + c.id;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = "DEX";
    a.onclick = (e) => e.stopPropagation();
    act.append(a);
    tr.append(act);
    tr.onclick = () => openBoardGraph(c.id);
    rowsHost.append(tr);
  }
  // 2) Čakanje na vstop: kartice z grafom (podpora, odpor, vstopna točka)
  const waiting = filtered.filter((x) => boardColumn(x) === "Čakanje na vstop");
  $("#waitCount").textContent = waiting.length;
  waitEmpty.hidden = !!waiting.length;
  waitEmpty.textContent = "Trenutno noben kovanec ne čaka na vstop. Bot zbira podatke ali pa nobeden ne gre skozi filtre.";
  const shown = showAllColumns ? waiting : waiting.slice(0, 6);
  $("#boardMore").hidden = waiting.length <= 6;
  $("#boardMore").textContent = showAllColumns ? "Pokaži manj" : "Pokaži vseh " + waiting.length;
  shown.forEach((state, idx) => {
    const c = state.c;
    const ep = fresh(c) && c.history.length >= 16 ? entryPoint(c.history) : null;
    const isOpen = waitOpen.has(c.id) ? waitOpen.get(c.id) : idx < 4;
    const card = document.createElement("article");
    card.className = "waitCard" + (ep?.state === "signal" ? " signal" : ep?.state === "ready" ? " ready" : "");
    const head = document.createElement("div");
    head.className = "wcHead";
    const left = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = c.symbol;
    const meta = document.createElement("small");
    meta.className = "wcMeta";
    meta.textContent = (Number.isFinite(c.mcap) ? "MC " + compact(c.mcap) : money(c.price)) + " · " + age(c.created) + " · likv. " + compact(c.liquidity) + (Number.isFinite(c.change1h) ? " · 1 h " + pct1(c.change1h) : "");
    left.append(h, meta);
    const st = document.createElement("div");
    st.className = "wcState";
    st.textContent = state.title;
    head.append(left, st);
    card.append(head);
    const line = document.createElement("p");
    line.className = "entryLine" + (ep?.state === "ready" || ep?.state === "signal" ? " ready" : "");
    line.textContent =
      ep?.state === "signal"
        ? "Vzorec " + ep.pattern + " je izpolnjen pri " + mcText(c, ep.price) + ". " + ($("#auto").checked ? "Samodejni vstop se sproži ob tem prejemu." : "Samodejni vstopi so izključeni.")
        : ep?.state === "ready"
          ? "Vstop, če naslednja cena preseže " + mcText(c, ep.price) + " (" + ep.pattern + "). Zdaj " + mcText(c, ep.last) + "."
          : ep?.state === "waiting"
            ? "Najbližje: " + ep.pattern + ". Manjka: " + ep.missing.join("; ") + "." + (Number.isFinite(ep.estimate) ? " Ocenjen vstop, ko bo pogoj izpolnjen: ~" + mcText(c, ep.estimate) + "." : "")
            : state.reason;
    card.append(line);
    if (isOpen) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "chart");
      svg.setAttribute("viewBox", "0 0 700 230");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Cena " + c.symbol + " s podporo, odporom in vstopno točko");
      const legend = document.createElement("div");
      legend.className = "legend";
      card.append(svg, legend);
      chart(c, svg, legend);
      const det = document.createElement("details");
      det.dataset.id = "wait-" + c.id;
      det.open = expanded.has(det.dataset.id);
      const sum = document.createElement("summary");
      sum.textContent = "Kaj bot preverja (✓ izpolnjeno / ○ čaka)";
      det.append(sum);
      const cond = document.createElement("div");
      cond.className = "conditions";
      cond.id = "cond-" + c.id;
      det.append(cond);
      card.append(det);
    }
    const foot = document.createElement("div");
    foot.className = "wcFoot";
    const toggle = document.createElement("button");
    toggle.className = "ghost";
    toggle.textContent = isOpen ? "Skrij graf" : "Pokaži graf";
    toggle.onclick = () => {
      waitOpen.set(c.id, !isOpen);
      watching();
    };
    const manual = document.createElement("button");
    manual.className = "primary";
    manual.textContent = "Vstopi";
    manual.disabled = !!manualBlock(c);
    manual.title = manualBlock(c) || "Vstop po trenutni ceni z izbranim profilom";
    const fb = document.createElement("small");
    fb.className = "muted";
    fb.id = "wfb-" + c.id;
    manual.onclick = () => manualEntry(c, "#wfb-" + CSS.escape(c.id));
    const link = document.createElement("a");
    link.href = "https://dexscreener.com/solana/" + c.id;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "DEX Screener";
    link.className = "linkBtn";
    foot.append(toggle, manual, link, fb);
    card.append(foot);
    waitCards.append(card);
    if (isOpen) renderConditions(c, "#cond-" + CSS.escape(c.id));
  });
  $("#watchEmpty").textContent =
    (ranked.some((x) => x.rank >= 10)
      ? "Kartice se ob novih podatkih samodejno premaknejo. Razvrstitev ni ocena dobička."
      : "Trenutno ni kandidata za vstop. Program zbira podatke ali čaka na izpolnjene filtre.") +
    (hiddenCount ? " " + hiddenCount + " kovancev brez svežih podatkov (izpadli iz izbora) je skritih; so v seznamu na dnu." : "");
  // 3) Podroben seznam vseh kandidatov (razpirljiv, na dnu)
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
    add((c.liquidity >= 10000 ? "Izpolnjeno: " : "Manjka: ") + "vsaj 10.000 USD likvidnosti; trenutno " + money(c.liquidity) + ". Likvidnost pomeni sredstva v trgovalnem paru.");
    add((c.volume > 0 ? "Izpolnjeno: " : "Manjka: ") + "pozitiven promet v zadnjih 5 minutah; trenutno " + money(c.volume) + ".");
    const blocked = entryFilter(c);
    add((blocked ? "Manjka: " : "Izpolnjeno: ") + "filter vstopov v1.2" + (blocked ? " (" + blocked + ")" : "") + ".");
    if (sig.checks) {
      for (const group of sig.checks) {
        const h = document.createElement("h3");
        h.textContent = group.name;
        d.append(h);
        for (const item of group.items) add((item.ok ? "Izpolnjeno: " : "Manjka: ") + item.label);
      }
    } else add("Cenovnih vzorcev trenutno ne preverjamo: najprej morajo biti izpolnjeni zgornji filtri in zbranih 16 neprekinjenih posnetkov.");
    const open = trades.find((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === c.id);
    if (open) add(`Demo že odprt: ${open.reason}, ${time(open.opened)} (${open.automatic ? "samodejno" : "ročno"}).`);
    const b = document.createElement("button");
    b.textContent = "Poglej cenovni graf";
    b.onclick = () => openBoardGraph(c.id);
    d.append(b);
    host.append(d);
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
  const ageMin = c.created ? (Date.now() - c.created) / 60000 : null;
  if (ageMin !== null && ageMin < FILTER.minAge)
    return {
      rank: 2 + ageMin / FILTER.minAge,
      collect: true,
      young: true,
      title: "Premlad za vstop",
      reason: "Par je star " + Math.floor(ageMin) + " min. Bot vstopa šele od " + FILTER.minAge + ". minute naprej (čez " + Math.ceil(FILTER.minAge - ageMin) + " min).",
    };
  const blocked = entryFilter(c);
  if (blocked)
    return {
      rank: 0,
      filtered: true,
      filterReason: blocked,
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
// Koledar po meri za Bilanco: lasten izbirnik v foqs barvah namesto privzetega brskalnikovega.
const DAY_MS = 86400000,
  CAL_DAYS = ["P", "T", "S", "Č", "P", "S", "N"],
  dayStart = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },
  dateShort = (ms) => new Date(ms).toLocaleDateString("sl-SI", { day: "numeric", month: "numeric", year: "numeric" }),
  dayMonth = (ms) => new Date(ms).toLocaleDateString("sl-SI", { day: "numeric", month: "numeric" }),
  rangeShort = (a, b) => (a === b ? dateShort(a) : new Date(a).getFullYear() === new Date(b).getFullYear() ? dayMonth(a) + " do " + dateShort(b) : dateShort(a) + " do " + dateShort(b));
let calMonth = 0,
  pickFrom = null,
  pickTo = null;
const calClose = () => ($("#cal").hidden = true);
function rangeText() {
  return customFrom === null ? "Izberi datume" : rangeShort(customFrom, dayStart(customTo));
}
function calOpen() {
  pickFrom = customFrom;
  pickTo = customTo === null ? null : dayStart(customTo);
  calMonth = dayStart(pickFrom || Date.now());
  $("#cal").hidden = false;
  calDraw();
}
function calShift(months) {
  const d = new Date(calMonth);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  calMonth = d.getTime();
  calDraw();
}
function calDraw() {
  const cal = $("#cal");
  cal.replaceChildren();
  const cur = new Date(calMonth);
  cur.setDate(1);
  const head = document.createElement("div");
  head.className = "calHead";
  for (const [label, step] of [
    ["‹", -1],
    ["›", 1],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "calNav";
    b.textContent = label;
    b.setAttribute("aria-label", step < 0 ? "Prejšnji mesec" : "Naslednji mesec");
    b.onclick = () => calShift(step);
    if (step < 0) head.append(b);
    else {
      const name = cur.toLocaleDateString("sl-SI", { month: "long", year: "numeric" });
      const title = document.createElement("strong");
      title.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      head.append(title, b);
    }
  }
  cal.append(head);
  const grid = document.createElement("div");
  grid.className = "calGrid";
  for (const d of CAL_DAYS) {
    const s = document.createElement("small");
    s.textContent = d;
    grid.append(s);
  }
  const lead = (cur.getDay() + 6) % 7,
    start = dayStart(cur.getTime()) - lead * DAY_MS,
    today = dayStart(Date.now());
  for (let i = 0; i < 42; i++) {
    const ms = start + i * DAY_MS,
      d = new Date(ms),
      b = document.createElement("button");
    b.type = "button";
    b.className = "calDay";
    b.textContent = d.getDate();
    if (d.getMonth() !== cur.getMonth()) b.classList.add("out");
    if (ms === today) b.classList.add("today");
    if (ms > today) b.disabled = true;
    if (pickFrom !== null && (ms === pickFrom || ms === pickTo)) b.classList.add("edge");
    else if (pickFrom !== null && pickTo !== null && ms > pickFrom && ms < pickTo) b.classList.add("mid");
    b.onclick = () => {
      if (pickFrom === null || pickTo !== null) {
        pickFrom = ms;
        pickTo = null;
      } else if (ms < pickFrom) {
        pickTo = pickFrom;
        pickFrom = ms;
      } else pickTo = ms;
      calDraw();
    };
    grid.append(b);
  }
  cal.append(grid);
  const foot = document.createElement("div");
  foot.className = "calFoot";
  const note = document.createElement("small");
  note.textContent =
    pickFrom === null
      ? "Klikni začetni dan"
      : pickTo === null
        ? dateShort(pickFrom) + ", klikni še zadnji dan ali uporabi samo tega"
        : rangeShort(pickFrom, pickTo);
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "calApply";
  apply.textContent = "Uporabi";
  apply.disabled = pickFrom === null;
  apply.onclick = () => {
    customFrom = pickFrom;
    customTo = (pickTo === null ? pickFrom : pickTo) + DAY_MS - 1;
    $("#rangeBtn").textContent = rangeText();
    calClose();
    dashboard();
  };
  foot.append(note, apply);
  cal.append(foot);
}
$("#rangeBtn").onclick = () => ($("#cal").hidden ? calOpen() : calClose());
// Klik v koledarju ne sme zapreti koledarja: mreža se ob vsakem kliku izriše na novo, zato klikani gumb
// do dokumenta pride že odstranjen iz strani in preverba "je klik znotraj koledarja" ne bi delovala.
$("#cal").onclick = (e) => e.stopPropagation();
document.addEventListener("click", (e) => {
  const w = $("#rangeWrap");
  if (!w || w.hidden || $("#cal").hidden || w.contains(e.target)) return;
  calClose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#cal").hidden) calClose();
});
$("#period").onchange = () => {
  const custom = $("#period").value === "custom";
  $("#rangeWrap").hidden = !custom;
  if (custom) {
    if (customFrom === null) {
      customFrom = dayStart(Date.now());
      customTo = customFrom + DAY_MS - 1;
    }
    $("#rangeBtn").textContent = rangeText();
    calOpen();
  } else calClose();
  dashboard();
};
$("#recentMore").onclick = () => {
  showAllRecent = !showAllRecent;
  dashboard();
};
$("#quality").onchange = dashboard;
// Mini bilanca na vrhu Pozicij: današnje številke, iste kot v Bilanci pri obdobju Danes.
function miniDash() {
  if (!$("#miniKpis")) return;
  const rate = solUsd || SOL_USD_FIXED,
    prices = new Map([...coins.values()].map((c) => [c.id, { price: c.price, fresh: fresh(c) }]));
  const o = overview(trades, { period: "today", quality: "all", rate, prices });
  const usd = (x) =>
    (x > 0 ? "+" : "") + new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  $("#mkNet").textContent = signed(o.net) + " SOL";
  $("#mkNet").className = tone(o.net);
  $("#mkUsd").textContent = "≈ " + usd(o.usd) + " · 1 SOL = " + usd(rate).replace("+", "");
  $("#mkWin").textContent = o.success === null ? "-" : (o.success * 100).toLocaleString("sl-SI", { maximumFractionDigits: 1 }) + " %";
  $("#mkWinNote").textContent = o.closed.length ? o.wins + " od " + o.closed.length : "še ni zaključkov";
  $("#mkWinFill").style.width = (o.success === null ? 0 : o.success * 100) + "%";
  $("#mkCounts").textContent = o.closed.length + " / " + o.open.length;
  $("#mkOutcomes").textContent = o.wins + " dobitkov · " + o.losses + " izgub";
}
function dashboard() {
  const rate = solUsd || SOL_USD_FIXED,
    prices = new Map([...coins.values()].map((c) => [c.id, { price: c.price, fresh: fresh(c) }]));
  const o = overview(trades, {
    period: $("#period").value || "all",
    quality: $("#quality").value || "all",
    from: customFrom,
    to: customTo,
    rate,
    prices,
  });
  $("#excludedNote").textContent = !o.excluded
    ? "Nobenega dogodka izgube podatkov. Vsi posli imajo znan izid."
    : plural(o.excluded, "dogodek izgube podatkov je ločen", "dogodka izgube podatkov sta ločena", "dogodki izgube podatkov so ločeni", "dogodkov izgube podatkov je ločenih") +
      " od poslov in rezultatov, ker izida ne poznamo. Običajne izgube ostajajo vključene.";
  $("#dashNet").textContent = signed(o.net) + " SOL";
  $("#dashNet").className = tone(o.net);
  $("#dashNet").setAttribute(
    "aria-label",
    (o.net > 0 ? "Dobiček " : o.net < 0 ? "Izguba " : "Nevtralno ") + signed(o.net) + " SOL po stroških",
  );
  $("#winFill").style.width = (o.success === null ? 0 : o.success * 100) + "%";
  const usd = (x) =>
    (x > 0 ? "+" : "") + new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  $("#dashUsd").textContent =
    "≈ " + usd(o.usd) + " · 1 SOL = " + usd(rate).replace("+", "") + (solUsd ? " (sproti, Jupiter)" : " (fiksen tečaj 22. 9.)");
  $("#dashSuccess").textContent =
    o.success === null ? "Še ni podatkov" : (o.success * 100).toLocaleString("sl-SI", { maximumFractionDigits: 1 }) + " %";
  $("#dashDenominator").textContent = o.closed.length
    ? o.wins + " dobičkonosnih od " + o.closed.length + " zaključenih poslov"
    : "Ni zaključenih živih demo poslov v tem obdobju.";
  $("#dashDenominator").textContent +=
    " · " +
    plural(o.open.length, "odprta pozicija", "odprti poziciji", "odprte pozicije", "odprtih pozicij") +
    " ni v tem deležu, od tega " +
    o.marks.filter((m) => m.pnl === null).length +
    " z neznanim izidom. Dodatno " +
    plural(o.excluded, "izločen dogodek", "izločena dogodka", "izločeni dogodki", "izločenih dogodkov") +
    " izgube podatkov. To ni uspešnost vseh poskusov.";
  $("#dashCounts").textContent = o.closed.length + " / " + o.open.length;
  $("#dashOutcomes").textContent = o.wins + " dobitkov · " + o.losses + " izgub · " + o.flat + " brez spremembe";
  // Bilanca pove samo seštevek; posamezne odprte pozicije s karticami in grafi so v zavihku Pozicije.
  $("#dashOpen").textContent = !o.open.length
    ? "Ni odprtih pozicij"
    : plural(o.open.length, "odprta pozicija", "odprti poziciji", "odprte pozicije", "odprtih pozicij");
  $("#dashOpen").className = !o.open.length || o.unrealized === null ? "neutral" : tone(o.unrealized);
  $("#dashUnreal").textContent = !o.open.length
    ? "Bot čaka na signal."
    : o.unrealized === null
      ? "Vrednosti ne moremo oceniti: manjkajo sveže cene ali je spremljanje prekinjeno."
      : "Ob zaprtju zdaj: " + signed(o.unrealized) + " SOL po stroških, ne glede na izbrano obdobje.";
  // Dve poti naprej: kartice pozicij so v Pozicijah, prekinjeni posli v Dnevniku. Tu samo seštevek in povezavi.
  const link = $("#dashOpenLink");
  link.replaceChildren();
  const jump = (text, fn) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.onclick = fn;
    link.append(b);
  };
  if (o.open.length) jump("Odpri jih v Pozicijah", showOpenTrades);
  if (o.events.length)
    jump(plural(o.events.length, "prekinjen posel", "prekinjena posla", "prekinjeni posli", "prekinjenih poslov") + " v Dnevniku", () =>
      navigate("journal", "live"),
    );
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
  const recent = [...o.closed].sort((a, b) => b.closed - a.closed);
  const more = $("#recentMore");
  more.hidden = recent.length <= 5;
  more.textContent = showAllRecent ? "Pokaži manj" : "Pokaži vseh " + recent.length + " v izbranem obdobju";
  for (const t of showAllRecent ? recent : recent.slice(0, 5)) {
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
  renderBotPill();
  renderManual(current(), "#open", "#liveManualState");
  renderManual(coins.get(boardSelected), "#boardManual", "#boardManualState");
  $("#stakeInput").value = text;
  $("#stakeSmall").classList.toggle("active", Math.abs(stake - 0.1) < 1e-9);
  $("#stakeLarge").classList.toggle("active", Math.abs(stake - 0.2) < 1e-9);
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
    "Vstopi · " + stake.toLocaleString("sl-SI", { maximumSignificantDigits: 21, useGrouping: false }) + " SOL";
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
  renderFlags(c, "#boardFlags");
  renderManual(c, "#boardManual", "#boardManualState");
}

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

// ---------- Laboratorij: razteg ene vrstice pravil ----------
// Pokaže stanje, pravila za vstop in izstop ter zadnje posle. Klik na posel nariše pot cene okoli njega.
function shadowPathChart(host, t) {
  host.replaceChildren();
  const note = document.createElement("p");
  note.className = "muted";
  note.style.fontSize = "13px";
  note.textContent = "Nalagam posnetke za " + (t.symbol || "kovanec") + " ...";
  host.append(note);
  const from = new Date(new Date(t.opened_at).getTime() - 20 * 60000).toISOString();
  const to = new Date(new Date(t.closed_at || Date.now()).getTime() + 10 * 60000).toISOString();
  db.from("memecoin_snapshots")
    .select("t,price")
    .eq("pair", t.pair)
    .gte("t", from)
    .lte("t", to)
    .order("t", { ascending: true })
    .then(({ data, error }) => {
      if (error) {
        note.textContent = "Posnetkov ni bilo mogoče naložiti: " + error.message;
        return;
      }
      const pts = (data || []).filter((r) => r.price > 0);
      if (pts.length < 3) {
        note.textContent = "Posnetki za ta posel niso več na voljo (strežnik jih hrani 36 ur).";
        return;
      }
      host.replaceChildren();
      const head = document.createElement("p");
      head.className = "muted";
      head.style.fontSize = "13px";
      head.textContent =
        (t.symbol || "?") + " · vstop " + time(t.opened_at) + " · " + (t.status === "closed" ? (t.outcome || "zaključeno") + " ob " + time(t.closed_at) : "še odprt") + " · " + pts.length + " posnetkov";
      host.append(head);
      const W = 700,
        H = 200,
        L = 56,
        R = 14,
        T = 14,
        B = 26;
      const entry = t.entry_price,
        t0 = new Date(t.opened_at).getTime();
      const rel = pts.map((r) => ({ m: (new Date(r.t).getTime() - t0) / 60000, v: r.price / entry }));
      const hardStop = t.strategy === "v1.0" ? 0.95 : 0.88;
      const target = Number.isFinite(t.target) && t.target > 0 ? t.target / entry : t.strategy === "v1.0" ? 1.1 : 1.25;
      const FLOOR = 0.2;
      const vals = rel.map((r) => r.v);
      const lo = Math.max(Math.min(hardStop * 0.96, ...vals), FLOOR),
        hi = Math.max(target * 1.05, ...vals);
      const x0 = Math.min(...rel.map((r) => r.m)),
        x1 = Math.max(...rel.map((r) => r.m));
      const X = (m) => L + ((m - x0) / Math.max(0.1, x1 - x0)) * (W - L - R);
      const Y = (v) => T + ((Math.log(hi) - Math.log(Math.max(v, lo))) / Math.max(0.0001, Math.log(hi) - Math.log(lo))) * (H - T - B);
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("class", "chart");
      svg.style.height = "200px";
      const mk = (tag, attrs) => {
        const e = document.createElementNS(ns, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        return e;
      };
      const halo = { stroke: "#0b1523", "stroke-width": "3", "paint-order": "stroke", "stroke-linejoin": "round" };
      const lvl = (v, label, color) => {
        svg.append(mk("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: color, "stroke-width": 1.2, "stroke-dasharray": "6 5", opacity: 0.9 }));
        const tx = mk("text", { x: W - R - 4, y: Y(v) - 5, "text-anchor": "end", fill: "#9fb0c8", "font-size": "11", ...halo });
        tx.textContent = label;
        svg.append(tx);
      };
      svg.append(mk("line", { x1: L, x2: W - R, y1: Y(1), y2: Y(1), stroke: "#7f96b5", "stroke-width": 1 }));
      const e0 = mk("text", { x: L + 2, y: Y(1) - 5, fill: "#dce5f3", "font-size": "11", ...halo });
      e0.textContent = "vstop";
      svg.append(e0);
      lvl(target, "cilj " + pct1(100 * (target - 1)), "#62e4b3");
      lvl(hardStop, "meja " + pct1(100 * (hardStop - 1)), "#ff858e");
      svg.append(mk("path", { d: rel.map((r, i) => (i ? "L" : "M") + X(r.m).toFixed(1) + "," + Y(r.v).toFixed(1)).join(" "), fill: "none", stroke: SHADOW_COLOR[t.strategy] || "#6fa5ff", "stroke-width": 2, "stroke-linejoin": "round" }));
      if (x0 <= 0 && x1 >= 0) svg.append(mk("circle", { cx: X(0), cy: Y(1), r: 5, fill: SHADOW_COLOR[t.strategy] || "#6fa5ff", stroke: "#111c2c", "stroke-width": 2 }));
      if (t.status === "closed" && Number.isFinite(t.exit_price)) {
        const me = (new Date(t.closed_at).getTime() - t0) / 60000;
        svg.append(mk("circle", { cx: X(me), cy: Y(t.exit_price / entry), r: 5, fill: t.pnl_net_sol >= 0 ? "#62e4b3" : "#ff858e", stroke: "#111c2c", "stroke-width": 2 }));
      }
      for (const m of [x0, 0, x1]) {
        if (m !== x0 && m !== x1 && (m < x0 || m > x1)) continue;
        const tx = mk("text", { x: Math.min(Math.max(X(m), L + 14), W - R - 14), y: H - 8, "text-anchor": "middle", fill: "#7f96b5", "font-size": "11" });
        tx.textContent = (m > 0 ? "+" : "") + Math.round(m) + " min";
        svg.append(tx);
      }
      host.append(svg);
    });
}
function shadowDetail(s, st, flags) {
  const box = document.createElement("div");
  box.className = "cmpDetail";
  const h = (text) => {
    const e = document.createElement("h5");
    e.textContent = text;
    return e;
  };
  const list = (items) => {
    const ul = document.createElement("ul");
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it;
      ul.append(li);
    }
    return ul;
  };
  // stanje
  const stanje = document.createElement("p");
  stanje.className = "cmpStanje";
  if (SHADOW_PAUSED[s]) stanje.textContent = "Ustavljena " + SHADOW_PAUSED[s] + ". Ne odpira novih poslov, odprti se zaprejo normalno, zgodovina ostane v tabeli.";
  else if (flags.ok) stanje.textContent = "Izpolnjuje kriterije za preklop (vzorec dovolj velik, faktor nad 1,3, pričakovanje nad +2 %).";
  else if (!st.closed.length) stanje.textContent = "Aktivna, še brez zaključenih poslov.";
  else if (!flags.enough)
    stanje.textContent =
      "Aktivna, zbira vzorec: " + st.closed.length + " od " + SHADOW_MIN_TRADES + " poslov (ali 14 dni in vsaj " + SHADOW_MIN_JUDGE + " poslov). Vmesni rezultat ni sodba.";
  else stanje.textContent = "Aktivna, vzorec je dovolj velik, kriterijev pa ne izpolnjuje: " + (flags.pfOk ? "" : "faktor pod 1,3") + (!flags.pfOk && !flags.expOk ? " in " : "") + (flags.expOk ? "" : "pričakovanje pod +2 %") + ".";
  box.append(stanje);
  const grid = document.createElement("div");
  grid.className = "cmpDetailGrid";
  const rules = SHADOW_RULES[s] || { vstop: [], izstop: [] };
  const c1 = document.createElement("div");
  c1.append(h("Kaj gleda za vstop"), list(rules.vstop));
  const c2 = document.createElement("div");
  c2.append(h("Kako izstopi"), list(rules.izstop));
  grid.append(c1, c2);
  box.append(grid);
  // posli
  const mine = shadowTrades.filter((t) => t.strategy === s).sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));
  const closed = mine.filter((t) => t.status === "closed" && Number.isFinite(t.pnl_net_sol));
  box.append(h("Zadnji posli"));
  if (!mine.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.fontSize = "13px";
    p.textContent = "V izbranem obdobju ni poslov tega pravila.";
    box.append(p);
    return box;
  }
  const chart = document.createElement("div");
  chart.className = "cmpPath";
  const best = closed.length ? closed.reduce((a, b) => (b.pnl_net_sol > a.pnl_net_sol ? b : a)) : null;
  const worst = closed.length ? closed.reduce((a, b) => (b.pnl_net_sol < a.pnl_net_sol ? b : a)) : null;
  const seen = new Set();
  const picks = [];
  for (const t of mine.slice(0, 5)) {
    picks.push(["", t]);
    seen.add(t.id);
  }
  if (best && !seen.has(best.id)) {
    picks.push(["najboljši · ", best]);
    seen.add(best.id);
  }
  if (worst && !seen.has(worst.id)) picks.push(["najslabši · ", worst]);
  const wrap = document.createElement("div");
  wrap.className = "cmpMini";
  for (const [tag, t] of picks) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cmpMiniRow";
    const peakPct = t.entry_price > 0 && Number.isFinite(t.peak) ? (100 * t.peak) / t.entry_price - 100 : null;
    const netPct = t.status === "closed" && t.size_sol > 0 ? (100 * t.pnl_net_sol) / t.size_sol : null;
    const left = document.createElement("span");
    left.textContent = tag + time(t.opened_at) + " · " + (t.symbol || "?");
    const mid = document.createElement("span");
    mid.className = "muted";
    mid.textContent = "vrh " + (peakPct === null ? "-" : pct1(peakPct)) + " · " + (t.status === "closed" ? t.outcome || "zaključeno" : "še odprt");
    const right = document.createElement("span");
    right.className = netPct === null ? "muted" : tone(netPct);
    right.textContent = netPct === null ? "odprt" : pct1(netPct);
    b.append(left, mid, right);
    b.onclick = () => {
      for (const o of wrap.querySelectorAll(".cmpMiniRow")) o.classList.toggle("active", o === b);
      shadowPathChart(chart, t);
    };
    wrap.append(b);
  }
  box.append(wrap, chart);
  const hint = document.createElement("small");
  hint.className = "muted";
  hint.textContent = "Klik na posel nariše pot cene od 20 min pred vstopom do 10 min po izstopu, s črtama cilja in meje.";
  box.append(hint);
  if (best && worst && best.id !== worst.id) {
    const bw = document.createElement("small");
    bw.className = "muted";
    bw.textContent = "Najboljši v obdobju " + sol4(best.pnl_net_sol) + " (" + (best.symbol || "?") + "), najslabši " + sol4(worst.pnl_net_sol) + " (" + (worst.symbol || "?") + ").";
    box.append(bw);
  }
  return box;
}
function renderComparison() {
  if ($("#comparison").hidden) return;
  renderExportReminder();
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
    const enough = st.closed.length >= SHADOW_MIN_TRADES || (daysRun >= SHADOW_MIN_DAYS && st.closed.length >= SHADOW_MIN_JUDGE);
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
          ? daysRun >= SHADOW_MIN_DAYS
            ? "○ " + st.closed.length + " poslov v " + SHADOW_MIN_DAYS + " dneh, premalo za sodbo"
            : "○ " + st.closed.length + "/" + SHADOW_MIN_TRADES + " poslov" + (pfOk && expOk ? " (vmes v redu)" : "")
          : "✗ " + [!pfOk ? "faktor" : "", !expOk ? "pričakovanje" : ""].filter(Boolean).join(" in ") + " pod ciljem";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "cmpToggle";
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = shadowOpen.has(s) ? "▾" : "▸";
    const nameTxt = document.createElement("span");
    nameTxt.textContent = SHADOW_LABEL[s] + (SHADOW_PAUSED[s] ? " · ustavljen " + SHADOW_PAUSED[s] : "");
    nameBtn.append(caret, nameTxt);
    nameBtn.title = "Pokaži pravila in zadnje posle";
    const cells = [
      nameBtn,
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
    // Razteg: pravila, stanje in zadnji posli tega seta.
    const detailTr = document.createElement("tr");
    detailTr.className = "cmpDetailRow";
    const detailTd = document.createElement("td");
    detailTd.colSpan = cells.length;
    detailTr.append(detailTd);
    detailTr.hidden = !shadowOpen.has(s);
    if (shadowOpen.has(s)) detailTd.append(shadowDetail(s, st, { enough, pfOk, expOk, ok }));
    nameBtn.onclick = () => {
      const show = !shadowOpen.has(s);
      if (show) shadowOpen.add(s);
      else shadowOpen.delete(s);
      caret.textContent = show ? "▾" : "▸";
      detailTr.hidden = !show;
      detailTd.replaceChildren();
      if (show) detailTd.append(shadowDetail(s, st, { enough, pfOk, expOk, ok }));
    };
    rows.append(detailTr);
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
    for (const s of SHADOW_STRATEGIES.filter((k) => !SHADOW_PAUSED[k])) {
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
  $("#openRowTitle").textContent = "Odprte pozicije";
  $("#openRowCount").textContent = open.length;
  host.replaceChildren();
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  for (const t of open) {
    const snap = coins.get(t.id);
    const jl = livePrices.get(t.token);
    // Jupitrova cena je iz istega para le priblizno, zato MC preracunamo iz razmerja s posnetkom.
    const useJup = !!(snap && jl && jl.price > 0 && snap.price > 0 && Date.now() - jl.t < 20000 && Math.abs(snap.price / jl.price - 1) <= 0.5);
    const c = useJup ? { ...snap, price: jl.price, mcap: Number.isFinite(snap.mcap) ? (snap.mcap * jl.price) / snap.price : snap.mcap, time: jl.t, jup: true } : snap;
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
    // Desni rob traku: kam mora cena naprej. Pri sledilni meji vzamemo vrh, ampak vsaj 25 % nad vstopom,
    // sicer se pri poslu, ki še ni bil v plusu, vrh in vstop prekrijeta na istem robu.
    const trailing = L.kind !== "fixed" && !(t.plan.halfAt && !t.halfSold) && !!t.plan.trail;
    const hasCap = L.kind !== "fixed" && !!t.plan.cap && Number.isFinite(t.cap);
    const rightRaw = trailing ? (hasCap ? t.cap : Math.max(t.peak || t.entry, t.entry * 1.25, price || 0)) : hasCap && !t.plan.halfAt ? t.cap : t.target;
    const right = Number.isFinite(rightRaw) && rightRaw > t.stop * 1.002 ? rightRaw : t.stop * 1.05;
    const peakPctNow = t.entry > 0 && Number.isFinite(t.peak) ? (t.peak / t.entry - 1) * 100 : null;
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
    // Cilj dobi svojo ploščico, kadar ga ploščica "target" še ne kaže (Srednje: pol prodaje, Agresivno: vrh).
    const showCap = hasCap && !!(t.plan.halfAt || t.plan.trail);
    const capTile = showCap ? tile("cap", "Cilj +" + Math.round(t.plan.cap * 100) + " %", c ? mcText(c, t.cap).replace("MC ", "") : money(t.cap), price > 0 ? "še " + pct1((t.cap / price - 1) * 100) + " · proda vse" : "proda vse") : null;
    if (showCap) stats.classList.add("five");
    stats.append(
      tile("now", "MC zdaj", c && Number.isFinite(c.mcap) ? compact(c.mcap) : "-", live ? (c.jup ? "Jupiter " : "posnetek ") + new Date(c.time).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : c ? "zastarelo · " + new Date(c.time).toLocaleTimeString("sl-SI") : "ni podatkov"),
      tile("entry", "Vstop", Number.isFinite(t.entryMcap) ? compact(t.entryMcap) : money(t.entry), money(t.entry) + " / kovanec"),
      tile("target", L.targetLabel, c && Number.isFinite(L.targetValue) ? mcText(c, L.targetValue).replace("MC ", "") : money(L.targetValue), targetNote),
      ...(capTile ? [capTile] : []),
      tile("stop", L.stopLabel + (L.trailing ? " (sledi vrhu)" : ""), c ? mcText(c, t.stop).replace("MC ", "") : money(t.stop), toStop === null ? "" : pct1(toStop) + " do meje"),
    );
    card.append(stats);
    // Trak: levo meja izgube, desno cilj oziroma vrh, pika je trenutna cena.
    const track = el("div", "ocTrack");
    const span = right - t.stop || 1;
    const pos = (v) => Math.max(0, Math.min(100, ((v - t.stop) / span) * 100));
    const clamp = (v) => Math.max(2, Math.min(98, pos(v))); // da se krogec ne odreže na robu
    const mark = (cls, value, title) => {
      const m = el("span", cls);
      m.style.left = clamp(value) + "%";
      m.title = title;
      track.append(m);
      return m;
    };
    const entryPos = pos(t.entry);
    const entryOnTrack = t.entry > t.stop && t.entry < right;
    if (entryOnTrack) mark("trackEntry", t.entry, "Vstop " + mcText(c, t.entry));
    // vrh označimo le, kadar je znotraj traku in dovolj nad vstopom (sicer bi se zlil z vstopom ali robom)
    if (trailing && peakPctNow !== null && peakPctNow > 3 && t.peak < right * 0.97) mark("trackPeak", t.peak, "Najvišje " + pct1(peakPctNow));
    if (price > 0) mark("trackNow " + (pnl >= 0 ? "positive" : "negative"), price, "Zdaj " + mcText(c, price));
    // Oznake: levo in desno sta v vrstici (ne moreta trčiti), VSTOP se pokaže samo, kadar je dovolj stran od obeh robov.
    const labels = el("div", "trackLabels");
    // Kadar je sledilna meja že nad vstopom, je tudi najslabši izid dobiček: to povemo v oznaki.
    const stopPct = t.entry > 0 ? (t.stop / t.entry - 1) * 100 : null;
    labels.append(
      el(
        "span",
        (L.trailing && stopPct > 0 ? "positive" : "negative") + " lStop",
        L.kind === "fixed" ? "MEJA -5 %" : L.trailing ? (stopPct > 0 ? "SLEDILNA MEJA " + pct1(stopPct) : "SLEDILNA MEJA") : "MEJA -" + Math.round(t.plan.hardStop * 100) + " %",
      ),
    );
    if (entryOnTrack && entryPos > 20 && entryPos < 80) {
      const lEntry = el("span", "lEntry", "VSTOP");
      lEntry.style.left = entryPos + "%";
      labels.append(lEntry);
    }
    labels.append(
      el(
        "span",
        "positive lTarget",
        L.kind === "fixed"
          ? "CILJ +10 %"
          : t.plan.halfAt && !t.halfSold
            ? "POL +" + Math.round(t.plan.halfAt * 100) + " %"
            : hasCap
              ? "CILJ +" + Math.round(t.plan.cap * 100) + " %"
              : peakPctNow !== null && peakPctNow > 3
                ? "VRH " + pct1(peakPctNow)
                : "+25 %",
      ),
    );
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

// ---------- Kaj je novega ----------
// En seznam za obe mesti: tiha vrstica pod statusom (pokaže samo zadnji vnos) in razdelek
// "Kaj je novega" v zavihku Kako deluje (pokaže vse). Nov vnos dodaš tukaj na vrh in nič drugega.
// id mora rasti; ob zaprtju vrstice se shrani zadnji viden id, zato se vrstica vrne šele ob naslednjem vnosu.
// Vrstica pod statusom se pokaze samo NEWS_BAR_HOURS ur po casu "at" zadnjega vnosa.
// Po tem ostane vnos samo se v dnevniku sprememb v zavihku Kako deluje.
const NEWS_BAR_HOURS = 24;
const NEWS = [
  {
    id: 9,
    at: "2026-09-21T19:30:00Z",
    date: "21. 9. 2026",
    title: "Drugi vir cen: Jupiter",
    short:
      "<b>Sonar zdaj bere še Jupiter.</b> Posnetkov, kjer se DEX Screener in Jupiter razlikujeta za več kot polovico, pri tvojih pozicijah ne upošteva.",
    body:
      "DEX Screener vsak odgovor 30 sekund predpomni, zato ceno vidimo vsakih 32 sekund. Nekateri pari pa so imeli povsem napačne podatke: JEANJAK je izmenično kazal 353K in 5,7K, tik za tikom, šest ur. Na takem posnetku je meja -5 % sprožila izstop in zapisala -98 %, čeprav cena nikoli ni padla. Od danes zbiralec vsakih 6 sekund bere še Jupitrovo ceno (cena zadnje menjave) in vsak posnetek DEX Screenerja preveri. Sumljivega posnetka aplikacija ne upošteva ne pri vstopu ne pri izstopu, par z vsaj dvema takima posnetkoma v 22 minutah pa ne dobi samodejnega vstopa. V Laboratoriju sta dve novi pravili, ki merita, koliko prinesejo čisti podatki in koliko hitrejša cena. Tam so zdaj vidna tudi pravila, ki sem jih dodal 20. 9. in jih prej ni bilo na seznamu.",
    tags: [["Jupiter na 6 s", "ok"], ["Sumljivi posnetki izločeni", "ok"], ["Laboratorij: v1.0 čisto, v1.0 Jupiter", ""]],
  },
  {
    id: 8,
    at: "2026-09-20T20:30:00Z",
    date: "20. 9. 2026",
    title: "Nov profil Hitri: cilj +10 %, meja -5 %",
    short:
      "<b>Nov profil Hitri.</b> Proda vse pri +10 %, zapre pri -5 %. Na istih poteh 2,7 točke boljši od Srednje.",
    body:
      "Doslej so vsi trije profili delali isto stvar v različnih razmikih: prodali pol, potem sledili vrhu. Meritev na 342 resničnih poteh pravi, da je preprostejše boljše. Hitri ne prodaja po delih in ne sledi vrhu: proda vse pri +10 % ali zapre pri -5 %, povprečno v dveh minutah. Na posel da -2,15 % proti -6,88 % pri Srednje in -10,18 % pri Agresivno. Razlika proti Srednje je 2,7 odstotne točke z intervalom zaupanja od 0,4 do 5,1, torej stvar komaj preseže ničlo in je obetavna, ne dokazana. Zanimivo je tudi, od kod prednost pride: Srednje je boljši na 52 % posameznih poslov, Hitri pa pridobi s tem, da se izogne velikim izgubam. Hitri je zdaj privzeti profil za nove uporabnike. Če imaš izbran drug profil, ostane tvoj, dokler ga sam ne zamenjaš, že odprti posli pa obdržijo načrt, s katerim so bili odprti.",
    tags: [["Cilj +10 %, meja -5 %", ""], ["-2,15 % proti -6,88 %", "ok"], ["Izmerjeno na 342 poteh", "ok"]],
  },
  {
    id: 7,
    at: "2026-09-20T18:00:00Z",
    date: "20. 9. 2026",
    title: "Stroški posla so zdaj izmerjeni, ne ocenjeni",
    short:
      "<b>Stroške smo precenili.</b> Namesto 1 % zdrsa na stran računamo izmerjenih 0,1 %. Vsak nov posel je zato okrog 2 odstotni točki boljši.",
    body:
      "Doslej smo od vsakega posla odšteli 1 % zdrsa in 0,5 % provizije na vsako stran, skupaj približno 3 %. Ta številka je bila ugibanje. Zdaj je izmerjena: vpliv naročila na ceno smo izračunali iz likvidnosti, ki jo hranimo ob vstopu, na 424 dejanskih poslih. Pri velikosti 0,07 SOL je mediana 0,054 %, devet poslov od desetih je pod 0,083 %, najslabši od vseh je 0,150 %. Naročilo za nekaj dolarjev v bazenu z nekaj deset tisoč dolarji preprosto ne premakne cene. Kar je res, je provizija bazena 0,25 % na stran in omrežnina s prioriteto, skupaj približno 1 % na cel posel. Že zaključenih poslov ne prepisujemo, ker so bili takrat tako zapisani; novi dobijo pravi izračun. V Laboratoriju je bila napaka še večja, tam smo računali 4,9 % na posel; zgodovina Laboratorija je preračunana po istem modelu. Ob tem so bile na novo izmerjene tudi številke pri profilih. Nižje so kot prej, ker prejšnja meritev ni štela poslov, ki so umrli čez noč, ko je bila stran zaprta.",
    tags: [["3 % → 1 % na posel", "ok"], ["Izmerjeno na 424 poslih", "ok"], ["Stari zapisi ostanejo", ""]],
  },
  {
    id: 6,
    date: "20. 9. 2026",
    title: "Srednje in Agresivno imata cilj +50 %",
    body:
      "Oba profila zdaj pri +50 % prodata vse, kar še držita, namesto da čakata na obrat. Sled in trda meja ostaneta enaki in veljata do tja. Velja za nove posle.",
    tags: [["Cilj +50 %", ""], ["Srednje in Agresivno", ""]],
  },
  // Vnos 4 je bil isti kot ta, samo s staro številko. Zamenjan je s številko 5, ker je v prejšnji
  // različici gumb "Zakaj" še štel kot potrditev in si je del uporabnikov obvestilo ugasnil, ne da bi ga prebral.
  // Nova številka pomeni, da ga vsi dobijo znova; starega vnosa ni več, zato se v dnevniku nič ne podvaja.
  {
    id: 5,
    at: "2026-09-19T18:00:00Z",
    date: "19. 9. 2026",
    title: "Profil Agresivno ima novi meji",
    short: "<b>Profil Agresivno je posodobljen.</b> Sled 20 % → 15 %, meja -10 % → -15 %. Velja za nove posle.",
    body:
      "Sled se je zožila z 20 % na 15 %, trda meja pa razširila z -10 % na -15 %. Bot torej proda prej po obratu in prenese globlji začetni padec. Velja za nove posle; že odprti obdržijo načrt, s katerim so bili odprti.",
    tags: [["Sled 20 % → 15 %", ""], ["Meja -10 % → -15 %", ""], ["Izmerjeno na 233 poteh", "ok"]],
  },
  {
    id: 3,
    date: "19. 9. 2026",
    title: "Zastavice pri kovancu",
    body:
      "Pri kovancu zdaj piše, kaj sonar o njem ve poleg cene: ali ima X in ali povezava pelje na objavo ali na profil, Telegram, spletno stran, plačano promocijo in likvidnost kot delež FDV. Nič od tega ne blokira vstopa in ne spreminja pravil, je samo opis.",
    tags: [["Radar in Pozicije", ""]],
  },
  {
    id: 2,
    date: "19. 9. 2026",
    title: "Nov videz nastavitev bota in zavihka Kako deluje",
    body:
      "Nastavitve bota so zdaj panel z drsnim stikalom in zloženimi razlagami, Kako deluje pa ima zemljevid zavihkov in besednjak. Bilanca ne ponavlja več seznama odprtih pozicij.",
    tags: [],
  },
  {
    id: 1,
    date: "18. 9. 2026",
    title: "Novo pravilo v senci: dip s kupci",
    body:
      "V Laboratoriju sta dve novi vrstici, v2.2 dip s kupci in njena široka različica. Tečeta samo v senci, na tvoje posle nimata vpliva.",
    tags: [["Samo Laboratorij", ""]],
  },
];
const NEWS_KEY = "solana-news-v1";
function newsSeen() {
  try {
    return Number(localStorage.getItem(NEWS_KEY)) || 0;
  } catch {
    return 0;
  }
}
// Znotraj okna = vnos ima cas in od njega je minilo manj kot NEWS_BAR_HOURS ur.
function withinWindow(n) {
  const t = n?.at ? Date.parse(n.at) : NaN;
  return Number.isFinite(t) && Date.now() < t + NEWS_BAR_HOURS * 3600000;
}
// Za vrstico: vnos brez casa nima roka, da se obvestilo ne izgubi, če na "at" pozabim.
const newsFresh = (n) => !n?.at || withinWindow(n);
function renderNewsBar() {
  const bar = $("#newsBar");
  if (!bar) return;
  const latest = NEWS[0];
  const show = !!latest && latest.id > newsSeen() && newsFresh(latest);
  bar.hidden = !show;
  if (!show) return;
  $("#newsBarText").innerHTML = latest.short || latest.title;
}
function renderNewsLog() {
  const host = $("#newsLog");
  if (!host) return;
  host.replaceChildren();
  // Ob prvem ogledu je novo vse, zato oznaka ne pove nič in je ne rišemo;
  // izjema je vnos, ki je še znotraj 24-urnega okna, ker je res svež.
  const seen = newsSeen();
  const fresh = (n) => n.id > seen && (seen > 0 || withinWindow(n));
  for (const n of NEWS) {
    const item = document.createElement("div");
    item.className = "nlItem" + (fresh(n) ? " fresh" : "");
    const when = document.createElement("div");
    when.className = "nlWhen";
    when.textContent = n.date;
    if (fresh(n)) {
      const s = document.createElement("small");
      s.textContent = "NOVO";
      when.append(s);
    }
    const body = document.createElement("div");
    body.className = "nlBody";
    const h = document.createElement("h4");
    h.textContent = n.title;
    const p = document.createElement("p");
    p.textContent = n.body;
    body.append(h, p);
    if (n.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "nlTags";
      for (const [text, cls] of n.tags) {
        const t = document.createElement("span");
        if (cls) t.className = cls;
        t.textContent = text;
        tags.append(t);
      }
      body.append(tags);
    }
    item.append(when, body);
    host.append(item);
  }
}
// keepLog: ko uporabnik klikne "Zakaj", vrstico pospravimo, oznake NOVO v dnevniku pa pustimo,
// da vidi, kaj je pravzaprav novo. Izginejo ob naslednjem odprtju strani.
function markNewsSeen(keepLog) {
  try {
    localStorage.setItem(NEWS_KEY, String(NEWS[0]?.id || 0));
  } catch {}
  renderNewsBar();
  if (!keepLog) renderNewsLog();
}
$("#newsSeen")?.addEventListener("click", () => markNewsSeen());
renderNewsBar();
renderNewsLog();

// Zastavice kovanca: kaj sonar o njem ve poleg cene. Nič od tega ne blokira vstopa in ne vpliva na pravila;
// barve so iz hitre meritve 19. 9. na 20 urah posnetkov (delež trenutkov, ki so dosegli +25 % pred -12 % v 30 min).
function renderFlags(c, sel) {
  const host = $(sel);
  if (!host) return;
  host.replaceChildren();
  if (!c || c.practice) return;
  const chip = (text, tone, title) => {
    const e = document.createElement("span");
    e.className = "flag " + (tone || "");
    e.textContent = text;
    if (title) e.title = title;
    host.append(e);
  };
  if (c.hasX === null || c.hasX === undefined) chip("socialnih podatkov ni", "", "Ta posnetek je starejši od 18. 9., ko smo začeli zbirati socialne podatke.");
  else if (!c.hasX) chip("brez X", "", "Nima povezave na X. Izmerjeno 19. 9.: takih je bilo 17,8 % uspešnih proti 14,5 % pri tistih z X, a le na 21 kovancih, zato temu ne zaupaj preveč.");
  else if (c.xStatus) chip("X: konkretna objava", "good", "Povezava pelje na posamezno objavo, ne na profil. Izmerjeno 19. 9.: 23,6 % uspešnih proti 12,6 % pri navadnem profilu, na 68 kovancih. Najmočnejša zastavica, kar jih imamo.");
  else chip("X: navaden profil", "", "Povezava pelje na profil. Izmerjeno 19. 9.: 12,6 % uspešnih, torej pod povprečjem 14,7 %.");
  if (c.hasTg) chip("Telegram", "bad", "Izmerjeno 19. 9.: kovanci s Telegramom 5,9 % uspešnih proti povprečju 14,7 %. Prva meritev na 20 urah, jemlji previdno.");
  if (c.hasWeb) chip("spletna stran", "", "Ima povezavo na spletno stran. Sama po sebi ne pove nič o izidu.");
  if (c.boost > 0) chip("plačana promocija", "bad", "Nekdo je plačal za izpostavitev na DEX Screener (skupaj " + Math.round(c.boost) + " enot). Izmerjeno 19. 9.: boostani 9,6 % uspešnih proti 21,1 % pri neboostanih, na 70 kovancih.");
  if (Number.isFinite(c.fdv) && c.fdv > 0 && Number.isFinite(c.liquidity)) {
    const share = (c.liquidity / c.fdv) * 100;
    chip("likvidnost " + share.toLocaleString("sl-SI", { maximumFractionDigits: 0 }) + " % FDV", share < 5 ? "bad" : "", "Koliko denarja je v bazenu glede na celotno oglaševano vrednost. Nizek delež pomeni, da že majhna prodaja premakne ceno. Praga še nismo izmerili.");
  }
  if (c.source) chip("vir: " + (c.source === "profile" ? "profil DEX Screener" : c.source === "boost" ? "plačana lista" : "ročno dodan"), "", "Kako je kovanec sploh prišel v naš izbor.");
  if (host.children.length) {
    const note = document.createElement("small");
    note.className = "flagNote";
    note.textContent = "Opis, ne pravilo: zastavice ne odločajo o vstopu. Barve so iz ene 20-urne meritve, ne iz sodbe sence.";
    host.append(note);
  }
}

// Profil izstopa: izbira v Živem izboru z razlago, shranjeno na profil (memecoin_state.profile) in lokalno.
function renderProfile() {
  const p = PROFILES[profile] || PROFILES[DEFAULT_PROFILE];
  renderBotPill();
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
  // Panel je ozek, zato: naslov in štiri številke vidno, razlage in primerjava zloženi.
  box.append(mk("div", "pTag", p.tagline));
  const grid = mk("div", "pStats");
  for (const [label, value, cls] of [
    ["Dobitni posli", p.stats.win + " %", ""],
    ["Na posel", pct1(p.stats.perTrade), p.stats.perTrade > 0 ? "positive" : "negative"],
    ["Povp. dobiček", pct1(p.stats.avgWin), "positive"],
    ["Povp. izguba", pct1(p.stats.avgLoss), "negative"],
  ]) {
    const d = mk("div");
    d.append(mk("small", "", label), mk("strong", cls, value));
    grid.append(d);
  }
  box.append(grid);

  const fold = (title, open) => {
    const d = mk("details", "bpFold");
    d.open = !!open;
    d.append(mk("summary", "", title));
    box.append(d);
    return d;
  };

  const f1 = fold("Kako deluje ta profil");
  const how = mk("p");
  how.append(mk("b", "", "Kako deluje: "), p.how);
  const who = mk("p");
  who.append(mk("b", "", "Za koga: "), p.who);
  f1.append(how, who);
  f1.append(mk("p", "note", "Vstopi so pri vseh profilih enaki. Profil se uporabi ob vstopu; že odprti posli se ne spremenijo. Senčni test na strežniku teče ločeno in se s to izbiro ne spremeni."));

  const f2 = fold("Vsi štirje profili na istih poslih");
  const table = mk("table");
  const thead = mk("thead");
  const hr = mk("tr");
  for (const t of ["Profil", "Dobitni", "Povp. +", "Povp. -", "Na posel"]) hr.append(mk("th", "", t));
  thead.append(hr);
  table.append(thead);
  const tb = mk("tbody");
  for (const q of Object.values(PROFILES)) {
    const tr = mk("tr", q.key === p.key ? "current" : "");
    tr.append(mk("td", "", q.name), mk("td", "", q.stats.win + " %"), mk("td", "positive", pct1(q.stats.avgWin)), mk("td", "negative", pct1(q.stats.avgLoss)), mk("td", q.stats.perTrade > 0 ? "positive" : "negative", pct1(q.stats.perTrade)));
    tb.append(tr);
  }
  table.append(tb);
  const wrap = mk("div", "scroll");
  wrap.append(table);
  f2.append(wrap);
  f2.append(mk("p", "note", "Vsi štirje so izmerjeni na istih 342 resničnih cenovnih poteh (19. do 20. 9. 2026), pri obzorju 3 ure in po izmerjenih stroških (0,25 % provizije in 0,1 % vpliva na ceno na stran), zato so med seboj primerljivi. Hitri je najmanj slab: prednost pred Srednje je 2,7 odstotne točke na posel, interval zaupanja 0,4 do 5,1, kar zaupanja vrednosti komaj preseže ničlo. Zanimivo je, da je Srednje boljši na 52 % posameznih poslov; Hitri pridobi s tem, da se izogne velikim izgubam, ne s tem, da bi večkrat zmagal. Cilj +50 % pri Srednje in Agresivno drži: brez njega bi dala -7,3 % in -19,2 % na posel. Vsi štirje so v minusu: profil izbere samo, kako hitro izgubljaš, ne ali izgubljaš."));
  f2.append(mk("p", "note", "Profil je izstop, ne vstop. Vstop je pri vseh enak in je tisti, ki nas stane največ: mediana posla je 15 minut po vstopu pri -17 %. Dokler tega ne popravimo, noben profil ne more biti pozitiven. Kateri vstop bi bil boljši, se meri v Laboratoriju."));
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
