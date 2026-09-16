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
export function result(entry,exit,sizeSOL=0.1){return sizeSOL*(exit*(1-.01)*(1-.005)/(entry*(1+.01)*(1+.005))-1)-.00001;}

export function overview(trades,{now=Date.now(),period='all',quality='all',rate=null,prices=new Map()}={}){
 const day=new Date(now);day.setHours(0,0,0,0);const since=period==='today'?day.getTime():period==='24h'?now-86400000:-Infinity;
 const events=trades.filter(t=>!t.practice&&!t.deletedAt&&t.interrupted),live=trades.filter(t=>!t.practice&&!t.deletedAt&&!t.interrupted),eligible=live.filter(t=>t.closed&&t.closed>=since&&t.closed<=now&&Number.isFinite(t.pnl)),excluded=events.length,closed=live.filter(t=>t.closed&&t.closed>=since&&t.closed<=now&&Number.isFinite(t.pnl)&&(quality!=='continuous'||!t.interrupted)).sort((a,b)=>a.closed-b.closed),open=live.filter(t=>!t.closed);
 const wins=closed.filter(t=>t.pnl>0).length,losses=closed.filter(t=>t.pnl<0).length;let net=0;const curve=closed.map(t=>({t:t.closed,pnl:(net+=t.pnl)}));
 const marks=open.map(t=>{const quote=prices.get(t.id);return {trade:t,pnl:!t.interrupted&&quote?.fresh&&Number.isFinite(quote.price)&&quote.price>0?result(t.entry,quote.price,tradeSize(t)):null};});
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
 return {state:'waiting',pattern:closest.name,missing:closest.missing,last,support,resistance:res};
}
