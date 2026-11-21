const KEY = 'delEverything';
const WAND = 'st-cleaner-wand-entry';
const DRAWER = 'st-cleaner-settings-drawer';
const DEF = { enabled: true, showWandButton: true, enableBootProfiler: true };
const ctx = () => globalThis.SillyTavern?.getContext?.() || null;
const idle = (fn) => (globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 48));

function cfg() {
  const s = ctx()?.extensionSettings || ctx()?.extension_settings;
  return s ? (s[KEY] = Object.assign({}, DEF, s[KEY])) : { ...DEF };
}

async function openModal() {
  if (!cfg().enabled) return;
  const m = document.getElementById('extensionsMenu');
  if (m) m.style.display = 'none';
  (await import('./ui.js')).openCleanerModal();
}

function syncWand() {
  const m = document.getElementById('extensionsMenu');
  if (!m) return false;
  let el = document.getElementById(WAND);
  if (!el) {
    el = document.createElement('div');
    el.id = WAND;
    el.className = 'list-group-item flex-container flexGap5 interactable';
    el.innerHTML = '<div class="fa-fw fa-solid fa-broom extensionsMenuExtensionButton"></div><span>数据清理与启动诊断</span>';
    el.onclick = openModal;
    m.appendChild(el);
  }
  const c = cfg();
  el.style.display = (c.enabled && c.showWandButton) ? '' : 'none';
  return true;
}

let n = 0;
const tid = setInterval(() => { if (syncWand() || ++n > 25) clearInterval(tid); }, 300);

const boot = () => idle(async () => {
  const { recordBootSnapshotOnce, mountSettingsDrawer } = await import('./profiler.js');
  const c = cfg();
  const snap = (c.enabled && c.enableBootProfiler) ? recordBootSnapshotOnce() : null;
  const tryDrawer = () => mountSettingsDrawer({
    drawerId: DRAWER,
    getCfg: cfg,
    bootMs: snap?.currentBoot?.totalMs,
    onToggle: (k, v) => { cfg()[k] = v; ctx()?.saveSettingsDebounced?.(); syncWand(); },
    onOpen: () => { cfg().enabled = true; syncWand(); openModal(); },
  });
  if (!tryDrawer()) setTimeout(tryDrawer, 800);
});

const evt = ctx()?.eventTypes?.APP_READY || ctx()?.event_types?.APP_READY;
if (evt && ctx()?.eventSource?.on) ctx().eventSource.on(evt, boot);
if (document.readyState === 'complete') boot();
else addEventListener('load', boot, { once: true });
