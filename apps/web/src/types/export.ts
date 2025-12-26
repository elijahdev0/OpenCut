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
