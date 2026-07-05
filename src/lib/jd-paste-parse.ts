import type { JDCategory } from '@/types/jd';

// 整段「粘贴识别」JD 解析 —— 与 jd-parse-core.ts(Excel列解析)是两条不同管道，刻意分开避免长出第三套逻辑。
// 从 JDLibraryPage 抽出，供添加表单的粘贴识别使用。

const CAT_MAP: [JDCategory, RegExp][] = [
  ['seo', /seo|搜索引擎|关键词/i], ['advertising', /广告|信息流|投放|sem|feed|千川/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos/i], ['ai', /人工智能|大模型|llm|gpt|prompt/i],
  ['algorithm', /算法|推荐|nlp|机器学习|深度学习|计算机视觉/i], ['frontend', /前端|web|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端/i],
  ['backend', /后端|java|go|golang|php|ruby|服务端|python|c\+\+|c#|架构师|开发/i], ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量/i], ['product', /产品经理|产品总监|产品助理/i], ['design', /ui|ux|设计|视觉|插画|动效/i],
  ['finance', /财务|会计|出纳|审计|税务/i], ['hr', /hr|人力|招聘|薪酬|培训|员工关系/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售/i], ['customer-service', /客服|客户服务|售后/i],
  ['operations', /运营|电商|直播|带货|主播|中控|场控|选品/i], ['project', /项目|pmo|scrum/i],
  ['director', /总监|vp|副总裁|cto|ceo|负责人/i], ['administration', /行政|前台|助理|秘书|档案|车辆|办公室/i],
  ['data', /数据挖掘|数据工程|爬虫|etl|数仓|数据/i], ['hardware', /gpu|硬件|芯片|嵌入式|固件/i],
];

export function detectCat(text: string): JDCategory {
  const t = text.toLowerCase();
  for (const [cat, re] of CAT_MAP) { if (re.test(t)) return cat; }
  return 'operations';
}

function detectCats(text: string): JDCategory[] {
  const t = text.toLowerCase();
  const cats: JDCategory[] = [];
  for (const [cat, re] of CAT_MAP) {
    if (re.test(t) && !cats.includes(cat)) cats.push(cat);
  }
  return cats.length > 0 ? cats.slice(0, 3) : ['operations'];
}

function cleanupTitle(line: string): string {
  return line
    .replace(/^【[^】]+】\s*/, '')
    .replace(/[（(]\s*\d+\s*人\s*[）)]/g, '')
    .replace(/^\s*急聘\s*[|｜-]?\s*/i, '')
    .trim();
}

function pickField(text: string, re: RegExp): string {
  return text.match(re)?.[1]?.trim() || '';
}

function extractSection(text: string, startKeys: string[], endKeys: string[]): string {
  const startPattern = startKeys.join('|');
  const endPattern = endKeys.length > 0 ? endKeys.join('|') : '$';
  const re = new RegExp(`(?:^|\\n)(?:${startPattern})\\s*[:：]?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:${endPattern})\\s*[:：]?\\s*(?:\\n|$)|$)`);
  const content = text.match(re)?.[1]?.trim() || '';
  return content
    .split('\n')
    .map((line) => line.replace(/^[\d]+[.、]\s*/, '').replace(/^[-•·]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

export function parseRawJD(raw: string): {
  title: string;
  department: string;
  salary: string;
  location: string;
  responsibilities: string;
  requirements: string;
  categories: string[];
} {
  const text = raw.replace(/\r/g, '').trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const titleLine = pickField(text, /(?:职位名称|岗位名称)[:：]\s*([^\n]+)/i) ||
    lines.find((line) => !/薪资|办公地点|工作地点|岗位亮点|岗位职责|工作内容|任职要求|岗位要求|职位要求|加分项/.test(line)) || '';
  const title = cleanupTitle(titleLine);
  const department = pickField(text, /(?:部门|所属部门|渠道|团队)[:：]\s*([^\n]+)/i);
  const salary = pickField(text, /(?:薪资待遇|薪资|月薪|薪酬)[:：]\s*([^\n]+)/i);
  const location = pickField(text, /(?:办公地点|工作地点|地点)[:：]\s*([^\n]+)/i);
  const responsibilities = extractSection(text, ['岗位职责', '工作职责', '工作内容', '职位职责'], ['任职要求', '岗位要求', '职位要求', '加分项']);
  const requirements = [
    extractSection(text, ['任职要求', '岗位要求', '职位要求'], ['加分项', '岗位职责', '工作职责', '工作内容']),
    extractSection(text, ['加分项'], []),
  ].filter(Boolean).join('\n');
  const categories = detectCats([title, responsibilities, requirements].join(' '));

  return { title, department, salary, location, responsibilities, requirements, categories };
}

export function parseSalary(s: string): { min: number; max: number; currency: string } {
  if (!s) return { min: 0, max: 0, currency: 'K' };
  const match = s.replace(/[,，]/g, '').match(/(\d+)\s*[-~至到]\s*(\d+)\s*([kKw万])?/i);
  if (match) {
    const mult = match[3]?.toLowerCase() === '万' ? 10 : 1;
    return { min: Math.max(0, parseInt(match[1]) * mult), max: Math.max(0, parseInt(match[2]) * mult), currency: match[3]?.toUpperCase() || 'K' };
  }
  return { min: 0, max: 0, currency: 'K' };
}
