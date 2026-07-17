/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
}

interface Window {
  __SYLLOOP_E2E_OPEN_PATH__?: (path: string) => Promise<void>;
  __SYLLOOP_E2E_SET_SELECTION__?: (startRatio: number, endRatio: number) => void;
}
