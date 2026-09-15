import type { JD, JDCategory } from '@/types/jd';

export type ProfileTagDimension =
  | 'level'
  | 'stack'
  | 'platform'
  | 'specialty'
  | 'scenario'
  | 'operations'
  | 'product'
  | 'design'
  | 'business'
  | 'data-ai'
  | 'hardware'
  | 'creative';

export const TAG_TAXONOMY_VERSION = '2026-09-09.2';
export const TAG_EXTRACTOR_VERSION = '4';

export interface ProfileTagEvidence {
  source: string;
  quality: 'fact' | 'derived' | 'routing';
  snippet: string;
}

export interface ProfileTag {
  id: string;
  label: string;
  dimension: ProfileTagDimension;
  family?: string;
  score: number;
  required: boolean;
  evidence: ProfileTagEvidence[];
}

export interface TagProfile {
  fingerprint: string;
  tags: ProfileTag[];
  requiredAnyGroups?: Array<{
    id: string;
    tagIds: string[];
    labels: string[];
    evidence: string;
  }>;
}

export interface CandidateTagSource {
  currentJob: string;
  highlights: string;
  resumeText: string;
}

export interface TagComparison {
  score: number;
  matched: ProfileTag[];
  tentative: ProfileTag[];
  missingRequired: ProfileTag[];
}

interface TagDefinition {
  id: string;
  label: string;
  dimension: ProfileTagDimension;
  aliases: string[];
  family?: string;
  excludeAliases?: string[];
  jdCategories?: JDCategory[];
  descriptionEvidenceOnly?: boolean;
  patterns?: RegExp[];
}

const OPS_CATEGORIES: JDCategory[] = [
  'operations', 'product', 'marketing', 'advertising', 'bd', 'seo', 'live', 'content', 'customer-service',
];

const PRODUCT_CATEGORIES: JDCategory[] = ['product'];
const DESIGN_CATEGORIES: JDCategory[] = ['design', 'art'];
const BUSINESS_CATEGORIES: JDCategory[] = [
  'administration', 'finance', 'customer-service', 'project', 'hr', 'bd', 'director', 'marketing', 'legal', 'training',
];
const DATA_AI_CATEGORIES: JDCategory[] = ['algorithm', 'ai', 'data'];
const HARDWARE_CATEGORIES: JDCategory[] = ['hardware'];
const CREATIVE_CATEGORIES: JDCategory[] = ['gaming', 'video', 'live', 'content', 'design', 'art'];

const DEFINITIONS: TagDefinition[] = [
  { id: 'level:manager', label: '团队管理', dimension: 'level', aliases: ['管理团队', '团队管理', '人员管理', '团队搭建', '绩效管理', '招聘培养', '带领团队', '带队'], patterns: [/(?:管理|带领|带教|搭建).{0,45}(?:\d+\s*\+?\s*人|团队|team)/i, /(?:managed|led|built).{0,35}(?:team|moderators|employees)/i], descriptionEvidenceOnly: true },
  { id: 'level:architect', label: '架构决策', dimension: 'level', aliases: ['架构师', '架构治理', '架构演进', '架构设计', '系统架构', '技术选型'], descriptionEvidenceOnly: true },

  { id: 'stack:go', label: 'Go', dimension: 'stack', aliases: ['golang', 'go'] },
  { id: 'stack:java', label: 'Java', dimension: 'stack', aliases: ['java', 'spring boot', 'spring cloud'] },
  { id: 'stack:php', label: 'PHP', dimension: 'stack', aliases: ['php', 'laravel'] },
  { id: 'stack:python', label: 'Python', dimension: 'stack', aliases: ['python', 'django', 'fastapi', 'flask'] },
  { id: 'stack:node', label: 'Node.js', dimension: 'stack', aliases: ['node.js', 'nodejs', 'nestjs'] },
  { id: 'stack:cpp', label: 'C/C++', dimension: 'stack', aliases: ['c++', 'cplusplus', 'cpp'] },
  { id: 'stack:csharp', label: 'C#', dimension: 'stack', aliases: ['c#', '.net', 'dotnet'] },
  { id: 'stack:rust', label: 'Rust', dimension: 'stack', aliases: ['rust'] },
  { id: 'stack:typescript', label: 'TypeScript', dimension: 'stack', aliases: ['typescript', 'ts'] },
  { id: 'stack:react', label: 'React Web', dimension: 'stack', aliases: ['react.js', 'reactjs', 'react'], family: 'react', excludeAliases: ['react native'] },
  { id: 'stack:react-native', label: 'React Native', dimension: 'stack', aliases: ['react native'], family: 'react' },
  { id: 'stack:vue', label: 'Vue', dimension: 'stack', aliases: ['vue.js', 'vuejs', 'vue'], family: 'vue' },
  { id: 'stack:vue3', label: 'Vue3', dimension: 'stack', aliases: ['vue3', 'vue 3'], family: 'vue' },
  { id: 'stack:next', label: 'Next.js', dimension: 'stack', aliases: ['next.js', 'nextjs'] },
  { id: 'stack:nuxt', label: 'Nuxt', dimension: 'stack', aliases: ['nuxt.js', 'nuxtjs', 'nuxt'] },
  { id: 'stack:flutter', label: 'Flutter', dimension: 'stack', aliases: ['flutter'] },
  { id: 'stack:dart', label: 'Dart', dimension: 'stack', aliases: ['dart'] },
  { id: 'stack:swift', label: 'Swift', dimension: 'stack', aliases: ['swift', 'swiftui'] },
  { id: 'stack:kotlin', label: 'Kotlin', dimension: 'stack', aliases: ['kotlin'] },
  { id: 'stack:mysql', label: 'MySQL', dimension: 'stack', aliases: ['mysql'] },
  { id: 'stack:postgresql', label: 'PostgreSQL', dimension: 'stack', aliases: ['postgresql', 'postgres'] },
  { id: 'stack:redis', label: 'Redis', dimension: 'stack', aliases: ['redis'] },
  { id: 'stack:kafka', label: 'Kafka', dimension: 'stack', aliases: ['kafka'] },
  { id: 'stack:elasticsearch', label: 'Elasticsearch', dimension: 'stack', aliases: ['elasticsearch', 'elastic search'] },
  { id: 'stack:kubernetes', label: 'Kubernetes', dimension: 'stack', aliases: ['kubernetes', 'k8s'] },
  { id: 'stack:docker', label: 'Docker', dimension: 'stack', aliases: ['docker'] },
  { id: 'stack:pytorch', label: 'PyTorch', dimension: 'stack', aliases: ['pytorch'] },
  { id: 'stack:sql', label: 'SQL', dimension: 'stack', aliases: ['sql'] },

  { id: 'platform:web', label: 'Web', dimension: 'platform', aliases: ['web', '网页', '网站', 'h5'] },
  { id: 'platform:mobile', label: '移动端', dimension: 'platform', aliases: ['移动端', '移动应用', 'mobile app', 'app开发'] },
  { id: 'platform:ios', label: 'iOS原生', dimension: 'platform', aliases: ['ios原生', 'ios', 'swift'] },
  { id: 'platform:android', label: 'Android原生', dimension: 'platform', aliases: ['android原生', 'android', 'kotlin'] },
  { id: 'platform:cross-platform', label: '跨端', dimension: 'platform', aliases: ['跨端', '跨平台', 'flutter'] },
  { id: 'platform:desktop', label: '桌面客户端', dimension: 'platform', aliases: ['桌面客户端', '桌面应用', 'windows客户端', 'desktop app', 'avalonia'] },

  { id: 'specialty:ssr', label: 'SSR/同构渲染', dimension: 'specialty', aliases: ['ssr', '服务端渲染', '同构渲染'] },
  { id: 'specialty:seo', label: 'SEO', dimension: 'specialty', aliases: ['seo', '搜索引擎优化'] },
  { id: 'specialty:ssg', label: 'SSG', dimension: 'specialty', aliases: ['ssg', '静态生成'] },
  { id: 'specialty:seo-engineering', label: '前端SEO工程', dimension: 'specialty', aliases: ['页面可索引', '前端seo', '技术seo', 'sitemap', 'robots.txt', 'canonical', 'tdk', '结构化数据'] },
  { id: 'specialty:web-vitals', label: 'Web性能指标', dimension: 'specialty', aliases: ['core web vitals', 'fcp', 'lcp', 'cls', 'ttfb'] },
  { id: 'specialty:streaming', label: '流媒体', dimension: 'specialty', aliases: ['流媒体', '播放链路', '音视频传输', 'hls', 'flv'] },
  { id: 'specialty:rtc', label: '实时音视频', dimension: 'specialty', aliases: ['webrtc', 'rtc', '实时音视频'] },
  { id: 'specialty:player', label: '播放器', dimension: 'specialty', aliases: ['播放器内核', '播放器', '播放性能', '解码'] },
  { id: 'specialty:cdn', label: 'CDN', dimension: 'specialty', aliases: ['cdn', '内容分发网络'] },
  { id: 'specialty:weak-network', label: '弱网优化', dimension: 'specialty', aliases: ['弱网', '网络抖动', '卡顿优化'] },
  { id: 'specialty:high-concurrency', label: '高并发', dimension: 'specialty', aliases: ['高并发', '百万并发', '大并发'] },
  { id: 'specialty:distributed', label: '分布式', dimension: 'specialty', aliases: ['分布式', 'distributed system'] },
  { id: 'specialty:microservices', label: '微服务', dimension: 'specialty', aliases: ['微服务', 'microservice'] },
  { id: 'specialty:cloud-native', label: '云原生', dimension: 'specialty', aliases: ['云原生', 'cloud native'] },
  { id: 'specialty:performance', label: '性能优化', dimension: 'specialty', aliases: ['性能优化', '性能调优', '性能治理'] },
  { id: 'specialty:stability', label: '稳定性治理', dimension: 'specialty', aliases: ['稳定性', '高可用', '容灾', '故障治理'] },
  { id: 'specialty:security', label: '安全工程', dimension: 'specialty', aliases: ['安全工程', '安全漏洞', '攻防', '渗透测试'] },
  { id: 'specialty:code-audit', label: '代码审计', dimension: 'specialty', aliases: ['代码审计', 'code audit', '代码安全审查'] },
  { id: 'specialty:test-automation', label: '自动化测试', dimension: 'specialty', aliases: ['自动化测试', '测试框架', 'selenium', 'playwright', 'appium'] },
  { id: 'specialty:devops', label: 'DevOps/CI·CD', dimension: 'specialty', aliases: ['devops', 'ci/cd', 'cicd', '持续集成', '持续交付'] },
  { id: 'specialty:llm', label: 'LLM应用', dimension: 'specialty', aliases: ['大语言模型', 'llm', '模型接入'] },
  { id: 'specialty:rag', label: 'RAG', dimension: 'specialty', aliases: ['rag', '检索增强生成'] },
  { id: 'specialty:agent', label: 'AI Agent', dimension: 'specialty', aliases: ['ai agent', '智能体', 'agent开发', 'agent架构'] },
  { id: 'specialty:aigc-workflow', label: 'AIGC工作流', dimension: 'specialty', aliases: ['comfyui', 'controlnet', 'lora', 'ipadapter', 'aigc工作流'] },
  { id: 'specialty:ai-creative', label: 'AI视觉/视频生成', dimension: 'specialty', aliases: ['ai生图', 'ai视频制作', 'ai影视制作', '生成式广告素材', 'stable diffusion', 'midjourney', 'seedance', 'kling', 'runway'] },
  { id: 'specialty:data-engineering', label: '数据工程', dimension: 'specialty', aliases: ['数据开发', '数仓', '数据仓库', 'etl', 'spark', 'flink'] },
  { id: 'specialty:ux', label: 'UX/交互设计', dimension: 'specialty', aliases: ['ux', '交互设计', '用户体验设计'] },
  { id: 'specialty:geo', label: 'GEO', dimension: 'specialty', aliases: ['geo', '生成式引擎优化'] },

  { id: 'scenario:live', label: '直播业务', dimension: 'scenario', aliases: ['直播平台', '直播业务', '直播间', '直播互动', '团播'] },
  { id: 'scenario:video', label: '视频内容', dimension: 'scenario', aliases: ['视频内容', '短视频', '视频平台', '视频生产', '视频播放'] },
  { id: 'scenario:pan-entertainment', label: '泛娱乐', dimension: 'scenario', aliases: ['泛娱乐', '娱乐内容', '文娱'] },
  { id: 'scenario:gaming', label: '游戏', dimension: 'scenario', aliases: ['游戏业务', '游戏行业', '手游', '端游', '游戏产品', 'galgame', 'acg'] },
  { id: 'scenario:social', label: '社交/交友', dimension: 'scenario', aliases: ['社交产品', '社交平台', '交友', '社区产品'] },
  { id: 'scenario:ecommerce', label: '电商', dimension: 'scenario', aliases: ['电商', '商城', '交易平台'] },
  { id: 'scenario:payment', label: '支付', dimension: 'scenario', aliases: ['支付系统', '支付平台', '收单', '结算系统'] },
  { id: 'scenario:advertising', label: '广告业务', dimension: 'scenario', aliases: ['广告系统', '广告平台', '广告业务', '广告投放'] },
  { id: 'scenario:adult-content', label: '成人内容', dimension: 'scenario', aliases: ['成人内容', '成人网站', '成人app', '成人业务', '成人平台', '成人娱乐', 'adult content'] },
  { id: 'scenario:web3', label: 'Web3/区块链', dimension: 'scenario', aliases: ['web3', '区块链', '交易所', '数字货币', '加密货币', 'crypto', 'blockchain', 'defi', 'dex', '公链', '链上'] },
  { id: 'scenario:bl', label: 'BL/耽美内容', dimension: 'scenario', aliases: ['bl', '耽美', '腐向'] },

  { id: 'ops:growth', label: '增长运营', dimension: 'operations', aliases: ['用户增长', '增长运营', '流量增长', '供给增长', '拉新', '获客', '裂变增长', '增长策略'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:user', label: '用户运营', dimension: 'operations', aliases: ['用户运营', '用户分层', '用户画像', '用户召回', '用户生命周期', '会员运营', '高价值用户运营', '沉默用户重新激活'], patterns: [/(?:vip|会员|用户).{0,16}(?:分层|留存|召回|重新激活|体系运营)/i], jdCategories: OPS_CATEGORIES },
  { id: 'ops:product', label: '产品运营', dimension: 'operations', aliases: ['产品运营', '功能运营', '产品迭代', '需求分析', '上线运营', '产品规划', '产品经理', '产品专员', '产品能力建设'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:content', label: '内容运营', dimension: 'operations', aliases: ['内容运营', '内容策略', '选题策划', '内容生产', '内容分发', '内容审核', '内容处理', '内容团队'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:community', label: '社群/社区运营', dimension: 'operations', aliases: ['社群运营', '社区运营', 'tg社群', 'telegram社群', 'discord社区'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:live', label: '直播运营', dimension: 'operations', aliases: ['直播运营', '团播运营', '主播运营', '直播主持', '场控'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:channel', label: '渠道运营', dimension: 'operations', aliases: ['渠道运营', '渠道拓展', '渠道合作', '合作渠道', '合作资源', '渠道投放'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:bd', label: '商务拓展', dimension: 'operations', aliases: ['商务拓展', '商务合作', '客户拓展', 'bd经理', 'bd专员', 'bd经验'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:advertising', label: '广告投放', dimension: 'operations', aliases: ['广告投放', '信息流投放', '媒体投放', '买量', 'sem', 'roas', '投手', '广告素材', '广告转化'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:seo', label: 'SEO增长', dimension: 'operations', aliases: ['seo运营', 'seo增长', '搜索增长', '关键词排名', '外链建设'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:brand', label: '品牌运营', dimension: 'operations', aliases: ['品牌运营', '品牌策划', '品牌内容', '品牌传播', '公关传播'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:new-media', label: '新媒体运营', dimension: 'operations', aliases: ['新媒体运营', '社媒运营', '小红书运营', '抖音运营', 'tiktok运营', 'youtube运营'], patterns: [/(?:社交媒体|twitter|tiktok|instagram|youtube|小红书|抖音).{0,35}(?:运营|增长|内容发布)/i], jdCategories: OPS_CATEGORIES },
  { id: 'ops:commercialization', label: '商业化运营', dimension: 'operations', aliases: ['商业化运营', '变现运营', '营收增长', '付费转化'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:customer', label: '客户运营', dimension: 'operations', aliases: ['客户运营', '客户成功', '客户留存', '续费', '客服运营'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:data', label: '数据运营', dimension: 'operations', aliases: ['数据运营', '数据复盘', '运营分析', '指标体系', '转化漏斗'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:business-process', label: '商务流程运营', dimension: 'operations', aliases: ['商务运营', '订单管理', '商务流程', '合同管理', '订单协调'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:project', label: '项目运营', dimension: 'operations', aliases: ['项目管理', '项目经理', '项目排期', '项目计划', 'wbs', '里程碑'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:training', label: '培训运营', dimension: 'operations', aliases: ['培训运营', '组训', '讲师管理', '培训roi', '实战教练'], jdCategories: [...OPS_CATEGORIES, 'training'] },
  { id: 'ops:hr', label: '人事运营', dimension: 'operations', aliases: ['人事运营', '薪酬运营', '人事主管', '人事专员', '人事数据', '花名册', 'hrbp'], jdCategories: [...OPS_CATEGORIES, 'hr'] },
  { id: 'ops:compliance', label: '合规/风控运营', dimension: 'operations', aliases: ['内容安全', '审核流程', '风控策略', '合规运营', '规则引擎'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:sales', label: '销售', dimension: 'operations', aliases: ['销售经验', '销售推进', '客户销售', '销售'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:visa', label: '签证事务', dimension: 'operations', aliases: ['签证执行', '签证办理', '签证材料', '移民事务'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:programmatic-ads', label: '程序化广告', dimension: 'operations', aliases: ['程序化广告', 'dsp', 'ssp', 'rtb', 'pmp', 'ad exchange'], jdCategories: ['advertising'] },
  { id: 'ops:creative-strategy', label: '广告创意策略', dimension: 'operations', aliases: ['广告创意', '创意策略', '素材策略', '创意测试', '广告文案'], jdCategories: ['advertising', 'marketing'] },
  { id: 'ops:seo-content', label: '内容SEO', dimension: 'operations', aliases: ['内容seo', 'seo内容', '站内优化', '关键词布局'], jdCategories: ['seo', 'content'] },
  { id: 'ops:seo-offpage', label: '站外SEO', dimension: 'operations', aliases: ['站外seo', '外链建设', '域名权重', '链接建设'], jdCategories: ['seo'] },
  { id: 'ops:event', label: '活动/事件营销', dimension: 'operations', aliases: ['活动营销', '市场活动', '事件营销', '活动策划', '展会活动'], patterns: [/(?:策划|执行|统筹|举办).{0,35}(?:活动|ama|展会)/i], jdCategories: ['marketing', 'operations'] },
  { id: 'ops:overseas', label: '海外运营', dimension: 'operations', aliases: ['海外运营', '海外市场', '海外用户', '出海业务', '全球化运营', '国际社群', '国际市场', '多语言社群', '本地化运营'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:kol', label: 'KOL/合作伙伴运营', dimension: 'operations', aliases: ['kol孵化', 'kol合作', '合作伙伴运营', 'affiliate'], patterns: [/kol.{0,20}(?:合作|孵化|定位|运营|洽谈)/i], jdCategories: OPS_CATEGORIES },
  { id: 'ops:conversion', label: '充值/会员转化', dimension: 'operations', aliases: ['充值转化', '付费转化', '会员转化', '交易转化', '订阅转化'], patterns: [/(?:注册|kyc).{0,20}充值.{0,20}交易/i], jdCategories: OPS_CATEGORIES },
  { id: 'ops:website', label: '网站/CMS运营', dimension: 'operations', aliases: ['网站运营', 'cms', '栏目维护', '站点运营', '页面配置'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:tg-bot', label: 'TG机器人运营', dimension: 'operations', aliases: ['tg机器人', 'telegram机器人', 'tg bot', 'telegram bot', '搜索机器人'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:domestic-acquisition', label: '国内精准获客', dimension: 'operations', aliases: ['国内精准获客', '国内打色粉', '打色粉'], jdCategories: OPS_CATEGORIES },
  { id: 'ops:domestic-media', label: '国内社媒', dimension: 'operations', aliases: ['国内媒体', '国内社媒', '国内新媒体', '抖音', '小红书', '快手', '视频号'], jdCategories: OPS_CATEGORIES },

  // 产品岗位可同时命中多个方向，例如“AI + 增长 + 社交 + 移动端”。
  { id: 'product:ownership', label: '产品规划', dimension: 'product', aliases: ['产品经理', '产品负责人', '产品专员', '产品规划', '产品路线图', '产品roadmap'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:growth', label: '增长产品', dimension: 'product', aliases: ['增长产品', '用户增长方向', '增长方向', '增长策略', '增长模型', '增长实验', '拉新转化', '留存提升'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:platform', label: '平台产品', dimension: 'product', aliases: ['平台产品', '中台产品', '产品平台', 'pc端平台', '业务中台', '能力中台'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:data-bi', label: '数据/BI产品', dimension: 'product', aliases: ['数据产品', 'bi产品', '商业智能', '指标平台', '数据平台', '数据看板'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:ai', label: 'AI产品', dimension: 'product', aliases: ['ai产品', '人工智能产品', '大模型产品', '智能体产品', 'agent产品', 'aigc产品'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:content-video', label: '内容/视频产品', dimension: 'product', aliases: ['内容产品', '视频产品', '内容视频站', '内容/视频', '内容站', '视频站', '内容生态'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:social', label: '社交产品', dimension: 'product', aliases: ['社交产品', '交友产品', '社交方向', '社交场景', '关系链'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:commercial', label: '商业化产品', dimension: 'product', aliases: ['商业化产品', '变现产品', '广告产品', '定价产品', '产品定价', '计费产品', '营收产品'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:risk', label: '风控/合规产品', dimension: 'product', aliases: ['风控产品', '合规产品', '审核产品', '内容安全产品', '反作弊产品', '风险策略产品'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:mobile', label: '移动端产品', dimension: 'product', aliases: ['移动端产品', 'app产品', '移动产品', 'ios产品', 'android产品'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:b2b', label: 'B端产品', dimension: 'product', aliases: ['b端产品', '企业端产品', '企业服务产品', 'saas产品', '后台产品'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:b2c', label: 'C端产品', dimension: 'product', aliases: ['c端产品', '消费者产品', '用户端产品'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:zero-to-one', label: '0-1产品', dimension: 'product', aliases: ['0-1', '0到1', '从0到1', '零到一', '冷启动'], jdCategories: PRODUCT_CATEGORIES },
  { id: 'product:quality', label: '产品质量/验收', dimension: 'product', aliases: ['产品质检', '产品质量', '产品验收', '需求验收', '质量标准'], jdCategories: PRODUCT_CATEGORIES },

  { id: 'design:ui', label: 'UI设计', dimension: 'design', aliases: ['ui设计', '界面设计', 'ui designer', '设计系统'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:ux', label: 'UX/交互', dimension: 'design', aliases: ['ux设计', '交互设计', '用户体验', '原型设计', '信息架构'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:research', label: '用户研究', dimension: 'design', aliases: ['用户研究', '用户访谈', '可用性测试', 'ux research'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:visual', label: '视觉设计', dimension: 'design', aliases: ['视觉设计', '视觉创意', '视觉规范', '主视觉', '视觉设计师'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:graphic', label: '平面设计', dimension: 'design', aliases: ['平面设计', '海报设计', '排版设计', '宣传物料'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:brand', label: '品牌设计', dimension: 'design', aliases: ['品牌设计', '品牌视觉', 'vi设计', '品牌识别'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:motion', label: '动效设计', dimension: 'design', aliases: ['动效设计', 'motion design', '动态图形', '动画设计'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:3d', label: '3D/建模', dimension: 'design', aliases: ['3d设计', '3d建模', '三维建模', '角色建模', '场景建模', '骨骼绑定'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:game-art', label: '游戏美术', dimension: 'design', aliases: ['游戏美术', '游戏原画', '角色原画', '场景原画', 'ui美术'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:illustration', label: '插画/原画', dimension: 'design', aliases: ['插画师', '插画设计', '原画师', '原画设计'], jdCategories: DESIGN_CATEGORIES },
  { id: 'design:aigc', label: 'AIGC设计', dimension: 'design', aliases: ['ai设计', 'aigc设计', 'ai绘画', 'ai生图', 'midjourney', 'stable diffusion'], jdCategories: DESIGN_CATEGORIES },

  { id: 'business:accounting', label: '会计核算', dimension: 'business', aliases: ['会计核算', '总账会计', '财务会计', '会计准则', '月结', '凭证'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:fpna', label: '财务分析/预算', dimension: 'business', aliases: ['财务分析', '财务预算', '预算管理', '经营分析', 'fp&a', '滚动预测'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:ap-ar', label: '应收/应付', dimension: 'business', aliases: ['应收账款', '应付账款', '应收会计', '应付会计', 'ap会计', 'ar会计'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:tax', label: '税务', dimension: 'business', aliases: ['税务管理', '税务筹划', '纳税申报', '税务合规'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:audit', label: '审计', dimension: 'business', aliases: ['内部审计', '外部审计', '审计项目', '审计报告'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:treasury', label: '资金/结算', dimension: 'business', aliases: ['资金管理', '资金结算', '出纳', '现金流', '银行对账'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:recruiting', label: '招聘', dimension: 'business', aliases: ['招聘专员', '招聘经理', '人才招聘', '招聘渠道', '人才寻访', '招聘交付', '招聘管理'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:compensation', label: '薪酬福利', dimension: 'business', aliases: ['薪酬福利', '薪酬绩效', '薪资核算', '奖金方案', '社保公积金'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:performance', label: '绩效管理', dimension: 'business', aliases: ['绩效管理', '绩效体系', '绩效考核', '绩效校准'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:employee-relations', label: '员工关系', dimension: 'business', aliases: ['员工关系', '劳动关系', '劳动争议', '员工关怀'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:hrbp', label: 'HRBP', dimension: 'business', aliases: ['hrbp', '人力业务伙伴', '业务部门人力'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:od', label: '组织发展', dimension: 'business', aliases: ['组织发展', '组织诊断', '人才盘点', '干部管理', '继任计划'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:administration', label: '行政事务', dimension: 'business', aliases: ['行政专员', '行政主管', '行政管理', '办公室管理', '日常行政'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:assistant', label: '高管助理', dimension: 'business', aliases: ['总裁助理', '高管助理', '董事长助理', 'ceo助理', '行程管理'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:personal-assistant', label: '生活/事务助理', dimension: 'business', aliases: ['生活助理', '事务助理', '个人助理', '私人助理'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:procurement', label: '采购/供应商', dimension: 'business', aliases: ['采购管理', '采购专员', '供应商管理', '询价比价', '物资采购'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:visa', label: '签证/移民事务', dimension: 'business', aliases: ['签证办理', '签证材料', '移民事务', '工作许可'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:legal-contract', label: '合同法务', dimension: 'business', aliases: ['合同审查', '合同审核', '合同起草', '合同谈判', '法务合同'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:legal-privacy', label: '隐私/数据合规', dimension: 'business', aliases: ['隐私合规', '数据合规', '个人信息保护', 'gdpr', '数据出境'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:legal-ip', label: '知识产权', dimension: 'business', aliases: ['知识产权', '商标', '专利', '著作权', '版权保护'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:legal-dispute', label: '争议解决', dimension: 'business', aliases: ['争议解决', '诉讼', '仲裁', '纠纷处理'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:pmo', label: 'PMO/项目治理', dimension: 'business', aliases: ['pmo', '项目治理', '项目组合', '项目管理办公室', '项目经理'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:project-assistant', label: '项目协调', dimension: 'business', aliases: ['项目助理', '项目协调', '项目跟进', '会议纪要'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:delivery', label: '项目交付', dimension: 'business', aliases: ['项目交付', '交付管理', '交付经理', '实施交付', '验收交付'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:agile', label: '敏捷项目', dimension: 'business', aliases: ['敏捷项目', '敏捷开发', 'scrum', '迭代管理', 'sprint'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:project-control', label: '进度/风险/预算', dimension: 'business', aliases: ['进度管理', '风险管理', '项目预算', '成本控制', 'wbs', '里程碑'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:customer-support', label: '客户支持', dimension: 'business', aliases: ['客户支持', '客户服务', '客服专员', '在线客服', '售后服务'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:complaint', label: '投诉/升级处理', dimension: 'business', aliases: ['客诉处理', '投诉处理', '升级处理', '舆情处理'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:training-course', label: '课程开发', dimension: 'business', aliases: ['课程开发', '课程设计', '课件开发', '培训课程', '课程体系'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:trainer', label: '讲师/授课', dimension: 'business', aliases: ['培训讲师', '企业讲师', '授课', '内训师', '培训师'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:sop', label: 'SOP/流程培训', dimension: 'business', aliases: ['sop工程化', 'sop设计', '标准作业流程', '流程标准化', '流程培训'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:market-research', label: '市场研究', dimension: 'business', aliases: ['市场研究', '市场调研', '竞品分析', '行业研究', '消费者洞察'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:pr', label: '公关传播', dimension: 'business', aliases: ['公共关系', '媒体关系', '公关传播', '危机公关', '新闻稿'], jdCategories: BUSINESS_CATEGORIES },
  { id: 'business:strategy', label: '经营/组织战略', dimension: 'business', aliases: ['公司战略', '经营战略', '业务战略', '组织战略', '战略规划', '经营管理'], jdCategories: BUSINESS_CATEGORIES },

  { id: 'data-ai:analytics', label: '数据分析/BI', dimension: 'data-ai', aliases: ['数据分析', '商业分析', 'bi分析', '商业智能', '数据洞察', '报表分析'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:warehouse', label: '数仓/ETL', dimension: 'data-ai', aliases: ['数据仓库', '数仓', 'etl', '数据建模', '离线数仓', '实时数仓'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:governance', label: '数据治理', dimension: 'data-ai', aliases: ['数据治理', '数据质量', '元数据', '主数据', '数据标准'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:recommendation', label: '推荐/搜索算法', dimension: 'data-ai', aliases: ['推荐算法', '搜索算法', '推荐系统', '排序算法', '召回算法'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:nlp', label: 'NLP', dimension: 'data-ai', aliases: ['自然语言处理', 'nlp', '文本分类', '信息抽取'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:cv', label: '计算机视觉', dimension: 'data-ai', aliases: ['计算机视觉', 'computer vision', 'cv算法', '图像识别', '目标检测'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:machine-learning', label: '机器学习', dimension: 'data-ai', aliases: ['机器学习', '深度学习', '模型训练', '特征工程'], jdCategories: DATA_AI_CATEGORIES },
  { id: 'data-ai:llm', label: '大模型算法', dimension: 'data-ai', aliases: ['大模型算法', '大语言模型', 'llm', '模型微调', '预训练模型'], jdCategories: DATA_AI_CATEGORIES },

  { id: 'hardware:embedded', label: '嵌入式开发', dimension: 'hardware', aliases: ['嵌入式开发', '嵌入式系统', '单片机', 'mcu', 'arm cortex'], jdCategories: HARDWARE_CATEGORIES },
  { id: 'hardware:firmware', label: '固件/RTOS', dimension: 'hardware', aliases: ['固件开发', 'firmware', 'freertos', 'rtos', 'zephyr'], jdCategories: HARDWARE_CATEGORIES },
  { id: 'hardware:fpga', label: 'FPGA/数字设计', dimension: 'hardware', aliases: ['fpga', 'verilog', 'systemverilog', 'vhdl', '数字电路'], jdCategories: HARDWARE_CATEGORIES },
  { id: 'hardware:electronics', label: '电子/PCB', dimension: 'hardware', aliases: ['pcb设计', '硬件设计', '电路设计', '原理图', '电子工程师'], jdCategories: HARDWARE_CATEGORIES },
  { id: 'hardware:driver', label: '驱动/BSP', dimension: 'hardware', aliases: ['驱动开发', 'linux驱动', 'bsp', '设备树', '内核模块'], jdCategories: HARDWARE_CATEGORIES },
  { id: 'hardware:iot', label: 'IoT/物联网', dimension: 'hardware', aliases: ['物联网', 'iot', 'mqtt', '设备接入', '边缘设备'], jdCategories: HARDWARE_CATEGORIES },

  { id: 'creative:content-strategy', label: '内容策划', dimension: 'creative', aliases: ['内容策划', '选题策划', '内容策略', '内容规划', '栏目策划'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:copywriting', label: '文案/编辑', dimension: 'creative', aliases: ['文案策划', '内容编辑', '文字编辑', '文案撰写', '编辑岗位', '编剧'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:script', label: '脚本/剧本', dimension: 'creative', aliases: ['脚本创作', '脚本策划', '剧本创作', '剧本审核', '短剧编剧'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:shooting', label: '拍摄/摄像', dimension: 'creative', aliases: ['视频拍摄', '摄像师', '摄影师', '现场拍摄', '镜头语言'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:editing', label: '视频剪辑', dimension: 'creative', aliases: ['视频剪辑', '剪辑师', '后期剪辑', 'premiere', 'final cut', 'davinci resolve'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:post-production', label: '后期/特效', dimension: 'creative', aliases: ['视频后期', '影视后期', '后期制作', '视觉特效', 'after effects'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:directing', label: '导演/制片', dimension: 'creative', aliases: ['视频导演', '短剧导演', '制片人', '现场导演', '导演经验'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:short-drama', label: '短剧内容', dimension: 'creative', aliases: ['短剧', '微短剧', '短剧内容', '网剧'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:livestream-host', label: '主播/主持', dimension: 'creative', aliases: ['直播主播', '主播经验', '直播主持', '主持人'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:game-system', label: '游戏系统策划', dimension: 'creative', aliases: ['系统策划', '游戏系统', '玩法系统', '功能策划'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:game-level', label: '关卡策划', dimension: 'creative', aliases: ['关卡策划', '关卡设计', '战斗关卡', '副本设计'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:game-economy', label: '数值/经济系统', dimension: 'creative', aliases: ['数值策划', '游戏数值', '经济系统', '商业化数值'], jdCategories: CREATIVE_CATEGORIES },
  { id: 'creative:game-narrative', label: '游戏叙事', dimension: 'creative', aliases: ['剧情策划', '叙事策划', '世界观', '游戏剧情'], jdCategories: CREATIVE_CATEGORIES },
];

const DIMENSION_WEIGHT: Record<ProfileTagDimension, number> = {
  level: 4,
  stack: 6,
  platform: 4,
  specialty: 6,
  scenario: 3,
  operations: 6,
  product: 6,
  design: 6,
  business: 5,
  'data-ai': 6,
  hardware: 6,
  creative: 5,
};

export function normalizeMatchingText(value: string): string {
  return value.normalize('NFKC').replace(/戶/g, '户').replace(/⻓/g, '长').replace(/⻔/g, '门')
    .replace(/([\u3400-\u9fff])[\t \u00a0]+(?=[\u3400-\u9fff])/g, '$1');
}

function normalize(value: string): string {
  return normalizeMatchingText(value).toLowerCase().replace(/[\u00a0\s]+/g, ' ').trim();
}

function compileAlias(alias: string): (normalizedText: string) => boolean {
  const normalizedAlias = normalize(alias);
  if (/^[a-z0-9+.#/·\s-]+$/i.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    return (text) => pattern.test(text);
  }
  return (text) => text.includes(normalizedAlias);
}

const COMPILED_DEFINITIONS = DEFINITIONS.map((definition) => ({
  ...definition,
  matchers: [...definition.aliases.map(compileAlias), ...(definition.patterns || []).map((pattern) => (text: string) => pattern.test(text))],
  exclusions: definition.excludeAliases?.map(compileAlias),
}));

// Content keys include categories and evidence provenance; edited inputs cannot reuse stale tags.
const profileCache = new Map<string, TagProfile>();
const MAX_PROFILE_CACHE = 600;

function withoutExcludedAliases(text: string, aliases?: string[]): string {
  let result = text;
  for (const alias of aliases || []) {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias) result = result.split(normalizedAlias).join(' ');
  }
  return result;
}

function isNegatedEvidence(value: string, aliases: string[]): boolean {
  const normalizedValue = normalize(value);
  // Exclusions are requirements to avoid a background, never positive skill evidence.
  if (/不要|不考虑|不接受|不看|不需要|无需|排除|没有|从未|未曾|不具备|未做过|\b(?:no|never|without)\b/i.test(normalizedValue)) return true;
  return aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias || !normalizedValue.includes(normalizedAlias)) return false;
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    return new RegExp(`(?:没有|并无|从未|未曾|未做过|未使用|未接触|未从事|不具备|缺乏|不会|不熟悉)[^，。；;\\n]{0,12}${escaped}|${escaped}[^，。；;\\n]{0,10}(?:经验不足|并不熟悉|不熟悉|不会)`, 'i').test(normalizedValue);
  });
}

function evidenceFor(
  segments: Array<{ text: string; normalized: string }>,
  matchers: Array<(text: string) => boolean>,
  aliases: string[],
  excludeAliases?: string[],
): string[] {
  const found: string[] = [];
  for (const segment of segments) {
    const searchable = withoutExcludedAliases(segment.normalized, excludeAliases);
    if (!matchers.some((matches) => matches(searchable)) || isNegatedEvidence(segment.text, aliases)) continue;
    found.push(segment.text.length > 100 ? `${segment.text.slice(0, 100)}…` : segment.text);
    if (found.length === 2) break;
  }
  return found;
}

function isPreferredEvidence(value: string): boolean {
  return /优先|加分|了解|非必须|可选/.test(value);
}

function isAlternativeEvidence(value: string): boolean {
  return /(?:或|或者|任一|任意一种|至少一种|二选一)/.test(value);
}

function splitSharedArchitectureRequirement(value: string): {
  alternatives: string;
  sharedRequiredTagIds: string[];
} | null {
  const alternativeIndex = value.search(/(?:或|或者|任一|任意一种|至少一种|二选一)/);
  if (alternativeIndex < 0) return null;
  const architectureMatches = Array.from(value.matchAll(/(?:系统)?架构(?:设计|决策|治理|演进)/g));
  const sharedMatch = architectureMatches.find((match) => (match.index ?? -1) > alternativeIndex);
  if (!sharedMatch?.index) return null;
  const sharedTail = value.slice(sharedMatch.index);
  if (!/(?:落地|经验|能力|负责|主导)/.test(sharedTail)) return null;
  return {
    alternatives: value.slice(0, sharedMatch.index),
    sharedRequiredTagIds: ['level:architect'],
  };
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildProfile(
  sources: Array<{ name: string; text: string; weight: number; required: boolean; quality: ProfileTagEvidence['quality'] }>,
  jdCategories?: JDCategory[],
  candidate = false,
): TagProfile {
  const cacheKey = JSON.stringify([sources, jdCategories, candidate]);
  const cached = profileCache.get(cacheKey);
  if (cached) {
    profileCache.delete(cacheKey);
    profileCache.set(cacheKey, cached);
    return cached;
  }
  const preparedSources = sources.map((source) => ({
    ...source,
    segments: source.text.split(/[\n\r。；;，,]+/).map((text) => text.trim()).filter(Boolean)
      .map((text) => ({ text, normalized: normalize(text) })),
  }));
  const tags = COMPILED_DEFINITIONS.flatMap((definition) => {
    const categoryMatches = !definition.jdCategories || !jdCategories
      || definition.jdCategories.some((category) => jdCategories.includes(category));
    let score = 0;
    let required = false;
    const evidence: ProfileTagEvidence[] = [];
    for (const source of preparedSources) {
      if (!source.text || (candidate && definition.descriptionEvidenceOnly && source.name === 'currentJob')) continue;
      if (!categoryMatches && source.name !== 'title') continue;
      const found = evidenceFor(source.segments, definition.matchers, definition.aliases, definition.excludeAliases);
      if (found.length === 0) continue;
      score += source.weight;
      evidence.push(...found.map((snippet) => ({ source: source.name, quality: source.quality, snippet })));
      if (source.required && found.some((item) => !isPreferredEvidence(item) && !isAlternativeEvidence(item))) required = true;
    }
    if (score === 0) return [];
    return [{
      id: definition.id,
      label: definition.label,
      dimension: definition.dimension,
      family: definition.family,
      score,
      required,
      evidence: evidence.filter((item, index) => evidence.findIndex((candidateEvidence) => (
        candidateEvidence.source === item.source && candidateEvidence.snippet === item.snippet
      )) === index).slice(0, 3),
    } satisfies ProfileTag];
  });
  const sourceText = sources.map((source) => `${source.name}:${source.text}`).join('|');
  const profile: TagProfile = {
    fingerprint: `${TAG_TAXONOMY_VERSION}:${TAG_EXTRACTOR_VERSION}:${fingerprint(sourceText)}`,
    tags: tags.sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score || a.label.localeCompare(b.label, 'zh-CN')),
  };
  profileCache.set(cacheKey, profile);
  if (profileCache.size > MAX_PROFILE_CACHE) profileCache.delete(profileCache.keys().next().value!);
  return profile;
}

export function extractJDTagProfile(jd: JD): TagProfile {
  const profile = buildProfile([
    { name: 'title', text: jd.title, weight: 6, required: true, quality: 'fact' },
    { name: 'requirements', text: jd.requirements.join('\n'), weight: 5, required: true, quality: 'fact' },
    { name: 'responsibilities', text: jd.responsibilities.join('\n'), weight: 3, required: false, quality: 'fact' },
    { name: 'preferred', text: (jd.preferredQualifications || []).join('\n'), weight: 1, required: false, quality: 'fact' },
    { name: 'notes', text: jd.notes || '', weight: 2, required: false, quality: 'fact' },
  ], jd.categories);
  const requirementParts = jd.requirements.flatMap((requirement) => requirement
    .split(/[\n\r。；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((clause) => {
      const shared = splitSharedArchitectureRequirement(clause);
      if (shared) return [{ evidence: clause, searchable: shared.alternatives, sharedRequiredTagIds: shared.sharedRequiredTagIds }];
      return clause.split(/[，,]+/).map((item) => ({ evidence: item.trim(), searchable: item.trim(), sharedRequiredTagIds: [] as string[] }));
    }))
    .filter((part) => part.evidence && isAlternativeEvidence(part.searchable) && !isPreferredEvidence(part.evidence));
  const sharedRequiredTagIds = new Set(requirementParts.flatMap((part) => part.sharedRequiredTagIds));
  const requiredAnyGroups = requirementParts
    .map((part, index) => {
      const normalizedRequirement = normalize(part.searchable);
      const definitions = COMPILED_DEFINITIONS.filter((definition) => {
        if (part.sharedRequiredTagIds.includes(definition.id)) return false;
        const categoryMatches = !definition.jdCategories
          || definition.jdCategories.some((category) => jd.categories.includes(category));
        if (!categoryMatches) return false;
        const searchable = withoutExcludedAliases(normalizedRequirement, definition.excludeAliases);
        return definition.matchers.some((matches) => matches(searchable))
          && !isNegatedEvidence(part.evidence, definition.aliases);
      });
      const tagIds = Array.from(new Set(definitions.map((definition) => definition.id)));
      if (tagIds.length < 2) return null;
      return {
        id: `any:${index}:${tagIds.join('|')}`,
        tagIds,
        labels: tagIds.map((id) => definitions.find((definition) => definition.id === id)?.label || id),
        evidence: part.evidence,
      };
    })
    .filter((group): group is NonNullable<typeof group> => Boolean(group));
  const tags = sharedRequiredTagIds.size
    ? profile.tags.map((tag) => sharedRequiredTagIds.has(tag.id) ? { ...tag, required: true } : tag)
    : profile.tags;
  return requiredAnyGroups.length || tags !== profile.tags ? { ...profile, tags, requiredAnyGroups } : profile;
}

export function extractCandidateTagProfile(candidate: CandidateTagSource): TagProfile {
  const factualResume = candidate.resumeText.replace(/^\s*(?:求职意向|应聘岗位|目标岗位|期望岗位)[：:].*$/gim, '');
  return buildProfile([
    { name: 'currentJob', text: candidate.currentJob, weight: 1, required: false, quality: 'routing' },
    { name: 'highlights', text: candidate.highlights, weight: 2, required: false, quality: 'derived' },
    { name: 'resume', text: factualResume, weight: 4, required: false, quality: 'fact' },
  ], undefined, true);
}

export function compareTagProfiles(jdProfile: TagProfile, candidateProfile: TagProfile): TagComparison {
  const confirmedCandidateTags = candidateProfile.tags.filter((tag) => tag.evidence.some((evidence) => evidence.quality === 'fact'));
  const confirmedIds = new Set(confirmedCandidateTags.map((tag) => tag.id));
  const allIds = new Set(candidateProfile.tags.map((tag) => tag.id));
  const confirmedFamilies = new Set(confirmedCandidateTags.map((tag) => tag.family).filter(Boolean));
  const matched = jdProfile.tags.filter((tag) => confirmedIds.has(tag.id));
  const tentative = jdProfile.tags.filter((tag) => !confirmedIds.has(tag.id) && (
    allIds.has(tag.id) || Boolean(tag.family && confirmedFamilies.has(tag.family))
  ));
  const anyGroupIds = new Set((jdProfile.requiredAnyGroups || []).flatMap((group) => group.tagIds));
  const missingRequired = jdProfile.tags.filter((tag) => tag.required && !confirmedIds.has(tag.id));
  for (const group of jdProfile.requiredAnyGroups || []) {
    if (group.tagIds.some((id) => confirmedIds.has(id))) continue;
    const members = jdProfile.tags.filter((tag) => group.tagIds.includes(tag.id));
    const representative = members[0];
    if (!representative) continue;
    missingRequired.push({
      ...representative,
      id: group.id,
      label: `${group.labels.join(' / ')}（任一）`,
      required: true,
      evidence: [{ source: 'requirements', quality: 'fact', snippet: group.evidence }],
    });
  }
  const standaloneTags = jdProfile.tags.filter((tag) => !anyGroupIds.has(tag.id));
  let totalWeight = standaloneTags.reduce((sum, tag) => sum + DIMENSION_WEIGHT[tag.dimension] * Math.max(1, tag.score), 0);
  let matchedWeight = matched.filter((tag) => !anyGroupIds.has(tag.id))
    .reduce((sum, tag) => sum + DIMENSION_WEIGHT[tag.dimension] * Math.max(1, tag.score), 0);
  let tentativeWeight = tentative.filter((tag) => !anyGroupIds.has(tag.id))
    .reduce((sum, tag) => sum + DIMENSION_WEIGHT[tag.dimension] * Math.max(1, tag.score) * 0.25, 0);
  for (const group of jdProfile.requiredAnyGroups || []) {
    const members = jdProfile.tags.filter((tag) => group.tagIds.includes(tag.id));
    const groupWeight = Math.max(0, ...members.map((tag) => DIMENSION_WEIGHT[tag.dimension] * Math.max(1, tag.score)));
    totalWeight += groupWeight;
    if (group.tagIds.some((id) => confirmedIds.has(id))) matchedWeight += groupWeight;
    else if (group.tagIds.some((id) => allIds.has(id))) tentativeWeight += groupWeight * 0.25;
  }
  return {
    score: totalWeight > 0 ? Math.round(((matchedWeight + tentativeWeight) / totalWeight) * 100) : 0,
    matched,
    tentative,
    missingRequired,
  };
}

export function visibleProfileTags(profile: TagProfile, limit = 8): ProfileTag[] {
  return profile.tags.slice(0, limit);
}
