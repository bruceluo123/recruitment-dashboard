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

const SIGNATURE = '欢迎自荐或转推荐，投递联系麦满分同学🍔 @bruceluo123';
const HEADER_PREFIX = '全远程居家工作';

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

/** 生成一行岗位文案：- 岗位名 ｜ 薪资  地点 */
function lineOf(jd: JD): string {
  const salary = salaryOf(jd);
  const loc = isRemoteLocation(jd.location) ? '' : `  ${jd.location!.trim()}`;
  return `- ${jd.title} ｜ ${salary}${loc}`;
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
 * @param perSegment 每段岗位数上限（参考模板约 20~25）
 */
export function buildAdCopy(jds: JD[], priorityLabel: string, perSegment = 22): AdSegment[] {
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
    const heading = `${emoji}${JD_CATEGORY_LABELS[group.cat]}类`;
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
      cur.lines.push(lineOf(jd));
      cur.count++;
    }
  }
  flush();

  const now = new Date();
  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日`;
  const total = segments.length;
  return segments.map((seg, i) => {
    const seq = total > 1 ? `${dateLabel} · ${i + 1}/${total}` : dateLabel;
    const title = `${priorityLabel} 急招${total > 1 ? `（${i + 1}/${total}）` : ''}`;
    const header = `${HEADER_PREFIX}—今日 ${priorityLabel} 急招岗位🍔🍔（${seq}）`;
    const text = [header, '', ...seg.lines, '', SIGNATURE].join('\n');
    return { title, text, count: seg.count };
  });
}
