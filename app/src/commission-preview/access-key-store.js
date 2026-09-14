// The per-preview capability is separate from the public Supabase API key.
function storageKey(projectUrl, commissionId) {
  return `dayline.preview-key:${encodeURIComponent(projectUrl)}:${encodeURIComponent(commissionId)}`;
}

export const accessKeyStore = {
  get(projectUrl, commissionId) {
    return globalThis.localStorage.getItem(storageKey(projectUrl, commissionId));
  },
  set(projectUrl, commissionId, key) {
    globalThis.localStorage.setItem(storageKey(projectUrl, commissionId), key);
  },
};
