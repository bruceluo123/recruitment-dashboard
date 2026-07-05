// 简历匹配页 → 人才库 / 推荐中心 的桥接（打通「匹配完是死胡同」的断点）。
// 同一份简历只上传一次 Blob（blobUrl 缓存在 resume 记录上），文件本体全链路跟随候选人。
import type { Resume } from '@/types/resume';
import type { JD } from '@/types/jd';
import { useResumeStore } from '@/store/resume-store';
import { useTalentStore } from '@/store/talent-store';
import { useRepushStore, type RepushColumnId } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import { extractRecommendationInfo, extractResumeHighlights } from '@/lib/recommendation';
import { detectCategories } from '@/lib/jd-parse-core';
import { generateId } from '@/lib/utils';

/** 确保简历文件已上传 Blob，返回 url（失败返回空串，不阻断后续流程）。 */
async function ensureBlobUrl(resume: Resume): Promise<string> {
  if (resume.blobUrl) return resume.blobUrl;
  if (!resume.file) return '';
  try {
    const fd = new FormData();
    fd.append('file', resume.file);
    const res = await fetch('/api/talent/upload', { method: 'POST', body: fd });
    if (!res.ok) return '';
    const data = (await res.json()) as { url?: string };
    const url = data.url || '';
    if (url) {
      useResumeStore.setState((s) => ({
        resumes: s.resumes.map((r) => (r.id === resume.id ? { ...r, blobUrl: url } : r)),
      }));
    }
    return url;
  } catch {
    return '';
  }
}

export interface SaveTalentResult { ok: boolean; name?: string; existed?: boolean; error?: string }

/** 把匹配页的简历沉淀为人才库人选：AI 提取姓名/岗位 → 建档/更新 → 文件+全文跟随。 */
export async function saveResumeToTalentPool(resume: Resume): Promise<SaveTalentResult> {
  if (!resume.rawText) return { ok: false, error: '简历尚未解析完成' };
  try {
    const info = await extractRecommendationInfo(resume.rawText);
    const name = (info.name || '').trim();
    if (!name) return { ok: false, error: '未能从简历中识别出姓名，请到人才库手动添加' };

    const url = await ensureBlobUrl(resume);
    const store = useTalentStore.getState();
    const existing = store.talents.find((t) => t.name === name);
    const jobTitle = (info.jobTitle || '').trim();
    const cats = detectCategories(jobTitle || resume.rawText.slice(0, 500));

    let talentId: string;
    if (existing) {
      talentId = existing.id;
      store.updateTalent(existing.id, {
        jobTitle: jobTitle || existing.jobTitle,
        phone: info.contact || existing.phone,
        archived: false,
        ...(url && !existing.resumeUrl ? { resumeUrl: url, resumeFileName: resume.fileName } : {}),
      });
    } else {
      talentId = generateId();
      const now = new Date().toISOString();
      store.addTalent({
        id: talentId,
        name,
        jobTitle,
        categories: cats.length ? cats : ['operations'],
        phone: info.contact || undefined,
        archived: false,
        tg: '',
        notes: '',
        ...(url ? { resumeUrl: url, resumeFileName: resume.fileName } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }

    // 全文直接入库（匹配页已解析好文字，无需再走 scan 提取）
    try {
      const res = await fetch('/api/talent/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: talentId, text: resume.rawText }),
      });
      const data = (await res.json()) as { chars?: number; error?: string };
      if (res.ok && !data.error) {
        useTalentStore.getState().updateTalent(talentId, { hasResumeText: true, resumeChars: data.chars });
      }
    } catch (err) {
      console.warn('人才简历全文入库失败（人才记录已建好）', err);
    }

    return { ok: true, name, existed: !!existing };
  } catch (err) {
    return { ok: false, error: (err as Error).message || '识别失败，请重试' };
  }
}

export interface RecordRecResult { ok: boolean; name?: string; error?: string }

/** 从匹配结果一键录入推荐中心：携带简历原文/文件 + 命中 JD 的岗位/编制/部门。 */
export async function recordRecommendationFromMatch(resume: Resume, jd: JD, owner?: RepushColumnId): Promise<RecordRecResult> {
  if (!resume.rawText) return { ok: false, error: '简历尚未解析完成' };
  try {
    const info = await extractRecommendationInfo(resume.rawText);
    const name = (info.name || '').trim();
    if (!name) return { ok: false, error: '未能从简历中识别出姓名' };

    const url = await ensureBlobUrl(resume);
    const column = owner || usePrefStore.getState().activeOwner;
    useRepushStore.getState().addRecommendation({
      column,
      candidateName: name,
      jdTitle: jd.title,
      contact: info.contact || undefined,
      contactPerson: info.contactPerson || undefined,
      rawText: resume.rawText,
      organization: jd.organization?.trim() || undefined,
      department: jd.department?.trim() || undefined,
      resumeUrl: url || undefined,
      resumeFileName: url ? resume.fileName : undefined,
    });

    // 亮点后台补齐：找到刚建的记录（按姓名+岗位+最新），提取完成后写回
    extractResumeHighlights(resume.rawText)
      .then((hl) => {
        if (!hl) return;
        const items = useRepushStore.getState().items;
        const target = [...items].reverse().find((it) => it.candidateName === name && it.jdTitle === jd.title);
        if (target && !target.highlights) useRepushStore.getState().updateItem(target.id, { highlights: hl.slice(0, 1500) });
      })
      .catch(() => {});

    return { ok: true, name };
  } catch (err) {
    return { ok: false, error: (err as Error).message || '录入失败，请重试' };
  }
}
