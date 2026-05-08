import { contextBridge, ipcRenderer } from 'electron';
import type { ImportedExcelFile, LuminanceApi, SvgExportFile } from '../types';

const api: LuminanceApi = {
  selectExcelFiles: () => ipcRenderer.invoke('files:selectExcelFiles') as Promise<ImportedExcelFile[]>,
  saveChartImage: (dataUrl: string) => ipcRenderer.invoke('chart:saveImage', dataUrl) as Promise<string | null>,
  saveChartSvg: (svg: string) => ipcRenderer.invoke('chart:saveSvg', svg) as Promise<string | null>,
  saveLayeredSvgs: (files: SvgExportFile[]) => ipcRenderer.invoke('chart:saveLayeredSvgs', files) as Promise<string[]>,
  saveCleanWorkbook: (base64: string) => ipcRenderer.invoke('data:saveCleanWorkbook', base64) as Promise<string | null>,
};

contextBridge.exposeInMainWorld('luminanceAPI', api);
