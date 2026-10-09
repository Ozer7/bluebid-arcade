// Yank: a quick, experienced human picnic player against the computer bugs.
// Same physics and rules; the hand reacts in ~200 ms, decides faster and plays at full skill from the start.
// Usage: node tests/skilled.js [games]
const fs=require('fs'),vm=require('vm');
const n=+process.argv[2]||40;
let src=fs.readFileSync(require('path').join(__dirname,'..','js/games/yank.js'),'utf8');
const R=[["const pBrain = new Arcade.Human({ reaction: 0.26 });","const pBrain = new Arcade.Human({ reaction: 0.2 });"],
["const pSkill = () => Math.min(0.85, 0.35 + playT / 220);","const pSkill = () => 0.85;"],
["wait(pBrain.react() + 0.15 * Math.log2","wait(pBrain.react() * 0.8 + 0.08 * Math.log2"],
["isHuman('picnic')) {\n          const lostN","isHuman('picnic') || globalThis.__dda) {\n          const lostN"]];
for(const [a,b] of R){ if(!src.includes(a)) throw a; src=src.replace(a,b); }
const ctx={window:{},console,Math,setTimeout:()=>0,requestAnimationFrame:()=>0,__dda:true};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','js/engine.js'),'utf8'),ctx);vm.runInContext(src,ctx);
const def=ctx.Arcade.games.find(g=>g.id==='yank');const res={},T=[];
for(let m=0;m<n;m++){let over=null,time=0;const api={W:800,H:600,roles:{},isHuman:()=>false,humanCount:()=>0,keys:new Set(),pointer:{x:0,y:0},get time(){return time},end(w,d){if(!over)over={w,d}},toast(){},sfx(){}};
const g=def.create(api);while(!over&&time<300){g.update(1/60);time+=1/60;}res[over.w]=(res[over.w]||0)+1;T.push(time);}
T.sort((a,b)=>a-b);console.log('skilled picnic vs cpu bugs',JSON.stringify(res),'median',T[T.length>>1].toFixed(0)+'s');
