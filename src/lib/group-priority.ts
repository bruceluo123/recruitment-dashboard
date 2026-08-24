export interface GroupPriorityJob {
  title?: string;
  department?: string;
  organization?: string;
  serviceUnit?: string;
  requester?: string;
}

const GROUP_PRIORITY_RULES = [
  { label: 'Happy', terms: ['happy'] },
  { label: '运营中心-体验中心', terms: ['运营中心', '体验中心'] },
  { label: '法务部', terms: ['法务部'] },
  { label: '瑞升', terms: ['瑞升'] },
  { label: '经纬', terms: ['经纬'] },
  { label: '伊甸维度', terms: ['伊甸维度'] },
  { label: '合规部', terms: ['合规部'] },
  { label: '内务部英国岗位', terms: ['内务部', '英国'] },
  { label: 'Ann总', terms: ['ann总'] },
] as const;

export function groupPriorityLabel(job: GroupPriorityJob): string {
  const haystack = [job.title, job.department, job.organization, job.serviceUnit, job.requester]
    .filter(Boolean)
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, '');
  return GROUP_PRIORITY_RULES.find((rule) => rule.terms.every((term) => haystack.includes(term)))?.label || '';
}

export function groupPriorityRank(job: GroupPriorityJob): number {
  const haystack = [job.title, job.department, job.organization, job.serviceUnit, job.requester]
    .filter(Boolean)
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, '');
  const index = GROUP_PRIORITY_RULES.findIndex((rule) => rule.terms.every((term) => haystack.includes(term)));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
