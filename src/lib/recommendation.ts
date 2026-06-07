// 简历入口：从粘贴的简历文本中提取推荐人信息，并按岗位名自动匹配 JD 库回填编制/部门。

import type { JD } from '@/types/jd';

export interface ExtractedRecommendation {
  name: string;
  jobTitle: string;
  contact: string;
}

function cleanJson(content: string): string {
  return content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
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

/** 从简历文本提取 姓名 / 最近岗位 / 联系方式。AI 优先，失败回退启发式。 */
export async function extractRecommendationInfo(rawText: string): Promise<ExtractedRecommendation> {
  const text = rawText.slice(0, 3000);
  const fb: ExtractedRecommendation = { name: fallbackName(text), jobTitle: '', contact: fallbackContact(text) };
  if (!text.trim()) return fb;
  try {
    const prompt = `从以下简历文本中提取候选人信息。

## 简历文本
${text}

## 要求
- name: 候选人姓名（中文或英文，只要姓名本身）
- jobTitle: 候选人最近一份工作的岗位名称（最新/当前职位的 title）
- contact: 联系方式，手机号优先，其次邮箱或微信号，取其一，没有则空字符串

## 输出严格JSON（不要markdown代码块）：
{"name": "", "jobTitle": "", "contact": ""}`;

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
      jobTitle: String(parsed.jobTitle || '').trim(),
      contact: String(parsed.contact || '').trim() || fb.contact,
    };
  } catch {
    return fb;
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
