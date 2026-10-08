import { contextBridge, ipcRenderer } from 'electron';

export interface LoadingStatusPayload {
  state: 'loading' | 'finishing' | 'error' | 'idle';
  message?: string;
  errorCode?: number;
  errorDescription?: string;
  lang?: string;
}

const loadingAPI = {
  notifyReady: () => {
    ipcRenderer.send('loading:ready');
  },
  retry: () => {
    ipcRenderer.send('loading:retry');
  },
  onStatus: (callback: (payload: LoadingStatusPayload) => void) => {
    const handler = (_event: any, payload: LoadingStatusPayload) => callback(payload);
    ipcRenderer.on('loading:status', handler);
    return () => {
      ipcRenderer.removeListener('loading:status', handler);
    };
  },
  onLanguageChange: (callback: (lang: string) => void) => {
    const handler = (_event: any, lang: string) => callback(lang);
    ipcRenderer.on('loading:language-change', handler);
    return () => {
      ipcRenderer.removeListener('loading:language-change', handler);
    };
  },
};

contextBridge.exposeInMainWorld('loadingAPI', loadingAPI);

export type LoadingAPI = typeof loadingAPI;
