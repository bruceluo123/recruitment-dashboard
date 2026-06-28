# 企鹅求职岛 — 猎头JD岗位AI匹配系统

## 项目概述
Web 应用，猎头使用：管理 JD 岗位库 → AI 解析简历匹配岗位 → 面试流程看板。支持多人协同，数据通过 Upstash KV 实时同步。

- **线上地址**: https://qieqiuzhidao.vercel.app
- **GitHub**: https://github.com/bruceluo123/recruitment-dashboard
- **部署方式**: Vercel 自动部署（push to master → auto deploy）
- **数据库**: Upstash KV (Redis 兼容) — `positive-mongrel-70521.upstash.io`

## 技术栈
- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS 3 + Radix UI + Lucide React 图标
- Zustand（状态管理，带 persist 中间件存 localStorage）
- Recharts（雷达图）+ xlsx（Excel 解析）
- DeepSeek API（AI 匹配/解析，通过 `/api/match` 代理）
- Vercel 部署 + Upstash KV 数据同步

## 目录结构
```
src/
├── app/
│   ├── layout.tsx              # 根布局（侧边栏+顶栏+SyncProvider）
│   ├── page.tsx                # 仪表盘
│   ├── jd-library/page.tsx     # JD 库
│   ├── resume-matching/page.tsx # 简历匹配
│   ├── interview-calendar/page.tsx # 面试日历
│   ├── api/data/route.ts       # KV 数据 CRUD API
│   ├── api/match/route.ts      # DeepSeek API 代理
│   └── api/resume/parse/route.ts # 简历文件解析
├── components/
│   ├── jd-library/             # JD 库相关组件
│   │   ├── JDLibraryPage.tsx   # 主页面（含添加/导入/导出）
│   │   ├── JDCategoryTabs.tsx  # 分类标签（多排自动换行）
│   │   ├── JDSearchBar.tsx     # 搜索栏
│   │   ├── JDTable.tsx         # 表格
│   │   ├── JDDetailPanel.tsx   # 详情侧滑面板（编辑/复制/下载/AI分析）
│   │   └── JDImportDialog.tsx  # 导入弹窗（Excel/Google Sheets）
│   ├── resume-matching/
│   │   ├── ResumeMatchingPage.tsx  # 主页面（含分类筛选）
│   │   ├── ResumeUploader.tsx     # 上传区
│   │   ├── MatchingResultsList.tsx # 结果列表
│   │   ├── MatchingResultCard.tsx  # 匹配卡片（AI分析/原文JD切换）
│   │   └── ScoreRadarChart.tsx     # 雷达图
│   ├── interview-calendar/
│   │   ├── InterviewCalendarPage.tsx # 主页面（3列看板+面试提醒）
│   │   ├── StageKanbanBoard.tsx     # 看板
│   │   ├── StageKanbanColumn.tsx    # 阶段列
│   │   └── StageKanbanCard.tsx      # 候选人卡片
│   └── layout/
│       ├── Sidebar.tsx           # 侧边栏导航
│       ├── TopNav.tsx            # 顶栏
│       └── SyncProvider.tsx      # 多用户数据同步（直连KV）
├── store/
│   ├── jd-store.ts              # JD 状态（Zustand persist v3）
│   ├── resume-store.ts          # 简历+匹配状态
│   └── interview-store.ts       # 面试+候选人状态
├── lib/
│   ├── sync.ts                  # 多用户同步（浏览器直连 Upstash KV）
│   ├── deepseek.ts              # DeepSeek API 客户端
│   ├── matching-prompt.ts       # 匹配提示词模板
│   ├── jd-parser.ts             # AI 长文本 JD 解析
│   ├── kv.ts                    # KV 操作工具
│   └── utils.ts                 # cn(), formatSalary(), formatDate()
├── types/
│   ├── jd.ts                    # JD 类型（21个分类+3种状态）
│   ├── resume.ts                # 简历类型
│   ├── matching.ts              # 匹配结果类型
│   └── interview.ts             # 面试类型（3阶段: 一面/二面/Offer）
└── data/
    └── mock-jds.ts              # 示例数据（18个）
```

## 核心数据模型

### JD 岗位 (types/jd.ts)
```typescript
interface JD {
  id: string;
  title: string;
  department: string;
  categories: JDCategory[];       // 多分类支持，如 ["AI", "product"]
  responsibilities: string[];
  requirements: string[];
  salaryRange: { min: number; max: number; currency: string };
  salaryText?: string;            // 自由文本薪资，如 "面议"、"15K-25K+绩效"
  location: string;               // 默认 "remote"
  status: 'active' | 'urgent' | 'paused'; // 活跃/急招/暂缓
}
```

**21 个分类**: 前端/运维/行政/广告/游戏/后端/运营/产品/设计/财务/算法/客服/项目/AI/测试/HR/BD/SEO/总监级/数据/硬件

### Candidate (types/interview.ts)
```typescript
type CandidateStatus = 'interview-1' | 'interview-2' | 'offer'; // 一面/二面/Offer
interface Candidate {
  id: string; name: string; jdTitle: string;
  stage: CandidateStatus; score: number;
  interviewDate?: string; interviewer?: string;
  salary?: string; onboardDate?: string;
  notes?: string; contactEmail?: string;
}
```

## 关键设计决策

1. **数据流**: Zustand persist (localStorage) ↔ Upstash KV。浏览器直连 KV 同步（不经过 Vercel API），10秒轮询，版本号防冲突。

2. **Mock 数据保护**: SyncProvider 检测 mock 数据（ID 以 `jd-00` 开头）绝不推送到 KV。

3. **状态迁移**: JD 从 `isActive: boolean` → `status: 'active'|'urgent'|'paused'`，`category: string` → `categories: string[]`。Persist middleware 版本 v3 自动迁移。

4. **导入流程**: Excel 解析 → 自动检测列名（标题/薪资/部门/地点）→ 长文本(>200字)走 AI 解析 → 短文本走列解析 → 自动分类。

5. **AI 匹配**: 简历上传后在分类范围（可多选）内匹配，单次 API 调用批量评估，返回前 10 匹配。

6. **部署**: Vercel + Upstash KV。`qieqiuzhidao.vercel.app` 为生产域名（通过 `vercel domains` 绑定）。`vercel deploy --prod --yes` 自动更新。

## 已知问题

1. **Vercel 国内访问**: 从中国访问 Vercel 域名不稳定/超时。代码已改为浏览器直连 KV，但部署仍需 Vercel。
2. **数据恢复**: 之前多次迁移导致用户 localStorage 数据丢失。KV 中有 33 条可恢复数据但存在编码损坏。
3. **导入识别**: AI 解析依赖 DeepSeek API，网络不稳定时降级为列解析。

## Session 日志

> 每次长任务结束后，Claude 必须在此追加一条记录（100字内）。
> 格式：`- [日期] 做了什么 | 卡点 | 下一步`

<!-- SESSION_LOG_START -->
- [2026-06-21] 人才库全字段对齐飞书31列（Tier3补全）；修复增量更新数据丢失bug；浏览器端「导出飞书格式」xlsx按钮；KV→飞书多维表格写入脚本（lark-cli base +record-batch-create）；桥接脚本resume上传失败改为warn不中断 | Vercel国内访问不通导致简历文件无法上传，xhs-explore skill脚本未安装无法抓小红书 | 下次：xhs skill安装；飞书多维表去重更新逻辑
- [2026-06-21] 安装 agent-reach v1.5.0，配通 10/13 平台（YouTube/GitHub/Twitter/小红书/Reddit/B站/V2EX/RSS/网页/小宇宙）；Twitter cookie + Groq key 已配；OpenCLI v1.8.4 更新并接通；LinkedIn 改用 Exa 替代；CLAUDE.md 新增 Session 日志和代码规范快查节 | LinkedIn Chromium 太重装失败 | 下次：LinkedIn 有需要再考虑其他方案
- [2026-06-22] 自媒体工作站 A/B/C 全完成：A→sync.ts env-var 驱动+.env.example；B→/api/inspire 代理 aihot+BriefList 接真数据+灵感库全页；C→/api/factory/image(DashScope wanx)+素材工厂5维度UI(参照baoyu-cover-image/baoyu-xhs-images) | Set迭代 tsconfig 兼容性报错两处已修 | 下次：部署Vercel配DASHSCOPE_API_KEY；知识库接入板块
- [2026-06-24] 面板新格式适配（序列列自动检测）；今日增改显示编制/部门替代REQ码；JD备注说明字段全链路（面板粘贴→列解析→详情展示→diff检测）；人才库「批量充实档案」功能（上传PDF→AI提取技能/学历/经历→按姓名回填）；Gemini OCR从inline_data改用Files API解决大PDF 503问题 | Gemini Files API已上线待用户重新测试 | 下次：验证Aaron1.pdf能否正常识别
- [2026-06-28] 知识库文件夹中文化完成（maps→知识枢纽/sources→素材摘录等7个）；.wiki-schema.md路径规范同步更新；生成工作站知识库接入说明.md交接文档；建立X推文入库流程（baoyu-danger-x-to-markdown+x_cookies.json复用，无需每次Chrome登录）；第一条推文入库（马斯克原理9件思维工具） | X cookie首次未命中需写入固定路径才生效 | 下次：知识库接入工作站board；更多推文入库
- [2026-06-28] JD分类内容感知重构：detectCategories仅看标题→新增classifyJD(标题+职责+要求综合判定)，标题能归类的不变、标题无信号时用正文最强信号，根治"一律掉进运营兜底"；扩充关键词(效能官/智能体→ai、人事/SSC/绩效→hr、签证/移民→行政、演武→培训、cuda/微架构→硬件、商服→bd、pjm→项目、内容策略→content)；接入导入两条路径(rowToColumnJD+AI路径)；新增store.reclassifyAll()+JD库工具栏「重新分类」按钮(确认+汇总)。线上507条模拟仅36条变更全为修正(效能官→AI、人事/SSC→HR×8、签证→行政等) | 重分类只改本地store，需手动「备份到云端」同步KV | 下次：用户点重新分类后核对效果、备份云端
<!-- SESSION_LOG_END -->

## 代码规范快查

> 新功能开发前必读，避免 agent 重新推断约定。

- **数据修改**：必须通过 Zustand store，禁止直接操作 localStorage
- **新增分类**：同步更新 3 处 → `types/jd.ts`(JDCategory) + `jd-store.ts`(CATEGORY_KEYWORDS) + `JDCategoryTabs.tsx`(CAT_TAB_COLORS)
- **新增 JD 字段**：同步更新 `SyncProvider.tsx` 数据规范化逻辑
- **薪资**：优先用 `salaryText`（自由文本），`salaryRange` 做结构化备用
- **ID 规则**：mock 数据 ID 以 `jd-00` 开头，KV 同步时会自动跳过
- **AI 解析阈值**：JD 正文 > 200 字走 DeepSeek，≤ 200 字走列解析
- **环境变量**：KV tokens 只在 Vercel 项目设置中，不写代码里
- **部署**：push master 自动触发，无需手动 deploy

## 常用命令

```bash
cd "D:\wiki\个人知识库\projects\recruitment-dashboard"
npm run dev                # 本地开发 (localhost:3001)
npx next build             # 构建检查
npx vercel deploy --prod --yes  # 部署到生产环境
```

## 给 Codex 的提示

- 所有数据修改必须通过 Zustand store，不要直接操作 localStorage
- 添加新分类需同时更新: types/jd.ts (JDCategory)、CATEGORY_KEYWORDS (jd-store.ts)、CAT_TAB_COLORS (JDCategoryTabs.tsx)
- SyncProvider.tsx 中的数据规范化逻辑很重要，新增字段需同步更新
- /api/data 和 /api/match 是服务端路由，在生产环境通过 Vercel Serverless 运行
- 环境变量 (KV tokens) 在 Vercel 项目设置中配置，不在代码中
