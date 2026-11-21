/**
 * @fileoverview Startup API load time profiler for SillyTavern.
 * Uses browser native W3C Resource Timing API in an idle callback after APP_READY
 * so cold-start overhead is strictly < 1ms and zero fetch monkey-patching is required.
 */

export const BOOT_STORAGE_KEY = 'st_cleaner_boot_stats_v1';

/**
 * Safari / older WebView safe idle callback wrapper.
 * @param {(deadline: { timeRemaining: () => number }) => void} callback
 */
export function scheduleIdle(callback) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: 2500 });
  } else {
    setTimeout(() => callback({ timeRemaining: () => 8 }), 32);
  }
}

/** @type {Array<{ id: string, label: string, targetCategory: string, targetSub?: string, color: string }>} */
export const BOOT_BUCKETS = [
  {
    id: 'characters',
    label: '角色卡与群组',
    targetCategory: 'characters',
    color: '#007aff',
  },
  {
    id: 'settings',
    label: '预设与核心配置',
    targetCategory: 'presets',
    color: '#5856d6',
  },
  {
    id: 'extensions',
    label: '第三方扩展脚本',
    targetCategory: 'extensions',
    targetSub: 'third_party_ext',
    color: '#32ade6',
  },
  {
    id: 'backgrounds',
    label: '背景与媒体资源',
    targetCategory: 'personas',
    targetSub: 'backgrounds',
    color: '#34c759',
  },
  {
    id: 'chats_worlds',
    label: '默认会话与世界书',
    targetCategory: 'chats',
    color: '#af52de',
  },
  {
    id: 'avatars_media',
    label: '头像与缩略图',
    targetCategory: 'personas',
    targetSub: 'user_personas',
    color: '#ff9f0a',
  },
];

/**
 * Maps a resource URL to one of the 6 actionable startup buckets.
 * @param {string} rawUrl
 * @returns {string | null}
 */
export function classifyBootResource(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const url = rawUrl.toLowerCase();

  if (
    url.includes('api/characters/all') ||
    url.includes('api/characters/get') ||
    url.includes('api/groups/all')
  ) {
    return 'characters';
  }

  if (url.includes('api/settings/get')) {
    return 'settings';
  }

  if (
    url.includes('api/extensions/discover') ||
    url.includes('/scripts/extensions/third-party/')
  ) {
    return 'extensions';
  }

  if (
    url.includes('api/backgrounds/all') ||
    url.includes('api/backgrounds/folders')
  ) {
    return 'backgrounds';
  }

  if (
    url.includes('api/chats/get') ||
    url.includes('api/chats/group/get') ||
    url.includes('api/worldinfo/get') ||
    url.includes('api/worldinfo/list')
  ) {
    return 'chats_worlds';
  }

  if (
    url.includes('api/avatars/get') ||
    url.includes('/thumbnail') ||
    url.includes('/user%20avatars/') ||
    url.includes('/characters/') ||
    url.includes('/backgrounds/')
  ) {
    return 'avatars_media';
  }

  return null;
}

/**
 * Merges overlapping [start, end] intervals so parallel requests report true wall-clock blocking span.
 * @param {Array<[number, number]>} intervals
 * @returns {number}
 */
export function mergeIntervalsDuration(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return 0;
  const valid = intervals
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e >= s)
    .sort((a, b) => a[0] - b[0]);

  if (valid.length === 0) return 0;

  let total = 0;
  let [curStart, curEnd] = valid[0];

  for (let i = 1; i < valid.length; i++) {
    const [nextStart, nextEnd] = valid[i];
    if (nextStart <= curEnd) {
      if (nextEnd > curEnd) curEnd = nextEnd;
    } else {
      total += curEnd - curStart;
      curStart = nextStart;
      curEnd = nextEnd;
    }
  }
  total += curEnd - curStart;
  return Math.round(total);
}

/**
 * Collects startup metrics from Performance API entries.
 * @param {object} [perfObj] Optional performance mock for unit tests
 * @returns {{ timestamp: number, timeOrigin: number, totalMs: number, totalBytes: number, buckets: Array<{ id: string, label: string, targetCategory: string, targetSub?: string, color: string, durationMs: number, count: number, bytes: number }> }}
 */
export function collectStartupSnapshot(perfObj = typeof performance !== 'undefined' ? performance : null) {
  const nowTs = Date.now();
  if (!perfObj || typeof perfObj.getEntriesByType !== 'function') {
    return {
      timestamp: nowTs,
      timeOrigin: nowTs,
      totalMs: 0,
      totalBytes: 0,
      buckets: BOOT_BUCKETS.map((b) => ({ ...b, durationMs: 0, count: 0, bytes: 0 })),
    };
  }

  let resources = [];
  let navEntries = [];
  try {
    resources = Array.isArray(perfObj.getEntriesByType('resource')) ? perfObj.getEntriesByType('resource') : [];
    navEntries = Array.isArray(perfObj.getEntriesByType('navigation')) ? perfObj.getEntriesByType('navigation') : [];
  } catch {
    resources = [];
    navEntries = [];
  }

  /** @type {Record<string, { intervals: Array<[number, number]>, count: number, bytes: number }>} */
  const acc = {};
  for (const b of BOOT_BUCKETS) {
    acc[b.id] = { intervals: [], count: 0, bytes: 0 };
  }

  let maxEnd = 0;
  let totalBytes = 0;

  for (const entry of resources) {
    if (!entry || typeof entry !== 'object') continue;
    const start = Number(entry.startTime) || 0;
    const end = Number(entry.responseEnd) || start + (Number(entry.duration) || 0);
    if (end > maxEnd) maxEnd = end;

    const bytes = Math.max(
      Number(entry.decodedBodySize) || 0,
      Number(entry.transferSize) || 0,
      Number(entry.encodedBodySize) || 0
    );
    totalBytes += bytes;

    const bucketId = classifyBootResource(entry.name);
    if (bucketId && acc[bucketId]) {
      acc[bucketId].intervals.push([start, end]);
      acc[bucketId].count += 1;
      acc[bucketId].bytes += bytes;
    }
  }

  const navEnd = navEntries[0]
    ? Number(navEntries[0].loadEventEnd || navEntries[0].domComplete || 0)
    : 0;
  const totalMs = Math.max(Math.round(maxEnd), Math.round(navEnd), 0);

  const buckets = BOOT_BUCKETS.map((b) => {
    const item = acc[b.id];
    return {
      ...b,
      durationMs: mergeIntervalsDuration(item.intervals),
      count: item.count,
      bytes: item.bytes,
    };
  }).sort((a, b) => b.durationMs - a.durationMs);

  return {
    timestamp: nowTs,
    timeOrigin: Math.round(Number(perfObj.timeOrigin) || nowTs),
    totalMs,
    totalBytes,
    buckets,
  };
}

/**
 * Reads persisted current & previous boot snapshots.
 * @param {Storage} [storage]
 * @returns {{ currentBoot: any | null, previousBoot: any | null }}
 */
export function readBootHistory(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return { currentBoot: null, previousBoot: null };
  try {
    const raw = storage.getItem(BOOT_STORAGE_KEY);
    if (!raw) return { currentBoot: null, previousBoot: null };
    const parsed = JSON.parse(raw);
    return {
      currentBoot: parsed?.currentBoot || null,
      previousBoot: parsed?.previousBoot || null,
    };
  } catch {
    return { currentBoot: null, previousBoot: null };
  }
}

/**
 * Records current boot snapshot once per page navigation (timeOrigin).
 * @param {object} [perfObj]
 * @param {Storage} [storage]
 */
export function recordBootSnapshotOnce(
  perfObj = typeof performance !== 'undefined' ? performance : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage || !perfObj) return null;
  const snapshot = collectStartupSnapshot(perfObj);
  const existing = readBootHistory(storage);

  if (existing.currentBoot && existing.currentBoot.timeOrigin === snapshot.timeOrigin) {
    const oldApiSum = (existing.currentBoot.buckets || []).reduce((s, b) => s + (b.durationMs || 0), 0);
    const newApiSum = (snapshot.buckets || []).reduce((s, b) => s + (b.durationMs || 0), 0);
    if (newApiSum < oldApiSum) {
      return existing;
    }
    const updated = {
      currentBoot: snapshot,
      previousBoot: existing.previousBoot,
    };
    try {
      storage.setItem(BOOT_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
    return updated;
  }

  const nextState = {
    currentBoot: snapshot,
    previousBoot: existing.currentBoot || existing.previousBoot || null,
  };

  try {
    storage.setItem(BOOT_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignore quota errors
  }
  return nextState;
}

/**
 * Formats milliseconds into concise human-readable string (e.g., "1.42 s" or "85 ms").
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${Math.round(n)} ms`;
}

/**
 * Formats byte count into KB / MB / GB.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Mounts the collapsible settings drawer inside #extensions_settings2 / #extensions_settings.
 */
export function mountSettingsDrawer({ drawerId, getCfg, onToggle, onOpen, bootMs }) {
  const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!host) return false;
  let wrap = document.getElementById(drawerId);
  if (!wrap) {
    const c = getCfg();
    const chk = (k, label) =>
      `<label class="st-cleaner-setting-row"><span>${label}</span><input type="checkbox" data-k="${k}" ${c[k] ? 'checked' : ''}></label>`;
    wrap = document.createElement('div');
    wrap.id = drawerId;
    wrap.className = 'inline-drawer st-cleaner-settings-drawer';
    wrap.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>数据清理与启动诊断 (ST-Cleaner)</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content st-cleaner-drawer-body">
        ${chk('enabled', '启用插件总开关')}
        ${chk('showWandButton', '在左下角魔法棒菜单显示入口')}
        ${chk('enableBootProfiler', '静默记录启动耗时对比')}
        <div class="st-cleaner-boot-hint" data-hint>${bootMs ? `最近启动耗时：${formatDuration(bootMs)}` : '就绪后静默采集启动耗时'}</div>
        <div class="menu_button menu_button_icon interactable" data-open><i class="fa-solid fa-broom"></i><span>打开数据清理中心</span></div>
      </div>`;
    wrap.addEventListener('change', (ev) => {
      const k = ev.target?.dataset?.k;
      if (k) onToggle(k, Boolean(ev.target.checked));
    });
    wrap.querySelector('[data-open]')?.addEventListener('click', onOpen);
    host.appendChild(wrap);
  } else if (bootMs) {
    const hint = wrap.querySelector('[data-hint]');
    if (hint) hint.textContent = `最近启动耗时：${formatDuration(bootMs)}`;
  }
  return true;
}

