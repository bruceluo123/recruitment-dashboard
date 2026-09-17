/**
 * 寻英当前负责的在招岗位快照。
 * 来源：在招岗位整合（截至 2026.09.16 17:00）
 * 口径：主负责招聘团队含“寻英”，且当前缺口 HC > 0；重复岗位已合并。
 */
export interface XunyingResponsibleJob {
  organization: string;
  department: string;
  title: string;
}

export const XUNYING_RESPONSIBLE_JOBS: XunyingResponsibleJob[] = [
  { organization: '技术中心', department: 'SD组', title: 'AI 内容训练师' },
  { organization: '运营中心', department: '体验中心', title: '产品专员' },
  { organization: '运营中心', department: '体验中心', title: '效能支撑部-项目助理' },
  { organization: '运营中心', department: '体验中心', title: '督导专员' },
  { organization: '北斗-伊甸维度', department: '渠道部', title: '渠道扩展专员' },
  { organization: '北斗-伊甸维度', department: '运营一部', title: '中高级产品运营（加急）' },
  { organization: '北斗-伊甸维度', department: '运营二部', title: '中高级产品运营' },
  { organization: '北斗-伊甸维度', department: '运营二部', title: '网站运营' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: 'AI内容编辑（加急）' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: 'AI动漫短剧编剧' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: 'UI设计师' },
  { organization: '北斗-伊甸维度', department: '运营公共部', title: '新媒体运营' },
  { organization: '北斗-经纬', department: '技术部', title: '高级技术架构师（Go方向）' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧分镜师' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧剪辑师' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧编剧（兼选题、角色设定）' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI短剧配音师/音频制作' },
  { organization: '北斗-经纬', department: '运营部', title: 'AI视频生成师' },
  { organization: '北斗-经纬', department: '运营部', title: '中高级产品运营' },
  { organization: 'Happy-美国', department: '机房', title: 'AI Algorithm Engineer' },
  { organization: '内务部', department: '内务部', title: 'HRBP' },
  { organization: '内务部', department: '内务部', title: 'HR助理（HRBP方向）' },
  { organization: '内务部', department: '内务部', title: '项目助理 Project Assistant(1–2 名)' },
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
