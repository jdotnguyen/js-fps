import { buildNavMeshBytes, initNavmesh, sampleNavMeshNodes, type NavmeshWorkerReply, type NavmeshWorkerRequest } from './navmeshBuild.ts';

self.onmessage = async (e: MessageEvent<NavmeshWorkerRequest>): Promise<void> => {
  try {
    await initNavmesh();
    const bytes = buildNavMeshBytes(e.data.boxes, e.data.doors);
    const sampleNodes = sampleNavMeshNodes(bytes);
    const reply: NavmeshWorkerReply = { bytes, sampleNodes };
    self.postMessage(reply, { transfer: [bytes.buffer, sampleNodes.buffer] });
  } catch (err) {
    const reply: NavmeshWorkerReply = { error: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
