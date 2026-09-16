# foqs.si/memecoins · Signalni dnevnik (Solana)

Aplikacija za opazovanje novih Solana memecoinov in vajo (demo posli brez pravega denarja).
Teče kot statična stran na GitHub Pages (ta mapa), podatke in logiko na strežniku pa daje Supabase projekt `ura-plus`.

## Kje kaj je

| Del | Kje | Kaj dela |
| --- | --- | --- |
| `index.html` | ta mapa | prijava (Supabase auth, ena prijava za vse foqs. aplikacije), postavitev strani, CSS |
| `app.mjs` | ta mapa | vsa logika v brskalniku: branje posnetkov, grafi, dnevnik, sinhronizacija profila, zavihek Primerjava |
| `engine.mjs` | ta mapa | pravila v1.0 (vzorci Odboj, Višje dno, Preboj/retest), vstopna točka, izračun rezultata |
| edge funkcija `collect` | Supabase, `supabase/functions/collect` (index.ts + shadow.ts) | vsakih 30 s pobere pare z DEX Screener, zapiše posnetke in požene senčni test |
| edge funkcija `market` | Supabase | starejši posrednik do DEX Screener, aplikacija ga ne uporablja več |
| cron `memecoin-collect` | Supabase pg_cron | vsakih 30 s pokliče `collect` (net.http_post s ključem `x-collect-key`) |
| cron `memecoin-cleanup` | Supabase pg_cron, vsako uro | briše stare posnetke (36 h), potekle vnose watch, stare preverbe imetnikov (2 d), senčne posle (60 d) |

Izvorna koda edge funkcij ni v tem repozitoriju (repo je javen, funkcija pa vsebuje ključ). Zadnja različica je v Supabase nadzorni plošči: Edge Functions > collect > Code.

## Tabele (Supabase, shema public)

- `memecoin_snapshots` (PK pair + t): cena, mcap, likvidnost, promet 5 min / 1 h, nakupi in prodaje 5 min / 1 h, sprememba 5 min / 1 h, `liq_base` (količina kovanca v likvidnosti), čas nastanka para, slika, url. Piše jih samo `collect` (service role). Branje: prijavljeni uporabniki.
- `memecoin_state` (PK user_id): dnevnik, vložek in stikalo samodejnih vstopov enega uporabnika. RLS: vsak vidi in piše samo svojo vrstico.
- `memecoin_watch`: pari z odprtim demo poslom, da jih `collect` spremlja tudi, ko izpadejo iz izbora DEX Screener. Vnos poteče po 12 h.
- `memecoin_shadow_trades`: senčni posli štirih strategij (glej spodaj). Piše `collect`, bere aplikacija (zavihek Primerjava). RLS: branje samo za e-poštne naslove na seznamu v politiki.
- `memecoin_holder_checks` (PK token): predpomnjeno preverjanje imetnikov (top 10, največji imetnik, sumljivi grozdi), veljavno 10 min.

## Kako tečejo podatki

1. Cron vsakih 30 s pokliče `collect`.
2. `collect` vzame do 25 zadnjih Solana profilov z DEX Screener (`/token-profiles/latest/v1`) in pare iz `memecoin_watch`, za vsakega poišče najbolj likviden par (`/tokens/v1/solana/<naslovi>`) in zapiše en posnetek na par v `memecoin_snapshots`.
3. Isti klic požene `runShadow` (shadow.ts): naloži zadnjih 22 min posnetkov in odprte senčne posle, zapre kar je treba zapreti in odpre nove posle po pravilih vsake strategije.
4. Brskalnik ob odprtju naloži zadnjo uro posnetkov, potem vsakih 30 s samo nove vrstice. Pravila v1.0 za demo posle tečejo v brskalniku; odprte posle ob odprtju preigra po zgodovini s strežnika, zato osvežitev strani ne izgubi ničesar.
5. Dnevnik in nastavitve gredo ob vsaki spremembi v `memecoin_state` (isti profil v vseh brskalnikih). localStorage je samo predpomnilnik.

## Senčni test (zavihek Primerjava)

Štiri strategije tečejo na strežniku vzporedno, na istih posnetkih, vsaka s svojim seznamom poslov:

| Strategija | Izbor kovancev | Vstop | Izstop |
| --- | --- | --- | --- |
| `v1.0` | kot v aplikaciji (likvidnost nad 10K $) | vzorci Odboj, Višje dno, Preboj/retest | cilj +10 %, meja -5 % |
| `v2.0` | starost 5 do 90 min, MC 8K do 80K $, likvidnost nad 10K $ in vsaj 15 % MC, promet 5 min vsaj 20 % likvidnosti, vsaj 15 nakupov, nakupi/prodaje vsaj 1,2, sprememba 1 h do +150 % | vrnitev po padcu 35 do 55 % s prejšnjega vrha (rast pred tem vsaj 40 %), največ 12 % nad dnom, zadnji posnetek višji od prejšnjega; preverjanje imetnikov (top 10 do 30 %, največji do 8 %, brez grozdov) | rug izhod (likvidnost -25 % v 5 min ali prodaje 2x nakupi), pol prodaje pri +25 % in nato meja na vstopu, sledilna meja 20 % pod vrhom, meja izgube -12 %, časovna meja 15 min če vrh pod +8 % |
| `v2.0-brez-holderjev` | kot v2.0 | kot v2.0 brez preverjanja imetnikov | kot v2.0 |
| `v2.1-preboj` | kot v2.0 | preboj 15-minutnega vrha za 3 do 10 % ob nakupi/prodaje vsaj 1,5 in prometu vsaj 30 % likvidnosti | kot v2.0 |

Skupno za vse: vložek 0,07 SOL na posel, portfelj 0,3 SOL, stroški 1,5 % zdrsa in 1 % provizije na vsaki strani plus 0,00001 SOL, največ 3 odprti posli (v1.0: 5), en posel na kovanec, 30 min premora po zaprtju istega kovanca, dnevna zavora (ustavi se pri -15 % portfelja ali treh zaporednih mejah izgube), zaprtje "Vrzel podatkov" če para ni v posnetkih več kot 75 s.

Kriteriji za preklop aplikacije na nova pravila: vsaj 100 zaključenih poslov ali 14 dni, faktor dobička nad 1,3, pričakovanje nad +2 % na posel. Med testom se pravila ne spreminjajo.

## Kako objaviti spremembo

1. Uredi datoteke v tej mapi.
2. V `index.html` povečaj številko pri `app.mjs?v=N` (in v `app.mjs` pri `engine.mjs?v=N`, če se je spremenil engine). GitHub Pages in brskalniki sicer do 10 minut kažejo staro različico.
3. Commit in Push origin (GitHub Desktop). Stran je živa na https://foqs.si/memecoins čez minuto ali dve; ob prvem odprtju po objavi včasih pomaga Cmd+Shift+R.
4. Spremembe edge funkcije `collect` se objavijo posebej (Supabase, Deploy); posnetki in senčni posli se pri tem ne izgubijo.

## Omejitve

- Izbor kovancev je omejen na profile DEX Screener (plačani profili), ne na vse nove pare. Faz New Pairs / Final Stretch / Migrated z Axioma ne poznamo.
- Cene so posnetki na 30 s, ne borzne sveče. Zakasnitev ponudnika ni znana.
- Nič tu ne trguje s pravim denarjem in ne preverja dejanske izvršljivosti naročil.
