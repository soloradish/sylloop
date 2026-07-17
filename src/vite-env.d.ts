/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
}

interface Window {
  __ECHO_PLAYER_E2E_OPEN_PATH__?: (path: string) => Promise<void>;
  __ECHO_PLAYER_E2E_SET_SELECTION__?: (startRatio: number, endRatio: number) => void;
}
