const state = {
  connected: false,
  account: null,
  files: [],
  uploading: false,
  vault: [],
  collections: [],
  activeCollectionId: '',
  queueCollectionId: '',
  vaultLoading: false,
  vaultProgress: { progress: 0, message: 'Loading your Vault…' },
};

const connectButton = document.querySelector('#connectButton');
const connectionLabel = document.querySelector('#connectionLabel');
const chooseButton = document.querySelector('#chooseButton');
const queueCard = document.querySelector('#queueCard');
const queueTitle = document.querySelector('#queueTitle');
const queue = document.querySelector('#queue');
const uploadButton = document.querySelector('#uploadButton');
const clearButton = document.querySelector('#clearButton');
const vaultCard = document.querySelector('#vaultCard');
const vaultTitle = document.querySelector('#vaultTitle');
const vaultLoading = document.querySelector('#vaultLoading');
const vaultLoadingText = document.querySelector('#vaultLoadingText');
const vaultLoadingCount = document.querySelector('#vaultLoadingCount');
const vaultLoadBar = document.querySelector('#vaultLoadBar');
const vaultLoadTrack = document.querySelector('.vault-load-track');
const vaultEmpty = document.querySelector('#vaultEmpty');
const vaultGrid = document.querySelector('#vaultGrid');
const refreshButton = document.querySelector('#refreshButton');
const repairButton = document.querySelector('#repairButton');
const collectionTabs = document.querySelector('#collectionTabs');
const queueCollectionSelect = document.querySelector('#queueCollectionSelect');
const sessionModal = document.querySelector('#sessionModal');
const sessionInput = document.querySelector('#sessionInput');
const sessionSubmit = document.querySelector('#sessionSubmit');
const sessionError = document.querySelector('#sessionError');
const modalClose = document.querySelector('#modalClose');
const toast = document.querySelector('#toast');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 4200);
}

function setConnection(value) {
  state.connected = Boolean(value?.connected);
  state.account = value || null;
  connectButton.classList.toggle('connected', state.connected);
  connectionLabel.textContent = state.connected ? `@${value.username}` : 'Connect session';
  render();
  if (state.connected) loadVault();
  else {
    state.vault = [];
    state.collections = [];
    state.activeCollectionId = '';
    state.queueCollectionId = '';
    state.vaultLoading = false;
    renderVault();
  }
}

function openSessionModal() {
  sessionError.classList.add('hidden');
  sessionError.textContent = '';
  sessionInput.value = '';
  sessionModal.classList.remove('hidden');
  setTimeout(() => sessionInput.focus(), 50);
}

function closeSessionModal() {
  sessionModal.classList.add('hidden');
  sessionInput.value = '';
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp * 1000));
}

function fillCollectionSelect(select, selectedId) {
  const options = [{ id: '', title: 'Vault only' }, ...state.collections.filter((collection) => collection.assignable !== false)];
  select.replaceChildren(...options.map((collection) => {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.title;
    option.selected = collection.id === selectedId;
    return option;
  }));
}

function renderVaultProgress() {
  const loadingProgress = Math.max(0, Math.min(100, Number(state.vaultProgress?.progress || 0)));
  vaultLoadingText.textContent = state.vaultProgress?.message || 'Loading your Vault…';
  vaultLoadingCount.textContent = `${loadingProgress}%`;
  vaultLoadBar.style.width = `${loadingProgress}%`;
  vaultLoadTrack.setAttribute('aria-valuenow', String(loadingProgress));
}

function renderVault() {
  const activeCollection = state.collections.find((collection) => collection.id === state.activeCollectionId) || null;
  const visibleMedia = activeCollection
    ? state.vault.filter((media) => (media.collections || []).some((collection) => collection.id === activeCollection.id))
    : state.vault;
  vaultCard.classList.toggle('hidden', !state.connected);
  vaultLoading.classList.toggle('hidden', !state.vaultLoading);
  renderVaultProgress();
  vaultEmpty.classList.toggle('hidden', state.vaultLoading || visibleMedia.length > 0);
  vaultGrid.classList.toggle('hidden', state.vaultLoading || visibleMedia.length === 0);
  refreshButton.disabled = state.vaultLoading;
  repairButton.disabled = state.vaultLoading;
  if (state.vaultLoading) return;
  vaultTitle.textContent = activeCollection
    ? `${visibleMedia.length} ${visibleMedia.length === 1 ? 'item' : 'items'} in ${activeCollection.title}`
    : state.vault.length ? `${state.vault.length} uploaded ${state.vault.length === 1 ? 'item' : 'items'}` : 'Uploaded media';
  vaultEmpty.textContent = activeCollection ? `No media found in ${activeCollection.title}.` : 'No uploaded media found yet.';

  const tabs = [{ id: '', title: 'All', itemCount: state.vault.length }, ...state.collections.map((collection) => ({
    ...collection,
    itemCount: state.vault.filter((media) => (media.collections || []).some((membership) => membership.id === collection.id)).length,
  }))];
  collectionTabs.replaceChildren(...tabs.map((collection) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `collection-tab${collection.id === state.activeCollectionId ? ' active' : ''}`;
    button.textContent = `${collection.title} · ${collection.itemCount}`;
    button.addEventListener('click', () => {
      state.activeCollectionId = collection.id;
      renderVault();
    });
    return button;
  }));

  vaultGrid.replaceChildren(...visibleMedia.map((media) => {
    const tile = document.createElement('article');
    tile.className = 'media-tile';

    if (media.mimetype.startsWith('video/') && media.mediaUrl) {
      const video = document.createElement('video');
      video.src = media.mediaUrl;
      video.poster = media.thumbnailUrl || media.posterUrl || '';
      video.preload = 'metadata';
      video.muted = true;
      video.controls = true;
      tile.append(video);
    } else if (media.mimetype.startsWith('audio/') && media.mediaUrl) {
      const audioWrap = document.createElement('div');
      audioWrap.className = 'audio-preview';
      const audioIcon = document.createElement('span');
      audioIcon.textContent = 'AUDIO';
      const audio = document.createElement('audio');
      audio.src = media.mediaUrl;
      audio.preload = 'metadata';
      audio.controls = true;
      audioWrap.append(audioIcon, audio);
      tile.append(audioWrap);
    } else if (media.mediaUrl || media.posterUrl) {
      const image = document.createElement('img');
      image.src = media.thumbnailUrl || media.posterUrl || media.mediaUrl;
      image.alt = media.filename;
      image.loading = 'lazy';
      tile.append(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'media-placeholder';
      placeholder.textContent = media.status === 0 ? 'PROCESSING' : 'MEDIA';
      tile.append(placeholder);
    }

    const meta = document.createElement('div');
    meta.className = 'media-meta';
    const name = document.createElement('div');
    name.className = 'media-name';
    name.textContent = media.filename;
    const date = document.createElement('div');
    date.className = 'media-date';
    date.textContent = formatDate(media.createdAt);
    const labels = document.createElement('div');
    labels.className = 'media-collections';
    const memberships = media.collections?.length ? media.collections : [{ id: '', title: 'Vault only' }];
    memberships.slice(0, 2).forEach((collection) => {
      const label = document.createElement('span');
      label.textContent = collection.title;
      labels.append(label);
    });
    if (memberships.length > 2) {
      const more = document.createElement('span');
      more.textContent = `+${memberships.length - 2}`;
      labels.append(more);
    }
    meta.append(name, date, labels);
    tile.append(meta);
    return tile;
  }));
}

async function loadVault() {
  if (!state.connected || state.vaultLoading) return;
  state.vaultLoading = true;
  state.vaultProgress = { progress: 0, message: 'Starting Vault refresh…' };
  renderVault();
  try {
    const library = await window.vaultdrop.loadVaultLibrary();
    state.vault = Array.isArray(library?.media) ? library.media : [];
    state.collections = Array.isArray(library?.collections) ? library.collections : [];
    if (state.activeCollectionId && !state.collections.some((collection) => collection.id === state.activeCollectionId)) state.activeCollectionId = '';
    if (state.queueCollectionId && !state.collections.some((collection) => collection.id === state.queueCollectionId)) state.queueCollectionId = '';
  } catch (error) {
    showToast(error.message || 'Could not load your Fansly Vault.');
  } finally {
    state.vaultLoading = false;
    render();
  }
}

function statusLabel(file) {
  if (file.state === 'ready') return 'Ready';
  if (file.state === 'preparing') return 'Preparing';
  if (file.state === 'uploading') return `${file.progress || 0}%`;
  if (file.state === 'processing') return 'Processing';
  if (file.state === 'organizing') return 'Adding to collection';
  if (file.state === 'complete') return 'In Vault';
  if (file.state === 'error') return 'Retry';
  return '';
}

function render() {
  queueCard.classList.toggle('hidden', state.files.length === 0);
  queueTitle.textContent = `${state.files.length} ${state.files.length === 1 ? 'file' : 'files'}`;
  clearButton.disabled = state.uploading;
  uploadButton.disabled = state.uploading || !state.files.some((file) => file.state === 'ready' || file.state === 'error');
  uploadButton.textContent = state.uploading ? 'Uploading one at a time…' : state.connected ? 'Upload media to Fansly Vault' : 'Sign in to upload';
  fillCollectionSelect(queueCollectionSelect, state.queueCollectionId);
  queueCollectionSelect.disabled = state.uploading;

  queue.replaceChildren(...state.files.map((file) => {
    const item = document.createElement('article');
    item.className = `queue-item ${file.state || 'ready'}`;

    const icon = document.createElement('div');
    icon.className = 'file-icon';
    const kind = file.mimeType?.startsWith('image/') ? 'IMG' : file.mimeType?.startsWith('audio/') ? 'AUDIO' : 'VIDEO';
    icon.textContent = file.state === 'complete' ? '✓' : file.state === 'error' ? '!' : kind;

    const details = document.createElement('div');
    const top = document.createElement('div');
    top.className = 'file-top';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = formatBytes(file.size);
    top.append(name, size);

    const bottom = document.createElement('div');
    bottom.className = 'file-bottom';
    const track = document.createElement('div');
    track.className = 'progress-track';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.style.width = `${file.progress || 0}%`;
    track.append(bar);
    const label = document.createElement('span');
    label.className = 'file-state';
    label.textContent = statusLabel(file);
    bottom.append(track, label);
    details.append(top, bottom);

    if (file.error) {
      const error = document.createElement('p');
      error.className = 'error-text';
      error.textContent = file.error;
      details.append(error);
    }

    const destination = document.createElement('div');
    destination.className = 'file-destination';
    const destinationLabel = document.createElement('label');
    destinationLabel.textContent = 'Collection';
    const destinationSelect = document.createElement('select');
    destinationSelect.setAttribute('aria-label', `Collection for ${file.name}`);
    fillCollectionSelect(destinationSelect, file.collectionId || '');
    destinationSelect.disabled = state.uploading || file.state === 'complete';
    destinationSelect.addEventListener('change', () => { file.collectionId = destinationSelect.value; });
    destination.append(destinationLabel, destinationSelect);
    details.append(destination);

    if (file.warning) {
      const warning = document.createElement('p');
      warning.className = 'warning-text';
      warning.textContent = file.warning;
      details.append(warning);
    }

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.textContent = '×';
    remove.disabled = state.uploading;
    remove.addEventListener('click', () => {
      state.files = state.files.filter((entry) => entry.id !== file.id);
      render();
    });

    item.append(icon, details, remove);
    return item;
  }));
  renderVault();
}

connectButton.addEventListener('click', async () => {
  try {
    if (state.connected) {
      const shouldDisconnect = window.confirm('Forget this management session on this computer? This does not revoke it in Fansly.');
      if (shouldDisconnect) setConnection(await window.vaultdrop.disconnect());
      return;
    }
    openSessionModal();
  } catch (error) {
    showToast(error.message || 'Could not connect the management session.');
  }
});

modalClose.addEventListener('click', closeSessionModal);
sessionModal.addEventListener('click', (event) => { if (event.target === sessionModal) closeSessionModal(); });
sessionInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') sessionSubmit.click(); });
sessionSubmit.addEventListener('click', async () => {
  const value = sessionInput.value.trim();
  if (!value) return;
  sessionSubmit.disabled = true;
  sessionSubmit.textContent = 'Connecting securely…';
  sessionError.classList.add('hidden');
  try {
    setConnection(await window.vaultdrop.connect(value));
    closeSessionModal();
  } catch (error) {
    sessionError.textContent = error.message || 'Fansly could not claim this management session.';
    sessionError.classList.remove('hidden');
  } finally {
    sessionSubmit.disabled = false;
    sessionSubmit.textContent = 'Connect management session';
  }
});

chooseButton.addEventListener('click', async () => {
  try {
    const files = await window.vaultdrop.chooseVideos();
    const known = new Set(state.files.map((file) => file.path));
    state.files.push(...files.filter((file) => !known.has(file.path)).map((file) => ({
      ...file,
      collectionId: state.queueCollectionId,
      state: 'ready',
      progress: 0,
    })));
    render();
  } catch (error) {
    showToast(error.message || 'Could not choose media.');
  }
});

clearButton.addEventListener('click', () => {
  if (!state.uploading) {
    state.files = [];
    render();
  }
});

refreshButton.addEventListener('click', loadVault);
repairButton.addEventListener('click', async () => {
  if (!state.connected || state.vaultLoading) return;
  repairButton.disabled = true;
  repairButton.textContent = 'Checking…';
  try {
    const result = await window.vaultdrop.repairVault();
    showToast(result.repaired ? `${result.repaired} missing media ${result.repaired === 1 ? 'file was' : 'files were'} restored to your Fansly Vault.` : 'No missing uploads were found.');
    await loadVault();
  } catch (error) {
    showToast(error.message || 'Could not repair missing uploads.');
  } finally {
    repairButton.disabled = false;
    repairButton.textContent = 'Fix missing uploads';
  }
});

queueCollectionSelect.addEventListener('change', () => {
  state.queueCollectionId = queueCollectionSelect.value;
  state.files.filter((file) => file.state !== 'complete').forEach((file) => { file.collectionId = state.queueCollectionId; });
  render();
});

uploadButton.addEventListener('click', async () => {
  if (!state.connected) {
    openSessionModal();
    return;
  }
  const targets = state.files.filter((file) => file.state === 'ready' || file.state === 'error');
  if (!targets.length) return;

  state.uploading = true;
  targets.forEach((file) => { file.error = ''; file.warning = ''; file.progress = 0; file.state = 'ready'; });
  render();
  try {
    const result = await window.vaultdrop.uploadVideos(targets.map(({ id, path, collectionId }) => ({ id, path, collectionId })));
    showToast(`${result.uploaded} media ${result.uploaded === 1 ? 'file is' : 'files are'} now in your Fansly Vault.`);
    await loadVault();
  } catch (error) {
    showToast(error.message || 'The upload could not start.');
  } finally {
    state.uploading = false;
    render();
  }
});

window.vaultdrop.onConnection(setConnection);
window.vaultdrop.onProgress((update) => {
  const file = state.files.find((entry) => entry.id === update.id);
  if (!file) return;
  Object.assign(file, update);
  render();
});
window.vaultdrop.onVaultProgress((update) => {
  state.vaultProgress = update || state.vaultProgress;
  if (state.vaultLoading) renderVaultProgress();
});

window.vaultdrop.checkConnection().then(setConnection).catch(() => setConnection({ connected: false }));
render();
