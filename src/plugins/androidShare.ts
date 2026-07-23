import { registerPlugin } from "@capacitor/core";

interface AndroidSharePlugin {
  saveImage(options: { dataUrl: string; fileName: string }): Promise<{ uri: string }>;
  shareImage(options: {
    dataUrl: string;
    fileName: string;
    title?: string;
    text?: string;
  }): Promise<void>;
}

export const AndroidShare = registerPlugin<AndroidSharePlugin>("AndroidShare");
