// AI-based talent info extractor — only extracts 姓名 + 最近一份岗位 title

export interface ExtractedTalent {
  name: string;
  jobTitle: string;
}

function cleanJson(content: string): string {
  return content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
}

/** Heuristic fallback: pick a likely name from the first lines if AI fails. */
function fallbackName(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    // Chinese name: 2-4 Chinese chars on its own short line
    const zh = line.match(/^[\u4e00-\u9fa5]{2,4}$/);
    if (zh) return zh[0];
    // "姓名：xxx" style
    const labeled = line.match(/(?:姓\s*名|name)[:：]\s*([^\s,，|]+)/i);
    if (labeled) return labeled[1].trim();
    // English name: 2-3 capitalized words on a short line
    const en = line.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/);
    if (en) return en[0];
  }
  return '';
}

export async function extractTalentInfo(rawText: string): Promise<ExtractedTalent | null> {
  const text = rawText.slice(0, 3000);
  try {
    const prompt = `从以下简历文本中提取候选人信息。只需提取两个字段。

## 简历文本
${text}

## 要求
- name: 候选人姓名（中文或英文，只要姓名本身）
- jobTitle: 候选人最近一份工作的岗位名称（最新/当前职位的 title）

## 输出严格JSON（不要markdown代码块）：
{"name": "姓名", "jobTitle": "最近岗位title"}`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 200 }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { name: fallbackName(text), jobTitle: '' };
    const parsed = JSON.parse(cleanJson(content));
    return {
      name: String(parsed.name || '').trim() || fallbackName(text),
      jobTitle: String(parsed.jobTitle || '').trim(),
    };
  } catch {
    return { name: fallbackName(text), jobTitle: '' };
  }
}

/** Batch extract multiple resumes in a single API call to reduce round-trips. */
export async function extractMultipleTalents(texts: string[]): Promise<(ExtractedTalent | null)[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await extractTalentInfo(texts[0])];

  try {
    const prompt = `从以下${texts.length}份简历分别提取候选人信息。每份只需提取姓名和最近一份工作的岗位title。

${texts.map((t, i) => `### 简历${i + 1}\n${t.slice(0, 1800)}`).join('\n\n')}

## 输出严格JSON数组（顺序与简历一致，不要markdown代码块）：
[{"name": "姓名", "jobTitle": "最近岗位title"}, ...]`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1500 }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return texts.map((t) => ({ name: fallbackName(t), jobTitle: '' }));
    const parsed = JSON.parse(cleanJson(content));
    if (!Array.isArray(parsed)) return texts.map((t) => ({ name: fallbackName(t), jobTitle: '' }));
    return texts.map((t, i) => {
      const p = parsed[i];
      if (!p) return { name: fallbackName(t), jobTitle: '' };
      return {
        name: String(p.name || '').trim() || fallbackName(t),
        jobTitle: String(p.jobTitle || '').trim(),
      };
    });
  } catch {
    return texts.map((t) => ({ name: fallbackName(t), jobTitle: '' }));
  }
}
