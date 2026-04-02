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
- `/target/*` requests are intercepted in-browser and answered locally so the UI shell can boot.
- Hardware, serial, DLL, and processing features are not expected to work.
