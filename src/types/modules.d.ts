declare module 'pdf-parse-debugging-disabled' {
  function pdfParse(buffer: Buffer): Promise<{ text: string; numpages: number; info: Record<string, unknown>; metadata: unknown; version: string }>;
  export default pdfParse;
}

declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  export function extractRawText(options: { buffer: Buffer }): Promise<ExtractResult>;
}
