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

5. **AI 匹配**: 简历上传后在分类范围（可多选）内匹配，单次 API 调用批量评估，返回前 5 匹配。

6. **部署**: Vercel + Upstash KV。`qieqiuzhidao.vercel.app` 为生产域名（通过 `vercel domains` 绑定）。`vercel deploy --prod --yes` 自动更新。

## 已知问题

1. **Vercel 国内访问**: 从中国访问 Vercel 域名不稳定/超时。代码已改为浏览器直连 KV，但部署仍需 Vercel。
2. **数据恢复**: 之前多次迁移导致用户 localStorage 数据丢失。KV 中有 33 条可恢复数据但存在编码损坏。
3. **导入识别**: AI 解析依赖 DeepSeek API，网络不稳定时降级为列解析。

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
