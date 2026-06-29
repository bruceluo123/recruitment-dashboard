// 简历入口：从粘贴的简历文本中提取推荐人信息，并按岗位名自动匹配 JD 库回填编制/部门。

import type { JD } from '@/types/jd';
import { splitOrgDept } from '@/lib/jd-parse-core';

export interface ExtractedRecommendation {
  name: string;
  jobTitle: string;
  contact: string;
  contactPerson: string;   // 简历对接人
  organization: string;    // 推荐编制组织/序列/服务单位
  department: string;      // 推荐部门
}

function cleanJson(content: string): string {
  return content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 按标签提取「标签[任意非冒号字符]：值」中的值，取整行剩余文本。
 * 标签按优先级数组给出，命中第一个非空值即返回。
 * 例：「候选人姓名： 陳曉七」→ 陳曉七；「简历对接BP：陈润」→ 陈润。
 */
function labelValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const re = new RegExp(`${escapeReg(label)}[^\\n:：]*[:：][ \\t\\u3000]*([^\\n]*)`);
    const m = text.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

/** 去除「北斗-蝴蝶效应 北斗-蝴蝶效应」这类空格分隔的重复词，取其一。 */
function dedupeRepeated(v: string): string {
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => p === parts[0])) return parts[0];
  return v;
}

const CONTACT_PERSON_LABELS = ['简历对接BP', '简历对接人', '对接BP', '对接人', '对接', '推荐人', '联系人'];

/**
 * 提取简历对接人，并把对接人的 TG/微信号一起带上。
 * 例：「简历对接BP：陈润」+ 下一行「@RyanChen20」→「陈润 @RyanChen20」。
 */
function parseContactPerson(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const label of CONTACT_PERSON_LABELS) {
      const re = new RegExp(`${escapeReg(label)}[^\\n:：]*[:：][ \\t\\u3000]*(.*)`);
      const m = lines[i].match(re);
      if (!m || !m[1].trim()) continue;
      let val = m[1].trim();
      // 本行未含句柄时，看下一非空行是否为裸 TG/微信号，合并进来
      if (!/@/.test(val)) {
        const next = (lines[i + 1] || '').trim();
        const bare = next.match(/^@?[A-Za-z0-9_]{4,}$/);
        const labeled = next.match(/(?:TG|telegram|微信|wechat|vx)[:：]?\s*(@?[A-Za-z0-9_]{4,})/i);
        const handle = bare ? bare[0] : labeled ? labeled[1] : '';
        if (handle) val = `${val} ${handle.startsWith('@') ? handle : '@' + handle}`;
      }
      return val;
    }
  }
  return '';
}

/**
 * 结构化简历解析：针对固定标签格式（候选人姓名/应聘岗位/推荐编制组织/候选人联系方式/简历对接BP 等）
 * 即时精准提取，无需网络。命中姓名+岗位即可直接采用，避免 AI 的延迟与漏识别。
 */
export function parseStructuredResume(text: string): ExtractedRecommendation {
  const rawOrg = dedupeRepeated(labelValue(text, ['推荐编制组织/序列/服务单位', '推荐编制组织', '编制组织', '推荐编制', '编制', '服务单位']));
  const rawDept = labelValue(text, ['推荐部门', '所属部门', '部门']);
  // 「技术中心 银河」这类空格分隔的「编制 部门」拆开：编制=技术中心、部门=银河（仅在部门缺失时回填）
  const orgSplit = splitOrgDept(rawOrg);
  const organization = orgSplit.org || rawOrg;
  const department = rawDept || orgSplit.dept;
  return {
    name: labelValue(text, ['候选人姓名', '候选姓名', '姓名', 'name']),
    jobTitle: labelValue(text, ['应聘岗位', '应聘职位', '意向岗位', '意向职位', '求职意向', '目标岗位', '推荐岗位', '岗位', '职位']),
    contact: labelValue(text, ['候选人联系方式', '联系方式', '联系电话', '手机号', '手机', '电话', '微信', 'wechat', 'TG', 'telegram']),
    contactPerson: parseContactPerson(text),
    organization,
    department,
  };
}

/** 启发式兜底：AI 失败时从前几行猜姓名。 */
function fallbackName(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    const zh = line.match(/^[\u4e00-\u9fa5]{2,4}$/);
    if (zh) return zh[0];
    const labeled = line.match(/(?:姓\s*名|name)[:：]\s*([^\s,，|]+)/i);
    if (labeled) return labeled[1].trim();
    const en = line.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/);
    if (en) return en[0];
  }
  return '';
}

/** 启发式兜底：抓应聘/意向岗位，其次任意「岗位：xxx」。 */
function fallbackJobTitle(text: string): string {
  const intent = text.match(/(?:应聘岗位|应聘职位|意向岗位|意向职位|求职意向|目标岗位)[:：]\s*([^\n,，|]+)/);
  if (intent) return intent[1].trim();
  const any = text.match(/(?:岗\s*位|职\s*位)[:：]\s*([^\n,，|]+)/);
  if (any) return any[1].trim();
  return '';
}

/** 启发式兜底：抓简历对接人 / 推荐人。 */
function fallbackContactPerson(text: string): string {
  const m = text.match(/(?:简历对接人|对接人|对接|推荐人|联系人)[:：]\s*([^\s,，|]+)/);
  if (m) return m[1].trim();
  return '';
}

/** 启发式兜底：抓手机号 / 邮箱 / 微信。 */
function fallbackContact(text: string): string {
  const phone = text.match(/1[3-9]\d{9}/);
  if (phone) return phone[0];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) return email[0];
  const wx = text.match(/(?:微信|wechat|vx|v信)[:：]?\s*([A-Za-z0-9_-]{5,})/i);
  if (wx) return wx[1];
  return '';
}

/** 从简历文本提取信息。结构化标签优先（即时精准），缺关键字段时再用 AI 兜底。 */
export async function extractRecommendationInfo(rawText: string): Promise<ExtractedRecommendation> {
  const text = rawText.slice(0, 3000);
  // 1) 结构化标签解析：拿到姓名+岗位即直接返回，零网络、不漏识别
  const s = parseStructuredResume(text);
  if (s.name && s.jobTitle) return s;
  // 2) 结构化结果作为优先回退，缺的字段再用启发式补
  const fb: ExtractedRecommendation = {
    name: s.name || fallbackName(text),
    jobTitle: s.jobTitle || fallbackJobTitle(text),
    contact: s.contact || fallbackContact(text),
    contactPerson: s.contactPerson || fallbackContactPerson(text),
    organization: s.organization,
    department: s.department,
  };
  if (!text.trim()) return fb;
  try {
    const prompt = `从以下简历文本中提取候选人信息。

## 简历文本
${text}

## 要求
- name: 候选人姓名（中文或英文，只要姓名本身）
- jobTitle: 候选人应聘/意向的岗位名称。若简历写有"应聘岗位/应聘职位/意向岗位/求职意向/目标岗位"等字样，优先取其后的岗位名；否则取最近一份工作的岗位 title
- contact: 候选人本人的联系方式，手机号优先，其次邮箱或微信号，取其一，没有则空字符串
- contactPerson: 简历对接人/推荐人/联系人（即把这份简历交过来或负责对接的人，非候选人本人），没有则空字符串

## 输出严格JSON（不要markdown代码块）：
{"name": "", "jobTitle": "", "contact": "", "contactPerson": ""}`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 200 }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return fb;
    const parsed = JSON.parse(cleanJson(content));
    return {
      name: String(parsed.name || '').trim() || fb.name,
      jobTitle: String(parsed.jobTitle || '').trim() || fb.jobTitle,
      contact: String(parsed.contact || '').trim() || fb.contact,
      contactPerson: String(parsed.contactPerson || '').trim() || fb.contactPerson,
      organization: fb.organization,   // 编制/部门只信结构化标签（AI 不提取）
      department: fb.department,
    };
  } catch {
    return fb;
  }
}

/**
 * 从简历原文中提取候选人亮点摘要，供内部查阅。
 * 返回格式化的多行文本，如：
 *   💼 8年经验 · 现任字节跳动高级工程师
 *   🎓 上海交大 · 本科计算机
 *   ⚡ React / TypeScript / Node.js
 *   ✨ 主导过日活500万产品的架构重构，降本30%
 */
export async function extractResumeHighlights(rawText: string): Promise<string> {
  const text = rawText.slice(0, 4000);
  if (!text.trim()) return '';
  try {
    const prompt = `请从以下简历文本中提取候选人的核心亮点，用于猎头内部快速评估。

## 简历文本
${text}

## 输出要求
用 4-6 行简洁中文，每行一个维度，格式固定如下（缺失信息直接跳过该行）：
💼 X年经验 · 现任[公司][职级/岗位]
🎓 [学校] · [学历][专业]
⚡ [核心技能/技术栈，用 / 分隔，最多6个]
✨ [1-2句最值得提的履历亮点或成就，简洁有力]

只输出这几行，不要其他说明或标题。`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 300 }),
    });
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content || '';
    return content.trim();
  } catch {
    return '';
  }
}

/** 按岗位名在 JD 库中找最相近的一条，用于自动回填编制/部门。无匹配返回 null。 */
export function matchJDByTitle(title: string, jds: JD[]): JD | null {
  const t = title.trim().toLowerCase();
  if (!t) return null;
  // 1. 完全相等
  const exact = jds.find((j) => j.title.trim().toLowerCase() === t);
  if (exact) return exact;
  // 2. 互相包含（岗位名一方包含另一方）
  const partial = jds.find((j) => {
    const jt = j.title.trim().toLowerCase();
    return jt.length > 0 && (jt.includes(t) || t.includes(jt));
  });
  return partial || null;
}
