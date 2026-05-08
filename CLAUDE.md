# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                 # Install dependencies
npm run dev                 # Start Vite dev server on http://localhost:5173
npm run build               # Typecheck + build static web output to dist/
npm run preview             # Preview the built dist/ locally
npm run desktop:dev         # Start Electron Forge dev (hot-reload main + renderer)
npm run desktop:package     # Package Electron app for current platform (output to out/)
npm run desktop:make        # Build platform installer (needs native deps per platform)
npm run typecheck           # Run tsc --noEmit only
npm run test                # Run vitest tests once
npm run test:watch          # Run vitest in watch mode
```

## Architecture

Single codebase producing both a static web app and an Electron desktop app. The renderer (`src/App.tsx` + `src/components/`) is shared by both targets with zero branching — `window.luminanceAPI` existence gates Electron vs. browser behavior.

### Entry points

- **Web**: `index.html` → `src/main.tsx` → Vite dev/prod pipeline
- **Desktop**: Electron Forge (`forge.config.ts`) runs `src/electron/main.ts` (main process) with three Vite sub-configs:
  - `vite.main.config.ts` — Electron main process
  - `vite.preload.config.ts` — preload script (`contextBridge`)
  - `vite.renderer.config.ts` — same React renderer, bundled for Electron

### Data flow

1. **Import**: Browser uses `FileReader` + `xlsx` library; Electron uses IPC (`ipcMain.handle('files:selectExcelFiles')`) which reads files via `fs.readFile` and passes base64 to renderer
2. **Parse**: `src/lib/parseWorkbook.ts` — reads B-E columns from the first sheet via `XLSX.read`, skips header row, emits `LuminancePoint[]` with `LuminanceStats`
3. **Display**: `src/App.tsx` holds all state (`curves`, `viewMode`, `processingMode`); `src/components/ChartPanel.tsx` wraps ECharts with two chart builders (`buildRawOption` / `buildProcessedOption`)
4. **Post-process**: `src/lib/postProcess.ts` — aligns per-window stable samples from `windowSequence` (1%→100%), clips tail guard and boundary noise, aligns windows contiguously on the X axis
5. **Export**: Four formats — PNG (ECharts `getDataURL`), SVG (off-screen ECharts SVG render), AI layered SVG (`src/lib/illustratorSvg.ts` with Inkscape layer groups), clean Excel (`src/lib/exportCleanWorkbook.ts` with Summary/Cleaned Points/Diagnostics sheets)
6. **Save**: Web uses DOM anchor download (`src/lib/download.ts`); Electron uses IPC save dialogs (`src/electron/main.ts`)

### Key types

All shared types in `src/types.ts`:
- `LuminancePoint` — raw parsed row
- `ParsedWorkbook` → `CurveSeries` — extends parsed with id, color, visible
- `PostProcessResult` — contains `windows`, `cleanedPoints`, `summaries`, `diagnostics`
- `LuminanceApi` — the IPC contract between renderer and Electron main process

### Processing modes

- **Raw**: Two views — `time` (X=B column elapsed seconds, Y=E column nits) and `percent` (X=D column level, Y=E column nits)
- **Processed**: One view — aligned window timeline with stable samples per window level, boundary clipping, and gap between windows (`windowGapSeconds: 8`)

### Shared conventions

- `windowSequence` (`src/lib/windowSequence.ts`) defines the 11 window levels as compile-time array
- 12-color palette in `src/App.tsx` cycles for new curves
- 25 MB workbook size limit enforced on both browser and Electron paths
- `ResizeObserver` mocked in test setup (`src/test/setup.ts`); tests use `jsdom` + `@testing-library/react`

### NPM dependencies

- **echarts** v6 — chart rendering (tree-shaken imports in ChartPanel, only used sub-modules registered)
- **xlsx** v0.18 — `.xlsx` read/write (has known unfixed audit advisory, safe for local use)
- **lucide-react** — icons
- **Electron Forge** v7 with Vite plugin — desktop build pipeline
