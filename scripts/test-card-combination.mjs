// Run: node scripts/test-card-combination.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sql = read('supabase/card-combination-system.sql');
const upgrade = read('supabase/card-combination-balance-v2.sql');
const bands = sql.match(/bands integer\[\]:=ARRAY\[([^\]]+)\]/)[1].split(',').map(Number);
const block = sql.match(/weights numeric\[\]\[\]:=ARRAY\[([\s\S]*?)\]::numeric\[\]\[\]/)[1];
const weights = [...block.matchAll(/ARRAY\[([^\]]+)\]/g)].map(x=>x[1].split(',').map(Number));
assert.equal(bands.length, 15);
assert.equal(weights.length, 15);
weights.forEach(row=>assert.ok(Math.abs(row.reduce((a,b)=>a+b)-100)<1e-9));
function rates(points, mask) {
 let hi = bands.findIndex(x=>x>=points); if (hi===0) hi=1;
 const lo=hi-1, f=(points-bands[lo])/(bands[hi]-bands[lo]);
 const out=Array(6).fill(0);
 weights[lo].forEach((v,i)=>{
  let t=i; while(t>=0&&!mask[t])t--; if(t<0)t=mask.indexOf(true);
  out[t]+=v*(1-f)+weights[hi][i]*f;
 });
 const rounded=out.map(v=>Math.round(v*1e6)/1e6);
 const last=rounded.findLastIndex(x=>x>0);
 rounded[last]+=100-rounded.reduce((a,b)=>a+b);
 return rounded;
}
function dominates(before, after) {
 for(let i=1;i<6;i++)assert.ok(after.slice(i).reduce((a,b)=>a+b)+0.000003>=before.slice(i).reduce((a,b)=>a+b),`CDF inversion at grade ${i}`);
}
const masks=[[true,true,true,true,true,true],[true,true,true,true,true,false],[false,true,true,true,true,false]];
const gradePoints=[1,3,7,15,30];
const recipes=[];
function enumerate(prefix,n,min=0){
 if(!n){recipes.push(prefix);return;}
 for(let g=min;g<5;g++)enumerate([...prefix,g],n-1,g);
}
for(let n=3;n<=5;n++)enumerate([],n);
assert.equal(recipes.length,231);
let transitions=0;
for(const mask of masks){
 let prev=null;
 for(let points=3;points<=150;points++){
  const row=rates(points,mask);
  assert.ok(row.every(x=>x>=0&&x<=100));
  assert.ok(Math.abs(row.reduce((a,b)=>a+b)-100)<1e-9);
  row.forEach((x,i)=>{if(!mask[i])assert.equal(x,0)});
  if(prev)dominates(prev,row);prev=row;
 }
 for(const recipe of recipes){
  const points=recipe.reduce((s,g)=>s+gradePoints[g],0),before=rates(points,mask);
  if(recipe.length<5)for(const added of gradePoints){dominates(before,rates(points+added,mask));transitions++;}
  for(const g of new Set(recipe))if(g<4){dominates(before,rates(points-gradePoints[g]+gradePoints[g+1],mask));transitions++;}
 }
}
assert.deepEqual(rates(75,masks[0]),[0,0,10,68,19,3]);
assert.deepEqual(rates(75,masks[1]),[0,0,10,68,22,0]);
assert.deepEqual(rates(150,masks[1]),[0,0,0,10,90,0]);
for(const name of ['rkbo_private.combo_rates','public.rkbo_combo_quote','public.rkbo_combine_cards']){
 const extract=s=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION '+name+'(')).split('\n$$;')[0];
 assert.equal(extract(sql),extract(upgrade),`${name} bootstrap/upgrade drift`);
}
assert.equal([...upgrade.matchAll(/CREATE OR REPLACE FUNCTION/g)].length,3);
assert.ok(!/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |DELETE FROM|rkbo_open_card_pack/.test(upgrade));
assert.ok(!read('rkbo-card-packs.js').includes('data-pack-tab="combine"'));
assert.ok(read('rkbo-combination.js').includes('packButton.after(button)'));
assert.ok(read('rkbo-online.js').includes('#rkbo-combo-overlay:not([hidden])'));
for(const name of ['rkbo-combination.js','rkbo-card-packs.js','rkbo-online.js','enhancements.css']){
 assert.ok(read('index.html').includes(name+'?v=combo-v2-20261027'));
}
console.log(JSON.stringify({status:'PASS',recipes:recipes.length,availabilityPatterns:masks.length,pointDistributions:148*masks.length,monotoneTransitions:transitions,bootstrapUpgradeParity:true,cacheVersions:true},null,2));
