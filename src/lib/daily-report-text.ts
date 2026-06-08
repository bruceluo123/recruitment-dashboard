// 「今日日报」文字版生成：依据今日简历/推荐/面试数据，按真人模板直接套用，
// 标题「月.日 录入人」，改一下日期或微调后即可复制（不调用 AI）。

import type { JobLine } from './daily-report';

export interface TodayReportInput {
  name: string;                 // 录入人（麦满分 / 啵啵）
  date: Date;                   // 报告日期
  recommendDetail: JobLine[];   // 今日推荐/收取简历按岗位聚合
  interviews: Array<{ job: string; person: string; status: string }>; // 今日面试
}

function mdLabel(d: Date): string {
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

/**
 * 固定模板：按真人日报样式直接套用今日数据，不调用 AI。
 * 标题为「月.日 录入人」，招聘/面试各列一行，结尾固定明日计划，可手动修改后复制。
 */
export function buildTodayReportTemplate(input: TodayReportInput): string {
  const lines: string[] = [`${mdLabel(input.date)} ${input.name}`, ''];

  const recs = input.recommendDetail.filter((j) => (j.name || '').trim());
  lines.push('招聘：');
  recs.forEach((j) => lines.push(`${j.name}*${j.qty}`));

  const ints = input.interviews.filter((v) => (v.job || v.person || '').trim());
  lines.push('', '面试：');
  ints.forEach((v) => lines.push(`${v.person || '候选人'}-${v.job || '岗位'} ${v.status || '待反馈'}`));

  lines.push('', '明日计划：跟进面试情况，跟进意向候选人');
  return lines.join('\n');
}
