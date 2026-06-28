const d=require('./_tmp_jds.json');
const a=d.jds||d.data||[];
const KW = [
  ['seo', /seo|搜索引擎优化|关键词优化/i],
  ['advertising', /广告|信息流|投放|sem|feed|千川|广告素材|广告策略/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos|fps|mmo|演武/i],
  ['ai', /(^|[\s\-_/｜|（）()【】])ai(?=$|[\s\-_/｜|（）()【】])|ai(?=[^\x00-\x7f])|人工智能|大模型|llm|gpt|prompt|aigc|\bagent\b|comfyui|效能官|智能体/i],
  ['algorithm', /算法|推荐系统|nlp|机器学习|深度学习|计算机视觉/i],
  ['frontend', /前端|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端|web\s*sdk/i],
  ['backend', /后端|java|\bgo\b|golang|php|ruby|服务端|python|c\+\+|c#|\.net|架构师|架构设计|springcloud/i],
  ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量|代码审计/i],
  ['training', /培训|讲师|课程开发|教研|学习发展|经验萃取|sop工程化|赋能|带教|培训师|教学设计|演武|认证体系/i],
  ['product', /产品经理|产品总监|产品负责人|产品助理|产品调优|产品定价|专案产品|平台产品/i],
  ['design', /ui|ux|设计|视觉|动效/i],
  ['art', /美术|原画|概念设计|插画师|3d角色|3d动画|3d战斗|3d建模|建模师|动画师|绑定师|绑定|技术美术|ta(?=\s|$|[_\-/（）【】])|rigging|spine|动作设计|角色设计/i],
  ['marketing', /品牌|市场策划|市场推广|市场营销|市场运营|市场经理|市场总监|kol|公关|新媒体孵化|增长黑客|growth/i],
  ['video', /视频|剪辑|后期|短视频|视频制作|导演|摄像|影视|编导|cinemat|videograph/i],
  ['live', /直播(?!运营)|主播|场控|中控|带货主播|直播间|直播策划|直播主持|团播/i],
  ['legal', /法务|法律顾问|律师|合规|知识产权|版权|专利/i],
  ['finance', /财务|会计|出纳|审计|税务/i],
  ['data', /数据挖掘|爬虫|etl|数据仓库|数据分析|数据工程|大数据|数据治理/i],
  ['hardware', /gpu|硬件|芯片|嵌入式|固件|pcb|电路|cpu|cuda|kernel|微架构|tensor\s*core/i],
  ['hr', /hr|人力|招聘|薪酬|员工关系|组织发展|人事|ssc|绩效|社保|考勤/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售|新客户|商服/i],
  ['customer-service', /客服|客户服务|售后/i],
  ['content', /内容创作|内容编辑|内容生产|内容工程|采编|文案|脚本策划/i],
  ['operations', /运营|电商|直播运营|带货|选品|新媒体运营|社群|社区运营/i],
  ['project', /项目经理|pmo|scrum|pjm|项目管理/i],
  ['director', /总监|vp|副总裁|cto|ceo|负责人|组长/i],
  ['administration', /行政|前台|助理|秘书|档案|车辆|办公室|督导|签证|移民|数字游民/i],
];
const ORDER=KW.map(x=>x[0]);
function countHits(re,text){const g=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');const m=text.match(g);return m?m.length:0;}
function detectTitle(title){const t=(title||'').toLowerCase();const r=[];for(const[c,re]of KW){if(re.test(t))r.push(c);}return r.slice(0,3);}
function classify(title,body){
  const tc=detectTitle(title);
  if(tc.length) return tc; // title is reliable
  // fallback: title matched nothing -> score body, prefer strongest
  const b=(body||'').toLowerCase();
  const sc=[];for(const[c,re]of KW){const h=countHits(re,b);if(h>0)sc.push([c,h]);}
  sc.sort((x,y)=>y[1]-x[1]||ORDER.indexOf(x[0])-ORDER.indexOf(y[0]));
  if(sc.length) return [sc[0][0]];
  return ['operations'];
}
let changed=0;const moves={};const newCnt={};const fallbackList=[];
for(const j of a){
  const body=[...(j.responsibilities||[]),...(j.requirements||[])].join('\n');
  const nc=classify(j.title,body);
  for(const c of nc)newCnt[c]=(newCnt[c]||0)+1;
  const old=(j.categories||[]).slice().sort().join(',');const nw=nc.slice().sort().join(',');
  if(old!==nw){changed++;const k=old+' => '+nw;moves[k]=(moves[k]||0)+1;
    if(detectTitle(j.title).length===0) fallbackList.push(j.title.replace(/\s+/g,' ')+'  ['+old+' => '+nw+']');
  }
}
console.log('records:',a.length,'changed:',changed);
console.log('\n--- NEW counts ---');
console.log(Object.entries(newCnt).sort((x,y)=>y[1]-x[1]).map(e=>e[0]+': '+e[1]).join('\n'));
console.log('\n--- top moves ---');
console.log(Object.entries(moves).sort((x,y)=>y[1]-x[1]).slice(0,25).map(e=>e[1]+'x  '+e[0]).join('\n'));
console.log('\n--- sample fallback reclassifications (title matched nothing) ---');
console.log([...new Set(fallbackList)].slice(0,40).join('\n'));
