# Mac Preview Migration Checklist

This file tracks the current state of `mac-preview` and the migration path from:

1. `missing`
2. `sim / patched`
3. `real`
4. `mixed`

The working rule is:
- implement every `missing` surface first so the browser app stops breaking
- then replace `sim / patched` behavior with real hardware-backed behavior where practical
- keep the sim path available as a fallback until the real path is stable

## Status Legend

- `[x] real`
- `[~] mixed`
- `[-] sim / patched`
- `[ ] missing`

## 1. Transport And App Shell

- `[x]` macOS serial port discovery via `/dev/cu.*`
- `[x]` port init / open / close in preview backend
- `[x]` hardware metadata reads: version / board / silicon
- `[-]` browser boot without Electron
- `[-]` bundled frontend extraction and patching
- `[-]` preview-only injected `Serial Commands` tab
- `[ ]` editable source replacement for the full configuration workspace
- `[ ]` editable source replacement for the full plot workspace
- `[ ]` removal of remaining bundled-frontend patch dependency

### Checklist

- `[ ]` replace more bundle patches with editable source mounts
- `[ ]` move connection drawer behavior into editable source
- `[ ]` document every frontend patch still applied by `prepare.js`
- `[ ]` remove frontend patches once equivalent source-owned UI exists

## 2. Config File Flow

- `[x]` browser file capture for `.dcfg`
- `[x]` preview cache of selected `.dcfg`
- `[x]` `.dcfg` load into mirrored sim state
- `[x]` `.dcfg` write-through to hardware when connected
- `[x]` `Export cfg File` from mirrored state
- `[-]` load flow depends on preview bridge and cached file fallback
- `[ ]` full fidelity export directly validated against hardware state

### Checklist

- `[ ]` validate export output against board reads after hardware writes
- `[ ]` remove preview-file fallback once browser upload flow is source-owned

## 3. PPG Configuration

### Current State

- `[~]` PPG populate reads use live hardware registers when connected, with sim decode/fallback
- `[~]` PPG config writes replay generated register commands to hardware when connected
- `[~]` AGC control writes replay AGC commands to hardware when connected
- `[x]` register page reads / writes
- `[x]` serial-equivalent command logging
- `[-]` config writes mirror into sim even when hardware is connected
- `[x]` direct hardware-backed populate read path for core PPG controls
- `[ ]` end-to-end verification that every PPG control round-trips from hardware state

### Checklist

- `[ ]` map each PPG UI control to exact backend route(s)
- `[ ]` mark which controls are currently served from sim-state only
- `[ ]` convert PPG populate reads to prefer hardware when connected
- `[ ]` add verification for every PPG control:
  state change in UI -> backend write -> backend read -> UI reflects hardware value
- `[ ]` decide whether mirrored sim remains authoritative cache or only fallback

## 4. PPG Plotting

### Current State

- `[x]` plot routes no longer crash the frontend
- `[~]` `startPlot` / `startPlotReceive` / `stopPlot` use hardware when connected and synthetic fallback otherwise
- `[x]` real PPG plot data parsing from serial stream
- `[-]` `ppgFullScale` currently returns preview placeholder output
- `[-]` `ppgSmoothProcess` currently returns preview passthrough output
- `[~]` `startExportData` / `stopExportData` toggle transport capture but do not yet produce a real export artifact
- `[x]` real FIFO start / receive / stop from hardware
- `[ ]` real scaling output from live/store state
- `[ ]` real smoothing behavior matching shipped app
- `[ ]` real plot export data

### Checklist

- `[ ]` inspect exact `startPlot` command string sent by the frontend
- `[x]` implement hardware-backed `startPlot`
- `[x]` implement hardware-backed `startPlotReceive`
- `[x]` parse real FIFO payload into the expected plot object shape
- `[x]` implement real `stopPlot`
- `[ ]` implement real `ppgFullScale`
- `[ ]` implement real `ppgSmoothProcess`
- `[~]` implement real `startExportData`
- `[~]` implement real `stopExportData`
- `[ ]` keep synthetic plot mode as fallback until live plotting is stable

## 5. Connection Status Matrix

### Real

- `/target/list`
- `/target/init`
- `/target/open`
- `/target/close`
- `/target/connectionStatusCheck`
- `/target/getVersion`
- `/target/getBoard`
- `/target/getSillicon`
- `/target/reset`
- `/target/readRegister`
- `/target/writeRegister`
- `/target/loadCfg`
- `/target/startPlot`
- `/target/startPlotReceive`
- `/target/stopPlot`

### Mixed: Hardware-Backed With Sim Mirror Or Fallback

- `/target/readSampleRate`
- `/target/readSlotEnable`
- `/target/readPPGAFETrimVref`
- `/target/readPPGAmbientCancellation`
- `/target/readDecimateFactor`
- `/target/readCHEnable`
- `/target/readTIAGain`
- `/target/readDACLEDDC`
- `/target/readOperationMode`
- `/target/readLedType`
- `/target/readLedCurrent`
- `/target/populateDIMode`
- `/target/writeSampleRate`
- `/target/writeSampleRateLoop`
- `/target/writeSlotEnable`
- `/target/writeCHEnable`
- `/target/writeTIAGain`
- `/target/writeDACLEDDC`
- `/target/writeOperationMode`
- `/target/writeLedType`
- `/target/writeLedCurrent`
- `/target/writePulse`
- `/target/writeDecimateFactor`
- `/target/writeSimRegister2Hardware`
- `/target/AGCOnOff`
- `/target/AGCSample`
- `/target/AGCSlotOnOff`
- `/target/AGCSlotLED`
- `/target/AGCSlotChannel`
- `/target/startExportData`
- `/target/stopExportData`

### Sim / Patched
- `/target/exportCfg`
- `/target/ppgFullScale`
- `/target/ppgSmoothProcess`
- `/target/previewCommandLog`

### Missing Or Not Yet Real

 - `[~]` hardware-backed PPG populate reads
 - `[~]` hardware-backed PPG config write verification layer
- `[~]` hardware-backed PPG plotting
- `[ ]` hardware-backed PPG export-data path
- `[ ]` ECG configuration parity
- `[ ]` ECG plotting parity
- `[ ]` BIOZ configuration parity
- `[ ]` BIOZ process / DLL parity on macOS
- `[ ]` EDA configuration parity
- `[ ]` EDA plotting parity
- `[ ]` upload / cloud / analysis feature parity

## 6. Frontend Ownership

### Patched

- `prepare.js` injects preview assets into the bundled app
- `preview-shim.js` intercepts and reroutes `/target/*` calls
- `config-workspace.js` injects the preview serial tab
- bundle state is still patched for browser boot behavior

### Missing

- `[ ]` source-owned sidebar
- `[ ]` source-owned connection drawer
- `[ ]` source-owned load/export/reset controls
- `[ ]` source-owned plot page
- `[ ]` source-owned route shell replacing bundled routing incrementally

### Checklist

- `[ ]` move one more high-churn screen from bundle patching to editable source
- `[ ]` track every injected asset and why it still exists
- `[ ]` delete each patch once its source-owned replacement lands

## 7. Priority Order

### First: missing

- `[ ]` real PPG plotting path
- `[ ]` real PPG export-data path
- `[ ]` remaining PPG controls that still do not round-trip from hardware
- `[ ]` source-owned replacements for the highest-friction patched UI areas

### Then: sim / patched to real

- `[~]` convert PPG populate reads from sim-first to hardware-first
- `[~]` convert PPG write verification from mirror-only to hardware round-trip
- `[~]` replace synthetic plot stream with real FIFO stream
- `[ ]` replace remaining preview plot helpers with real implementations
- `[ ]` reduce `prepare.js` patch surface

### Last: expand beyond PPG

- `[ ]` ECG
- `[ ]` BIOZ
- `[ ]` EDA
- `[ ]` cloud / upload / analysis
