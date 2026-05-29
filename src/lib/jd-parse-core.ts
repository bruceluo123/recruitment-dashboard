// Pure JD parsing core — shared by the client store (Excel import) and the
// server-side Google Sheet sync cron. No React / Zustand / browser-only deps.

import type { JD, JDCategory } from '@/types/jd';
import { generateId } from '@/lib/utils';

// ─── Column keyword lists ───

export const SALARY_KEYS = ['薪酬', '薪资', '工资', '待遇', '月薪', '年薪', '薪酬与福利', '薪酬福利', '薪资待遇', '薪酬范围', '薪资范围', '薪资区间', '薪资水平', '工资待遇', '薪水', '报酬', 'salary', 'compensation', '底薪', '底薪范围', '综合薪资', '总包', '年包'];
export const DEPT_KEYS = ['部门', '所属部门', '用人部门', '工作部门', '事业部', '团队', 'department', 'dept', '所在部门', '归属部门', '职能部门'];
export const LOC_KEYS = ['地点', '工作地点', '城市', '工作城市', '办公地点', '所在地', '工作地址', '地址', 'location', 'city', 'base'];
export const TITLE_KEYS = ['岗位名称', '职位名称', '岗位', '职位', 'title', 'job_title'];
export const EXCLUDED_TITLE_KEYS = ['序号', '编号', 'id', '自动序号', 'no', 'index'];
export const ORG_KEYS = ['编制组织', '编制', '所属公司', '归属公司', '归属组织'];
export const SERVICE_KEYS = ['服务单位', '所属单位', '业务单位', '所在单位'];
export const HC_KEYS = ['hc', 'headcount', '招聘人数', '编制数', '人数', 'hc数'];
export const VACANCY_KEYS = ['缺口', '空缺', '待招', '招聘缺口'];
export const SKIP_KEYS = ['已到岗', '已发offer', '待入职', '提需日期', '期望到岗日期', '期望到岗'];

// ─── Row normalization ───

export function normalizeExcelRows(rawRows: unknown[][]): Record<string, string>[] {
  const rows = rawRows
    .map((row) => row.map((cell) => String(cell || '').trim()))
    .filter((row) => row.some(Boolean));

  if (!rows.length) return [];

  // Find the first header row in the first 5 rows (handles sheets with leading blank/metadata rows)
  const headerRowIdx = rows.slice(0, 5).findIndex(looksLikeHeaderRow);
  if (headerRowIdx >= 0) {
    const headers = rows[headerRowIdx].map((h, i) => h || `列${i + 1}`);
    return rows.slice(headerRowIdx + 1).map((row) => {
      const item: Record<string, string> = {};
      headers.forEach((header, i) => { item[header] = row[i] || ''; });
      return item;
    });
  }

  const headers = ['岗位名称', '岗位内容', '薪资', '部门', '备注', '备注2', '备注3', '备注4', '备注5'];
  return rows.map((row) => {
    const item: Record<string, string> = {};
    row.forEach((cell, i) => { item[headers[i] || `列${i + 1}`] = cell; });
    return item;
  });
}

function looksLikeHeaderRow(row: string[]): boolean {
  const compactCells = row.filter(Boolean);
  if (!compactCells.length) return false;
  const matched = compactCells.filter((cell) =>
    matchesAnyKeyword(cell, TITLE_KEYS) ||
    matchesAnyKeyword(cell, SALARY_KEYS) ||
    matchesAnyKeyword(cell, DEPT_KEYS) ||
    matchesAnyKeyword(cell, LOC_KEYS) ||
    matchesAnyKeyword(cell, ORG_KEYS) ||
    matchesAnyKeyword(cell, SERVICE_KEYS) ||
    matchesAnyKeyword(cell, HC_KEYS) ||
    matchesAnyKeyword(cell, VACANCY_KEYS)
  ).length;
  const hasLongContent = compactCells.some((cell) => cell.length > 80);
  return matched >= 2 && !hasLongContent;
}

export function matchesAnyKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  return keywords.some((kw) => {
    const key = kw.toLowerCase().replace(/\s+/g, '');
    return normalized === key || normalized.includes(key);
  });
}

export function findColumnByKeywords(headers: string[], keywords: string[]): string | null {
  for (const h of headers) {
    if (matchesAnyKeyword(h, keywords)) return h;
  }
  return null;
}

export function findTitleColumn(headers: string[]): string | null {
  return headers.find((h) => isAllowedTitleHeader(h) && !isExcludedTitleHeader(h)) || null;
}

export function isAllowedTitleHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return TITLE_KEYS.some((key) => normalized === normalizeHeader(key));
}

function isExcludedTitleHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return EXCLUDED_TITLE_KEYS.some((key) => normalized === normalizeHeader(key));
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s()（）]/g, '');
}

// ─── Section split ───

export function splitJDBySection(text: string): { responsibilities: string[]; requirements: string[] } {
  const RESP_HEADER = /^(【工作内容】|【岗位职责】|【工作职责】|【工作描述】|工作内容[：:。]?|岗位职责[：:。]?|工作职责[：:。]?)/;
  const REQ_HEADER = /^(【任职要求】|【岗位要求】|【岗位需求】|【条件】|【任职条件】|【资质要求】|任职要求[：:。]?|岗位需求[：:。]?|任职条件[：:。]?)/;
  const rawLines = text.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean);
  let currentBucket: 'resp' | 'req' = 'resp';
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  let hasMarkers = false;
  for (const line of rawLines) {
    if (RESP_HEADER.test(line)) {
      hasMarkers = true;
      currentBucket = 'resp';
      const content = line.replace(RESP_HEADER, '').trim();
      if (content) responsibilities.push(...splitOnPunct(content));
    } else if (REQ_HEADER.test(line)) {
      hasMarkers = true;
      currentBucket = 'req';
      const content = line.replace(REQ_HEADER, '').trim();
      if (content) requirements.push(...splitOnPunct(content));
    } else {
      const parts = splitOnPunct(line);
      if (currentBucket === 'req') requirements.push(...parts);
      else responsibilities.push(...parts);
    }
  }
  if (!hasMarkers) {
    const lines = rawLines
      .flatMap((s) => s.split(/[；;。]+/))
      .map((s) => s.replace(/^[\d一二三四五六七八九十]+[.、,，\s]+/, '').trim())
      .filter((s) => s.length > 1);
    return { responsibilities: lines, requirements: [] };
  }
  return { responsibilities, requirements };
}

function splitOnPunct(text: string): string[] {
  return text.split(/[；;。]+/)
    .map((s) => s.replace(/^[\d一二三四五六七八九十]+[.、,，\s]+/, '').trim())
    .filter((s) => s.length > 1);
}

// ─── Category detection ───

const CATEGORY_KEYWORDS: [JDCategory, RegExp][] = [
  ['seo', /seo|搜索引擎优化|关键词优化/i],
  ['advertising', /广告|信息流|投放|sem|feed|千川|广告素材|广告策略/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos|fps|mmo/i],
  // AI: 匹配独立AI词、AI+中文前缀(AI应用/AI效能/AI产品...)、AIGC、Agent、comfyui
  ['ai', /(^|[\s\-_/｜|（）()【】])ai(?=$|[\s\-_/｜|（）()【】])|ai(?=[^\x00-\x7f])|人工智能|大模型|llm|gpt|prompt|aigc|\bagent\b|comfyui/i],
  ['algorithm', /算法|推荐系统|nlp|机器学习|深度学习|计算机视觉/i],
  ['frontend', /前端|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端|web\s*sdk/i],
  ['backend', /后端|java|\bgo\b|golang|php|ruby|服务端|python|c\+\+|c#|\.net|架构师|架构设计|springcloud/i],
  ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量|代码审计/i],
  // 培训/学习发展（经验萃取、SOP工程化等知识管理岗）
  ['training', /培训|讲师|课程开发|教研|学习发展|经验萃取|sop工程化|赋能|带教|培训师|教学设计/i],
  ['product', /产品经理|产品总监|产品负责人|产品助理|产品调优|产品定价|专案产品|平台产品/i],
  ['design', /ui|ux|设计|视觉|动效/i],
  // 美术: 3D系列、spine、动作设计、角色设计、绑定
  ['art', /美术|原画|概念设计|插画师|3d角色|3d动画|3d战斗|3d建模|建模师|动画师|绑定师|绑定|技术美术|ta(?=\s|$|[_\-/（）【】])|rigging|spine|动作设计|角色设计/i],
  // 市场: 品牌、市场策划/推广/运营、新媒体孵化
  ['marketing', /品牌|市场策划|市场推广|市场营销|市场运营|市场经理|市场总监|kol|公关|新媒体孵化|增长黑客|growth/i],
  // 视频: 加编导
  ['video', /视频|剪辑|后期|短视频|视频制作|导演|摄像|影视|编导|cinemat|videograph/i],
  // 直播: 加团播
  ['live', /直播(?!运营)|主播|场控|中控|带货主播|直播间|直播策划|直播主持|团播/i],
  ['legal', /法务|法律顾问|律师|合规|知识产权|版权|专利/i],
  ['finance', /财务|会计|出纳|审计|税务/i],
  ['data', /数据|数据挖掘|爬虫|etl|数据仓库|数据分析|数据工程|大数据/i],
  ['hardware', /gpu|硬件|芯片|嵌入式|固件|pcb|电路|cpu/i],
  ['hr', /hr|人力|招聘|薪酬|员工关系|组织发展/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售|新客户/i],
  ['customer-service', /客服|客户服务|售后/i],
  // 内容创作/编辑（区别于"内容运营"——后者归运营）
  ['content', /内容创作|内容编辑|内容生产|内容工程|采编|文案|脚本策划|aigc/i],
  ['operations', /运营|电商|直播运营|带货|主播|中控|场控|选品|新媒体运营/i],
  ['project', /项目|pmo|scrum/i],
  // director: 加组长(Java后端组长、新媒体运营组长)
  ['director', /总监|vp|副总裁|cto|ceo|负责人|组长/i],
  // administration: 加督导
  ['administration', /行政|前台|助理|秘书|档案|车辆|办公室|督导/i],
];

export function detectCategories(text: string): JDCategory[] {
  const t = text.toLowerCase();
  const result: JDCategory[] = [];
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(t) && !result.includes(cat)) result.push(cat);
  }
  if (result.length === 0) {
    // Broad fallbacks
    if (/开发|程序|码农|软件/i.test(t)) result.push('backend');
    else if (/设计|画|创作|创意/i.test(t)) result.push('design');
    else if (/产品|需求|原型/i.test(t)) result.push('product');
    else if (/数据|报表|指标/i.test(t)) result.push('data');
    else result.push('operations');
  }
  return result.slice(0, 3);
}

// ─── Salary parse ───

export function parseSalary(s: string): { min: number; max: number; currency: string } {
  if (!s) return { min: 0, max: 0, currency: 'K' };
  try {
    const cleaned = String(s).replace(/[,，\s]/g, '');
    // Try various formats: "15K-25K", "15k-25k", "15000-25000", "1.5万-2.5万"
    let match = cleaned.match(/(\d+\.?\d*)\s*[-~至到]\s*(\d+\.?\d*)\s*([kKw万])?/i);
    if (match) {
      let mult = 1;
      if (match[3]?.toLowerCase() === '万') mult = 10;
      else if (match[3]?.toLowerCase() === 'k') mult = 1;
      // If no K/W suffix and values > 100, treat as raw numbers (e.g. "15000")
      else if (!match[3] && parseInt(match[1]) > 100) mult = 0.001; // convert to K
      const min = Math.min(parseFloat(match[1]) * mult, 999);
      const max = Math.min(parseFloat(match[2]) * mult, 999);
      return { min: Math.max(0, Math.round(min)), max: Math.max(Math.round(min), Math.round(max)), currency: 'K' };
    }
    // Single number: "15K" or "15000"
    match = cleaned.match(/^(\d+\.?\d*)\s*([kKw万])?$/i);
    if (match) {
      let mult = 1;
      if (match[2]?.toLowerCase() === '万') mult = 10;
      else if (!match[2] && parseInt(match[1]) > 100) mult = 0.001;
      const val = Math.round(parseFloat(match[1]) * mult);
      return { min: val, max: val, currency: 'K' };
    }
  } catch { /* */ }
  return { min: 0, max: 0, currency: 'K' };
}

// ─── Dedup identity key ───

/** Stable identity for a JD: normalized title|department|location. Used for
 * import dedup AND for add/delete diffing during Google Sheet sync. */
export function getJDKey(jd: Pick<JD, 'title' | 'department' | 'location'>): string {
  return [jd.title, jd.department || '', jd.location || '']
    .map((value) => normalizeJDKey(value))
    .join('|');
}

function normalizeJDKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[（(]\s*\d+\s*人\s*[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[，,。；;:：|｜\-—_【】[\]()（）]/g, '');
}

export function mergeUniqueJDs(existing: JD[], incoming: JD[]): { jds: JD[]; skipped: number } {
  const seen = new Set(existing.map(getJDKey));
  const unique: JD[] = [];

  for (const jd of incoming) {
    const key = getJDKey(jd);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(jd);
  }

  return { jds: [...existing, ...unique], skipped: incoming.length - unique.length };
}

// ─── Column analysis + column-based row → JD ───

export interface ColumnMap {
  titleCol: string;
  salaryCol: string | null;
  deptCol: string | null;
  locCol: string | null;
  orgCol: string | null;
  serviceCol: string | null;
  hcCol: string | null;
  vacancyCol: string | null;
  contentCols: string[];
}

/** Detect known columns from header keys. Returns null if no title column. */
export function analyzeColumns(headers: string[]): ColumnMap | null {
  const titleCol = findTitleColumn(headers);
  if (!titleCol) return null;
  const salaryCol = findColumnByKeywords(headers, SALARY_KEYS);
  const deptCol = findColumnByKeywords(headers, DEPT_KEYS);
  const locCol = findColumnByKeywords(headers, LOC_KEYS);
  const orgCol = findColumnByKeywords(headers, ORG_KEYS);
  const serviceCol = findColumnByKeywords(headers, SERVICE_KEYS);
  const hcCol = findColumnByKeywords(headers, HC_KEYS);
  const vacancyCol = findColumnByKeywords(headers, VACANCY_KEYS);
  const skipCols = headers.filter((h) => matchesAnyKeyword(h, SKIP_KEYS));

  const knownCols = new Set<string>(
    [titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, ...skipCols]
      .filter((x): x is string => x !== null)
  );
  const contentCols = headers.filter((h) => !knownCols.has(h));

  return { titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, contentCols };
}

/** Build a JD from a row using deterministic column parsing (no AI).
 * Returns null if the row has no usable title or is a repeated header row. */
export function rowToColumnJD(row: Record<string, string>, cols: ColumnMap): JD | null {
  const rawTitleCell = String(row[cols.titleCol] || '').trim();
  if (!rawTitleCell) return null;
  // Skip repeated section header rows mid-sheet
  if (isAllowedTitleHeader(rawTitleCell)) return null;

  const organization = cols.orgCol ? String(row[cols.orgCol] || '').trim() : '';
  const serviceUnit = cols.serviceCol ? String(row[cols.serviceCol] || '').trim() : '';
  const headcount = cols.hcCol ? String(row[cols.hcCol] || '').trim() : '';
  const gap = cols.vacancyCol ? String(row[cols.vacancyCol] || '').trim() : '';

  const title = rawTitleCell;
  const rawSalary = cols.salaryCol ? String(row[cols.salaryCol] || '').trim() : '';
  const department = serviceUnit || (cols.deptCol ? String(row[cols.deptCol] || '').trim() : '') || organization;
  const location = cols.locCol ? String(row[cols.locCol] || '').trim() : 'remote';

  // Collect content, keeping column order
  const allText: string[] = [];
  for (const col of cols.contentCols) {
    const v = String(row[col] || '').trim();
    if (v && v.length > 1) allText.push(v);
  }
  const split = splitJDBySection(allText.join('\n'));

  const isNegotiable = /面议|open|negotiable/i.test(rawSalary);
  const hasExtra = !!rawSalary && !isNegotiable && !/^[\d.]+[-~至到][\d.]+[kKw万Uu]?$/i.test(rawSalary.replace(/[,，\s]/g, ''));

  const now = new Date().toISOString();
  return {
    id: generateId(),
    title,
    department,
    organization: organization || undefined,
    serviceUnit: serviceUnit || undefined,
    headcount: headcount || undefined,
    gap: gap || undefined,
    categories: detectCategories(title),
    responsibilities: split.responsibilities,
    requirements: split.requirements,
    salaryRange: isNegotiable ? { min: 0, max: 0, currency: 'K' } : parseSalary(rawSalary),
    salaryText: (isNegotiable || hasExtra) ? rawSalary : undefined,
    location: location || 'remote',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
