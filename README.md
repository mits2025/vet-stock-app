# Vet POS

Vet POS is an offline-first veterinary point-of-sale and inventory application. Its Windows installation runs as a local web application in the computer's default browser at `http://127.0.0.1:4200`.

## Development

```powershell
npm install
npm run dev
```

Run the test and production build checks with:

```powershell
npm test
npm run lint
npm run build
```

## Local Windows installer

Install Node.js 22 or newer and Inno Setup 6 on the developer PC, then run:

```powershell
npm run windows:installer
```

The result is written to `installer\windows\output\Vet-POS-Local-Setup-<version>-x64.exe`.

On the clinic PC, Setup installs a private loopback server, registers it to start with Windows, and creates a Vet POS desktop shortcut. Clinic records are stored in `C:\ProgramData\Vet POS\data\vet-pos.sqlite`. Uninstalling the application preserves that database by default.

See `installer\windows\README.md` for full packaging details and `LICENSE_SETUP.md` for licensing configuration.
