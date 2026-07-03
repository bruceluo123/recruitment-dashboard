// 示例(mock)数据识别 —— 单一事实来源。CLAUDE.md 关键约定：mock 数据(ID 以 jd-00 开头)绝不推送到 KV。
// 集中在此，避免在 store / SyncProvider 各写一份判断规则导致改规则时漏改一处。

/** mock 示例数据的 ID 前缀。 */
export const MOCK_ID_PREFIX = 'jd-00';

/** 单条是否为 mock 示例数据。 */
export function isMockJd(jd: { id: string }): boolean {
  return jd.id.startsWith(MOCK_ID_PREFIX);
}

/** 整批是否全为 mock（空数组视为非 mock，避免把空状态误判为 mock）。 */
export function isMockJds(jds: Array<{ id: string }>): boolean {
  return jds.length > 0 && jds.every(isMockJd);
}
