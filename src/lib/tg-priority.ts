// 从 Telegram 群（猎小记机器人的「招聘需求变化通知」）抓取岗位优先级。
//
// 背景：源 Google 表里没有优先级列，P0/P1 等级是猎小记机器人算出来并发到 TG 群的。
// 普通 Bot API 无法读取另一个 bot 的消息，必须用 MTProto 用户账号（GramJS）。
//
// 需要的环境变量（在 Vercel 配置）：
//   TG_API_ID      — my.telegram.org 申请的 API ID
//   TG_API_HASH    — my.telegram.org 申请的 API Hash
//   TG_SESSION     — scripts/tg-login.mjs 生成的登录态字符串（等同登录，勿外泄）
//   TG_GROUP_ID    — 群 id，默认 -1003993273461
//   TG_MSG_LIMIT   — 抓取最近多少条消息，默认 80

const DEFAULT_GROUP_ID = '-1003993273461';
const DEFAULT_MSG_LIMIT = 80;

const PRIORITY_RE = /P\s*([0-3])/i;

/** 一条「📌 岗位条目」的解析结果。 */
export interface TgJobEntry {
  title: string;
  priority: string; // P0 / P1 / P2 / P3
  dept?: string;
  status?: string; // 招聘状态变化后的新状态，如「招聘中」「已关闭」；无字段时为 undefined
  gap?: number; // 变化后的缺口；无字段时为 undefined
}

/**
 * 解析一条猎小记「招聘需求变化通知」消息，提取其中所有带优先级的岗位条目。
 * 消息形如：
 *   📋 招聘需求变化通知
 *   📌 AI测试工程师｜P1（中） (效能中心)
 *     招聘状态：招聘中 → 已关闭，缺口：1 → 0
 *   📌 ...
 *   📊 来源表：... 📝 同步岗位数：217 ...
 */
export function parseTgNotification(text: string): TgJobEntry[] {
  if (!text || !text.includes('📌')) return [];
  const chunks = text.split('📌').slice(1);
  const out: TgJobEntry[] = [];
  for (const chunk of chunks) {
    const body = chunk.split(/📊|📝|🕐|🔍/)[0]; // 砍掉底部汇总区
    const pm = body.match(PRIORITY_RE);
    if (!pm || pm.index === undefined) continue;
    const priority = `P${pm[1]}`;
    // 标题：P 标记之前的部分，去掉结尾的 ｜/| 和空白
    const title = body.slice(0, pm.index).replace(/[｜|\s]+$/, '').trim();
    if (!title) continue;
    // P 标记之后的括号组：[0]=优先级标签（中/紧急/高），[1]=部门
    const afterP = body.slice(pm.index + pm[0].length);
    const parens = [...afterP.matchAll(/[（(]\s*([^（）()]*?)\s*[）)]/g)].map((m) => m[1].trim());
    const dept = parens[1] || undefined;
    // 招聘状态：取箭头右侧的新状态
    const st = body.match(/招聘状态[：:]\s*[^→]*→\s*([^\s，,。\n]+)/);
    const status = st ? st[1].trim() : undefined;
    const gp = body.match(/缺口[：:]\s*\d+\s*→\s*(\d+)/);
    const gap = gp ? parseInt(gp[1], 10) : undefined;
    out.push({ title, priority, dept, status, gap });
  }
  return out;
}

/** 归一化岗位标题用于匹配：去所有空白、全角括号/斜杠转半角、小写。
 * 两侧（TG 标题 与 KV 中 JD.title）用同一函数，确保口径一致。 */
export function normalizeTitle(title: string): string {
  return String(title || '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/／/g, '/')
    .replace(/｜/g, '|')
    .toLowerCase();
}

export interface TgPriorityResult {
  /** 归一化标题 → 优先级（P0..P3），仅含「最新一条为在招」的岗位。 */
  priorityMap: Map<string, string>;
  /** 归一化标题集合：最新一条显示已关闭 / 缺口为 0，应清除其优先级。 */
  closedTitles: Set<string>;
  totalEntries: number;
  messageCount: number;
}

/** 判断一条 TG 条目是否代表「已不再招聘」。 */
function isClosedEntry(e: TgJobEntry): boolean {
  return e.status === '已关闭' || e.gap === 0;
}

/**
 * 连接 TG，抓取最近的消息，聚合成「岗位 → 优先级」映射。
 * 同名岗位以「最新出现的那条」为准（消息按时间倒序）：
 *   - 最新为在招 → 记入 priorityMap（含 P0..P3，写回时可降级）
 *   - 最新为已关闭/缺口0 → 记入 closedTitles（写回时清除优先级）
 *   - 最近窗口内未出现 → 两个集合都没有，写回时保持原值不变
 */
export async function fetchTgPriority(): Promise<TgPriorityResult> {
  const apiId = parseInt(process.env.TG_API_ID || '', 10);
  const apiHash = process.env.TG_API_HASH || '';
  const session = (process.env.TG_SESSION || '').replace(/\s+/g, '');
  const groupId = process.env.TG_GROUP_ID || DEFAULT_GROUP_ID;
  const limit = parseInt(process.env.TG_MSG_LIMIT || '', 10) || DEFAULT_MSG_LIMIT;

  if (!apiId || !apiHash || !session) {
    throw new Error('缺少 TG_API_ID / TG_API_HASH / TG_SESSION 环境变量');
  }

  // 动态 import，避免把较重的 telegram 包打进非必要的 bundle
  const { TelegramClient } = await import('telegram');
  const { StringSession } = await import('telegram/sessions/index.js');

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.connect();
  try {
    const entity = await resolveGroup(client, groupId);
    const messages = await client.getMessages(entity, { limit });

    const priorityMap = new Map<string, string>();
    const closedTitles = new Set<string>();
    const seen = new Set<string>();
    let totalEntries = 0;

    // messages 按时间倒序（最新在前）；每个标题首次遇到即最新
    for (const msg of messages) {
      const text = (msg as { message?: string }).message || '';
      if (!text) continue;
      for (const e of parseTgNotification(text)) {
        totalEntries++;
        const key = normalizeTitle(e.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (isClosedEntry(e)) {
          closedTitles.add(key);
        } else {
          priorityMap.set(key, e.priority);
        }
      }
    }

    return { priorityMap, closedTitles, totalEntries, messageCount: messages.length };
  } finally {
    await client.disconnect();
  }
}

/** 解析群 entity：先用 session 缓存直接拿，失败再遍历会话列表匹配 id。 */
async function resolveGroup(
  client: { getInputEntity: (id: string) => Promise<unknown>; getDialogs: (o: { limit: number }) => Promise<unknown[]> },
  groupId: string,
): Promise<unknown> {
  try {
    return await client.getInputEntity(groupId);
  } catch {
    // session 没缓存该 entity，遍历会话列表找
  }
  const targetId = groupId.replace(/^-100/, '');
  const dialogs = await client.getDialogs({ limit: 200 });
  for (const d of dialogs as Array<{ id?: { toString: () => string }; entity?: unknown }>) {
    const id = d.id?.toString() || '';
    if (id === groupId || id === targetId || id === `-${targetId}`) {
      return d.entity;
    }
  }
  throw new Error(`未在会话列表中找到群 ${groupId}，请确认该账号已加入该群`);
}
