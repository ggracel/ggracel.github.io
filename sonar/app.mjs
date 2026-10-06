// foqs.si/sonar: posnetke zbira strežnik (Supabase cron vsakih 30 s -> tabela memecoin_snapshots), tudi ko je stran zaprta.
// Brskalnik ob odprtju naloži zadnjo uro posnetkov, potem bere samo nove. Pravila v1.0 tečejo v brskalniku.
const HISTORY_MIN = 60;
// Različica kode. Vsako pisanje v profil jo pošlje skupaj z novim naključnim žetonom; baza (sprožilec na memecoin_state)
// zavrne pisanje brez njiju. Tako star, pozabljen zavihek s staro kodo ne more več trgovati na račun (27. 9. 2026).
const CLIENT_VERSION = 693;
const newNonce = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
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
const SHADOW_STRATEGIES = ["v1.2-cilj50-jup-bot", "v1.2-cilj50-jup-bot-nakupi", "v1.2-cilj10-jup-bot", "v1.2-cilj50-jup-bot-brez-bundlov", "v1.2-cilj50-jup-p5", "v1.2-cilj50-jup-p10", "v1.2-cilj50-p5", "v1.2-cilj30-jup", "v1.2-cilj50-jup", "v1.0", "v1.0-cisto", "v1.0-jup", "v1.2-filter", "v1.2-cilj10", "v1.2-cilj50", "v1.2-cilj70", "v1.2-cilj100", "v1.2-sled7", "v1.2-srednje", "v2.2-dip", "v3-mirno", "v3-kontrola", "v2.0", "v2.0-brez-holderjev", "v2.1-preboj", "v2.2-dip-siroko"];
// Ustavljene: ne odpirajo novih poslov, zgodovina in odprti posli ostanejo (glej shadow.ts PAUSED). Ta seznam mora ustrezati shadow.ts.
const SHADOW_PAUSED = { "v1.2-cilj70": "3. 10.", "v1.2-cilj100": "3. 10.", "v1.2-sled7": "3. 10.", "v1.2-filter": "3. 10.", "v2.0": "20. 9.", "v2.0-brez-holderjev": "19. 9.", "v2.1-preboj": "20. 9.", "v2.2-dip-siroko": "20. 9.", "v1.2-srednje": "20. 9.", "v1.0-cisto": "25. 9." };
const SHADOW_LABEL = { "bankr-filter": "★ BANKR · Base launchi + filter deployerja", "bankr-filter-sled30": "★ BANKR · filter + sled 30 (pol +100, brez cilja)", "bankr-vsi": "★ BANKR · vsi Base launchi (kontrola)", "v1.2-cilj50-jup-bot": "★ TVOJ BOT od 28. 9. (1x na kovanec na 24 h, brez noči)", "v1.2-cilj50-jup-bot-nakupi": "★ NOVO · tvoj bot + vsaj 25 nakupov v 5 min", "v1.2-cilj10-jup-bot": "★ NOVO · tvoj bot s profilom Hitri (+10 / -5)", "v1.2-cilj50-jup-bot-brez-bundlov": "★ NOVO · tvoj bot brez bundlov", "v1.2-cilj50-jup-p5": "★ kontrola: stari bot do 28. 9. (brez omejitve na par, 24/7)", "v1.2-cilj50-jup-p10": "★ NOVO · Jupiter + pavza 10 min", "v1.2-cilj50-p5": "★ NOVO · DEX 30 s + pavza 5 min", "v1.2-cilj30-jup": "v1.2 Jupiter, cilj +30", "v1.2-cilj50-jup": "v1.2 Jupiter, cilj +50 (kontrola za +30)", "v1.0": "v1.0 +10/-5", "v1.0-cisto": "v1.0 čisto (brez sumljivih posnetkov)", "v1.0-jup": "v1.0 Jupiter (cene na 6 s)", "v1.2-filter": "v1.2 staro Srednje (pol +25, sled 20)", "v1.2-cilj10": "v1.2 cilj +10 / meja -5", "v1.2-cilj50": "v1.2 Srednje + cilj +50 (profil Srednje)", "v1.2-cilj70": "v1.2 Srednje + cilj +70", "v1.2-cilj100": "v1.2 Srednje + cilj +100", "v1.2-sled7": "v1.2 Srednje, sled 7 %", "v1.2-srednje": "v1.2 Srednje brez cilja (pol +20, sled 15)", "v2.2-dip": "v2.2 dip s kupci", "v3-mirno": "v3 mirno", "v3-kontrola": "v3 kontrola (naključni vstop)", "v2.0": "v2.0", "v2.0-brez-holderjev": "v2.0 brez holderjev", "v2.1-preboj": "v2.1 preboj", "v2.2-dip-siroko": "v2.2 dip s kupci, široko" };
const SHADOW_COLOR = { "bankr-filter": "#ff9f43", "bankr-filter-sled30": "#ffd166", "bankr-vsi": "#c47a2c", "v1.2-cilj50-jup-bot": "#46bec5", "v1.2-cilj50-jup-bot-nakupi": "#ff6fae", "v1.2-cilj10-jup-bot": "#c0eb75", "v1.2-cilj50-jup-bot-brez-bundlov": "#e8590c", "v1.2-cilj50-jup-p5": "#8ea2ff", "v1.2-cilj50-jup-p10": "#ffd43b", "v1.2-cilj50-p5": "#ff8787", "v1.2-cilj30-jup": "#00e5ff", "v1.2-cilj50-jup": "#8ea2ff", "v1.0": "#9fb0c8", "v1.0-cisto": "#dbe6f5", "v1.0-jup": "#a8ff60", "v1.2-filter": "#f0a6ff", "v1.2-cilj10": "#ffb3c7", "v1.2-cilj50": "#ffd166", "v1.2-cilj70": "#ffa94d", "v1.2-cilj100": "#ff6b6b", "v1.2-sled7": "#b197fc", "v1.2-srednje": "#c98cff", "v2.2-dip": "#46bec5", "v3-mirno": "#74c0fc", "v3-kontrola": "#adb5bd", "v2.0": "#62e4b3", "v2.0-brez-holderjev": "#ecbf69", "v2.1-preboj": "#6fa5ff", "v2.2-dip-siroko": "#ff9f7a" };
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
// 25. 9. 2026 (obrat-research.md): nižji cilj, na Jupitrovih cenah. Isti vstop kot v1.2, oba po Jupitru, zato razlika meri samo cilj.
SHADOW_RULES["v1.2-cilj30-jup"] = {
  vstop: [...SHADOW_RULES["v1.2-filter"].vstop, "Vstopna cena je sveža Jupitrova cena. Brez nje ali na sumljivem posnetku ni vstopa."],
  izstop: [
    "Pri +20 % proda polovico in premakne mejo na vstopno ceno.",
    "Cilj: pri +30 % proda vse preostalo (namesto +50 %).",
    "Do cilja sledilna meja 15 % pod najvišjo doseženo ceno. Trda meja -12 %.",
    "Vse preverjeno na vsaki Jupitrovi ceni (6 s, ne 30 s). Če Jupiter za kovanec ne odgovarja, izstopi po DEX Screenerju.",
    "Samo senca: na tvoje posle in na bota nima vpliva.",
  ],
};
SHADOW_RULES["v1.2-cilj50-jup"] = {
  vstop: SHADOW_RULES["v1.2-cilj30-jup"].vstop,
  izstop: SHADOW_RULES["v1.2-cilj30-jup"].izstop.map((x) => x.replace("pri +30 % proda vse preostalo (namesto +50 %)", "pri +50 % proda vse preostalo (kot profil Srednje)")),
};
// 28. 9. 2026: Bankr radar (Base). Preizkus prijateljevega pristopa: ne cena in vzorci, ampak kdo je lansiral.
SHADOW_RULES["bankr-filter"] = {
  vstop: [
    "Vir: nov kovanec, lansiran prek Bankr na verigi Base (javni API api.bankr.bot, brano na 30 s).",
    "Filter deployerja: ima X račun, kovanec ni testni, noben njegov prejšnji launch (ki smo ga videli) ni mrtev, največ 1 launch v 24 h pred tem.",
    "Vstop na prvem posnetku DEX Screenerja z likvidnostjo vsaj 5.000 $ in vsaj 2 nakupoma v 5 min (torej ko kdo drug že kupuje), med 30 s in 10 min po launchu (Bankr prvih 10 s zaračuna do 80 % provizije). Vsi launchi začnejo pri približno 10.000 $ MC, večina brez enega samega nakupa.",
    "Največ 5 odprtih poslov, en na kovanec.",
  ],
  izstop: [
    "Profil Srednje: pol pri +20 %, cilj +50 %, sled 15 %, trda meja -12 %, na posnetkih DEX Screenerja na 30 s.",
    "Rug izhod, če likvidnost pade pod 1.000 $. Časovna meja 24 h.",
    "Stroški 1,75 % provizije Bankr poola na vsaki strani plus 0,1 % vpliva na ceno (skupaj okrog 3,7 % na cel posel, 3,7-krat več kot na Solani).",
    "Samo senca. Na tvoje posle in na bota nima vpliva. Ozadje: bankr-pristop.md.",
  ],
};
// 28. 9. 2026: tretje pravilo. Isti vstop in filter, drug izstop: na Bankr launchih vstopamo ob rojstvu (10K MC), zato je dobiček v repu,
// ki ga cilj +50 % odreže. Polovica pri +100 %, ostanek brez cilja s sledilno mejo 30 % pod vrhom. Razlaga: sledilna-meja-razlaga.html.
SHADOW_RULES["bankr-filter-sled30"] = {
  vstop: SHADOW_RULES["bankr-filter"].vstop,
  izstop: [
    "Pol pri +100 %, brez cilja: ostanek proda sledilna meja 30 % pod najvišjo ceno od vstopa. Trda meja -12 % pred delno prodajo, na posnetkih DEX Screenerja na 30 s.",
    "Proti pravilu s ciljem +50 % meri samo eno stvar: ali se na Bankr launchih splača pustiti raketo teči.",
    ...SHADOW_RULES["bankr-filter"].izstop.slice(1),
  ],
};
SHADOW_RULES["bankr-vsi"] = {
  vstop: [SHADOW_RULES["bankr-filter"].vstop[0], "Brez filtra deployerja: vsak Base launch, ki dobi likvidnost vsaj 5.000 $. Kontrola, ki pove, koliko prinese sam filter.", ...SHADOW_RULES["bankr-filter"].vstop.slice(2)],
  izstop: SHADOW_RULES["bankr-filter"].izstop,
};
// 26. 9. 2026: ponovni vstop v isti kovanec v 1 do 3 min po izstopu je izgubljal v vseh virih (senca -7 %, dvojček -11 % na posel).
// Pavza po izstopu. p5 je natanko tvoj bot od 26. 9. (Srednje, Jupiter na 6 s, 5 min pavze), p10 in DEX-p5 sta primerjavi.
SHADOW_RULES["v1.2-cilj50-jup-p5"] = {
  vstop: [...SHADOW_RULES["v1.2-cilj50-jup"].vstop, "Po izstopu iz kovanca 5 min brez ponovnega vstopa vanj.", "Od 28. 9. je to KONTROLA: tako je bot delal do 28. 9. (brez omejitve na par, tudi ponoči). Razlika do pravila 'tvoj bot' meri samo omejitev na par in noč."],
  izstop: SHADOW_RULES["v1.2-cilj50-jup"].izstop,
};
// 30. 9. 2026: zrcalo bota od 28. 9. (bot.ts v23): kot p5, plus en vstop na kovanec na 24 h in brez vstopov 00 do 06.
SHADOW_RULES["v1.2-cilj50-jup-bot"] = {
  vstop: [...SHADOW_RULES["v1.2-cilj50-jup"].vstop, "Po izstopu iz kovanca 5 min brez ponovnega vstopa vanj.", "En vstop na kovanec na 24 h (28. 9.: prvi vstopi +1,50 SOL, ponovni -1,24 SOL čez teden).", "Brez vstopov med 00:00 in 06:00 po Ljubljani (28. 9.: 74 nočnih poslov, -0,68 SOL). Izstopi tečejo ves čas.", "To je natanko tvoj bot od 28. 9. 2026, na 0,07 SOL na posel. Proti kontroli 'stari bot' meri, koliko prineseta omejitev na par in noč."],
  izstop: SHADOW_RULES["v1.2-cilj50-jup"].izstop,
};
// 2. 10. 2026: kot tvoj bot, vstop samo pri vsaj 25 nakupih v 5 min. Meri, ali filter preseka rug pulle.
SHADOW_RULES["v1.2-cilj50-jup-bot-nakupi"] = {
  vstop: [...SHADOW_RULES["v1.2-cilj50-jup-bot"].vstop.slice(0, -1), "Vsaj 25 nakupov v zadnjih 5 min ob vstopu (brez podatka ni vstopa).", "Od 27. 9. so bili med 21 posli z manj kot 25 nakupi 3 rugi pod -50 %, med ostalimi 336 pa 2. Brez teh treh je bil donos obeh skupin enak (-2,1 % proti -2,2 % na posel), zato je to filter rugov, ne donosa, in sloni na treh primerih. Merimo, koliko rugov je med posli, ki jih to pravilo preskoči."],
  izstop: SHADOW_RULES["v1.2-cilj50-jup-bot"].izstop,
};
// 2. 10. 2026 (pregled 14 dni): isti vstop kot bot, izstop profila Hitri; in bot brez kovancev z bundli.
SHADOW_RULES["v1.2-cilj10-jup-bot"] = {
  vstop: SHADOW_RULES["v1.2-cilj50-jup-bot"].vstop.slice(0, -1).concat(["Vstop natanko kot tvoj bot, razlika je samo izstop."]),
  izstop: ["Vse proda pri +10 %, trda meja -5 % (profil Hitri), po Jupitrovih cenah na 6 s.", "V senci je bil +10 / -5 na istih vstopih boljši od profila Srednje 11 od 13 dni (-1,8 % proti -3,5 % na posel). Na tvojih poslih od 29. 9. bi bil rezultat -0,28 SOL namesto -0,55 SOL. Rugov ne ustavi, ker cena mejo preskoči."],
};
SHADOW_RULES["v1.2-cilj50-jup-bot-brez-bundlov"] = {
  vstop: SHADOW_RULES["v1.2-cilj50-jup-bot"].vstop.slice(0, -1).concat(["Ne vstopi, ko preverjanje verige kaže bundle: vsaj 3 od 10 največjih denarnic s skoraj enako količino (razlika pod 1 %), tipična sled enega kupca z več denarnicami. Brez podatka z verige vstopi.", "Od 23. 9. (2.205 vstopov): rugi pri bundle kovancih 2,4 %, pri ostalih 0,7 %, v obeh polovicah obdobja. Odreže okoli tretjino vstopov."]),
  izstop: SHADOW_RULES["v1.2-cilj50-jup-bot"].izstop,
};
SHADOW_RULES["v1.2-cilj50-jup-p10"] = {
  vstop: [...SHADOW_RULES["v1.2-cilj50-jup"].vstop, "Po izstopu iz kovanca 10 min brez ponovnega vstopa vanj."],
  izstop: SHADOW_RULES["v1.2-cilj50-jup"].izstop,
};
SHADOW_RULES["v1.2-cilj50-p5"] = {
  vstop: [...SHADOW_RULES["v1.2-filter"].vstop, "Po izstopu iz kovanca 5 min brez ponovnega vstopa vanj."],
  izstop: [...SHADOW_RULES["v1.2-cilj50"].izstop, "Cene z DEX Screenerja na 30 s (kot tvoj bot do 26. 9.). Proti pravilu Jupiter + pavza 5 min meri samo učinek hitrejše cene."],
};
// Pod drobnogledom: cilj +30 proti +50 na Jupitru. Lastno nalaganje (po straneh), ker glavna tabela
// naloži samo zadnjih nekaj tisoč senčnih poslov vseh pravil skupaj.
const SPOT_A = "v1.2-cilj30-jup",
  SPOT_B = "v1.2-cilj50-jup",
  SPOT_START = "2026-09-25T17:35:00Z";
let spotStats = new Map(),
  spotAt = 0;
async function loadSpot() {
  if (!db || Date.now() - spotAt < 55000) return;
  spotAt = Date.now();
  // Samo seštevki dveh pravil od začetka primerjave (strežnik jih izračuna), ne vsi posli.
  const { data, error } = await db.rpc("memecoin_lab", { p_since: SPOT_START, p_strategies: [SPOT_A, SPOT_B], p_filter: "none" });
  if (error || !data) return;
  spotStats = new Map((data.stats || []).map((x) => [x.s, labToStats(x)]));
}
// Pod drobnogledom 2 (28. 9. 2026): Bankr radar, izpostavljen na G-jevo željo.
const BANKR_A = "bankr-filter",
  BANKR_B = "bankr-vsi",
  BANKR_C = "bankr-filter-sled30",
  BANKR_START = "2026-09-28T07:30:00Z";
let bankrStats = new Map(),
  bankrAt = 0,
  bankrLaunches = null;
async function loadBankr() {
  if (!db || Date.now() - bankrAt < 55000) return;
  bankrAt = Date.now();
  const [lab, ln] = await Promise.all([
    db.rpc("memecoin_lab", { p_since: BANKR_START, p_strategies: [BANKR_A, BANKR_B, BANKR_C], p_filter: "none" }),
    db.from("memecoin_bankr_launches").select("filter_ok,dead,first_price_at,last_liq").eq("chain", "base").gte("launched_at", new Date(Date.now() - 24 * 3600000).toISOString()),
  ]);
  if (!lab.error && lab.data) bankrStats = new Map((lab.data.stats || []).map((x) => [x.s, labToStats(x)]));
  if (!ln.error && ln.data) bankrLaunches = ln.data;
}
function renderBankr(anchor) {
  let box = $("#cmpBankr");
  if (!box) {
    box = document.createElement("article");
    box.id = "cmpBankr";
    box.style.cssText = "border:2px solid #ff9f43;box-shadow:0 0 0 4px rgba(255,159,67,.1);margin-bottom:18px";
    anchor.parentNode.insertBefore(box, anchor);
  }
  const a = bankrStats.get(BANKR_A) || labToStats({}),
    b = bankrStats.get(BANKR_B) || labToStats({}),
    c = bankrStats.get(BANKR_C) || labToStats({});
  const mk = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };
  box.replaceChildren();
  const head = mk("div", "row");
  const h = mk("h3", "", "Pod drobnogledom: Bankr radar (Base)");
  h.style.color = "#ff9f43";
  head.append(h, mk("span", "badge", "NOV PRISTOP · SAMO SENCA · OD 28. 9."));
  box.append(head);
  box.append(mk("p", "muted", "Prijateljev pristop, preveden v senco: ne gleda cene in vzorcev, ampak kdo je kovanec lansiral. Vir so launchi prek Bankr na verigi Base, filter je ugled deployerja (X račun, brez mrtvih prejšnjih launchev, ni serijski). Izstop kot profil Srednje, stroški 1,75 % na stran (Bankr pool). Kontrola brez filtra pove, koliko prinese sam filter. Tretje pravilo (sled 30) ima isti vstop, a brez cilja +50 %: pol pri +100 %, ostanek vodi sledilna meja 30 % pod vrhom, ker na Bankr launchih vstopamo ob rojstvu in je dobiček v repu. Na tvoje posle in na bota nima vpliva."));
  const L = bankrLaunches || [];
  const withPrice = L.filter((x) => x.first_price_at).length,
    okN = L.filter((x) => x.filter_ok).length,
    deadN = L.filter((x) => x.dead).length;
  const grid = mk("div", "kpis");
  const col = (label, st, color) => {
    const k = mk("article", "kpi");
    const sm = mk("small", "", label);
    sm.style.color = color;
    const big = mk("strong", st.expectancy === null ? "" : tone(st.expectancy), st.expectancy === null ? "-" : pct1(st.expectancy));
    k.append(sm, big, mk("p", "", "na posel · " + st.closed.length + " zaključenih, " + st.open.length + " odprtih"), mk("p", "", "neto " + sol4(st.net) + " · dobitkov " + (st.winRate === null ? "-" : Math.round(st.winRate * 100) + " %")));
    return k;
  };
  const diff = a.expectancy !== null && b.expectancy !== null ? a.expectancy - b.expectancy : null;
  const n = Math.min(a.closed.length, b.closed.length);
  const dk = mk("article", "kpi resultKpi");
  dk.append(mk("small", "", "FILTER PROTI KONTROLI"), mk("strong", diff === null ? "" : tone(diff), diff === null ? "-" : (diff > 0 ? "+" : "") + plainMinus(diff.toLocaleString("sl-SI", { maximumFractionDigits: 2 })) + " točke"));
  dk.append(mk("p", "", n < 30 ? "Premalo poslov za sodbo (" + n + " / 100)." : n < 100 ? "Vmesni rezultat (" + n + " / 100)." : diff > 0 ? "Filter deployerja pomaga na " + n + " poslih." : "Filter deployerja ne pomaga na " + n + " poslih."));
  const track = mk("div", "wintrack");
  const fill = mk("span");
  fill.style.width = Math.min(100, n) + "%";
  track.append(fill);
  dk.append(track);
  const lk = mk("article", "kpi");
  lk.append(mk("small", "", "LAUNCHI ZADNJIH 24 H"), mk("strong", "", String(L.length)), mk("p", "", withPrice + " jih je dobilo ceno na DEX Screenerju · " + okN + " skozi filter"), mk("p", "", deadN + " že mrtvih (MC pod 10 % vrha ali likvidnost pod 1.000 $)"));
  grid.append(col("S FILTROM DEPLOYERJA", a, "#ff9f43"), col("FILTER + SLED 30 · BREZ CILJA", c, "#ffd166"), col("BREZ FILTRA · KONTROLA", b, "#c47a2c"), dk, lk);
  box.append(grid);
  box.append(mk("p", "muted", "Merilo je isto kot pri vseh pravilih: vsaj 100 zaključenih poslov, pozitivno pričakovanje po stroških in v obeh polovicah obdobja. Šele potem Telegram alarm in ločena denarnica, ne prej."));
}
function renderSpot(anchor) {
  let box = $("#cmpSpot");
  if (!box) {
    box = document.createElement("article");
    box.id = "cmpSpot";
    box.style.cssText = "border:2px solid #00e5ff;box-shadow:0 0 0 4px rgba(0,229,255,.08);margin-bottom:18px";
    anchor.parentNode.insertBefore(box, anchor);
  }
  const a = spotStats.get(SPOT_A) || labToStats({}),
    b = spotStats.get(SPOT_B) || labToStats({});
  const n = Math.min(a.closed.length, b.closed.length);
  const diff = a.expectancy !== null && b.expectancy !== null ? a.expectancy - b.expectancy : null;
  const mk = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };
  box.replaceChildren();
  const head = mk("div", "row");
  const h = mk("h3", "", "Pod drobnogledom: cilj +30 proti cilju +50");
  h.style.color = "#00e5ff";
  head.append(h, mk("span", "badge", "SAMO SENCA · OD 25. 9."));
  box.append(head);
  box.append(mk("p", "muted", "Isti vstop (v1.2), ista cena (Jupiter na 6 s), edina razlika je cilj. Posli se zaprejo na strežniku, tudi ko je stran zaprta. Na tvoje posle in na bota nima vpliva."));
  const grid = mk("div", "kpis");
  const col = (label, st, color) => {
    const k = mk("article", "kpi");
    const sm = mk("small", "", label);
    sm.style.color = color;
    const big = mk("strong", st.expectancy === null ? "" : tone(st.expectancy), st.expectancy === null ? "-" : pct1(st.expectancy));
    const p1 = mk("p", "", "na posel · " + st.closed.length + " zaključenih, " + st.open.length + " odprtih");
    const p2 = mk("p", "", "neto " + sol4(st.net) + " · dobitkov " + (st.winRate === null ? "-" : Math.round(st.winRate * 100) + " %"));
    k.append(sm, big, p1, p2);
    return k;
  };
  const dk = mk("article", "kpi resultKpi");
  dk.append(mk("small", "", "RAZLIKA NA POSEL"), mk("strong", diff === null ? "" : tone(diff), diff === null ? "-" : (diff > 0 ? "+" : "") + plainMinus(diff.toLocaleString("sl-SI", { maximumFractionDigits: 2 })) + " točke"));
  const verdict = n < 30 ? "Premalo poslov za sodbo (" + n + " / 100)." : n < 100 ? "Vmesni rezultat (" + n + " / 100). Za odločitev rabimo vsaj 100 poslov vsakega." : diff > 0 ? "Cilj +30 vodi na " + n + " poslih. Kandidat za profil v aplikaciji." : "Cilj +30 ne vodi na " + n + " poslih. Ostanemo pri +50.";
  dk.append(mk("p", "", verdict));
  const track = mk("div", "wintrack");
  const fill = mk("span");
  fill.style.width = Math.min(100, n) + "%";
  track.append(fill);
  dk.append(track);
  grid.append(col("CILJ +30 · NOVO", a, "#00e5ff"), col("CILJ +50 · KONTROLA", b, "#8ea2ff"), dk);
  box.append(grid);
}
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
// 5. 10. 2026 (G): Sonar je en sam bot, lastnikov (app_access role = 'owner'). Vsi na seznamu dostopa vidijo isti bot
// (Pozicije, Bilanca, Dnevnik, Kopiranje), nastavitve in ročne vstope pa spreminja samo lastnik; ostali so "samo ogled".
// botOwner: čigav bot gledamo (iz baze, rezervno G). viewer: prijavljeni ni lastnik -> nič se ne piše v profil.
const BOT_OWNER_FALLBACK = "4e881127-c45c-49d0-9e4c-21521715063c";
let botOwner = BOT_OWNER_FALLBACK,
  viewer = false;
function applyViewer() {
  document.body.classList.toggle("viewer", viewer);
  const tag = $("#viewTag");
  if (tag) tag.hidden = !viewer;
}
let remoteUser = null,
  remoteAuto = null,
  syncTimer = null;
// vodja (en samodejni bot na račun), glej claimLeader spodaj
let isLeader = !db,
  leaderInfo = "";
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
    try {
      const { data: own } = await db.rpc("sonar_owner_id");
      if (own) botOwner = own;
    } catch {}
    viewer = user.id !== botOwner;
    applyViewer();
    // Lokalni predpomnilnik velja samo, če pripada istemu botu (lastniku). Če se je v tem brskalniku prijavil kdo drug
    // (ali je predpomnilnik iz starejše različice brez lastnika), ga zavržemo in velja izključno profil.
    let owner = null;
    try {
      owner = localStorage.getItem(OWNER_KEY);
    } catch {}
    const localTrusted = owner === botOwner;
    if (!localTrusted) {
      trades = [];
      stake = 0.1;
      profile = DEFAULT_PROFILE;
      try {
        localStorage.setItem(OWNER_KEY, botOwner);
        localStorage.removeItem("solana-demo-v1");
        localStorage.removeItem("solana-auto-v1");
      } catch {}
    }
    const { data, error } = await db.from("memecoin_state").select("trades,stake,auto_entries,profile,updated_at").eq("user_id", botOwner).maybeSingle();
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
    if (viewer) syncNote("samo ogled · bot lastnika, naložen " + hhmm(new Date(data?.updated_at || Date.now()).getTime()));
    else if (!data || added) await pushRemote(true);
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
  // 26. 9. 2026: dve kopiji bota sta lahko vstopili na isti signal. Ohrani enega (prednost ima vstop po Jupitru).
  const DEDUPE_FROM = Date.parse("2026-09-25T22:00:00Z"); // od polnoči 26. 9. (začetek podvajanja po selitvi)
  const bySignal = new Map();
  for (const t of merged) {
    if (t.deletedAt || !t.automatic || t.practice || !t.signalAt || (t.opened || 0) < DEDUPE_FROM) continue;
    const k = t.id + "|" + t.signalAt;
    const prev = bySignal.get(k);
    if (!prev) bySignal.set(k, t);
    else {
      const [keep, drop] = (t.server && !prev.server) || (!prev.server && t.jup && !prev.jup) ? [t, prev] : [prev, t];
      drop.deletedAt = Date.now();
      drop.deleteReason = "Podvojen vstop: na isti signal sta vstopili dve kopiji bota.";
      bySignal.set(k, keep);
    }
  }
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
  const { data, error } = await db.from("memecoin_state").select("updated_at").eq("user_id", botOwner).maybeSingle();
  if (error) throw error;
  return !!data && stampMs(data.updated_at) !== remoteStamp;
}
async function syncRemote() {
  if (!db || !remoteUser) return;
  try {
    if (!(await remoteChanged())) return;
    const { data, error } = await db.from("memecoin_state").select("trades,updated_at").eq("user_id", botOwner).maybeSingle();
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
  if (viewer) return; // samo ogled: profil lastnika se ne piše
  const snapshot = () => JSON.stringify({ user_id: remoteUser.id, trades, stake, auto_entries: !!$("#auto")?.checked, profile });
  if (!force && snapshot() === lastPushed) return; // nič novega, ne pošiljaj (in ne beri) vsakih 30 s
  // Pred pisanjem združimo s profilom, da ne povozimo poslov iz drugega brskalnika, ampak samo, če ga je kdo medtem spremenil.
  try {
    if (await remoteChanged()) {
      const { data } = await db.from("memecoin_state").select("trades,updated_at").eq("user_id", botOwner).maybeSingle();
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
    const { error } = await db.from("memecoin_state").upsert({ ...row, updated_at: stamp, client_version: CLIENT_VERSION, write_nonce: newNonce() });
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
// ---------- Bot na strežniku 24/7 (27. 9. 2026) ----------
// Od v51 samodejne vstope in vse izstope vodi strežnik (bot.ts v funkciji collect, tabela memecoin_bot_trades),
// tudi ko je stran zaprta. Brskalnik jih tu bere (samo spremenjene vrstice) in jih prikaže kot običajne posle
// (ključ "srv-<id>", oznaka server). Ročni vstop vstavi vrstico, ročni izstop gre prek memecoin_bot_close.
// Odprte vrstice se na strežniku spreminjajo vsakih 30 s; v profil (memecoin_state) jih shranimo samo ob novem
// poslu ali spremembi stanja, sicer bi vsak tik pisal cel dnevnik (egress).
const SRV = "srv-";
const isoMs = (v) => (v ? new Date(v).getTime() : undefined);
function fromServer(r) {
  return {
    key: SRV + r.id,
    srvId: r.id,
    server: true,
    srvUpdated: isoMs(r.updated_at),
    id: r.pair,
    token: r.token,
    symbol: r.symbol || "?",
    practice: false,
    opened: isoMs(r.opened_at),
    lastObserved: isoMs(r.last_observed) || isoMs(r.opened_at),
    entry: r.entry_price,
    entryMcap: Number.isFinite(r.entry_mcap) ? r.entry_mcap : null,
    ...(r.jup ? { jup: true, jupT: isoMs(r.jup_t) } : {}),
    profile: r.profile,
    plan: r.plan,
    stop: r.stop,
    target: r.target,
    cap: r.cap,
    peak: r.peak,
    halfSold: !!r.half_sold,
    ...(r.half_sold ? { halfPrice: r.half_price, halfAt: isoMs(r.half_at) } : {}),
    ruleVersion: r.plan?.cap ? "1.3" : "1.2",
    reason: r.manual ? "Lastna odločitev" + (r.reason ? " · " + r.reason : "") : r.reason,
    automatic: !r.manual,
    signalAt: isoMs(r.signal_at) || isoMs(r.opened_at),
    sizeSOL: r.size_sol,
    slippagePerSide: 0.001,
    feePerSide: 0.0025,
    networkSOL: 0.0002,
    ...(r.status === "closed" ? { closed: isoMs(r.closed_at), exitObserved: isoMs(r.closed_at), exit: r.exit_price, pnl: r.pnl_sol, outcome: r.outcome } : {}),
    ...(r.status === "interrupted"
      ? { interrupted: true, gaps: [{ detectedAt: isoMs(r.updated_at), lastObserved: isoMs(r.last_observed) || null, reason: r.outcome || "Strežnik za ta par ni imel podatkov" }] }
      : {}),
  };
}
function applyServerRows(rows) {
  let persist = false,
    changed = false;
  for (const r of rows || []) {
    const nt = fromServer(r);
    const i = trades.findIndex((t) => t.key === nt.key);
    if (i < 0) {
      trades.push(nt);
      persist = changed = true;
      continue;
    }
    const old = trades[i];
    if ((old.srvUpdated || 0) >= (nt.srvUpdated || 0)) continue;
    for (const k of ["deletedAt", "deleteReason", "restoredAt"]) if (old[k] !== undefined) nt[k] = old[k];
    if (!!old.closed !== !!nt.closed || !!old.interrupted !== !!nt.interrupted || old.halfSold !== nt.halfSold) persist = true;
    trades[i] = nt;
    changed = true;
  }
  if (persist) save();
  return changed;
}
let srvBusy = false;
async function syncServerTrades() {
  if (!db || !remoteUser || srvBusy) return;
  srvBusy = true;
  try {
    const since = Math.max(0, ...trades.filter((t) => t.server).map((t) => t.srvUpdated || 0));
    const openSrv = trades.filter((t) => t.server && !t.closed && !t.interrupted && !t.deletedAt);
    // odprte strežniške posle vedno osvežimo (njihov zadnji žig v spominu je lahko novejši od shranjenega)
    const from = openSrv.length ? Math.min(since, ...openSrv.map((t) => t.srvUpdated || 0)) : since;
    const { data, error } = await db.from("memecoin_bot_trades").select("*").eq("user_id", botOwner).gt("updated_at", new Date(from).toISOString()).order("updated_at", { ascending: true }).limit(1000);
    if (error) throw error;
    if (applyServerRows(data)) draw();
  } catch {
    // naslednji krog
  } finally {
    srvBusy = false;
  }
}

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
    if (!t.practice && !t.server && !t.deletedAt && !t.closed && !t.interrupted && primed && lastSnapshotT - t.lastObserved > 75000) {
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
// 29. 9. 2026: graf odprte pozicije po isti poti, po kateri bot odloča (Jupitrove cene na 6 s), ne po 30 s posnetkih
// DEX Screenerja, ki lahko od Jupitra odstopajo za 5 do 10 % (GFB: DEX 132K nad ciljem, Jupiter 125K pod njim).
// Časovna os je prava (čas, ne zaporedna številka posnetka), zato se obe črti poravnata. Sledilna meja je narisana
// kot stopnice, kot se je res premikala. Označeni so vstop, polovična prodaja, vrh in zadnja cena (utrip).
const jupHist = new Map(); // token -> [{ t, p }] Jupitrove cene za odprte posle, od 5 min pred vstopom
async function loadJupHist(open) {
  const need = open.filter((t) => t.token && !t.closed && !t.interrupted);
  if (!need.length) return;
  const tokens = [...new Set(need.map((t) => t.token))];
  const fromOf = (tok) => {
    const h = jupHist.get(tok);
    return h?.length ? h.at(-1).t : Math.min(...need.filter((t) => t.token === tok).map((t) => t.opened)) - 5 * 60000;
  };
  const from = Math.min(...tokens.map(fromOf));
  const rows = await pagedRows(
    () =>
      db
        .from("memecoin_prices")
        .select("token,t,price")
        .in("token", tokens)
        .gt("t", new Date(from).toISOString())
        .order("t", { ascending: true })
        .order("token", { ascending: true }),
    3,
  );
  for (const r of rows) {
    if (!(r.price > 0)) continue;
    const tm = new Date(r.t).getTime();
    let h = jupHist.get(r.token);
    if (!h) jupHist.set(r.token, (h = []));
    if (!h.length || tm > h.at(-1).t) h.push({ t: tm, p: r.price });
    if (h.length > 6000) h.splice(0, h.length - 6000);
  }
}
function openChart(t, c, svg, legend) {
  svg.replaceChildren();
  if (legend) legend.replaceChildren();
  const add = (tag, attrs, text, parent = svg) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  };
  // na ozkem zaslonu (telefon) večje pisave, da so berljive
  const F = window.innerWidth < 700 ? 1.7 : 1;
  const X0 = 110, X1 = 680, Y0 = 22, Y1 = 186;
  const tStart = t.opened - 5 * 60000;
  const jup = (jupHist.get(t.token) || []).filter((v) => v.t >= tStart);
  const dex = (c?.history || []).filter((v) => v.t >= tStart && Number.isFinite(v.p) && v.p > 0);
  const nowPrice = c && c.price > 0 ? c.price : null;
  const nowT = c?.time || Date.now();
  const useJup = jup.length >= 2;
  const main = useJup ? jup : dex;
  if (main.length < 2 && !nowPrice) {
    add("text", { x: 25, y: 110, fill: "#a7b7ca" }, "Čakam na prve cene po vstopu …");
    return;
  }
  // zadnja točka = ista številka kot ploščica "MC zdaj"
  const path = main.slice();
  if (nowPrice && (!path.length || nowT > path.at(-1).t)) path.push({ t: nowT, p: nowPrice });
  const tEnd = Math.max(nowT, path.at(-1).t, t.opened + 60000);
  const x = (tm) => X0 + ((Math.min(Math.max(tm, tStart), tEnd) - tStart) / (tEnd - tStart)) * (X1 - X0);
  const mcOf = (p) => (c && mcAt(c, p) !== null ? mcAt(c, p) : Number.isFinite(t.entryMcap) && t.entry > 0 ? (t.entryMcap / t.entry) * p : null);
  const lab = (p) => (mcOf(p) !== null ? compact(mcOf(p)) : money(p));
  // sledilna meja kot stopnice: preigramo pot od vstopa z istimi pravili kot bot
  const plan = t.plan;
  const steps = [];
  let peak = t.entry, half = t.halfSold && !plan?.halfAt ? true : false, stop = plan ? t.entry * (1 - plan.hardStop) : t.stop;
  if (plan) {
    for (const v of path) {
      if (v.t < t.opened) continue;
      peak = Math.max(peak, v.p);
      if (plan.halfAt && !half && v.p >= t.entry * (1 + plan.halfAt) - 1e-9) { half = true; stop = Math.max(stop, t.entry); }
      if ((!plan.halfAt || half) && plan.trail) stop = Math.max(stop, peak * (1 - plan.trail));
      steps.push({ t: v.t, s: stop, trailing: (!plan.halfAt || half) && !!plan.trail });
    }
  }
  const stopNow = Number.isFinite(t.stop) ? t.stop : stop;
  const trailingNow = plan ? (!plan.halfAt || t.halfSold) && !!plan.trail : false;
  // obseg Y
  const refs = [t.entry, stopNow, plan?.cap && Number.isFinite(t.cap) ? t.cap : null, plan?.halfAt && !t.halfSold ? t.target : null, t.halfSold ? t.halfPrice : null, !plan ? t.target : null].filter((v) => Number.isFinite(v));
  const vals = [...path.map((v) => v.p), ...dex.map((v) => v.p), ...steps.map((v) => v.s), ...refs];
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min || max * 0.01) * 0.12, lo = min - pad, hi = max + pad;
  const y = (v) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
  // mreža in os Y
  for (let i = 0; i < 4; i++) {
    const value = lo + ((hi - lo) * i) / 3, yy = y(value);
    add("line", { x1: X0, x2: X1, y1: yy, y2: yy, stroke: "#2b3547" });
    add("text", { x: 3, y: yy + 4, fill: "#a7b7ca", "font-size": 11 * F }, lab(value));
  }
  // časovna os: lep korak, da je 4 do 7 oznak
  const span = tEnd - tStart;
  const stepMin = [1, 2, 5, 10, 15, 30, 60, 120, 240].find((m) => span / (m * 60000) <= 7) || 480;
  const first = Math.ceil(tStart / (stepMin * 60000)) * stepMin * 60000;
  for (let tm = first; tm <= tEnd; tm += stepMin * 60000) {
    add("line", { x1: x(tm), x2: x(tm), y1: Y0, y2: Y1, stroke: "#2b3547" });
    add("text", { x: x(tm), y: 220, fill: "#a7b7ca", "font-size": 11 * F, "text-anchor": "middle" }, new Date(tm).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" }));
  }
  // vodoravne ravni (vstop, cilj, pol), oznake desno brez prekrivanja
  const levels = [{ v: t.entry, color: "#e2e8f0", dash: "", tag: "VSTOP " + lab(t.entry) }];
  if (!plan) {
    levels.push({ v: t.target, color: "#62e4b3", dash: "2 4", tag: "CILJ " + lab(t.target) });
  } else {
    if (plan.cap && Number.isFinite(t.cap)) levels.push({ v: t.cap, color: "#ffd166", dash: "6 3", tag: "CILJ +" + Math.round(plan.cap * 100) + " % " + lab(t.cap) });
    if (plan.halfAt && !t.halfSold) levels.push({ v: t.target, color: "#62e4b3", dash: "2 4", tag: "POL +" + Math.round(plan.halfAt * 100) + " % " + lab(t.target) });
  }
  if (!steps.length) levels.push({ v: stopNow, color: trailingNow ? "#ecbf69" : "#ff858e", dash: "2 4", tag: (trailingNow ? "SLED " : "MEJA ") + lab(stopNow) });
  for (const l of levels) add("line", { x1: X0, x2: X1, y1: y(l.v), y2: y(l.v), stroke: l.color, "stroke-width": l.v === t.entry ? 1.6 : 1.2, "stroke-dasharray": l.dash, opacity: 0.9 });
  // DEX posnetki v ozadju (tanko, sivo), samo če glavna črta ni že DEX
  if (useJup && dex.length >= 2) add("polyline", { points: dex.map((v) => `${x(v.t)},${y(v.p)}`).join(" "), fill: "none", stroke: "#7f96b5", "stroke-width": 1.2, opacity: 0.55 });
  // stopnice sledilne meje
  if (steps.length) {
    const pts = [];
    let prev = null;
    for (const s of steps) {
      if (prev !== null && s.s !== prev) pts.push(`${x(s.t)},${y(prev)}`);
      pts.push(`${x(s.t)},${y(s.s)}`);
      prev = s.s;
    }
    pts.push(`${x(tEnd)},${y(prev)}`);
    const hard = steps.filter((s) => !s.trailing), tr = steps.filter((s) => s.trailing);
    if (hard.length) add("polyline", { points: [...hard.map((s) => `${x(s.t)},${y(s.s)}`), `${x(tr.length ? tr[0].t : tEnd)},${y(hard.at(-1).s)}`].join(" "), fill: "none", stroke: "#ff858e", "stroke-width": 1.6, "stroke-dasharray": "3 4" });
    if (tr.length) {
      const tp = [];
      let pv = null;
      for (const s of tr) {
        if (pv !== null && s.s !== pv) tp.push(`${x(s.t)},${y(pv)}`);
        tp.push(`${x(s.t)},${y(s.s)}`);
        pv = s.s;
      }
      tp.push(`${x(tEnd)},${y(pv)}`);
      add("polyline", { points: tp.join(" "), fill: "none", stroke: "#ecbf69", "stroke-width": 1.8 });
    }
    levels.push({ v: steps.at(-1).s, color: steps.at(-1).trailing ? "#ecbf69" : "#ff858e", tag: (steps.at(-1).trailing ? "SLED " : "MEJA ") + lab(steps.at(-1).s) });
  }
  // glavna črta (Jupiter), strnjena po stolpcih zaslona
  const cols = new Map();
  for (const v of path) { const k = Math.round(x(v.t)); cols.set(k, v); }
  const drawn = [...cols.values()];
  add("polyline", { points: drawn.map((v) => `${x(v.t)},${y(v.p)}`).join(" "), fill: "none", stroke: "#9bedcf", "stroke-width": 2.6, "stroke-linejoin": "round" });
  // dogodki
  const marks = [];
  marks.push({ x: x(t.opened), y: y(t.entry), color: "#e2e8f0", text: "VSTOPIL" });
  if (t.halfSold && Number.isFinite(t.halfPrice)) marks.push({ x: x(t.halfAt || t.opened), y: y(t.halfPrice), color: "#62e4b3", text: "POL ✓ " + lab(t.halfPrice) });
  const after = path.filter((v) => v.t >= t.opened);
  if (after.length) {
    const top = after.reduce((a, b) => (b.p > a.p ? b : a));
    if (top.p > t.entry * 1.02 && !(nowPrice && top.t === nowT)) marks.push({ x: x(top.t), y: y(top.p), color: "#ffd166", text: "VRH " + pct1((top.p / t.entry - 1) * 100) });
  }
  for (const m of marks) {
    add("circle", { cx: m.x, cy: m.y, r: 4.5, fill: m.color, stroke: "#0b1220", "stroke-width": 1.5 });
    const anchor = m.x > X0 + (X1 - X0) * 0.8 ? "end" : "start";
    add("text", { x: m.x + (anchor === "end" ? -8 : 8), y: m.y < Y0 + 16 ? m.y + 16 : m.y - 8, fill: m.color, "font-size": 10 * F, "font-weight": 700, "text-anchor": anchor }, m.text);
  }
  // zadnja cena: utrip + ista številka kot ploščica
  const last = path.at(-1);
  const pulse = add("circle", { cx: x(last.t), cy: y(last.p), r: 5, fill: "#9bedcf", opacity: 0.5 });
  add("animate", { attributeName: "r", values: "5;11;5", dur: "1.8s", repeatCount: "indefinite" }, undefined, pulse);
  add("animate", { attributeName: "opacity", values: "0.5;0;0.5", dur: "1.8s", repeatCount: "indefinite" }, undefined, pulse);
  add("circle", { cx: x(last.t), cy: y(last.p), r: 4, fill: "#9bedcf", stroke: "#0b1220", "stroke-width": 1.5 });
  levels.push({ v: last.p, color: "#9bedcf", tag: "ZDAJ " + lab(last.p), bold: true });
  // oznake ravni desno, razmaknjene, da se ne prekrivajo
  const tags = levels.map((l) => ({ ...l, ty: y(l.v) + 4 })).sort((a, b) => a.ty - b.ty);
  for (let i = 1; i < tags.length; i++) if (tags[i].ty - tags[i - 1].ty < 12 * F) tags[i].ty = tags[i - 1].ty + 12 * F;
  for (let i = tags.length - 2; i >= 0; i--) if (tags[i + 1].ty - tags[i].ty < 12 * F) tags[i].ty = tags[i + 1].ty - 12 * F;
  for (const g of tags) {
    const w = g.tag.length * 5.6 * F + 8;
    add("rect", { x: X1 + 2, y: g.ty - 9 * F, width: w, height: 12 * F, rx: 3, fill: "#0b1220", opacity: 0.85 });
    add("text", { x: X1 + 6, y: g.ty, fill: g.color, "font-size": 9.5 * F, "font-weight": 700 }, g.tag);
  }
  svg.setAttribute("viewBox", "0 0 " + (X1 + Math.round(100 * F)) + " 230");
  if (legend) {
    const items = [
      { color: "#9bedcf", dash: "", label: useJup ? "Cena po Jupitru (6 s), po njej bot odloča" : "Cena iz posnetkov DEX Screenerja (Jupiter brez cene)" },
      ...(useJup && dex.length >= 2 ? [{ color: "#7f96b5", dash: "", label: "Posnetki DEX Screenerja (30 s), samo za primerjavo" }] : []),
      { color: "#e2e8f0", dash: "", label: "Vstop " + lab(t.entry) },
      ...(steps.length ? [{ color: "#ff858e", dash: "3 4", label: "Trda meja" }, ...(plan?.trail ? [{ color: "#ecbf69", dash: "", label: "Sledilna meja (stopnice sledijo vrhu)" }] : [])] : []),
      ...levels.filter((l) => l.tag.startsWith("CILJ") || l.tag.startsWith("POL")).map((l) => ({ color: l.color, dash: l.dash, label: l.tag })),
    ];
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
    // Jupitrova cena ob posnetku (zbiralec jo vpiše samo, če je sveža, prebrana v zadnjih 20 s)
    jupPrice: r.jup_price > 0 ? r.jup_price : null,
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
      .select("pair,t,token,symbol,name,price,mcap,fdv,liquidity,volume5m,pair_created_ms,image,url,change1h,buys5m,sells5m,has_twitter,twitter_status,has_telegram,has_website,boost_total,source,suspect,jup_price")
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
// 26. 9. 2026: pavza po izstopu. Ponovni vstop v isti kovanec v 1 do 3 min po izstopu je 25. in 26. 9. izgubljal
// v vseh virih (senca -7 %, dvojček -11 % na posel): po padcu cena malo odskoči in vzorec to vidi kot odboj.
// Velja samo za samodejne vstope; ročni vstop je vedno dovoljen. Pavza teče od izstopa, ne glede na razlog.
// 28. 9. 2026: strežnik vstopa v par največ enkrat na 24 h (ponovni vstopi so bili na slabih dneh -1,50 SOL, prvi -0,77)
// in ne vstopa med 00:00 in 06:00 (28. 9.: 74 nočnih poslov, -0,68 SOL). Brskalnik to samo prikaže pri signalu.
const PAUSE_MS = 24 * 3600000;
const NIGHT_FROM = 0, NIGHT_TO = 6;
const nightNow = (tm) => { const h = new Date(tm).getHours(); return h >= NIGHT_FROM && h < NIGHT_TO; };
// 27. 9. 2026: samodejne vstope vodi strežnik (bot.ts). Brskalnik samo prikazuje signale in opozorila.
const BROWSER_AUTO = false;
function pausedPair(id, tm) {
  const t = trades.find((t) => t.id === id && !t.deletedAt && !t.practice && tm - (t.opened || 0) < PAUSE_MS);
  return t ? Math.max(1, Math.ceil((PAUSE_MS - (tm - t.opened)) / 60000)) : 0;
}
// Pravila za en nov posnetek kovanca c ob času tm: zapiranje odprtih poslov, samodejni vstop, opozorila.
// 26. 9. 2026: posli z vstopom po Jupitru (t.jup) izstopajo po Jupitrovih cenah na 6 s (applyJupPath). Posnetek
// DEX Screenerja jih zapre samo, ko Jupiter za kovanec nima sveže cene (posnetek brez jup_price).
function applyTradeLogic(c, tm) {
  const id = c.id,
    price = c.price;
  for (const t of trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.server && t.id === id)) {
    if (tm - t.lastObserved > 75000) interruptTrade(t, "Strežnik za ta par ni imel podatkov več kot 75 sekund");
    t.lastObserved = tm;
    if (!t.interrupted) {
      if (t.jup && c.jupPrice) continue;
      const why = stepExit(t, price);
      if (why) closeAt(t, price, tm, why + (t.jup ? " (DEX, Jupiter brez cene)" : ""));
    }
  }
  const s = signal(c);
  const pauseLeft = s.signal ? pausedPair(id, tm) : 0;
  const blocked = s.signal
    ? unreliable(id, tm)
      ? "nezanesljivi podatki: DEX Screener in Jupiter se razhajata"
      : nightNow(tm)
        ? "med 00:00 in 06:00 bot ne vstopa (nočni posli so izgubljali)"
        : pauseLeft
          ? "v ta kovanec je bot danes že vstopil, naslednji vstop čez " + (pauseLeft >= 60 ? Math.ceil(pauseLeft / 60) + " h" : pauseLeft + " min")
          : entryFilter(c)
    : null;
  // 27. 9. 2026: vstop samo na svežem posnetku. Ko se zavihek zbudi (računalnik je spal), preigra zamujene posnetke;
  // izstope odprtih poslov še vedno preigramo, novih vstopov za nazaj pa ne odpiramo.
  const freshTick = Date.now() - tm < 90000;
  if (
    s.signal &&
    !blocked &&
    freshTick &&
    $("#auto").checked &&
    BROWSER_AUTO &&
    !trades.some((t) => !t.deletedAt && !t.interrupted && !t.closed && t.id === id) &&
    trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).length < 5
  ) {
    enter(c, s, true);
  }
  if (s.signal && Date.now() - (announced.get(id) || 0) > 300000) {
    alerts.unshift(`${time(Date.now())} · ${c.symbol} · ${s.name}` + (blocked ? (pauseLeft ? " · brez vstopa: " : " · brez vstopa, izven filtra: ") + blocked : ""));
    announced.set(id, Date.now());
  }
}
// Odprti posli ob vrnitvi na stran: strežnik je cene videl tudi, ko brskalnik ni bil odprt, zato jih preigramo.
async function reconcileOpenTrades() {
  let changed = false;
  for (const t of trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice && !t.server)) {
    try {
      const from = t.lastObserved || t.opened;
      const data = await pagedRows(() =>
        db.from("memecoin_snapshots").select("t,price,suspect,jup_price").eq("pair", t.id).gt("t", new Date(from).toISOString()).order("t", { ascending: true }),
      );
      // Posli po Jupitru: preigramo posnetke (vrzeli, rezerva brez Jupitra) in Jupitrove cene skupaj, po času.
      const jrows = t.jup
        ? await pagedRows(() =>
            db.from("memecoin_prices").select("t,price").eq("token", t.token).gt("t", new Date(t.jupT || from).toISOString()).order("t", { ascending: true }),
          )
        : [];
      const events = [...data.map((r) => ({ d: r, tm: new Date(r.t).getTime() })), ...jrows.map((r) => ({ j: r, tm: new Date(r.t).getTime() }))].sort((a, b) => a.tm - b.tm || (a.j ? -1 : 1));
      let prev = from;
      for (const e of events) {
        if (e.j) {
          if (e.tm <= (t.jupT || 0) || !(e.j.price > 0)) continue;
          t.jupT = e.tm;
          const why = stepExit(t, e.j.price);
          if (why) {
            closeAt(t, e.j.price, e.tm, why + " (Jupiter)");
            break;
          }
          continue;
        }
        const r = e.d;
        if (r.suspect) continue;
        const tm = e.tm;
        if (tm - prev > 75000) {
          interruptTrade(t, "Strežnik za ta par ni imel podatkov več kot 75 sekund");
          break;
        }
        prev = tm;
        t.lastObserved = tm;
        if (t.jup && r.jup_price > 0) continue;
        const why = stepExit(t, r.price);
        if (why) {
          closeAt(t, r.price, tm, why + (t.jup ? " (DEX, Jupiter brez cene)" : ""));
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
    // 28. 9. 2026: po spanju računalnika (ali dolgo skritem zavihku) ne dohitevamo več ur posnetkov po 1000 vrstic,
    // ampak naložimo samo zadnjo uro, kot ob odprtju. Posle od v51 vodi strežnik, zato vmesni posnetki niso potrebni.
    const since = primed ? Math.max(lastSnapshotT, Date.now() - HISTORY_MIN * 60000) : Date.now() - HISTORY_MIN * 60000;
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
    ? "● ZBIRALEC AKTIVEN · posnetek " + time(last) + " · " + coins.size + " kovancev · senca " + active + " pravil · dan " + day + (day > SHADOW_MIN_DAYS ? "" : " od " + SHADOW_MIN_DAYS)
    : busy && last && Date.now() - last > 120000
      ? "● NALAGAM · zavihek je bil v premoru (zadnji posnetek " + time(last) + "), nalagam sveže posnetke · bot na strežniku je ves čas tekel"
      : "● PREMOR · zadnji posnetek " + (last ? time(last) : "neznan") + " · čakam na nov posnetek · bot na strežniku teče naprej";
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
  $("#copy").hidden = v !== "copy";
  $("#reports").hidden = v !== "reports";
  for (const id of ["live", "history", "about", "watch", "overview", "compare", "kopiranje", "pregledi"])
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
                  : v === "copy"
                    ? "kopiranje"
                    : v === "reports"
                      ? "pregledi"
                      : m),
    );
  status();
  draw();
  renderExportReminder();
  syncMobileTabs();
}
// 29. 9. 2026: mobilna vrstica z zavihki (PWA). Vidna samo pod 700 px (CSS .mtabs). Klik kliče iste gumbe kot zgornji nav.
const MTABS = [
  { id: "watch", label: "Pozicije", icon: "M3 17l5-6 4 4 5-8 4 5" },
  { id: "overview", label: "Bilanca", icon: "M3 4h18v16H3z M7 14l3-3 3 2 4-5" },
  { id: "kopiranje", label: "Kopiranje", icon: "M8 8h12v12H8z M4 16V4h12" },
  { id: "pregledi", label: "Pregledi", icon: "M4 20V10 M10 20V4 M16 20v-6 M22 20H2" },
  { id: "more", label: "Več", icon: "M5 12h.01 M12 12h.01 M19 12h.01" },
];
let mtabsEl = null, mmoreEl = null;
function buildMobileTabs() {
  if (mtabsEl) return;
  mtabsEl = document.createElement("nav");
  mtabsEl.className = "mtabs";
  mtabsEl.setAttribute("aria-label", "Zavihki");
  for (const t of MTABS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mtab";
    b.dataset.id = t.id;
    b.innerHTML = '<i class="ind"></i><svg viewBox="0 0 24 24"><path d="' + t.icon + '"/></svg>' + t.label + (t.id === "watch" ? '<span class="mbadge" hidden></span>' : "");
    b.onclick = () => {
      if (t.id === "more") return toggleMore();
      closeMore();
      $("#" + t.id).click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    mtabsEl.append(b);
  }
  document.body.append(mtabsEl);
  document.addEventListener("click", (e) => { if (mmoreEl && !mmoreEl.contains(e.target) && !e.target.closest?.(".mtab")) closeMore(); });
}
function toggleMore() {
  if (mmoreEl) return closeMore();
  mmoreEl = document.createElement("div");
  mmoreEl.className = "mmore";
  const items = [["Dnevnik", () => $("#history").click()], ["Laboratorij", () => $("#compare").click()], ["Radar", () => $("#live").click()], ["Kako deluje", () => $("#about").click()], ["Nastavitve bota", () => $("#botPill").click()], ["Odjava", () => $("#logout").click()]];
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = () => { closeMore(); fn(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    mmoreEl.append(b);
  }
  document.body.append(mmoreEl);
}
function closeMore() { if (mmoreEl) { mmoreEl.remove(); mmoreEl = null; } }
function syncMobileTabs() {
  if (!mtabsEl) return;
  const cur = view === "dashboard" ? "overview" : view === "watching" ? "watch" : view === "journal" ? "more" : view === "comparison" ? "more" : view === "copy" ? "kopiranje" : view === "reports" ? "pregledi" : view === "info" ? "more" : view === "market" ? "more" : "";
  for (const b of mtabsEl.querySelectorAll(".mtab")) b.classList.toggle("on", b.dataset.id === cur);
  const n = trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice).length;
  const badge = mtabsEl.querySelector(".mbadge");
  if (badge) { badge.textContent = n; badge.hidden = !n; }
}
buildMobileTabs();
syncMobileTabs();
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
  // 26. 9. 2026: vstopna cena je sveža Jupitrova (ista kot pri izstopih), ker DEX Screener ceno predpomni do 30 s.
  // Brez sveže Jupitrove cene (ali pri razliki nad 50 %) ostane cena posnetka in izstopi po posnetkih kot prej.
  const jp = !c.practice && c.jupPrice > 0 && c.price > 0 && Math.abs(c.price / c.jupPrice - 1) <= 0.5 ? c.jupPrice : null;
  const px = jp || c.price;
  trades.push({
    key: crypto.randomUUID(),
    id: c.id,
    token: c.token,
    symbol: c.symbol,
    practice: !!c.practice,
    opened: Date.now(),
    lastObserved: c.time || Date.now(),
    entry: px,
    entryMcap: Number.isFinite(c.mcap) ? (c.mcap * px) / c.price : null,
    ...(jp ? { jup: true, jupT: c.time || Date.now(), entryDex: c.price } : {}),
    ...exitPlan(profile, px),
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

// 4. 10. 2026 (G: "pametno iskanje v dnevniku in bilanci"): živi filter po kovancu, ki se uporabi ob vsakem vtipkanem znaku.
// Ujema ticker, ime kovanca (iz spremljanih) in naslov; velikost črk in znak $ ne štejeta. Prazno polje = brez filtra.
// Filter vpliva samo na seznam vrstic, ne na seštevke, statistiko in graf.
const normQ = (v) => String(v || "").toLowerCase().replace(/\$/g, "").trim();
const searchQ = (sel) => normQ($(sel)?.value);
function coinName(token) {
  for (const c of coins.values()) if (c.token === token && c.name) return c.name;
  return "";
}
function tradeMatches(t, q) {
  if (!q) return true;
  return [t.symbol, t.token, coinName(t.token)].some((v) => v && String(v).toLowerCase().includes(q));
}
function journal() {
  renderReview();
  renderDeleted();
  renderEvents();
  $("#rows").replaceChildren();
  const jq = searchQ("#journalSearch");
  const shown = trades.filter((t) => !t.deletedAt && !t.interrupted && tradeMatches(t, jq)).reverse();
  $("#journalSearchNote").textContent = jq ? (shown.length ? plural(shown.length, "zadetek", "zadetka", "zadetki", "zadetkov") : "ni zadetkov") : "";
  for (const t of shown) {
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
  else if (!shown.length) $("#rows").textContent = "Noben posel se ne ujema z iskanjem. Izbriši polje, da vidiš vse.";
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
  try { localStorage.setItem("sonar-exported-at", String(Date.now())); } catch {}
  renderExportReminder();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
for (const id of ["export", "cmpExport", "journalExport"]) {
  const b = $("#" + id);
  if (b) b.onclick = exportJournal;
}

// Opozorilo, da se bliža konec senčnega testa. Pokaže se 3 dni prej in odšteva.
// Izvoza ne sprožimo sami, samo pokažemo gumb; klikne ga uporabnik.
// 3. 10. 2026: G je dnevnik 14-dnevnega testa poslal 2. 10. (izvoz 07:33 UTC), zato se opozorilo ne kaže več;
// enako po vsakem izvozu v tem brskalniku (sonar-exported-at).
const SHADOW_EXPORTED_AT = Date.parse("2026-10-02T07:33:24Z");
function renderExportReminder() {
  const daysRun = (Date.now() - SHADOW_START) / 86400000;
  const due = daysRun >= SHADOW_MIN_DAYS;
  let exportedAt = SHADOW_EXPORTED_AT;
  try { exportedAt = Math.max(exportedAt, Number(localStorage.getItem("sonar-exported-at")) || 0); } catch {}
  const exported = exportedAt >= SHADOW_START + (SHADOW_MIN_DAYS - SHADOW_WARN_DAYS) * 86400000;
  const show = !exported && daysRun >= SHADOW_MIN_DAYS - SHADOW_WARN_DAYS;
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
// 26. 9. 2026: en sam samodejni bot na račun. Po selitvi na /sonar sta na G-jevem računu hkrati trgovala star
// zavihek (/memecoins, stara koda) in nov, vstopi so se podvajali. Zdaj si kopija (zavihek, telefon) na strežniku
// vzame najem (memecoin_claim_leader, 90 s, obnova na 20 s). Samodejno vstopa samo kopija z najemom; ostale
// prikazujejo, izstopajo in dovolijo ročne posle. Ko glavna kopija utihne, najem v 90 s prevzame druga.
const INSTANCE = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
const DEVICE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "telefon" : "računalnik";
async function claimLeader() {
  if (!db || !remoteUser) {
    isLeader = true;
    return;
  }
  try {
    const { data, error } = await db.rpc("memecoin_claim_leader", { p_instance: INSTANCE, p_info: DEVICE });
    if (error) throw error;
    isLeader = !!data?.leader;
    leaderInfo = data?.info || "";
  } catch {
    // brez odgovora strežnika ostane zadnje znano stanje
  }
  renderBotPill();
}
window.addEventListener("pagehide", () => {
  if (isLeader && db && remoteUser) db.rpc("memecoin_release_leader", { p_instance: INSTANCE }).then(() => {}, () => {});
});
// (od v51 samodejno trguje strežnik, najem vodje se ne uporablja več)
// Nova različica: zavihek na 2 min preveri version.json in se ob novejši sam osveži (prej osveži še index.html v
// predpomnilniku, sicer bi GitHub Pages do 10 min vračal staro stran). Največ enkrat na različico na zavihek.
const APP_VERSION = CLIENT_VERSION;
// Različica je vidna v glavi (DEMO · v49), da se na prvi pogled vidi, ali zavihek teče na zadnji kodi.
// Prikaz različice kot 5.1, 5.2 ... (interno ostane celo število, 51 = 5.1)
// 3. 10. 2026 (G): drobni popravki dobijo tretjo številko. Od 6.5 naprej je interno trimestno: 651 = 6.5.1, 660 = 6.6.
// Številka se mora vseeno povečati ob vsaki objavi, sicer se odprti zavihki in telefon ne osvežijo sami.
const verLabel = (v) => (v >= 100 ? Math.floor(v / 100) + "." + (Math.floor(v / 10) % 10) + (v % 10 ? "." + (v % 10) : "") : (v / 10).toFixed(1));
if ($("#appVer")) $("#appVer").textContent = " · v" + verLabel(APP_VERSION);
async function checkVersion() {
  try {
    const r = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    const v = Number((await r.json())?.v);
    if (!(v > APP_VERSION)) return;
    const k = "sonar-reload-" + v;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, "1");
    await fetch("./", { cache: "reload" }).catch(() => {});
    location.reload();
  } catch {}
}
setInterval(checkVersion, 120000);
renderBotPill();
poll();
setInterval(poll, 30000);
syncServerTrades();
setInterval(syncServerTrades, 15000);
// Strežnik samodejno trguje šele, ko profil nosi client_version >= 51 (da ne trgujeta hkrati star zavihek in strežnik),
// zato ob odprtju nove različice profil enkrat zapišemo.
pushRemote(true);
// Na 6 s: Jupitrove cene za odprte pozicije. Prikaz (memecoin_prices_now) in od 26. 9. 2026 tudi izstopi:
// posli z vstopom po Jupitru (t.jup) gredo skozi vsako Jupitrovo ceno od zadnje obdelane (memecoin_prices),
// tako da tudi zamujen ali upočasnjen interval (skrit zavihek) ne preskoči nobene cene.
function applyJupPath(list, rows) {
  let changed = false;
  for (const t of list) {
    for (const r of rows) {
      if (r.token !== t.token || t.closed || t.interrupted) continue;
      const tm = new Date(r.t).getTime();
      if (tm <= (t.jupT || 0) || !(r.price > 0)) continue;
      t.jupT = tm;
      changed = true;
      const why = stepExit(t, r.price);
      if (why) closeAt(t, r.price, tm, why + " (Jupiter)");
    }
  }
  return changed;
}
let liveBusy = false;
async function fetchLive() {
  if (!db || !primed || liveBusy) return;
  const open = trades.filter((t) => !t.deletedAt && !t.interrupted && !t.closed && !t.practice && t.token);
  if (!open.length) return;
  liveBusy = true;
  try {
    const jupOpen = open.filter((t) => t.jup && !t.server);
    if (jupOpen.length) {
      const from = Math.min(...jupOpen.map((t) => t.jupT || t.opened));
      const rows = await pagedRows(
        () =>
          db
            .from("memecoin_prices")
            .select("token,t,price")
            .in("token", [...new Set(jupOpen.map((t) => t.token))])
            .gt("t", new Date(from).toISOString())
            .order("t", { ascending: true })
            .order("token", { ascending: true }),
        3,
      );
      if (applyJupPath(jupOpen, rows)) save();
    }
    try { await loadJupHist(open); } catch { /* graf brez Jupitrove poti pokaže posnetke */ }
    const tokens = [...new Set(open.map((t) => t.token))];
    const { data, error } = await db.from("memecoin_prices_now").select("token,price,t").in("token", tokens);
    if (!error && data) for (const r of data) if (r.price > 0) livePrices.set(r.token, { price: r.price, t: new Date(r.t).getTime() });
    if (view === "watching" && !document.hidden) renderOpenTrades();
  } catch {
    // napaka ne sme motiti ostalega; naslednji krog (ali posnetek brez Jupitra) nadaljuje
  } finally {
    liveBusy = false;
  }
}
setInterval(fetchLive, 6000);
setInterval(() => {
  if (view === "comparison" && !document.hidden) loadShadow();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    poll();
    syncServerTrades();
  }
});
// 3. 10. 2026 (izpad 2./3. 10.): rdeča vrstica, ko strežnik ne zbira ali sta senca in bot na pavzi.
// Bere tabelo memecoin_health, ki jo polnita varovalo v collect/znacilke in čuvaj v bazi (pg_cron vsaki 2 min).
const HEALTH_STALE_MS = 3 * 60000;
async function checkHealth() {
  const bar = document.getElementById("healthBar");
  if (!bar || !db) return;
  const hm = (iso) => new Date(iso).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Ljubljana" });
  const ago = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const msgs = [];
  try {
    const { data, error } = await db.from("memecoin_health").select("key,fails,last_ok,last_err,skip_until,updated_at");
    if (error) throw error;
    const h = Object.fromEntries((data || []).map((r) => [r.key, r]));
    const now = Date.now();
    const old = (r) => !r || !r.last_ok || now - new Date(r.last_ok).getTime() > HEALTH_STALE_MS;
    if (h.posnetki && now - new Date(h.posnetki.updated_at).getTime() > 6 * 60000) {
      msgs.push("Čuvaj strežnika se ni oglasil od " + hm(h.posnetki.updated_at) + ". Baza je morda preobremenjena.");
    } else {
      if (old(h.posnetki)) msgs.push("Strežnik ne zbira posnetkov" + (h.posnetki?.last_ok ? " od " + hm(h.posnetki.last_ok) + " (pred " + ago(h.posnetki.last_ok) + " min)" : "") + ". Bot ta čas ne vstopa.");
      if (old(h.cene)) msgs.push("Jupitrove cene stojijo" + (h.cene?.last_ok ? " od " + hm(h.cene.last_ok) : "") + ".");
    }
    const c = h.collect;
    if (c?.skip_until && new Date(c.skip_until).getTime() > now) msgs.push("Senca in bot sta na pavzi po " + c.fails + " zaporednih napakah do " + hm(c.skip_until) + ". Zadnja napaka: " + String(c.last_err || "?").slice(0, 120));
    else if (c?.last_ok && old(c) && !old(h.posnetki)) msgs.push("Senca in bot ne tečeta od " + hm(c.last_ok) + ".");
  } catch (e) {
    msgs.push("Stanja strežnika ni mogoče prebrati (" + String(e?.message || e).slice(0, 80) + "). Baza je morda nedosegljiva.");
  }
  bar.hidden = !msgs.length;
  bar.textContent = msgs.length ? "⚠ " + msgs.join(" ") : "";
}
setInterval(checkHealth, 60000);
setTimeout(checkHealth, 3000);
// Zbujanje po spanju računalnika: intervali med spanjem ne tečejo, zato ob prvem tiku po premoru takoj poberemo nove podatke.
let lastBeat = Date.now();
setInterval(() => {
  const gap = Date.now() - lastBeat;
  lastBeat = Date.now();
  if (gap > 20000) {
    poll();
    syncServerTrades();
  }
  status();
  if (mode === "live") draw();
}, 5000);

$("#auto").onchange = () => {
  if (viewer) { $("#auto").checked = !!remoteAuto; $("#autoSaved").textContent = "Samo ogled: nastavitve spreminja samo lastnik bota."; return; }
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
  txt.textContent = "BOT · " + (on ? "SAMODEJNO 24/7" : "ROČNO") + " · " + st + " SOL · " + p.name.toUpperCase() + (viewer ? " · SAMO OGLED" : "");
  pill.classList.toggle("off", !on);
  pill.title =
    (on ? "Bot sam odpira in zapira demo posle na strežniku, 24/7, tudi ko je stran zaprta." : "Bot ne odpira sam, vstopaš ročno. Izstope odprtih poslov strežnik vodi naprej.") + " Klik odpre nastavitve.";
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
    "Osveženo " + time(Date.now()) + " · zadnji posnetek " + (last ? time(last) : "še čakamo") + " · bot " + ($("#auto").checked ? "vstopa sam na strežniku (24/7)" : "ne vstopa sam");
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
$("#dashSearch").oninput = dashboard;
$("#journalSearch").oninput = journal;
// Mini bilanca na vrhu Pozicij: današnje številke, iste kot v Bilanci pri obdobju Danes.
function miniDash() {
  if (!$("#miniKpis")) return;
  const rate = solUsd || SOL_USD_FIXED,
    prices = new Map([...coins.values()].map((c) => [c.id, { price: c.price, fresh: fresh(c) }]));
  const o = overview(trades, { period: "today", quality: "all", rate, prices });
  const usd = (x) =>
    (x > 0 ? "+" : "") + new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  const mob = window.innerWidth < 700;
  $("#mkNet").textContent = (mob ? sol4(o.net).replace(" SOL", "") : signed(o.net)) + " SOL";
  $("#mkNet").className = tone(o.net);
  $("#mkUsd").textContent = "≈ " + usd(o.usd) + (mob ? "" : " · 1 SOL = " + usd(rate).replace("+", ""));
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
  $("#dashNet").textContent = (window.innerWidth < 700 ? sol4(o.net).replace(" SOL", "") : signed(o.net)) + " SOL";
  $("#dashNet").className = tone(o.net);
  $("#dashNet").setAttribute(
    "aria-label",
    (o.net > 0 ? "Dobiček " : o.net < 0 ? "Izguba " : "Nevtralno ") + signed(o.net) + " SOL po stroških",
  );
  // PnL v % (27. 9. 2026): neto deljen z vsoto vložkov zaključenih poslov v izbranem obdobju.
  const invested = o.closed.reduce((s, t) => s + (tradeSize(t) || 0), 0);
  const pnlPct = invested > 0 ? (o.net / invested) * 100 : null;
  const pnlShown = pnlPct === null ? null : Math.abs(pnlPct) < 0.005 ? 0 : pnlPct;
  const investedText = invested.toLocaleString("sl-SI", { maximumFractionDigits: 2 }) + " SOL";
  const pill = $("#dashPnl");
  if (pill) {
    pill.hidden = pnlShown === null;
    if (pnlShown !== null) {
      pill.textContent = (pnlShown > 0 ? "+" : "") + pnlShown.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace("\u2212", "-") + " %";
      pill.className = "pnlPill " + tone(pnlShown);
      pill.title = "Donos na vložen znesek v izbranem obdobju: " + investedText;
    }
  }
  $("#winFill").style.width = (o.success === null ? 0 : o.success * 100) + "%";
  const usd = (x) =>
    (x > 0 ? "+" : "") + new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  $("#dashUsd").textContent =
    "≈ " + usd(o.usd) + " · 1 SOL = " + usd(rate).replace("+", "") + (solUsd ? " (sproti, Jupiter)" : " (fiksen tečaj 22. 9.)");
  if (pnlShown !== null) {
    const basis = document.createElement("span");
    basis.className = "nw";
    basis.textContent = "% na vloženih " + investedText;
    $("#dashUsd").append(" · ", basis);
  }
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
  const dq = searchQ("#dashSearch");
  const recent = [...o.closed].filter((t) => tradeMatches(t, dq)).sort((a, b) => b.closed - a.closed);
  $("#dashSearchNote").textContent = dq ? (recent.length ? plural(recent.length, "zadetek", "zadetka", "zadetki", "zadetkov") + " v izbranem obdobju" : "ni zadetkov v izbranem obdobju") : "";
  const more = $("#recentMore");
  // Ob iskanju pokažemo vse zadetke naenkrat, gumb "Pokaži več" ni potreben.
  more.hidden = !!dq || recent.length <= 5;
  more.textContent = showAllRecent ? "Pokaži manj" : "Pokaži vseh " + recent.length + " v izbranem obdobju";
  for (const t of showAllRecent || dq ? recent : recent.slice(0, 5)) {
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
  rows.className = o.closed.length && recent.length ? "" : "empty";
  if (!o.closed.length) rows.textContent = "Za izbrano obdobje še ni zaključenih živih demo poslov. Vaje so samo v dnevniku.";
  else if (!recent.length) rows.textContent = "Noben zaključek v izbranem obdobju se ne ujema z iskanjem. Izbriši polje ali razširi obdobje.";
  // 3. 10. 2026 (G: "ko grem z miško gor, info po času"): časovna os in pregled po urah.
  // Krivulja je stopničasta po času zaključka posla; miška (ali prst) pokaže okno ure ali več ur:
  // koliko poslov se je zaprlo, koliko je okno prineslo in koliko je bilo skupaj do konca okna.
  const svg = $("#dashCurve");
  svg.replaceChildren();
  const box = svg.parentElement;
  box.querySelector(".curveTip")?.remove();
  svg.onpointermove = svg.onpointerleave = null;
  const done = o.closed.filter((t) => Number.isFinite(t.closed) && Number.isFinite(t.pnl)).sort((a, b) => a.closed - b.closed);
  if (done.length) {
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    const fmt = (x) => (x > 0 ? "+" : x < 0 ? "-" : "") + Math.abs(x).toLocaleString("sl-SI", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + " SOL";
    const H = 3600000;
    let cum = 0;
    const pts = done.map((t) => ({ t: t.closed, d: t.pnl, v: (cum += t.pnl), sym: t.symbol }));
    const first = pts[0].t, last = pts.at(-1).t;
    const spanH = (last - first) / H;
    const step = spanH <= 30 ? 1 : spanH <= 60 ? 2 : spanH <= 7 * 24 ? 6 : 24;
    const tzOff = (ms) => -new Date(ms).getTimezoneOffset() * 60000;
    const floorB = (ms) => { const loc = ms + tzOff(ms); return loc - (((loc % (step * H)) + step * H) % (step * H)) - tzOff(ms); };
    const t0 = floorB(first), t1 = Math.max(floorB(last) + step * H, t0 + step * H);
    const values = [0, ...pts.map((p) => p.v)], lo = Math.min(...values), hi = Math.max(...values), range = hi - lo || 0.001;
    const X = (ms) => 25 + ((ms - t0) / (t1 - t0)) * 650, Y = (v) => 190 - ((v - lo) / range) * 155;
    for (const v of [lo, 0, hi]) {
      svg.append(mk("line", { x1: 25, x2: 675, y1: Y(v), y2: Y(v), stroke: "#33465e", "stroke-dasharray": "4 5" }));
      const lab = mk("text", { x: 28, y: Math.max(16, Y(v) - 6), fill: "#a0b5d1", "font-size": 13 });
      lab.textContent = fmt(v);
      svg.append(lab);
    }
    const multiDay = new Date(t0).toDateString() !== new Date(t1 - 1).toDateString();
    const hm = (ms) => new Date(ms).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
    const dm = (ms) => new Date(ms).toLocaleDateString("sl-SI", { day: "numeric", month: "numeric" });
    const nB = Math.round((t1 - t0) / (step * H));
    const every = Math.max(1, Math.ceil(nB / 8));
    for (let i = 0; i <= nB; i += every) {
      const ms = t0 + i * step * H, x = X(ms);
      svg.append(mk("line", { x1: x, x2: x, y1: 30, y2: 194, stroke: "#1f2d42", "stroke-width": 1 }));
      const lab = mk("text", { x, y: 214, fill: "#7f93ad", "font-size": 12, "text-anchor": i === 0 ? "start" : i >= nB ? "end" : "middle" });
      lab.textContent = step >= 24 ? dm(ms) : multiDay && hm(ms) === "00:00" ? dm(ms) : hm(ms);
      svg.append(lab);
    }
    let d = "M" + X(t0) + "," + Y(0);
    for (const p of pts) d += " H" + X(p.t).toFixed(1) + " V" + Y(p.v).toFixed(1);
    d += " H" + X(t1);
    svg.append(mk("path", { d, fill: "none", stroke: o.net < 0 ? "#ff858e" : "#62e4b3", "stroke-width": 3, "stroke-linejoin": "round" }));
    // pregled po oknih
    const guide = mk("rect", { x: 0, y: 30, width: 0, height: 164, fill: "#46bec5", opacity: 0.12, visibility: "hidden" });
    const dot = mk("circle", { r: 5, fill: "#dce5f3", stroke: "#080d16", "stroke-width": 2, visibility: "hidden" });
    svg.append(guide, dot);
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    const tip = document.createElement("div");
    tip.className = "curveTip";
    tip.hidden = true;
    tip.style.cssText = "position:absolute;z-index:5;pointer-events:none;background:#0f1a2a;border:1px solid #2c4060;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.45;color:#dce5f3;box-shadow:0 6px 18px #0008;white-space:nowrap";
    box.append(tip);
    const show = (ev) => {
      const r = svg.getBoundingClientRect();
      const vx = ((ev.clientX - r.left) / r.width) * 700;
      if (vx < 25 || vx > 675) return hide();
      const ms = t0 + ((vx - 25) / 650) * (t1 - t0);
      const a = Math.min(floorB(ms), t1 - step * H), b = a + step * H;
      const inWin = pts.filter((p) => p.t >= a && p.t < b);
      const before = pts.filter((p) => p.t < b);
      const endV = before.length ? before.at(-1).v : 0;
      const winSum = inWin.reduce((s, p) => s + p.d, 0);
      guide.setAttribute("x", X(a)); guide.setAttribute("width", Math.max(1, X(b) - X(a))); guide.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(Math.min(b, t1))); dot.setAttribute("cy", Y(endV)); dot.setAttribute("visibility", "visible");
      const best = inWin.length ? inWin.reduce((m, p) => (p.d > m.d ? p : m)) : null, worst = inWin.length ? inWin.reduce((m, p) => (p.d < m.d ? p : m)) : null;
      tip.innerHTML = "";
      const line = (txt, color) => { const el = document.createElement("div"); el.textContent = txt; if (color) el.style.color = color; tip.append(el); };
      line((multiDay || step >= 24 ? dm(a) + " " : "") + hm(a) + " do " + hm(b));
      line(inWin.length ? inWin.length + (inWin.length === 1 ? " posel" : inWin.length < 5 ? " posli" : " poslov") + " · okno " + fmt(winSum) : "V tem oknu ni zaključenih poslov", inWin.length ? (winSum < 0 ? "#ff858e" : "#62e4b3") : "#7f93ad");
      line("Skupaj do " + hm(b) + ": " + fmt(endV), "#a0b5d1");
      if (inWin.length > 1) line("Najboljši " + best.sym + " " + fmt(best.d) + " · najslabši " + worst.sym + " " + fmt(worst.d), "#7f93ad");
      tip.hidden = false;
      const br = box.getBoundingClientRect();
      let left = ev.clientX - br.left + 14;
      if (left + tip.offsetWidth > br.width - 4) left = ev.clientX - br.left - tip.offsetWidth - 14;
      tip.style.left = Math.max(4, left) + "px";
      tip.style.top = Math.max(4, r.top - br.top + 8) + "px";
    };
    const hide = () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
    svg.onpointermove = show;
    svg.onpointerdown = show;
    svg.onpointerleave = hide;
    $("#curveNote").textContent =
      "Od 0 do " + fmt(o.net) + " · os je čas zaključka posla, okna po " + (step >= 24 ? "1 dan" : step + " h") + ". Z miško (ali prstom) čez graf vidiš, kaj se je zgodilo v posameznem oknu.";
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
  if (viewer) { $("#stakeMessage").textContent = "Samo ogled: nastavitve spreminja samo lastnik bota."; return; }
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
  if (viewer) return "Samo ogled: ročne vstope in nastavitve spreminja samo lastnik bota.";
  if (!fresh(c) || !Number.isFinite(c?.price) || c.price <= 0) return "Ročni vstop čaka na svežo pozitivno ceno.";
  if (trades.some((t) => !t.deletedAt && !t.interrupted && !t.closed && (t.id === c.id || t.token === c.token)))
    return "Ta kovanec že ima odprt demo posel.";
  if (trades.filter((t) => !t.practice && !t.deletedAt && !t.interrupted && !t.closed).length >= 5)
    return "Dosežena je meja petih odprtih poslov.";
  return "";
}
// Ročni vstop gre od v51 na strežnik (vrstica manual v memecoin_bot_trades), da izstope vodi bot tudi ob zaprti strani.
async function enterServer(c, s) {
  const jp = c.jupPrice > 0 && c.price > 0 && Math.abs(c.price / c.jupPrice - 1) <= 0.5 ? c.jupPrice : null;
  const px = jp || c.price;
  const plan = exitPlan(profile, px);
  const nowIso = new Date().toISOString();
  const row = {
    user_id: remoteUser.id,
    pair: c.id,
    token: c.token,
    symbol: c.symbol,
    profile: plan.profile,
    plan: plan.plan,
    opened_at: nowIso,
    signal_at: new Date(c.time || Date.now()).toISOString(),
    entry_price: px,
    entry_jup: c.jupPrice || null,
    entry_mcap: Number.isFinite(c.mcap) ? (c.mcap * px) / c.price : null,
    size_sol: stake,
    stop: plan.stop,
    target: plan.target,
    cap: plan.cap,
    peak: px,
    half_sold: false,
    last_observed: nowIso,
    reason: s?.name || "",
    status: "open",
    jup: !!jp,
    jup_t: jp ? nowIso : null,
    manual: true,
  };
  const { data, error } = await db.from("memecoin_bot_trades").insert(row).select().single();
  if (error) throw error;
  applyServerRows([data]);
  registerWatch(c);
  return true;
}
async function manualEntry(c, feedback) {
  const blocked = manualBlock(c);
  if (blocked) {
    $(feedback).textContent = blocked;
    draw();
    return false;
  }
  if (!c.practice && db && remoteUser) {
    try {
      await enterServer(c, signal(c));
    } catch (e) {
      $(feedback).textContent = "Vstopa ni bilo mogoče zapisati na strežnik: " + (e?.message || e);
      return false;
    }
  } else if (!enter(c, signal(c), false)) return false;
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
  shadowLab = { total: 0, openNow: 0, filterCount: 0, stats: new Map() },
  shadowError = "",
  shadowBusy = false;
// Negativne številke z navadnim minusom "-" (locale sicer vrne znak U+2212).
const plainMinus = (s) => s.replace(/\u2212/g, "-");
const pct1 = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + plainMinus(x.toLocaleString("sl-SI", { maximumFractionDigits: 1 })) + " %" : "-");
const sol4 = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + plainMinus(x.toLocaleString("sl-SI", { minimumFractionDigits: 4, maximumFractionDigits: 4 })) + " SOL" : "-");

// 25. 9. 2026: seštevki na strežniku (RPC memecoin_lab) za celo obdobje. Prej je brskalnik vsakih 60 s bral
// zadnjih 3000 poslov vseh pravil, kar je pri ~1.500 poslih na dan pokrilo le ~15 ur in porabilo veliko prenosa.
async function loadShadow() {
  if (!db || shadowBusy) return;
  shadowBusy = true;
  try {
    const days = $("#cmpPeriod").value;
    const since = days === "all" ? null : new Date(Date.now() - Number(days) * 86400000).toISOString();
    const { data, error } = await db.rpc("memecoin_lab", { p_since: since, p_strategies: null, p_filter: $("#cmpFilter").value || "all" });
    if (error) throw error;
    shadowTrades = data?.trades || [];
    shadowLab = { total: data?.total || 0, openNow: data?.open_now || 0, filterCount: data?.filter_count || 0, invalid: data?.invalid || 0, stats: new Map((data?.stats || []).map((x) => [x.s, labToStats(x)])) };
    shadowError = "";
  } catch (e) {
    shadowError = "Senčnih poslov ni bilo mogoče naložiti: " + (e?.message || e);
  } finally {
    shadowBusy = false;
  }
  renderComparison();
}
// Seštevek s strežnika v obliki, ki jo pričakuje izris (closed/open imata samo .length).
function labToStats(x) {
  const closed = x.closed || 0,
    wins = x.wins || 0,
    losses = x.losses || 0,
    winSol = x.win_sol || 0,
    lossSol = x.loss_sol || 0;
  return {
    closed: { length: closed },
    open: { length: x.open || 0 },
    wins,
    losses,
    winRate: closed ? wins / closed : null,
    avgWin: wins ? x.sum_win_pct / wins : null,
    avgLoss: losses ? x.sum_loss_pct / losses : null,
    pf: lossSol > 0 ? winSol / lossSol : winSol > 0 ? Infinity : null,
    expectancy: closed ? x.sum_pct / closed : null,
    net: x.net || 0,
    maxDD: x.max_dd || 0,
    rug: x.rug || 0,
    gap: x.gap || 0,
    curve: (x.curve || []).map(([t, v]) => ({ t, v: Number(v) })),
  };
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
  const total = shadowLab.total,
    openNow = shadowLab.openNow;
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
      (daysRun > SHADOW_MIN_DAYS ? " (prvih " + SHADOW_MIN_DAYS + " dni končanih, dnevnik poslan 2. 10.)" : " od " + SHADOW_MIN_DAYS) +
      " · " +
      total +
      " senčnih poslov v obdobju, " +
      openNow +
      " trenutno odprtih" +
      (shadowLab.invalid ? " · izločenih " + shadowLab.invalid + " neveljavnih (vstop ali izstop na lažni ceni)" : "") +
      " · osvežitev na 60 s.";
  }
  const stats = new Map(SHADOW_STRATEGIES.map((s) => [s, shadowLab.stats.get(s) || labToStats({})]));
  let lead = null;
  for (const [s, st] of stats) if (st.closed.length && (!lead || st.net > stats.get(lead).net)) lead = s;
  const rows = $("#cmpRows");
  rows.replaceChildren();
  renderSpot(rows.closest("article"));
  loadSpot().then(() => renderSpot(rows.closest("article")));
  // 2. 10. 2026: Bankr radar ustavljen (vsa tri pravila globoko v minusu), okvir ni več prikazan. Zgodovina ostane v bazi.
  for (const s of SHADOW_STRATEGIES) {
    const st = stats.get(s);
    const tr = document.createElement("tr");
    if (s === lead && st.net > 0) tr.className = "lead";
    if (s === SPOT_A) tr.style.cssText = "outline:2px solid #00e5ff;outline-offset:-2px;background:#0b2629";
    if (s === BANKR_A || s === BANKR_B) tr.style.cssText = "outline:2px solid #ff9f43;outline-offset:-2px;background:#2a1c0c";
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
      line.setAttribute("stroke-width", s === SPOT_A ? "4" : s === lead ? "3" : "2");
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
    ? "Prikazanih " + listed.length + " od " + shadowLab.filterCount + " · Vstop MC = market cap ob vstopu · Vrh = najvišja cena med poslom glede na vstop · s kazalcem nad vrstico vidiš razlog vstopa."
    : "V izbranem obdobju ni senčnih poslov za ta filter.";
}
$("#cmpPeriod").onchange = loadShadow;
$("#cmpFilter").onchange = loadShadow;


// Odprti demo posli: vrsta kartic z grafi na vrhu zavihka Kaj program spremlja.
// Vsaka kartica: rezultat v živo, graf s črtami VSTOPIL / CILJ / MEJA, razdalja do cilja in meje, ročni izstop.
let confirmClose = null,
  confirmCloseTimer = null;
function showOpenTrades() {
  navigate("watching", "live");
  $("#openRow").scrollIntoView({ behavior: "smooth", block: "start" });
}
function manualClose(t, feedbackEl) {
  if (viewer) { feedbackEl.textContent = "Samo ogled: posle zapira samo lastnik bota."; return; }
  const c = coins.get(t.id);
  if (!c || !(c.price > 0)) {
    feedbackEl.textContent = "Ni znane cene za ta kovanec, izstop ni mogoč.";
    return;
  }
  const stale = !fresh(c);
  const why = stale ? "Ročni izstop (po zadnji znani ceni)" : "Ročni izstop";
  if (t.server) {
    const jl = livePrices.get(t.token);
    const px = jl && jl.price > 0 && Date.now() - jl.t < 20000 && Math.abs(c.price / jl.price - 1) <= 0.5 ? jl.price : c.price;
    const pnl = markToMarket(t, px);
    const outcome = why + (t.halfSold && Number.isFinite(t.halfPrice) ? " · pol prodano pri " + pct1((t.halfPrice / t.entry - 1) * 100) : "");
    db.rpc("memecoin_bot_close", { p_id: t.srvId, p_price: px, p_pnl: pnl, p_outcome: outcome }).then(
      ({ data, error }) => {
        if (error || !data) feedbackEl.textContent = error ? "Izstop ni uspel: " + error.message : "Bot je ta posel že zaprl.";
        syncServerTrades();
      },
      () => (feedbackEl.textContent = "Izstop ni uspel, poskusi znova."),
    );
    closeAt(t, px, Date.now(), why);
    t.outcome = outcome;
    confirmClose = null;
    $("#feedback").textContent = "Ročni izstop poslan za " + t.symbol + " · neto " + signed(t.pnl) + " SOL.";
    draw();
    return;
  }
  closeAt(t, c.price, c.time, why);
  confirmClose = null;
  $("#feedback").textContent = "Ročni izstop zabeležen za " + t.symbol + " po " + mcText(c, c.price) + " · neto " + signed(t.pnl) + " SOL.";
  draw();
}
function renderOpenTrades() {
  syncMobileTabs();
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
    card.append(el("div", "ocGlow"));
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
    if (c || (jupHist.get(t.token) || []).length >= 2) openChart(t, c, svg, legend);
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
    id: 29,
    at: "2026-10-05T19:30:00Z",
    date: "5. 10. 2026",
    title: "Nov zavihek Pregledi: jutranji pregled bota in kopiranja v aplikaciji",
    short: "<b>Pregledi so v aplikaciji.</b> Jutranji pregled bota in kopiranja je zdaj zavihek: 14 dni na en pogled, izbrani dan, podrobnosti zložene.",
    body:
      "Vsako jutro ob 8:00 nastane pregled prejšnjega dne za bota in za kopiranje denarnic. Do zdaj je bil samo na ločeni strani, od 5. 10. je zavihek Pregledi: zgoraj 14 dni kot stolpci za oba sistema (klik izbere dan), pod tem bot in kopiranje drug ob drugem s štirimi ključnimi številkami in zaključkom v navadnem jeziku, vse ostalo (potek dneva, deli dneva, rep, pravila, zdravje, opozorila) je zloženo v vrstice, ki jih odpreš po potrebi. Zgodovina ni omejena na 7 dni. Na telefonu je Pregledi v spodnji vrstici namesto Laboratorija, ki je zdaj pod Več. Ni finančni nasvet.",
  },
  {
    id: 28,
    at: "2026-10-05T17:00:00Z",
    date: "5. 10. 2026",
    title: "Sonar je en sam bot: vsi vidijo istega, nastavitve spreminja lastnik",
    short: "<b>En bot za vse.</b> Vsi s povabilom vidijo isti bot (Pozicije, Bilanca, Dnevnik, Kopiranje); nastavitve in ročne vstope spreminja samo lastnik.",
    body:
      "Do zdaj je imel vsak račun svojega bota s svojimi nastavitvami in svojim dnevnikom. Od 5. 10. strežnik vodi en sam bot (lastnikov: 0,2 SOL, profil Srednje, samodejni vstopi), vsi s povabilom pa ga vidijo v celoti: iste Pozicije, Bilanca, Dnevnik, Laboratorij in Kopiranje. Nastavitve v piluli BOT, ročne vstope in zapiranje poslov lahko spreminja samo lastnik; ostali imajo oznako SAMO OGLED. Stari posli drugih računov ostanejo v bazi, a se ne prikazujejo in ne vodijo. Dostop do Sonarja ima samo, kdor je na seznamu povabljenih. Ni finančni nasvet, gre za demo.",
  },
  {
    id: 27,
    at: "2026-10-05T14:30:00Z",
    date: "5. 10. 2026",
    title: "Kopiranje: tabela poslov, pot cene in razlaga, tretje pravilo Sled",
    short: "<b>Kopiranje ima novo tabelo</b>: klik na vrstico pokaže pot cene in v navadnem jeziku, kaj bi se zgodilo s tvojim vložkom.",
    body:
      "Sekcija V živo je zdaj tabela: ena vrstica na kopiran nakup, trije stolpci za tri pravila (Zrcalo, Hitri, Sled), nad njo seštevki in filtri po denarnici, stanju in kovancu. Klik na vrstico odpre pot cene od vstopa (Jupiter, na 6 s) z oznakami, kje je katero pravilo izstopilo, in tri stavke, ki povejo, kaj bi se zgodilo s tvojim vložkom. Dokupi in drugi preskoki so skriti, gumb jih pokaže. Novo tretje pravilo Sled (pol pri +50 %, ostalo 25 % pod vrhom, meja -30 %) je nastalo iz analize 518 poslov teh denarnic: njihovi dobitki so veliki (mediana +61 %), zato jim fiksen cilj +10 % ne ustreza. Vložek na posel je isti kot pri botu (0,2 SOL). Vse je senca. Ni finančni nasvet.",
  },
  {
    id: 26,
    at: "2026-10-05T08:00:00Z",
    date: "5. 10. 2026",
    title: "Nov zavihek Kopiranje: senčno sledenje 8 denarnicam",
    short: "<b>Nov zavihek Kopiranje</b>: Sonar sledi 8 izbranim denarnicam in v senci kopira njihove nakupe. Brez denarja.",
    body:
      "Sonar od 5. 10. sledi 8 denarnicam, ki so bile izbrane po merilih iz dvomesečne analize verige (držanje vsaj 5 min, malo hitrih prodaj, plus v 7 dneh tudi brez največjega posla). Ko katera od njih kupi kovanec, strežnik v nekaj sekundah odpre senčni posel po Jupitrovi ceni in ga vodi na dva načina: Zrcalo proda, ko proda denarnica, Hitri pa sam pri +10 % ali -5 %. Zavihek pokaže neto rezultat obeh, zamik v sekundah, ceno zamika (koliko dražje kupiva kot oni), lestvico denarnic in posle v živo. Vse je senca, brez vpliva na bilanco. Ni finančni nasvet, gre za demo.",
  },
  {
    id: 25,
    at: "2026-10-04T12:00:00Z",
    date: "4. 10. 2026",
    title: "Iskanje po kovancu v Dnevniku in Bilanci",
    short: "<b>V Dnevniku in Bilanci je polje za iskanje</b>: vtipkaj ticker ali ime kovanca in seznam se filtrira sproti.",
    body:
      "Nad tabelo v Dnevniku in nad zadnjimi zaključki v Bilanci je polje za iskanje. Ujema ticker, ime kovanca in naslov, velikost črk ni pomembna. Seznam se filtrira ob vsakem vtipkanem znaku; ob iskanju v Bilanci se pokažejo vsi zadetki v izbranem obdobju, ne samo zadnjih pet. Seštevki, statistika in graf ostanejo za celotno obdobje. Ni finančni nasvet, gre za demo.",
  },
  {
    id: 24,
    at: "2026-10-03T09:00:00Z",
    date: "3. 10. 2026",
    title: "Bilanca: graf po času, izidi signalov, pospravljen Laboratorij",
    short: "<b>Graf v Bilanci ima zdaj časovno os</b>: z miško čez graf vidiš, kaj se je zgodilo v vsaki uri.",
    body:
      "Potek neto rezultata je zdaj narisan po času zaključka posla, ne več po zaporedju. Ko greš z miško (ali prstom) čez graf, se označi okno (1 h, pri daljših obdobjih 2 h, 6 h ali dan) in pokaže, koliko poslov se je v njem zaprlo, koliko je okno prineslo, koliko je bilo skupaj do konca okna ter najboljši in najslabši posel. V Laboratoriju so ustavljena štiri pravila, ki so bila na istih vstopih stalno slabša od cilja +50: cilj +70, cilj +100, sled 7 in staro Srednje; zgodovina ostane. Strežnik od zdaj za vsak signal po eni uri zapiše, kaj je cena naredila (najvišje, najnižje, po 15, 30 in 60 min), tudi za zadnjih 7 dni nazaj. Ni finančni nasvet, gre za demo.",
    tags: [["Bilanca", "ok"], ["Laboratorij", ""]],
  },
  {
    id: 23,
    at: "2026-10-03T08:15:00Z",
    date: "3. 10. 2026",
    title: "Izpad strežnika 2./3. 10. in varovala",
    short: "<b>Strežnik je stal od 2. 10. 18:17 do 3. 10. 09:27.</b> Vzrok je odpravljen, dodana so varovala in rdeča vrstica ob izpadu.",
    body:
      "Po samodejnem osveženju statistike baze je branje zadnjih 22 minut posnetkov začelo brati celo tabelo (1,2 milijona vrstic) in vsak klic je padel na časovni meji. Ker se je klic ponavljal vsakih 30 s, je čez noč izčrpal disk baze, zato so od okoli 00:45 postale počasne ali stale tudi prijava in ostale strani na foqs.si. Bot ta čas ni vstopal, senca ni merila. Popravki: funkciji branja (posnetki in Laboratorij) zdaj vsak klic načrtujeta znova in vedno uporabita indeks. Zbiralec in značilke imata varovalo: ne začneta, če prejšnji tek še teče, po treh zaporednih napakah pa se ustavita za 2 min, nato 4, 8, 16, največ 30 min, namesto da bi bazo udarjala vsakih 30 s. Čuvaj v bazi vsaki 2 minuti zapiše starost zadnjega posnetka in cene; ko je strežnik zastal, aplikacija na vrhu pokaže rdečo vrstico. Hramba ostane 7 dni.",
    tags: [["Strežnik", ""], ["Varovalo", "ok"]],
  },
  {
    id: 22,
    at: "2026-10-02T10:00:00Z",
    date: "2. 10. 2026",
    title: "Laboratorij: tvoj bot s profilom Hitri in brez bundlov",
    short: "<b>Dve novi senčni pravili:</b> tvoj bot z izstopom +10 / -5 in tvoj bot brez kovancev z bundli. Do 7. 10. samo merjenje.",
    body:
      "Pregled 14 dni: od 29. 9. so vso izgubo naredili štirje rugi (-0,71 SOL), brez njih bi bil bot rahlo v plusu. Med poslom se ruga ne da ujeti, ker cena v enem samem skoku pade z okoli 0 na -90 %. Zato dve meritvi. Prva ima isti vstop kot bot in izstop profila Hitri (vse pri +10 %, meja -5 %), ker je bil ta izstop v senci na istih vstopih boljši od Srednjega 11 od 13 dni. Druga je bot, ki ne vstopa v kovance z bundlom (vsaj 3 od 10 največjih denarnic s skoraj enako količino), kjer je bilo rugov 3,4-krat več. Odločitev 7. 10. Ni finančni nasvet, gre za demo.",
    tags: [["Laboratorij", "ok"]],
  },
  {
    id: 21,
    at: "2026-10-02T09:00:00Z",
    date: "2. 10. 2026",
    title: "Bankr radar ustavljen",
    short: "<b>Bankr radar je ustavljen</b> in umaknjen iz Laboratorija. Vsa tri pravila so bila globoko v minusu.",
    body:
      "Po štirih dneh: filter deployerja -11,5 % na posel, filter + sled 30 -19,7 % (0 dobitkov od 24), vsi launchi -9,5 %. Večina Bankr launchev nikoli ne dobi kupca, stroški Bankr poola pa so 3,7 % na cel posel. Zbiranje je ugasnjeno, odprti senčni posli so zaprti po zadnji znani ceni, zgodovina ostane v bazi. Ni finančni nasvet, gre za demo.",
    tags: [["Laboratorij", ""]],
  },
  {
    id: 20,
    at: "2026-10-02T07:30:00Z",
    date: "2. 10. 2026",
    title: "Bot ne prekine več posla, ko Jupiter še teče",
    short: "<b>Popravek bota:</b> posel se ne prekine več, dokler Jupiter pošilja cene. V Laboratoriju je novo pravilo 'tvoj bot + vsaj 25 nakupov'.",
    body:
      "Bot je posel prekinil, ko DEX Screener za par 75 s ni poslal posnetka, tudi če je Jupiter cene še pošiljal (TRUMPTY 1. 10., Neko in POCKET 30. 9., DARE in DRAIN 2. 10.). Zdaj Jupitrova cena šteje kot podatek: prekinitev velja samo, ko molčita oba vira, posel pa se do takrat vodi po Jupitru kot prej. Kdaj in kam bot vstopa, se ni spremenilo. Novo v Laboratoriju: pravilo, ki je natanko tvoj bot, a vstopi samo pri vsaj 25 nakupih v zadnjih 5 min. Od 27. 9. so bili med 21 posli z malo nakupi 3 rugi pod -50 % (WANT, PEPEINU, WOOBY), med ostalimi 336 pa 2. Ker vse sloni na treh primerih, je za zdaj samo v senci. Popravek v Laboratoriju: posel SFAI pravila v1.0 (30. 9., +48.996 % pri likvidnosti 0) je označen kot nemogoč izstop in ne šteje več; v1.0 je zato iz +22,7 SOL padel na -11,3 SOL. Odslej se tak posel (donos nad +500 % ali dobiček pri likvidnosti pod 1.000 $) označi sam. Ni finančni nasvet, gre za demo.",
    tags: [["Bot", "ok"], ["Laboratorij", ""]],
  },
  {
    id: 19,
    at: "2026-09-30T08:00:00Z",
    date: "30. 9. 2026",
    title: "Laboratorij: senca, ki je natanko tvoj bot",
    short: "<b>V Laboratoriju je novo pravilo 'tvoj bot od 28. 9.'</b> (1x na kovanec, brez noči). Staro 'Jupiter + 5 min' je zdaj označeno kot kontrola.",
    body:
      "Do zdaj je Laboratorij primerjal bota s pravilom, ki nima novih omejitev (29. 9.: bot 42 poslov, senca 133), zato številke niso bile primerljive. Novo pravilo zrcali bota natanko: vstop v1.0 + filter v1.2, Jupiter, pol +20, sled 15, trda -12, cilj +50, pavza 5 min, en vstop na kovanec na 24 h, brez vstopov 00 do 06. Staro pravilo ostane kot kontrola, razlika med njima meri samo omejitev na par in noč. Popravek pri botu: posel, ki je že prodal polovico in potem izgubi podatke, se zapre po zadnji znani ceni namesto da bi bil prekinjen; prej je iz bilance izginila tudi že realizirana polovica (PUMPTOBER 29. 9., popravljeno za nazaj: +0,0456 SOL). Ni finančni nasvet, gre za demo.",
    tags: [["Laboratorij", "ok"], ["Bot", ""]],
  },
  {
    id: 18,
    at: "2026-09-29T11:00:00Z",
    date: "29. 9. 2026",
    title: "Sonar na telefonu",
    short: "<b>Sonar deluje kot aplikacija na telefonu.</b> Odpri foqs.si/sonar v Chromu na Androidu in izberi \"Dodaj na začetni zaslon\".",
    body:
      "Pod 700 px širine ima Sonar novo postavitev: spodnji zavihki (Pozicije, Bilanca, Dnevnik, Lab, Več), kompaktne kartice odprtih pozicij z odsevom po rezultatu in grafom po Jupitru, tabele z vodoravnim drsenjem. Radar, Kako deluje, nastavitve bota in odjava so pod Več. Namestitev: Chrome na Androidu, meni s tremi pikami, Dodaj na začetni zaslon (ali Namesti aplikacijo). Isti podatki in isti račun kot na računalniku, stran se osvežuje sama. Ni finančni nasvet, gre za demo.",
    tags: [["Mobilno", "ok"]],
  },
  {
    id: 17,
    at: "2026-09-29T08:30:00Z",
    date: "29. 9. 2026",
    title: "Nov graf odprte pozicije",
    short: "<b>Graf odprte pozicije zdaj riše Jupitrove cene na 6 s</b>, po katerih bot res odloča, in sledilno mejo kot stopnice.",
    body:
      "Do zdaj je graf risal 30 s posnetke DEX Screenerja, bot pa izstopa po Jupitrovih cenah na 6 s. Ta dva vira se lahko razideta za 5 do 10 % (GFB 29. 9.: DEX 132K nad ciljem, Jupiter 125K pod njim), zato je graf včasih kazal ceno na cilju, bot pa ni prodal. Nov graf: glavna črta so Jupitrove cene (posnetki DEX ostanejo kot tanka siva črta za primerjavo), prava časovna os z oznakami, sledilna meja kot stopnice, kot se je res premikala, označeni vstop, polovična prodaja in vrh, zadnja cena utripa in je ista številka kot ploščica MC zdaj, napisi desno se ne prekrivajo več. Ni finančni nasvet, gre za demo.",
    tags: [["Pozicije", "ok"]],
  },
  {
    id: 16,
    at: "2026-09-28T16:30:00Z",
    date: "28. 9. 2026",
    title: "Bot: en vstop na kovanec na dan, ponoči ne vstopa",
    short: "<b>Bot vstopa v vsak kovanec največ enkrat na 24 h in med 00:00 in 06:00 ne vstopa.</b> Izstopi tečejo naprej kot prej.",
    body:
      "Pregled tedna: 22. do 25. 9. plus (+0,6 do +4,1 % na dan), od 26. 9. minus. Krivec ni bil preklop na Jupiter: senca s starimi pravili je bila v istih dneh še slabša (27. 9. -9,0 %). Obrnil se je trg (delež poslov, ki pridejo do +50 %, je padel z 20 na 6 do 11 %), dve najini spremembi pa sta škodo povečali. Prvič: pavza 5 min je ponovne vstope v isti kovanec samo prestavila v predal 5 do 10 min. Prvi vstopi v kovanec so bili čez teden +1,50 SOL, vsi ponovni vstopi skupaj -1,24 SOL; na dobrih dneh so bili ponovni vstopi približno nič, na slabih glavna luknja. Zato od zdaj en samodejni vstop na kovanec na 24 h. Drugič: 24/7 je dodal noč, blok 00 do 06 je 28. 9. dal 74 poslov in -0,68 SOL, več kot pol dnevne izgube. Zato bot med 00:00 in 06:00 ne vstopa, odprte posle pa vodi naprej. Ročni vstop je še vedno vedno dovoljen. Senca v Laboratoriju (Jupiter + pavza 5 min) teče naprej po starem, da se vidi, koliko sprememba prinese. Ni finančni nasvet, gre za demo.",
    tags: [["Bot", "ok"], ["Vstopi", ""]],
  },
  {
    id: 15,
    at: "2026-09-28T08:15:00Z",
    date: "28. 9. 2026",
    title: "Bankr radar: tretje pravilo brez cilja (sled 30)",
    short: "<b>Bankr radar ima tretje pravilo:</b> pol pri +100 %, brez cilja +50 %, ostanek vodi sledilna meja 30 % pod vrhom. Samo senca.",
    body:
      "Cilj +50 % je bil vzet iz profila Srednje, ki je narejen za Solano, kjer bot vstopa pri 20K do 300K MC. Na Bankr launchih vstopamo ob rojstvu (okrog 10.000 $ MC), zato je pričakovani dobiček v repu: redki kovanci, ki zrastejo 5x ali 10x, in cilj +50 % jih odreže. Tretje pravilo ima isti vstop in isti filter deployerja, drug izstop: polovica pri +100 %, brez cilja, ostanek proda sledilna meja 30 % pod najvišjo ceno od vstopa, trda meja -12 % in 24 h ostaneta. Proti pravilu s ciljem +50 % meri samo eno stvar: ali se na Bankr launchih splača pustiti raketo teči. V oranžnem okvirju Laboratorija je zdaj tretji stolpec. Razlaga sledilne meje: sledilna-meja-razlaga.html.",
    tags: [["Samo Laboratorij", ""], ["Base, Bankr", "ok"]],
  },
  {
    id: 14,
    at: "2026-09-28T08:00:00Z",
    date: "28. 9. 2026",
    title: "Laboratorij: Bankr radar (Base)",
    short: "<b>V Laboratoriju je nov pristop: Bankr radar.</b> Ne gleda cene, ampak kdo je kovanec lansiral. Samo senca, bot ostaja isti.",
    body:
      "Prijateljev bot dela drugače kot Sonar: ne išče vzorcev na grafu, ampak spremlja launche kovancev prek Bankr na verigi Base in oceni deployerja (X račun, prejšnji launchi, ali je kdaj rugal). Ta signal nastane pred ceno, kar je natanko tisto, česar Sonarju manjka pri vstopu. Zato ga preverimo v senci: strežnik vsakih 30 s bere javni Bankr API, shrani vsak launch, ugled deployerja računa iz lastne zgodovine in ceno bere z DEX Screenerja. Dve pravili: z filtrom deployerja in brez njega (kontrola). Izstop kot profil Srednje, stroški 1,75 % na stran, ker Bankr pooli toliko zaračunajo. Na vrhu Laboratorija je oranžen okvir s primerjavo. Odločitev po vsaj 100 poslih vsakega pravila. Ni finančni nasvet, gre za demo.",
    tags: [["Samo Laboratorij", ""], ["Base, Bankr", "ok"]],
  },
  {
    id: 13,
    at: "2026-09-27T18:30:00Z",
    date: "27. 9. 2026",
    title: "Bot teče na strežniku 24/7",
    short: "<b>Bot zdaj trguje na strežniku, 24 ur na dan</b>, tudi ko je stran zaprta. Dvojčka ni več.",
    body:
      "Do zdaj je bot trgoval samo, ko je bil Sonar odprt v brskalniku, na strežniku pa je vzporedno tekel dvojček za primerjavo. Od danes je dvojček bot sam: samodejne vstope in vse izstope (polovica, cilj, sledilna in trda meja, po Jupitru na 6 s, 5 min pavze po izstopu) vodi strežnik vsakih 30 s, tudi ponoči in ko je računalnik ugasnjen. Stran posle samo prikazuje. Ročni vstop in gumb Zapri zdaj delujeta kot prej, posel pa potem prav tako vodi strežnik. Nastavitve (samodejni vstopi, vložek, profil) veljajo takoj, ko jih spremeniš. Ker trguje samo en bot, podvojenih poslov iz več zavihkov ne more biti več. Rezultati dvojčka so izbrisani. Posli, ki so bili ob posodobitvi odprti v brskalniku, se zaključijo po starem. Ni finančni nasvet, gre za demo.",
    tags: [["Strežnik 24/7", "ok"], ["Dvojček ukinjen", ""]],
  },
  {
    id: 12,
    at: "2026-09-26T09:30:00Z",
    date: "26. 9. 2026",
    title: "Bot: izstopi na 6 s in pavza 5 min",
    short: "<b>Bot zdaj izstopa po Jupitrovih cenah na 6 s</b> in se kovancu 5 min po izstopu ne vrne. Velja za nove posle.",
    body:
      "Do zdaj je bot izstopal samo ob 30 s posnetkih DEX Screenerja, ki ceno še dodatno predpomni. Pri slopcannonu je Jupiter ob 10:37:16 pokazal +52 %, DEX Screener pa je še kazal +10 % in naslednji posnetek je prišel šele čez skoraj minuto. Od zdaj bot za nove posle vstopi po sveži Jupitrovi ceni in vsa izstopna pravila (polovica, cilj, sledilna in trda meja) preveri ob vsaki Jupitrovi ceni, torej vsakih 6 s. Na trdi meji je senca s tem v povprečju izgubila -14 % namesto -23 %. Druga sprememba: po izstopu iz kovanca 5 min brez samodejnega ponovnega vstopa vanj. Ponovni vstopi 1 do 3 min po izstopu so 25. in 26. 9. izgubljali v vseh virih (senca -7 %, dvojček -11 % na posel), ker bot odskok po padcu vidi kot odboj. Ročni vstop ostane vedno dovoljen. Že odprti posli se zaključijo po starih pravilih. Isto velja za dvojčka na strežniku. V Laboratoriju so tri nova pravila za primerjavo: tvoj bot (Jupiter + 5 min), Jupiter + 10 min in DEX + 5 min. Ni finančni nasvet, gre za demo.",
    tags: [["Izstopi na 6 s", "ok"], ["Pavza 5 min", "ok"], ["Tudi dvojček", ""]],
  },
  {
    id: 11,
    at: "2026-09-25T19:30:00Z",
    date: "25. 9. 2026",
    title: "Laboratorij: lažne cene izločene",
    short: "<b>Laboratorij ne šteje več poslov na lažnih cenah.</b> v1.0 in v3 zato padeta v minus, kjer v resnici sta.",
    body:
      "Nekatera senčna pravila so vstopala in izstopala tudi na sumljivih posnetkih, kjer se cena z DEX Screenerja od Jupitrove razlikuje za več kot polovico. Največji primer je GATO 23. 9.: trem pravilom (v1.0, v3 mirno, v3 kontrola) je izstop na 132-krat previsoki ceni pripisal po okrog +9 SOL. Od danes vsa pravila sumljive posnetke preskočijo, tako kot tvoj bot in dvojček. 69 starejših poslov je označenih kot neveljavnih in izločenih iz seštevkov, ne izbrisanih. v1.0 čisto je ustavljen, ker zdaj dela skoraj isto kot v1.0. Na tvoj račun to nima vpliva.",
    tags: [["Samo Laboratorij", ""], ["Lažne cene izločene", "ok"]],
  },
  {
    id: 10,
    at: "2026-09-25T18:00:00Z",
    date: "25. 9. 2026",
    title: "Laboratorij: cilj +30 na Jupitru",
    short: "<b>V Laboratoriju je novo pravilo: cilj +30 %</b> na Jupitrovih cenah, z lastno primerjavo na vrhu. Samo senca, bot ostaja isti.",
    body:
      "Analiza 895 poslov iz 24. in 25. 9. je pokazala, da noben signal z DEX Screenerja (nakupi proti prodajam, volumen, likvidnost, sveče) ne loči poslov, ki bodo šli na +50 %, od tistih, ki se bodo obrnili. Pomagal je samo nižji cilj: pol pri +20 %, vse pri +30 %. Na Jupitrovih cenah je bilo to +0,9 točke na posel boljše od +50 %, v obeh polovicah obdobja. Ker je bil na prejšnjem oknu +30 malo slabši, ga najprej preverimo naprej. V Laboratoriju sta dve novi pravili z istim vstopom in istim virom cene: cilj +30 in cilj +50 kot kontrola. Na vrhu je okvir, ki ju primerja. Na tvoje posle in na bota to nima vpliva.",
    tags: [["Samo Laboratorij", ""], ["Cilj +30 proti +50", "ok"]],
  },
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
    "Največ 5 odprtih poslov, en vstop na kovanec na 24 h, brez vstopov med 00:00 in 06:00. Vstop: vzorci v1.0 (Odboj, Višje dno, Preboj/retest) + filter v1.2 (starost 30 do 90 min, v zadnji uri ni v minusu, MC 20K do 300K). Izstop za nove posle: profil " +
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
    if (viewer) { $("#stakeMessage").textContent = "Samo ogled: profil izstopa spreminja samo lastnik bota."; return; }
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

// (Dvojček na strežniku, 25. do 27. 9. 2026, je od v51 ukinjen: bot sam teče na strežniku, glej syncServerTrades.)

// ---------- Kopiranje (5. 10. 2026) ----------
// Zavihek za senčno kopiranje denarnic. Podatke piše strežnik (funkciji kopija-zajem in kopija-senca) v tabele
// copy_candidates (sledene denarnice), copy_signals (njihovi nakupi in prodaje) in copy_shadow_trades (senčni posli).
// Dve pravili z istim vstopom: kopija-mirror (proda, ko proda denarnica) in kopija-hitri (+10 % / -5 % / 120 min).
// Vse je senca: brez denarja, brez vpliva na bilanco. Osvežitev na 30 s, ko je zavihek odprt.
const COPY_RULES = { "kopija-mirror": { name: "Zrcalo", color: "#46bec5" }, "kopija-hitri": { name: "Hitri", color: "#e2a93a" }, "kopija-sled": { name: "Sled", color: "#c0eb75" } };
let copyState = { trades: [], cands: [], signals: [], error: "", loadedAt: 0 }, copyBusy = false;
async function loadCopy() {
  if (!db || copyBusy) return;
  copyBusy = true;
  try {
    const days = $("#copyPeriod").value;
    // 6. 10. 2026: Danes in Včeraj sta koledarska dneva po lokalnem času (polnoč do polnoči), ne drseče ure.
    const midnight = (offsetDays) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d.toISOString(); };
    const since = days === "all" ? "2026-10-01T00:00:00Z" : days === "today" ? midnight(0) : days === "yesterday" ? midnight(-1) : new Date(Date.now() - Number(days) * 86400000).toISOString();
    const until = days === "yesterday" ? midnight(0) : null;
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    // 6. 10. 2026: branje po straneh. Prej največ 600 vrstic, kar je pri ~250 nakupih x 3 pravila + preskoki na dan
    // pokazalo samo zadnjih pol dneva (včeraj je zato manjkal ves dopoldanski plus 7aaiiC). Zdaj do 12.000 vrstic.
    const loadTrades = async () => {
      const rows = [];
      for (let page = 0; page < 12; page++) {
        let q = db.from("copy_shadow_trades").select("id,rule,wallet,token,symbol,signal_id,signal_t,opened_at,lag_s,entry_usd,peak_usd,low_usd,last_usd,last_t,stake_sol,closed_at,exit_usd,exit_reason,pnl_pct,pnl_sol,wallet_price_sol,note").gte("opened_at", since).like("rule", "kopija-%");
        if (until) q = q.lt("opened_at", until);
        const r = await q.order("opened_at", { ascending: false }).order("id", { ascending: false }).range(page * 1000, page * 1000 + 999);
        if (r.error) return r;
        rows.push(...(r.data || []));
        if (!r.data || r.data.length < 1000) break;
      }
      return { data: rows, error: null };
    };
    const [t, c, s] = await Promise.all([
      loadTrades(),
      db.from("copy_candidates").select("wallet,label,status,stats").eq("status", "sledi"),
      db.from("copy_signals").select("wallet,token,side,t,sol").gte("t", dayAgo).not("sig", "like", "test-%").order("t", { ascending: false }).limit(300),
    ]);
    if (t.error) throw t.error;
    if (c.error) throw c.error;
    copyState = { trades: t.data || [], cands: c.data || [], signals: s.data || [], error: "", loadedAt: Date.now() };
  } catch (e) {
    copyState.error = "Podatkov o kopiranju ni bilo mogoče naložiti: " + (e?.message || e);
  } finally {
    copyBusy = false;
  }
  renderCopy();
}
const copyLabel = (w) => copyState.cands.find((c) => c.wallet === w)?.label || w.slice(0, 4) + "…" + w.slice(-4);
const copyAgo = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "pravkar" : m < 60 ? "pred " + m + " min" : m < 1440 ? "pred " + Math.floor(m / 60) + " h" : "pred " + Math.floor(m / 1440) + " d";
};
const copyPct = (x, d = 1) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + (x * 100).toLocaleString("sl-SI", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %" : "-");
const copySol = (x) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + x.toLocaleString("sl-SI", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + " SOL" : "-");
const copyLive = (t) => (t.last_usd > 0 && t.entry_usd > 0 ? (t.note?.half_usd ? 0.5 * (t.note.half_usd / t.entry_usd) + 0.5 * (t.last_usd / t.entry_usd) : t.last_usd / t.entry_usd) * (1 - 0.0035) / (1 + 0.0035) - 1 : null);
const copyReason = { mirror: "denarnica prodala", cilj: "cilj +10 %", meja: "trda meja", sled: "sled pod vrhom", cas: "časovna meja", "brez-cene": "brez cene", preskok: "preskok" };
const copyMedian = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function copyStats(rule) {
  const all = copyState.trades.filter((t) => t.rule === rule);
  const closed = all.filter((t) => t.closed_at && Number.isFinite(t.pnl_sol));
  const open = all.filter((t) => !t.closed_at);
  const net = closed.reduce((s, t) => s + t.pnl_sol, 0);
  const wins = closed.filter((t) => t.pnl_sol > 0).length;
  const unreal = open.reduce((s, t) => { const r = copyLive(t); return s + (r === null ? 0 : t.stake_sol * r); }, 0);
  return { all, closed, open, net, wins, unreal, avg: closed.length ? closed.reduce((s, t) => s + t.pnl_pct, 0) / closed.length : null };
}
function renderCopy() {
  if ($("#copy").hidden) return;
  const st = $("#copyStatus");
  const buys24 = copyState.signals.filter((s) => s.side === "buy").length, sells24 = copyState.signals.length - buys24;
  if (copyState.error) { st.className = "cpStatus err"; st.textContent = copyState.error; }
  else { st.className = "cpStatus ok"; st.innerHTML = '<i></i>Živo · ' + copyState.cands.length + " sledenih denarnic · zadnjih 24 h " + plural(buys24, "nakup", "nakupa", "nakupi", "nakupov") + " in " + plural(sells24, "prodaja", "prodaji", "prodaje", "prodaj") + " · strežnik vodi posle na 6 s, zavihek se osveži na 30 s"; }
  // KPI
  const mir = copyStats("kopija-mirror"), hit = copyStats("kopija-hitri"), sled = copyStats("kopija-sled");
  const lagList = mir.all.filter((t) => t.note?.entry_src !== "signal").map((t) => t.lag_s).filter(Number.isFinite);
  const slipList = mir.all.filter((t) => t.note?.entry_src === "jupiter" && t.note?.sol_usd > 0 && t.wallet_price_sol > 0).map((t) => t.entry_usd / (t.wallet_price_sol * t.note.sol_usd) - 1);
  // 6. 10. 2026: pod neto SOL še vrednost v dolarjih po istem tečaju kot v Bilanci (Jupiter, sicer fiksen).
  const cpRate = solUsd || SOL_USD_FIXED;
  const cpUsd = (x) => { const v = x * cpRate, d = Math.abs(v) >= 10 ? 0 : 2; return "\u2248 " + (v > 0 ? "+" : "") + plainMinus(new Intl.NumberFormat("sl-SI", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d }).format(v)); };
  const kpi = (id, big, sub, cls, usdVal) => { $(id + " strong").textContent = big; $(id + " p").textContent = sub; $(id).className = "cpKpi " + (cls || ""); const em = $(id + " .cpUsd"); if (em) em.textContent = Number.isFinite(usdVal) ? cpUsd(usdVal) : ""; };
  kpi("#cpK1", copySol(mir.net), (mir.closed.length ? plural(mir.closed.length, "zaključen posel", "zaključena posla", "zaključeni posli", "zaključenih poslov") + " · " + Math.round((mir.wins / mir.closed.length) * 100) + " % dobitkov" : "še brez zaključenih poslov") + (mir.open.length ? " · odprto " + copySol(mir.unreal) : ""), tone(mir.net), mir.net);
  kpi("#cpK2", copySol(hit.net), (hit.closed.length ? plural(hit.closed.length, "zaključen posel", "zaključena posla", "zaključeni posli", "zaključenih poslov") + " · " + Math.round((hit.wins / hit.closed.length) * 100) + " % dobitkov" : "še brez zaključenih poslov") + (hit.open.length ? " · odprto " + copySol(hit.unreal) : ""), tone(hit.net), hit.net);
  kpi("#cpK5", copySol(sled.net), (sled.closed.length ? plural(sled.closed.length, "zaključen posel", "zaključena posla", "zaključeni posli", "zaključenih poslov") + " · " + Math.round((sled.wins / sled.closed.length) * 100) + " % dobitkov" : "še brez zaključenih poslov") + (sled.open.length ? " · odprto " + copySol(sled.unreal) : ""), tone(sled.net), sled.net);
  const medLag = copyMedian(lagList);
  kpi("#cpK3", medLag === null ? "-" : medLag < 60 ? Math.round(medLag) + " s" : (medLag / 60).toFixed(1) + " min", lagList.length ? "mediana od njihovega bloka do najinega vstopa · " + lagList.length + " vstopov" : "izmeri se ob prvem kopiranem nakupu");
  const medSlip = copyMedian(slipList);
  kpi("#cpK4", medSlip === null ? "-" : copyPct(medSlip), slipList.length ? "najina vstopna cena proti njihovi · mediana · " + slipList.length + " vstopov" : "koliko dražje kupiva zaradi zamika", medSlip === null ? "" : medSlip > 0.02 ? "negative" : "positive");
  // krivulji
  copyCurve(mir, hit, sled);
  // denarnice
  const wl = $("#cpWallets");
  wl.replaceChildren();
  const rows = copyState.cands.map((c) => {
    const mine = mir.all.filter((t) => t.wallet === c.wallet), closed = mine.filter((t) => t.closed_at && Number.isFinite(t.pnl_sol));
    const sig = copyState.signals.filter((s) => s.wallet === c.wallet);
    return { c, mine, closed, net: closed.reduce((s, t) => s + t.pnl_sol, 0), wins: closed.filter((t) => t.pnl_sol > 0).length, lag: copyMedian(mine.map((t) => t.lag_s).filter(Number.isFinite)), last: sig[0]?.t || mine[0]?.opened_at || null, open: mine.filter((t) => !t.closed_at).length };
  }).sort((a, b) => b.net - a.net || b.mine.length - a.mine.length);
  const maxAbs = Math.max(0.0001, ...rows.map((r) => Math.abs(r.net)));
  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "cpWallet";
    el.innerHTML =
      '<div class="cpWName"><b></b><small></small></div>' +
      '<div class="cpWBar"><i></i></div>' +
      '<div class="cpWNet"><strong></strong><small></small></div>';
    el.querySelector("b").textContent = r.c.label || copyLabel(r.c.wallet);
    el.querySelector(".cpWName small").textContent = (r.mine.length ? plural(r.mine.length, "posel", "posla", "posli", "poslov") + (r.open ? " · " + r.open + " odprt" : "") + (r.closed.length ? " · " + Math.round((r.wins / r.closed.length) * 100) + " % dobitkov" : "") : "še brez posla") + (r.last ? " · zadnji signal " + copyAgo(r.last) : "");
    const bar = el.querySelector(".cpWBar i");
    bar.style.width = Math.round((Math.abs(r.net) / maxAbs) * 100) + "%";
    bar.className = tone(r.net);
    el.querySelector("strong").textContent = r.closed.length ? copySol(r.net) : "-";
    el.querySelector(".cpWNet strong").className = tone(r.net);
    el.querySelector(".cpWNet small").textContent = r.lag === null ? "" : "zamik " + Math.round(r.lag) + " s";
    el.title = r.c.wallet;
    el.onclick = () => window.open("https://solscan.io/account/" + r.c.wallet, "_blank", "noreferrer");
    wl.append(el);
  }
  renderCopyFeed();
  $("#cpUpdated").textContent = copyState.loadedAt ? "Naloženo " + new Date(copyState.loadedAt).toLocaleTimeString("sl-SI") : "";
}
function copyCurve(mir, hit, sled) {
  const svg = $("#cpCurve");
  svg.replaceChildren();
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const series = [["kopija-mirror", mir], ["kopija-hitri", hit], ["kopija-sled", sled]].map(([rule, s]) => {
    let cum = 0;
    const pts = [...s.closed].sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at)).map((t) => ({ t: new Date(t.closed_at).getTime(), v: (cum += t.pnl_sol) }));
    return { rule, pts };
  });
  const all = series.flatMap((s) => s.pts);
  const note = $("#cpCurveNote");
  if (!all.length) {
    note.textContent = "Krivulji se narišeta po prvem zaključenem senčnem poslu.";
    const t = mk("text", { x: 350, y: 120, fill: "#5f7390", "font-size": 14, "text-anchor": "middle" }); t.textContent = "še ni zaključenih poslov"; svg.append(t);
    return;
  }
  const t0 = Math.min(...all.map((p) => p.t)) - 60000, t1 = Math.max(Date.now(), ...all.map((p) => p.t));
  const vals = [0, ...all.map((p) => p.v)], lo = Math.min(...vals), hi = Math.max(...vals), range = hi - lo || 0.001;
  const X = (ms) => 30 + ((ms - t0) / (t1 - t0 || 1)) * 650, Y = (v) => 195 - ((v - lo) / range) * 165;
  for (const v of [lo, 0, hi]) {
    svg.append(mk("line", { x1: 30, x2: 680, y1: Y(v), y2: Y(v), stroke: "#1f3045", "stroke-dasharray": "3 6" }));
    if (v === 0 && (Math.abs(Y(0) - Y(lo)) < 14 || Math.abs(Y(0) - Y(hi)) < 14)) continue; // oznaka 0 bi prekrila sosednjo
    const lab = mk("text", { x: 32, y: Math.max(14, Y(v) - 5), fill: "#7f93ad", "font-size": 12 }); lab.textContent = copySol(v); svg.append(lab);
  }
  for (const s of series) {
    if (!s.pts.length) continue;
    let d = "M" + X(t0) + " " + Y(0);
    let prev = 0;
    for (const p of s.pts) { d += " L" + X(p.t) + " " + Y(prev) + " L" + X(p.t) + " " + Y(p.v); prev = p.v; }
    d += " L" + X(t1) + " " + Y(prev);
    svg.append(mk("path", { d, fill: "none", stroke: COPY_RULES[s.rule].color, "stroke-width": 2.5, "stroke-linejoin": "round" }));
    const last = s.pts.at(-1);
    svg.append(mk("circle", { cx: X(t1), cy: Y(last.v), r: 4, fill: COPY_RULES[s.rule].color }));
  }
  const stake = copyState.trades.find((t) => t.stake_sol > 0)?.stake_sol;
  note.textContent = "Kumulativni neto rezultat v SOL po času zaključka, vložek " + (stake ? stake.toLocaleString("sl-SI") : "-") + " SOL na posel (isti kot pri botu), po stroških. Od " + new Date(t0).toLocaleString("sl-SI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) + ".";
}
$("#kopiranje").onclick = () => { navigate("copy", "live"); loadCopy(); };
$("#copyPeriod").onchange = loadCopy;
setInterval(() => { if (view === "copy" && !document.hidden) loadCopy(); }, 30000);
// ---------- Kopiranje: sekcija V živo kot tabela (6.7.0, 5. 10. 2026, G izbral mockup B) ----------
// Ena vrstica na kopiran nakup, trije stolpci za tri pravila. Klik na vrstico odpre pot cene (copy_prices, 6 s) z oznakami
// izstopov in razlago v navadnem jeziku. Preskoki (dokupi, prestar signal) so skriti, gumb jih pokaže kot sive vrstice.
const copyUI = { wallet: "", state: "all", q: "", skips: false, open: new Set(), prices: new Map() };
const copyMin = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
const copyMinText = (m) => (m < 1 ? "pod 1 min" : m < 60 ? Math.round(m) + " min" : (m / 60).toFixed(1) + " h");
const copyWalletPct = (t) => (t.note?.wallet_sell_price_sol > 0 && t.wallet_price_sol > 0 ? t.note.wallet_sell_price_sol / t.wallet_price_sol - 1 : null);
// stavek v navadnem jeziku za vsako pravilo
function copyStory(t, rule) {
  const live = copyLive(t), peak = t.peak_usd > 0 ? t.peak_usd / t.entry_usd - 1 : null, mins = copyMin(t.opened_at, t.closed_at || Date.now());
  const b = (x) => '<b class="' + tone(x ?? 0) + '">' + copyPct(x) + "</b>";
  if (rule === "kopija-mirror") {
    if (t.closed_at) {
      const wp = copyWalletPct(t);
      if (t.exit_reason === "mirror") return "Denarnica je prodala po " + copyMinText(mins) + (wp === null ? "" : " (sama je imela " + copyPct(wp) + ")") + ". Ti bi dobil " + b(t.pnl_pct) + ", ker si kupil in prodal " + Math.round(t.lag_s) + " s za njo.";
      return "Zaprto po " + copyMinText(mins) + ": " + (copyReason[t.exit_reason] || t.exit_reason) + ". Rezultat " + b(t.pnl_pct) + ".";
    }
    return "Denarnica še drži (" + copyMinText(mins) + "). Trenutno " + b(live) + (peak !== null ? ", vrh je bil " + copyPct(peak) : "") + ". Proda se, ko proda ona, najpozneje po 24 h.";
  }
  if (rule === "kopija-hitri") {
    if (t.closed_at) return "Bot je prodal sam po " + copyMinText(mins) + ": " + (copyReason[t.exit_reason] || t.exit_reason) + ". Rezultat " + b(t.pnl_pct) + ".";
    return "Čaka na +10 % ali -5 %, največ 120 min. Trenutno " + b(live) + ".";
  }
  const half = t.note?.half_usd ? t.note.half_usd / t.entry_usd - 1 : null;
  if (t.closed_at) return (half !== null ? "Pol prodano pri " + copyPct(half) + ", ostalo " : "Vse ") + "prodano po " + copyMinText(mins) + ": " + (copyReason[t.exit_reason] || t.exit_reason) + ". Skupaj " + b(t.pnl_pct) + ".";
  if (half !== null) return "Pol prodano pri " + copyPct(half) + ". Ostalo še teče, skupaj zdaj " + b(live) + "; sled proda, če cena pade 25 % pod vrh (" + copyPct(peak) + "), torej pri " + copyPct((1 + peak) * 0.75 - 1) + ".";
  return "Še ni dosegla +50 %" + (peak !== null ? " (vrh " + copyPct(peak) + ")" : "") + ", zato še ni prodala nič. Trenutno " + b(live) + ", trda meja pri -30 %.";
}
function copyGroups() {
  const bySignal = new Map();
  for (const t of copyState.trades) { const k = t.signal_id ? "s" + t.signal_id : t.wallet + "|" + t.token + "|" + t.signal_t; if (!bySignal.has(k)) bySignal.set(k, []); bySignal.get(k).push(t); }
  return [...bySignal.entries()].map(([key, g]) => ({ key, g, t0: g[0], skip: g[0].rule === "kopija-preskok" })).sort((a, b) => new Date(b.t0.signal_t) - new Date(a.t0.signal_t));
}
function renderCopyFeed() {
  const all = copyGroups();
  // seznam denarnic v filtru
  const sel = $("#cpWallet");
  const cur = sel.value;
  sel.replaceChildren(new Option("Vse denarnice", ""));
  for (const c of copyState.cands) sel.append(new Option(c.label || copyLabel(c.wallet), c.wallet));
  sel.value = cur;
  const q = normQ(copyUI.q);
  const match = (x) => (!copyUI.wallet || x.t0.wallet === copyUI.wallet) && (!q || [x.t0.symbol, x.t0.token].some((v) => v && String(v).toLowerCase().includes(q)));
  const real = all.filter((x) => !x.skip && match(x)).filter((x) => copyUI.state === "all" || (copyUI.state === "open") === x.g.some((t) => !t.closed_at));
  const skips = all.filter((x) => x.skip && match(x));
  // dokupi k posameznemu nakupu: preskoki iste denarnice in kovanca po signalu, dokler je zrcalo odprto
  const dokupi = (x) => { const m = x.g.find((t) => t.rule === "kopija-mirror"); const end = m?.closed_at ? new Date(m.closed_at).getTime() : Infinity; return skips.filter((s) => s.t0.wallet === x.t0.wallet && s.t0.token === x.t0.token && /dokup/.test(s.t0.note?.skip || "") && new Date(s.t0.signal_t).getTime() > new Date(x.t0.signal_t).getTime() && new Date(s.t0.signal_t).getTime() < end).length; };
  // seštevki za izbrani filter
  const sum = $("#cpSum");
  const net = (rule) => real.flatMap((x) => x.g).filter((t) => t.rule === rule && t.closed_at && Number.isFinite(t.pnl_sol)).reduce((s, t) => s + t.pnl_sol, 0);
  const openN = real.filter((x) => x.g.some((t) => !t.closed_at)).length;
  const lags = real.map((x) => x.t0.lag_s).filter(Number.isFinite), medLag = copyMedian(lags);
  sum.replaceChildren();
  for (const [lab, val, cls] of [["Kopiranih nakupov", String(real.length), ""], ["Še odprtih", String(openN), ""], ["Zrcalo neto", copySol(net("kopija-mirror")), tone(net("kopija-mirror"))], ["Hitri neto", copySol(net("kopija-hitri")), tone(net("kopija-hitri"))], ["Sled neto", copySol(net("kopija-sled")), tone(net("kopija-sled"))], ["Zamik, mediana", medLag === null ? "-" : Math.round(medLag) + " s", ""]]) {
    const d = document.createElement("div"); d.innerHTML = "<span></span><b></b>"; d.querySelector("span").textContent = lab; d.querySelector("b").textContent = val; d.querySelector("b").className = cls; sum.append(d);
  }
  $("#cpSkips").textContent = (copyUI.skips ? "Skrij preskoke" : "Pokaži preskoke") + " (" + skips.length + ")";
  // tabela
  const rows = $("#cpRows");
  rows.replaceChildren();
  $("#cpFeedEmpty").hidden = real.length > 0;
  if (!real.length) {
    $("#cpFeedEmpty").innerHTML = all.some((x) => !x.skip)
      ? "<b>Noben nakup se ne ujema s filtrom.</b> Spremeni denarnico, stanje ali iskanje."
      : "<b>Čakam na prvi nakup sledenih denarnic.</b> Ko katera od njih kupi kovanec, se tu v nekaj sekundah pojavi senčni posel. Nekatere denarnice trgujejo nekajkrat na dan, druge nekajkrat na teden.";
  }
  // vrstice: pravi nakupi in (po želji) preskoki, vse po času
  const list = copyUI.skips ? [...real, ...skips].sort((a, b) => new Date(b.t0.signal_t) - new Date(a.t0.signal_t)) : real;
  let lastSkipKey = null;
  for (const x of list.slice(0, 80)) {
    const t0 = x.t0;
    if (x.skip) {
      // zaporedne preskoke iste denarnice in kovanca združimo v eno vrstico
      const k = t0.wallet + "|" + t0.token + "|" + (t0.note?.skip || "");
      if (k === lastSkipKey) { const prev = rows.lastElementChild; prev.dataset.n = Number(prev.dataset.n) + 1; prev.firstElementChild.textContent = copySkipText(t0, Number(prev.dataset.n)); continue; }
      lastSkipKey = k;
      const tr = document.createElement("tr"); tr.className = "cpSkipRow"; tr.dataset.n = 1;
      const td = document.createElement("td"); td.colSpan = 6; td.textContent = copySkipText(t0, 1); tr.append(td); rows.append(tr);
      continue;
    }
    lastSkipKey = null;
    const mir = x.g.find((t) => t.rule === "kopija-mirror") || t0;
    const anyOpen = x.g.some((t) => !t.closed_at);
    const live = copyLive(mir), peak = mir.peak_usd > 0 ? mir.peak_usd / mir.entry_usd - 1 : null;
    const slip = t0.note?.entry_src === "jupiter" && t0.note?.sol_usd > 0 && t0.wallet_price_sol > 0 ? t0.entry_usd / (t0.wallet_price_sol * t0.note.sol_usd) - 1 : null;
    const nDok = dokupi(x);
    const tr = document.createElement("tr"); tr.className = "cpSig"; tr.dataset.key = x.key;
    tr.innerHTML =
      '<td class="cpCoin"><b><span class="cpState"></span></b><small></small></td>' +
      '<td class="cpNum"><div class="cpCell"><b class="cpWhen"></b><small></small></div></td>' +
      '<td class="cpNum"><div class="cpCell"><b></b><small></small></div></td>' +
      Object.keys(COPY_RULES).map(() => '<td class="cpNum"><div class="cpCell"><b></b><small></small></div></td>').join("");
    const st = tr.querySelector(".cpState"); st.className = "cpState " + (anyOpen ? "open" : "closed"); st.title = anyOpen ? "še odprto" : "vse zaprto";
    tr.querySelector(".cpCoin b").append(document.createTextNode(t0.symbol || t0.token.slice(0, 6) + "…"));
    tr.querySelector(".cpCoin small").textContent = copyLabel(t0.wallet) + (t0.note?.wallet_sol ? " · " + Number(t0.note.wallet_sol).toLocaleString("sl-SI", { maximumFractionDigits: 2 }) + " SOL" : "") + (nDok ? " · +" + nDok + " dokup" : "") + " · zamik " + Math.round(t0.lag_s) + " s" + (slip === null ? (t0.note?.entry_src === "signal" ? " · vstop po njihovi ceni" : "") : " · cena zamika " + copyPct(slip));
    const tds = tr.querySelectorAll("td");
    tds[1].querySelector("b").textContent = new Date(t0.signal_t).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
    tds[1].querySelector("small").textContent = copyAgo(t0.signal_t);
    tds[2].querySelector("b").textContent = copyPct(live); tds[2].querySelector("b").className = tone(live ?? 0);
    tds[2].querySelector("small").textContent = peak === null ? "" : "vrh " + copyPct(peak);
    Object.keys(COPY_RULES).forEach((rule, i) => {
      const t = x.g.find((y) => y.rule === rule), td = tds[3 + i];
      if (!t) { td.querySelector("b").textContent = "-"; return; }
      const r = t.closed_at ? t.pnl_pct : copyLive(t);
      td.querySelector("b").textContent = copyPct(r); td.querySelector("b").className = tone(r ?? 0);
      td.querySelector("small").textContent = t.closed_at ? (copyReason[t.exit_reason] || t.exit_reason) + " · " + copyMinText(copyMin(t.opened_at, t.closed_at)) : rule === "kopija-sled" && t.note?.half_usd ? "pol prodano " + copyPct(t.note.half_usd / t.entry_usd - 1) + " · teče" : "teče";
    });
    rows.append(tr);
    if (copyUI.open.has(x.key)) rows.append(copyDetailRow(x));
  }
}
function copySkipText(t0, n) {
  return "Preskočeno · " + (t0.symbol || t0.token.slice(0, 6) + "…") + " · " + copyLabel(t0.wallet) + (n > 1 ? " · " + n + "-krat" : "") + " · " + (t0.note?.skip || "neznan razlog") + " · " + new Date(t0.signal_t).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
}
function copyDetailRow(x) {
  const tr = document.createElement("tr"); tr.className = "cpDet"; tr.dataset.det = x.key;
  const td = document.createElement("td"); td.colSpan = 6;
  td.innerHTML = '<div class="cpDetGrid"><div><svg class="cpSpark" viewBox="0 0 640 150" role="img" aria-label="Pot cene od vstopa"></svg><p class="muted cpSparkNote">Nalagam pot cene …</p></div><div class="cpStories"></div></div>';
  const stories = td.querySelector(".cpStories");
  for (const rule of Object.keys(COPY_RULES)) {
    const t = x.g.find((y) => y.rule === rule); if (!t) continue;
    const p = document.createElement("p"); p.innerHTML = '<span class="cpRule" style="--c:' + COPY_RULES[rule].color + '"></span> ';
    p.querySelector(".cpRule").textContent = COPY_RULES[rule].name;
    p.insertAdjacentHTML("beforeend", copyStory(t, rule));
    stories.append(p);
  }
  const link = document.createElement("p"); link.className = "muted"; link.style.fontSize = "12px";
  link.innerHTML = '<a href="https://dexscreener.com/solana/' + x.t0.token + '" target="_blank" rel="noreferrer">DEX Screener</a> · <a href="https://solscan.io/account/' + x.t0.wallet + '" target="_blank" rel="noreferrer">denarnica na Solscanu</a>';
  stories.append(link);
  tr.append(td);
  copyLoadPath(x, td.querySelector(".cpSpark"), td.querySelector(".cpSparkNote"));
  return tr;
}
// pot cene iz copy_prices (6 s), z oznakami izstopov; do 3000 točk (5 h), pri daljših poslih prikaz začetka
async function copyLoadPath(x, svg, note) {
  const mir = x.g.find((t) => t.rule === "kopija-mirror") || x.t0;
  const from = mir.opened_at, to = x.g.every((t) => t.closed_at) ? x.g.map((t) => t.closed_at).sort().at(-1) : new Date().toISOString();
  let pts = copyUI.prices.get(x.key);
  if (!pts || !x.g.every((t) => t.closed_at)) {
    try {
      const { data, error } = await db.from("copy_prices").select("t,usd").eq("token", x.t0.token).gte("t", from).lte("t", to).order("t").limit(3000);
      if (error) throw error;
      pts = (data || []).map((p) => [copyMin(from, p.t), p.usd / mir.entry_usd - 1]);
      copyUI.prices.set(x.key, pts);
    } catch (e) { note.textContent = "Poti cene ni bilo mogoče naložiti: " + (e?.message || e); return; }
  }
  if (!pts.length) { note.textContent = "Za ta posel še ni shranjenih cen."; return; }
  const NS = "http://www.w3.org/2000/svg", w = 640, h = 150;
  const mk = (tag, attrs, text) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text !== undefined) el.textContent = text; return el; };
  svg.replaceChildren();
  const maxM = Math.max(1, pts.at(-1)[0]);
  const vals = pts.map((p) => p[1]); const lo = Math.min(-0.06, ...vals), hi = Math.max(0.12, ...vals);
  const X = (m) => 36 + (m / maxM) * (w - 50), Y = (v) => 20 + (1 - (v - lo) / (hi - lo)) * (h - 38);
  svg.append(mk("line", { x1: 36, x2: w - 14, y1: Y(0), y2: Y(0), stroke: "#4a5d78" }), mk("text", { x: 4, y: Y(0) + 4, fill: "#8ca4c5", "font-size": 10 }, "vstop"));
  for (const [v, c, lab] of [[0.10, COPY_RULES["kopija-hitri"].color, "+10"], [-0.05, COPY_RULES["kopija-hitri"].color, "-5"], [0.50, COPY_RULES["kopija-sled"].color, "+50"], [-0.30, COPY_RULES["kopija-sled"].color, "-30"]]) {
    if (v <= lo || v >= hi) continue;
    svg.append(mk("line", { x1: 36, x2: w - 14, y1: Y(v), y2: Y(v), stroke: c, "stroke-dasharray": "3 5", opacity: .5 }), mk("text", { x: w - 12, y: Y(v) + 4, fill: c, "font-size": 10, "text-anchor": "end" }, lab));
  }
  let d = ""; for (const [m, v] of pts) d += (d ? " L" : "M") + X(m).toFixed(1) + " " + Y(v).toFixed(1);
  svg.append(mk("path", { d, fill: "none", stroke: "#dbe7ff", "stroke-width": 1.8 }));
  const at = (m) => pts.reduce((b, p) => (Math.abs(p[0] - m) < Math.abs(b[0] - m) ? p : b))[1];
  const mark = (iso, c, lab) => { const m = Math.min(maxM, copyMin(from, iso)); svg.append(mk("circle", { cx: X(m), cy: Y(at(m)), r: 5, fill: c, stroke: "#0a1320", "stroke-width": 2 }), mk("text", { x: X(m), y: Y(at(m)) - 9, fill: c, "font-size": 10, "font-weight": 700, "text-anchor": "middle" }, lab)); };
  for (const t of x.g) {
    if (t.rule === "kopija-hitri" && t.closed_at) mark(t.closed_at, COPY_RULES[t.rule].color, "H");
    if (t.rule === "kopija-sled" && t.note?.half_t) mark(t.note.half_t, COPY_RULES[t.rule].color, "S½");
    if (t.rule === "kopija-sled" && t.closed_at) mark(t.closed_at, COPY_RULES[t.rule].color, "S");
    if (t.rule === "kopija-mirror" && t.closed_at) mark(t.closed_at, COPY_RULES[t.rule].color, "Z");
  }
  svg.append(mk("text", { x: 36, y: h - 2, fill: "#6f8299", "font-size": 10 }, "0 min"), mk("text", { x: w - 14, y: h - 2, fill: "#6f8299", "font-size": 10, "text-anchor": "end" }, copyMinText(maxM)));
  note.textContent = "Cena od najinega vstopa (Jupiter, na 6 s). Z = denarnica prodala · H = Hitri izstopil · S½ = Sled prodal pol · S = Sled prodal ostalo. Črtkane črte so meje pravil." + (pts.length >= 3000 ? " Prikazanih prvih 5 h." : "");
}
$("#cpRows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr.cpSig"); if (!tr || e.target.closest("a")) return;
  const key = tr.dataset.key;
  if (copyUI.open.has(key)) { copyUI.open.delete(key); tr.nextElementSibling?.classList.contains("cpDet") && tr.nextElementSibling.remove(); }
  else { copyUI.open.add(key); const x = copyGroups().find((g) => g.key === key); if (x) tr.after(copyDetailRow(x)); }
});
$("#cpWallet").onchange = (e) => { copyUI.wallet = e.target.value; renderCopyFeed(); };
$("#cpStateSel").onchange = (e) => { copyUI.state = e.target.value; renderCopyFeed(); };
$("#cpSearch").oninput = (e) => { copyUI.q = e.target.value; renderCopyFeed(); };
$("#cpSkips").onclick = () => { copyUI.skips = !copyUI.skips; renderCopyFeed(); };

// 5. 10. 2026: zavihek Pregledi. Jutranje opravilo vsak dan ob 8:00 vpiše pregled bota v memecoin_reports in pregled
// kopiranja v copy_reports (dan, data jsonb, povzetek). Zavihek bere obe tabeli in riše: pulz 14 dni za oba sistema,
// izbrani dan z botom in kopiranjem drug ob drugem, podrobnosti zložene. Nič se ne računa sproti, vse pride iz tabel.
let pgState = { bot: [], copy: [], day: null, loadedAt: 0, error: "" }, pgBusy = false;
const pgN = (x, d = 2) => (Number.isFinite(Number(x)) ? plainMinus(Number(x).toLocaleString("sl-SI", { minimumFractionDigits: d, maximumFractionDigits: d })) : "-");
const pgS = (x, d = 2) => (Number.isFinite(Number(x)) ? (Number(x) > 0 ? "+" : "") + pgN(x, d) : "-");
const pgTone = (x) => (Number(x) > 0 ? "positive" : Number(x) < 0 ? "negative" : "");
const pgEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PG_DNEVI = ["nedelja", "ponedeljek", "torek", "sreda", "četrtek", "petek", "sobota"];
const PG_KRATKO = ["ned", "pon", "tor", "sre", "čet", "pet", "sob"];
function pgDate(dan) { const [y, m, d] = dan.split("-").map(Number); return new Date(y, m - 1, d); }
function pgLong(dan) { const d = pgDate(dan); return PG_DNEVI[d.getDay()][0].toUpperCase() + PG_DNEVI[d.getDay()].slice(1) + ", " + d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear(); }
function pgShort(dan) { const d = pgDate(dan); return d.getDate() + ". " + (d.getMonth() + 1) + "."; }
async function loadPregledi() {
  if (!db || pgBusy) return;
  pgBusy = true;
  try {
    const [b, c] = await Promise.all([
      db.from("memecoin_reports").select("dan,data,povzetek,created_at").order("dan", { ascending: false }).limit(60),
      db.from("copy_reports").select("dan,data,povzetek,created_at").order("dan", { ascending: false }).limit(60),
    ]);
    if (b.error) throw b.error;
    if (c.error) throw c.error;
    pgState.bot = b.data || [];
    pgState.copy = c.data || [];
    pgState.error = "";
    pgState.loadedAt = Date.now();
    const days = pgDays();
    if (!pgState.day || !days.includes(pgState.day)) pgState.day = days[0] || null;
  } catch (e) {
    pgState.error = e?.message || String(e);
  }
  pgBusy = false;
  renderPregledi();
}
function pgDays() { return [...new Set([...pgState.bot.map((r) => r.dan), ...pgState.copy.map((r) => r.dan)])].sort().reverse(); }
function pgRow(list, dan) { return list.find((r) => r.dan === dan) || null; }
// Pulz: stolpec na dan za zadnjih 14 dni, višina je neto SOL, klik izbere dan.
function pgPulz(list, pick, days14) {
  const vals = days14.map((d) => { const r = pgRow(list, d); return r ? pick(r.data) : null; });
  const mx = Math.max(...vals.map((v) => Math.abs(v || 0)), 0.01);
  return days14.map((d, i) => {
    const v = vals[i];
    if (v === null || v === undefined) return `<button type="button" class="pgBar empty" data-day="${d}" title="${pgShort(d)}: ni pregleda"><i></i></button>`;
    const h = (Math.abs(v) / mx) * 48;
    const st = v >= 0 ? `bottom:50%;height:${h}%` : `top:50%;height:${h}%`;
    return `<button type="button" class="pgBar ${v >= 0 ? "up" : "dn"}${d === pgState.day ? " on" : ""}" data-day="${d}" title="${pgShort(d)}: ${pgS(v, 3)} SOL"><i style="${st}"></i></button>`;
  }).join("");
}
function pgCurve(series, opts = {}) {
  const all = series.flatMap((s) => s.pts || []);
  if (!all.length) return `<p class="muted pgEmpty">Ni krivulje za ta dan.</p>`;
  const W = 700, H = 200, L = 44, R = 12, T = 12, B = 26;
  let lo = Math.min(0, ...all.map((p) => p[1])), hi = Math.max(0, ...all.map((p) => p[1]));
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = (m) => L + (Math.min(1440, Math.max(0, m)) / 1440) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const lines = series.map((s) => {
    if (!s.pts?.length) return "";
    const pts = [[s.pts[0][0], 0], ...s.pts];
    return `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" points="${pts.map((p) => x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" ")}"/>`;
  }).join("");
  const marks = (opts.oznake || []).map((o) => `<circle cx="${x(o.min).toFixed(1)}" cy="${y(o.v).toFixed(1)}" r="3.5" fill="#dbe7ff"/><text x="${(x(o.min) + 6).toFixed(1)}" y="${(y(o.v) - 6).toFixed(1)}" fill="#8ca4c5" font-size="10">${pgEsc(o.label)}</text>`).join("");
  const vrzel = opts.vrzel ? `<rect x="${x(opts.vrzel.od).toFixed(1)}" y="${T}" width="${(x(opts.vrzel.do) - x(opts.vrzel.od)).toFixed(1)}" height="${H - T - B}" fill="#ffffff08"/><text x="${(x(opts.vrzel.od) + 4).toFixed(1)}" y="${T + 12}" fill="#5f7390" font-size="10">${pgEsc(opts.vrzel.label || "")}</text>` : "";
  const axis = [lo + pad, 0, hi - pad].filter((v, i, a) => a.indexOf(v) === i).map((v) => `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? "#2a3d58" : "#16233a"}" stroke-dasharray="${v === 0 ? "" : "3 4"}"/><text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" fill="#5f7390" font-size="10" text-anchor="end">${pgS(v, 2)}</text>`).join("");
  const hours = [0, 6, 12, 18, 24].map((h) => `<text x="${x(h * 60).toFixed(1)}" y="${H - 8}" fill="#5f7390" font-size="10" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}">${String(h).padStart(2, "0")}:00</text>`).join("");
  return `<svg class="pgChart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kumulativni neto rezultat dneva v SOL">${vrzel}${axis}${lines}${marks}${hours}</svg>`;
}
function pgTable(head, rows, fmt) {
  if (!rows?.length) return `<p class="muted pgEmpty">Ni podatkov.</p>`;
  return `<div class="scroll"><table class="pgTbl"><thead><tr>${head.map((h) => `<th>${pgEsc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => fmt(c, i, r)).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const pgCell = (txt, cls = "") => `<td class="${cls}">${txt}</td>`;
const pgSolCell = (v, d = 4) => pgCell(pgS(v, d), "pgNum " + pgTone(v));
const pgPctCell = (v, d = 1) => pgCell(Number.isFinite(Number(v)) ? pgS(v, d) + " %" : "-", "pgNum " + pgTone(v));
const pgPlain = (v) => pgCell(v === null || v === undefined ? "-" : pgEsc(v), "pgNum");
function pgKpi(label, value, unit, sub, tone = "") {
  return `<div class="pgK ${tone}"><small>${pgEsc(label)}</small><strong>${value}${unit ? `<u>${unit}</u>` : ""}</strong><em>${pgEsc(sub || "")}</em></div>`;
}
function pgBotCol(r) {
  if (!r) return `<div class="pgCol"><div class="pgCh"><i class="pgDot" style="--c:#46bec5"></i><b>Bot</b></div><p class="muted pgEmpty">Za ta dan ni pregleda bota.</p></div>`;
  const d = r.data, k = d.kpi || {};
  const tocke = d.zakljucek?.tocke?.length ? `<ul class="pgTocke">${d.zakljucek.tocke.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
  return `<div class="pgCol"><div class="pgCh"><i class="pgDot" style="--c:#46bec5"></i><b>Bot</b><span class="muted">${pgEsc(d.znacka || d.podnaslov?.split(".")[0] || "")}</span></div>
    <div class="pgKs">
      ${pgKpi("Neto", pgS(k.neto, 4), "SOL", k.prejNeto !== undefined ? "dan prej " + pgS(k.prejNeto, 4) : "", pgTone(k.neto))}
      ${pgKpi("PnL", pgS(k.pnl ?? k.naPosel, 2), "%", k.tedenPnl !== undefined ? "teden prej " + pgS(k.tedenPnl, 2) + " %" : k.prejPnl !== undefined ? "dan prej " + pgS(k.prejPnl, 2) + " %" : "", pgTone(k.pnl ?? k.naPosel))}
      ${pgKpi("Poslov", pgEsc(k.poslov ?? "-"), "", k.win !== undefined ? pgN(k.win, 1) + " % dobitkov" + (k.dobitkov !== undefined ? " (" + k.dobitkov + ")" : "") : "")}
      ${pgKpi("Globoke", pgEsc(k.globoke ?? "-"), "", k.globokeDelez !== undefined ? "pod -25 %, " + pgN(k.globokeDelez, 1) + " % poslov" : "pod -25 %")}
    </div>
    <p class="pgLead">${d.zakljucek?.lead || pgEsc(r.povzetek || "")}</p>${tocke}</div>`;
}
function pgCopyCol(r) {
  if (!r) return `<div class="pgCol"><div class="pgCh"><i class="pgDot" style="--c:#c0eb75"></i><b>Kopiranje</b></div><p class="muted pgEmpty">Za ta dan ni pregleda kopiranja (kopiranje teče od 5. 10. 2026).</p></div>`;
  const d = r.data, k = d.kpi || {};
  const tocke = d.zakljucek?.tocke?.length ? `<ul class="pgTocke">${d.zakljucek.tocke.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
  const hs = `<span class="${pgTone(k.hitriNeto)}">${pgS(k.hitriNeto, 2)}</span> / <span class="${pgTone(k.sledNeto)}">${pgS(k.sledNeto, 2)}</span>`;
  return `<div class="pgCol"><div class="pgCh"><i class="pgDot" style="--c:#c0eb75"></i><b>Kopiranje</b><span class="muted">${pgEsc(d.znacka || "8 denarnic · senca")}</span></div>
    <div class="pgKs">
      ${pgKpi("Zrcalo neto", pgS(k.zrcaloNeto, 4), "SOL", "PnL " + pgS(k.zrcaloPnl, 2) + " %" + (k.prejZrcaloNeto !== undefined ? ", dan prej " + pgS(k.prejZrcaloNeto, 4) : ""), pgTone(k.zrcaloNeto))}
      ${pgKpi("Hitri / Sled", hs, "", "ista vstopa, lasten izstop")}
      ${pgKpi("Nakupov", pgEsc(k.nakupov ?? "-"), "", (k.preskoki ?? 0) + " preskokov" + (k.odprtih ? ", " + k.odprtih + " odprtih" : ""))}
      ${pgKpi("Zamik", k.zamikMed === null || k.zamikMed === undefined ? "-" : pgN(k.zamikMed, 0), "s", k.cenaZamikaMed === null || k.cenaZamikaMed === undefined ? "" : "cena zamika " + pgS(k.cenaZamikaMed * 100, 1) + " %")}
    </div>
    <p class="pgLead">${d.zakljucek?.lead || pgEsc(r.povzetek || "")}</p>${tocke}</div>`;
}
function pgDetails(title, sum, body, open = false) {
  return `<details class="pgDet"${open ? " open" : ""}><summary><b>${pgEsc(title)}</b><span>${pgEsc(sum)}</span></summary><div class="pgIn">${body}</div></details>`;
}
function pgChips(arr, warn = false) { return (arr || []).map((s) => `<span class="pgChip${warn ? " w" : ""}">${pgEsc(s)}</span>`).join(""); }
function renderPregledi() {
  const root = $("#pgRoot");
  if (!root) return;
  if (pgState.error) { root.innerHTML = `<p class="cpStatus err"><i></i>Napaka pri branju pregledov: ${pgEsc(pgState.error)}</p>`; return; }
  const days = pgDays();
  if (!days.length) { root.innerHTML = `<p class="cpEmpty"><b>Še ni pregledov</b>Prvi jutranji pregled nastane ob 8:00.</p>`; return; }
  const day = pgState.day || days[0];
  const i = days.indexOf(day);
  const last = [...pgState.bot, ...pgState.copy].map((r) => r.created_at).filter(Boolean).sort().pop();
  // 14 dni nazaj od najnovejšega dne, tudi dnevi brez pregleda
  const end = pgDate(days[0]);
  const days14 = Array.from({ length: 14 }, (_, j) => { const d = new Date(end); d.setDate(end.getDate() - 13 + j); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  const botIn14 = pgState.bot.filter((r) => days14.includes(r.dan));
  const copyIn14 = pgState.copy.filter((r) => days14.includes(r.dan));
  const sum = (list, pick) => list.reduce((a, r) => a + (Number(pick(r.data)) || 0), 0);
  const botSum = sum(botIn14, (d) => d.kpi?.neto), copySum = sum(copyIn14, (d) => d.kpi?.zrcaloNeto);
  const b = pgRow(pgState.bot, day), c = pgRow(pgState.copy, day);
  const bd = b?.data || {}, cd = c?.data || {};
  // podrobnosti
  const potek = `<div class="pgTwo"><div><small class="pgSub">Bot</small>${pgCurve([{ pts: bd.krivulja, color: "#46bec5" }], { oznake: bd.oznake, vrzel: bd.vrzel })}${bd.krivuljaOpomba ? `<p class="muted">${pgEsc(bd.krivuljaOpomba)}</p>` : ""}</div>
    <div><small class="pgSub">Kopiranje <span class="cpLegend"><i style="--c:#46bec5"></i>Zrcalo <i style="--c:#e2a93a"></i>Hitri <i style="--c:#c0eb75"></i>Sled</span></small>${pgCurve([{ pts: cd.krivulje?.Zrcalo, color: "#46bec5" }, { pts: cd.krivulje?.Hitri, color: "#e2a93a", width: 1.5 }, { pts: cd.krivulje?.Sled, color: "#c0eb75", width: 1.5 }])}${cd.krivuljeOpomba ? `<p class="muted">${pgEsc(cd.krivuljeOpomba)}</p>` : ""}</div></div>`;
  const blokFmt = (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 ? pgPlain(v) : j === 2 ? pgSolCell(v, 3) : j === 3 ? pgPctCell(v, 2) : pgPctCell(v, 0).replace("+", ""));
  const ure = `<div class="pgTwo"><div><small class="pgSub">Ta dan</small>${pgTable(["Del dneva", "Poslov", "Neto", "PnL", "V plusu"], bd.bloki, blokFmt)}</div><div><small class="pgSub">Zadnjih 7 dni</small>${pgTable(["Del dneva", "Poslov", "Neto", "PnL", "V plusu"], bd.bloki7, blokFmt)}</div></div>${bd.ureOpomba ? `<p class="muted">${pgEsc(bd.ureOpomba)}</p>` : ""}`;
  const best7 = bd.bloki7?.length ? [...bd.bloki7].sort((p, q) => q[3] - p[3])[0] : null;
  const rep = `<div class="pgTwo"><div><small class="pgSub">Bot</small>${pgTable(["Kovanec", "Čas", "Izid", "SOL"], bd.rep, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 ? pgPlain(v) : j === 2 ? pgPctCell(v, 1) : pgSolCell(v, 4)))}${bd.repOpomba ? `<p class="muted">${pgEsc(bd.repOpomba)}</p>` : ""}</div>
    <div><small class="pgSub">Kopiranje (Zrcalo, ob njem Hitri in Sled na istem vstopu)</small>${pgTable(["Kovanec", "Denarnica", "Čas", "Zrcalo", "Hitri", "Sled"], cd.rep, (v, j) => (j < 3 ? pgCell(pgEsc(v ?? "-")) : pgPctCell(v, 1)))}${cd.repOpomba ? `<p class="muted">${pgEsc(cd.repOpomba)}</p>` : ""}</div></div>`;
  const pravila = `${pgTable(["Pravilo", "Zaprtih", "Dobitki", "Povp. dobiček", "Povp. izguba", "Faktor", "PnL", "Neto SOL", "Držanje"], cd.pravila, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 ? pgPlain(v) : j === 2 ? pgPctCell(v, 0).replace("+", "") : j === 3 || j === 4 || j === 6 ? pgPctCell(v, 1) : j === 5 ? pgPlain(v === null ? "-" : pgN(v, 2)) : j === 7 ? pgSolCell(v, 4) : pgPlain(v === null ? "-" : pgN(v, 0) + " min")))}${cd.pravilaOpomba ? `<p class="muted">${pgEsc(cd.pravilaOpomba)}</p>` : ""}
    <small class="pgSub">Denarnice (Zrcalo)</small>${pgTable(["Denarnica", "Nakupov", "Zrcalo neto", "V plusu", "Zamik", "Cena zamika", "Preskokov"], cd.denarnice, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 || j === 6 ? pgPlain(v) : j === 2 ? pgSolCell(v, 4) : j === 3 ? pgPlain(v === null ? "-" : pgN(v, 0) + " %") : j === 4 ? pgPlain(v === null ? "-" : pgN(v, 0) + " s") : pgPctCell(v === null ? null : v * 100, 1)))}${cd.denarniceOpomba ? `<p class="muted">${pgEsc(cd.denarniceOpomba)}</p>` : ""}
    <div class="pgTwo"><div><small class="pgSub">Kako so se posli zaprli</small>${["Zrcalo", "Hitri", "Sled"].map((n) => (cd.izidi?.[n]?.length ? `<p class="pgMini"><b>${n}:</b> ${cd.izidi[n].map((x) => pgEsc(x[0]) + " " + x[1]).join(" · ")}</p>` : "")).join("")}</div><div><small class="pgSub">Preskoki</small>${cd.preskoki?.length ? `<p class="pgMini">${cd.preskoki.map((x) => pgEsc(x[0]) + " " + x[1]).join(" · ")}</p>` : `<p class="muted pgEmpty">Ni podatkov.</p>`}${cd.preskokiOpomba ? `<p class="muted">${pgEsc(cd.preskokiOpomba)}</p>` : ""}</div></div>`;
  const vzorci = `<div class="pgTwo"><div><small class="pgSub">Vzorci vstopa</small>${pgTable(["Vzorec", "Poslov", "Na posel", "V plusu", "Min"], bd.vzorci, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 ? pgPlain(v) : j === 2 ? pgPctCell(v, 2) : j === 3 ? pgPlain(pgN(v, 0) + " %") : pgPlain(pgN(v, 1))))}${bd.vzorciOpomba ? `<p class="muted">${pgEsc(bd.vzorciOpomba)}</p>` : ""}</div>
    <div><small class="pgSub">Vrste izstopov</small>${pgTable(["Izstop", "Poslov"], bd.izidi, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : pgPlain(v)))}${bd.izidiOpomba ? `<p class="muted">${pgEsc(bd.izidiOpomba)}</p>` : ""}</div></div>
    ${bd.kosi?.length ? `<small class="pgSub">Iz česa je sestavljen dan</small>${pgTable(["Skupina", "Poslov", "SOL"], bd.kosi, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 ? pgPlain(v) : pgSolCell(v, 4)))}${bd.kosiOpomba ? `<p class="muted">${pgEsc(bd.kosiOpomba)}</p>` : ""}` : ""}
    ${bd.cilj50?.opomba ? `<small class="pgSub">Prodaja pri +50 %</small><p class="muted">${pgEsc(bd.cilj50.opomba)}</p>` : ""}
    ${bd.senca?.length ? `<small class="pgSub">Senca ta dan</small>${pgTable(["Pravilo", "Poslov", "Na posel", "Napaka"], bd.senca, (v, j) => (j === 0 ? pgCell(pgEsc(v)) : j === 1 ? pgPlain(v) : j === 2 ? pgPctCell(v, 2) : pgPlain(v === null ? "-" : "± " + pgN(v, 2))))}${bd.sencaOpomba ? `<p class="muted">${pgEsc(bd.sencaOpomba)}</p>` : ""}` : ""}`;
  const zdravje = `<div class="pgChips">${pgChips(bd.zdravje)}${pgChips(cd.zdravje)}</div>${!bd.zdravje?.length && !cd.zdravje?.length ? `<p class="muted pgEmpty">Ni zapisov o zdravju.</p>` : ""}`;
  const opoz = [...(bd.opozorila || []).map((o) => ({ ...o, kdo: "Bot" })), ...(cd.opozorila || []).map((o) => ({ ...o, kdo: "Kopiranje" }))];
  const prompt = bd.prompt || cd.prompt || "";
  const opozBody = `${opoz.map((o) => `<p class="pgWarn"><b>${pgEsc(o.kdo)}: ${pgEsc(o.naslov || "")}</b><br>${pgEsc(o.besedilo || "")}</p>`).join("")}${prompt ? `<div class="pgPrompt"><div class="row"><b>Prompt za sonar chat</b><button type="button" id="pgCopyPrompt">Kopiraj prompt</button></div><pre>${pgEsc(prompt)}</pre></div>` : ""}`;
  const vrstice = [
    pgDetails("Potek dneva", [bd.krivuljaOpomba ? "bot: " + bd.krivuljaOpomba.split(". ")[0] : "", cd.krivuljeOpomba ? "kopiranje: " + cd.krivuljeOpomba.split(". ")[0] : ""].filter(Boolean).join(" · "), potek, true),
    b ? pgDetails("Po delih dneva", best7 ? "zadnjih 7 dni najboljši " + best7[0] + " (" + pgS(best7[3], 2) + " % na posel)" : "", ure) : "",
    pgDetails("Rep dneva", [bd.rep?.length ? "bot: " + bd.rep[0][0] + " " + pgS(bd.rep[0][2], 1) + " %, " + bd.rep[bd.rep.length - 1][0] + " " + pgS(bd.rep[bd.rep.length - 1][2], 1) + " %" : "", cd.rep?.length ? "kopiranje: " + cd.rep[0][0] + " " + pgS(cd.rep[0][3], 1) + " %" : ""].filter(Boolean).join(" · "), rep),
    c ? pgDetails("Pravila kopiranja in denarnice", cd.denarnice?.length ? cd.denarnice.slice(0, 3).map((w) => w[0] + " " + pgS(w[2], 2)).join(" · ") : "", pravila) : "",
    b ? pgDetails("Vzorci in izidi bota", bd.vzorci?.length ? [...bd.vzorci].sort((p, q) => q[2] - p[2]).map((v) => v[0] + " " + pgS(v[2], 1) + " %").slice(0, 3).join(" · ") : "", vzorci) : "",
    pgDetails("Zdravje", ((bd.zdravje?.length || 0) + (cd.zdravje?.length || 0)) + " zapisov", zdravje),
    opoz.length || prompt ? `<details class="pgDet warn"><summary><b>Opozorila${prompt ? " in prompt za sonar chat" : ""}</b><span>${opoz.length} ${opoz.length === 1 ? "opozorilo" : opoz.length === 2 ? "opozorili" : "opozoril"}${prompt ? " · 1 prompt" : ""}</span></summary><div class="pgIn">${opozBody}</div></details>` : "",
  ].join("");
  root.innerHTML = `
    <div class="pgTop"><h2>Pregledi</h2><span class="pgPill">Zadnji pregled <b>${last ? new Date(last).toLocaleString("sl-SI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</b> · naslednji jutri ob 8:00</span></div>
    <div class="pgPulz">
      <div class="pgPcard"><div class="pgPh"><h3>Bot · 14 dni</h3><span class="pgPsum">skupaj <b class="${pgTone(botSum)}">${pgS(botSum, 2)} SOL</b>${botIn14[0] ? ` · zadnji dan <b class="${pgTone(botIn14[0].data.kpi?.neto)}">${pgS(botIn14[0].data.kpi?.neto, 2)}</b>` : ""}</span></div><div class="pgBars">${pgPulz(pgState.bot, (d) => d.kpi?.neto, days14)}</div><div class="pgXl"><span>${pgShort(days14[0])}</span><span>${pgShort(days14[7])}</span><span>${pgShort(days14[13])}</span></div></div>
      <div class="pgPcard"><div class="pgPh"><h3>Kopiranje · 14 dni</h3><span class="pgPsum">Zrcalo skupaj <b class="${pgTone(copySum)}">${pgS(copySum, 2)} SOL</b></span></div><div class="pgBars">${pgPulz(pgState.copy, (d) => d.kpi?.zrcaloNeto, days14)}</div><div class="pgXl"><span>${pgShort(days14[0])}</span><span>${pgShort(days14[7])}</span><span>${pgShort(days14[13])}</span></div></div>
    </div>
    <div class="pgDayHead"><h2>${pgLong(day)}</h2><div class="pgNav"><button type="button" data-nav="prev"${i >= days.length - 1 ? " disabled" : ""}>‹ ${i < days.length - 1 ? pgShort(days[i + 1]) : "prej"}</button><button type="button" data-nav="last"${i === 0 ? " disabled" : ""}>zadnji</button><button type="button" data-nav="next"${i <= 0 ? " disabled" : ""}>${i > 0 ? pgShort(days[i - 1]) : "naprej"} ›</button></div></div>
    <div class="pgTwo pgCols">${pgBotCol(b)}${pgCopyCol(c)}</div>
    <div class="pgDets">${vrstice}</div>
    <p class="muted pgFoot">Pregled napiše jutranje opravilo iz podatkov prejšnjega dne (tabeli memecoin_reports in copy_reports). Številke so iste kot v Bilanci in Kopiranju, le zaključene za cel dan. Ni finančni nasvet.</p>`;
  root.querySelectorAll(".pgBar").forEach((el) => { el.onclick = () => { if (days.includes(el.dataset.day)) { pgState.day = el.dataset.day; renderPregledi(); } }; });
  root.querySelectorAll("[data-nav]").forEach((el) => { el.onclick = () => { const n = el.dataset.nav; pgState.day = n === "last" ? days[0] : n === "prev" ? days[Math.min(days.length - 1, i + 1)] : days[Math.max(0, i - 1)]; renderPregledi(); window.scrollTo({ top: 0, behavior: "smooth" }); }; });
  const cp = $("#pgCopyPrompt");
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(prompt); cp.textContent = "Kopirano"; setTimeout(() => (cp.textContent = "Kopiraj prompt"), 1500); } catch { cp.textContent = "Označi in kopiraj ročno"; } };
}
$("#pregledi").onclick = () => { navigate("reports"); loadPregledi(); };
setInterval(() => { if (view === "reports" && !document.hidden && Date.now() - pgState.loadedAt > 600000) loadPregledi(); }, 60000);
