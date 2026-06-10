import type { MemedModuleInitPayload } from './types';

declare global {
  interface Window {
    MdHub?: {
      command?: {
        send: (module: string, command: string, payload?: unknown) => Promise<unknown> | unknown;
      };
      module?: {
        show: (module: string) => void;
        hide?: (module: string) => void;
        waitForReady?: () => Promise<void>;
      };
      event?: {
        add: (event: string, callback: (data: unknown) => void) => void;
        trigger?: (event: string, data?: unknown) => void;
      };
      server?: {
        unbindEvents?: () => void;
      };
    };
    MdSinapsePrescricao?: {
      event?: {
        add: (event: string, callback: (module: MemedModuleInitPayload) => void) => void;
      };
      setToken?: (token: string) => void;
    };
  }
}

export {};
