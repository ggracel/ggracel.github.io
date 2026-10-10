// foqs.sonar · Pravi denar (7.1.0, 10. 10. 2026)
// Drugi pogled v isti aplikaciji. Stikalo Demo | Pravi denar je desno v glavi (G izbral mockup A). Demo pogled ostane
// nespremenjen; pravi pogled ima svoje zavihke: Pregled, Denarnice, Posli, Varovala. Bere tabele live_settings,
// live_settings_log, live_trades in RPC live_wallets_view; piše samo prek RPC (live_set_settings, live_set_on,
// live_sell_all, live_set_wallet), ki v bazi preverijo, da je klicatelj lastnik, in zapišejo dnevnik.
// Stanje SOL denarnice da funkcija izvrsi {stanje:true}. Trgovanja ta verzija še ne izvaja (faza 2 plana).
const db = window.memecoinsClient;
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };
const nf = (v, d = 2) => (v == null || isNaN(v) ? "-" : Number(v).toLocaleString("sl-SI", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (v, d = 4) => (v > 0 ? "+" : "") + nf(v, d);
const cls = (v) => (v > 0 ? "pd-up" : v < 0 ? "pd-down" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = (t) => { if (!t) return "ni podatka"; const s = (Date.now() - new Date(t).getTime()) / 1000; return s < 90 ? "pred " + Math.round(s) + " s" : s < 5400 ? "pred " + Math.round(s / 60) + " min" : "pred " + (s / 3600).toFixed(1).replace(".", ",") + " h"; };
const hm = (t) => new Date(t).toLocaleString("sl-SI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (w) => w.slice(0, 4) + "..." + w.slice(-4);
const ADDR = "BGxhRHabFRC2qZg4pWT9jZS3P1rSFNxcx3zG8snu9xte";
const RULES = { "kopija-hitri": "Hitri 10", "kopija-hitri20": "Hitri 20", "kopija-hitri30": "Hitri 30", "kopija-hitri40": "Hitri 40", "kopija-mirror": "Zrcalo" };
const MODE_KEY = "sonar-mode-v1";

const S = { owner: false, settings: null, wallets: [], trades: [], log: [], bal: null, balErr: "", health: [], tab: "pregled", draft: {}, wdraft: {}, loaded: false };

// ---------- CSS (samo za ta pogled) ----------
document.head.append(el("style", {}, `
:root{--pd-gold:#e8b96a;--pd-gold-soft:rgba(232,185,106,.12);--pd-up:#5fe0a6;--pd-down:#f2737d;--pd-line:#223148;--pd-line2:#2f4356;--pd-surf:#0f1725;--pd-surf2:#16212f;--pd-muted:#93a7bd;--pd-dim:#6b7e94}
.modeSw{display:inline-flex;border:1px solid var(--pd-line2);border-radius:99px;padding:2px;gap:2px;background:var(--pd-surf)}
.modeSw button{font:inherit;font-size:12px;font-weight:600;border:0;background:none;color:var(--pd-muted);padding:5px 11px;border-radius:99px;cursor:pointer;white-space:nowrap}
.modeSw button[aria-pressed="true"][data-m="demo"]{background:#1d3456;color:#cfe0ff}
.modeSw button[aria-pressed="true"][data-m="live"]{background:var(--pd-gold);color:#1a1205}
.modePill{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.12em;padding:5px 10px;border-radius:99px;border:1px solid #6ea8ff;color:#6ea8ff;margin-left:12px;align-self:center;white-space:nowrap}
.modePill.live{border-color:var(--pd-gold);color:var(--pd-gold)}
.modePill.on{background:var(--pd-gold);color:#1a1205}
body.m-live{box-shadow:inset 0 3px 0 var(--pd-gold)}
body.m-live main>*:not(header):not(#pravi):not(#healthBar){display:none!important}
body.m-live #botPill{display:none!important}
body.m-live .mtabs:not(.ptabs),body.m-live .mmore,body.m-live footer,body.m-live #newsBar{display:none!important}
body:not(.m-live) #pravi,body:not(.m-live) .ptabs{display:none!important}
#pravi{display:flex;flex-direction:column;gap:16px;margin-top:16px}
#pravi .pd-tabs{display:flex;gap:4px;border-bottom:1px solid var(--pd-line);overflow-x:auto}
#pravi .pd-tabs button{font:inherit;background:none;border:0;color:var(--pd-muted);padding:10px 12px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
#pravi .pd-tabs button[aria-selected="true"]{color:#eef3fb;border-bottom-color:var(--pd-gold)}
#pravi .pd-panel{display:flex;flex-direction:column;gap:14px}
#pravi .pd-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
#pravi .pd-ctrl{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
#pravi [hidden]{display:none!important}
#pravi .pd-ro{background:var(--pd-surf2);border:1px solid var(--pd-line2);border-radius:10px;padding:8px 12px;font-size:13px;color:var(--pd-muted)}
#pravi .pd-btn{font:inherit;font-size:13px;font-weight:600;padding:9px 14px;border-radius:10px;border:1px solid var(--pd-line2);background:var(--pd-surf);color:#eef3fb;cursor:pointer}
#pravi .pd-btn:disabled{opacity:.35;cursor:default}
#pravi .pd-btn.gold,.pd-modal .pd-btn.gold{background:var(--pd-gold);color:#1a1205;border-color:var(--pd-gold)}
#pravi .pd-btn.red{color:var(--pd-down);border-color:rgba(242,115,125,.45)}
#pravi .pd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
#pravi .pd-kpi{background:var(--pd-surf);border:1px solid var(--pd-line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}
#pravi .pd-kpi small{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--pd-muted)}
#pravi .pd-kpi b{font:500 21px/1.2 "IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
#pravi .pd-kpi span{font-size:12.5px;color:var(--pd-dim)}
#pravi .pd-meter{height:6px;background:var(--pd-line);border-radius:99px;overflow:hidden}
#pravi .pd-meter i{display:block;height:100%;background:var(--pd-gold)}
.pd-up{color:var(--pd-up)}.pd-down{color:var(--pd-down)}.pd-gold{color:var(--pd-gold)}
#pravi .pd-card{background:var(--pd-surf);border:1px solid var(--pd-line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0}
#pravi .pd-card h3{margin:0;font-size:15px}
#pravi .pd-note{font-size:12.5px;color:var(--pd-dim);margin:0}
#pravi .pd-health{display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:13.5px}
#pravi .pd-health .ok{color:var(--pd-up);font:12px "IBM Plex Mono",monospace}
#pravi .pd-health .off{color:var(--pd-muted);font:12px "IBM Plex Mono",monospace}
#pravi .pd-health .bad{color:var(--pd-down);font:12px "IBM Plex Mono",monospace}
#pravi .pd-tbox{overflow-x:auto;border:1px solid var(--pd-line);border-radius:12px;background:var(--pd-surf)}
#pravi table{border-collapse:collapse;width:100%;min-width:720px;font-size:13.5px}
#pravi th,#pravi td{text-align:left;padding:10px 12px;border-top:1px solid var(--pd-line);vertical-align:middle}
#pravi th{border-top:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--pd-muted);font-weight:600}
#pravi td.n,#pravi th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#pravi .pd-addr{font:12px "IBM Plex Mono",monospace;color:var(--pd-dim)}
#pravi tr.izl td{opacity:.55}
#pravi .pd-seg{display:inline-flex;border:1px solid var(--pd-line2);border-radius:9px;overflow:hidden}
#pravi .pd-seg button{font:inherit;font-size:12.5px;padding:6px 10px;background:none;border:0;color:var(--pd-muted);cursor:pointer}
#pravi .pd-seg button+button{border-left:1px solid var(--pd-line2)}
#pravi .pd-seg button[aria-pressed="true"][data-v="live"]{background:var(--pd-gold);color:#1a1205;font-weight:600}
#pravi .pd-seg button[aria-pressed="true"][data-v="senca"]{background:rgba(70,190,197,.18);color:#46BEC5;font-weight:600}
#pravi .pd-seg button[aria-pressed="true"][data-v="izlocen"]{background:rgba(242,115,125,.15);color:var(--pd-down);font-weight:600}
#pravi .pd-seg button:disabled{cursor:default}
#pravi .pd-sum{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:13.5px;color:var(--pd-muted)}
#pravi .pd-sum b{color:#eef3fb}
#pravi .pd-rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
#pravi .pd-rule{background:var(--pd-surf);border:1px solid var(--pd-line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
#pravi .pd-rule.ch{border-color:var(--pd-gold)}
#pravi .pd-rule span{font-size:13.5px}
#pravi .pd-rule small{display:block;font-size:12px;color:var(--pd-dim)}
#pravi .pd-field{display:flex;align-items:center;gap:6px}
#pravi .pd-field input,#pravi .pd-field select{font:14px "IBM Plex Mono",monospace;background:#0a0f16;color:#eef3fb;border:1px solid var(--pd-line2);border-radius:8px;padding:7px 8px;width:100%;min-width:0}
#pravi .pd-field .u{font-size:12.5px;color:var(--pd-dim);white-space:nowrap}
#pravi .pd-warn{font-size:12px;color:var(--pd-gold)}
#pravi .pd-warn:empty{display:none}
#pravi .pd-log{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--pd-muted)}
#pravi .pd-log b{color:#eef3fb;font-weight:500}
#pravi .pd-empty{color:var(--pd-dim);font-size:13.5px;padding:6px 0}
.pd-ov{position:fixed;inset:0;background:rgba(4,8,13,.72);backdrop-filter:blur(3px);display:grid;place-items:center;padding:16px;z-index:100;opacity:0;pointer-events:none;transition:opacity .18s}
.pd-ov.show{opacity:1;pointer-events:auto}
.pd-modal{width:min(460px,100%);background:#111c27;border:1px solid var(--pd-line2);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px;transform:translateY(14px) scale(.97);transition:transform .22s cubic-bezier(.2,.8,.2,1);color:#eef3fb}
.pd-ov.show .pd-modal{transform:none}
.pd-modal.lvl-high{border-color:var(--pd-gold);box-shadow:0 0 0 4px var(--pd-gold-soft)}
.pd-modal.lvl-danger{border-color:var(--pd-down);box-shadow:0 0 0 4px rgba(242,115,125,.12)}
.pd-modal .eye{font:11px "IBM Plex Mono",monospace;letter-spacing:.14em;color:var(--pd-gold)}
.pd-modal.lvl-danger .eye{color:var(--pd-down)}
.pd-modal h2{margin:0;font-size:19px}
.pd-modal ul{margin:0;padding-left:18px;font-size:14px;color:var(--pd-muted);display:flex;flex-direction:column;gap:4px}
.pd-modal ul b{color:#eef3fb;font-weight:500}
.pd-modal label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--pd-muted)}
.pd-modal input{font:15px "IBM Plex Mono",monospace;letter-spacing:.08em;background:#0a0f16;color:#eef3fb;border:1px solid var(--pd-line2);border-radius:10px;padding:10px 12px}
.pd-modal .acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.pd-modal .pd-btn{font:inherit;font-size:13px;font-weight:600;padding:9px 14px;border-radius:10px;border:1px solid var(--pd-line2);background:#0f1725;color:#eef3fb;cursor:pointer}
.pd-modal .pd-btn:disabled{opacity:.35;cursor:default}
.pd-modal .pd-btn.danger{background:var(--pd-down);color:#1b0709;border-color:var(--pd-down)}
.pd-modal .err{color:var(--pd-down);font-size:13px}
.pd-modal .err:empty{display:none}
@media (max-width:700px){#pravi .pd-tabs{display:none}#pravi .pd-kpi b{font-size:18px}header{flex-wrap:wrap}.hdrRight .modeSw{order:-1}.modeSw button{padding:5px 9px;font-size:11.5px}#pravi{padding-bottom:90px}}
@media (prefers-reduced-motion:reduce){.pd-ov,.pd-modal{transition:none}}
`));

// ---------- glava: stikalo in pilula ----------
const lock = $("header h1.lock");
const pill = el("span", { class: "modePill", id: "modePill" }, "DEMO");
lock?.append(pill);
const sw = el("div", { class: "modeSw", role: "group", "aria-label": "Pogled bota" }, '<button type="button" data-m="demo">Demo</button><button type="button" data-m="live">Pravi denar</button>');
const hdr = $("header .hdrRight");
hdr?.insertBefore(sw, hdr.firstChild);

// ---------- ogrodje pogleda ----------
const root = el("section", { id: "pravi", "aria-label": "Pravi denar" });
$("main header")?.after(root);
const TABS = [["pregled", "Pregled"], ["denarnice", "Denarnice"], ["posli", "Posli"], ["varovala", "Varovala"]];
root.innerHTML = `
<div class="pd-head"><div class="pd-ro" id="pdRo" hidden>Samo za branje. Trgovanje, denarnice in varovala spreminja lastnik.</div>
<div class="pd-ctrl" id="pdCtrl" hidden><button class="pd-btn gold" id="pdLive" type="button">Vklopi trgovanje</button><button class="pd-btn red" id="pdSell" type="button">Prodaj vse zdaj</button></div></div>
<nav class="pd-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${k === "pregled"}">${l}</button>`).join("")}</nav>
<div class="pd-panel" id="pdPanel"><p class="pd-empty">Nalagam ...</p></div>`;
const ptabs = el("nav", { class: "mtabs ptabs", "aria-label": "Zavihki pravi denar" });
for (const [k, l] of TABS) {
  const b = el("button", { type: "button", class: "mtab", "data-t": k }, '<i class="ind"></i>' + l);
  b.onclick = () => { setTab(k); window.scrollTo({ top: 0, behavior: "smooth" }); };
  ptabs.append(b);
}
document.body.append(ptabs);
root.querySelectorAll(".pd-tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
function setTab(t) {
  S.tab = t;
  root.querySelectorAll(".pd-tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.t === t));
  ptabs.querySelectorAll(".mtab").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  render();
}

// ---------- potrditveno okno ----------
const ov = el("div", { class: "pd-ov", role: "dialog", "aria-modal": "true" }, `<div class="pd-modal"><span class="eye"></span><h2></h2><ul></ul>
<label hidden>Za potrditev natipkaj <b class="w"></b><input autocomplete="off" spellcheck="false"></label><span class="err"></span>
<div class="acts"><button class="pd-btn" data-a="no" type="button">Prekliči</button><button class="pd-btn gold" data-a="yes" type="button">Potrdi</button></div></div>`);
document.body.append(ov);
const md = $(".pd-modal", ov), mIn = $("input", ov), mYes = $('[data-a="yes"]', ov), mErr = $(".err", ov);
let pending = null;
function ask(title, items, fn, lvl = "normal", word = "", yes = "Potrdi") {
  pending = fn;
  md.className = "pd-modal lvl-" + lvl;
  $(".eye", md).textContent = lvl === "normal" ? "POTRDI SPREMEMBO" : "POTRDITEV POTREBNA";
  $("h2", md).textContent = title;
  $("ul", md).innerHTML = items.map((x) => "<li>" + x + "</li>").join("");
  const need = lvl !== "normal";
  $("label", md).hidden = !need;
  $(".w", md).textContent = word;
  mIn.value = ""; mErr.textContent = "";
  mYes.textContent = yes; mYes.className = "pd-btn " + (lvl === "danger" ? "danger" : "gold");
  mYes.disabled = need; mYes.dataset.word = need ? word : "";
  ov.classList.add("show");
  setTimeout(() => (need ? mIn : mYes).focus(), 200);
}
mIn.oninput = () => (mYes.disabled = mIn.value.trim().toUpperCase() !== mYes.dataset.word);
const closeM = () => { ov.classList.remove("show"); pending = null; };
$('[data-a="no"]', ov).onclick = closeM;
ov.onclick = (e) => { if (e.target === ov) closeM(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ov.classList.contains("show")) closeM(); });
mYes.onclick = async () => {
  if (!pending) return;
  mYes.disabled = true; mErr.textContent = "";
  try { await pending(); closeM(); await load(); }
  catch (e) { mErr.textContent = "Ni uspelo: " + (e?.message || e) + ". Nič se ni spremenilo."; mYes.disabled = false; }
};
const rpc = async (fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message); return data; };

// ---------- podatki ----------
async function load() {
  if (!db) return;
  const set = S.settings?.pravilo || "kopija-hitri20";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [own, st, wv, tr, lg, he] = await Promise.all([
    db.rpc("sonar_is_owner").then((r) => r.data === true, () => false),
    db.from("live_settings").select("*").eq("id", 1).maybeSingle(),
    db.rpc("live_wallets_view", { p_rule: set, p_days: 7 }),
    db.from("live_trades").select("*").order("opened_at", { ascending: false }).limit(200),
    db.from("live_settings_log").select("*").order("t", { ascending: false }).limit(30),
    db.from("memecoin_health").select("key,last_ok,last_err,updated_at"),
  ]);
  S.owner = own;
  S.settings = st.data || S.settings;
  S.wallets = wv.data || [];
  S.trades = tr.data || [];
  S.log = lg.data || [];
  S.health = he.data || [];
  S.loaded = true;
  if (S.settings && S.settings.pravilo !== set) { const r = await db.rpc("live_wallets_view", { p_rule: S.settings.pravilo, p_days: 7 }); S.wallets = r.data || S.wallets; }
  render();
  loadBal();
}
async function loadBal() {
  try {
    const { data, error } = await db.functions.invoke("izvrsi", { body: { stanje: true } });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || "ni odgovora");
    S.bal = data.sol; S.balErr = "";
  } catch (e) { S.balErr = String(e.message || e); }
  if (S.tab === "pregled") renderKpis();
}

// ---------- izris ----------
function header() {
  const on = !!S.settings?.live_on;
  pill.textContent = isLive() ? (on ? "V ŽIVO" : "IZKLOPLJENO") : "DEMO";
  pill.classList.toggle("live", isLive());
  pill.classList.toggle("on", isLive() && on);
  $("#pdRo").hidden = S.owner;
  $("#pdCtrl").hidden = !S.owner;
  $("#pdLive").textContent = on ? "Izklopi trgovanje" : "Vklopi trgovanje";
}
function render() {
  if (!S.loaded) return;
  header();
  const p = $("#pdPanel");
  if (S.tab === "pregled") p.innerHTML = vPregled();
  if (S.tab === "denarnice") p.innerHTML = vDenarnice();
  if (S.tab === "posli") p.innerHTML = vPosli();
  if (S.tab === "varovala") p.innerHTML = vVarovala();
  if (S.tab === "pregled") renderKpis();
  if (S.tab === "denarnice") bindWallets();
  if (S.tab === "varovala") bindRules();
}
const dayTrades = () => { const d0 = new Date(); d0.setHours(0, 0, 0, 0); return S.trades.filter((t) => new Date(t.opened_at) >= d0); };
function vPregled() {
  const s = S.settings;
  const lw = S.wallets.filter((w) => w.status === "sledi" && w.live).map((w) => w.label);
  const open = S.trades.filter((t) => t.status === "open");
  const h = (k) => S.health.find((x) => x.key === k);
  const hrow = (name, t, okMs) => `<span>${name}</span><span class="${t && Date.now() - new Date(t).getTime() < okMs ? "ok" : "bad"}">${ago(t)}</span>`;
  return `<div class="pd-kpis" id="pdKpis"></div>
  <div class="pd-card"><h3>Odprte pozicije</h3>${open.length ? open.map((t) => `<div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--pd-line);padding-top:8px"><span><b>${esc(t.symbol || short(t.token))}</b> <span class="pd-addr">${esc(labelOf(t.wallet))} · ${nf(t.stake_sol, 3)} SOL · ${ago(t.opened_at)}</span></span><span class="pd-addr">${t.tx_buy ? `<a href="https://solscan.io/tx/${esc(t.tx_buy)}" target="_blank" rel="noreferrer">tx</a>` : ""}</span></div>`).join("") : `<p class="pd-empty">Ni odprtih pozicij. Ko bot kupi s pravim denarjem, se pozicija pokaže tu.</p>`}</div>
  <div class="pd-card"><h3>Stanje sistema</h3><div class="pd-health">
    <span>Trgovanje s pravim denarjem</span><span class="${s?.live_on ? "ok" : "off"}">${s?.live_on ? "vklopljeno" : "izklopljeno"}</span>
    <span>Denarnice v živo</span><span class="off">${lw.length ? esc(lw.join(", ")) : "nobena"}</span>
    ${hrow("Tik (bot in senca)", h("tik")?.last_ok || h("tik")?.updated_at, 180000)}
    ${hrow("Zbiralec", h("collect")?.last_ok || h("collect")?.updated_at, 180000)}
    ${hrow("Cene Jupiter", h("cene")?.last_ok || h("cene")?.updated_at, 120000)}
    <span>Zadnji nakup sledenih denarnic</span><span class="off">${ago(S.wallets.filter((w) => w.status === "sledi").map((w) => w.last_buy).filter(Boolean).sort().pop())}</span>
    <span>Izvrševanje (izvrsi)</span><span class="off">ključ preverjen, trgovanje še ni zgrajeno (faza 2)</span>
  </div><p class="pd-note">Denarnica <span class="pd-addr">${ADDR}</span> · <a href="https://solscan.io/account/${ADDR}" target="_blank" rel="noreferrer">Solscan</a></p></div>`;
}
function renderKpis() {
  const box = $("#pdKpis"); if (!box) return;
  const s = S.settings || {}, day = dayTrades(), closed = day.filter((t) => t.status !== "open");
  const realized = closed.reduce((a, t) => a + (Number(t.pnl_sol) || 0), 0);
  const loss = Math.max(0, -realized), meja = Number(s.meja) || 0.1;
  const open = S.trades.filter((t) => t.status === "open");
  box.innerHTML = `
  <div class="pd-kpi"><small>Stanje denarnice</small><b>${S.bal == null ? (S.balErr ? "-" : "...") : nf(S.bal, 4) + " SOL"}</b><span>${S.balErr ? "ni podatka: " + esc(S.balErr) : short(ADDR)}</span></div>
  <div class="pd-kpi"><small>Danes zaprto</small><b class="${cls(realized)}">${closed.length ? sgn(realized) : "0"}</b><span>${closed.length} poslov, ${closed.filter((t) => t.pnl_sol > 0).length} v plusu</span></div>
  <div class="pd-kpi"><small>Odprto zdaj</small><b>${open.length}</b><span>${nf(open.reduce((a, t) => a + (Number(t.stake_sol) || 0), 0), 3)} SOL vloženo, največ ${s.hkrati ?? "-"}</span></div>
  <div class="pd-kpi"><small>Dnevna meja izgube</small><b>${nf(loss, 3)} / ${nf(meja, 2)}</b><div class="pd-meter"><i style="width:${Math.min(100, (loss / meja) * 100).toFixed(0)}%"></i></div><span>porabljeno ${Math.min(100, (loss / meja) * 100).toFixed(0)} %</span></div>
  <div class="pd-kpi"><small>Pravilo in vložek</small><b class="pd-gold">${RULES[s.pravilo] || "-"}</b><span>${nf(s.vlozek, 2)} SOL na posel</span></div>`;
}
const labelOf = (w) => S.wallets.find((x) => x.wallet === w)?.label || short(w);
const wStatus = (w) => (w.status === "izlocen" ? "izlocen" : w.live ? "live" : "senca");
function vDenarnice() {
  const st = S.wallets.map((w) => S.wdraft[w.wallet] || wStatus(w));
  const c = (k) => st.filter((x) => x === k).length;
  const changed = Object.keys(S.wdraft).length;
  const rule = RULES[S.settings?.pravilo] || "";
  return `<div class="pd-sum"><span>V živo <b class="pd-gold">${c("live")}</b></span><span>Senca <b>${c("senca")}</b></span><span>Izločene <b>${c("izlocen")}</b></span>${changed ? `<span class="pd-gold">${changed} neshranjenih sprememb</span>` : ""}</div>
  <div class="pd-tbox"><table><thead><tr><th>Denarnica</th><th class="n">Senca 7 dni (${esc(rule)})</th><th class="n">Poslov</th><th class="n">V plusu</th><th class="n">Zamik</th><th class="n">Zadnji nakup</th><th>Status</th></tr></thead><tbody>
  ${S.wallets.map((w) => { const s = S.wdraft[w.wallet] || wStatus(w); return `<tr class="${s === "izlocen" ? "izl" : ""}"><td><b>${esc(w.label)}</b><br><span class="pd-addr">${short(w.wallet)}</span></td>
  <td class="n ${cls(w.sol)}">${sgn(Number(w.sol), 2)} SOL</td><td class="n">${w.n}</td><td class="n">${w.n ? nf(w.win, 0) + " %" : "-"}</td><td class="n">${w.lag != null ? nf(w.lag, 1) + " s" : "-"}</td><td class="n">${ago(w.last_buy)}</td>
  <td><div class="pd-seg" role="group" aria-label="Status ${esc(w.label)}">${[["live", "V živo"], ["senca", "Senca"], ["izlocen", "Izločena"]].map(([v, l]) => `<button type="button" data-w="${w.wallet}" data-v="${v}" aria-pressed="${s === v}" ${S.owner ? "" : "disabled"}>${l}</button>`).join("")}</div></td></tr>`; }).join("")}
  </tbody></table></div>
  <p class="pd-note">V živo kupuje s pravim denarjem in hkrati ostane v senci. Senca samo meri. Izločena se ne spremlja več (posli ostanejo v zgodovini). Sprememba velja od naslednjega signala; shrani se šele po potrditvi.</p>
  ${S.owner ? `<div><button class="pd-btn gold" id="pdSaveW" type="button" ${changed ? "" : "disabled"}>Shrani spremembe</button> <button class="pd-btn" id="pdResetW" type="button" ${changed ? "" : "disabled"}>Razveljavi</button></div>` : ""}`;
}
function bindWallets() {
  root.querySelectorAll(".pd-seg button[data-w]").forEach((b) => (b.onclick = () => {
    const w = S.wallets.find((x) => x.wallet === b.dataset.w);
    if (b.dataset.v === wStatus(w)) delete S.wdraft[w.wallet]; else S.wdraft[w.wallet] = b.dataset.v;
    render();
  }));
  const save = $("#pdSaveW"), reset = $("#pdResetW");
  if (reset) reset.onclick = () => { S.wdraft = {}; render(); };
  if (save) save.onclick = () => {
    const ch = Object.entries(S.wdraft);
    const L = { live: "v živo", senca: "senca", izlocen: "izločena" };
    const items = ch.map(([w, v]) => { const x = S.wallets.find((y) => y.wallet === w); return `<b>${esc(x.label)}</b>: ${L[wStatus(x)]} → ${L[v]}`; });
    const toLive = ch.some(([, v]) => v === "live");
    if (S.settings?.live_on && toLive) items.push("Trgovanje je vklopljeno, ta denarnica začne kupovati s pravim denarjem takoj.");
    ask("Spremembe denarnic", items, async () => { for (const [w, v] of ch) await rpc("live_set_wallet", { p_wallet: w, p_status: v }); S.wdraft = {}; }, toLive ? "high" : "normal", "VKLOPI", "Shrani");
  };
}
function vPosli() {
  const day = dayTrades(), closed = S.trades.filter((t) => t.status !== "open");
  return `<div class="pd-sum"><span>Danes <b>${day.length} poslov</b></span><span>Zaprtih skupaj <b>${closed.length}</b></span><span>Rezultat skupaj <b class="${cls(closed.reduce((a, t) => a + (+t.pnl_sol || 0), 0))}">${sgn(closed.reduce((a, t) => a + (+t.pnl_sol || 0), 0))} SOL</b></span></div>
  ${S.trades.length ? `<div class="pd-tbox"><table><thead><tr><th>Čas</th><th>Kovanec</th><th>Denarnica</th><th class="n">Vložek</th><th class="n">Rezultat</th><th class="n">SOL</th><th>Izhod</th><th>Tx</th></tr></thead><tbody>
  ${S.trades.map((t) => `<tr><td>${hm(t.opened_at)}</td><td>${esc(t.symbol || short(t.token))}</td><td>${esc(labelOf(t.wallet))}</td><td class="n">${nf(t.stake_sol, 3)}</td><td class="n ${cls(t.pnl_pct)}">${t.pnl_pct == null ? "odprto" : sgn(t.pnl_pct, 1) + " %"}</td><td class="n ${cls(t.pnl_sol)}">${t.pnl_sol == null ? "-" : sgn(+t.pnl_sol)}</td><td>${esc(t.exit_reason || "")}</td><td>${t.tx_buy ? `<a href="https://solscan.io/tx/${esc(t.tx_buy)}" target="_blank" rel="noreferrer">nakup</a>` : ""} ${t.tx_sell ? `<a href="https://solscan.io/tx/${esc(t.tx_sell)}" target="_blank" rel="noreferrer">prodaja</a>` : ""}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="pd-card"><p class="pd-empty">Še ni pravih poslov. Ko bo trgovanje zgrajeno in vklopljeno, bo tu vsak pravi posel z zraven senčnim poslom na istem signalu in povezavo na transakcijo.</p></div>`}`;
}
const R = [
  { k: "pravilo", l: "Pravilo izstopa", h: "katero senčno pravilo gre v živo", type: "sel", opts: Object.entries(RULES) },
  { k: "vlozek", l: "Vložek na posel", h: "razpon 0,01 do 0,5 SOL", u: "SOL", min: 0.01, max: 0.5, d: 2 },
  { k: "meja", l: "Dnevna meja izgube", h: "razpon 0,02 do 1 SOL; potem do polnoči ni nakupov", u: "SOL", min: 0.02, max: 1, d: 2 },
  { k: "hkrati", l: "Največ hkrati odprtih", h: "razpon 1 do 50", u: "poz.", min: 1, max: 50, d: 0 },
  { k: "na_uro", l: "Največ nakupov na uro", h: "razpon 1 do 120", u: "/ uro", min: 1, max: 120, d: 0 },
  { k: "zdrs_kup", l: "Zdrs pri nakupu", h: "razpon 0,5 do 10 %", u: "%", min: 0.5, max: 10, d: 1 },
  { k: "zdrs_pro", l: "Zdrs pri prodaji", h: "razpon 1 do 30 %", u: "%", min: 1, max: 30, d: 0 },
  { k: "isto_ime", l: "Isto ime, drug kovanec v 24 h", h: "varovalo iz 10. 10.", type: "bool" },
];
const RISKY_UP = ["vlozek", "meja", "hkrati", "na_uro", "zdrs_kup", "zdrs_pro"];
const rv = (r) => (r.k in S.draft ? S.draft[r.k] : S.settings?.[r.k]);
const fmtR = (r, v) => (r.type === "sel" ? RULES[v] : r.type === "bool" ? (v ? "preskoči" : "dovoli") : nf(v, r.d));
function warnR(r, v) {
  if (r.type === "bool") return v === false ? "Brez tega varovala bi bilo Zrcalo na zgodovini -3,93 namesto +2,31 SOL." : "";
  if (r.type === "sel") return "";
  if (isNaN(v)) return "Vpiši število.";
  if (v < r.min || v > r.max) return "Izven razpona, ne bo shranjeno.";
  const vl = Number(rv(R[1]));
  if (r.k === "meja" && v < vl * 2) return "Meja je manjša od dveh poslov.";
  if (r.k === "hkrati" && S.bal != null) { const need = v * (vl + 0.0025); if (need > S.bal) return `Za ${v} pozicij rabiš ~${nf(need, 2)} SOL (z najemnino za račune kovancev), na denarnici je ${nf(S.bal, 2)}. Ko denarja zmanjka, bot nakup preskoči.`; }
  if (r.k === "vlozek" && v > 0.1) return "Več kot 5-kratnik mikro testa.";
  return "";
}
function vVarovala() {
  const dis = S.owner ? "" : "disabled";
  return `<div class="pd-rules">${R.map((r) => {
    const v = rv(r), ch = r.k in S.draft;
    let f;
    if (r.type === "sel") f = `<select data-k="${r.k}" ${dis}>${r.opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    else if (r.type === "bool") f = `<select data-k="${r.k}" ${dis}><option value="1" ${v ? "selected" : ""}>preskoči</option><option value="0" ${!v ? "selected" : ""}>dovoli</option></select>`;
    else f = `<input data-k="${r.k}" inputmode="decimal" value="${nf(v, r.d).replace(/\s/g, "")}" ${dis}><span class="u">${r.u}</span>`;
    return `<div class="pd-rule ${ch ? "ch" : ""}"><span>${r.l}<small>${r.h}</small></span><div class="pd-field">${f}</div><span class="pd-warn" data-w="${r.k}">${ch ? esc(warnR(r, v)) : ""}</span></div>`;
  }).join("")}
  <div class="pd-rule"><span>Ob izpadu cen ali tika nad 2 min<small>varnostno, se ne izklopi</small></span><b>brez nakupov</b></div></div>
  ${S.owner ? `<div><button class="pd-btn gold" id="pdSaveR" type="button" ${Object.keys(S.draft).length ? "" : "disabled"}>Shrani varovala</button> <button class="pd-btn" id="pdResetR" type="button" ${Object.keys(S.draft).length ? "" : "disabled"}>Razveljavi</button></div>` : ""}
  <p class="pd-note">Meje veljajo v bazi in v funkciji izvrsi, ne samo v aplikaciji, zato delujejo tudi, ko je aplikacija zaprta. Vrednost zunaj razpona baza zavrne. Nova vrednost velja od naslednjega nakupa.</p>
  <div class="pd-card"><h3>Dnevnik sprememb</h3><div class="pd-log">${S.log.map(logLine).join("") || '<span class="pd-empty">Še ni sprememb.</span>'}</div></div>`;
}
function logLine(x) {
  const who = (x.who || "").split("@")[0];
  let what = "";
  if (x.kind === "varovala") what = Object.entries(x.changes).map(([k, [a, b]]) => { const r = R.find((y) => y.k === k); return r ? `${r.l}: ${fmtR(r, a)} → ${fmtR(r, b)}` : k; }).join("; ");
  else if (x.kind === "denarnica") what = `${esc(x.changes.label)}: ${x.changes.prej} → ${x.changes.zdaj}`;
  else if (x.kind === "vklop") what = "vklopil trgovanje";
  else if (x.kind === "izklop") what = "izklopil trgovanje";
  else if (x.kind === "prodaj-vse") what = "Prodaj vse zdaj (" + x.changes.odprtih + " odprtih)";
  else what = esc(x.changes.opis || x.kind);
  return `<span><b>${hm(x.t)}</b> · ${esc(who)} · ${what}</span>`;
}
function bindRules() {
  root.querySelectorAll("[data-k]").forEach((inp) => (inp.oninput = inp.onchange = () => {
    const r = R.find((x) => x.k === inp.dataset.k);
    let v = r.type === "sel" ? inp.value : r.type === "bool" ? inp.value === "1" : Number(String(inp.value).replace(/\s/g, "").replace(",", "."));
    const cur = S.settings?.[r.k];
    const same = r.type ? v === cur : Number(cur) === v;
    if (same) delete S.draft[r.k]; else S.draft[r.k] = v;
    inp.closest(".pd-rule").classList.toggle("ch", !same);
    root.querySelector(`[data-w="${r.k}"].pd-warn`).textContent = same ? "" : warnR(r, v);
    const bad = Object.entries(S.draft).some(([k, val]) => { const rr = R.find((y) => y.k === k); const w = warnR(rr, val); return w.startsWith("Izven") || w.startsWith("Vpiši"); });
    $("#pdSaveR").disabled = !Object.keys(S.draft).length || bad;
    $("#pdResetR").disabled = !Object.keys(S.draft).length;
  }));
  const save = $("#pdSaveR"), reset = $("#pdResetR");
  if (reset) reset.onclick = () => { S.draft = {}; render(); };
  if (save) save.onclick = () => {
    const ch = Object.entries(S.draft);
    const items = ch.map(([k, v]) => { const r = R.find((y) => y.k === k); return `${r.l}: <b>${fmtR(r, S.settings[k])}</b> → <b>${fmtR(r, v)}</b>`; });
    const risky = ch.some(([k, v]) => (k === "isto_ime" && v === false) || (RISKY_UP.includes(k) && Number(v) > Number(S.settings[k])) || k === "pravilo");
    ask("Spremembe varoval", items, async () => { await rpc("live_set_settings", { p: Object.fromEntries(ch) }); S.draft = {}; }, risky ? "high" : "normal", "POTRDI", "Shrani");
  };
}

// ---------- gumbi v glavi pogleda ----------
$("#pdLive").onclick = () => {
  const s = S.settings || {};
  if (s.live_on) return ask("Izklopiš trgovanje?", ["Novih nakupov ne bo več.", "Odprte pozicije se zaprejo po pravilih (cilj, meja, čas)."], () => rpc("live_set_on", { p_on: false }), "normal", "", "Izklopi");
  const lw = S.wallets.filter((w) => w.status === "sledi" && w.live).map((w) => esc(w.label));
  if (!lw.length) return ask("Najprej izberi denarnice", ["Nobena denarnica ni na <b>V živo</b>. Izberi jih v zavihku Denarnice in shrani."], async () => setTab("denarnice"), "normal", "", "Na Denarnice");
  ask("Vklopil boš trgovanje s pravim denarjem", [
    `Denarnice v živo: <b>${lw.join(", ")}</b>`,
    `Pravilo <b>${RULES[s.pravilo]}</b>, vložek <b>${nf(s.vlozek, 2)} SOL</b> na posel`,
    `Dnevna meja izgube <b>${nf(s.meja, 2)} SOL</b>, največ hkrati <b>${s.hkrati}</b>`,
    `Stanje denarnice: <b>${S.bal == null ? "ni podatka" : nf(S.bal, 4) + " SOL"}</b>`,
    "V tej verziji trgovanje še ni zgrajeno: stikalo se zapiše, bot pa ne kupuje, dokler ni končana faza 2.",
  ], () => rpc("live_set_on", { p_on: true }), "high", "VKLOPI", "Vklopi trgovanje");
};
$("#pdSell").onclick = () => {
  const n = S.trades.filter((t) => t.status === "open").length;
  ask("Prodaj vse zdaj", [`Vse odprte pozicije (${n}) se prodajo takoj po trenutni ceni, zdrs do ${nf(S.settings?.zdrs_pro, 0)} %.`, "Trgovanje se izklopi.", "Tega ni mogoče razveljaviti."], () => rpc("live_sell_all", {}), "danger", "PRODAJ", "Prodaj vse");
};

// ---------- preklop pogleda ----------
const isLive = () => document.body.classList.contains("m-live");
function setMode(m, save = true) {
  document.body.classList.toggle("m-live", m === "live");
  sw.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === m));
  if (save) try { localStorage.setItem(MODE_KEY, m); } catch {}
  header();
  if (m === "live") { setTab(S.tab); load(); window.scrollTo({ top: 0 }); }
}
sw.querySelectorAll("button").forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
let start = "demo";
try { start = localStorage.getItem(MODE_KEY) === "live" ? "live" : "demo"; } catch {}
setMode(start, false);
setInterval(() => { if (isLive() && !document.hidden && !ov.classList.contains("show") && !Object.keys(S.draft).length && !Object.keys(S.wdraft).length) load(); }, 30000);
