// 从待办文本里识别中文相对日期（今天/明天/本周三/下周五/6月10号/6.10/3天后），
// 自动转成 YYYY-MM-DD，并把识别到的日期短语从标题里剥离。

import { startOfDay, mondayOf } from '@/lib/repush-format';

const DAY = 24 * 60 * 60 * 1000;

/** 周几字符 → JS getDay()（周日=0…周六=6） */
const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 七: 0 };

/** 周前缀 → 相对本周的周偏移 */
const WEEK_OFFSET: Record<string, number> = {
  '上上周': -2, '上周': -1, '这周': 0, '本周': 0, '下周': 1, '下下周': 2,
};

const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 取某周偏移下某个周几的日期（周一为一周起点） */
function dateForWeekday(now: Date, weekOffset: number, weekday: number): Date {
  const monday = mondayOf(now);
  const mondayIndex = weekday === 0 ? 6 : weekday - 1; // 周一=0…周日=6
  return new Date(monday.getTime() + (weekOffset * 7 + mondayIndex) * DAY);
}

export interface ParsedDate {
  date: string;   // YYYY-MM-DD
  rest: string;   // 剥离日期短语后的标题
}

/**
 * 解析文本里的第一个日期短语。识别不到返回 null。
 * rest 为去掉该短语并整理空白后的文本（用于回填标题）。
 */
export function parseDueDateFromText(text: string, now = new Date()): ParsedDate | null {
  const today = startOfDay(now);

  // 各规则：返回 [目标日期, 匹配到的原文]
  const tryRules: Array<() => [Date, string] | null> = [
    // 大后天 / 后天 / 明天 明日 / 今天 今日（先长后短）
    () => match(text, /大后天/, () => new Date(today.getTime() + 3 * DAY)),
    () => match(text, /后天/, () => new Date(today.getTime() + 2 * DAY)),
    () => match(text, /明(天|日)/, () => new Date(today.getTime() + DAY)),
    () => match(text, /今(天|日)/, () => today),
    // （上上周|上周|这周|本周|下下周|下周）?（周|星期|礼拜）X
    () => {
      const m = text.match(/(上上周|下下周|上周|这周|本周|下周)?\s*(周|星期|礼拜)\s*([一二三四五六日天七])/);
      if (!m) return null;
      const weekday = WEEKDAY[m[3]];
      const prefix = m[1];
      let offset = prefix ? WEEK_OFFSET[prefix] : 0;
      let d = dateForWeekday(now, offset, weekday);
      // 无前缀且该日已过本周 → 顺延到下周（避免「周一」识别成过去）
      if (!prefix && d.getTime() < today.getTime()) {
        offset += 1;
        d = dateForWeekday(now, offset, weekday);
      }
      return [d, m[0]];
    },
    // X月X号 / X月X日
    () => {
      const m = text.match(/(\d{1,2})月(\d{1,2})[号日]?/);
      if (!m) return null;
      const mon = parseInt(m[1]) - 1;
      const day = parseInt(m[2]);
      if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
      let d = new Date(today.getFullYear(), mon, day);
      if (d.getTime() < today.getTime()) d = new Date(today.getFullYear() + 1, mon, day);
      return [d, m[0]];
    },
    // X.X（如 6.10）。用分隔符捕获避免 16.100 这类误匹配，且不用 lookbehind（兼容老版 Safari）
    () => {
      const m = text.match(/(^|[^\d.])(\d{1,2})\.(\d{1,2})(?=$|[^\d.])/);
      if (!m) return null;
      const mon = parseInt(m[2]) - 1;
      const day = parseInt(m[3]);
      if (mon < 0 || mon > 11 || day < 1 || day > 31) return null;
      let d = new Date(today.getFullYear(), mon, day);
      if (d.getTime() < today.getTime()) d = new Date(today.getFullYear() + 1, mon, day);
      return [d, `${m[2]}.${m[3]}`]; // 只剥离日期本身，保留前导分隔字符
    },
    // N天后 / N天后
    () => {
      const m = text.match(/(\d{1,3})\s*天[后後]/);
      if (!m) return null;
      return [new Date(today.getTime() + parseInt(m[1]) * DAY), m[0]];
    },
  ];

  for (const rule of tryRules) {
    const r = rule();
    if (r) {
      const [d, phrase] = r;
      return { date: toISO(d), rest: stripPhrase(text, phrase) };
    }
  }
  return null;
}

/** 命中固定关键词时构造结果 */
function match(text: string, re: RegExp, build: () => Date): [Date, string] | null {
  const m = text.match(re);
  if (!m) return null;
  return [build(), m[0]];
}

/** 从文本中去掉匹配短语，并清理多余空白/连接词 */
function stripPhrase(text: string, phrase: string): string {
  return text.replace(phrase, '').replace(/\s+/g, ' ').trim();
}
