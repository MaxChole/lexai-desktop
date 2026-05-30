export interface LexaiAPI {
  health: () => Promise<{ status: string; timestamp?: string; message?: string }>;
}

export interface LexaiBridge {
  api: LexaiAPI;
  platform: string;
  onNotification: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    lexai: LexaiBridge;
  }
}