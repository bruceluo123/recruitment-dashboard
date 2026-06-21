#!/usr/bin/env node
// 把系统人才库（Upstash KV）的人选反向同步到飞书「zzclaw人才库」表。
// 与 write-talent-to-system.mjs 对称：那条是 飞书/skill → 系统，这条是 系统 → 飞书。
//
// 为什么走本地：从国内访问 Vercel 不稳定，但 KV REST 直连 + 本地 lark-cli 都通。
// 本脚本在用户本机运行，读 KV 拿全部人选，映射成飞书 A-AE 列，
// 通过 skill 已配好的 zzclaw_lark.py（封装 lark-cli）写进指定表。
//
// 用法：
//   node scripts/skill-bridge/export-talents-to-feishu.mjs --url "<feishu sheet url>"
//   node scripts/skill-bridge/export-talents-to-feishu.mjs --url "<url>" --start-row 2 --sheet dc0e63 --header
//
// 选项：
//   --url        必填，飞书普通表格 URL（/sheets/，不是 /base/）
//   --sheet      子表 sheet_id，默认 dc0e63（主表）
//   --start-row  从第几行开始写，默认 2（第 1 行留给表头）
//   --header     额外把表头写到第 1 行
//   --dry-run    只打印将要写入的范围和行数，不实际写

const KV_URL = process.env.RECRUIT_KV_URL || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = process.env.RECRUIT_KV_TOKEN || 'gQAAAAAAARN5AAIgcDE5NDM2NzliZjdjOWY0MjBmYTA0NjhjODhjNTNjZjM3Zg';
const TALENTS_KEY = 'recruit:talents';

// skill 里封装 lark-cli 的 python 脚本
const LARK_WRAPPER = `${process.env.USERPROFILE || process.env.HOME}/.claude/skills/zz-hunteragent-talent-entry/scripts/zzclaw_lark.py`;

// 飞书表列顺序 A-AE（与 src/lib/talent-feishu-export.ts 一致）
const FEISHU_COLUMNS = [
  '沟通记录', '姓名', '岗位名称', '招聘顾问', '首次沟通时间', '最新沟通时间',
  '工作意愿度', '项目意愿度', '月薪', '年薪', '本科毕业时间', '技术方向',
  '手机', '邮箱', '最近一家公司', '所在部门', '毕业时间', '学历', '本科专业',
  '级别', '所在地', '曾经在', '批量加微信', '是否站内信和邮件', '链接/附件',
  '添加好友轨迹', '所属账号', '入职时间及公司类型', 'jerry技术账号',
  'Google scholar', 'Openreview',
];

function s(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function talentToRow(t) {
  const links = t.links || {};
  const yParts = [];
  if (t.resumeUrl) yParts.push(`简历:${t.resumeUrl}`);
  if (links.maimai) yParts.push(`脉脉:${links.maimai}`);
  if (links.linkedin) yParts.push(`LinkedIn:${links.linkedin}`);
  if (links.github) yParts.push(`GitHub:${links.github}`);
  if (links.homepage) yParts.push(`主页:${links.homepage}`);

  return [
    s(t.notes),                          // A 沟通记录
    s(t.name),                           // B 姓名
    s(t.jobTitle),                       // C 岗位名称
    s(t.recruiter),                      // D 招聘顾问
    s(t.firstContactAt),                 // E 首次沟通时间
    s(t.lastContactAt),                  // F 最新沟通时间
    s(t.workIntent),                     // G 工作意愿度
    s(t.projectIntent),                  // H 项目意愿度
    s(t.monthlySalary),                  // I 月薪
    s(t.annualSalary),                   // J 年薪
    s(t.bachelorGradYear),               // K 本科毕业时间
    s(t.techDirection),                  // L 技术方向
    s(t.phone),                          // M 手机
    s(t.email),                          // N 邮箱
    s(t.company),                        // O 最近一家公司
    s(t.department),                     // P 所在部门
    s(t.gradYear),                       // Q 毕业时间
    s(t.eduLevel),                       // R 学历
    s(t.major),                          // S 本科专业
    s(t.level),                          // T 级别
    s(t.location),                       // U 所在地
    (t.prevCompanies || []).map(s).filter(Boolean).join('、'), // V 曾经在
    s(t.wechatStatus),                   // W 批量加微信
    s(t.outreachStatus),                 // X 是否站内信和邮件
    yParts.join('\n'),                   // Y 链接/附件
    s(t.friendTrack),                    // Z 添加好友轨迹
    s(t.account),                        // AA 所属账号
    s(t.onboardInfo),                    // AB 入职时间及公司类型
    s(t.techAccount),                    // AC jerry技术账号
    s(links.scholar),                    // AD Google scholar
    s(links.openreview),                 // AE Openreview
  ];
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

function getArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

// 列号 → 字母（1→A, 27→AA, 31→AE）
function colLetter(n) {
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

async function larkWrite(url, range, values) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('python', [
      LARK_WRAPPER, 'write',
      '--url', url,
      '--range', range,
      '--values-json', JSON.stringify(values),
    ], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`lark-cli write exit ${code}`)));
  });
}

async function main() {
  const url = getArg('--url');
  if (!url) { console.error('错误：缺少 --url（飞书表格地址）'); process.exit(1); }
  if (url.includes('/base/')) {
    console.error('错误：这是多维表格（/base/）地址，本脚本只支持普通表格（/sheets/）。');
    process.exit(1);
  }
  const sheet = getArg('--sheet', 'dc0e63');
  const startRow = parseInt(getArg('--start-row', '2'), 10) || 2;
  const withHeader = process.argv.includes('--header');
  const dryRun = process.argv.includes('--dry-run');

  const raw = await kvGet(TALENTS_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (list.length === 0) { console.log('人才库为空，无可导出。'); return; }

  const endCol = colLetter(FEISHU_COLUMNS.length); // AE
  const rows = list.map(talentToRow);

  if (withHeader) {
    const headerRange = `${sheet}!A1:${endCol}1`;
    console.log(`表头 → ${headerRange}`);
    if (!dryRun) await larkWrite(url, headerRange, [FEISHU_COLUMNS]);
  }

  const endRow = startRow + rows.length - 1;
  const dataRange = `${sheet}!A${startRow}:${endCol}${endRow}`;
  console.log(`${rows.length} 位人选 → ${dataRange}`);

  if (dryRun) { console.log('（dry-run，未实际写入）'); return; }

  await larkWrite(url, dataRange, rows);
  console.log(`✅ 已导出 ${rows.length} 位人选到飞书表（${dataRange}）`);
}

main().catch((err) => { console.error('导出失败：', err.message); process.exit(1); });
