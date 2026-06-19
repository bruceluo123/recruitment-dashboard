// Pure JD parsing core — shared by the client store (Excel import) and the
// server-side Google Sheet sync cron. No React / Zustand / browser-only deps.

import type { JD, JDCategory } from '@/types/jd';
import { parsePriority } from '@/types/jd';
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
export const PRIORITY_KEYS = ['优先级', '优先级别', '优先', 'priority', '急招级别', '紧急程度', '紧急度', 'p级'];
// 需求Key（REQ-xxx）——面板每条需求的唯一编号，作为跨导入去重的稳定身份。
export const REQ_KEY_KEYS = ['需求key', '需求编号', '需求id', 'reqkey', 'reqid'];
// 加急标记（源面板 ❗ 列）——独立于优先级的人工加急标记，用于热招看板「加急岗位」栏。
export const EXPEDITED_KEYS = ['加急', '加急岗位', '紧急标记', 'expedited'];
// 简历对接人（花名 & @TG）——招聘实际要联系的人（带 TG 句柄），「简历对接人」列优先展示此列。
export const CONTACT_KEYS = ['简历对接人', '花名'];
export const ODC_KEYS = ['对应的odc', '对接odc', 'odc'];
// 需求发起人——提出该需求的业务方（独立于简历对接人，单独成列展示）。
export const REQUESTER_KEYS = ['需求发起人', '发起人', '需求方'];
export const SKIP_KEYS = ['已到岗', '已发offer', '待入职', '提需日期', '期望到岗日期', '期望到岗'];
// 联系人/来源等元数据列：不识别为岗位内容（如"来源表格""对应的ODC""对应的SSC""对接人""联系方式"）
export const META_KEYS = ['来源表格', '对应的odc', '对应的ssc', 'odc', 'ssc', '对接人', '联系人', '联系方式', 'tg', 'telegram'];

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
    .map((s) => stripLeadingNumber(s))
    .filter((s) => s.length > 1);
}

/** 去掉条目开头的序号前缀：1. / 2、 / （3） / 一、 / ① 等。
 * 导入后统一清理一遍，避免 JD 职责/要求里残留编号。 */
export function stripLeadingNumber(text: string): string {
  return text
    .replace(/^[\s　]*[（(]\s*[\d一二三四五六七八九十]+\s*[）)][.、,，:：\s]*/, '') // （1） (1)
    .replace(/^[\s　]*[\d一二三四五六七八九十]+\s*[.、,，。:：)）]+\s*/, '')          // 1. 一、 2)
    .replace(/^[\s　]*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/, '')             // ① ②
    .trim();
}

/** 清理一条 JD 的职责/要求列表里的序号前缀（导入后自动跑一遍）。 */
export function cleanJDNumbering(jd: JD): JD {
  return {
    ...jd,
    responsibilities: jd.responsibilities.map(stripLeadingNumber).filter(Boolean),
    requirements: jd.requirements.map(stripLeadingNumber).filter(Boolean),
  };
}

// ─── Contact / meta line cleanup ───

const TG_HANDLE = /@[a-zA-Z0-9_]{2,}/;          // TG/联系方式 句柄，如 @xd1127
const SSC_ODC = /(ssc|odc)/i;                   // SSC/ODC 联系人块
const CONTACT_LABEL = /(主管|副经理|经理|对接人|负责人|hrbp)\s*[:：]/; // "SSC主管：xxx"
const DEPT_CENTER = /^[\u4e00-\u9fa5]{2,8}(中心|内容组)$/;            // "运营中心""技术中心"
const SOURCE_TABLE = /^(来源表格|对应的)/;       // "来源表格""对应的ODC"
const NAME_BLOCKLIST = /(本科|大专|硕士|博士|学历|专业|经验|熟悉|精通|了解|以上|优先|能力|沟通|团队|协作|负责|薪资|薪酬|福利|年限|岗位|职位)/;

/** 强信号：明确属于联系人/来源/部门元数据 */
function isStrongMeta(line: string): boolean {
  const s = line.trim();
  return TG_HANDLE.test(s) || SSC_ODC.test(s) || CONTACT_LABEL.test(s) || DEPT_CENTER.test(s) || SOURCE_TABLE.test(s);
}

/** 短姓名（对接人名），仅在紧邻强信号时才裁掉 */
function isShortName(line: string): boolean {
  const s = line.trim();
  return /^[\u4e00-\u9fa5·]{2,4}$/.test(s) && !NAME_BLOCKLIST.test(s);
}

/**
 * 去掉岗位职责/要求里混入的「来源表格 / 对应ODC / 对应SSC / 联系人@TG / 主管」等
 * 表格尾列元数据。这类信息总在内容末尾，按"从尾部往前裁剪连续元数据块"处理，
 * 必须出现强信号才裁剪，避免误删正常的短要求。
 */
export function stripContactMeta(items: string[]): string[] {
  if (!items.length) return items;
  let end = items.length;
  let sawStrong = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i].trim();
    if (!s) { end = i; continue; }
    if (isStrongMeta(s)) { sawStrong = true; end = i; continue; }
    if (sawStrong && isShortName(s)) { end = i; continue; }
    break;
  }
  return sawStrong ? items.slice(0, end) : items;
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

/** Stable identity for a JD. 优先用需求Key(REQ-xxx)——面板每条需求唯一，能区分
 * 同名同服务单位但不同部门/HC 的独立岗位；无需求Key 时回退 title|department|location。
 * Used for import dedup AND for add/delete diffing during Google Sheet sync. */
export function getJDKey(jd: Pick<JD, 'title' | 'department' | 'location' | 'reqKey'>): string {
  if (jd.reqKey && jd.reqKey.trim()) return `req:${normalizeJDKey(jd.reqKey)}`;
  return [jd.title, jd.department || '', jd.location || '']
    .map((value) => normalizeJDKey(value))
    .join('|');
}

/** 加急列取值是否为真：'1'/'是'/'y'/'true'/'❗' 等视为加急，空/0/否 视为非加急。 */
function isTruthyFlag(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (['0', '否', 'no', 'false', 'n', '-'].includes(v)) return false;
  return true;
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
  // 重复记录里若带「加急」标记，则把标记合并回已有岗位——
  // 这样无需清空即可重新粘贴加急清单来点亮对应岗位。
  const expediteKeys = new Set<string>();
  // 同样回填「需求发起人」：旧数据在该字段加入前导入，缺这一列；
  // 重新粘贴源表时把发起人补到已有岗位上（仅在原本为空时），无需清空重导。
  const requesterByKey = new Map<string, string>();

  for (const jd of incoming) {
    const key = getJDKey(jd);
    if (jd.requester && !requesterByKey.has(key)) requesterByKey.set(key, jd.requester);
    if (seen.has(key)) {
      if (jd.expedited) expediteKeys.add(key);
      continue;
    }
    seen.add(key);
    unique.push(jd);
  }

  const needsBackfill = expediteKeys.size > 0 || requesterByKey.size > 0;
  const merged = needsBackfill
    ? existing.map((jd) => {
        const key = getJDKey(jd);
        let next = jd;
        if (expediteKeys.has(key) && !jd.expedited) next = { ...next, expedited: true };
        const requester = requesterByKey.get(key);
        if (requester && !next.requester) next = { ...next, requester };
        return next;
      })
    : existing;

  return { jds: [...merged, ...unique], skipped: incoming.length - unique.length };
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
  priorityCol: string | null;
  odcCol: string | null;
  requesterCol: string | null;
  reqKeyCol: string | null;
  expeditedCol: string | null;
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
  const priorityCol = findColumnByKeywords(headers, PRIORITY_KEYS);
  // 「简历对接人」展示取源表「简历对接人（花名 & @TG）」列（带 TG 号、可直接联系）；缺失时回退到「对应的ODC」列。
  const odcCol = findColumnByKeywords(headers, CONTACT_KEYS) || findColumnByKeywords(headers, ODC_KEYS);
  const requesterCol = findColumnByKeywords(headers, REQUESTER_KEYS);
  const reqKeyCol = findColumnByKeywords(headers, REQ_KEY_KEYS);
  const expeditedCol = findColumnByKeywords(headers, EXPEDITED_KEYS);
  const skipCols = headers.filter((h) => matchesAnyKeyword(h, SKIP_KEYS));
  const metaCols = headers.filter((h) => matchesAnyKeyword(h, META_KEYS));

  const knownCols = new Set<string>(
    [titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, priorityCol, odcCol, requesterCol, reqKeyCol, expeditedCol, ...skipCols, ...metaCols]
      .filter((x): x is string => x !== null)
  );
  const contentCols = headers.filter((h) => !knownCols.has(h));

  return { titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, priorityCol, odcCol, requesterCol, reqKeyCol, expeditedCol, contentCols };
}

/** Build a JD from a row using deterministic column parsing (no AI).
 * Returns null if the row has no usable title or is a repeated header row. */
export function rowToColumnJD(row: Record<string, string>, cols: ColumnMap): JD | null {
  const rawTitleCell = String(row[cols.titleCol] || '').trim();
  if (!rawTitleCell) return null;
  // Skip repeated section header rows mid-sheet
  if (isAllowedTitleHeader(rawTitleCell)) return null;
  // Skip garbage rows whose "title" is purely a number/序号（如错位粘贴产生的 "1" 行）
  if (/^[\d.\s、,，#-]+$/.test(rawTitleCell)) return null;

  const organization = cols.orgCol ? String(row[cols.orgCol] || '').trim() : '';
  const serviceUnit = cols.serviceCol ? String(row[cols.serviceCol] || '').trim() : '';
  const headcount = cols.hcCol ? String(row[cols.hcCol] || '').trim() : '';
  // 缺口为空一律填 0（无缺口 = 不需要再招，匹配时会跳过）
  const gap = (cols.vacancyCol ? String(row[cols.vacancyCol] || '').trim() : '') || '0';
  const priority = cols.priorityCol ? parsePriority(String(row[cols.priorityCol] || '').trim()) : undefined;
  const odc = cols.odcCol ? String(row[cols.odcCol] || '').trim() : '';
  const requester = cols.requesterCol ? String(row[cols.requesterCol] || '').trim() : '';
  const reqKey = cols.reqKeyCol ? String(row[cols.reqKeyCol] || '').trim() : '';
  const expedited = cols.expeditedCol ? isTruthyFlag(String(row[cols.expeditedCol] || '')) : false;

  const title = rawTitleCell;
  const rawSalary = cols.salaryCol ? String(row[cols.salaryCol] || '').trim() : '';
  // 部门取真实「部门」列（如"运营3部"），缺失时回退服务单位/编制——
  // 保留真实部门，详情面板「部门/服务单位」才不会双双显示同一个值。
  const deptCell = cols.deptCol ? String(row[cols.deptCol] || '').trim() : '';
  const department = deptCell || serviceUnit || organization;
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
    priority,
    odc: odc || undefined,
    requester: requester || undefined,
    reqKey: reqKey || undefined,
    expedited: expedited || undefined,
    categories: detectCategories(title),
    responsibilities: stripContactMeta(split.responsibilities),
    requirements: stripContactMeta(split.requirements),
    salaryRange: isNegotiable ? { min: 0, max: 0, currency: 'K' } : parseSalary(rawSalary),
    salaryText: (isNegotiable || hasExtra) ? rawSalary : undefined,
    location: location || 'remote',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
