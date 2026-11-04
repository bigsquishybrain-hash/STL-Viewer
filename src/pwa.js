// Install / offline / update plumbing.

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS 13+ pretends to be a Mac
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * @param {object} ui
 * @param {HTMLButtonElement} ui.installBtn   shown when the app can be installed
 * @param {HTMLElement} ui.iosHelp            popup explaining Share → Add to Home Screen
 * @param {(msg: string, action?: {label: string, run: () => void}) => void} ui.notify
 * @param {(files: File[]) => void} ui.onLaunchFiles  files opened via "Open with" on desktop
 */
export function setupPwa({ installBtn, iosHelp, notify, onLaunchFiles }) {
  // ---------- service worker ----------
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    let reloading = false;
    // The very first install also fires controllerchange (clients.claim); only reload for updates.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const offerUpdate = (worker) =>
          notify('A new version of the app is ready.', {
            label: 'Update',
            run: () => worker.postMessage('skip-waiting'),
          });
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state !== 'installed') return;
            if (navigator.serviceWorker.controller) offerUpdate(w);
            else notify('Ready to work offline.');
          });
        });
        // Check for updates when the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('service worker registration failed', err));
  }

  // ---------- install button ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  if (isIOS() && !isStandalone()) installBtn.hidden = false;

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') installBtn.hidden = true;
      deferredPrompt = null;
      return;
    }
    iosHelp.hidden = false;
  });
  iosHelp.addEventListener('click', (e) => {
    if (e.target === iosHelp || e.target.closest('[data-close]')) iosHelp.hidden = true;
  });

  // ---------- "Open with STL Viewer" (desktop Chrome/Edge file handling) ----------
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map((h) => h.getFile()));
      onLaunchFiles(files);
    });
  }
}
