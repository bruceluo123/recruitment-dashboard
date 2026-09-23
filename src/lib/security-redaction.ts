const COMPROMISED_MMF_TG = /\s*@bruceluo123\b/gi;

/** 麦满分旧 TG 已被盗，任何业务文案和历史展示都不得继续暴露或复用。 */
export function redactCompromisedTelegram(value?: string): string {
  return String(value || '')
    .replace(COMPROMISED_MMF_TG, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}
