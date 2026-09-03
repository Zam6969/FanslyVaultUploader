# VaultDrop

VaultDrop is a focused Windows desktop app for uploading media directly to a Fansly creator Vault. It connects with a single-use Fansly Management Session link, shows media already in the Vault, and supports assigning uploads to existing Vault collections.

## Features

- Connects directly to Fansly with a Management Session—no ChatGPT or third-party login service.
- Uploads images, videos, and audio without requiring a title or post.
- Loads existing Vault collections.
- Lets you choose a collection for each queued file or set one collection for the entire queue.
- Shows collection labels on uploaded media and filters the gallery by collection.
- Includes a recovery action for raw uploads that were not registered in the website-visible Vault.
- Encrypts the claimed session locally with Electron's `safeStorage` API.

## Supported file extensions

Images: `png`, `pjp`, `jfif`, `jpe`, `pjpeg`, `jpeg`, `jpg`, `webp`, `gif`

Videos: `mpe`, `mpeg`, `ogm`, `mkv`, `mpg`, `wmv`, `webm`, `ogv`, `mov`, `m4v`, `asx`, `mp4`, `avi`

Audio: `m4a`, `mp3`, `opus`, `oga`, `mka`, `flac`, `weba`, `wav`, `ogg`, `mid`, `aiff`, `wma`, `au`

## Compile on Windows

### Requirements

- Windows 10 or Windows 11, 64-bit
- [Node.js](https://nodejs.org/) 22 or newer, including npm
- Git

### Build the portable app

Open PowerShell and run:

```powershell
git clone https://github.com/Zam6969/FanslyVaultUploader.git
cd FanslyVaultUploader
npm ci
npm run dist
```

The finished portable executable will be created at:

```text
release\VaultDrop.exe
```

### Run from source

After installing dependencies with `npm ci`, run:

```powershell
npm start
```

## Connecting to Fansly

1. In Fansly, open the Creator Dashboard and go to Management Sessions.
2. Create a Management Session with **Create Posts** access enabled.
3. Copy the single-use claim link.
4. Open VaultDrop, choose **Connect session**, and paste the link into the local app.

Do not paste a Management Session link into a chat, issue, commit, or README. The claim link is sent to Fansly only. After it is claimed, the resulting session token is encrypted by Windows and stored in Electron's application-data directory—not in this repository.

## Development notes

- Main process and Fansly communication: `main.cjs`
- Secure renderer bridge: `preload.cjs`
- Desktop interface: `renderer/`
- Package configuration: `package.json`

The project intentionally does not commit `node_modules`, packaged builds, logs, environment files, or session data.

## Disclaimer

VaultDrop is an independent project and is not affiliated with or endorsed by Fansly. It uses the same first-party Fansly services used by the Fansly web app. Those private interfaces may change without notice, so future Fansly updates may require corresponding changes here.
