import XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';

const wb = XLSX.readFile('C:/Users/Administrator/Desktop/SOP知识库结构蓝图_可导入飞书多维表格.xlsx');

const S = (v) => (v === undefined || v === null ? '' : String(v).trim());
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function sheetRows(name) {
  const ws = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

const sel = (names) => names.map((n) => ({ name: n }));
const tables = [];

// 1. SOP主表
{
  const rows = sheetRows('SOP主表');
  const data = rows.slice(1).filter((r) => S(r[0]));
  const fieldDefs = [
    { name: 'SOP编号', type: 'text' },
    { name: 'SOP标题', type: 'text' },
    { name: '所属业务线', type: 'select', opts: sel(['客服运营', '主播运营']) },
    { name: '适用场景', type: 'text' },
    { name: '操作步骤概要', type: 'text' },
    { name: '注意事项', type: 'text' },
    { name: '验收标准', type: 'text' },
    { name: '版本号', type: 'text' },
    { name: '状态', type: 'select', opts: sel(['已发布', '草稿', '已归档']) },
    { name: '负责人', type: 'text' },
    { name: '发布日期', type: 'text' },
    { name: '有效期至', type: 'text' },
    { name: '下次复测日期', type: 'text' },
    { name: '关联工具包', type: 'text' },
    { name: '来源访谈编号', type: 'text' },
    { name: '涉及决策点数量', type: 'number' },
  ];
  const recRows = data.map((r) => fieldDefs.map((f, i) => (f.type === 'number' ? N(r[i]) : (S(r[i]) || null))));
  tables.push({ name: 'SOP主表', fields: fieldDefs, rows: recRows });
}

// 2. 经验萃取记录表
{
  const rows = sheetRows('经验萃取记录表');
  const data = rows.slice(1).filter((r) => S(r[0]));
  const fieldDefs = [
    { name: '访谈编号', type: 'text' },
    { name: '访谈对象（练习代号）', type: 'text' },
    { name: '访谈日期', type: 'text' },
    { name: '业务动作描述', type: 'text' },
    { name: '提炼出的决策点', type: 'text' },
    { name: '关联SOP编号', type: 'text' },
    { name: '转化状态', type: 'select', opts: sel(['已转化', '待加工']) },
    { name: '原始素材（占位）', type: 'text' },
  ];
  const recRows = data.map((r) => fieldDefs.map((f, i) => S(r[i]) || null));
  tables.push({ name: '经验萃取记录表', fields: fieldDefs, rows: recRows });
}

// 3. 工具包资产表
{
  const rows = sheetRows('工具包资产表');
  const data = rows.slice(1).filter((r) => S(r[0]));
  const fieldDefs = [
    { name: '工具包编号', type: 'text' },
    { name: '工具包名称', type: 'text' },
    { name: '类型', type: 'select', opts: sel(['决策树', '话术模板', '流程图', '检查清单', '案例库']) },
    { name: '关联SOP编号', type: 'text' },
    { name: '文件/格式说明（占位）', type: 'text' },
    { name: '最近更新日期', type: 'text' },
    { name: '维护人', type: 'text' },
  ];
  const recRows = data.map((r) => fieldDefs.map((f, i) => S(r[i]) || null));
  tables.push({ name: '工具包资产表', fields: fieldDefs, rows: recRows });
}

// 4. 评审记录表
{
  const rows = sheetRows('评审记录表');
  const data = rows.slice(1).filter((r) => S(r[0]));
  const fieldDefs = [
    { name: '评审编号', type: 'text' },
    { name: '关联SOP编号', type: 'text' },
    { name: '评审日期', type: 'text' },
    { name: '评审人角色', type: 'text' },
    { name: '反馈内容', type: 'text' },
    { name: '修改前', type: 'text' },
    { name: '修改后', type: 'text' },
    { name: '评审结论', type: 'select', opts: sel(['修改后通过', '通过', '驳回']) },
  ];
  const recRows = data.map((r) => fieldDefs.map((f, i) => S(r[i]) || null));
  tables.push({ name: '评审记录表', fields: fieldDefs, rows: recRows });
}

// 5. 复测排期视图
{
  const rows = sheetRows('复测排期视图');
  const data = rows.slice(1).filter((r) => S(r[0]) && S(r[0]).startsWith('SOP'));
  const fieldDefs = [
    { name: 'SOP编号', type: 'text' },
    { name: 'SOP标题', type: 'text' },
    { name: '下次复测日期', type: 'text' },
    { name: '距今天数', type: 'number' },
    { name: '复测状态', type: 'select', opts: sel(['已逾期', '7天内到期', '正常']) },
  ];
  const recRows = data.map((r) => fieldDefs.map((f, i) => (f.type === 'number' ? N(r[i]) : (S(r[i]) || null))));
  tables.push({ name: '复测排期视图', fields: fieldDefs, rows: recRows });
}

writeFileSync('D:/projects/recruitment-dashboard/_sop-plan.json', JSON.stringify(tables, null, 2), 'utf8');
console.log('表数:', tables.length);
for (const t of tables) console.log(`  ${t.name}: ${t.fields.length} 字段, ${t.rows.length} 行`);
