/**
 * 0086: storage for user-provided rest background images.
 *
 * Image bytes are far too large for localStorage, so they live in IndexedDB keyed
 * by the custom background id. A small in-memory cache keeps the data URL handy for
 * synchronous rendering (the view layer builds its HTML string in one pass).
 */

const DB_NAME = "ultradiandrift";
const DB_VERSION = 1;
const STORE = "backgrounds";

/** Downscaled data URLs for this session, keyed by the custom background key. */
const cache = new Map<string, string>();

/** Hard cap on an imported file before we even try to decode it. */
export const MAX_BACKGROUND_FILE_BYTES = 10 * 1024 * 1024;
/** Longest edge after downscaling. */
export const MAX_BACKGROUND_EDGE = 1920;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** The cached data URL for a custom background, if it has been loaded this session. */
export function cachedBackground(key: string): string | undefined {
  return cache.get(key);
}

/** Load the given keys into the in-memory cache (no-op without IndexedDB). */
export async function loadBackgrounds(keys: string[]): Promise<void> {
  if (!hasIndexedDb() || keys.length === 0) return;
  try {
    const db = await openDb();
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    await Promise.all(
      keys.map(async (key) => {
        const value = await idbRequest<unknown>(store.get(key));
        if (typeof value === "string") cache.set(key, value);
      }),
    );
    db.close();
  } catch (err) {
    console.error("Failed to load backgrounds.", err);
  }
}

/** Persist a background data URL (also updates the cache immediately). */
export async function saveBackground(key: string, dataUrl: string): Promise<void> {
  cache.set(key, dataUrl);
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(dataUrl, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    });
    db.close();
  } catch (err) {
    console.error("Failed to save background.", err);
  }
}

/** Remove a background (also clears the cache). */
export async function removeBackground(key: string): Promise<void> {
  cache.delete(key);
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    });
    db.close();
  } catch (err) {
    console.error("Failed to remove background.", err);
  }
}

/** Delete any stored background whose key is not in `keep` (keeps storage tidy). */
export async function pruneBackgrounds(keep: Set<string>): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const keys = await idbRequest<IDBValidKey[]>(store.getAllKeys());
    for (const key of keys) {
      if (typeof key === "string" && !keep.has(key)) {
        store.delete(key);
        cache.delete(key);
      }
    }
    db.close();
  } catch (err) {
    console.error("Failed to prune backgrounds.", err);
  }
}

/** Decode an image file, downscale it to a sane size, and return a compressed data URL. */
export async function fileToBackgroundDataUrl(file: File): Promise<string> {
  if (file.size > MAX_BACKGROUND_FILE_BYTES) {
    throw new Error("That image is too large (max 10 MB).");
  }
  const source = await decodeImage(file);
  const width = source.width;
  const height = source.height;
  const scale =
    width > 0 && height > 0 ? Math.min(1, MAX_BACKGROUND_EDGE / Math.max(width, height)) : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.drawImage(source, 0, 0, w, h);
  let out = canvas.toDataURL("image/webp", 0.82);
  if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", 0.85);
  return out;
}

async function decodeImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be read as an image."));
    };
    img.src = url;
  });
}
