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

1. **Import**: Two source types, both gated by `window.luminanceAPI`:
   - **Excel (.xlsx)**: Browser uses `FileReader` + `xlsx`; Electron uses IPC (`ipcMain.handle('files:selectExcelFiles')`) reading via `fs.readFile` and passing base64
   - **SQLite (.db)**: `src/lib/parseDatabase.ts` opens via `sql.js` WASM; lists `test_executions` rows joined with `products` where `item_id` matches "亮度测试"; the `ExecutionPicker` modal in `src/components/ExecutionPicker.tsx` lets the user multi-select runs (badge shows lit duration computed from `window_time` array max, which is more reliable than the `keep_time` field)
2. **Parse**: `src/lib/parseWorkbook.ts` reads B-E columns from the first sheet; `parseDatabase.ts` reads `time` / `window_time` / `window_size` / `brightness_data` arrays. Both emit `LuminancePoint[]` + `LuminanceStats`
3. **Display**: `src/App.tsx` holds state (`curves`, `viewMode`, `processingMode`, `alignmentMode`, `displayMode`); `src/components/ChartPanel.tsx` wraps ECharts (`buildRawOption` / `buildProcessedOption`); `src/components/LuminanceScene3D.tsx` is a Three.js `InstancedMesh` scene driven by `src/lib/luminanceScene3d.ts`
4. **Post-process**: `src/lib/postProcess.ts` — see *Post-processing* below
5. **Export**: Four formats — PNG (ECharts `getDataURL`), SVG (off-screen ECharts SVG render), AI layered SVG (`src/lib/illustratorSvg.ts` with Inkscape layer groups), clean Excel (`src/lib/exportCleanWorkbook.ts` with Summary/Cleaned Points/Diagnostics sheets)
6. **Save**: Web uses DOM anchor download (`src/lib/download.ts`); Electron uses IPC save dialogs (`src/electron/main.ts`)

### Key types

All shared types in `src/types.ts`:
- `LuminancePoint` — raw parsed row
- `ParsedWorkbook` → `CurveSeries` — extends parsed with id, color, visible
- `AlignmentMode` — `'index' | 'normalized'`
- `PostProcessOptions` — `alignmentMode`, `windowGapSlots`, `normalizedWindowSlots`, `minSamplesPerWindow`, plus diagnostic-tolerance fields
- `PostProcessResult` — `windows`, `cleanedPoints` (with `windowIndex` / `alignedIndex`, no longer seconds), `summaries`, `diagnostics`
- `LuminanceApi` — the IPC contract between renderer and Electron main process

### Processing modes

- **Raw**: Two views — `time` (X=elapsed seconds) and `percent` (X=window level)
- **Processed**: One view, X axis is sample slot index (not seconds). Two alignment sub-modes:
  - **Index** (`'index'`): per window, find each curve's first sample with `luminanceNits >= 1` (drops only the dark transition frame at window switch), then take `min(N)` head samples across all curves so the start of every window aligns 1-to-1 by sample
  - **Normalized** (`'normalized'`): per window, each curve's kept samples are stretched onto a fixed slot width (`normalizedWindowSlots`, default 180) so curves with different sample rates overlay head-to-tail. No tail trimming
- **Auto-suggest**: when imported curves disagree by >20% on per-window sample count, App.tsx auto-switches to `normalized` (only if currently in `processed` + `index`) and shows a centered alert. While the imbalance persists with `index` selected, a pulsing red banner sits above the alignment toggle pointing at 「归一化」

### Post-processing details (`src/lib/postProcess.ts`)

- Single function `postProcessCurves(curves, partialOptions)` runs in two passes: collect validated windows + per-curve kept points, then assign aligned-index positions
- `windowGapSlots` is **auto-derived** and written back into the returned `options`:
  - Index mode: `round(mean(samplesKept across all curve+window pairs))`
  - Normalized mode: equals `normalizedWindowSlots`
- `alignedCursor` starts at `windowGapSlots` so there's a leading gap before the first window; `xAxis.max` is extended by `windowGapSlots` in `ChartPanel` so the trailing gap is symmetric
- Rise detection (`findReachedWindowStartIndex`) uses absolute threshold `>= 1 nit`, not a percentage of the stable median — guarantees only the actual dark transition frames get dropped
- Returned `cleanedPoints` carry both `originalCycleSeconds` (real time) and `alignedIndex`/`windowIndex` (synthetic axis)

### Shared conventions

- `windowSequence` (`src/lib/windowSequence.ts`) defines the 11 window levels as compile-time array
- 12-color palette in `src/App.tsx` cycles for new curves
- 25 MB workbook/db size limit enforced on both browser and Electron paths
- `ResizeObserver` mocked in test setup (`src/test/setup.ts`); tests use `jsdom` + `@testing-library/react`
- Processed-view line series intentionally has **no LTTB sampling** because the chart injects synthetic `y=0` baseline sentinels at each window's first/last sample x to draw the vertical wall, and LTTB would silently drop those sentinels

### NPM dependencies

- **echarts** v6 — chart rendering (tree-shaken imports in ChartPanel, only used sub-modules registered)
- **xlsx** v0.18 — `.xlsx` read/write (has known unfixed audit advisory, safe for local use)
- **lucide-react** — icons
- **Electron Forge** v7 with Vite plugin — desktop build pipeline
