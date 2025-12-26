import streamSaver from "streamsaver";

export function createDownloadWriteStream({
  filename,
}: {
  filename: string;
}): WritableStream<Uint8Array> {
  // OpenCut uses a fixed basePath.
  streamSaver.mitm = "/opencut/streamsaver/mitm.html";
  return streamSaver.createWriteStream(filename) as unknown as WritableStream<Uint8Array>;
}

