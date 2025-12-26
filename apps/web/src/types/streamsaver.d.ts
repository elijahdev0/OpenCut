declare module "streamsaver" {
  export type StreamSaverCreateWriteStreamOptions = {
    size?: number;
    writableStrategy?: QueuingStrategy<Uint8Array>;
    readableStrategy?: QueuingStrategy<Uint8Array>;
  };

  export type StreamSaver = {
    mitm: string;
    createWriteStream: (
      filename: string,
      options?: StreamSaverCreateWriteStreamOptions
    ) => WritableStream<Uint8Array>;
  };

  const streamSaver: StreamSaver;
  export default streamSaver;
}

