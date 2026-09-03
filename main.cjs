const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FANSLY_API = 'https://apiv3.fansly.com/api/v1';
const FANSLY_MEDIA = 'https://mediav2.fansly.com/api/v1';
const PART_CONCURRENCY = 4;
const partition = 'persist:vaultdrop-fansly';

let mainWindow;
let fanslySession;
let authToken = '';
let connectedAccount = null;
let uploadRunning = false;
let sessionFile = '';

const mimeTypes = {
  '.png': 'image/png',
  '.pjp': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.pjpeg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mpe': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogm': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.asx': 'video/x-ms-asf',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/opus',
  '.oga': 'audio/ogg',
  '.mka': 'audio/x-matroska',
  '.flac': 'audio/flac',
  '.weba': 'audio/webm',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mid': 'audio/midi',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.au': 'audio/basic',
};

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: '#f4f1eb',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f4f1eb', symbolColor: '#171515', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function parseJson(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || !body?.success) {
    const detail = body?.error?.details || body?.error?.message || body?.error || `Fansly returned ${response.status}.`;
    throw new Error(typeof detail === 'string' ? detail : 'Fansly rejected the request.');
  }
  return body.response;
}

async function validateToken(token) {
  if (!token) return null;
  const response = await fanslySession.fetch(`${FANSLY_API}/account/me`, {
    method: 'GET',
    credentials: 'include',
    headers: { authorization: token, 'ngsw-bypass': 'true' },
  });
  return parseJson(response);
}

function publicAccount(account) {
  if (!account) return { connected: false };
  return {
    connected: true,
    username: account.username || account.displayName || 'Fansly creator',
    accountId: account.id || '',
  };
}

function safeMediaUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'fansly.com' || url.hostname.endsWith('.fansly.com')) ? url.href : '';
  } catch {
    return '';
  }
}

function publicMedia(media) {
  const variants = Array.isArray(media?.variants) ? media.variants : [];
  const all = [media, ...variants];
  const locate = (entry) => safeMediaUrl(entry?.locations?.[0]?.location);
  const video = all.filter((entry) => String(entry?.mimetype || '').startsWith('video/')).sort((a, b) => Number(b.height || 0) - Number(a.height || 0)).find(locate);
  const image = all.filter((entry) => String(entry?.mimetype || '').startsWith('image/')).sort((a, b) => Number(b.width || 0) - Number(a.width || 0)).find(locate);
  const fallback = all.find(locate);
  return {
    id: String(media?.id || ''),
    filename: media?.filename || 'Untitled media',
    mimetype: media?.mimetype || '',
    createdAt: Number(media?.createdAt || 0),
    status: Number(media?.status || 0),
    width: Number(media?.width || 0),
    height: Number(media?.height || 0),
    mediaUrl: locate(video) || locate(fallback),
    posterUrl: locate(image),
  };
}

function publicCollection(album) {
  return {
    id: String(album?.id || ''),
    title: String(album?.title || 'Untitled collection').slice(0, 120),
    itemCount: Math.max(0, Number(album?.itemCount || 0)),
  };
}

async function getVaultAlbumInfo() {
  const response = await requestFansly(`${FANSLY_API}/vault/albumsnew`);
  const albums = Array.isArray(response?.albums) ? response.albums : Array.isArray(response) ? response : [];
  const allAlbum = albums.find((album) => Number(album?.type || 0) === 38000);
  const collections = albums
    .filter((album) => album?.id && Number(album?.type || 0) === 0)
    .map(publicCollection);
  return { allAlbumId: String(allAlbum?.id || '38000'), collections };
}

async function listVaultCollections() {
  return (await getVaultAlbumInfo()).collections;
}

async function listVaultMediaRaw(albumId = '') {
  const collected = [];
  const seen = new Set();
  let before = '0';

  for (let page = 0; page < 40; page += 1) {
    const albumQuery = albumId ? `albumId=${encodeURIComponent(albumId)}&` : '';
    const response = await requestFansly(`${FANSLY_API}/media/vault?${albumQuery}before=${encodeURIComponent(before)}&after=0`);
    const items = Array.isArray(response) ? response : [];
    let added = 0;
    for (const media of items) {
      const id = String(media?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      collected.push(media);
      added += 1;
    }
    if (!items.length || !added) break;
    const nextBefore = String(items[items.length - 1]?.id || '');
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }

  return collected;
}

async function loadVaultLibrary() {
  const { allAlbumId, collections } = await getVaultAlbumInfo();
  const allMedia = await listVaultMediaRaw(allAlbumId);
  const memberships = new Map();
  const collectionsWithItems = collections.filter((collection) => collection.itemCount !== 0);

  await runPool(collectionsWithItems, 4, async (collection) => {
    const media = await listVaultMediaRaw(collection.id);
    for (const item of media) {
      const mediaId = String(item?.id || '');
      if (!mediaId) continue;
      const values = memberships.get(mediaId) || [];
      values.push({ id: collection.id, title: collection.title });
      memberships.set(mediaId, values);
    }
  });

  return {
    collections,
    media: allMedia
      .map((item) => ({ ...publicMedia(item), collections: memberships.get(String(item?.id || '')) || [] }))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}

async function addMediaToCollection(albumId, mediaIds) {
  const ids = (Array.isArray(mediaIds) ? mediaIds : [mediaIds]).map(String).filter(Boolean);
  if (!ids.length) return null;
  return requestFansly(`${FANSLY_API}/vault/albums/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ albumId, mediaIds: ids }),
  });
}

async function repairMissingVaultUploads() {
  const { allAlbumId } = await getVaultAlbumInfo();
  const [rawMedia, vaultMedia] = await Promise.all([
    listVaultMediaRaw(),
    listVaultMediaRaw(allAlbumId),
  ]);
  const visibleIds = new Set(vaultMedia.map((item) => String(item?.id || '')));
  const missingIds = rawMedia
    .filter((item) => /^(image|video|audio)\//.test(String(item?.mimetype || '')))
    .map((item) => String(item?.id || ''))
    .filter((id) => id && !visibleIds.has(id));

  for (let index = 0; index < missingIds.length; index += 100) {
    await addMediaToCollection(allAlbumId, missingIds.slice(index, index + 100));
  }
  return { repaired: missingIds.length };
}

function normalizeManagementToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'fansly.com' && !url.hostname.endsWith('.fansly.com')) return '';
    const match = url.pathname.match(/\/managementsession\/claim\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return /^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : '';
  }
}

async function persistSessionToken(token) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.');
  const encrypted = safeStorage.encryptString(token);
  await fs.promises.writeFile(sessionFile, encrypted, { mode: 0o600 });
}

async function forgetSessionToken() {
  try { await fs.promises.unlink(sessionFile); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function activateSession(token, persist = true) {
  const account = await validateToken(token);
  authToken = token;
  connectedAccount = account;
  if (persist) await persistSessionToken(token);
  const result = publicAccount(account);
  send('fansly:connection', result);
  return result;
}

async function claimManagementSession(value) {
  const token = normalizeManagementToken(value);
  if (!token) throw new Error('Paste a valid Fansly management-session link or token.');

  try {
    const response = await fanslySession.fetch(`${FANSLY_API}/management/managementsession/claim`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'ngsw-bypass': 'true' },
      body: JSON.stringify({ token }),
    });
    const claimedSession = await parseJson(response);
    if (!claimedSession?.token) throw new Error('Fansly did not return a management session.');
    return activateSession(claimedSession.token);
  } catch (claimError) {
    try {
      return await activateSession(token);
    } catch {
      throw new Error(claimError instanceof Error ? claimError.message : 'Fansly could not claim this management session.');
    }
  }
}

async function restoreManagementSession() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { connected: false };
    const encrypted = await fs.promises.readFile(sessionFile);
    return await activateSession(safeStorage.decryptString(encrypted), false);
  } catch {
    authToken = '';
    connectedAccount = null;
    return { connected: false };
  }
}

async function requestFansly(url, options = {}) {
  if (!authToken) throw new Error('Sign in to Fansly first.');
  const headers = { authorization: authToken, 'ngsw-bypass': 'true', ...(options.headers || {}) };
  const response = await fanslySession.fetch(url, { credentials: 'include', ...options, headers });
  return parseJson(response);
}

async function uploadPart(fileHandle, fileSize, partSize, part, position, onBytes) {
  const start = position * partSize;
  const length = Math.min(partSize, fileSize - start);
  const buffer = Buffer.allocUnsafe(length);
  await fileHandle.read(buffer, 0, length, start);

  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fanslySession.fetch(part.uploadUrl, {
        method: 'PUT',
        headers: { 'ngsw-bypass': 'true' },
        body: buffer,
      });
      if (!response.ok) throw new Error(`Upload part returned ${response.status}.`);
      onBytes(length);
      return { index: part.index, eTag: response.headers.get('etag') || '' };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new Error('A media part failed to upload.');
}

async function runPool(items, limit, worker) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

async function uploadMediaFile(filePath, queueId) {
  const stat = await fs.promises.stat(filePath);
  const fileName = path.basename(filePath);
  const mimeType = mimeTypes[path.extname(fileName).toLowerCase()];
  if (!mimeType) throw new Error('This media format is not supported.');

  send('videos:progress', { id: queueId, state: 'preparing', progress: 1 });
  const upload = await requestFansly(`${FANSLY_MEDIA}/media/upload/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileSize: stat.size, mimeType, fileName, uploadFormData: '' }),
  });

  const parts = [...(upload.parts || [])].sort((a, b) => a.index - b.index);
  const partSize = Number(upload.partSize || Math.ceil(stat.size / Math.max(parts.length, 1)));
  if (!upload.id || !parts.length || !partSize) throw new Error('Fansly did not create a valid upload.');

  const handle = await fs.promises.open(filePath, 'r');
  let uploadedBytes = 0;
  const completedParts = new Array(parts.length);
  try {
    await runPool(parts, PART_CONCURRENCY, async (part, position) => {
      completedParts[position] = await uploadPart(handle, stat.size, partSize, part, position, (bytes) => {
        uploadedBytes += bytes;
        const progress = Math.min(90, Math.max(2, Math.round((uploadedBytes / stat.size) * 90)));
        send('videos:progress', { id: queueId, state: 'uploading', progress });
      });
    });
  } finally {
    await handle.close();
  }

  send('videos:progress', { id: queueId, state: 'processing', progress: 92 });
  await requestFansly(`${FANSLY_MEDIA}/media/upload/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: upload.id, type: 1, partSize, status: 0, parts: completedParts, waitForComplete: 0 }),
  });

  for (let attempt = 0; attempt < 1080; attempt += 1) {
    const status = await requestFansly(`${FANSLY_MEDIA}/media/upload/${encodeURIComponent(upload.id)}`);
    if (Number(status.status) >= 6 && status.media) return status.media;
    const progress = Math.min(99, 92 + Math.floor(attempt / 3));
    send('videos:progress', { id: queueId, state: 'processing', progress });
    await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 1000 + attempt * 1000)));
  }
  throw new Error('Fansly is still processing this file. Check your Vault in a few minutes.');
}

app.whenReady().then(() => {
  fanslySession = session.fromPartition(partition);
  sessionFile = path.join(app.getPath('userData'), 'management-session.bin');
  createMainWindow();

  ipcMain.handle('fansly:connect', (_event, managementSession) => claimManagementSession(managementSession));
  ipcMain.handle('fansly:check-connection', async () => {
    if (connectedAccount && authToken) return publicAccount(connectedAccount);
    return restoreManagementSession();
  });
  ipcMain.handle('fansly:disconnect', async () => {
    authToken = '';
    connectedAccount = null;
    await forgetSessionToken();
    send('fansly:connection', { connected: false });
    return { connected: false };
  });
  ipcMain.handle('vault:library', async () => {
    if (!authToken) throw new Error('Sign in to Fansly first.');
    return loadVaultLibrary();
  });
  ipcMain.handle('vault:repair', async () => {
    if (!authToken) throw new Error('Sign in to Fansly first.');
    return repairMissingVaultUploads();
  });
  ipcMain.handle('videos:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported media', extensions: Object.keys(mimeTypes).map((extension) => extension.slice(1)) },
        { name: 'Images', extensions: ['png', 'pjp', 'jfif', 'jpe', 'pjpeg', 'jpeg', 'jpg', 'webp', 'gif'] },
        { name: 'Videos', extensions: ['mpe', 'mpeg', 'ogm', 'mkv', 'mpg', 'wmv', 'webm', 'ogv', 'mov', 'm4v', 'asx', 'mp4', 'avi'] },
        { name: 'Audio', extensions: ['m4a', 'mp3', 'opus', 'oga', 'mka', 'flac', 'weba', 'wav', 'ogg', 'mid', 'aiff', 'wma', 'au'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => {
      const stat = fs.statSync(filePath);
      const mimeType = mimeTypes[path.extname(filePath).toLowerCase()] || '';
      return { id: `${stat.ino}-${stat.size}-${stat.mtimeMs}`, path: filePath, name: path.basename(filePath), size: stat.size, mimeType };
    });
  });
  ipcMain.handle('videos:upload', async (_event, files) => {
    if (uploadRunning) throw new Error('An upload is already running.');
    if (!Array.isArray(files) || !files.length) return { uploaded: 0 };
    if (!authToken) throw new Error('Sign in to Fansly first.');

    uploadRunning = true;
    let uploaded = 0;
    try {
      const { allAlbumId, collections } = await getVaultAlbumInfo();
      const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
      for (const file of files) {
        try {
          const collectionId = String(file.collectionId || '');
          const collection = collectionId ? collectionById.get(collectionId) : null;
          if (collectionId && !collection) throw new Error('That collection is no longer available.');
          const media = await uploadMediaFile(file.path, file.id);
          let warning = '';
          send('videos:progress', { id: file.id, state: 'organizing', progress: 99 });
          try {
            await addMediaToCollection(allAlbumId, media.id);
          } catch (error) {
            warning = `The file uploaded, but Fansly did not register it in your Vault: ${error instanceof Error ? error.message : 'Fansly rejected the Vault update.'}`;
          }
          if (collection && !warning) {
            try {
              await addMediaToCollection(collectionId, media.id);
            } catch (error) {
              warning = `Uploaded to your Vault, but could not add it to ${collection.title}: ${error instanceof Error ? error.message : 'Fansly rejected the collection update.'}`;
            }
          }
          send('videos:progress', { id: file.id, state: 'complete', progress: 100, mediaId: media.id || '', warning });
          uploaded += 1;
        } catch (error) {
          send('videos:progress', { id: file.id, state: 'error', error: error instanceof Error ? error.message : 'Upload failed.' });
        }
      }
      return { uploaded };
    } finally {
      uploadRunning = false;
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
