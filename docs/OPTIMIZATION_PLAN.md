# 企鹅求职岛 — 优化升级方案

> 生成日期：2026-07-03
> 方法：7 个专家代理并行通读全库（架构 / TypeScript-React / 性能 / 安全 / 可维护性 / 死代码 / 产品设计），交叉去重后按优先级整合。
> 状态标记：`[ ]` 待批准 · `[~]` 进行中 · `[x]` 已完成 · `[skip]` 用户否决

本方案供**逐条批准后执行**。每条含：涉及文件、问题、改法、工作量、风险。多个维度共同指向的根因已合并为单一任务（右侧标注 命中维度数）。

---

## 执行进度（2026-07-04 更新）

已完成并部署（build 绿 + 浏览器冒烟通过）：

- **批次 A 安全加固**（commit 64673ce）：SSRF 白名单、AI/上传端点同源+限流、手动同步端点节流、`/api/data` 补全 6 类映射+可选写口令、`sync.ts` KV 凭证改 env 优先。
- **批次 B 快赢性能**（commit d8dbf1d）：轮询先查版本号再决定是否下载、selector+useMemo 消重渲染、表格 React.memo、分类计数 O(21n)→O(n)、recharts 懒加载、构建优化+安全头。
- **批次 C 数据可靠性**（commit 33c311d）：version 原子 INCR、空数据保护按「读取是否成功」区分合法清空与故障、重分类自动同步、interview-store 版本化。
- **批次 E 清理（安全部分）**（commit 后）：移除 8 个未用依赖、silent catch 补日志、删临时脚本、tsbuildinfo 出库。

已追加完成（第二轮）：

- **批量删除二次确认 + DRY**：批量删除加确认弹窗；抽 `mondayKey`/`mock-guard` 消除重复。
- **P1-5 候选人结果闭环**（commit d90bf8e）：入职/淘汰/拒Offer/退出四态 + 原因 + 卡片徽章，浏览器实测通过。
- **🔴 空数据保护回归修复**（commit c3fe250）：Batch C 的 readOk 放行逻辑导致 2026-07-04 线上 JD 库被清空+回灌 KV。已恢复「空永不覆盖非空」。事后核查：用户 266 条真实 JD 完好、无被墓碑标记；7110 条墓碑为事故残留(60天TTL自清，新JD用时间戳id不碰撞)。
- **P1-7 全局面试提醒**（commit）：提醒上移全局布局、任意页面生效、增发浏览器系统通知，移除页内重复逻辑，实测通过。

- **P1-6 协同（回收站 + 操作人标识）**（commit）：新增本机 30 天回收站（删 JD/人选可恢复，恢复赋新 id 避开墓碑），`currentOperatorName()` 复用 pref 身份记录删除人。**刻意不碰 KV 墓碑/同步机制**（吸取事故教训）。实测通过。

**仍待做**（下次会话继续）：

- **updatedBy 全链路**（P1-6 可选增强）：在 JD/人选/候选人编辑时盖「最后由 X 修改」并在详情展示。回收站已用到 operator，此项为纯增量。
- **飞书 bot 面试提醒**：P1-7 已接浏览器通知，飞书 bot 推送（提前1天+1小时）可作为增强。
- **P2 拆分（部分完成）**：✅ JDLibraryPage 1005→408 行（抽出 JdPreviewCard / ImportDiffDialog / WeeklyAddedDialog / lib/jd-paste-parse）。⬜ 剩 importFromExcel(266行)拆分——需先补 replace/merge 单测再动，风险最高故留最后。
- **P1-1 大改（需你在场）**：简历资产全链路贯通。
- **批次 E 拆分**：P2-1 拆 JDLibraryPage(990行)/importFromExcel(需先补测试)、抽 JdPreviewCard；P2-5 xlsx CVE 换源（需回归导入）；根目录非本项目文件（deploy_loan.py / geo/ / yifangpinpin-web 软链，需你确认可否移出）。
- **批次 D 大改（需你在场）**：P1-1 简历资产全链路贯通（按候选人建模，动数据模型）。

> ⚠️ 部署提醒：本仓库 Stop hook 会在会话结束自动 commit+push+deploy-prod。以上改动均已保证 build 绿、非破坏、向后兼容，可安全上线。但 **P0-1 的 token 轮换需你手动完成**（见下）。

---

## 摘要：最该先做的 5 件事

| # | 任务 | 为什么最优先 | 工作量 |
|---|------|------------|--------|
| P0-1 | KV token 出客户端 + 写路径收敛 | 5/7 个代理独立点名；任何访客可清空全团队数据 | 中 |
| P0-2 | 4 个 API 路由补 SSRF/鉴权/限流 | 服务器可被当匿名代理；AI 端点可被刷爆账单 | 小 |
| P0-3 | 轮询改「先查版本号再决定是否下载」 | 每个在线用户每 10 秒白拉几百 KB，国内链路卡顿主因 | 小 |
| P0-4 | JD/人才大表虚拟化 + selector 重渲染修复 | 500+/783 行全量渲染，搜索每次按键重算 21×n | 中 |
| P1-1 | 简历资产全链路贯通（按候选人建模） | 产品最大病根：简历在模块间反复丢失重录 | 大 |

---

## P0 — 阻断级（安全 / 数据可靠性 / 明显卡顿）

### P0-1　KV token 出客户端 bundle，写路径收敛到服务端　`命中 5/7`
- **涉及**：`src/lib/sync.ts:5-6`（硬编码 `KV_URL`/`KV_TOKEN`）、`src/app/api/data/route.ts`、`scripts/skill-bridge/export-talents-to-feishu-base.mjs:18-19`
- **问题**：Upstash 全权限 REST token 明文写死并随浏览器 bundle 下发，且已提交到公开 GitHub 仓库。任何访客在 devtools 即可 `SET recruit:jds ""` 清空全库或篡改。`kvCmd` 支持任意 cmd，无操作白名单。这是"多次迁移丢数据"的结构性根因，也是无鉴权问题的总源头。
- **改法**（务实分步，不推翻"国内直连"架构）：
  1. **立即**：Upstash 后台轮换该 token（旧的已泄漏，无论后续怎么改都必须换）。
  2. 客户端只保留**只读轮询**：给 Upstash 配一个只读 REST token，用 `NEXT_PUBLIC_KV_READONLY_TOKEN` 注入（浏览器直连读，读操作暴露风险远低于写）。
  3. **所有写操作**改走 `/api/data` POST（服务端 env token），补一个轻量共享口令头 `X-App-Token`（内部工具，不需要完整登录体系）。
  4. `/api/data` 的 key 映射从"只认 jds/candidates"扩到全 6 类（见 P0-1b）。
- **工作量**：中（1.5-2 天）　**风险**：中（改同步主路径，需回归测试多端同步）
- **注**：若嫌第 2/3 步改造大，**最低限度也要做第 1 步轮换 + 一个 KV 前置校验 key**，否则等于数据库裸奔。

### P0-1b　`/api/data` 补齐 6 类数据映射（P0-1 的前置）
- **涉及**：`src/app/api/data/route.ts:27-31,48`
- **问题**：GET/POST 只认 `jds`/`candidates`，talents/repush/todos/companies 一律落到 candidates 键——服务端写路径是半成品，直接迁写入会覆盖错键。
- **改法**：改为 `SYNC_KEYS[type]` 白名单映射覆盖 6 类 + 校验 type 合法性。
- **工作量**：小（0.5 天）　**风险**：低

### P0-2　4 个 API 路由补 SSRF / 鉴权 / 限流　`命中 2/7（安全+架构）`
- **涉及**：
  - SSRF：`src/app/api/resume/parse/route.ts:19`、`src/app/api/talent/scan/route.ts:18`（`fetch(url)` 无域名白名单）
  - 无鉴权可刷账单：`src/app/api/match/route.ts`、`src/app/api/claude/route.ts`、`src/app/api/company/research/route.ts`（转发 DeepSeek/Gemini，任何人可无限调用）
  - 无鉴权触发写：`src/app/api/sync/google-run/route.ts`、`src/app/api/sync/tg-run/route.ts`
- **问题**：① 两个 `fetch(url)` 接受任意 URL，可探测内网 / 把 Vercel 当匿名代理；② AI 代理端点被外部脚本刷爆产生账单（`company/research` 单次 16384 token 最贵）；③ 手动同步端点任何人可触发，`tg-run` 用真实 TG 账号 session 被滥用可能封号。
- **改法**（都是低成本）：
  1. SSRF：`fetch(url)` 前加域名白名单，只允许 `*.public.blob.vercel-storage.com` + `Content-Length` 上限。
  2. AI 代理：加 `Origin`/`Referer` 校验（只放行 `qieqiuzhidao.vercel.app`）+ `@upstash/ratelimit` 按 IP 限速；三个 key 在控制台设月度硬上限告警。
  3. 手动同步：补 `CRON_SECRET` 校验（前端按钮带同一 header）+ KV 时间戳节流（10 秒内重复调用拒绝）。
- **工作量**：小（1 天，全部加起来）　**风险**：低（纯增强，不改业务）

### P0-3　轮询改「先查版本号，未变则不下载数据」　`命中 1/7（性能）`
- **涉及**：`src/lib/sync.ts:85-111,144-151`
- **问题**：`poll()` 每 10 秒对 6 个 key + version + tombstones 做 8 次并行 GET，**先整体下载全部 JSON body 再比 version**。JD(500+)+人才(783) 约 300KB-1MB，即使无人改动，每个在线用户每 10 秒白拉一遍全量。是国内链路卡顿主因。
- **改法**：先只 GET version（体积可忽略），version 未变化直接 return，不发起数据 key 下载。这是对现有代码最小侵入的改法，不动数据结构。
- **工作量**：小（0.5 天）　**风险**：低　**收益**：稳定态网络流量降 90%+

### P0-4　大表虚拟化 + selector 重渲染修复　`命中 3/7（性能+TS+可维护）`
- **涉及**：
  - 无虚拟化：`src/components/jd-library/JDTable.tsx:113-224`、`src/components/talent-pool/TalentTable.tsx:95-183`
  - 整 store 订阅 + 无 memo：`src/store/jd-store.ts:595-618`、`src/store/talent-store.ts:355-394`（`useFilteredJDs`/`useCategoryCounts`/`useFilteredTalents`/`useTalentCategoryCounts`）
  - 表格未 memo：`JDTable`/`TalentTable` 无 `React.memo`
- **问题**：① 500-783 行全量渲染成 5000-8000 DOM 节点，首挂载/筛选/排序全量 reconcile；② 这几个 hook 用 `useJDStore()` 无 selector，store 任何字段变（含导入进度 tick）都触发大页面重渲染；③ `useCategoryCounts` 对 500+ JD 跑 21 次 filter = O(21n)，搜索每次按键都重算。
- **改法**（三步递进）：
  1. hook 改 selector 订阅（`useJDStore(s=>s.jds)`）+ `useMemo` 包裹 filter/count；`useCategoryCounts` 改一次遍历累加 O(n)。
  2. `JDTable`/`TalentTable` 包 `React.memo` + 回调 `useCallback`。
  3. 接入 `@tanstack/react-virtual`，只渲染可视区。
- **工作量**：中（步骤 1+2 约 1 天=快赢；步骤 3 约 2 天）　**风险**：低（1/2 步行为不变）　**收益**：搜索重算量降 ~95%，首渲染降 60-80%

---

## P1 — 高优先（数据一致性隐患 / 产品流程断点 / 体验伤害）

### P1-1　简历资产全链路贯通：从「按页面建表」到「按候选人建模」　`命中 1/7（产品）· 最高产品价值`
- **涉及**：`src/components/repush-pool/ResumeIntake.tsx`、`src/store/repush-store.ts:105`、`src/lib/schedule.ts:40`、`src/components/talent-pool/TalentPoolPage.tsx:95-139`、`src/store/resume-store.ts`、`src/components/resume-matching/MatchingResultCard.tsx`
- **问题**（产品最大病根）：同一个人在推荐中心/简历匹配/人才库/面试看板是 4 条互不相认的数据。推荐中心上传简历只提取文字**丢弃文件本体**（rawText 还截断到 2000 字）；"从推荐中心导入"只带 6 个字段不带简历；简历匹配结果卡是死胡同（无"录入推荐/加入人才库"动作，10 分钟 TTL 后清除）。结果：同一份简历要反复上传，面试官要简历时得翻本地文件夹。
- **改法**（分阶段）：
  1. 推荐中心/简历匹配上传时统一走 `/api/talent/upload` 存 Blob，把 `resumeUrl`+rawText+highlights 写进 RepushItem。
  2. 引入 `talentId` 作为跨模块主键，推荐记录/候选人/人才都存 talentId；约面/导入时全链路透传。
  3. 简历匹配结果卡加"一键录入推荐/加入人才库"按钮。
  4. 人才库详情聚合展示该人的推荐历史+面试轨迹；查重从"姓名精确"升级为"姓名+电话/TG 模糊"。
- **工作量**：大（3-5 天）　**风险**：中（动核心数据模型，建议先补迁移脚本+备份）
- **注**：这是产品代理的头号建议——"优先做这条，其余都会顺势变容易"。

### P1-2　版本号原子化 + 并发写不再静默覆盖　`命中 2/7（架构+性能）`
- **涉及**：`src/lib/sync.ts:118-128,144-151,190-209`
- **问题**：version 用 `get→+1→set` 读改写，两人同时推送后者覆盖前者版本；一次导入连触发 3 次独立 +1，抖动严重，导致某些端"漏版本"10 秒看不到更新。数据靠 mergeById 兜底不丢，但体验是"对方改了我这没显示"。
- **改法**：用 Upstash 原生 `INCR recruit:version`（原子）；一次导入合并为一次推送。
- **工作量**：中（1 天）　**风险**：中（同步核心）

### P1-3　`shouldApply` 空数据保护不再永久阻断合法清空　`命中 1/7（架构）`
- **涉及**：`src/components/layout/SyncProvider.tsx:31-33,78-100`、`src/lib/sync.ts:145`
- **问题**：为防"读取故障返回空数组误清本地"，规定 `incoming.length===0 && currentLen>0` 时不应用远端。副作用：某用户合法清空某类数据（如清空全部 todos），其他端因本地非空**永久拒绝**这条更新，两端永久不一致。把"读取失败"和"合法空"混为一谈。
- **改法**：区分 `fetchRemote` 返回 null（读取失败，跳过）与合法空数组（应用）。
- **工作量**：中（0.5-1 天）　**风险**：中（涉及数据保护逻辑，需仔细测）

### P1-4　重新分类 / 变更后自动同步云端　`命中 2/7（TS+架构）`
- **涉及**：`src/components/jd-library/JDLibraryPage.tsx:162-166`、`src/store/jd-store.ts:118-132`
- **问题**：`reclassifyAll()` 只 `set` 本地不推 KV，用户忘了手动"备份到云端"，10 秒轮询会用远端旧数据覆盖回来（`shouldApply` 不挡"旧覆盖新"）——真实丢改动场景。
- **改法**：`reclassifyAll` 完成后自动 `syncPush('jds', jds)`。
- **工作量**：小（0.5 天）　**风险**：低

### P1-5　候选人结果闭环（入职/淘汰/拒 Offer）+ 漏斗报表　`命中 1/7（产品）`
- **涉及**：`src/types/interview.ts`、`src/components/interview-calendar/`
- **问题**：看板只有一面/二面/Offer，无"已入职/已淘汰/Offer 被拒"。淘汰只能删（丢历史），Offer 列无限堆积。对猎头致命——回款以入职过保为准，系统在 Offer 就断了；淘汰原因是复推决策关键。
- **改法**：Candidate 加 `outcome` + `outcomeReason`，看板加归档/结果操作；基于现有 repush+candidates 数据自动生成周/月转化漏斗报表页。
- **工作量**：中（2-3 天）　**风险**：低（加字段+新页面，数据都在）

### P1-6　多人协同信任三件套：操作人标识 + 冲突提示 + 回收站　`命中 2/7（产品+架构）`
- **涉及**：`src/lib/sync.ts:51-63,132`、`src/store/pref-store.ts`、`src/components/talent-pool/TalentPoolPage.tsx:88-93`、`src/store/talent-store.ts:117-120`
- **问题**：① 无操作人身份/变更历史，出问题无法追溯；② 批量删除无确认无撤销，经墓碑机制团队级永久生效，一次误全选=数据事故；③ last-writer-wins 静默覆盖。
- **改法**：进入选/记操作人，记录写 `updatedBy`+`updatedAt` 并展示；批量删除加确认弹窗（显示数量+抽样名单）；墓碑改"回收站"保留 30 天可恢复；push 前对比远端 updatedAt，并发时弹提示。
- **工作量**：中（2-3 天，纯前端 store 层）　**风险**：低

### P1-7　全局面试/跟进提醒（不再只在日历页生效）　`命中 1/7（产品）`
- **涉及**：`src/components/interview-calendar/InterviewCalendarPage.tsx:65-82`
- **问题**：提醒是页面内 30 秒轮询 toast，只在日历页渲染，提前量仅 15 分钟。关掉标签页/切走就没了——漏跟进是猎头最典型事故。
- **改法**：提醒上移到全局 layout + 浏览器 Notification API；接已有 `scripts/feishu-sync` 推飞书 bot（提前 1 天 + 1 小时两档）。
- **工作量**：小-中（1-2 天）　**风险**：低

### P1-8　所有业务 store 补 persist 版本化　`命中 2/7（架构+TS）`
- **涉及**：`src/store/interview-store.ts:49`（无 version/migrate）、`repush-store.ts`、`ui`/`pref` store
- **问题**：interview 等 store 无迁移路径，字段一变老 localStorage 静默用旧结构或丢数据（项目已因迁移丢过数据）。`jd-store` migrate 用 `as unknown as JDStore` 双重断言绕过字段检查。
- **改法**：抽 `createPersistedStore` 工厂封装 version+migrate 骨架，全 store 对齐；migrate 返回类型改 `Partial<JDStore>`。
- **工作量**：小（1 天）　**风险**：低

### P1-9　repush 未同步字段并入同步载荷　`命中 1/7（架构）`
- **涉及**：`src/store/repush-store.ts:58-59`、`SyncProvider.tsx:141`
- **问题**：只同步了 `items`，`columnNames`（推荐人名字）和 `unfeedbackSnapshots` 只存本地——A 改了推荐人名 B 端看到旧名。
- **改法**：并入 repush 同步载荷，或明确标注"仅本机偏好"。
- **工作量**：小（0.5 天）　**风险**：低

---

## P2 — 中优先（可维护性 / 重构 / 清理 / 加固）

### P2-1　拆分超大文件　`命中 3/7`
- `src/components/jd-library/JDLibraryPage.tsx`（990 行）→ 拆出 `ImportDiffDialog.tsx`、`WeeklyAddedDialog.tsx`，粘贴识别函数移到 `lib/jd-paste-parse.ts`。（1 天，低风险）
- `src/store/jd-store.ts` 的 `importFromExcel`（266 行）→ 拆 `parseRows`/`enrichWithOld`/`computeDiff`/`applyImport` 纯函数。**先补 replace/merge 单测再拆**。（1.5-2 天，风险最高）
- `src/store/talent-store.ts` 的 `scanResumes`/`importFromFiles`（做 talent 需求时顺手）。

### P2-2　消除重复逻辑（DRY）　`命中 2/7`
- JD 详情预览卡在 JDLibraryPage 内复制两次（`:543-585` 与 `:749-791`）→ 抽 `JdPreviewCard`（历史上正因此出过对齐 bug）。
- `getMondayKey` 在 4 处重复（`jd-store.ts:392,456-464,509-516`、`SyncProvider.tsx:196-199`）→ 移到 `lib/utils.ts`。
- `isMockData` 两处重复（`jd-store.ts:151`、`SyncProvider.tsx:18-21`）→ 抽 `lib/mock-guard.ts`。
- 4 处重复的 Upstash 客户端（`sync.ts`/`kv.ts`/`kv-server.ts`/`api/data`，编码 text/plain vs json 不一致，是"编码损坏"温床）→ 抽 `lib/upstash-client.ts`。
- 日期格式化在 19 个文件手搓 → `utils.ts` 补 `formatMonthDay`/`formatISODate`。
- 广告文案生成逻辑跨 `HotHiringPage`/`WeeklyAddedDialog` 重复 → 抽 `useAdCopyBuilder`。
- **合计工作量**：中（2-3 天，可渐进）　**风险**：低（机械重构）

### P2-3　死代码与仓库卫生清理　`命中 1/7`
- **根目录不属于本项目的文件**（有风险，建议移出/停止 git 追踪）：`deploy_loan.py`、`geo/` 目录、`yifangpinpin-web` 软链接（`git rm --cached`）。
- **一次性临时脚本**（确认后删/移 `scripts/archive/`）：`_blob-audit.mjs`、`_blob-debug.mjs`、`_blob-orphans*.json`、`_delete-orphans.mjs`、`_verify-orphans.mjs`、`read_sheet.mjs`（含敏感密钥文件路径）、`read_xlsx.mjs`、`jds.json`(1.2MB，先确认非抢救备份)。
- **旧阿里云部署残留**（确认阿里云下线后删）：`deploy.sh`、`server-setup.sh`、`ecosystem.config.js`。
- **未用组件**：`src/components/ui/AnimatedOrbs.tsx`（真未用，可删）；`StatusBadge.tsx` 是 knip 误报勿删。
- **收紧可见性**：`jd-parse-core.ts` 里 18 个 `XXX_KEYS` + 多个内部函数去掉多余 `export`。
- `.gitignore` 补 `tsconfig.tsbuildinfo`。
- **工作量**：小（0.5-1 天）　**风险**：低（但逐项确认，勿批量删 53 个未用导出——多是 API route 动态引用误报）

### P2-4　依赖清理　`命中 1/7`
- **可移除**（`src/` 零引用）：`zod`、`react-hook-form`、`@hookform/resolvers`、`@radix-ui/react-{dialog,dropdown-menu,select,tabs}`、`@vercel/kv`（已改直连；`@vercel/blob` 仍用勿删）。
- **勿删误报**：`cross-env`（build 脚本用）、`postcss`（Tailwind 链）、`input`/`telegram`（TG 脚本用）。
- **补声明**：`postcss-load-config` 加入 devDependencies。
- 顺序：删 → `npm install` → `npx next build` 验证 → 通过再评估 `@types/react-dom`。
- **工作量**：小（0.5 天）　**风险**：低（有 build 兜底）

### P2-5　xlsx CVE + Next 补丁 + 安全头　`命中 1/7（安全）`
- `xlsx@0.18.5` 有原型污染+ReDoS CVE 且 npm 无修复版 → 从 SheetJS CDN 装 `xlsx-0.20.2.tgz`，或统一用已有的 `exceljs`。（内部小范围用，风险可接受但记待办）
- `next@14.2.35` 落后补丁 → 升到 14.2.x 最新（勿跳 15）。
- `next.config.mjs` 加 `experimental.optimizePackageImports: ['lucide-react','recharts']` + 基础安全头（`X-Frame-Options: DENY`、`nosniff`、简单 CSP）。
- **工作量**：小（0.5 天）　**风险**：低-中（xlsx 换源需回归导入功能）

### P2-6　次要产品改进
- 简历 Blob 改 `access:'private'` + 签名 URL，或至少 URL 路径不含候选人姓名（PII+《个保法》合规）。（中，下季度排期）
- "推荐中心"与"本周推荐"合并为一个"推荐管理"页（日/周 tab），消除职责重叠。（中）
- 推荐人从硬编码 `a|b` 两人改为 `owners: Owner[]` 配置（现在动比以后便宜）。（中）
- 每日自动 KV 快照 `recruit:snapshot:YYYY-MM-DD` 保留 7 天 + 按天回滚。（小-中）
- 静默 catch 补日志：`backupToKV`（`jd-store.ts:175`）、`pushImportDiff/pushWeeklyAdded`（`jd-store.ts:404-405`）、`deepseek.ts` fallback。（小）
- `ScoreRadarChart` 改 `next/dynamic` 懒加载。（小）

---

## 建议执行批次

- **批次 A（本周，安全阻断，~2 天）**：P0-1 第1步轮换 token + P0-1b + P0-2。纯加固，不改业务，风险最低收益最高。
- **批次 B（快赢性能，~1.5 天）**：P0-3 + P0-4 步骤1/2 + P2-5 config + P2-6 懒加载。用户立即可感知不卡了。
- **批次 C（数据可靠性，~4 天）**：P0-1 剩余步骤 + P1-2/3/4/8/9。根治丢数据/覆盖类隐患。
- **批次 D（产品升级，~1-2 周）**：P1-1（简历贯通，先做）→ P1-5/6/7。把系统从"三个记事本"升级为真正的 ATS。
- **批次 E（清理重构，穿插空档）**：P0-4 步骤3 虚拟化 + P2-1/2/3/4。

> 交叉验证说明：KV token 暴露被 架构/可维护/TS/性能/安全 5 个维度独立点名，selector 重渲染被 性能/TS/架构 3 个点名，超大文件被 可维护/性能/架构 3 个点名——重合度越高越应先做。
