import { NextRequest, NextResponse } from 'next/server';
import { parseResearchText, DIMENSION_NUMBERED } from '@/lib/company-research';
import { ALL_CATEGORIES, JD_CATEGORY_LABELS } from '@/types/jd';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 用带 Google 搜索 grounding 的 Gemini 做真实联网调研（DeepSeek 无联网能力，会编造）。
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CATEGORY_HINT = ALL_CATEGORIES.map((c) => `${c}(${JD_CATEGORY_LABELS[c]})`).join('、');

// 移植自 zz-hunteragent-company-research skill 的 11 维方法论与输出规范。
function buildPrompt(name: string): string {
  return `你是猎头公司研究助手，按张振的 11 维度方法论联网调研一家公司。必须使用 Google 搜索核验，不要凭记忆作答。

核心原则：
1. 这是猎头视角，不是投资报告。重点是找全有价值的信息，让会员自己判断公司、项目和候选人机会。
2. 找不到就写"未找到公开信息"，绝对不要编造。重要事实（成立时间、融资、创始人、客户）至少交叉验证两个来源。
3. 短句、结构化。每个维度【必须先写 2-5 条中文总结要点】，用树状要点（├──/└──）罗列具体事实，不堆资料，不写"结论："。绝对不允许某个维度只甩一堆链接、没有中文总结。
4. 「产品/服务/业务闭环和近一年动作」这个维度，务必把近一年的具体动作按时间倒序写成要点：融资轮次/金额/投资方、产品发布、重大合作、上市/IPO、组织调整等，每条一句话带时间。
5. 来源只能放在每个维度结尾的"信息源："之后，【不要把来源编号或链接混进上面的中文要点里】。信息源列 1-5 条本维度真正用到的来源，格式「标题 - https://原始URL」，优先用媒体原始链接（如 36氪/新浪财经/财联社 的原文URL），URL 必须真实可点击；该维度没找到来源就写"信息源：未找到明确公开来源"。
6. 先判断公司属于什么行业，再决定每个维度去哪里补证据：科技类搜 36氪/晚点/机器之心/量子位、融资/投资方/客户案例/招聘JD/GitHub/专利；医疗搜 NMPA/CDE/临床登记；金融搜 央行/证监会/交易所；消费搜 小红书/抖音/天猫/黑猫投诉；等等。

调研目标公司：${name}

输出格式（严格遵守，先输出 3 行头部，再输出 11 个维度，不要写总判断、不要用 markdown 代码块包裹）：
行业：（一个行业词，如 AI / 医疗健康 / 新能源）
方向：（从这些 key 里选 0-3 个最相关的，用英文 key 逗号分隔：${CATEGORY_HINT}）
一句话：（一句话概述这家公司做什么，非投资判断）

然后输出 11 个维度，每个维度从"N. 维度名："另起，标题严格用下面这 11 个名字：
${DIMENSION_NUMBERED}

每个维度形如：
1. 公司基本盘：
├── 要点...
├── 要点...
└── 信息源：
    1. 标题 - https://...
    2. 标题 - https://...`;
}

interface GroundingChunk { web?: { uri?: string; title?: string } }
interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: { groundingChunks?: GroundingChunk[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    const company = typeof name === 'string' ? name.trim() : '';
    if (!company) {
      return NextResponse.json({ error: '请输入公司名' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY 未配置，无法联网调研' }, { status: 500 });
    }

    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(company) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Gemini ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as GeminiResponse;
    if (data.error?.message) {
      return NextResponse.json({ error: `Gemini: ${data.error.message}` }, { status: 502 });
    }
    if (data.promptFeedback?.blockReason) {
      return NextResponse.json({ error: `调研被拦截：${data.promptFeedback.blockReason}` }, { status: 502 });
    }

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      return NextResponse.json({ error: '调研返回为空，请重试' }, { status: 502 });
    }

    const draft = parseResearchText(company, text);
    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: `调研失败: ${(err as Error).message}` }, { status: 500 });
  }
}
