import { create } from "zustand";
import { storageService } from "@/lib/storage/storage-service";
import { useTimelineStore } from "./timeline-store";
import { generateUUID } from "@/lib/utils";
import { MediaType, MediaFile } from "@/types/media";
import { videoCache } from "@/lib/video-cache";

interface MediaStore {
  mediaFiles: MediaFile[];
  isLoading: boolean;

  // Actions
  addMediaFile: (
    projectId: string,
    file: Omit<MediaFile, "id">
  ) => Promise<void>;
  removeMediaFile: (projectId: string, id: string) => Promise<void>;
  loadProjectMedia: (projectId: string) => Promise<void>;
  clearProjectMedia: (projectId: string) => Promise<void>;
  clearAllMedia: () => void;
}

// Helper function to determine file type
export const getFileType = (file: File): MediaType | null => {
  const { type } = file;

  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }

  return null;
};

// Helper function to get image dimensions
export const getImageDimensions = (
  file: File
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);

    img.addEventListener("load", () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      resolve({ width, height });
      URL.revokeObjectURL(url);
      img.remove();
    });

    img.addEventListener("error", () => {
      reject(new Error("Could not load image"));
      URL.revokeObjectURL(url);
      img.remove();
    });

    img.src = url;
  });
};

// Helper function to generate video thumbnail and get dimensions
export const generateVideoThumbnail = (
  file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as HTMLVideoElement;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    const url = URL.createObjectURL(file);

    if (!ctx) {
      URL.revokeObjectURL(url);
      reject(new Error("Could not get canvas context"));
      return;
    }

    video.addEventListener("loadedmetadata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Seek to 1 second or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
      const width = video.videoWidth;
      const height = video.videoHeight;

      resolve({ thumbnailUrl, width, height });

      // Cleanup
      URL.revokeObjectURL(url);
      video.src = "";
      video.remove();
      canvas.remove();
    });

    video.addEventListener("error", () => {
      reject(new Error("Could not load video"));
      URL.revokeObjectURL(url);
      video.src = "";
      video.remove();
      canvas.remove();
    });

    video.src = url;
    video.load();
  });
};

// Helper function to get media duration
export const getMediaDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const element = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio"
    ) as HTMLVideoElement;
    const url = URL.createObjectURL(file);

    element.addEventListener("loadedmetadata", () => {
      resolve(element.duration);
      URL.revokeObjectURL(url);
      element.remove();
    });

    element.addEventListener("error", () => {
      reject(new Error("Could not load media"));
      URL.revokeObjectURL(url);
      element.remove();
    });

    element.src = url;
    element.load();
  });
};

export const getMediaAspectRatio = (item: MediaFile): number => {
  if (item.width && item.height) {
    return item.width / item.height;
  }
  return 16 / 9; // Default aspect ratio
};

type AxPresignResponse = {
  signedUrl: string;
  publicUrl: string;
  key?: string;
};

async function uploadMediaToAxLibrary({
  file,
}: {
  file: File;
}): Promise<string> {
  const contentType = file.type || "application/octet-stream";

  const presignRes = await fetch("/api/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      filename: file.name,
      contentType,
    }),
  });

  if (!presignRes.ok) {
    throw new Error(`Presign failed (${presignRes.status})`);
  }

  const presignJson = (await presignRes.json()) as AxPresignResponse;
  if (!presignJson?.signedUrl || !presignJson?.publicUrl) {
    throw new Error("Presign response missing signedUrl/publicUrl");
  }

  const putRes = await fetch(presignJson.signedUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }

  const registerRes = await fetch("/api/uploads/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      url: presignJson.publicUrl,
      name: file.name,
      contentType,
    }),
  });
  if (!registerRes.ok) {
    throw new Error(`Register failed (${registerRes.status})`);
  }

  const registerJson = (await registerRes.json().catch(() => null)) as
    | { ok?: boolean; id?: string }
    | null;
  if (!registerJson?.id) {
    throw new Error("Register response missing id");
  }

  return registerJson.id;
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  mediaFiles: [],
  isLoading: false,

  addMediaFile: async (projectId, file) => {
    const newItem: MediaFile = {
      ...file,
      id: generateUUID(),
    };

    // Add to local state immediately for UI responsiveness
    set((state) => ({
      mediaFiles: [...state.mediaFiles, newItem],
    }));

    // Save to persistent storage in background
    try {
      await storageService.saveMediaFile({ projectId, mediaItem: newItem });
    } catch (error) {
      console.error("Failed to save media item:", error);
      // Remove from local state if save failed
      set((state) => ({
        mediaFiles: state.mediaFiles.filter((media) => media.id !== newItem.id),
      }));
      return;
    }

    // AxNextGen integration:
    // If this was a local import (not from Ax library), upload it to the shared library.
    if (!newItem.ephemeral && !newItem.axGenerationId) {
      void (async () => {
        try {
          const axGenerationId = await uploadMediaToAxLibrary({
            file: newItem.file,
          });
          const updated: MediaFile = {
            ...newItem,
            axGenerationId,
            axSource: "local",
          };
          set((state) => ({
            mediaFiles: state.mediaFiles.map((m) =>
              m.id === newItem.id ? updated : m
            ),
          }));
          await storageService.saveMediaFile({ projectId, mediaItem: updated });
        } catch (error) {
          console.error("Failed to sync media to Ax library:", error);
        }
      })();
    }
  },

  removeMediaFile: async (projectId: string, id: string) => {
    const state = get();
    const item = state.mediaFiles.find((media) => media.id === id);

    videoCache.clearVideo(id);

    // Cleanup object URLs to prevent memory leaks
    if (item?.url) {
      URL.revokeObjectURL(item.url);
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    }

    // 1) Remove from local state immediately
    set((state) => ({
      mediaFiles: state.mediaFiles.filter((media) => media.id !== id),
    }));

    // 2) Cascade into the timeline: remove any elements using this media ID
    const timeline = useTimelineStore.getState();
    const { tracks, deleteSelected, setSelectedElements } = timeline;

    // Find all elements that reference this media
    const elementsToRemove: Array<{ trackId: string; elementId: string }> = [];
    for (const track of tracks) {
      for (const el of track.elements) {
        if (el.type === "media" && el.mediaId === id) {
          elementsToRemove.push({ trackId: track.id, elementId: el.id });
        }
      }
    }

    // If there are elements to remove, use unified delete function
    if (elementsToRemove.length > 0) {
      setSelectedElements(elementsToRemove);
      deleteSelected();
    }

    // 3) Remove from persistent storage
    try {
      await storageService.deleteMediaFile({ projectId, id });
    } catch (error) {
      console.error("Failed to delete media item:", error);
    }

    // AxNextGen integration: also delete from shared library (best-effort).
    if (item?.axGenerationId) {
      void fetch("/api/library/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: item.axGenerationId }),
      }).catch((error) => {
        console.error("Failed to delete from Ax library:", error);
      });
    }
  },

  loadProjectMedia: async (projectId) => {
    set({ isLoading: true });

    try {
      const mediaItems = await storageService.loadAllMediaFiles({ projectId });

      // Regenerate thumbnails for video items
      const updatedMediaItems = await Promise.all(
        mediaItems.map(async (item) => {
          if (item.type === "video" && item.file) {
            try {
              const { thumbnailUrl, width, height } =
                await generateVideoThumbnail(item.file);
              return {
                ...item,
                thumbnailUrl,
                width: width || item.width,
                height: height || item.height,
              };
            } catch (error) {
              console.error(
                `Failed to regenerate thumbnail for video ${item.id}:`,
                error
              );
              return item;
            }
          }
          return item;
        })
      );

      set({ mediaFiles: updatedMediaItems });
    } catch (error) {
      console.error("Failed to load media items:", error);
    } finally {
      set({ isLoading: false });
    }
  },

  clearProjectMedia: async (projectId) => {
    const state = get();

    // Cleanup all object URLs
    state.mediaFiles.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    });

    // Clear local state
    set({ mediaFiles: [] });

    // Clear persistent storage
    try {
      const mediaIds = state.mediaFiles.map((item) => item.id);
      await Promise.all(
        mediaIds.map((id) => storageService.deleteMediaFile({ projectId, id }))
      );
    } catch (error) {
      console.error("Failed to clear media items from storage:", error);
    }
  },

  clearAllMedia: () => {
    const state = get();

    videoCache.clearAll();

    // Cleanup all object URLs
    state.mediaFiles.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
      if (item.thumbnailUrl) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    });

    // Clear local state
    set({ mediaFiles: [] });
  },
}));
