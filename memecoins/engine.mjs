export function pattern(points,now=Date.now()){
 const p=points.slice(-16);if(p.length<16)return {name:'Zbiranje podatkov',reason:`${p.length}/16 vzorcev; približno 8 minut opazovanja.`};
 if(now-p.at(-1).t>75000||p.some((v,i)=>!Number.isFinite(v.p)||v.p<=0||(i&&v.t-p[i-1].t>75000)))return {name:'Premor',reason:'Podatki so prestari ali imajo vrzel.'};
 const a=p.map(x=>x.p),last=a.at(-1),prev=a.at(-2),support=Math.min(...a.slice(0,10)),res=Math.max(...a.slice(0,10));
 const lows=a.map((x,i)=>i>0&&i<a.length-1&&x<a[i-1]&&x<a[i+1]?{x,i}:null).filter(Boolean);
 const check=(label,ok)=>({label,ok});
 const checks=[
 {name:'Preboj in retest',reason:'Cena je presegla odpor, se vrnila v njegovo bližino in ponovno zrasla.',items:[check('Cena je presegla odpor za več kot 2,5 %',a.slice(10,14).some(x=>x>res*1.025)),check('Predhodna cena se je vrnila blizu odpora (−1 % do +2 %)',prev>=res*.99&&prev<=res*1.02),check('Zadnja cena je zrasla za več kot 1 %',last>prev*1.01)]},
 {name:'Odboj od podpore',reason:'Zadnji vzorec je vsaj 1,5 % nad predhodnim dotikom območja podpore.',items:[check('Predhodna cena je blizu podpore (±2 %)',prev<=support*1.02&&prev>=support*.98),check('Zadnja cena je zrasla za več kot 1,5 %',last>prev*1.015)]},
 {name:'Višje dno',reason:'Zadnji lokalni minimum je vsaj 1 % nad prejšnjim, cena ponovno raste.',items:[check('Najdeni sta vsaj dve lokalni dni',lows.length>=2),check('Zadnje dno je med zadnjimi štirimi posnetki',lows.length>=2&&lows.at(-1).i>=12),check('Zadnje dno je več kot 1 % višje od prejšnjega',lows.length>=2&&lows.at(-1).x>lows.at(-2).x*1.01),check('Zadnja cena je zrasla za več kot 1 %',last>prev*1.01)]}];
 const matched=checks.find(c=>c.items.every(x=>x.ok));
 return {name:matched?.name||'Čakanje',reason:matched?.reason||'Noben od treh preprostih pogojev ni izpolnjen.',...(matched?{signal:true}:{}),checks,levels:{support,resistance:res,retest:prev*1.01,bounce:prev*1.015},previous:prev};
}
// Stroški, izmerjeni 20. 9. 2026 na 424 naših poslih: provizija bazena 0,25 % na stran (PumpSwap 0,20 LP + 0,05 protokol,
// Raydium v4 enako), vpliv na ceno pri 0,07 SOL mediana 0,054 % in p90 0,083 % (računano iz shranjene likvidnosti),
// omrežnina s prioriteto in Jito napitnino ~0,0001 SOL na transakcijo. Skupaj ~1 % na cel posel, prej smo računali 3 %.
export function result(entry,exit,sizeSOL=0.1){return sizeSOL*(exit*(1-.0025)*(1-.001)/(entry*(1+.0025)*(1+.001))-1)-.0002;}

export function overview(trades,{now=Date.now(),period='all',quality='all',rate=null,prices=new Map()}={}){
 const day=new Date(now);day.setHours(0,0,0,0);const since=period==='today'?day.getTime():period==='24h'?now-86400000:-Infinity;
 const events=trades.filter(t=>!t.practice&&!t.deletedAt&&t.interrupted),live=trades.filter(t=>!t.practice&&!t.deletedAt&&!t.interrupted),eligible=live.filter(t=>t.closed&&t.closed>=since&&t.closed<=now&&Number.isFinite(t.pnl)),excluded=events.length,closed=live.filter(t=>t.closed&&t.closed>=since&&t.closed<=now&&Number.isFinite(t.pnl)&&(quality!=='continuous'||!t.interrupted)).sort((a,b)=>a.closed-b.closed),open=live.filter(t=>!t.closed);
 const wins=closed.filter(t=>t.pnl>0).length,losses=closed.filter(t=>t.pnl<0).length;let net=0;const curve=closed.map(t=>({t:t.closed,pnl:(net+=t.pnl)}));
 const marks=open.map(t=>{const quote=prices.get(t.id);return {trade:t,pnl:!t.interrupted&&quote?.fresh&&Number.isFinite(quote.price)&&quote.price>0?markToMarket(t,quote.price):null};});
 return {events,excluded,closed,open,wins,losses,flat:closed.length-wins-losses,net,usd:Number.isFinite(rate)&&rate>0?net*rate:null,success:closed.length?wins/closed.length:null,curve,marks,unrealized:marks.some(m=>m.pnl===null)?null:marks.reduce((s,m)=>s+m.pnl,0)};
}

export function tradeSize(t){return t.sizeSOL===undefined?0.1:t.sizeSOL;}
export function netReturnPercent(trade){const size=tradeSize(trade);return Number.isFinite(trade.pnl)&&Number.isFinite(size)&&size>0?trade.pnl/size*100:null;}
export function parseStake(text){const value=String(text).trim();if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value))return null;const n=Number(value.replace(',','.'));return Number.isFinite(n)&&n>0?n:null;}

// Vstopna točka za laika: "bot vstopi, če NASLEDNJA cena preseže X". Ocena za naslednji posnetek (okno se premakne),
// pravila v1.0 v pattern() ostanejo edini vir resnice za dejanski vstop.
export function entryPoint(points,now=Date.now()){
 const p=points.slice(-16);if(p.length<16)return {state:'collecting',have:p.length,need:16};
 const s=pattern(p,now);if(s.name==='Premor')return {state:'paused',reason:s.reason};
 if(s.signal)return {state:'signal',pattern:s.name,price:p.at(-1).p};
 const a=p.map(x=>x.p),last=a.at(-1),support=s.levels.support,res=s.levels.resistance;
 const lows=a.map((x,i)=>i>0&&i<a.length-1&&x<a[i-1]&&x<a[i+1]?{x,i}:null).filter(Boolean);
 const candidates=[];
 // Odboj: zadnja cena je blizu podpore -> naslednja mora biti > zadnja * 1,015
 const nearSupport=last<=support*1.02&&last>=support*.98;
 candidates.push({name:'Odboj od podpore',ready:nearSupport,price:last*1.015,missing:nearSupport?[]:['cena mora priti v območje podpore ±2 %']});
 // Preboj in retest: preboj odpora v oknu in zadnja cena blizu odpora -> naslednja > zadnja * 1,01
 const broke=a.slice(11,15).some(x=>x>res*1.025),nearRes=last>=res*.99&&last<=res*1.02;
 candidates.push({name:'Preboj in retest',ready:broke&&nearRes,price:last*1.01,missing:[...(broke?[]:['cena mora prej prebiti odpor za več kot 2,5 %']),...(nearRes?[]:['cena se mora vrniti blizu odpora (−1 % do +2 %)'])]});
 // Višje dno: dve dni, zadnje dno višje in nedavno -> naslednja > zadnja * 1,01
 const twoLows=lows.length>=2,higher=twoLows&&lows.at(-1).x>lows.at(-2).x*1.01,recent=twoLows&&lows.at(-1).i>=13,forming=lows.length>=1&&last<a.at(-2)&&last>lows.at(-1).x*1.01;
 const hlReady=(twoLows&&higher&&recent)||forming;
 candidates.push({name:'Višje dno',ready:hlReady,price:last*1.01,missing:hlReady?[]:[...(twoLows?[]:['potrebni sta vsaj dve lokalni dni']),...(twoLows&&!higher?['zadnje dno mora biti več kot 1 % nad prejšnjim']:[]),...(twoLows&&higher&&!recent?['zadnje dno mora biti med zadnjimi štirimi posnetki']:[])]});
 const ready=candidates.filter(c=>c.ready).sort((x,y)=>x.price-y.price);
 if(ready.length)return {state:'ready',pattern:ready[0].name,price:ready[0].price,last,support,resistance:res,alternatives:ready.slice(1)};
 const closest=[...candidates].sort((x,y)=>x.missing.length-y.missing.length)[0];
 // Ocena za graf, ko pogoj še ni izpolnjen: kam mora cena najprej priti (zone) in kje bi bil potem približen vstop (estimate).
 const zone=closest.name==='Odboj od podpore'?[support*.98,support*1.02]:closest.name==='Preboj in retest'?[res*.99,res*1.02]:null;
 const estimate=closest.name==='Odboj od podpore'?support*1.015:closest.name==='Preboj in retest'?res*1.01:last*1.01;
 return {state:'waiting',pattern:closest.name,missing:closest.missing,last,support,resistance:res,zone,estimate};
}

// ---------- Profili izstopa (v1.1). Vstopi ostajajo pravila v1.0, spremeni se samo, kako se posel zapre. ----------
// halfAt: pri tem dobičku proda polovico in premakne mejo na vstop; trail: ostanek proda, ko cena pade toliko s svojega vrha;
// hardStop: trda meja, dokler sledilna meja ni višja.
// Vse tri stats številke so iz ISTE meritve (19. 9. 2026): ponovitev vseh treh profilov na istih 233 resničnih
// 30-sekundnih cenovnih poteh (senčni vstopi v1.2, okno 18. do 19. 9.), da so med seboj primerljive. Razlike med
// profili so znotraj merilne napake (standardna napaka okoli 2 odstotni točki), zato iz njih ne delaj razvrstitve.
// Agresivno je 19. 9. 2026 na novo nastavljen: sled 20 -> 15 %, trda meja 10 -> 15 %. Številke so iz ponovitve na 233
// resničnih 30-sekundnih cenovnih poteh (senčni vstopi v1.2, okno 18. do 19. 9.), z isto formulo kot spodnji stepExit
// (vrh se začne pri vstopni ceni). Stara nastavitev da -6,75 % na posel, nova -3,44 %; drži v obeh polovicah obdobja.
// Trda meja nad 15 % ne bi spremenila nič, ker sled 15 % od vstopa naprej vedno leži višje. Stare posle se od novih
// loči po shranjenem t.plan.trail (0.20 staro, 0.15 novo); odprti posli obdržijo načrt, s katerim so bili odprti.
export const PROFILES={
 hitri:{key:'hitri',name:'Hitri',halfAt:null,trail:null,hardStop:0.05,cap:0.10,tagline:'Cilj +10 %, meja -5 %. Najbolje izmerjen, dodan 20. 9.',
  how:'Ne prodaja po delih in ne sledi vrhu. Proda vse, ko je posel +10 %, ali zapre pri -5 %. Povprečno traja dve minuti.',
  who:'Zate, če hočeš, da bot vzame majhen dobiček in gre ven. Na 342 izmerjenih poteh je najmanj slab od štirih, prednost pred Srednje je 2,7 odstotne točke na posel (interval zaupanja 0,4 do 5,1). Še vedno je v minusu.',
  stats:{win:41,avgWin:17.0,avgLoss:-15.4,perTrade:-2.15}},
 varen:{key:'varen',name:'Varen',halfAt:0.15,trail:0.12,hardStop:0.08,cap:null,tagline:'Brez cilja. Dobiček pobere zgodaj, ostanek sledi vrhu.',
  how:'Ko je posel +15 %, proda polovico in premakne mejo na vstopno ceno (od tu naprej ta posel ne more več končati v izgubi). Drugo polovico proda, ko cena pade 12 % s svojega vrha. Če gre cena takoj navzdol, zapre pri -8 %.',
  who:'Zate, če hočeš čim manj hudih izgub. Na izmerjenih poslih je to najmanj slaba od treh možnosti, ampak še vedno v minusu.',
  stats:{win:35,avgWin:20.9,avgLoss:-20.7,perTrade:-6.30}},
 srednje:{key:'srednje',name:'Srednje',halfAt:0.20,trail:0.15,hardStop:0.12,cap:0.50,tagline:'Pol pri +20 %, vse pri +50 %. Cilj dodan 20. 9.',
  how:'Ko je posel +20 %, proda polovico in premakne mejo na vstopno ceno. Ostanek proda, ko cena doseže +50 % (cilj) ali ko pade 15 % s svojega vrha, kar pride prej. Če gre cena takoj navzdol, zapre pri -12 %.',
  who:'Zate, če hočeš pustiti dobitnikom nekaj prostora in vseeno zakleniti del dobička, ko pride.',
  stats:{win:35,avgWin:26.7,avgLoss:-24.9,perTrade:-6.88}},
 agresivno:{key:'agresivno',name:'Agresivno',halfAt:null,trail:0.15,hardStop:0.15,cap:0.50,tagline:'Brez delne prodaje. Vse pri +50 % ali 15 % pod vrhom.',
  how:'Ne prodaja po delih. Drži celoten posel in proda vse, ko cena doseže +50 % (cilj) ali ko pade 15 % s svojega vrha, kar pride prej. Če gre cena takoj navzdol, zapre pri -15 %.',
  who:'Zate, če ti ne bo težko gledati, da je večina poslov izgubnih (dobra četrtina je dobitnih), ker so dobitniki veliki. Cilj +50 % je dodan 20. 9. Na 346 resničnih poteh izboljša rezultat z -19,2 % na -10,1 % na posel, kar je največja razlika med vsemi izstopi, ki smo jih izmerili. Agresivno je kljub temu najslabši od treh profilov.',
  stats:{win:24,avgWin:53.1,avgLoss:-29.8,perTrade:-10.18}}
};
export const DEFAULT_PROFILE='hitri';
export function profileOf(t){return t?.plan?PROFILES[t.profile]||null:null;}
// Začetne ravni za nov posel po profilu (stari posli brez t.plan ostanejo na fiksnem cilju +10 % / meji -5 %).
export function exitPlan(profileKey,entry){
 const p=PROFILES[profileKey]||PROFILES[DEFAULT_PROFILE];
 return {profile:p.key,plan:{halfAt:p.halfAt,trail:p.trail,hardStop:p.hardStop,cap:p.cap||null},stop:entry*(1-p.hardStop),target:p.halfAt?entry*(1+p.halfAt):null,cap:p.cap?entry*(1+p.cap):null,peak:entry,halfSold:false,ruleVersion:p.cap?'1.3':'1.2'};
}
// En korak izstopne logike za en nov posnetek. Vrne besedilo razloga, če se posel zapre, sicer null.
export function stepExit(t,price){
 if(!t.plan){ if(price<=t.stop)return 'Meja izgube'; if(price>=t.target)return 'Cilj'; return null; }
 t.peak=Math.max(t.peak||t.entry,price);
 // Primerjamo donos in ne cene: 100*(1+0.1) je v plavajoci vejici 110.00000000000001, zato cena 110 ne bi sprozila cilja.
 const g=t.entry>0?price/t.entry-1:0,EPS=1e-9;
 if(t.plan.halfAt&&!t.halfSold&&g>=t.plan.halfAt-EPS){t.halfSold=true;t.halfPrice=price;t.stop=Math.max(t.stop,t.entry);}
 if(t.plan.cap&&g>=t.plan.cap-EPS)return 'Cilj +'+Math.round(t.plan.cap*100)+' %';
 if((!t.plan.halfAt||t.halfSold)&&t.plan.trail)t.stop=Math.max(t.stop,t.peak*(1-t.plan.trail));
 if(price<=t.stop){
  const hard=t.entry*(1-t.plan.hardStop);
  if(t.halfSold)return price>=t.entry?'Sledilna meja (dobiček)':'Sledilna meja pod vstopom';
  return t.stop>hard*1.0001?(price>=t.entry?'Sledilna meja (dobiček)':'Sledilna meja'):'Trda meja -'+Math.round(t.plan.hardStop*100)+' %';
 }
 return null;
}
// Rezultat posla pri dani ceni, upoštevajoč morebitno že prodano polovico.
export function markToMarket(t,price){const size=tradeSize(t);return t.halfSold&&Number.isFinite(t.halfPrice)?0.5*result(t.entry,t.halfPrice,size)+0.5*result(t.entry,price,size):result(t.entry,price,size);}
