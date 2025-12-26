import { useRef, useCallback } from "react";
import {
  TimelineTrack,
  TimelineElement,
  MediaElement,
  TextElement,
} from "@/types/timeline";
import { MediaFile } from "@/types/media";
import { TProject } from "@/types/project";

interface CachedFrame {
  imageData: ImageData;
  timelineHash: string;
  timestamp: number;
  bytes: number;
}

interface FrameCacheOptions {
  maxCacheSize?: number; // Maximum number of cached frames
  cacheResolution?: number; // Frames per second to cache at
  maxCacheBytes?: number; // Maximum total bytes across cached frames
}

// Shared singleton cache across hook instances (HMR-safe)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __frameCacheGlobal: any = globalThis as any;
const __sharedFrameCache: Map<number, CachedFrame> =
  __frameCacheGlobal.__sharedFrameCache ?? new Map<number, CachedFrame>();
__frameCacheGlobal.__sharedFrameCache = __sharedFrameCache;
const __sharedFrameCacheMeta: { totalBytes: number } =
  __frameCacheGlobal.__sharedFrameCacheMeta ?? { totalBytes: 0 };
__frameCacheGlobal.__sharedFrameCacheMeta = __sharedFrameCacheMeta;

export function useFrameCache(options: FrameCacheOptions = {}) {
  const deviceMemoryGb =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? (navigator as any).deviceMemory
      : undefined;
  const inferredMaxBytes =
    typeof deviceMemoryGb === "number"
      ? Math.floor(Math.max(16, Math.min(256, deviceMemoryGb * 16)) * 1024 * 1024)
      : 64 * 1024 * 1024;

  const {
    maxCacheSize = 300,
    cacheResolution = 30,
    maxCacheBytes = inferredMaxBytes,
  } = options; // Default: ~10 seconds at 30fps, but byte-capped.

  const frameCacheRef = useRef(__sharedFrameCache);

  // Generate a hash of the timeline state that affects rendering
  const getTimelineHash = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): string => {
      // Get elements that are active at this time
      const activeElements: Array<{
        id: string;
        type: string;
        startTime: number;
        duration: number;
        trimStart: number;
        trimEnd: number;
        mediaId?: string;
        // Text-specific properties
        content?: string;
        fontSize?: number;
        fontFamily?: string;
        color?: string;
        backgroundColor?: string;
        x?: number;
        y?: number;
        rotation?: number;
        opacity?: number;
      }> = [];

      for (const track of tracks) {
        if (track.muted) continue;

        for (const element of track.elements) {
          // Check if element has hidden property (some elements might not have it)
          const isHidden = "hidden" in element ? element.hidden : false;
          if (isHidden) continue;

          const elementStart = element.startTime;
          const elementEnd =
            element.startTime +
            (element.duration - element.trimStart - element.trimEnd);

          if (time >= elementStart && time < elementEnd) {
            if (element.type === "media") {
              const mediaElement = element as MediaElement;
              activeElements.push({
                id: element.id,
                type: element.type,
                startTime: element.startTime,
                duration: element.duration,
                trimStart: element.trimStart,
                trimEnd: element.trimEnd,
                mediaId: mediaElement.mediaId,
              });
            } else if (element.type === "text") {
              const textElement = element as TextElement;
              activeElements.push({
                id: element.id,
                type: element.type,
                startTime: element.startTime,
                duration: element.duration,
                trimStart: element.trimStart,
                trimEnd: element.trimEnd,
                content: textElement.content,
                fontSize: textElement.fontSize,
                fontFamily: textElement.fontFamily,
                color: textElement.color,
                backgroundColor: textElement.backgroundColor,
                x: textElement.x,
                y: textElement.y,
                rotation: textElement.rotation,
                opacity: textElement.opacity,
              });
            }
          }
        }
      }

      // Include project settings that affect rendering
      const projectState = {
        backgroundColor: activeProject?.backgroundColor,
        backgroundType: activeProject?.backgroundType,
        blurIntensity: activeProject?.blurIntensity,
        canvasSize: activeProject?.canvasSize,
      };

      const hash = {
        activeElements,
        projectState,
        sceneId,
        time: Math.floor(time * cacheResolution) / cacheResolution,
      };
      return JSON.stringify(hash);
    },
    [cacheResolution]
  );

  // Check if a frame is cached and valid
  const isFrameCached = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): boolean => {
      const frameKey = Math.floor(time * cacheResolution);
      const cached = frameCacheRef.current.get(frameKey);

      if (!cached) return false;

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );
      return cached.timelineHash === currentHash;
    },
    [getTimelineHash, cacheResolution]
  );

  // Get cached frame if available and valid
  const getCachedFrame = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): ImageData | null => {
      const frameKey = Math.floor(time * cacheResolution);
      const cached = frameCacheRef.current.get(frameKey);

      if (!cached) {
        return null;
      }

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );
      if (cached.timelineHash !== currentHash) {
        // Cache is stale, remove it
        __sharedFrameCacheMeta.totalBytes -= cached.bytes;
        frameCacheRef.current.delete(frameKey);
        return null;
      }

      return cached.imageData;
    },
    [getTimelineHash, cacheResolution]
  );

  // Cache a rendered frame
  const cacheFrame = useCallback(
    (
      time: number,
      imageData: ImageData,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): void => {
      const frameKey = Math.floor(time * cacheResolution);
      const timelineHash = getTimelineHash(
        time,
        tracks,
        mediaFiles,
        activeProject,
        sceneId
      );

      const bytes = imageData.data.byteLength;
      // If a single frame is too large, caching will cause memory spikes; skip caching.
      if (bytes > maxCacheBytes / 4) return;

      const existing = frameCacheRef.current.get(frameKey);
      if (existing) {
        __sharedFrameCacheMeta.totalBytes -= existing.bytes;
      }

      // Enforce cache size limit (LRU eviction)
      if (frameCacheRef.current.size >= maxCacheSize) {
        // Remove oldest entries
        const entries = Array.from(frameCacheRef.current.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

        // Remove oldest 20% of entries
        const toRemove = Math.floor(entries.length * 0.2);
        for (let i = 0; i < toRemove; i++) {
          __sharedFrameCacheMeta.totalBytes -= entries[i][1].bytes;
          frameCacheRef.current.delete(entries[i][0]);
        }
      }

      // Enforce total byte limit (remove oldest until under limit).
      if (__sharedFrameCacheMeta.totalBytes + bytes > maxCacheBytes) {
        const entries = Array.from(frameCacheRef.current.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (const [key, value] of entries) {
          if (__sharedFrameCacheMeta.totalBytes + bytes <= maxCacheBytes) break;
          __sharedFrameCacheMeta.totalBytes -= value.bytes;
          frameCacheRef.current.delete(key);
        }
      }

      frameCacheRef.current.set(frameKey, {
        imageData,
        timelineHash,
        timestamp: Date.now(),
        bytes,
      });
      __sharedFrameCacheMeta.totalBytes += bytes;
    },
    [getTimelineHash, cacheResolution, maxCacheSize, maxCacheBytes]
  );

  // Clear cache when timeline changes significantly
  const invalidateCache = useCallback(() => {
    for (const [, value] of frameCacheRef.current.entries()) {
      __sharedFrameCacheMeta.totalBytes -= value.bytes;
    }
    frameCacheRef.current.clear();
  }, []);

  // Get render status for timeline indicator
  const getRenderStatus = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      sceneId?: string
    ): "cached" | "not-cached" => {
      return isFrameCached(time, tracks, mediaFiles, activeProject, sceneId)
        ? "cached"
        : "not-cached";
    },
    [isFrameCached]
  );

  // Pre-render frames around current time
  const preRenderNearbyFrames = useCallback(
    async (
      currentTime: number,
      tracks: TimelineTrack[],
      mediaFiles: MediaFile[],
      activeProject: TProject | null,
      renderFunction: (time: number) => Promise<ImageData>,
      sceneId?: string,
      range: number = 3 // seconds
    ) => {
      const framesToPreRender: number[] = [];

      // Calculate frames to pre-render (around current time)
      for (
        let offset = -range;
        offset <= range;
        offset += 1 / cacheResolution
      ) {
        const time = currentTime + offset;
        if (time < 0) continue;

        if (!isFrameCached(time, tracks, mediaFiles, activeProject, sceneId)) {
          framesToPreRender.push(time);
        }
      }

      // Expand to full 1-second buckets to avoid fragmented tiny cache regions
      const secondsToPreRender = new Set<number>();
      for (const t of framesToPreRender) {
        secondsToPreRender.add(Math.floor(t));
      }

      const expandedTimes: number[] = [];
      for (const s of secondsToPreRender) {
        for (let k = 0; k < cacheResolution; k++) {
          const t = s + k / cacheResolution;
          if (t < 0) continue;
          if (!isFrameCached(t, tracks, mediaFiles, activeProject, sceneId)) {
            expandedTimes.push(t);
          }
        }
      }

      // Sort forward-first near currentTime to improve perceived responsiveness
      expandedTimes.sort((a, b) => {
        const da = a >= currentTime ? a - currentTime : currentTime - a + 1e6;
        const db = b >= currentTime ? b - currentTime : currentTime - b + 1e6;
        return da - db;
      });

      // Cap total scheduled renders to avoid jank (e.g., up to 90 frames)
      const CAP = Math.max(30, Math.min(90, cacheResolution * 3));
      const toSchedule = expandedTimes.slice(0, CAP);

      // Pre-render during idle time
      for (const time of toSchedule) {
        requestIdleCallback(async () => {
          try {
            const imageData = await renderFunction(time);
            cacheFrame(
              time,
              imageData,
              tracks,
              mediaFiles,
              activeProject,
              sceneId
            );
          } catch (error) {
            console.warn(`Pre-render failed for time ${time}:`, error);
          }
        });
      }
    },
    [isFrameCached, cacheFrame, cacheResolution]
  );

  return {
    isFrameCached,
    getCachedFrame,
    cacheFrame,
    invalidateCache,
    getRenderStatus,
    preRenderNearbyFrames,
    cacheSize: frameCacheRef.current.size,
  };
}
