import { usePrefStore } from '@/store/pref-store';
import { useRepushStore } from '@/store/repush-store';

// 当前操作身份 —— 复用已有的 pref(activeOwner=麦满分/啵啵) + repush 列名。
// 用于「删除人 / 最后修改人」等协同标记。仅本机身份，不引入登录体系。

/** 当前操作者的显示名（如「麦满分」「啵啵」）。 */
export function currentOperatorName(): string {
  const owner = usePrefStore.getState().activeOwner;
  return useRepushStore.getState().columnNames[owner] || owner;
}
