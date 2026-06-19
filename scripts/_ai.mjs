import fs from 'node:fs';
const env=fs.readFileSync('.env.local','utf8');
const get=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim().replace(/^["']|["']$/g,'');
const KV=get('KV_REST_API_URL'),TOK=get('KV_REST_API_TOKEN');
async function kvGet(key,tries=8){for(let i=0;i<tries;i++){try{const r=await fetch(KV+'/get/'+encodeURIComponent(key),{headers:{Authorization:'Bearer '+TOK}});const d=await r.json();return d.result;}catch(e){if(i===tries-1)throw e;await new Promise(s=>setTimeout(s,1200));}}}
const arr=JSON.parse(await kvGet('recruit:jds'));
const byTitle=new Map();
for(const j of arr){const t=(j.title||'').trim();if(!t)continue;const txt=((j.responsibilities||[]).join(' ')+' '+(j.requirements||[]).join(' '));const s=txt.length;const p=byTitle.get(t);if(!p||s>p._s)byTitle.set(t,{...j,_txt:txt,_s:s});}
const uniq=[...byTitle.values()];
const aiKw=['AI','人工智能','大模型','LLM','AIGC','提示词','Prompt','prompt','智能体','Agent','agent','机器学习','深度学习','算法','GPT','comfy','Comfy','Stable','Midjourney'];
const isAI=j=>(j.categories||[]).includes('ai')||(j.categories||[]).includes('algorithm')||aiKw.some(k=>(j.title+' '+j._txt).includes(k));
const ai=uniq.filter(isAI);
const hardKw=['精通','底层','源码','分布式','高并发','模型训练','微调','PyTorch','TensorFlow','CUDA','论文','硕士','博士','3年','三年','5年','五年','资深','C++','算法工程师','训练','深度学习','机器学习'];
const easyKw=['使用','会用','熟悉','了解','学习','应届','实习','不限','1年','一年','提示词','工具','沟通','表达','内容','运营','落地','应用','好奇','热爱'];
function sc(j){const t=j.title+' '+j._txt;let h=0,e=0;for(const k of hardKw)if(t.includes(k))h++;for(const k of easyKw)if(t.includes(k))e++;return{h,e,net:e-h*2};}
const ranked=ai.map(j=>({...j,...sc(j)})).sort((a,b)=>b.net-a.net);
let o='AI相关唯一岗位: '+ai.length+'\n\n';
for(const j of ranked){o+='● '+j.title+'  ['+(j.categories||[]).join(',')+'] '+(j.salaryText||'-')+'  (易'+j.e+'/难'+j.h+')\n  '+(j._txt||'(无正文)').slice(0,360)+'\n\n';}
fs.writeFileSync('scripts/_ai_out.txt',o);
console.log('done',ai.length);
