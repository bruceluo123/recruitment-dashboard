// 写入围栏：拦截一切试图修改本项目目录之外文件的 Edit/Write/NotebookEdit。
// 仅锁「写」，不影响 Read / Bash。作为本项目的 PreToolUse 钩子运行。
// 退出码 2 = 阻止该工具调用并把 stderr 反馈给 Claude；0 = 放行。

const path = require('path');

const ROOT = path.resolve('D:\\projects\\recruitment-dashboard');

// 白名单：允许写入的项目目录之外的其他目录（如 Obsidian 知识库，供 daily-input 等技能写入）。
const ALLOWLIST = [
  path.resolve('D:\\wiki\\个人知识库'),
  path.resolve('D:\\projects\\zimeiti-workstation'),
  path.resolve('D:\\projects\\kb-graph-site'),
  path.resolve('C:\\Users\\Administrator\\.claude\\projects\\D--projects-recruitment-dashboard\\memory'),
];

function isUnder(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(data);
  } catch {
    process.exit(0); // 解析不了就放行，避免误伤
  }

  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path || ti.path;
  if (!target) process.exit(0); // 没有路径字段（如批量编辑无单一路径）则放行

  const abs = path.resolve(ROOT, target); // target 为绝对路径时 resolve 直接返回它
  const inside = isUnder(ROOT, abs) || ALLOWLIST.some((dir) => isUnder(dir, abs));

  if (!inside) {
    console.error(
      `[隔离] 已拦截越界写入。本项目会话仅允许修改：\n  ${ROOT}\n` +
        `白名单目录：\n${ALLOWLIST.map((d) => '  ' + d).join('\n')}\n` +
        `目标文件在范围之外：\n  ${abs}\n` +
        `如确需跨目录编辑，请把目录加入 guard-write-scope.js 的 ALLOWLIST，或在另一个会话中操作。`
    );
    process.exit(2);
  }

  process.exit(0);
});
