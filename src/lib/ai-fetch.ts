// AI/接口响应的统一错误处理。核心：把「请求体超过 Vercel 4.5MB 上限」时平台返回的
// 纯文本 413（Request Entity Too Large）转成可读中文，避免前端对它 res.json() 抛出
// 「Unexpected token 'R'... is not valid JSON」这种令人费解的报错。

/** 依 HTTP 状态构造可读错误。413=请求过大，给出可操作建议。 */
export function aiHttpError(status: number, body?: string): Error {
  if (status === 413) {
    return new Error('内容过大（超出 4.5MB 上限），请减少一次匹配的岗位/候选人数量，或换用更小的简历文件');
  }
  const tail = body ? `：${body.slice(0, 120)}` : '';
  return new Error(`服务错误 ${status}${tail}`);
}

/**
 * 安全读取响应体为 JSON：非 2xx 抛可读错误（413 特判）；2xx 但非 JSON 时也抛可读错误，
 * 绝不让原生 JSON.parse 的「Unexpected token」冒泡到界面。
 */
export async function readJsonOrThrow<T = Record<string, unknown>>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw aiHttpError(res.status, body);
  }
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`返回内容异常（非 JSON，可能被限流或内容过大）：${raw.slice(0, 120)}`);
  }
}
