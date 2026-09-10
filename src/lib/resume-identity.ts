const RESUME_EXTENSION = /\.(?:pdf|docx?|rtf|txt|png|jpe?g|webp)$/i;

function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

/**
 * Conservative safety check for repush attachments. A candidate's full name or
 * one meaningful name segment must be present in the original resume filename.
 * Missing legacy metadata is allowed; an explicit mismatch is not.
 */
export function resumeFileMatchesCandidate(candidateName?: string, resumeFileName?: string): boolean {
  if (!candidateName?.trim() || !resumeFileName?.trim()) return true;

  let decodedFileName = resumeFileName;
  try { decodedFileName = decodeURIComponent(resumeFileName); } catch { /* keep original */ }

  const fileStem = normalizeIdentityText(decodedFileName.replace(RESUME_EXTENSION, ''));
  const wholeName = normalizeIdentityText(candidateName);
  if (!fileStem || !wholeName || fileStem.includes(wholeName)) return true;

  const nameParts = candidateName
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^a-z0-9\u3400-\u9fff]+/)
    .map(normalizeIdentityText)
    .filter((part) => part.length >= 2);

  return nameParts.length === 0 || nameParts.some((part) => fileStem.includes(part));
}
