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

declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
    getHeaders(): string;
    getFooters(): string;
    getFootnotes(): string;
  }
  class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>;
  }
  export default WordExtractor;
}
