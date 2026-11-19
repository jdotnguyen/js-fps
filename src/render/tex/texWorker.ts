import { TEXTURE_SPECS, type TextureKey, type TexSet } from './generators.ts';

export interface TexWorkerRequest {
  keys: TextureKey[];
  size: number;
}

export interface TexWorkerResponse {
  sets: TexSet[];
}

self.onmessage = (e: MessageEvent<TexWorkerRequest>): void => {
  const { keys, size } = e.data;
  const sets: TexSet[] = [];
  const transfers: ArrayBuffer[] = [];
  for (const key of keys) {
    const set = TEXTURE_SPECS[key](size);
    sets.push(set);
    transfers.push(set.albedo.buffer, set.orm.buffer, set.normal.buffer);
  }
  self.postMessage({ sets } satisfies TexWorkerResponse, { transfer: transfers });
};
