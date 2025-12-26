import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  StreamTarget,
  type StreamTargetChunk,
  CanvasSource,
  AudioBufferSource,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
} from "mediabunny";
import { renderTimelineFrame } from "./timeline-renderer";
import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";
import { DEFAULT_FPS, DEFAULT_CANVAS_SIZE } from "@/stores/project-store";
import { ExportOptions, ExportResult } from "@/types/export";
import { TimelineTrack } from "@/types/timeline";
import { MediaFile } from "@/types/media";

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "mp4",
  quality: "high",
  includeAudio: true,
};

const qualityMap = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  very_high: QUALITY_VERY_HIGH,
};

async function createTimelineAudioBuffer(
  tracks: TimelineTrack[],
  mediaFiles: MediaFile[],
  duration: number,
  sampleRate: number = 44100
): Promise<AudioBuffer | null> {
  // Mix using OfflineAudioContext to avoid huge JS-side nested loops.
  const Ctx =
    window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!Ctx) return null;

  const mediaMap = new Map<string, MediaFile>(mediaFiles.map((m) => [m.id, m]));
  const audioElements: Array<{
    file: File;
    name: string;
    startTime: number;
    duration: number;
    trimStart: number;
    trimEnd: number;
    muted: boolean;
  }> = [];

  for (const track of tracks) {
    if (track.muted) continue;
    for (const element of track.elements) {
      if (element.type !== "media") continue;
      const mediaItem = mediaMap.get(element.mediaId);
      if (!mediaItem || mediaItem.type !== "audio") continue;

      const visibleDuration = element.duration - element.trimStart - element.trimEnd;
      if (visibleDuration <= 0) continue;

      audioElements.push({
        file: mediaItem.file,
        name: mediaItem.name,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart,
        trimEnd: element.trimEnd,
        muted: !!element.muted || !!track.muted,
      });
    }
  }

  const renderLength = Math.max(1, Math.ceil(duration * sampleRate));
  const offline = new Ctx(2, renderLength, sampleRate) as OfflineAudioContext;

  const decodeContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)();

  try {
    for (const el of audioElements) {
      if (el.muted) continue;
      const visibleDuration = el.duration - el.trimStart - el.trimEnd;
      if (visibleDuration <= 0) continue;

      try {
        const arrayBuffer = await el.file.arrayBuffer();
        const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));

        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);

        const when = Math.max(0, el.startTime);
        const offset = Math.max(0, el.trimStart);
        const playDuration = Math.max(0, Math.min(visibleDuration, decoded.duration - offset));
        if (playDuration > 0) {
          src.start(when, offset, playDuration);
        }
      } catch (error) {
        console.warn(`Failed to decode audio file ${el.name}:`, error);
      }
    }

    const mixed = await offline.startRendering();
    return mixed;
  } finally {
    try {
      await decodeContext.close();
    } catch {}
  }
}

export async function exportProject(
  options: ExportOptions
): Promise<ExportResult> {
  const {
    format,
    quality,
    fps,
    includeAudio,
    fileHandle,
    writableStream,
    onProgress,
    onCancel,
  } = options;

  try {
    const timelineStore = useTimelineStore.getState();
    const mediaStore = useMediaStore.getState();
    const projectStore = useProjectStore.getState();

    const { tracks, getTotalDuration } = timelineStore;
    const { mediaFiles } = mediaStore;
    const { activeProject } = projectStore;

    if (!activeProject) {
      return { success: false, error: "No active project" };
    }

    const duration = getTotalDuration();
    if (duration === 0) {
      return { success: false, error: "Project is empty" };
    }

    const exportFps = fps || activeProject.fps || DEFAULT_FPS;
    const canvasSize = activeProject.canvasSize || DEFAULT_CANVAS_SIZE;

    const outputFormat =
      format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

    // Prefer streaming (disk or SW-backed) when possible to avoid holding large outputs in memory.
    const writable = fileHandle ? await fileHandle.createWritable() : null;

    const streamWritable: WritableStream<StreamTargetChunk> | null = writable
      ? // FileSystemWritableFileStream accepts chunk objects (including position), so pass through.
        (writable as unknown as WritableStream<StreamTargetChunk>)
      : writableStream
        ? // Wrap a byte-only stream (e.g. StreamSaver) into the chunked form Mediabunny expects.
          (() => {
            const byteWriter = writableStream.getWriter();
            return new WritableStream<StreamTargetChunk>({
              async write(chunk) {
                await byteWriter.write(chunk.data);
              },
              async close() {
                try {
                  await byteWriter.close();
                } finally {
                  byteWriter.releaseLock();
                }
              },
              async abort(reason) {
                try {
                  await byteWriter.abort(reason);
                } finally {
                  byteWriter.releaseLock();
                }
              },
            });
          })()
        : null;

    const target = streamWritable
      ? new StreamTarget(streamWritable, { chunked: true })
      : new BufferTarget();
    const output = new Output({
      format: outputFormat,
      target,
    });

    // Canvas for rendering
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return { success: false, error: "Failed to create canvas context" };
    }

    const videoSource = new CanvasSource(canvas, {
      codec: format === "webm" ? "vp9" : "avc", // VP9 for WebM, H.264 for MP4
      bitrate: qualityMap[quality],
    });

    output.addVideoTrack(videoSource, { frameRate: exportFps });

    // Add audio track if requested (but don't add data yet)
    let audioSource: AudioBufferSource | null = null;
    let audioBuffer: AudioBuffer | null = null;

    if (includeAudio) {
      onProgress?.(0.05); // 5% for audio processing

      audioBuffer = await createTimelineAudioBuffer(
        tracks,
        mediaFiles,
        duration
      );

      if (audioBuffer) {
        audioSource = new AudioBufferSource({
          codec: format === "webm" ? "opus" : "aac", // Opus for WebM, AAC for MP4
          bitrate: qualityMap[quality], // Use same quality for audio
        });

        output.addAudioTrack(audioSource);
      }
    }

    // Start the output (after all tracks are added)
    await output.start();

    // Now add audio data after starting
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer);
      audioSource.close();
    }

    const totalFrames = Math.ceil(duration * exportFps);
    let cancelled = false;

    // Render each frame
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      // Check for cancellation
      if (onCancel?.()) {
        cancelled = true;
        break;
      }

      const time = frameIndex / exportFps;

      await renderTimelineFrame({
        ctx,
        time,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        tracks,
        mediaFiles,
        backgroundType: activeProject.backgroundType,
        blurIntensity: activeProject.blurIntensity,
        backgroundColor:
          activeProject.backgroundType === "blur"
            ? undefined
            : activeProject.backgroundColor || "#000000",
        projectCanvasSize: canvasSize,
      });

      const frameDuration = 1 / exportFps;
      await videoSource.add(time, frameDuration);

      // Adjust progress to account for audio processing (5% at start)
      const videoProgress = includeAudio
        ? 0.05 + (frameIndex / totalFrames) * 0.95
        : frameIndex / totalFrames;
      onProgress?.(videoProgress);
    }

    if (cancelled) {
      await output.cancel();
      if (writable) {
        try {
          await writable.abort();
        } catch {}
      }
      return { success: false, cancelled: true };
    }
    videoSource.close();
    await output.finalize();
    if (writable) {
      await writable.close();
    }
    onProgress?.(1);

    return {
      success: true,
      savedToFile: !!streamWritable,
      buffer: !streamWritable
        ? (target as BufferTarget).buffer || undefined
        : undefined,
    };
  } catch (error) {
    console.error("Export failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown export error",
    };
  }
}

export function getExportMimeType(format: "mp4" | "webm"): string {
  return format === "webm" ? "video/webm" : "video/mp4";
}

export function getExportFileExtension(format: "mp4" | "webm"): string {
  return `.${format}`;
}
