export type ExportFormat = "mp4" | "webm";
export type ExportQuality = "low" | "medium" | "high" | "very_high";

export interface ExportOptions {
  format: ExportFormat;
  quality: ExportQuality;
  fps?: number;
  includeAudio?: boolean;
  /**
   * If provided and the browser supports the File System Access API,
   * export will be streamed directly to disk to avoid large in-memory buffers.
   */
  fileHandle?: FileSystemFileHandle;
  /**
   * Writable stream fallback for browsers without File System Access API.
   * Intended for StreamTarget streaming (e.g. StreamSaver.js).
   */
  writableStream?: WritableStream<Uint8Array>;
  onProgress?: (progress: number) => void;
  onCancel?: () => boolean;
}

export interface ExportResult {
  success: boolean;
  buffer?: ArrayBuffer;
  savedToFile?: boolean;
  error?: string;
  cancelled?: boolean;
}
