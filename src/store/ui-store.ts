import { create } from 'zustand';

/** 全局 UI 布局状态：移动端抽屉开关 + 桌面端侧栏折叠（不持久化）。 */
interface UIStore {
  mobileNavOpen: boolean;   // 移动端侧栏抽屉是否展开
  navCollapsed: boolean;    // 桌面端侧栏是否折叠为窄栏
  openNav: () => void;
  closeNav: () => void;
  toggleMobileNav: () => void;
  toggleCollapsed: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  mobileNavOpen: false,
  navCollapsed: false,
  openNav: () => set({ mobileNavOpen: true }),
  closeNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  toggleCollapsed: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
}));
