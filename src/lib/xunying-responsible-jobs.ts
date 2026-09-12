/**
 * 寻英当前负责的在招岗位快照。
 * 来源：在招岗位整合_截至2026.09.09 17时.xlsx
 * 口径：主负责招聘团队含“寻英”，且当前缺口 HC > 0；重复岗位已合并。
 */
export interface XunyingResponsibleJob {
  organization: string;
  department: string;
  title: string;
}

export const XUNYING_RESPONSIBLE_JOBS: XunyingResponsibleJob[] = [
  { organization: '技术中心', department: '', title: '项目经理' },
  { organization: '技术中心', department: 'SD组', title: 'AI 内容训练师' },
  { organization: '运营中心', department: '体验中心', title: '产品专员' },
  { organization: '运营中心', department: '体验中心', title: '效能支撑部-项目助理' },
  { organization: '运营中心', department: '体验中心', title: '督导专员' },
  { organization: '北斗-瑞升', department: '产品运营1/2/3部', title: '初/中级运营专员' },
  { organization: '北斗-瑞升', department: '产品运营1/2/部', title: '中高级运营专员' },
  { organization: '北斗-瑞升', department: '产品运营1/2部', title: '中高级UI设计师' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: 'AI 视频生成（30-50K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: 'AI内容线主管（55k-85k/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '分镜' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '剧本审核（含合规）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '剧本组长（35K-55K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '剪辑' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '剪辑音频组长（33K-50K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '发布与数据' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '场景道具设计' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '外包与采购对接' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '成片质检' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '编剧' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '美术组长（33K-50K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '视频生成组长（50K-70K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '角色设计' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '运营主管（55K-85K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '运营副主管（40K-65K/月）' },
  { organization: '北斗-瑞升', department: '产品运营1部', title: '镜头审核' },
  { organization: '北斗-瑞升', department: '产品运营2部', title: '高级内容运营' },
  { organization: '北斗-瑞升', department: '产品运营3部', title: 'AI短剧制作' },
  { organization: '北斗-瑞升', department: '产品运营3部', title: 'ToC网站综合运营' },
  { organization: '北斗-瑞升', department: '产品运营3部', title: '中高级UI设计师' },
  { organization: '北斗-瑞升', department: '产品运营3部', title: '中高级运营专员（二次元方向）' },
  { organization: '北斗-瑞升', department: '产品运营3部', title: '中高级运营专员（综合类方向）' },
  { organization: '北斗-瑞升', department: '产品运营3部', title: '运营组长（免费产品）25k-45k/月' },
  { organization: '北斗-瑞升', department: '产品运营4部', title: '中高级内容运营专员' },
  { organization: '北斗-瑞升', department: '产品运营4部', title: '初/中级运营专员' },
  { organization: '北斗-瑞升', department: '产品运营4部', title: '运营副主管（网站运营）40K-65K/月' },
  { organization: '北斗-瑞升', department: '产品运营4部', title: '运营组长（网站运营）25k-45k/月' },
  { organization: '北斗-瑞升', department: '产品运营4部', title: '高级运营专员' },
  { organization: '北斗-瑞升', department: '产品运营四部', title: 'SEO增长负责人（内容/媒体/视频资讯方向 年薪60–70万元 ）' },
  { organization: '北斗-瑞升', department: '产品运营部', title: 'PMO/项目管理' },
  { organization: '北斗-瑞升', department: '产品运营部', title: '高级产品经理' },
  { organization: '北斗-瑞升', department: '产品运营部', title: '高级产品经理（增长方向）' },
  { organization: '北斗-瑞升', department: '技术', title: 'Flutter 开发工程师' },
  { organization: '北斗-瑞升', department: '技术', title: 'Golang开发工程师' },
  { organization: '北斗-瑞升', department: '技术', title: '中高级前端开发' },
  { organization: '北斗-瑞升', department: '瑞升运营四部 · 增长1组，增长2组', title: '社媒 / 社群运营专员（中级）' },
  { organization: '北斗-瑞升', department: '运营1/2/3部', title: '中高级平面设计师' },
  { organization: '北斗-瑞升', department: '运营3部', title: 'AI内容创作 / AI漫剧制作' },
  { organization: '北斗-瑞升', department: '运营三部/流量组', title: '中级远程社媒运营（KOL & 内容方向）' },
  { organization: '北斗-伊甸维度', department: '运营1部', title: '高级产品经理' },
  { organization: '北斗-伊甸维度', department: '运营一部', title: '中高级产品内容运营' },
  { organization: '北斗-伊甸维度', department: '运营一部', title: '中高级产品运营（加急）' },
  { organization: '北斗-伊甸维度', department: '运营二部', title: '中高级产品运营' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: 'AI内容编辑（加急）' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: 'AI动漫短剧编剧' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: 'UI设计师' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: '新媒体运营' },
  { organization: '北斗-经纬', department: 'Ops效能先锋营', title: 'AI 短剧生成师' },
  { organization: '北斗-经纬', department: '技术部', title: '高级技术架构师（Go方向）' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧分镜师' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧编剧（兼选题、角色设定）' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧配音师/音频制作' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI视频生成师' },
  { organization: '北斗-经纬', department: '运营部', title: '中高级产品运营' },
  { organization: '北斗-经纬', department: '运营部', title: '产品经理' },
  { organization: 'Happy-美国', department: '机房', title: 'AI Algorithm Engineer' },
  { organization: '内务部', department: '内务部', title: 'HRBP' },
  { organization: '内务部', department: '内务部', title: 'HR助理（HRBP方向）' },
  { organization: '内务部', department: '内务部', title: '项目助理 Project Assistant(1–2 名)' },
  { organization: '法务部', department: '法务部', title: 'AI与知识产权法务' },
  { organization: '法务部', department: '法务部', title: '公司治理法务' },
  { organization: '法务部', department: '法务部', title: '英国法务助理' },
  { organization: 'COE', department: '专家中心 COE —— A组', title: 'COE 专家（规则与框架方向）' },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s·・()（）【】\[\]—–_\-\\/，,。.：:]/g, '')
    .replace(/公司$/g, '');
}

function normalizeOrganization(value: string): string {
  return normalize(value).replace(/^北斗/, '');
}

function comparable(left: string, right: string, minimumLength: number): boolean {
  if (!left || !right) return false;
  return left === right || (
    Math.min(left.length, right.length) >= minimumLength
    && (left.includes(right) || right.includes(left))
  );
}

export function matchXunyingResponsibleJob(input: {
  title: string;
  department?: string;
  organizations: Array<string | undefined>;
}): XunyingResponsibleJob | undefined {
  const title = normalize(input.title);
  const department = normalize(input.department || '');
  const organizations = input.organizations.map((value) => normalizeOrganization(value || '')).filter(Boolean);

  const ranked = XUNYING_RESPONSIBLE_JOBS.flatMap((job) => {
    const jobTitle = normalize(job.title);
    const exactTitle = title === jobTitle;
    const relatedTitle = comparable(title, jobTitle, 4);
    if (!exactTitle && !relatedTitle) return [];

    const jobOrganization = normalizeOrganization(job.organization);
    const organizationMatches = organizations.some((value) => comparable(value, jobOrganization, 2));
    const jobDepartment = normalize(job.department);
    const departmentMatches = Boolean(department && jobDepartment && comparable(department, jobDepartment, 2));
    if (!organizationMatches && !departmentMatches) return [];
    if (!exactTitle && (!organizationMatches || (!departmentMatches && jobDepartment))) return [];

    return [{
      job,
      score: (exactTitle ? 8 : 1) + (organizationMatches ? 4 : 0) + (departmentMatches ? 3 : 0),
    }];
  });
  ranked.sort((left, right) => right.score - left.score);
  if (!ranked.length) return undefined;
  const best = ranked[0];
  const tied = ranked.find((row, index) => index > 0 && row.score === best.score);
  if (tied && (
    normalizeOrganization(tied.job.organization) !== normalizeOrganization(best.job.organization)
    || normalize(tied.job.department) !== normalize(best.job.department)
  )) return undefined;
  return best.job;
}
