export interface ProgressWriter {
  write(data: Record<string, unknown>): Promise<void>;
}
