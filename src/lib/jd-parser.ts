// AI-based JD parser for unstructured text

export interface ParsedJD {
  title: string;
  department: string;
  salary: string;
  responsibilities: string[];
  requirements: string[];
  location: string;
}

export async function parseJDWithAI(rawText: string): Promise<ParsedJD | null> {
  try {
    const prompt = `从以下招聘文本中提取结构化信息。如果某字段未提及，留空。

## 文本
${rawText.slice(0, 3000)}

## 输出严格JSON（不要markdown代码块）：
{
  "title": "岗位名称",
  "department": "部门",
  "salary": "薪资（保留原文如25K-45K或面议）",
  "responsibilities": ["职责1", "职责2"],
  "requirements": ["要求1", "要求2"],
  "location": "工作地点"
}`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1000 }),
    });
    const data = await res.json();
    if (!data?.choices?.[0]?.message?.content) return null;

    const content = data.choices[0].message.content;
    const jsonStr = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// Parse multiple texts in one API call
export async function parseMultipleJDs(texts: string[]): Promise<(ParsedJD | null)[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await parseJDWithAI(texts[0])];

  try {
    const prompt = `从以下${texts.length}条招聘文本分别提取结构化信息。如果某字段未提及，留空。

${texts.map((t, i) => `### 文本${i + 1}\n${t.slice(0, 2000)}`).join('\n\n')}

## 输出严格JSON数组：
[
  {"title": "岗位名1", "department": "部门", "salary": "薪资", "responsibilities": ["职责"], "requirements": ["要求"], "location": "地点"},
  ...
]`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 2000 }),
    });
    const data = await res.json();
    if (!data?.choices?.[0]?.message?.content) return texts.map(() => null);

    const content = data.choices[0].message.content;
    const jsonStr = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed.slice(0, texts.length) : texts.map(() => null);
  } catch {
    return texts.map(() => null);
  }
}