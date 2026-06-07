'use client';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Key, Check } from 'lucide-react';
import { BackupPanel } from '@/components/settings/BackupPanel';

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto animate-fade-in space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">设置</h2>
        <p className="text-sm text-gray-500 mt-1">API 与系统配置</p>
      </div>

      <GlassPanel>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Key className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-800">DeepSeek API</h3>
            <p className="text-sm text-gray-500">已配置 · 模型: deepseek-v4-pro</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-100">
          <Check className="w-4 h-4 text-green-500" />
          <span className="text-sm text-green-700">API Key 已配置，匹配服务正常运行</span>
        </div>
      </GlassPanel>

      <BackupPanel />

      <GlassPanel>
        <h3 className="text-base font-semibold text-gray-800 mb-4">关于企鹅岛</h3>
        <div className="space-y-3 text-sm text-gray-500">
          <p>猎头岗位匹配系统 v1.0</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { title: 'JD 库', desc: '18个分类 + 批量导入' },
              { title: '简历匹配', desc: 'AI 解析 + 智能配对' },
              { title: '面试日历', desc: '看板流程 + 拖拽管理' },
              { title: 'DeepSeek AI', desc: '多维度岗位匹配评分' },
            ].map((f) => (
              <div key={f.title} className="p-3 rounded-lg bg-gray-50">
                <div className="text-gray-700 font-medium">{f.title}</div>
                <div className="text-xs mt-0.5">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
