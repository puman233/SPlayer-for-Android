import { registerPlugin } from "@capacitor/core";

export interface AndroidLyricDirectory {
  uri: string;
  name: string;
}

export interface AndroidLyricPickResult extends Partial<AndroidLyricDirectory> {
  cancelled: boolean;
}

export type AndroidLyricFormat = "ttml" | "yrc" | "lrc";

export interface AndroidLyricMetadata {
  album?: string;
  musicName?: string;
  artists?: string;
  ncmMusicId?: string;
}

export interface AndroidLyricIndexEntry {
  uri: string;
  name: string;
  lastModified: number;
  directoryUri: string;
  format: AndroidLyricFormat;
  metadata?: AndroidLyricMetadata;
}

export interface AndroidLyricEntry {
  uri: string;
  name: string;
  lastModified: number;
  directoryUri: string;
  format: AndroidLyricFormat;
  metadata: AndroidLyricMetadata;
}

export interface AndroidLyricScanMeta {
  lastScanAt: number;
  totalFiles: number;
  matchedFiles: number;
  duplicateIds: number;
  failedFiles: number;
}

export interface AndroidLyricScanFailure {
  uri: string;
  name: string;
  reason: string;
  directoryUri: string;
}

export interface AndroidLyricScanSummary extends Omit<AndroidLyricScanMeta, "lastScanAt"> {
  indexMap: Record<string, AndroidLyricIndexEntry>;
  entries?: AndroidLyricEntry[];
  failures?: AndroidLyricScanFailure[];
}

export interface AndroidSidecarLyricResult {
  content: string;
  format: AndroidLyricFormat;
}

export interface AndroidLocalLyricPlugin {
  pickLyricDirectory(): Promise<AndroidLyricPickResult>;
  scanLyricDirectories(options: {
    directories: AndroidLyricDirectory[];
  }): Promise<AndroidLyricScanSummary>;
  readLyricFile(options: { uri: string }): Promise<{ content: string }>;
  findSidecarLyric(options: { audioPath: string }): Promise<AndroidSidecarLyricResult>;
}

export const AndroidLocalLyric = registerPlugin<AndroidLocalLyricPlugin>("AndroidLocalLyric");
