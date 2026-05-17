'use client';
import { useState, useEffect } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { JDCategoryTabs } from './JDCategoryTabs';
import { JDSearchBar } from './JDSearchBar';
import { JDTable } from './JDTable';
import { JDDetailPanel } from './JDDetailPanel';
import { JDImportDialog } from './JDImportDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useJDStore, useFilteredJDs, useCategoryCounts } from '@/store/jd-store';
import { Briefcase, X } from 'lucide-react';
import { generateId } from '@/lib/utils';
import type { JDCategory } from '@/types/jd';

export function JDLibraryPage() {
  const [mounted, setMounted] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', department: '', responsibilities: '', requirements: '', category: 'operations' as string, location: 'remote', salary: '' });

  const jds = useJDStore((s) => s.jds);
  const filter = useJDStore((s) => s.filter);
  const selectedJdId = useJDStore((s) => s.selectedJdId);
  const setFilter = useJDStore((s) => s.setFilter);
  const selectJD = useJDStore((s) => s.selectJD);
  const addJdBatch = useJDStore((s) => s.addJdBatch);
  const deleteJD = useJDStore((s) => s.deleteJD);
  const filteredJDs = useFilteredJDs();
  const categories = useCategoryCounts();

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const finalFiltered = activeOnly ? filteredJDs.filter((j) => j.isActive) : filteredJDs;
  const selectedJd = jds.find((j) => j.id === selectedJdId) || null;

  const handleAdd = () => {
    if (!addForm.title.trim()) return;
    addJdBatch([{
      id: generateId(),
      title: addForm.title.trim(),
      department: addForm.department.trim(),
      category: detectCat(addForm.title + ' ' + addForm.department),
      responsibilities: addForm.responsibilities.split(/[；;。\n\r]+/).map((s) => s.trim()).filter(Boolean),
      requirements: addForm.requirements.split(/[；;。\n\r]+/).map((s) => s.trim()).filter(Boolean),
      salaryRange: parseSalary(addForm.salary),
      location: addForm.location.trim() || 'remote',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
    setAddForm({ title: '', department: '', responsibilities: '', requirements: '', category: 'operations', location: 'remote', salary: '' });
    setAddOpen(false);
  };

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">JD 岗位库</h2>
        <p className="text-sm text-gray-500 mt-1">共 {jds.length} 个岗位，{jds.filter((j) => j.isActive).length} 个活跃招聘中</p>
      </div>

      <JDCategoryTabs categories={categories} activeCategory={filter.category} onCategoryChange={(cat) => setFilter({ category: cat })} />

      <JDSearchBar
        search={filter.search} onSearchChange={(search) => setFilter({ search })}
        onImportClick={() => setImportOpen(true)} onAddClick={() => setAddOpen(true)}
        activeOnly={activeOnly} onActiveOnlyChange={setActiveOnly}
      />

      <GlassPanel padding="none">
        {finalFiltered.length > 0 ? (
          <JDTable jds={finalFiltered} onSelect={selectJD} selectedId={selectedJdId} onDelete={deleteJD} />
        ) : (
          <EmptyState icon={Briefcase} title={jds.length === 0 ? '暂无岗位数据' : '无匹配结果'} description={jds.length === 0 ? '点击"添加岗位"或"批量导入"添加数据' : '尝试调整筛选条件'} />
        )}
      </GlassPanel>

      <JDDetailPanel jd={selectedJd} isOpen={!!selectedJdId} onClose={() => selectJD(null)} />
      <JDImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} />

      {/* Add JD Dialog */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/20" onClick={() => setAddOpen(false)} />
          <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加岗位</h3>
              <button onClick={() => setAddOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">岗位名称 *</label>
                  <input value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                    placeholder="如：高级前端工程师" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">部门</label>
                  <input value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })}
                    placeholder="如：技术部" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">地点</label>
                  <input value={addForm.location} onChange={(e) => setAddForm({ ...addForm, location: e.target.value })}
                    placeholder="remote" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">薪资 (如 25K-45K)</label>
                  <input value={addForm.salary} onChange={(e) => setAddForm({ ...addForm, salary: e.target.value })}
                    placeholder="25K-45K" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">岗位职责（换行或分号分隔）</label>
                <textarea value={addForm.responsibilities} onChange={(e) => setAddForm({ ...addForm, responsibilities: e.target.value })}
                  placeholder="负责核心产品前端架构设计；参与组件库建设；优化页面性能" rows={3}
                  className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">岗位要求（换行或分号分隔）</label>
                <textarea value={addForm.requirements} onChange={(e) => setAddForm({ ...addForm, requirements: e.target.value })}
                  placeholder="3年以上前端经验；精通React；熟悉TypeScript" rows={3}
                  className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
              </div>
              <button onClick={handleAdd} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all">
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CAT_MAP: [JDCategory, RegExp][] = [
  ['seo', /seo|搜索引擎|关键词/i], ['advertising', /广告|信息流|投放|sem|feed|千川/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos/i], ['ai', /人工智能|大模型|llm|gpt|prompt/i],
  ['algorithm', /算法|推荐|nlp|机器学习|深度学习|计算机视觉/i], ['frontend', /前端|web|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端/i],
  ['backend', /后端|java|go|golang|php|ruby|服务端|python|c\+\+|c#|架构师|开发/i], ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量/i], ['product', /产品经理|产品总监|产品助理/i], ['design', /ui|ux|设计|视觉|插画|动效/i],
  ['finance', /财务|会计|出纳|审计|税务/i], ['hr', /hr|人力|招聘|薪酬|培训|员工关系/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售/i], ['customer-service', /客服|客户服务|售后/i],
  ['operations', /运营|电商|直播|带货|主播|中控|场控|选品/i], ['project', /项目|pmo|scrum/i],
  ['director', /总监|vp|副总裁|cto|ceo|负责人/i], ['administration', /行政|前台|助理|秘书|档案|车辆|办公室/i],
  ['data', /数据挖掘|数据工程|爬虫|etl|数仓|数据/i], ['hardware', /gpu|硬件|芯片|嵌入式|固件/i],
];

function detectCat(text: string): JDCategory {
  const t = text.toLowerCase();
  for (const [cat, re] of CAT_MAP) { if (re.test(t)) return cat; }
  return 'operations';
}

function parseSalary(s: string): { min: number; max: number; currency: string } {
  if (!s) return { min: 0, max: 0, currency: 'K' };
  const match = s.replace(/[,，]/g, '').match(/(\d+)\s*[-~至到]\s*(\d+)\s*([kKw万])?/i);
  if (match) {
    const mult = match[3]?.toLowerCase() === '万' ? 10 : 1;
    return { min: Math.max(0, parseInt(match[1]) * mult), max: Math.max(0, parseInt(match[2]) * mult), currency: match[3]?.toUpperCase() || 'K' };
  }
  return { min: 0, max: 0, currency: 'K' };
}
