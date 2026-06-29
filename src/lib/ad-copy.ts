// 根据急招岗位（P0/P1）生成可直接发群/朋友圈的招聘广告文案。
// 文案按职能分类分组，岗位过多时自动切分为多段，每段长度可控。

import type { JD, JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, getPrimaryCategory } from '@/types/jd';

/** 各职能分类对应的 emoji，用于文案小标题。缺省 💼。 */
const CATEGORY_EMOJI: Record<JDCategory, string> = {
  frontend: '💻', backend: '🛠️', devops: '⚙️', administration: '🗂️',
  advertising: '📣', gaming: '🎮', operations: '📊', product: '📦',
  design: '🎨', finance: '💰', algorithm: '🧠', 'customer-service': '🎧',
  project: '📋', ai: '🤖', testing: '🧪', hr: '🧑‍💼', bd: '🤝',
  seo: '🔍', director: '👔', data: '📈', hardware: '🔌', art: '🖌️',
  marketing: '📢', video: '🎬', live: '📺', legal: '⚖️', training: '🎓',
  content: '✍️',
};

/** 文案风格：麦满分（@bruceluo123）/ 铁牛（@Tie_Niu66）。两者头部与署名不同。 */
export type AdVariant = 'maimanfen' | 'tieniu';

interface VariantConfig {
  /** 风格中文名，用于按钮与标题 */
  label: string;
  /** 头部行：priorityLabel 为 P0/P1，seq 为日期/分段序号 */
  buildHeader: (priorityLabel: string, seq: string) => string;
  /** 职能分类小标题：emoji 为分类图标，label 为分类中文名 */
  buildHeading: (emoji: string, label: string) => string;
  /** 单个岗位行：title 岗位名，salary 薪资，loc 地点（远程为空字符串） */
  buildLine: (title: string, salary: string, loc: string) => string;
  /** 署名块（可多行） */
  signature: string;
}

const VARIANTS: Record<AdVariant, VariantConfig> = {
  maimanfen: {
    label: '麦满分',
    buildHeader: (_priorityLabel, seq) => `远程remote工作—今日急招岗位🔝🔝（${seq}）`,
    buildHeading: (emoji, label) => `${emoji}${label}类`,
    buildLine: (title, salary, loc) => `- ${title}${salary ? ` ｜ ${salary}` : ''}${loc ? `  ${loc}` : ''}`,
    signature:
      [
        '各种类岗位总计200+，自荐 / 内推都欢迎',
        '想看看自己的岗位有没有需求的，欢迎找我聊聊 → @Robinlee99',
      ].join('\n'),
  },
  tieniu: {
    label: '铁牛',
    buildHeader: () => '全远程居家工作—今日急招',
    buildHeading: (emoji, label) => `${emoji}${label}类`,
    buildLine: (title, salary, loc) => `- ${title}${salary ? ` ｜ ${salary}` : ''}${loc ? `  ${loc}` : ''}`,
    signature: '欢迎自荐或转推荐，投递联系 @Tie_Niu66',
  },
};

/** 供 UI 读取风格中文名 */
export function adVariantLabel(variant: AdVariant): string {
  return VARIANTS[variant].label;
}

/** 供 UI 读取分类 emoji */
export function getCategoryEmoji(cat: JDCategory): string {
  return CATEGORY_EMOJI[cat] || '💼';
}

/** 远程/居家类地点不在文案中展示。 */
function isRemoteLocation(loc?: string): boolean {
  if (!loc) return true;
  const l = loc.trim().toLowerCase();
  return l === '' || l === 'remote' || l.includes('远程') || l.includes('居家') || l.includes('remote');
}

/**
 * 清洗薪资自由文本：源数据常把 K 错写在最前（"K20-40K"），应为 "20K-40K"，
 * 即把开头的 K 挪到第一个数字之后。例：K20-40K→20K-40K、K18-30K→18K-30K。
 */
function normalizeSalaryText(s: string): string {
  return s.replace(/^[Kk]\s*(\d+)/, '$1K');
}

// 这些「货币」其实是单位 K（千），不作为前缀展示，改用 K 后缀。
const K_UNIT_CURRENCIES = new Set(['', 'K', 'k', 'CNY', 'RMB']);

/** 单个岗位的薪资文本：优先自由文本，否则退回薪资区间，再否则「面议」。 */
function salaryOf(jd: JD): string {
  if (jd.salaryText && jd.salaryText.trim()) return normalizeSalaryText(jd.salaryText.trim());
  const { min, max, currency } = jd.salaryRange || { min: 0, max: 0, currency: '' };
  if (min > 0 || max > 0) {
    // currency 为 K/空/人民币 → 数字带 K 后缀（如 20K-40K）；其它真实货币 → 作前缀
    if (K_UNIT_CURRENCIES.has(currency || '')) {
      return min === max ? `${min}K` : `${min}K-${max}K`;
    }
    return min === max ? `${currency}${min}` : `${currency}${min}-${max}`;
  }
  return '面议';
}

/** 生成一行岗位文案，具体格式由风格的 buildLine 决定 */
function lineOf(jd: JD, cfg: VariantConfig): string {
  const salary = salaryOf(jd);
  const loc = isRemoteLocation(jd.location) ? '' : jd.location!.trim();
  return cfg.buildLine(jd.title, salary, loc);
}

// ─── 脱敏模板 ───────────────────────────────────────────────────────────────
// 纯数字 emoji 编号，无分类、无薪资、无额外 emoji，固定头尾。
const EMOJI_NUMS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
const DIGIT_KEYCAPS = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
// 1-10 用现成的数字 emoji（10=🔟）；11 起逐位拼数字 keycap，如 11→1️⃣1️⃣、25→2️⃣5️⃣。
const emojiNum = (n: number) =>
  n <= 10 ? EMOJI_NUMS[n - 1] : String(n).split('').map((d) => DIGIT_KEYCAPS[Number(d)]).join('');

/**
 * 脱敏文案：flat 编号列表，不含薪资、分类、风格头部，适合对外转发。
 * 返回单个 AdSegment（可直接放入 segments 数组）。
 */
export function buildDesensitizedCopy(jds: JD[]): AdSegment {
  if (jds.length === 0) return { title: '脱敏文案', text: '', count: 0 };
  const lines = jds.map((jd, i) => `${emojiNum(i + 1)}${jd.title}`);
  const text = [
    'HR直招🚀远程工作岗位🔥',
    '',
    ...lines,
    '',
    '联系方式、欢迎小伙伴投递：',
  ].join('\n');
  return { title: '脱敏文案', text, count: jds.length };
}

export interface AdSegment {
  /** 段标题，如「P0 急招（1/2）」 */
  title: string;
  /** 完整文案文本，可直接复制 */
  text: string;
  /** 本段包含的岗位数 */
  count: number;
}

interface CategoryGroup {
  cat: JDCategory;
  jds: JD[];
}

/** 按职能分类分组，组内保持原顺序，组间按 ALL_CATEGORIES 顺序但 AI 类优先靠前。 */
function groupByCategory(jds: JD[]): CategoryGroup[] {
  const map = new Map<JDCategory, JD[]>();
  for (const jd of jds) {
    const cat = getPrimaryCategory(jd);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(jd);
  }
  // AI 类放最前，其余按分组大小降序
  const entries = Array.from(map.entries());
  entries.sort((a, b) => {
    if (a[0] === 'ai') return -1;
    if (b[0] === 'ai') return 1;
    return b[1].length - a[1].length;
  });
  return entries.map(([cat, list]) => ({ cat, jds: list }));
}

/**
 * 为某一优先级（P0/P1）的岗位生成广告文案，按需分段。
 * @param jds 该优先级下的岗位（已过滤）
 * @param priorityLabel 如 "P0" / "P1"
 * @param variant 文案风格：麦满分 / 铁牛（头部与署名不同）
 * @param perSegment 每段岗位数上限（参考模板约 20~25）
 */
export function buildAdCopy(jds: JD[], priorityLabel: string, variant: AdVariant = 'maimanfen', perSegment = 22): AdSegment[] {
  const cfg = VARIANTS[variant];
  if (jds.length === 0) return [];
  const groups = groupByCategory(jds);

  // 先把所有行按分类切成「块」，再按 perSegment 装箱；同一分类跨段时重复打小标题
  const segments: { lines: string[]; count: number }[] = [];
  let cur: { lines: string[]; count: number } = { lines: [], count: 0 };

  const flush = () => {
    if (cur.count > 0) segments.push(cur);
    cur = { lines: [], count: 0 };
  };

  for (const group of groups) {
    const emoji = CATEGORY_EMOJI[group.cat] || '💼';
    const heading = cfg.buildHeading(emoji, JD_CATEGORY_LABELS[group.cat]);
    let headingWritten = false;
    for (const jd of group.jds) {
      if (cur.count >= perSegment) flush();
      if (!headingWritten || cur.lines.length === 0 || !cur.lines.includes(heading)) {
        // 段内该分类还没写过标题就补一个（含跨段重复）
        if (!cur.lines.includes(heading)) {
          if (cur.lines.length > 0) cur.lines.push(''); // 分类间空行
          cur.lines.push(heading);
          headingWritten = true;
        }
      }
      cur.lines.push(lineOf(jd, cfg));
      cur.count++;
    }
  }
  flush();

  const now = new Date();
  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日`;
  const total = segments.length;
  return segments.map((seg, i) => {
    const title = `${priorityLabel} 急招${total > 1 ? `（${i + 1}/${total}）` : ''}`;
    const header = cfg.buildHeader(priorityLabel, dateLabel);
    const text = [header, '', ...seg.lines, '', cfg.signature].join('\n');
    return { title, text, count: seg.count };
  });
}
