import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import type { ImportedExcelFile, SvgExportFile } from '../types';

let mainWindow: BrowserWindow | null = null;
const maxWorkbookBytes = 25 * 1024 * 1024;

const sanitizeFileName = (value: string): string => {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || 'luminance';
};

const assertSvgMarkup = (svg: string) => {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) {
    throw new Error('只能保存 SVG 标记。');
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: 'Luminance Curve',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('files:selectExcelFiles', async (): Promise<ImportedExcelFile[]> => {
  if (!mainWindow) return [];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入亮度数据',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Excel Workbooks', extensions: ['xlsx'] }],
  });

  if (result.canceled) return [];

  return Promise.all(
    result.filePaths.map(async (filePath) => {
      const buffer = await readFile(filePath);
      if (buffer.byteLength > maxWorkbookBytes) {
        throw new Error(`${path.basename(filePath)} 超过 25 MB，已拒绝导入。`);
      }
      return {
        name: path.basename(filePath),
        path: filePath,
        data: buffer.toString('base64'),
      };
    }),
  );
});

ipcMain.handle('files:selectDatabaseFiles', async (): Promise<ImportedExcelFile[]> => {
  if (!mainWindow) return [];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入亮度数据库',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });

  if (result.canceled) return [];

  return Promise.all(
    result.filePaths.map(async (filePath) => {
      const buffer = await readFile(filePath);
      if (buffer.byteLength > maxWorkbookBytes) {
        throw new Error(`${path.basename(filePath)} 超过 25 MB，已拒绝导入。`);
      }
      return {
        name: path.basename(filePath),
        path: filePath,
        data: buffer.toString('base64'),
      };
    }),
  );
});

ipcMain.handle('chart:saveImage', async (_event, dataUrl: string): Promise<string | null> => {
  if (!mainWindow) return null;
  const match = /^data:image\/png;base64,(?<data>[A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.groups?.data) {
    throw new Error('只能保存 PNG data URL。');
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出图表 PNG',
    defaultPath: 'luminance-curve.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });

  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, Buffer.from(match.groups.data, 'base64'));
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});

ipcMain.handle('chart:saveSvg', async (_event, svg: string): Promise<string | null> => {
  if (!mainWindow) return null;
  assertSvgMarkup(svg);

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出图表 SVG',
    defaultPath: 'luminance-curve.svg',
    filters: [{ name: 'SVG Image', extensions: ['svg'] }],
  });

  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, svg, 'utf8');
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});

ipcMain.handle('chart:saveLayeredSvgs', async (_event, files: SvgExportFile[]): Promise<string[]> => {
  if (!mainWindow) return [];
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('没有可保存的 SVG 文件。');
  }

  for (const file of files) {
    assertSvgMarkup(file.svg);
  }

  if (files.length === 1) {
    const file = files[0];
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 AI 分层 SVG',
      defaultPath: sanitizeFileName(file.fileName),
      filters: [{ name: 'SVG Image', extensions: ['svg'] }],
    });

    if (result.canceled || !result.filePath) return [];

    await writeFile(result.filePath, file.svg, 'utf8');
    shell.showItemInFolder(result.filePath);
    return [result.filePath];
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 AI 分层 SVG 导出文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  const outputDir = result.filePaths[0];
  const savedPaths = await Promise.all(
    files.map(async (file) => {
      const fileName = sanitizeFileName(file.fileName.toLowerCase().endsWith('.svg') ? file.fileName : `${file.fileName}.svg`);
      const filePath = path.join(outputDir, fileName);
      await writeFile(filePath, file.svg, 'utf8');
      return filePath;
    }),
  );

  shell.showItemInFolder(savedPaths[0]);
  return savedPaths;
});

ipcMain.handle('data:saveCleanWorkbook', async (_event, base64: string): Promise<string | null> => {
  if (!mainWindow) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error('只能保存 base64 Excel 工作簿数据。');
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出干净亮度数据',
    defaultPath: 'clean-luminance-data.xlsx',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });

  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, Buffer.from(base64, 'base64'));
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});
