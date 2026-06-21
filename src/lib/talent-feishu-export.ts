import type { Talent } from '@/types/talent';

// 飞书「zzclaw人才库」标准表列顺序（A-AE，共 31 列）。
// 与 skill references/field-rules.md 对齐，导出后可直接粘贴/导入飞书多维表格。
const FEISHU_COLUMNS = [
  '沟通记录',           // A
  '姓名',               // B
  '岗位名称',           // C
  '招聘顾问',           // D
  '首次沟通时间',       // E
  '最新沟通时间',       // F
  '工作意愿度',         // G
  '项目意愿度',         // H
  '月薪',               // I
  '年薪',               // J
  '本科毕业时间',       // K
  '技术方向',           // L
  '手机',               // M
  '邮箱',               // N
  '最近一家公司',       // O
  '所在部门',           // P
  '毕业时间',           // Q
  '学历',               // R
  '本科专业',           // S
  '级别',               // T
  '所在地',             // U
  '曾经在',             // V
  '批量加微信',         // W
  '是否站内信和邮件',   // X
  '链接/附件',          // Y
  '添加好友轨迹',       // Z
  '所属账号',           // AA
  '入职时间及公司类型', // AB
  'jerry技术账号',      // AC
  'Google scholar',     // AD
  'Openreview',         // AE
] as const;

// 把一个人选映射成飞书 A-AE 列的字符串数组
function talentToRow(t: Talent): string[] {
  const links = t.links || {};
  // Y 列「链接/附件」：把简历链接 + 非 scholar/openreview 的外部链接合并成一行
  const yParts: string[] = [];
  if (t.resumeUrl) yParts.push(`简历:${t.resumeUrl}`);
  if (links.maimai) yParts.push(`脉脉:${links.maimai}`);
  if (links.linkedin) yParts.push(`LinkedIn:${links.linkedin}`);
  if (links.github) yParts.push(`GitHub:${links.github}`);
  if (links.homepage) yParts.push(`主页:${links.homepage}`);

  return [
    t.notes || '',                       // A 沟通记录
    t.name || '',                        // B 姓名
    t.jobTitle || '',                    // C 岗位名称
    t.recruiter || '',                   // D 招聘顾问
    t.firstContactAt || '',              // E 首次沟通时间
    t.lastContactAt || '',               // F 最新沟通时间
    t.workIntent || '',                  // G 工作意愿度
    t.projectIntent || '',               // H 项目意愿度
    t.monthlySalary || '',               // I 月薪
    t.annualSalary || '',                // J 年薪
    t.bachelorGradYear || '',            // K 本科毕业时间
    t.techDirection || '',               // L 技术方向
    t.phone || '',                       // M 手机
    t.email || '',                       // N 邮箱
    t.company || '',                     // O 最近一家公司
    t.department || '',                  // P 所在部门
    t.gradYear || '',                    // Q 毕业时间
    t.eduLevel || '',                    // R 学历
    t.major || '',                       // S 本科专业
    t.level || '',                       // T 级别
    t.location || '',                    // U 所在地
    (t.prevCompanies || []).join('、'),  // V 曾经在
    t.wechatStatus || '',                // W 批量加微信
    t.outreachStatus || '',              // X 是否站内信和邮件
    yParts.join('\n'),                   // Y 链接/附件
    t.friendTrack || '',                 // Z 添加好友轨迹
    t.account || '',                     // AA 所属账号
    t.onboardInfo || '',                 // AB 入职时间及公司类型
    t.techAccount || '',                 // AC jerry技术账号
    links.scholar || '',                 // AD Google scholar
    links.openreview || '',              // AE Openreview
  ];
}

// 导出人选为飞书格式 .xlsx 并触发浏览器下载（纯前端，不经过服务端/Vercel）。
export async function exportTalentsToFeishuXlsx(talents: Talent[]): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = [FEISHU_COLUMNS.slice(), ...talents.map(talentToRow)];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '人才库');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `人才库-飞书格式-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
