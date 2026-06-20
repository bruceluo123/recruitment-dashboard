import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Company, CompanyFilter } from '@/types/company';
import { emptyDimensions } from '@/types/company';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { generateId } from '@/lib/utils';

interface CompanyStore {
  companies: Company[];
  filter: CompanyFilter;
  selectedCompanyId: string | null;
  lastDeletedCompany: Company | null;
  selectCompany: (id: string | null) => void;
  setFilter: (partial: Partial<CompanyFilter>) => void;
  resetFilter: () => void;
  addCompany: (company: Company) => void;
  /** 按公司名 upsert：同名则覆盖研究内容，否则新建。供 skill 桥接写入复用。 */
  upsertCompanyByName: (partial: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCompany: (id: string, partial: Partial<Company>) => void;
  deleteCompany: (id: string) => void;
  deleteCompanyBatch: (ids: string[]) => void;
  undoDeleteCompany: () => void;
  clearAllCompanies: () => void;
  createBlankCompany: () => string;
}

export const useCompanyStore = create<CompanyStore>()(
  persist(
    (set, get) => ({
      companies: [],
      filter: { search: '', category: 'all' },
      selectedCompanyId: null,
      lastDeletedCompany: null,

      selectCompany: (id) => set({ selectedCompanyId: id }),
      setFilter: (partial) => set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: { search: '', category: 'all' } }),

      addCompany: (company) => set((s) => ({ companies: [company, ...s.companies] })),

      upsertCompanyByName: (partial) => {
        const now = new Date().toISOString();
        const existing = get().companies.find((c) => c.name.trim() === partial.name.trim());
        if (existing) {
          set((s) => ({
            companies: s.companies.map((c) =>
              c.id === existing.id ? { ...c, ...partial, updatedAt: now } : c),
          }));
          return existing.id;
        }
        const id = generateId();
        set((s) => ({ companies: [{ id, createdAt: now, updatedAt: now, ...partial }, ...s.companies] }));
        return id;
      },

      updateCompany: (id, partial) => set((s) => ({
        companies: s.companies.map((c) => c.id === id ? { ...c, ...partial, updatedAt: new Date().toISOString() } : c),
      })),

      deleteCompany: (id) => set((s) => {
        const target = s.companies.find((c) => c.id === id);
        return { companies: s.companies.filter((c) => c.id !== id), lastDeletedCompany: target || null };
      }),
      deleteCompanyBatch: (ids) => set((s) => {
        const idSet = new Set(ids);
        return { companies: s.companies.filter((c) => !idSet.has(c.id)), lastDeletedCompany: null };
      }),
      undoDeleteCompany: () => set((s) => {
        if (!s.lastDeletedCompany) return {};
        return { companies: [s.lastDeletedCompany, ...s.companies], lastDeletedCompany: null };
      }),
      clearAllCompanies: () => set({ companies: [], lastDeletedCompany: null }),

      createBlankCompany: () => {
        const id = generateId();
        const now = new Date().toISOString();
        set((s) => ({
          companies: [{
            id, name: '新公司', categories: [], dims: emptyDimensions(),
            createdAt: now, updatedAt: now,
          }, ...s.companies],
        }));
        return id;
      },
    }),
    { name: 'recruitai-company-store', version: 1 },
  ),
);

// ─── Selectors ───

export function useFilteredCompanies(): Company[] {
  const { companies, filter } = useCompanyStore();
  return companies.filter((c) => {
    if (filter.category !== 'all' && !(c.categories || []).includes(filter.category)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const dimText = (c.dims || []).map((d) => `${d.title} ${d.body}`).join(' ');
      const haystack = [c.name, c.industry, c.summary, dimText].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function useCompanyCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const { companies } = useCompanyStore();
  const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: companies.length }];
  for (const cat of ALL_CATEGORIES) {
    const count = companies.filter((c) => (c.categories || []).includes(cat)).length;
    if (count > 0) entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count });
  }
  return entries;
}
