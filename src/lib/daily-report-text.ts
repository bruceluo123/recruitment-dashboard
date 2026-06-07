// 「今日日报」文字版生成：依据今日简历/推荐/面试数据，按麦满分 & 啵啵的模板风格，
// 让 AI 自由发挥写出一份每天都不一样的中文日报文案。失败时回退到本地模板。

import type { JobLine } from './daily-report';

export interface TodayReportInput {
  name: string;                 // 录入人（麦满分 / 啵啵）
  date: Date;                   // 报告日期
  recommendDetail: JobLine[];   // 今日推荐/收取简历按岗位聚合
  interviews: Array<{ job: string; person: string; status: string }>; // 今日面试
}

const MODEL = 'deepseek-chat';

// 两位真人的历史日报模板，作为风格样例喂给模型。
const STYLE_EXAMPLES = `【啵啵 6.4 日报】
1. 招聘：招聘专员*1取消面试（上个月面试过被pass，改了名字重复投递）。招聘专员*2 初筛pass。
2. 面试：视频策划导演*1一面通过，待测试题。

明日计划：跟进意向候选人，跟进面试情况

【麦满分 6.4 日报】
招聘：平面设计*1 需要成人作品 pass，前端开发工程师*1需求暂停，谷歌SEO*1投递到SEO专员给业务方评估

明日计划：跟进AI产品候选人，推送合适简历`;

function mdLabel(d: Date): string {
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

/** 把今日数据整理成喂给模型的简短事实清单。 */
function buildFacts(input: TodayReportInput): string {
  const recs = input.recommendDetail
    .filter((j) => (j.name || '').trim())
    .map((j) => `${j.name}${j.department ? `(${j.department})` : ''}*${j.qty}`)
    .join('、');
  const ints = input.interviews
    .filter((v) => (v.job || v.person || '').trim())
    .map((v) => `${v.person || '候选人'}-${v.job || '岗位'}-${v.status || '待反馈'}`)
    .join('、');
  return [
    `今日收取/推荐简历：${recs || '（无）'}`,
    `今日面试：${ints || '（无）'}`,
  ].join('\n');
}

export function buildTodayReportPrompt(input: TodayReportInput): string {
  return [
    `你是远程招聘专员「${input.name}」，请用中文写一份「${input.name} ${mdLabel(input.date)} 日报」。`,
    '',
    '风格参考（模仿其口吻、结构与简洁程度，不要照抄内容）：',
    STYLE_EXAMPLES,
    '',
    '今日真实数据：',
    buildFacts(input),
    '',
    '写作要求：',
    '1. 第一行是标题「' + input.name + ' ' + mdLabel(input.date) + ' 日报」。',
    '2. 包含「招聘：」一段（围绕今日收取/推荐的岗位，用 岗位*数量 的写法，并自由补充合理的进展，如初筛pass、需求暂停、转投其他岗位、等业务方评估等）。',
    '3. 若今日有面试，加「面试：」一段简述进展（如一面通过、待测试题、待反馈）。',
    '4. 结尾用「明日计划：」一行，写 1-2 条具体跟进动作。',
    '5. 内容口语化、简洁，像真人随手记录；每天措辞与细节要有变化，不要套话。',
    '6. 只输出日报正文，不要任何解释或额外说明。',
  ].join('\n');
}

/** 本地兜底：AI 不可用时按模板拼一份基础日报。 */
export function buildTodayReportFallback(input: TodayReportInput): string {
  const head = `${input.name} ${mdLabel(input.date)} 日报`;
  const recs = input.recommendDetail
    .filter((j) => (j.name || '').trim())
    .map((j) => `${j.name}*${j.qty}`)
    .join('，');
  const lines = [head, ''];
  lines.push(`招聘：${recs ? `${recs}，已初筛跟进` : '今日暂无新增简历，持续寻访中'}`);
  const ints = input.interviews.filter((v) => (v.job || v.person || '').trim());
  if (ints.length > 0) {
    lines.push(`面试：${ints.map((v) => `${v.person || '候选人'}-${v.job || '岗位'} ${v.status || '待反馈'}`).join('，')}`);
  }
  lines.push('', '明日计划：跟进意向候选人，推送合适简历');
  return lines.join('\n');
}

/** 调用 AI 生成今日日报文案；失败回退本地模板。temperature 偏高以保证每日变化。 */
export async function generateTodayReport(input: TodayReportInput, signal?: AbortSignal): Promise<string> {
  try {
    const prompt = buildTodayReportPrompt(input);
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.95,
        max_tokens: 600,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) throw new Error('空响应');
    return content.trim();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return buildTodayReportFallback(input);
  }
}
