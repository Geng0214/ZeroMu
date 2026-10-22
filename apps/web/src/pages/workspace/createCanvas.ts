import axios from 'axios';
import useWorkspaceFiles from '@/lib/workspaceFiles';
import { isCanvasFile } from './canvasFile';

export default async function createCanvas(directory: string, signal?: AbortSignal) {
  const files = useWorkspaceFiles(directory);
  const entries = (await files.list()).entries.filter(item => item.type === 'file' && /\.json$/i.test(item.name));
  let count = 0;
  let highestNumber = 0;
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (!await isCanvasFile(files, entry.path)) continue;
    count++;
    const number = Number(entry.name.match(/^(?:无限)?画布(\d+)\.json$/i)?.[1] ?? 0);
    if (Number.isSafeInteger(number)) highestNumber = Math.max(highestNumber, number);
  }
  const flow = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  for (let number = Math.max(count, highestNumber) + 1; ; number++) {
    signal?.throwIfAborted();
    const name = `无限画布${number}`;
    const id = `${name}.json`;
    try {
      await files.write(id, JSON.stringify({ toonflowCanvas: true, ...flow }), true, signal);
      return { id, name, flow };
    } catch (error) {
      if (!axios.isAxiosError<{ data?: { code?: string } }>(error) || error.response?.status !== 409 || error.response.data.data?.code !== 'EEXIST') throw error;
    }
  }
}
