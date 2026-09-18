import "./style.css";
import "./events";
import { startRepaint, stopRepaint } from "./repaint";
import { unlockAudio } from "./sound";
import {
  activeSession,
  applyTheme,
  breakState,
  quickRun,
  settings,
  setSettings,
  setState,
  state,
} from "./state";
import { openDialog, downloadTextFile } from "./dialogs";
import {
  BACKUP_KEY,
  SETTINGS_KEY,
  STATE_KEY,
  buildExport,
  loadSettings,
  loadState,
  onStorageQuotaExceeded,
  saveDailySnapshot,
} from "./storage";
import { render } from "./views";
import { customBackgroundKey } from "./backgrounds";
import { loadBackgrounds, pruneBackgrounds } from "./backgroundStore";

/** 0086: hydrate custom rest-background images, then repaint if a rest is showing. */
function hydrateBackgrounds(): void {
  const entries = settings.customBackgrounds;
  const keep = new Set(entries.map((b) => customBackgroundKey(b.id)));
  void pruneBackgrounds(keep);
  void loadBackgrounds([...keep]).then(() => {
    if (breakState) render();
  });
}

// Unlock audio on first interaction (browser autoplay policy).
document.addEventListener("pointerdown", () => unlockAudio(), { once: true });

// 0061: surface a calm message (once) when localStorage is full, prompting an export.
onStorageQuotaExceeded(() => {
  const overlay = openDialog(`
    <h3>Storage is full</h3>
    <p class="dialog-text">UltradianDrift couldn't save your latest change. Nothing is lost yet, but new
    changes won't be saved until you free up space. Export your data to keep it safe.</p>
    <div class="dialog-actions">
      <button id="quota-export" class="primary">Export data</button>
      <button id="quota-ok" class="ghost">OK</button>
    </div>`);
  overlay.querySelector("#quota-export")!.addEventListener("click", () => {
    downloadTextFile(
      `ultradiandrift-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(buildExport(settings, state), null, 2),
      "application/json",
    );
    overlay.remove();
  });
  overlay.querySelector("#quota-ok")!.addEventListener("click", () => overlay.remove());
});

function syncTransientState(): void {
  const active = activeSession();
  if (
    active?.status === "running" ||
    active?.status === "paused" ||
    breakState !== null ||
    quickRun !== null
  ) {
    startRepaint();
  } else {
    stopRepaint();
  }
}

// 0056: reflect changes made in another tab without a manual reload. The `storage`
// event only fires in the *other* tabs, so a local save can never re-trigger itself.
window.addEventListener("storage", (e) => {
  if (e.key === STATE_KEY) {
    setState(loadState());
  } else if (e.key === SETTINGS_KEY) {
    setSettings(loadSettings());
    applyTheme();
    hydrateBackgrounds();
  } else if (e.key === BACKUP_KEY) {
    return; // backups are transient; nothing to re-render
  } else {
    return;
  }
  syncTransientState();
  render();
});

applyTheme();
saveDailySnapshot(settings, state);
hydrateBackgrounds();
render();
syncTransientState();

// Offline support via service worker (0050).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is progressive enhancement */
    });
  });
}
