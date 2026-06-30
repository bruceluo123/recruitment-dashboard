import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const plan = JSON.parse(readFileSync('D:/projects/recruitment-dashboard/_sop-plan.json', 'utf8'));
const DRY = process.argv.includes('--dry-run');

function toFieldJson(fields) {
  return fields.map((f) => {
    if (f.type === 'select') return { name: f.name, type: 'select', options: f.opts };
    if (f.type === 'number') return { name: f.name, type: 'number' };
    return { name: f.name, type: 'text' };
  });
}

function larkRun(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('lark-cli', args, { shell: true, cwd: 'D:/projects/recruitment-dashboard' });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err || out}`))));
  });
}

function parseJson(out) {
  // lark-cli 可能混入日志行，取第一个 { 到最后一个 }
  const i = out.indexOf('{');
  const j = out.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('no json in output: ' + out.slice(0, 300));
  return JSON.parse(out.slice(i, j + 1));
}

function deepFind(obj, keys) {
  // 在嵌套对象里找第一个匹配 key 的字符串值
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === 'object') {
      for (const [k, v] of Object.entries(cur)) {
        if (keys.includes(k) && typeof v === 'string' && v) return v;
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return null;
}

async function main() {
  const first = plan[0];
  const args = [
    'base', '+base-create',
    '--name', 'SOP工程化专家·知识库',
    '--time-zone', 'Asia/Shanghai',
    '--table-name', first.name,
    '--fields', JSON.stringify(toFieldJson(first.fields)),
    '--format', 'json',
  ];
  if (DRY) args.push('--dry-run');
  console.log('>> 建库 + 首表', first.name);
  const out = await larkRun(args);
  console.log(out.slice(0, 1500));
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
