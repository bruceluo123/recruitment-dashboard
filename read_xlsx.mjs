import { readFileSync } from 'fs';
import * as XLSX from './node_modules/xlsx/lib/xlsx.js';

const wb = XLSX.readFile('C:/Users/Administrator/Desktop/招聘需求汇总 - 招聘共享版.xlsx');
console.log('SHEETS:', wb.SheetNames.join(', '));
for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`\n=== ${sn} (${rows.length}行) ===`);
  rows.slice(0, 8).forEach((r, i) => console.log(i, JSON.stringify(r).slice(0, 200)));
}
