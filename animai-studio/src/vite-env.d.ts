/// <reference types="vite/client" />

interface AnimaiDesktop {
  isDesktop: boolean;
  userDataPath(): Promise<string>;
  saveDialog(opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  openDialog(opts: {
    title?: string;
    properties?: string[];
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string[]>;
  writeFile(filePath: string, data: string | number[], encoding: "utf8" | "base64" | "binary"): Promise<boolean>;
  readFile(filePath: string, encoding: "utf8" | "base64" | "binary"): Promise<string | number[] | null>;
  writeAutosave(dataBase64: string): Promise<string>;
  readAutosave(): Promise<{ path: string; meta: { savedAt: number } | null; dataBase64: string } | null>;
  appendLog(line: string): Promise<boolean>;
  openPath(p: string): Promise<void>;
}

interface Window {
  animaiDesktop?: AnimaiDesktop;
}
