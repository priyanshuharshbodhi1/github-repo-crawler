import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  const absolutePath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2), 'utf-8');
}
