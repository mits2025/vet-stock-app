# Vet POS local Windows installer

This installer places Vet POS under `C:\ProgramData\Vet POS\app`, stores clinic data in SQLite under `C:\ProgramData\Vet POS\data`, and registers a Windows scheduled task that serves the application only on `http://127.0.0.1:4200`.

The desktop and Start menu shortcuts open Vet POS in the computer's default browser. No internet connection is required for normal inventory and POS use; internet access is still required for remote licensing/payment verification.

## Build

1. Install Node.js 22 or newer.
2. Install [Inno Setup 6](https://jrsoftware.org/isinfo.php).
3. From the project root, run:

```powershell
npm run windows:installer
```

The installer is created at `installer\windows\output\Vet-POS-Local-Setup-<version>-x64.exe`.

Run the installer as Administrator. After installation, open the **Vet POS** desktop shortcut or visit `http://127.0.0.1:4200`.

Uninstalling removes the application and automatic-start task but deliberately preserves the clinic database under `C:\ProgramData\Vet POS\data`.
