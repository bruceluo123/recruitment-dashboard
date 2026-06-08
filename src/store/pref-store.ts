import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RepushColumnId } from '@/store/repush-store';

// 本机偏好：记住当前用户选的「是谁」（麦满分=a / 啵啵=b）。
// 仅存本地 localStorage，不经 KV 同步——这是每台设备的身份偏好，
// 让啵啵打开网站默认就是她自己的视图，所有个人页面统一跟随。

interface PrefStore {
  activeOwner: RepushColumnId;
  setActiveOwner: (owner: RepushColumnId) => void;
}

export const usePrefStore = create<PrefStore>()(
  persist(
    (set) => ({
      activeOwner: 'a',
      setActiveOwner: (owner) => set({ activeOwner: owner }),
    }),
    { name: 'recruitai-pref-store' },
  ),
);
