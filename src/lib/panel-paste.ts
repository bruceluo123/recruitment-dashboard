// ─── 需求面板「竖排复制」格式还原 ───
// 该面板禁用导出，复制下来是「每个单元格独占一行、空行分隔」的竖排文本：
//   - 每个非空单元格值占一行，后跟 1 个空行作分隔
//   - 空单元格 = 多一个空行（连续 N 个空行 = 1 个分隔符 + (N-1) 个空单元格）
//   - 锚点：需求Key 列恒以「REQ-」开头（记录起点），最后一列恒为字面文字「最近更新」（记录终点）
// 一条记录在 REQ- 与「最近更新」之间还原出固定 21 个字段：
//   [0]需求Key [1]岗位名称 [2]编制组织 [3]服务单位 [4]部门 [5]HC [6]已到岗 [7]缺口
//   [8]已发offer待入职 [9]提需日期 [10]期望到岗日期 [11]优先级 [12]简历对接人 [13]需求发起人
//   [14]JD [15]薪资范围 [16]备注说明 [17]来源表格 [18]对应ODC [19]对应SSC [20]更新时间
// JD 正文可能自带换行导致中间列变多，故用「前 14 列 + 后 6 列固定、中间全部并入 JD」兜底。
export const PANEL_HEADERS = [
  '需求Key', '岗位名称', '编制组织', '服务单位', '部门', 'HC', '缺口', '优先级',
  '对应ODC', '薪资范围', 'JD 岗位职责与任职要求', '加急',
];

/** 记录是否「加急」：源面板在该需求的 REQ- 行前单独放一行 ❗ 标记。
 * 从 REQ- 行往上找最近的非空行，是 ❗ 则该记录加急（非加急行此处为「最近更新」）。 */
function isExpeditedBefore(lines: string[], reqLineIdx: number): boolean {
  for (let k = reqLineIdx - 1; k >= 0; k--) {
    const t = lines[k].trim();
    if (t === '') continue;
    return t.startsWith('❗');
  }
  return false;
}

function reconstructCells(seg: string[]): string[] {
  const cells = [seg[0].trim()];
  let i = 1;
  const n = seg.length;
  while (i < n) {
    if (seg[i].trim() === '') {
      let blanks = 0;
      while (i < n && seg[i].trim() === '') { blanks++; i++; }
      for (let k = 0; k < blanks - 1; k++) cells.push('');
      if (i >= n) break;
    } else {
      cells.push(seg[i].trim());
      i++;
    }
  }
  return cells;
}

function reconstructPanelVertical(text: string): string[][] | null {
  // 竖排面板格式特征：存在以 REQ- 开头的行（记录起点）和 “最近更新” 行（记录终点）。
  // 注意：序号分隔行可能含制表符，但都落在记录块之外，不影响还原。
  const lines = text.split(/\r?\n/);
  const reqIdx: number[] = [];
  let hasEnd = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('REQ-')) reqIdx.push(i);
    if (lines[i].trim() === '最近更新') hasEnd = true;
  }
  if (!reqIdx.length || !hasEnd) return null;

  const rows: string[][] = [PANEL_HEADERS];
  for (const ri of reqIdx) {
    let j = ri + 1;
    while (j < lines.length && lines[j].trim() !== '最近更新') j++;
    const cells = reconstructCells(lines.slice(ri, j));
    if (cells.length < 20) continue; // 异常记录，跳过

    const front = cells.slice(0, 14);
    const back = cells.slice(cells.length - 6);
    const jd = cells.slice(14, cells.length - 6).filter(Boolean).join('\n');
    const full = [...front, jd, ...back]; // 恒为 21 列
    rows.push([
      full[0], // 需求Key（唯一身份，用于去重）
      full[1], full[2], full[3], full[4], full[5], // 岗位名称/编制组织/服务单位/部门/HC
      full[7], full[11], full[18], full[15], full[14], // 缺口/优先级/对应ODC/薪资范围/JD
      isExpeditedBefore(lines, ri) ? '1' : '', // 加急（❗ 标记）
    ]);
  }
  return rows.length > 1 ? rows : null;
}

/** 把粘贴的表格文本解析为二维数组。优先级：
 *  1) 需求面板竖排格式（含 REQ- 锚点、无制表符）→ 专用还原
 *  2) 复制带的 HTML 表格 → DOM 解析（能正确处理含换行的单元格）
 *  3) 退回 TSV（制表符分列、换行分行） */
export function parsePastedTable(plain: string, html?: string): string[][] {
  const panel = reconstructPanelVertical(plain);
  if (panel) return panel;

  if (html && /<table/i.test(html)) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = Array.from(doc.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim()))
        .filter((r) => r.some(Boolean));
      if (rows.length) return rows;
    } catch { /* 退回 TSV */ }
  }
  return plain
    .split(/\r?\n/)
    .map((line) => line.split('\t').map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
}

/** 把还原出的二维表格写成 xlsx File，交给 importFromExcel 走统一的列解析/去重管线。 */
export async function pastedRowsToFile(rows: string[][], fileName = 'pasted-table.xlsx'): Promise<File> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new File([buffer], fileName);
}
