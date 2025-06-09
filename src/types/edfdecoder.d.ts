declare module "edfdecoder" {
  export class EDFDecoder {
    constructor();
    setInput(buffer: Buffer): void;
    decode(): void;
    getHeader(): any;
    getSignals(): any[];
  }
}
