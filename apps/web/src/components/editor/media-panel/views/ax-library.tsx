"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore } from "@/stores/media-store";
import { processMediaFiles } from "@/lib/media-processing";

type AxAsset = {
  id: string;
  url: string | null;
  kind: "image" | "video" | "audio" | "text" | "model" | "file" | "unknown";
  status: "pending" | "processing" | "completed" | "failed";
  name: string;
  createdAt: string;
  contentType: string | null;
};

function sanitizeName(name: string) {
  return name
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/[^\w.\-()+\s]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 140);
}

function extensionFromContentType(contentType: string | null) {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("quicktime")) return "mov";
  if (t.includes("mpeg")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("flac")) return "flac";
  if (t.includes("m4a") || t.includes("mp4")) return "m4a";
  return "bin";
}

async function fetchAxAssets(cursor?: string | null) {
  const params = new URLSearchParams();
  params.set("type", "all");
  params.set("source", "all");
  params.set("origin", "all");
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`/api/library/assets?${params.toString()}`, {
    credentials: "include",
  });
  const json = (await res.json().catch(() => null)) as
    | { assets?: AxAsset[]; nextCursor?: string | null; error?: string }
    | null;

  if (!res.ok) {
    throw new Error(json?.error ?? `Failed to load library (${res.status})`);
  }

  return {
    assets: (json?.assets ?? []) as AxAsset[],
    nextCursor: (json?.nextCursor ?? null) as string | null,
  };
}

export function AxLibraryView() {
  const { activeProject } = useProjectStore();
  const { addMediaFile } = useMediaStore();

  const [assets, setAssets] = useState<AxAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  const load = async (mode: "initial" | "more") => {
    setLoading(true);
    try {
      const data = await fetchAxAssets(mode === "more" ? cursor : null);
      setAssets((prev) => (mode === "more" ? [...prev, ...data.assets] : data.assets));
      setCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.nextCursor));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const data = await fetchAxAssets(null);
        if (cancelled) return;
        setAssets(data.assets);
        setCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Failed to load Ax Library");
      }
    };

    setLoading(true);
    run()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const importable = useMemo(
    () =>
      assets.filter(
        (a) =>
          a.status === "completed" &&
          (a.kind === "image" || a.kind === "video" || a.kind === "audio")
      ),
    [assets]
  );

  const importAsset = async (asset: AxAsset) => {
    if (!activeProject) {
      toast.error("No active project");
      return;
    }
    if (!asset.id) return;

    setImportingId(asset.id);
    try {
      const res = await fetch(`/api/library/download/${asset.id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to download (${res.status})`);
      }
      const blob = await res.blob();
      const contentType =
        asset.contentType ?? blob.type ?? "application/octet-stream";

      const base =
        sanitizeName(asset.name) ?? sanitizeName(`asset-${asset.id}`) ?? `asset-${asset.id}`;
      const ext = extensionFromContentType(contentType);
      const filename = base.includes(".") ? base : `${base}.${ext}`;
      const file = new File([blob], filename, { type: contentType });

      const processed = await processMediaFiles([file]);
      for (const item of processed) {
        await addMediaFile(activeProject.id, {
          ...item,
          axGenerationId: asset.id,
          axSource: "ax",
        });
      }
      toast.success("Imported into project");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">Ax Library</div>
        <div className="flex items-center gap-2">
          <Button
            disabled={loading}
            onClick={() => load("initial")}
            size="sm"
            variant="secondary"
          >
            Refresh
          </Button>
        </div>
      </div>

      {!activeProject ? (
        <div className="text-sm text-muted-foreground">
          Open a project to import assets.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {importable.map((asset) => (
          <button
            className="flex flex-col gap-2 rounded-md border border-border bg-background p-2 text-left hover:bg-muted/50"
            disabled={!activeProject || importingId === asset.id}
            key={asset.id}
            onClick={() => importAsset(asset)}
            type="button"
          >
            <div className="truncate text-xs text-muted-foreground">
              {asset.kind.toUpperCase()}
            </div>
            <div className="truncate text-sm font-medium">{asset.name}</div>
            <div className="mt-auto flex items-center justify-between">
              <div className="truncate text-xs text-muted-foreground">
                {new Date(asset.createdAt).toLocaleString()}
              </div>
              <div className="text-xs font-medium">
                {importingId === asset.id ? "Importing…" : "Import"}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-center">
        {hasMore ? (
          <Button
            disabled={loading}
            onClick={() => load("more")}
            variant="outline"
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
