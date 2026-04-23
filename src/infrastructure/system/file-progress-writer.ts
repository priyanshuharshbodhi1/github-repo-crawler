import type { ProgressWriter } from '../../domain/progress-writer';
import { writeJsonFile } from './file-output';

export class FileProgressWriter implements ProgressWriter {
  constructor(private readonly path: string) {}

  async write(data: Record<string, unknown>): Promise<void> {
    await writeJsonFile(this.path, data);
  }
}
