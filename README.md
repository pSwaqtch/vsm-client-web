# Mac Preview

Quick browser preview for the packaged VSM Client frontend on macOS.

## Run

```bash
node mac-preview/server.js
```

Then open:

```text
http://127.0.0.1:4173
```

## Notes

- This does not use Electron.
- This does not start the packaged backend.
- The preview still keeps a sim-backed config path for safe browser boot and offline work.
- Connection routes now pass through to the local preview backend, which can list and open macOS serial ports via `/dev/cu.*` without Electron.
- Higher-level hardware features are still partial. Real serial is intended for connection, metadata, register I/O, and cfg load flows first.
