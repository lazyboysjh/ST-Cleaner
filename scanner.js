/**
 * @file scanner.js
 * Multi-version SillyTavern data scanner & reference analyzer (ST 1.13.x -> 1.19.x+).
 * Lazy per-category scanning, shallow-character hydration, strict composite-key whitelist.
 */

export const SELF_EXTENSION_ID = 'ST-Cleaner';
export const LEGACY_SELF_EXTENSION_ID = 'delEverything';

/**
 * 9 top-level categories & sub-group definitions for Bento overview + virtualized list.
 */
export const CATEGORY_DEFS = [
    {
        id: 'characters',
        label: '角色与群组',
        shortDesc: '角色卡、独立表情包与群聊房间',
        icon: 'fa-solid fa-users',
        bootBucketKey: 'characters',
        subgroups: [
            { id: 'char_cards', label: '角色卡' },
            { id: 'char_sprites', label: '角色立绘表情包' },
            { id: 'groups', label: '群聊房间' },
        ],
    },
    {
        id: 'chats',
        label: '聊天记录',
        shortDesc: '保留角色/群组，按会话清理历史记录',
        icon: 'fa-solid fa-comments',
        bootBucketKey: 'chats_worlds',
        subgroups: [
            { id: 'char_chats', label: '角色单聊会话' },
            { id: 'group_chats', label: '群聊单条会话' },
        ],
    },
    {
        id: 'regex',
        label: '正则与脚本',
        shortDesc: '正则脚本、酒馆助手脚本与全局持久变量',
        icon: 'fa-solid fa-code',
        bootBucketKey: null,
        subgroups: [
            { id: 'regex_global', label: '全局正则' },
            { id: 'regex_scoped', label: '角色局部正则' },
            { id: 'regex_preset', label: '预设内嵌正则' },
            { id: 'regex_combos', label: '正则预设组合' },
            { id: 'th_global', label: '酒馆助手全局脚本' },
            { id: 'th_char', label: '酒馆助手角色脚本' },
            { id: 'th_preset', label: '酒馆助手预设脚本' },
            { id: 'global_vars', label: 'ST 全局脚本变量' },
        ],
    },
    {
        id: 'worldinfo',
        label: '世界书',
        shortDesc: '已绑定/闲置独立世界书与角色内嵌世界书',
        icon: 'fa-solid fa-book-atlas',
        bootBucketKey: null,
        subgroups: [
            { id: 'wi_unbound', label: '未绑定闲置世界书' },
            { id: 'wi_bound', label: '已绑定独立世界书' },
            { id: 'wi_embedded', label: '角色内嵌世界书' },
        ],
    },
    {
        id: 'presets',
        label: '预设与模板',
        shortDesc: '聊天/文本补全预设与指令/上下文/系统/推理模板',
        icon: 'fa-solid fa-sliders',
        bootBucketKey: 'settings',
        subgroups: [
            { id: 'preset_openai', label: '聊天补全预设' },
            { id: 'preset_textgen', label: '文本补全预设' },
            { id: 'preset_instruct', label: '指令模板' },
            { id: 'preset_context', label: '上下文模板' },
            { id: 'preset_sysprompt', label: '系统提示词' },
            { id: 'preset_reasoning', label: '推理模板' },
            { id: 'preset_novel', label: 'NovelAI 预设' },
            { id: 'preset_kobold', label: 'KoboldAI 预设' },
        ],
    },
    {
        id: 'profiles',
        label: 'API 插头',
        shortDesc: '连接配置插头（不动密钥文件 secrets.json）',
        icon: 'fa-solid fa-plug',
        bootBucketKey: null,
        subgroups: [
            { id: 'conn_profiles', label: '连接配置插头' },
        ],
    },
    {
        id: 'personas',
        label: '人设与外观',
        shortDesc: '用户人设头像、聊天背景图与自定义主题',
        icon: 'fa-solid fa-masks-theater',
        bootBucketKey: 'backgrounds',
        subgroups: [
            { id: 'user_personas', label: '用户人设' },
            { id: 'backgrounds', label: '背景图片' },
            { id: 'themes', label: '自定义主题' },
        ],
    },
    {
        id: 'media',
        label: '媒体与资产',
        shortDesc: '快捷回复、资料库、画廊、音效资产、工作流与标签',
        icon: 'fa-solid fa-photo-film',
        bootBucketKey: null,
        subgroups: [
            { id: 'quick_replies', label: '快捷回复集' },
            { id: 'databank', label: '资料库附件' },
            { id: 'gallery_images', label: '画廊与聊天图片' },
            { id: 'user_assets', label: '音效与环境音资产' },
            { id: 'comfy_workflows', label: 'ComfyUI 生图工作流' },
            { id: 'tags', label: '角色标签' },
        ],
    },
    {
        id: 'extensions',
        label: '扩展与备份',
        shortDesc: '第三方扩展、向量缓存、聊天备份与无主孤儿文件',
        icon: 'fa-solid fa-puzzle-piece',
        bootBucketKey: 'extensions',
        subgroups: [
            { id: 'third_party_ext', label: '第三方扩展' },
            { id: 'vectors', label: '向量缓存集合' },
            { id: 'chat_backups', label: '聊天备份文件' },
            { id: 'data_maid', label: '无主冗余孤儿文件' },
        ],
    },
];

export const HARD_PROTECTED_BACKGROUNDS = new Set([
    '__transparent.png',
]);

export const OFFICIAL_BUILTIN_THEMES = new Set([
    'Dark Lite',
    'Cappuccino',
    'Celestial Macaron',
    'Dark V 1.0',
    'Azure',
]);

export const OFFICIAL_BUILTIN_BACKGROUNDS = new Set([
    '__transparent.png',
    '_black.jpg',
    '_white.jpg',
    'bedroom clean.jpg',
    'bedroom cyberpunk.jpg',
    'bedroom red.jpg',
    'bedroom tatami.jpg',
    'cityscape medieval market.jpg',
    'cityscape medieval night.jpg',
    'cityscape postapoc.jpg',
    'forest treehouse fireworks air baloons (by kallmeflocc).jpg',
    'japan classroom side.jpg',
    'japan classroom.jpg',
    'japan path cherry blossom.jpg',
    'japan university.jpg',
    'landscape autumn great tree.jpg',
    'landscape beach day.png',
    'landscape beach night.jpg',
    'landscape mountain lake.jpg',
    'landscape postapoc.jpg',
    'landscape winter lake house.jpg',
    'royal.jpg',
    'tavern day.jpg',
]);

export const OFFICIAL_BUILTIN_PRESET_NAMES = new Set([
    'Default', 'Blank', 'Deterministic', 'Neutral', 'RecoveredRuins',
    'Universal-Creative', 'Universal-Light', 'Universal-Super-Creative',
    'Asper-Kayra', 'Blended-Coffee-Kayra', 'Blook-Kayra', 'Carefree-Kayra',
    'CosmicCube-Kayra', 'Edgewise-Clio', 'Fresh-Coffee-Clio', 'Fresh-Coffee-Kayra',
    'Green-Active-Writer-Kayra', 'Keelback-Clio', 'Long-Press-Clio', 'Pilotfish-Kayra',
    'Pro_Writer-Kayra', 'Stelenes-Kayra', 'Talker-Chat-Clio', 'Tea_Time-Kayra',
    'Tesseract-Kayra', 'Vingt-Un-Clio', 'Writers-Daemon-Kayra', 'Erato-Dragonfruit',
    'Erato-Golden Arrow', 'Erato-Shosetsu', 'Erato-Wilder', 'Erato-Zany Scribe',
    'Adventure', 'Alpaca-Single-Turn', 'Alpaca', 'ChatML', 'ChatML-Names',
    'Libra-32B', 'Lightning 1.1', 'Llama 2 Chat', 'Llama 3 Instruct', 'Llama 4 Instruct',
    'Llama-3-Instruct-Names', 'Minimalist', 'NovelAI', 'OldDefault', 'Metharme',
    'Story', 'Synthia', 'simple-proxy-for-tavern', 'Command R', 'Phi', 'Tulu',
    'Koala', 'OpenOrca-OpenChat', 'Vicuna 1.0', 'Vicuna 1.1', 'WizardLM-13B',
    'WizardLM', 'KoboldAI', 'Gemma 2', 'Gemma 4', 'Mistral V1', 'Mistral V2 & V3',
    'Mistral V3-Tekken', 'Mistral V7', 'Mistral V7-Tekken', 'DeepSeek-V2.5', 'DeepSeek',
    'GLM-4', 'Dots1', 'Moonshot AI', 'OpenAI Harmony', 'OpenAI Harmony (Thinking)',
    'Think XML', 'Actor', 'Assistant - Expert', 'Assistant - Simple', 'Chain of Thought',
    'Roleplay - Detailed', 'Roleplay - Immersive', 'Roleplay - Simple', 'Text Adventure',
    'Writer - Creative', 'Writer - Realistic', 'Neutral - Chat',
]);

export const CORE_ECOSYSTEM_EXT_PATTERNS = [
    { match: /js-slash-runner|tavern[-_]?helper|酒馆助手/i, label: '酒馆助手核心底座' },
    { match: /st-prompt-template|prompt[-_]?template/i, label: '提示词模板核心底座' },
    { match: /littlewhitebox|xiaobaix|小白/i, label: '小白X前端渲染底座' },
    { match: /memory[-_]?books/i, label: '记忆书总结核心扩展' },
];

export function matchCoreEcosystemExt(extName) {
    const s = String(extName || '');
    for (const entry of CORE_ECOSYSTEM_EXT_PATTERNS) {
        if (entry.match.test(s)) return entry.label;
    }
    return '';
}

let cachedHostModulesPromise = null;

/**
 * Lazily imports SillyTavern's live frontend ES modules (`world-info.js`, `personas.js`, `script.js`)
 * when running inside a real SillyTavern browser tab so live unexported state (`selected_world_info`,
 * `world_info`, `user_avatar`, `saveSettings`, `getCharacters`, `updateWorldInfoList`) stays 100% synced.
 * Gracefully resolves to `{}` in standalone Node test environments.
 */
export function loadHostModules() {
    if (cachedHostModulesPromise) return cachedHostModulesPromise;
    cachedHostModulesPromise = (async () => {
        const mods = { worldInfo: null, personas: null, script: null };
        if (typeof window === 'undefined') return mods;
        const tryImport = async (rel) => {
            try {
                return await import(new URL(rel, import.meta.url).href);
            } catch {
                return null;
            }
        };
        const [wi, per, scr] = await Promise.all([
            tryImport('../../../world-info.js'),
            tryImport('../../../personas.js'),
            tryImport('../../../../script.js'),
        ]);
        mods.worldInfo = wi;
        mods.personas = per;
        mods.script = scr;
        return mods;
    })();
    return cachedHostModulesPromise;
}

/**
 * Resolves the runtime extension folder name from import.meta.url so self-exclusion
 * works even if the user cloned into a custom directory name.
 * @param {string} [metaUrl]
 * @returns {string}
 */
export function resolveSelfFolderName(metaUrl = import.meta.url) {
    try {
        const clean = String(metaUrl || '').split('?')[0].split('#')[0];
        const parts = clean.split('/').filter(Boolean);
        // Expected .../scripts/extensions/third-party/<folderName>/scanner.js
        if (parts.length >= 2) {
            return decodeURIComponent(parts[parts.length - 2]);
        }
    } catch {
        // Fallback below
    }
    return SELF_EXTENSION_ID;
}

/**
 * Exact cyrb53 hash matching SillyTavern's getStringHash in public/scripts/utils.js.
 * @param {string} str
 * @param {number} [seed=0]
 * @returns {number}
 */
export function computeStringHash(str, seed = 0) {
    if (typeof str !== 'string') return 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Strips .jsonl / .png suffix for display or file_id matching.
 * @param {string} filename
 * @param {string} ext
 * @returns {string}
 */
export function stripExt(filename, ext) {
    const s = String(filename || '');
    return s.toLowerCase().endsWith(ext.toLowerCase()) ? s.slice(0, -ext.length) : s;
}

/**
 * Parses `api/backgrounds/all` across ST 1.13.x (string[]), intermediate object[],
 * and ST 1.17+/1.19+ (`{ images: [{ filename, isAnimated }], config }`).
 * @param {any} payload
 * @returns {{ filename: string, isAnimated: boolean }[]}
 */
export function parseBackgroundsPayload(payload) {
    if (!payload) return [];
    const rawList = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload.images) ? payload.images : []);

    const out = [];
    const seen = new Set();
    for (const entry of rawList) {
        let filename = '';
        let isAnimated = false;
        if (typeof entry === 'string') {
            filename = entry.trim();
        } else if (entry && typeof entry === 'object') {
            filename = String(entry.filename ?? entry.name ?? entry.bg ?? '').trim();
            isAnimated = Boolean(entry.isAnimated);
        }
        if (!filename || HARD_PROTECTED_BACKGROUNDS.has(filename) || seen.has(filename)) continue;
        seen.add(filename);
        out.push({ filename, isAnimated });
    }
    return out;
}

/**
 * Parses SillyTavern's varied timestamp formats into epoch milliseconds (or 0 if unavailable):
 * - numeric ms / s (`1732190000000` / `1732190000`)
 * - ST date strings (`"2026-11-20 @12h05m00s"`, `"2026-11-20@12h05m00s"`, `"November 20, 2026"`)
 * - Filename date prefixes/suffixes (`"2026-11-20@塔罗会.jsonl"`, `"chat_klein_20261119.jsonl"`)
 * @param {any} raw
 * @param {string} [fallbackText]
 * @returns {number}
 */
export function parseTavernTimestamp(raw, fallbackText = '') {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return raw < 1e11 ? Math.round(raw * 1000) : Math.round(raw);
    }
    const candidates = [];
    if (raw !== undefined && raw !== null && raw !== '') candidates.push(String(raw).trim());
    if (fallbackText) candidates.push(String(fallbackText).trim());

    for (const str of candidates) {
        if (!str) continue;
        if (/^\d{10,13}$/.test(str)) {
            const n = Number(str);
            return str.length === 10 ? n * 1000 : n;
        }
        // Match YYYY-MM-DD with optional @HHhMMmSSs
        const stMatch = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[\s@T_-]*(\d{1,2})[h:](\d{1,2})(?:[m:](\d{1,2}))?)?/);
        if (stMatch) {
            const y = Number(stMatch[1]);
            const m = Number(stMatch[2]) - 1;
            const d = Number(stMatch[3]);
            const hh = Number(stMatch[4] || 0);
            const mm = Number(stMatch[5] || 0);
            const ss = Number(stMatch[6] || 0);
            const ts = Date.UTC(y, m, d, hh, mm, ss);
            if (Number.isFinite(ts) && ts > 0) return ts;
        }
        // Match compact YYYYMMDD (e.g. backup filename `chat_name_20261119_120000.jsonl`)
        const compactMatch = str.match(/(?:^|[^\d])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[_-]?(\d{2})(\d{2})(\d{2})?)?/);
        if (compactMatch) {
            const ts = Date.UTC(
                Number(compactMatch[1]),
                Number(compactMatch[2]) - 1,
                Number(compactMatch[3]),
                Number(compactMatch[4] || 0),
                Number(compactMatch[5] || 0),
                Number(compactMatch[6] || 0),
            );
            if (Number.isFinite(ts) && ts > 0) return ts;
        }
        const parsed = Date.parse(str);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

/**
 * Parses human-readable file size strings like `"14.2 KB"`, `"1.5 MB"`, `"820 B"` into bytes.
 * @param {any} raw
 * @returns {number}
 */
export function parseSizeStringBytes(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.round(raw);
    const s = String(raw || '').trim();
    if (!s) return 0;
    const m = s.match(/^([\d.]+)\s*(b|kb|mb|gb)?$/i);
    if (!m) return 0;
    const val = Number(m[1]);
    if (!Number.isFinite(val)) return 0;
    const unit = (m[2] || 'b').toLowerCase();
    if (unit === 'gb') return Math.round(val * 1024 * 1024 * 1024);
    if (unit === 'mb') return Math.round(val * 1024 * 1024);
    if (unit === 'kb') return Math.round(val * 1024);
    return Math.round(val);
}

export function formatShortDate(ms) {
    const n = Number(ms) || 0;
    if (n <= 0) return '';
    try {
        const d = new Date(n);
        if (Number.isNaN(d.getTime())) return '';
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch {
        return '';
    }
}

/**
 * Bounded concurrency worker helper with AbortSignal support.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {AbortSignal} [signal]
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, concurrency, worker, signal) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];
    const results = new Array(list.length);
    const limit = Math.max(1, Math.min(concurrency || 4, list.length));
    let cursor = 0;

    async function next() {
        while (cursor < list.length) {
            if (signal?.aborted) {
                throw new DOMException('Scan aborted', 'AbortError');
            }
            const idx = cursor++;
            results[idx] = await worker(list[idx], idx);
        }
    }

    const runners = [];
    for (let i = 0; i < limit; i++) {
        runners.push(next());
    }
    await Promise.all(runners);
    return results;
}

/**
 * Extracts normalized `{ name, data }` pairs from ST's two preset collection styles:
 * 1) Indexed array + `{ [name]: index }` map (`openai_settings` + `openai_setting_names`)
 * 2) Array of `{ name, ... }` objects (`instruct`, `context`, `sysprompt`, `reasoning`)
 * @param {any} settingsArr
 * @param {any} namesMapOrArr
 * @returns {{ name: string, data: any }[]}
 */
export function parseMaybeJsonObject(val) {
    if (!val) return {};
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

export function extractNamedPresets(settingsArr, namesMapOrArr) {
    const out = [];
    const seen = new Set();

    if (namesMapOrArr && typeof namesMapOrArr === 'object' && !Array.isArray(namesMapOrArr)) {
        for (const [name, idx] of Object.entries(namesMapOrArr)) {
            if (!name || name === 'gui' || seen.has(name)) continue;
            seen.add(name);
            const rawData = Array.isArray(settingsArr) ? settingsArr[Number(idx)] : undefined;
            out.push({ name, data: parseMaybeJsonObject(rawData) });
        }
        return out;
    }

    if (Array.isArray(namesMapOrArr)) {
        for (let i = 0; i < namesMapOrArr.length; i++) {
            const entry = namesMapOrArr[i];
            const name = typeof entry === 'string' ? entry : entry?.name;
            if (!name || name === 'gui' || seen.has(name)) continue;
            seen.add(name);
            const rawData = typeof entry === 'object'
                ? entry
                : (Array.isArray(settingsArr) ? settingsArr[i] : {});
            out.push({ name, data: parseMaybeJsonObject(rawData) });
        }
        return out;
    }

    if (Array.isArray(settingsArr)) {
        for (const entry of settingsArr) {
            const parsedEntry = typeof entry === 'string' ? parseMaybeJsonObject(entry) : entry;
            const name = typeof entry === 'string' ? parsedEntry?.name : entry?.name;
            if (!name || name === 'gui' || seen.has(name)) continue;
            seen.add(name);
            out.push({ name, data: typeof parsedEntry === 'object' && parsedEntry ? parsedEntry : {} });
        }
    }
    return out;
}

export const BUILTIN_COMFY_WORKFLOWS = new Set([
    'Default_Comfy_Workflow.json',
    'Char_Avatar_Comfy_Workflow.json',
]);

/**
 * Extracts flattened TavernHelper / JS-Slash-Runner scripts from both v4 (`ScriptTree[]`
 * with `{ type: 'script' | 'folder', scripts }`) and v3 legacy (`{ type: 'script' | 'folder', value }`).
 * @param {any} treeArr
 * @returns {Array<{ id: string, name: string, enabled: boolean, info: string, folderName: string, folderEnabled: boolean }>}
 */
export function extractTavernHelperScripts(treeArr) {
    if (!Array.isArray(treeArr)) return [];
    const results = [];
    for (let i = 0; i < treeArr.length; i++) {
        const node = treeArr[i];
        if (!node || typeof node !== 'object') continue;

        if (node.type === 'folder') {
            const folderObj = (node.value && !Array.isArray(node.value) && typeof node.value === 'object')
                ? node.value
                : node;
            const folderName = String(folderObj.name || node.name || '脚本文件夹');
            const folderEnabled = (folderObj.enabled ?? node.enabled) !== false;
            const rawScriptsField = node.scripts ?? (Array.isArray(node.value) ? node.value : folderObj.scripts);
            const children = Array.isArray(rawScriptsField)
                ? rawScriptsField
                : (rawScriptsField && typeof rawScriptsField === 'object'
                    ? Object.entries(rawScriptsField).map(([k, v]) => (v && typeof v === 'object' ? { id: v.id ?? k, ...v } : null))
                    : []);
            for (let k = 0; k < children.length; k++) {
                const rawChild = children[k]?.type === 'script' && children[k]?.value ? children[k].value : children[k];
                if (!rawChild || typeof rawChild !== 'object') continue;
                results.push({
                    id: String(rawChild.id ?? `th_f_${i}_${k}`),
                    name: String(rawChild.name || `未命名脚本 #${k + 1}`),
                    enabled: Boolean(rawChild.enabled),
                    info: String(rawChild.info || ''),
                    folderName,
                    folderEnabled,
                });
            }
            continue;
        }

        const rawScript = node.type === 'script' && node.value && typeof node.value === 'object'
            ? node.value
            : node;
        results.push({
            id: String(rawScript.id ?? `th_${i}`),
            name: String(rawScript.name || `未命名脚本 #${i + 1}`),
            enabled: Boolean(rawScript.enabled),
            info: String(rawScript.info || ''),
            folderName: '',
            folderEnabled: true,
        });
    }
    return results;
}

/**
 * Removes scripts whose IDs are in `removeIdSet` from a v4 or v3 TavernHelper ScriptTree array
 * without destroying remaining folder scripts or unrelated scripts.
 * @param {any[]} treeArr
 * @param {Set<string>} removeIdSet
 * @returns {any[]}
 */
export function pruneTavernHelperTree(treeArr, removeIdSet) {
    if (!Array.isArray(treeArr) || !removeIdSet || removeIdSet.size === 0) {
        return Array.isArray(treeArr) ? treeArr : [];
    }
    const nextTree = [];
    for (let i = 0; i < treeArr.length; i++) {
        const node = treeArr[i];
        if (!node || typeof node !== 'object') continue;

        if (node.type === 'folder') {
            const filterChildren = (arr) => arr.filter((child, k) => {
                const raw = child?.type === 'script' && child?.value ? child.value : child;
                const sid = String(raw?.id ?? `th_f_${i}_${k}`);
                return !removeIdSet.has(sid);
            });

            if (Array.isArray(node.scripts)) {
                const kept = filterChildren(node.scripts);
                if (kept.length > 0 || node.scripts.length === 0) {
                    nextTree.push({ ...node, scripts: kept });
                }
            } else if (Array.isArray(node.value)) {
                const kept = filterChildren(node.value);
                if (kept.length > 0 || node.value.length === 0) {
                    nextTree.push({ ...node, value: kept });
                }
            } else if (node.value && typeof node.value === 'object' && Array.isArray(node.value.scripts)) {
                const kept = filterChildren(node.value.scripts);
                if (kept.length > 0 || node.value.scripts.length === 0) {
                    nextTree.push({ ...node, value: { ...node.value, scripts: kept } });
                }
            } else if (node.value && typeof node.value === 'object' && node.value.scripts && typeof node.value.scripts === 'object') {
                const nextMap = {};
                const origEntries = Object.entries(node.value.scripts);
                for (const [k, val] of origEntries) {
                    const sid = String(val?.id ?? k);
                    if (!removeIdSet.has(sid)) {
                        nextMap[k] = val;
                    }
                }
                if (Object.keys(nextMap).length > 0 || origEntries.length === 0) {
                    nextTree.push({ ...node, value: { ...node.value, scripts: nextMap } });
                }
            } else if (node.scripts && typeof node.scripts === 'object' && !Array.isArray(node.scripts)) {
                const nextMap = {};
                const origEntries = Object.entries(node.scripts);
                for (const [k, val] of origEntries) {
                    const sid = String(val?.id ?? k);
                    if (!removeIdSet.has(sid)) {
                        nextMap[k] = val;
                    }
                }
                if (Object.keys(nextMap).length > 0 || origEntries.length === 0) {
                    nextTree.push({ ...node, scripts: nextMap });
                }
            } else {
                nextTree.push(node);
            }
            continue;
        }

        const rawScript = node.type === 'script' && node.value && typeof node.value === 'object'
            ? node.value
            : node;
        const sid = String(rawScript?.id ?? `th_${i}`);
        if (!removeIdSet.has(sid)) {
            nextTree.push(node);
        }
    }
    return nextTree;
}

/**
 * Creates a stateful scanner session scoped to one modal lifecycle.
 * Calling `dispose()` releases all item caches and whitelists (`0 MB` idle memory).
 *
 * @param {object} [options]
 * @param {() => any} [options.getContext]
 * @param {typeof fetch} [options.fetchFn]
 * @param {string} [options.selfFolderName]
 * @param {() => boolean} [options.isAdminFn]
 */
export function createScannerSession(options = {}) {
    const getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.() || {});
    const fetchFn = options.fetchFn || ((...args) => globalThis.fetch(...args));
    const runtimeFolder = options.selfFolderName || resolveSelfFolderName();
    const excludedExtNames = new Set([
        SELF_EXTENSION_ID.toLowerCase(),
        LEGACY_SELF_EXTENSION_ID.toLowerCase(),
        String(runtimeFolder || '').toLowerCase(),
    ]);

    /** @type {Map<string, any>} Master composite-key whitelist consumed by deleter.js */
    const whitelistMap = new Map();
    /** @type {Map<string, { categoryId: string, groups: any[], totalCount: number, activeCount: number, scannedAt: number, warnings: string[] }>} */
    const categoryCache = new Map();

    let settingsSnapshot = null;
    let settingsPromise = null;
    let unshallowDone = false;
    let dataMaidToken = null;
    let dataMaidAvailable = null;
    const requestTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : 15000;

    function getHeaders(ctx) {
        try {
            if (typeof ctx?.getRequestHeaders === 'function') {
                return ctx.getRequestHeaders();
            }
        } catch {
            // Fallback below
        }
        return { 'Content-Type': 'application/json' };
    }

    async function apiJson(url, { method = 'POST', body, signal, allow404 = false } = {}) {
        if (signal?.aborted) {
            throw new DOMException('Scan aborted', 'AbortError');
        }
        const ctx = getContext();
        const headers = { ...getHeaders(ctx) };
        const controller = new AbortController();
        let timedOut = false;
        const onExternalAbort = () => controller.abort();
        if (signal) {
            signal.addEventListener('abort', onExternalAbort, { once: true });
        }
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, requestTimeoutMs);

        try {
            const init = { method, headers, signal: controller.signal };
            if (method !== 'GET' && method !== 'HEAD') {
                init.body = JSON.stringify(body ?? {});
            } else {
                delete headers['Content-Type'];
            }
            const res = await fetchFn(url, init);
            if (allow404 && res.status === 404) {
                return { __notFound: true, status: 404 };
            }
            if (!res.ok) {
                const err = new Error(`HTTP ${res.status} on ${url}`);
                err.status = res.status;
                throw err;
            }
            const text = await res.text();
            if (!text) return null;
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        } catch (err) {
            if (signal?.aborted) {
                throw new DOMException('Scan aborted', 'AbortError');
            }
            if (timedOut) {
                const timeoutErr = new Error(`请求超时 (${requestTimeoutMs}ms): ${url}`);
                timeoutErr.code = 'ETIMEDOUT';
                throw timeoutErr;
            }
            throw err;
        } finally {
            clearTimeout(timer);
            if (signal) {
                signal.removeEventListener('abort', onExternalAbort);
            }
        }
    }

    async function getSettingsSnapshot(signal, force = false) {
        if (signal?.aborted) {
            throw new DOMException('Scan aborted', 'AbortError');
        }
        if (settingsSnapshot && !force) return settingsSnapshot;
        if (!settingsPromise || force) {
            // Do not tie shared session metadata promise to one transient tab signal,
            // and never cache `{}` on transient failure so subsequent scans can retry cleanly.
            settingsPromise = apiJson('api/settings/get', { method: 'POST', body: {} })
                .then((data) => {
                    const normalized = data && typeof data === 'object' ? { ...data } : {};
                    if (typeof normalized.settings === 'string') {
                        normalized.settings = parseMaybeJsonObject(normalized.settings);
                    }
                    settingsSnapshot = normalized;
                    settingsPromise = null;
                    return settingsSnapshot;
                })
                .catch(() => {
                    settingsPromise = null;
                    return {};
                });
        }
        const res = await settingsPromise;
        if (signal?.aborted) {
            throw new DOMException('Scan aborted', 'AbortError');
        }
        return res;
    }

    function checkIsAdmin(ctx, settingsData) {
        if (typeof options.isAdminFn === 'function') {
            return Boolean(options.isAdminFn());
        }
        if (ctx?.currentUser && typeof ctx.currentUser.admin === 'boolean') {
            return ctx.currentUser.admin;
        }
        if (settingsData && settingsData.enable_accounts === false) {
            return true;
        }
        // Single-user default mode in SillyTavern has no multi-account restriction
        if (!ctx?.currentUser) {
            return true;
        }
        return false;
    }

    /**
     * Hydrates lazy-loaded (`shallow === true`) characters in ST 1.19+ so embedded
     * regex scripts, character_book, and bound worldbooks are never missed.
     */
    async function ensureCharactersUnshallowed(signal, onProgress) {
        const ctx = getContext();
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        if (unshallowDone) return characters;

        const shallowIndexes = [];
        for (let i = 0; i < characters.length; i++) {
            if (characters[i]?.shallow === true && characters[i]?.avatar) {
                shallowIndexes.push(i);
            }
        }

        if (shallowIndexes.length > 0) {
            let done = 0;
            await mapWithConcurrency(shallowIndexes, 4, async (charIdx) => {
                const charObj = characters[charIdx];
                if (!charObj || !charObj.shallow) return;
                try {
                    if (typeof ctx.unshallowCharacter === 'function') {
                        await ctx.unshallowCharacter(charIdx);
                    } else {
                        const fullChar = await apiJson('api/characters/get', {
                            method: 'POST',
                            body: { avatar_url: charObj.avatar },
                            signal,
                        });
                        if (fullChar && typeof fullChar === 'object') {
                            Object.assign(charObj, fullChar);
                            charObj.shallow = false;
                        }
                    }
                } catch (err) {
                    if (err?.name === 'AbortError' || signal?.aborted) {
                        throw new DOMException('Scan aborted', 'AbortError');
                    }
                    // Keep existing partial entry rather than aborting entire scan
                }
                done++;
                onProgress?.(`正在补全懒加载角色卡数据 (${done}/${shallowIndexes.length})...`);
            }, signal);
        }

        if (!signal?.aborted) {
            unshallowDone = true;
        }
        return characters;
    }

    let scanOrderCounter = 0;

    function registerItem(item) {
        const sizeBytes = Math.max(0, Number(item.sizeBytes) || 0);
        const normalized = {
            ...item,
            sizeBytes,
            sortTimeMs: Math.max(0, Number(item.sortTimeMs) || 0),
            sortMetric: Number.isFinite(Number(item.sortMetric)) ? Number(item.sortMetric) : sizeBytes,
            scanOrder: scanOrderCounter++,
            isCritical: Boolean(item.isCritical),
            criticalReason: String(item.criticalReason || ''),
            isCaution: Boolean(item.isCaution),
            facets: Array.isArray(item.facets) ? item.facets : [],
        };
        whitelistMap.set(normalized.key, normalized);
        return normalized;
    }

    function unregisterCategoryKeys(categoryId) {
        for (const [key, item] of whitelistMap.entries()) {
            if (item.categoryId === categoryId) {
                whitelistMap.delete(key);
            }
        }
    }

    /**
     * Collects all worldbook binding relationships across global, characters, personas, and active chat.
     */
    function collectWorldInfoBindings(ctx, hostMods) {
        /** @type {Map<string, { labels: string[], scopes: Set<string>, tagIds: Set<any> }>} */
        const bindings = new Map();
        const tagMap = ctx?.tagMap || ctx?.tag_map || {};

        const addBinding = (worldName, label, scope, charAvatar = '') => {
            const name = String(worldName || '').trim();
            if (!name) return;
            let rec = bindings.get(name);
            if (!rec) {
                rec = { labels: [], scopes: new Set(), tagIds: new Set() };
                bindings.set(name, rec);
            }
            if (!rec.labels.includes(label)) {
                rec.labels.push(label);
            }
            if (scope) {
                rec.scopes.add(scope);
            }
            if (charAvatar && Array.isArray(tagMap[charAvatar])) {
                for (const tid of tagMap[charAvatar]) {
                    rec.tagIds.add(tid);
                }
            }
        };

        const globalWorlds = hostMods?.worldInfo?.selected_world_info
            || ctx?.worldInfo?.globalSelect
            || ctx?.selected_world_info
            || settingsSnapshot?.settings?.world_info?.globalSelect
            || [];
        if (Array.isArray(globalWorlds)) {
            for (const w of globalWorlds) {
                addBinding(w, '全局启用', 'wi:global');
            }
        }

        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const charAvatarByName = new Map();
        for (const ch of characters) {
            if (ch?.name && ch?.avatar) charAvatarByName.set(ch.name, ch.avatar);
            if (ch?.avatar) charAvatarByName.set(stripExt(ch.avatar, '.png'), ch.avatar);
            const primary = ch?.data?.extensions?.world;
            if (primary) {
                addBinding(primary, `角色主世界书:${ch.name || ch.avatar}`, 'wi:char_primary', ch.avatar || '');
            }
        }

        const charLore = hostMods?.worldInfo?.world_info?.charLore
            || ctx?.worldInfo?.charLore
            || ctx?.world_info?.charLore
            || settingsSnapshot?.settings?.world_info?.charLore
            || [];
        if (Array.isArray(charLore)) {
            for (const entry of charLore) {
                const targetName = entry?.name || '角色附加';
                const linkedAvatar = charAvatarByName.get(targetName) || '';
                const books = Array.isArray(entry?.extraBooks) ? entry.extraBooks : [];
                for (const b of books) {
                    addBinding(b, `角色附加:${targetName}`, 'wi:char_extra', linkedAvatar);
                }
            }
        }

        const powerUser = ctx?.powerUserSettings || ctx?.power_user || {};
        if (powerUser.persona_description_lorebook) {
            addBinding(powerUser.persona_description_lorebook, '当前人设世界书', 'wi:persona_chat');
        }
        if (powerUser.persona_descriptions && typeof powerUser.persona_descriptions === 'object') {
            for (const [avatar, desc] of Object.entries(powerUser.persona_descriptions)) {
                if (desc?.lorebook) {
                    const pName = powerUser.personas?.[avatar] || avatar;
                    addBinding(desc.lorebook, `人设:${pName}`, 'wi:persona_chat');
                }
            }
        }

        const chatMeta = ctx?.chatMetadata || ctx?.chat_metadata || {};
        if (chatMeta?.world_info) {
            addBinding(chatMeta.world_info, '当前会话世界书', 'wi:persona_chat');
        }

        return bindings;
    }

    /**
     * Fast synchronous + cached overview counts for the 9 Bento Grid tiles.
     * Never blocks UI rendering or triggers heavy chat directory scans.
     */
    function getOverviewSummary() {
        const ctx = getContext();
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const groups = Array.isArray(ctx?.groups) ? ctx.groups : [];
        const extSettings = ctx?.extensionSettings || ctx?.extension_settings || {};
        const powerUser = ctx?.powerUserSettings || ctx?.power_user || {};

        const summary = {};
        for (const def of CATEGORY_DEFS) {
            const cached = categoryCache.get(def.id);
            if (cached) {
                summary[def.id] = {
                    count: cached.totalCount,
                    activeCount: cached.activeCount,
                    scanned: true,
                    badgeText: `${cached.totalCount} 项`,
                };
                continue;
            }

            let approx = null;
            switch (def.id) {
                case 'characters':
                    approx = characters.length + groups.length;
                    break;
                case 'regex': {
                    const globalCount = Array.isArray(extSettings.regex) ? extSettings.regex.length : 0;
                    const comboCount = Array.isArray(extSettings.regex_presets) ? extSettings.regex_presets.length : 0;
                    const thGlobalTree = [
                        ...(Array.isArray(extSettings?.tavern_helper?.script?.scripts) ? extSettings.tavern_helper.script.scripts : []),
                        ...(Array.isArray(extSettings?.TavernHelper?.script?.scriptsRepository) ? extSettings.TavernHelper.script.scriptsRepository : []),
                    ];
                    const thGlobalCount = extractTavernHelperScripts(thGlobalTree).length;
                    const gvarCount = extSettings?.variables?.global && typeof extSettings.variables.global === 'object'
                        ? Object.keys(extSettings.variables.global).length
                        : 0;
                    let scopedCount = 0;
                    for (const c of characters) {
                        const arr = c?.data?.extensions?.regex_scripts;
                        if (Array.isArray(arr)) scopedCount += arr.length;
                        const thChar = c?.data?.extensions?.tavern_helper?.scripts || c?.data?.extensions?.TavernHelper_scripts;
                        if (Array.isArray(thChar)) scopedCount += extractTavernHelperScripts(thChar).length;
                    }
                    approx = globalCount + comboCount + thGlobalCount + gvarCount + scopedCount;
                    break;
                }
                case 'worldinfo': {
                    const worldNames = Array.isArray(ctx?.worldNames)
                        ? ctx.worldNames
                        : (Array.isArray(settingsSnapshot?.world_names) ? settingsSnapshot.world_names : null);
                    let embedded = 0;
                    for (const c of characters) {
                        if (c?.data?.character_book?.entries?.length || (c?.data?.character_book && Object.keys(c.data.character_book).length > 0)) {
                            embedded++;
                        }
                    }
                    if (worldNames) approx = worldNames.length + embedded;
                    break;
                }
                case 'presets': {
                    if (settingsSnapshot) {
                        const oai = extractNamedPresets(settingsSnapshot.openai_settings, settingsSnapshot.openai_setting_names).length;
                        const tgw = extractNamedPresets(settingsSnapshot.textgenerationwebui_presets, settingsSnapshot.textgenerationwebui_preset_names).length;
                        const ins = extractNamedPresets(settingsSnapshot.instruct, settingsSnapshot.instruct).length;
                        const cxt = extractNamedPresets(settingsSnapshot.context, settingsSnapshot.context).length;
                        const sys = extractNamedPresets(settingsSnapshot.sysprompt, settingsSnapshot.sysprompt).length;
                        const rsn = extractNamedPresets(settingsSnapshot.reasoning, settingsSnapshot.reasoning).length;
                        const nai = extractNamedPresets(settingsSnapshot.novelai_settings, settingsSnapshot.novelai_setting_names).length;
                        const kob = extractNamedPresets(settingsSnapshot.koboldai_settings, settingsSnapshot.koboldai_setting_names).length;
                        approx = oai + tgw + ins + cxt + sys + rsn + nai + kob;
                    }
                    break;
                }
                case 'profiles': {
                    const profiles = extSettings?.connectionManager?.profiles;
                    approx = Array.isArray(profiles) ? profiles.length : 0;
                    break;
                }
                case 'personas': {
                    const personaKeys = powerUser?.personas ? Object.keys(powerUser.personas).length : 0;
                    const themeCount = Array.isArray(settingsSnapshot?.themes) ? settingsSnapshot.themes.length : 0;
                    if (personaKeys > 0 || themeCount > 0) {
                        approx = personaKeys + themeCount;
                    }
                    break;
                }
                case 'media': {
                    const tags = Array.isArray(ctx?.tags) ? ctx.tags.length : 0;
                    const globalDb = Array.isArray(extSettings?.attachments) ? extSettings.attachments.length : 0;
                    const qrCount = Array.isArray(settingsSnapshot?.quickReplyPresets) ? settingsSnapshot.quickReplyPresets.length : 0;
                    if (tags + globalDb + qrCount > 0) {
                        approx = tags + globalDb + qrCount;
                    }
                    break;
                }
                default:
                    approx = null;
            }

            summary[def.id] = {
                count: approx,
                activeCount: 0,
                scanned: false,
                badgeText: approx !== null ? `${approx}${def.id === 'personas' || def.id === 'media' || def.id === 'regex' ? '+' : ''} 项` : '点击扫描',
            };
        }
        return summary;
    }

    // =========================================================================
    // Category Scanners (1 - 9)
    // =========================================================================

    async function scanCharactersCategory(signal) {
        const ctx = getContext();
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const groups = Array.isArray(ctx?.groups) ? ctx.groups : [];
        const activeCharIndex = ctx?.characterId !== undefined && ctx?.characterId !== null && ctx?.characterId !== ''
            ? Number(ctx.characterId)
            : -1;
        const activeCharAvatar = activeCharIndex >= 0 ? characters[activeCharIndex]?.avatar : null;
        const activeGroupId = ctx?.groupId ?? ctx?.selected_group ?? null;
        const tagMap = ctx?.tagMap || ctx?.tag_map || {};
        const tagsById = new Map(
            (Array.isArray(ctx?.tags) ? ctx.tags : [])
                .filter(t => t && t.id !== undefined && t.id !== null)
                .map(t => [t.id, t.name]),
        );

        const charItems = [];
        for (const ch of characters) {
            if (!ch?.avatar) continue;
            const inGroups = groups.filter(g => Array.isArray(g?.members) && g.members.includes(ch.avatar));
            const rawTagIds = Array.isArray(tagMap[ch.avatar]) ? tagMap[ch.avatar] : [];
            const validTagIds = rawTagIds.filter(id => tagsById.has(id));
            const tagLabels = validTagIds.map(id => tagsById.get(id)).filter(Boolean);
            const worldName = ch?.data?.extensions?.world || '';
            const scopedRegexCount = Array.isArray(ch?.data?.extensions?.regex_scripts) ? ch.data.extensions.regex_scripts.length : 0;
            const isFav = Boolean(ch.fav === true || ch.fav === 'true' || ch?.data?.extensions?.fav === true);
            const isBuiltin = ch.avatar === 'default_Seraphina.png';
            const sortTimeMs = parseTavernTimestamp(
                ch.date_last_chat || ch.date_added || ch.create_date,
                ch.chat || '',
            );
            const dateLabel = formatShortDate(sortTimeMs);
            const chatSizeBytes = Number(ch.chat_size) || Number(ch.data_size) || 0;

            const subtitleParts = [ch.avatar];
            if (isFav) subtitleParts.push('★ 星标收藏');
            if (dateLabel) subtitleParts.push(`互动:${dateLabel}`);
            if (inGroups.length > 0) subtitleParts.push(`关联 ${inGroups.length} 个群聊`);
            if (worldName) subtitleParts.push(`世界书:${worldName}`);
            if (scopedRegexCount > 0) subtitleParts.push(`局部正则:${scopedRegexCount}`);
            if (tagLabels.length > 0) subtitleParts.push(`标签:${tagLabels.slice(0, 4).join('/')}`);

            const isActive = ch.avatar === activeCharAvatar;
            const facets = [isBuiltin ? 'src:builtin' : 'src:user'];
            if (isFav) facets.push('char:fav');
            if (inGroups.length > 0) facets.push('char:ingroup');
            if (!isActive && !isFav && inGroups.length === 0) facets.push('char:idle');
            if (validTagIds.length > 0) {
                for (const tid of validTagIds) facets.push(`tag:${tid}`);
            } else {
                facets.push('tag:__untagged__');
            }

            charItems.push(registerItem({
                key: `char_card:${ch.avatar}`,
                categoryId: 'characters',
                subgroupId: 'char_cards',
                title: String(ch.name || stripExt(ch.avatar, '.png')),
                subtitle: subtitleParts.join(' · '),
                sizeBytes: chatSizeBytes,
                sortTimeMs,
                sortMetric: chatSizeBytes || (inGroups.length + scopedRegexCount),
                isActive,
                isCaution: isFav,
                facets,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(isFav ? [{ text: '★ 收藏', type: 'fav' }] : []),
                    ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : []),
                    ...(inGroups.length > 0 ? [{ text: `群成员×${inGroups.length}`, type: 'info' }] : []),
                    ...tagLabels.slice(0, 2).map(t => ({ text: `#${t}`, type: 'tag' })),
                    ...(tagLabels.length > 2 ? [{ text: `+${tagLabels.length - 2}`, type: 'muted' }] : []),
                ],
                payload: {
                    kind: 'char_card',
                    avatar: ch.avatar,
                    name: String(ch.name || stripExt(ch.avatar, '.png')),
                    spriteDirName: stripExt(ch.avatar, '.png'),
                },
            }));
        }

        // 2. Standalone Character Expression Sprite Packs (`GET api/sprites/get?name=<dir>`)
        const spritePackItems = [];
        await mapWithConcurrency(characters, 5, async (ch) => {
            if (!ch?.avatar) return;
            const spriteDirName = stripExt(ch.avatar, '.png');
            if (!spriteDirName) return;
            try {
                const spList = await apiJson(`api/sprites/get?name=${encodeURIComponent(spriteDirName)}`, {
                    method: 'GET',
                    signal,
                    allow404: true,
                });
                if (!Array.isArray(spList) || spList.length === 0) return;
                const parsedSprites = spList
                    .map(sp => {
                        const rawFile = String(sp?.path || '').split('?')[0].split('/').pop() || '';
                        const spriteName = rawFile.replace(/\.[^.]+$/, '');
                        return { label: String(sp?.label || ''), spriteName };
                    })
                    .filter(s => s.label && s.spriteName);
                if (parsedSprites.length === 0) return;

                const isActive = ch.avatar === activeCharAvatar;
                const rawTagIds = Array.isArray(tagMap[ch.avatar]) ? tagMap[ch.avatar] : [];
                const validTagIds = rawTagIds.filter(id => tagsById.has(id));
                const spFacets = ['src:user'];
                for (const tid of validTagIds) spFacets.push(`tag:${tid}`);

                const sampleLabels = parsedSprites.slice(0, 5).map(s => s.label).join('、');
                spritePackItems.push(registerItem({
                    key: `char_sprites:${ch.avatar}`,
                    categoryId: 'characters',
                    subgroupId: 'char_sprites',
                    title: `${ch.name || spriteDirName} — 专属立绘表情包`,
                    subtitle: `共 ${parsedSprites.length} 张表情 (${sampleLabels}${parsedSprites.length > 5 ? '...' : ''}) · 仅清理立绘保留角色卡`,
                    sizeBytes: 0,
                    sortTimeMs: parseTavernTimestamp(ch.date_last_chat || ch.date_added || ch.create_date),
                    sortMetric: parsedSprites.length,
                    isActive,
                    facets: spFacets,
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                        { text: `${parsedSprites.length} 张立绘`, type: 'muted' },
                    ],
                    payload: {
                        kind: 'char_sprites',
                        avatar: ch.avatar,
                        spriteDirName,
                        sprites: parsedSprites,
                    },
                }));
            } catch {
                // Non-fatal if sprites endpoint unavailable
            }
        }, signal);

        const groupItems = [];
        for (const g of groups) {
            if (!g?.id) continue;
            const memberCount = Array.isArray(g.members) ? g.members.length : 0;
            const chatCount = Array.isArray(g.chats) ? g.chats.length : 0;
            const isActive = String(g.id) === String(activeGroupId);
            const isFav = Boolean(g.fav === true || g.fav === 'true');
            groupItems.push(registerItem({
                key: `group:${g.id}`,
                categoryId: 'characters',
                subgroupId: 'groups',
                title: String(g.name || `群聊 ${g.id}`),
                subtitle: `ID: ${g.id} · ${memberCount} 位成员 · ${chatCount} 条会话`,
                sizeBytes: 0,
                sortTimeMs: parseTavernTimestamp(g.date_last_chat || g.date_added, g.chat_id || ''),
                sortMetric: chatCount * 10 + memberCount,
                isActive,
                isCaution: isFav,
                facets: ['src:user', ...(isFav ? ['char:fav'] : [])],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(isFav ? [{ text: '★ 收藏', type: 'fav' }] : []),
                    { text: `${chatCount} 会话`, type: 'muted' },
                ],
                payload: {
                    kind: 'group',
                    id: g.id,
                    name: String(g.name || g.id),
                },
            }));
        }

        if (signal?.aborted) throw new DOMException('Scan aborted', 'AbortError');
        return [
            { id: 'char_cards', label: '角色卡', items: charItems },
            { id: 'char_sprites', label: '角色立绘表情包', items: spritePackItems },
            { id: 'groups', label: '群聊房间', items: groupItems },
        ];
    }

    async function scanChatsCategory(signal, onProgress) {
        const ctx = getContext();
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const groups = Array.isArray(ctx?.groups) ? ctx.groups : [];
        const activeCharIndex = ctx?.characterId !== undefined && ctx?.characterId !== null && ctx?.characterId !== ''
            ? Number(ctx.characterId)
            : -1;
        const activeChar = activeCharIndex >= 0 ? characters[activeCharIndex] : null;
        const activeGroupId = ctx?.groupId ?? ctx?.selected_group ?? null;
        const tagMap = ctx?.tagMap || ctx?.tag_map || {};
        const validTagIdSet = new Set(
            (Array.isArray(ctx?.tags) ? ctx.tags : [])
                .filter(t => t && t.id !== undefined && t.id !== null)
                .map(t => t.id),
        );

        const charChatItems = [];
        let scannedChars = 0;

        await mapWithConcurrency(characters, 5, async (ch) => {
            if (!ch?.avatar) return;
            try {
                const list = await apiJson('api/characters/chats', {
                    method: 'POST',
                    body: { avatar_url: ch.avatar },
                    signal,
                });
                if (Array.isArray(list)) {
                    const activeChatBase = activeChar?.avatar === ch.avatar ? stripExt(activeChar?.chat || '', '.jsonl') : '';
                    const charDefaultBase = stripExt(ch?.chat || '', '.jsonl');
                    const charTagIds = (Array.isArray(tagMap[ch.avatar]) ? tagMap[ch.avatar] : []).filter(id => validTagIdSet.has(id));
                    for (const info of list) {
                        const fileName = String(info?.file_name || '').trim();
                        if (!fileName) continue;
                        const baseName = stripExt(fileName, '.jsonl');
                        const isActive = Boolean(activeChatBase && baseName === activeChatBase);
                        const isCharDefault = Boolean(charDefaultBase && baseName === charDefaultBase);
                        const msgCount = info?.chat_items ?? info?.mes_count ?? '';
                        const numericMsgs = msgCount !== '' ? Number(msgCount) : NaN;
                        const isShortTest = Number.isFinite(numericMsgs) && numericMsgs <= 2;
                        const lastMes = info?.last_mes ? ` · 最近: ${String(info.last_mes).slice(0, 24)}` : '';
                        const sizeText = info?.file_size ? ` · ${info.file_size}` : '';

                        const chatFacets = [isCharDefault ? 'chat:current_default' : 'chat:branch'];
                        if (isShortTest) chatFacets.push('chat:short_test');
                        for (const tid of charTagIds) chatFacets.push(`tag:${tid}`);

                        const parsedBytes = parseSizeStringBytes(info?.file_size);
                        const sortTimeMs = parseTavernTimestamp(info?.last_mes, fileName);

                        charChatItems.push(registerItem({
                            key: `char_chat:${ch.avatar}::${fileName}`,
                            categoryId: 'chats',
                            subgroupId: 'char_chats',
                            title: `${ch.name || stripExt(ch.avatar, '.png')} — ${baseName}`,
                            subtitle: `角色: ${ch.name || ch.avatar}${msgCount !== '' ? ` · ${msgCount} 条消息` : ''}${sizeText}${lastMes}`,
                            sizeBytes: parsedBytes,
                            sortTimeMs,
                            sortMetric: Number.isFinite(numericMsgs) ? numericMsgs * 1024 + parsedBytes : parsedBytes,
                            isActive,
                            facets: chatFacets,
                            badges: [
                                ...(isActive
                                    ? [{ text: '正在使用', type: 'active' }]
                                    : (isCharDefault ? [{ text: '角色主会话', type: 'info' }] : [{ text: '历史分支', type: 'muted' }])),
                                ...(isShortTest ? [{ text: '短测试档', type: 'warn' }] : []),
                                { text: ch.name || stripExt(ch.avatar, '.png'), type: 'muted' },
                            ],
                            payload: {
                                kind: 'char_chat',
                                avatar: ch.avatar,
                                characterName: ch.name || stripExt(ch.avatar, '.png'),
                                fileName,
                                fileId: baseName,
                            },
                        }));
                    }
                }
            } catch {
                // Character with no chat directory or error is safely skipped
            }
            scannedChars++;
            if (scannedChars % 5 === 0 || scannedChars === characters.length) {
                onProgress?.(`正在扫描角色聊天会话 (${scannedChars}/${characters.length})...`);
            }
        }, signal);

        const groupChatItems = [];
        for (const g of groups) {
            if (!g?.id || !Array.isArray(g.chats)) continue;
            const isGroupSelected = String(g.id) === String(activeGroupId);
            for (const chatId of g.chats) {
                const cid = String(chatId || '').trim();
                if (!cid) continue;
                const isGroupDefault = String(g.chat_id) === cid;
                const isActive = isGroupSelected && isGroupDefault;
                groupChatItems.push(registerItem({
                    key: `group_chat:${g.id}::${cid}`,
                    categoryId: 'chats',
                    subgroupId: 'group_chats',
                    title: `${g.name || g.id} — ${cid}`,
                    subtitle: `所属群聊: ${g.name || g.id} · 会话 ID: ${cid}`,
                    sizeBytes: 0,
                    sortTimeMs: parseTavernTimestamp(cid),
                    isActive,
                    facets: [isGroupDefault ? 'chat:current_default' : 'chat:branch'],
                    badges: [
                        ...(isActive
                            ? [{ text: '正在使用', type: 'active' }]
                            : (isGroupDefault ? [{ text: '群聊主会话', type: 'info' }] : [{ text: '历史分支', type: 'muted' }])),
                        { text: g.name || String(g.id), type: 'muted' },
                    ],
                    payload: {
                        kind: 'group_chat',
                        groupId: g.id,
                        groupName: g.name || String(g.id),
                        chatId: cid,
                    },
                }));
            }
        }

        return [
            { id: 'char_chats', label: '角色单聊会话', items: charChatItems },
            { id: 'group_chats', label: '群聊单条会话', items: groupChatItems },
        ];
    }

    async function scanRegexCategory(signal, onProgress) {
        await ensureCharactersUnshallowed(signal, onProgress);
        const settingsData = await getSettingsSnapshot(signal);
        const ctx = getContext();
        const extSettings = ctx?.extensionSettings || ctx?.extension_settings || {};
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const activeCharIndex = ctx?.characterId !== undefined && ctx?.characterId !== null && ctx?.characterId !== ''
            ? Number(ctx.characterId)
            : -1;
        const activeCharAvatar = activeCharIndex >= 0 ? characters[activeCharIndex]?.avatar : null;

        // 1. Global regex scripts
        const globalItems = [];
        const globalList = Array.isArray(extSettings.regex) ? extSettings.regex : [];
        for (let i = 0; i < globalList.length; i++) {
            const script = globalList[i];
            if (!script) continue;
            const scriptId = String(script.id ?? `idx_${i}`);
            const disabled = Boolean(script.disabled);
            globalItems.push(registerItem({
                key: `regex:global::global::${scriptId}`,
                categoryId: 'regex',
                subgroupId: 'regex_global',
                title: String(script.scriptName || `未命名全局正则 #${i + 1}`),
                subtitle: `全局正则 · ${disabled ? '已停用' : '启用中'}${script.findRegex ? ` · 匹配: ${String(script.findRegex).slice(0, 40)}` : ''}`,
                sizeBytes: 0,
                isActive: !disabled,
                facets: [disabled ? 'rx:disabled' : 'rx:enabled', 'rx:st_regex'],
                badges: [
                    ...(!disabled ? [{ text: '正在使用', type: 'active' }] : [{ text: '已停用', type: 'muted' }]),
                ],
                payload: {
                    kind: 'regex_global',
                    scriptId,
                    scriptName: String(script.scriptName || scriptId),
                },
            }));
        }

        // 2. Character-scoped embedded regex scripts
        const scopedItems = [];
        for (const ch of characters) {
            if (!ch?.avatar) continue;
            const scripts = ch?.data?.extensions?.regex_scripts;
            if (!Array.isArray(scripts) || scripts.length === 0) continue;
            const isCharActive = ch.avatar === activeCharAvatar;
            for (let i = 0; i < scripts.length; i++) {
                const script = scripts[i];
                if (!script) continue;
                const scriptId = String(script.id ?? `idx_${i}`);
                const disabled = Boolean(script.disabled);
                const isActive = isCharActive && !disabled;
                scopedItems.push(registerItem({
                    key: `regex:scoped::${ch.avatar}::${scriptId}`,
                    categoryId: 'regex',
                    subgroupId: 'regex_scoped',
                    title: `${script.scriptName || `局部正则 #${i + 1}`}`,
                    subtitle: `所属角色: ${ch.name || ch.avatar} · ${disabled ? '已停用' : '启用'}`,
                    sizeBytes: 0,
                    isActive,
                    facets: [disabled ? 'rx:disabled' : 'rx:enabled', 'rx:st_regex'],
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : (disabled ? [{ text: '已停用', type: 'muted' }] : [])),
                        { text: ch.name || stripExt(ch.avatar, '.png'), type: 'info' },
                    ],
                    payload: {
                        kind: 'regex_scoped',
                        avatar: ch.avatar,
                        characterName: ch.name || stripExt(ch.avatar, '.png'),
                        scriptId,
                        scriptName: String(script.scriptName || scriptId),
                    },
                }));
            }
        }

        // 3. Preset-embedded regex scripts (OpenAI & TextGen presets)
        const presetRegexItems = [];
        const activeOaiPreset = ctx?.chatCompletionSettings?.preset_settings_openai
            || settingsData?.settings?.preset_settings_openai
            || '';
        const activeTextGenPreset = settingsData?.settings?.preset_settings_textgenerationwebui || '';

        const presetSources = [
            {
                apiId: 'openai',
                apiLabel: '聊天补全预设',
                activeName: activeOaiPreset,
                entries: extractNamedPresets(settingsData?.openai_settings, settingsData?.openai_setting_names),
            },
            {
                apiId: 'textgenerationwebui',
                apiLabel: '文本补全预设',
                activeName: activeTextGenPreset,
                entries: extractNamedPresets(settingsData?.textgenerationwebui_presets, settingsData?.textgenerationwebui_preset_names),
            },
        ];

        for (const src of presetSources) {
            for (const presetEntry of src.entries) {
                const scripts = presetEntry.data?.extensions?.regex_scripts;
                if (!Array.isArray(scripts) || scripts.length === 0) continue;
                const isPresetActive = presetEntry.name === src.activeName;
                for (let i = 0; i < scripts.length; i++) {
                    const script = scripts[i];
                    if (!script) continue;
                    const scriptId = String(script.id ?? `idx_${i}`);
                    const disabled = Boolean(script.disabled);
                    const isActive = isPresetActive && !disabled;
                    presetRegexItems.push(registerItem({
                        key: `regex:preset::${src.apiId}:${presetEntry.name}::${scriptId}`,
                        categoryId: 'regex',
                        subgroupId: 'regex_preset',
                        title: `${script.scriptName || `预设正则 #${i + 1}`}`,
                        subtitle: `所属${src.apiLabel}: ${presetEntry.name} · ${disabled ? '已停用' : '启用'}`,
                        sizeBytes: 0,
                        isActive,
                        facets: [disabled ? 'rx:disabled' : 'rx:enabled', 'rx:st_regex'],
                        badges: [
                            ...(isActive ? [{ text: '正在使用', type: 'active' }] : (disabled ? [{ text: '已停用', type: 'muted' }] : [])),
                            { text: presetEntry.name, type: 'info' },
                        ],
                        payload: {
                            kind: 'regex_preset',
                            apiId: src.apiId,
                            presetName: presetEntry.name,
                            presetData: presetEntry.data,
                            scriptId,
                            scriptName: String(script.scriptName || scriptId),
                        },
                    }));
                }
            }
        }

        // 4. Regex toggle preset combinations (extension_settings.regex_presets)
        const comboItems = [];
        const combos = Array.isArray(extSettings.regex_presets) ? extSettings.regex_presets : [];
        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            if (!combo) continue;
            const comboKey = String(combo.id ?? combo.name ?? `combo_${i}`);
            const refCount = (Array.isArray(combo.global) ? combo.global.length : 0)
                + (Array.isArray(combo.scoped) ? combo.scoped.length : 0)
                + (Array.isArray(combo.preset) ? combo.preset.length : 0);
            const isActive = Boolean(combo.isSelected || extSettings.selected_regex_preset === combo.id || extSettings.selected_regex_preset === combo.name);
            comboItems.push(registerItem({
                key: `regex:combo::combo::${comboKey}`,
                categoryId: 'regex',
                subgroupId: 'regex_combos',
                title: String(combo.name || `正则组合 #${i + 1}`),
                subtitle: `仅删除开关组合方案（不删脚本本体） · 记录 ${refCount} 项脚本状态`,
                sizeBytes: 0,
                isActive,
                facets: ['rx:vars_combos'],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    { text: '开关方案', type: 'muted' },
                ],
                payload: {
                    kind: 'regex_combo',
                    comboId: combo.id ?? null,
                    comboName: combo.name ?? null,
                },
            }));
        }

        // 5. TavernHelper (酒馆助手 JS-Slash-Runner) Global Scripts (v4 `tavern_helper` + v3 `TavernHelper`)
        const thGlobalItems = [];
        const thGlobalEnabled = extSettings?.tavern_helper?.script?.enabled?.global !== false
            && extSettings?.TavernHelper?.script?.global_script_enabled !== false;
        const thGlobalTree = [
            ...(Array.isArray(extSettings?.tavern_helper?.script?.scripts) ? extSettings.tavern_helper.script.scripts : []),
            ...(Array.isArray(extSettings?.TavernHelper?.script?.scriptsRepository) ? extSettings.TavernHelper.script.scriptsRepository : []),
        ];
        const seenThGlobalIds = new Set();
        for (const sc of extractTavernHelperScripts(thGlobalTree)) {
            if (seenThGlobalIds.has(sc.id)) continue;
            seenThGlobalIds.add(sc.id);
            const isEnabled = sc.folderEnabled && sc.enabled;
            const isActive = thGlobalEnabled && isEnabled;
            thGlobalItems.push(registerItem({
                key: `th:global::${sc.id}`,
                categoryId: 'regex',
                subgroupId: 'th_global',
                title: sc.folderName ? `[${sc.folderName}] ${sc.name}` : sc.name,
                subtitle: `酒馆助手全局脚本 · ${isEnabled ? '启用中' : '已停用'}${sc.info ? ` · ${sc.info.slice(0, 36)}` : ''}`,
                sizeBytes: 0,
                isActive,
                facets: [
                    isEnabled ? 'rx:enabled' : 'rx:disabled',
                    'rx:tavern_helper',
                    ...(sc.folderName ? ['rx:folder'] : []),
                ],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : [{ text: '已停用', type: 'muted' }]),
                    ...(sc.folderName ? [{ text: sc.folderName, type: 'info' }] : []),
                ],
                payload: {
                    kind: 'th_global',
                    scriptId: sc.id,
                    scriptName: sc.name,
                },
            }));
        }

        // 6. TavernHelper Character-Scoped Scripts (v4 `data.extensions.tavern_helper.scripts` + v3 `TavernHelper_scripts`)
        const thCharItems = [];
        const thEnabledChars = new Set([
            ...(Array.isArray(extSettings?.tavern_helper?.script?.enabled?.characters) ? extSettings.tavern_helper.script.enabled.characters : []),
            ...(Array.isArray(extSettings?.TavernHelper?.script?.characters_with_scripts) ? extSettings.TavernHelper.script.characters_with_scripts : []),
        ]);
        for (const ch of characters) {
            if (!ch?.avatar) continue;
            const rawTree = Array.isArray(ch?.data?.extensions?.tavern_helper?.scripts)
                ? ch.data.extensions.tavern_helper.scripts
                : (Array.isArray(ch?.data?.extensions?.TavernHelper_scripts) ? ch.data.extensions.TavernHelper_scripts : null);
            if (!rawTree || rawTree.length === 0) continue;
            const parsedList = extractTavernHelperScripts(rawTree);
            const isCharActive = ch.avatar === activeCharAvatar;
            const charScriptAllowed = thEnabledChars.size === 0 || thEnabledChars.has(ch.avatar) || thEnabledChars.has(ch.name);

            for (const sc of parsedList) {
                const isEnabled = sc.folderEnabled && sc.enabled;
                const isActive = isCharActive && charScriptAllowed && isEnabled;
                thCharItems.push(registerItem({
                    key: `th:char::${ch.avatar}::${sc.id}`,
                    categoryId: 'regex',
                    subgroupId: 'th_char',
                    title: sc.folderName ? `[${sc.folderName}] ${sc.name}` : sc.name,
                    subtitle: `所属角色: ${ch.name || ch.avatar} · 酒馆助手局部脚本 · ${isEnabled ? '启用' : '已停用'}`,
                    sizeBytes: 0,
                    isActive,
                    facets: [
                        isEnabled ? 'rx:enabled' : 'rx:disabled',
                        'rx:tavern_helper',
                        ...(sc.folderName ? ['rx:folder'] : []),
                    ],
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : (!isEnabled ? [{ text: '已停用', type: 'muted' }] : [])),
                        { text: ch.name || stripExt(ch.avatar, '.png'), type: 'info' },
                    ],
                    payload: {
                        kind: 'th_char',
                        avatar: ch.avatar,
                        characterName: ch.name || stripExt(ch.avatar, '.png'),
                        scriptId: sc.id,
                        scriptName: sc.name,
                    },
                }));
            }
        }

        // 7. TavernHelper Preset-Embedded Scripts (`preset.extensions.tavern_helper.scripts`)
        const thPresetItems = [];
        const thEnabledPresets = new Set(
            Array.isArray(extSettings?.tavern_helper?.script?.enabled?.presets) ? extSettings.tavern_helper.script.enabled.presets : [],
        );
        const oaiEntries = presetSources[0]?.entries || [];
        for (const presetEntry of oaiEntries) {
            const rawTree = presetEntry.data?.extensions?.tavern_helper?.scripts;
            if (!Array.isArray(rawTree) || rawTree.length === 0) continue;
            const parsedList = extractTavernHelperScripts(rawTree);
            const isPresetActive = presetEntry.name === activeOaiPreset;
            const presetAllowed = thEnabledPresets.size === 0 || thEnabledPresets.has(presetEntry.name);
            for (const sc of parsedList) {
                const isEnabled = sc.folderEnabled && sc.enabled;
                const isActive = isPresetActive && presetAllowed && isEnabled;
                thPresetItems.push(registerItem({
                    key: `th:preset::openai:${presetEntry.name}::${sc.id}`,
                    categoryId: 'regex',
                    subgroupId: 'th_preset',
                    title: sc.folderName ? `[${sc.folderName}] ${sc.name}` : sc.name,
                    subtitle: `所属聊天预设: ${presetEntry.name} · 酒馆助手预设脚本 · ${isEnabled ? '启用' : '已停用'}`,
                    sizeBytes: 0,
                    isActive,
                    facets: [
                        isEnabled ? 'rx:enabled' : 'rx:disabled',
                        'rx:tavern_helper',
                        ...(sc.folderName ? ['rx:folder'] : []),
                    ],
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : (!isEnabled ? [{ text: '已停用', type: 'muted' }] : [])),
                        { text: presetEntry.name, type: 'info' },
                    ],
                    payload: {
                        kind: 'th_preset',
                        apiId: 'openai',
                        presetName: presetEntry.name,
                        presetData: presetEntry.data,
                        scriptId: sc.id,
                        scriptName: sc.name,
                    },
                }));
            }
        }

        // 8. Persistent ST Global Script Variables (`extension_settings.variables.global`)
        const globalVarItems = [];
        const globalVarsObj = extSettings?.variables?.global;
        if (globalVarsObj && typeof globalVarsObj === 'object' && !Array.isArray(globalVarsObj)) {
            for (const [varKey, rawVal] of Object.entries(globalVarsObj)) {
                if (!varKey) continue;
                let valStr = '';
                try {
                    valStr = rawVal !== null && typeof rawVal === 'object'
                        ? (JSON.stringify(rawVal) ?? '')
                        : String(rawVal ?? '');
                } catch {
                    valStr = '[复杂对象]';
                }
                globalVarItems.push(registerItem({
                    key: `gvar:${varKey}`,
                    categoryId: 'regex',
                    subgroupId: 'global_vars',
                    title: varKey,
                    subtitle: `STscript 全局持久变量 · 值预览: ${valStr.slice(0, 48)}${valStr.length > 48 ? '...' : ''}`,
                    sizeBytes: valStr.length,
                    isActive: false,
                    facets: ['rx:vars_combos'],
                    badges: [{ text: '全局变量', type: 'muted' }],
                    payload: {
                        kind: 'global_var',
                        varKey,
                    },
                }));
            }
        }

        return [
            { id: 'regex_global', label: '全局正则', items: globalItems },
            { id: 'regex_scoped', label: '角色局部正则', items: scopedItems },
            { id: 'regex_preset', label: '预设内嵌正则', items: presetRegexItems },
            { id: 'regex_combos', label: '正则预设组合', items: comboItems },
            { id: 'th_global', label: '酒馆助手全局脚本', items: thGlobalItems },
            { id: 'th_char', label: '酒馆助手角色脚本', items: thCharItems },
            { id: 'th_preset', label: '酒馆助手预设脚本', items: thPresetItems },
            { id: 'global_vars', label: 'ST 全局脚本变量', items: globalVarItems },
        ];
    }

    async function scanWorldInfoCategory(signal, onProgress) {
        await ensureCharactersUnshallowed(signal, onProgress);
        const [settingsData, hostMods] = await Promise.all([
            getSettingsSnapshot(signal),
            loadHostModules(),
        ]);
        const ctx = getContext();
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const activeCharIndex = ctx?.characterId !== undefined && ctx?.characterId !== null && ctx?.characterId !== ''
            ? Number(ctx.characterId)
            : -1;
        const activeChar = activeCharIndex >= 0 ? characters[activeCharIndex] : null;
        const tagMap = ctx?.tagMap || ctx?.tag_map || {};
        const validTagIdSet = new Set(
            (Array.isArray(ctx?.tags) ? ctx.tags : [])
                .filter(t => t && t.id !== undefined && t.id !== null)
                .map(t => t.id),
        );

        const liveWorldNames = hostMods?.worldInfo?.world_names;
        const rawNames = Array.isArray(liveWorldNames) && liveWorldNames.length > 0
            ? liveWorldNames
            : (Array.isArray(ctx?.worldNames) && ctx.worldNames.length > 0
                ? ctx.worldNames
                : (Array.isArray(settingsData?.world_names) ? settingsData.world_names : []));
        const worldNames = [...new Set(rawNames.map(x => String(x || '').trim()).filter(Boolean))];
        const bindings = collectWorldInfoBindings(ctx, hostMods);

        const globalActiveArr = hostMods?.worldInfo?.selected_world_info
            || ctx?.worldInfo?.globalSelect
            || ctx?.selected_world_info
            || settingsData?.settings?.world_info?.globalSelect
            || [];
        const globalActiveSet = new Set(Array.isArray(globalActiveArr) ? globalActiveArr : []);
        const activeCharWorld = activeChar?.data?.extensions?.world || '';

        const unboundItems = [];
        const boundItems = [];
        for (const name of worldNames) {
            const bindRec = bindings.get(name);
            const boundTargets = bindRec ? bindRec.labels : [];
            const isBuiltin = name === 'Eldoria';
            const isActive = globalActiveSet.has(name) || name === activeCharWorld;
            if (boundTargets.length === 0) {
                unboundItems.push(registerItem({
                    key: `wi:standalone::${name}`,
                    categoryId: 'worldinfo',
                    subgroupId: 'wi_unbound',
                    title: name,
                    subtitle: `独立世界书 · 未被全局/角色/人设绑定（闲置可安全清理）${isBuiltin ? ' · 酒馆官方示例世界书' : ''}`,
                    sizeBytes: 0,
                    isActive: false,
                    facets: [isBuiltin ? 'src:builtin' : 'src:user', 'wi:unbound'],
                    badges: [
                        { text: '未绑定', type: 'muted' },
                        ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : []),
                    ],
                    payload: {
                        kind: 'wi_standalone',
                        name,
                        boundTargets: [],
                    },
                }));
            } else {
                const scopeFacets = [...bindRec.scopes];
                const tagFacets = [...bindRec.tagIds].filter(id => validTagIdSet.has(id)).map(id => `tag:${id}`);
                const scopeBadges = [];
                if (bindRec.scopes.has('wi:global')) scopeBadges.push({ text: '全局启用', type: 'info' });
                if (bindRec.scopes.has('wi:char_primary')) scopeBadges.push({ text: '角色主书', type: 'info' });
                if (bindRec.scopes.has('wi:char_extra')) scopeBadges.push({ text: '角色附加', type: 'muted' });
                if (bindRec.scopes.has('wi:persona_chat')) scopeBadges.push({ text: '人设/会话', type: 'muted' });

                boundItems.push(registerItem({
                    key: `wi:standalone::${name}`,
                    categoryId: 'worldinfo',
                    subgroupId: 'wi_bound',
                    title: name,
                    subtitle: `已绑定至: ${boundTargets.join('、')}`,
                    sizeBytes: 0,
                    sortMetric: boundTargets.length,
                    isActive,
                    isCaution: true,
                    facets: [isBuiltin ? 'src:builtin' : 'src:user', ...scopeFacets, ...tagFacets],
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                        { text: `绑定×${boundTargets.length}`, type: 'warn' },
                        ...scopeBadges.slice(0, 2),
                        ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : []),
                    ],
                    payload: {
                        kind: 'wi_standalone',
                        name,
                        boundTargets,
                    },
                }));
            }
        }

        const embeddedItems = [];
        for (const ch of characters) {
            if (!ch?.avatar) continue;
            const book = ch?.data?.character_book;
            const entries = Array.isArray(book?.entries)
                ? book.entries
                : (book?.entries && typeof book?.entries === 'object' ? Object.values(book.entries) : []);
            if (!book || entries.length === 0) continue;

            const isActive = activeChar?.avatar === ch.avatar;
            const charTagFacets = (Array.isArray(tagMap[ch.avatar]) ? tagMap[ch.avatar] : [])
                .filter(id => validTagIdSet.has(id))
                .map(id => `tag:${id}`);
            embeddedItems.push(registerItem({
                key: `wi:embedded::${ch.avatar}`,
                categoryId: 'worldinfo',
                subgroupId: 'wi_embedded',
                title: `${ch.name || stripExt(ch.avatar, '.png')} — 内嵌世界书${book.name ? ` (${book.name})` : ''}`,
                subtitle: `清空角色卡内嵌 character_book（保留角色卡与聊天记录） · 共 ${entries.length} 条目`,
                sizeBytes: 0,
                sortTimeMs: parseTavernTimestamp(ch.date_last_chat || ch.date_added || ch.create_date),
                sortMetric: entries.length,
                isActive,
                facets: ['src:user', 'wi:embedded', ...charTagFacets],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    { text: `${entries.length} 条目`, type: 'info' },
                ],
                payload: {
                    kind: 'wi_embedded',
                    avatar: ch.avatar,
                    characterName: ch.name || stripExt(ch.avatar, '.png'),
                    bookName: book.name || '',
                },
            }));
        }

        return [
            { id: 'wi_unbound', label: '未绑定闲置世界书', items: unboundItems },
            { id: 'wi_bound', label: '已绑定独立世界书', items: boundItems },
            { id: 'wi_embedded', label: '角色内嵌世界书', items: embeddedItems },
        ];
    }

    async function scanPresetsCategory(signal) {
        const settingsData = await getSettingsSnapshot(signal);
        const ctx = getContext();
        const powerUser = ctx?.powerUserSettings || ctx?.power_user || settingsData?.settings?.power_user || {};
        const stSettings = settingsData?.settings || {};

        const presetBuckets = [
            {
                subgroupId: 'preset_openai',
                label: '聊天补全预设',
                apiId: 'openai',
                activeName: ctx?.chatCompletionSettings?.preset_settings_openai || stSettings.preset_settings_openai || '',
                list: extractNamedPresets(settingsData?.openai_settings, settingsData?.openai_setting_names),
            },
            {
                subgroupId: 'preset_textgen',
                label: '文本补全预设',
                apiId: 'textgenerationwebui',
                activeName: stSettings.preset_settings_textgenerationwebui || '',
                list: extractNamedPresets(settingsData?.textgenerationwebui_presets, settingsData?.textgenerationwebui_preset_names),
            },
            {
                subgroupId: 'preset_instruct',
                label: '指令模板',
                apiId: 'instruct',
                activeName: powerUser?.instruct?.preset || '',
                list: extractNamedPresets(settingsData?.instruct, settingsData?.instruct),
            },
            {
                subgroupId: 'preset_context',
                label: '上下文模板',
                apiId: 'context',
                activeName: powerUser?.context?.preset || '',
                list: extractNamedPresets(settingsData?.context, settingsData?.context),
            },
            {
                subgroupId: 'preset_sysprompt',
                label: '系统提示词',
                apiId: 'sysprompt',
                activeName: powerUser?.sysprompt?.preset || '',
                list: extractNamedPresets(settingsData?.sysprompt, settingsData?.sysprompt),
            },
            {
                subgroupId: 'preset_reasoning',
                label: '推理模板',
                apiId: 'reasoning',
                activeName: powerUser?.reasoning?.preset || '',
                list: extractNamedPresets(settingsData?.reasoning, settingsData?.reasoning),
            },
            {
                subgroupId: 'preset_novel',
                label: 'NovelAI 预设',
                apiId: 'novel',
                activeName: stSettings.preset_settings_novel || '',
                list: extractNamedPresets(settingsData?.novelai_settings, settingsData?.novelai_setting_names),
            },
            {
                subgroupId: 'preset_kobold',
                label: 'KoboldAI 预设',
                apiId: 'kobold',
                activeName: stSettings.preset_settings_kobold || '',
                list: extractNamedPresets(settingsData?.koboldai_settings, settingsData?.koboldai_setting_names),
            },
        ];

        return presetBuckets.map((bucket) => {
            const validEntries = bucket.list.filter(e => e?.name && e.name !== 'gui');
            const items = [];
            for (const entry of validEntries) {
                const isActive = Boolean(bucket.activeName && entry.name === bucket.activeName);
                const isBuiltin = OFFICIAL_BUILTIN_PRESET_NAMES.has(entry.name);
                const isDefaultAnchor = (
                    ((bucket.apiId === 'openai' || bucket.apiId === 'textgenerationwebui' || bucket.apiId === 'context') && entry.name === 'Default')
                    || ((bucket.apiId === 'sysprompt' || bucket.apiId === 'reasoning') && (entry.name === 'Blank' || entry.name === 'Default'))
                    || (bucket.apiId === 'openai' && validEntries.length === 1)
                );
                const fallbackItem = validEntries.find(x => x.name !== entry.name);
                const criticalReason = isDefaultAnchor
                    ? `该引擎核心兜底预设（全部删空会导致预设面板/导出异常，且重启酒馆不会自动重建）`
                    : '';

                let subtitle = `${bucket.label} (${bucket.apiId})`;
                if (isDefaultAnchor) {
                    subtitle += ' · ⚠️ 核心兜底预设（删后重启酒馆不会自动重建）';
                } else if (isBuiltin) {
                    subtitle += ' · 酒馆官方初始模板（删后重启不会自动恢复）';
                } else {
                    subtitle += ' · 用户自建/导入预设';
                }

                const facets = [isBuiltin ? 'src:builtin' : 'src:user'];
                if (isDefaultAnchor) facets.push('crit:essential');

                items.push(registerItem({
                    key: `preset:${bucket.apiId}::${entry.name}`,
                    categoryId: 'presets',
                    subgroupId: bucket.subgroupId,
                    title: entry.name,
                    subtitle,
                    sizeBytes: 0,
                    isActive,
                    isCritical: isDefaultAnchor,
                    criticalReason,
                    facets,
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                        ...(isDefaultAnchor ? [{ text: '⚠️ 核心底座', type: 'critical' }] : []),
                        ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : [{ text: '用户自建', type: 'user' }]),
                    ],
                    payload: {
                        kind: 'preset',
                        apiId: bucket.apiId,
                        name: entry.name,
                        isActive,
                        fallbackPresetName: fallbackItem?.name || null,
                    },
                }));
            }
            return {
                id: bucket.subgroupId,
                label: bucket.label,
                items,
            };
        });
    }

    async function scanProfilesCategory() {
        const ctx = getContext();
        const extSettings = ctx?.extensionSettings || ctx?.extension_settings || {};
        const cm = extSettings?.connectionManager || {};
        const profiles = Array.isArray(cm.profiles) ? cm.profiles : [];
        const selectedId = cm.selectedProfile || '';

        const items = [];
        for (const p of profiles) {
            if (!p?.id) continue;
            const isActive = p.id === selectedId;
            const details = [
                p.mode ? `模式:${p.mode}` : '',
                p.api ? `API:${p.api}` : '',
                p.model ? `模型:${p.model}` : '',
                p['api-url'] ? `地址:${p['api-url']}` : '',
            ].filter(Boolean);
            const apiTag = p.api ? `api:${String(p.api).toLowerCase()}` : '';
            items.push(registerItem({
                key: `profile:${p.id}`,
                categoryId: 'profiles',
                subgroupId: 'conn_profiles',
                title: String(p.name || p.id),
                subtitle: `${details.length > 0 ? details.join(' · ') : `ID: ${p.id}`} · ⚠️ 删后移除反代地址与模型绑定（不动 secrets.json 密钥）`,
                sizeBytes: 0,
                isActive,
                isCaution: true,
                facets: ['src:user', ...(apiTag ? [apiTag] : [])],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    { text: '⚠️ 含连接地址', type: 'warn' },
                    ...(p.api ? [{ text: String(p.api), type: 'info' }] : []),
                ],
                payload: {
                    kind: 'conn_profile',
                    id: p.id,
                    name: String(p.name || p.id),
                    apiLabel: p.api ? String(p.api) : '',
                },
            }));
        }

        return [{ id: 'conn_profiles', label: '连接配置插头', items }];
    }

    async function scanPersonasCategory(signal) {
        const ctx = getContext();
        const powerUser = ctx?.powerUserSettings || ctx?.power_user || {};
        const chatMeta = ctx?.chatMetadata || ctx?.chat_metadata || {};

        const [avatarsRes, bgsRes, settingsData, hostMods] = await Promise.all([
            apiJson('api/avatars/get', { method: 'POST', body: {}, signal }).catch(() => []),
            apiJson('api/backgrounds/all', { method: 'POST', body: {}, signal }).catch(() => []),
            getSettingsSnapshot(signal),
            loadHostModules(),
        ]);

        // 1. User Personas
        const avatarSet = new Set(Array.isArray(avatarsRes) ? avatarsRes : []);
        if (powerUser?.personas && typeof powerUser.personas === 'object') {
            for (const k of Object.keys(powerUser.personas)) {
                if (k) avatarSet.add(k);
            }
        }

        const activePersona = hostMods?.personas?.user_avatar || ctx?.userAvatar || settingsData?.settings?.user_avatar || chatMeta?.persona || '';
        const defaultPersona = powerUser?.default_persona || '';
        const personaItems = [];
        for (const avatarFile of avatarSet) {
            const alias = powerUser?.personas?.[avatarFile] || stripExt(avatarFile, '.png');
            const descObj = powerUser?.persona_descriptions?.[avatarFile];
            const lorebook = descObj?.lorebook ? ` · 绑定世界书:${descObj.lorebook}` : '';
            const isActive = avatarFile === activePersona;
            const isDefault = avatarFile === defaultPersona;
            const isBuiltin = avatarFile === 'user-default.png';
            const isCritical = isBuiltin || isDefault;
            const criticalReason = isBuiltin
                ? '官方默认用户人设底座（删后无回退头像且重启酒馆不会自动恢复）'
                : (isDefault ? '当前设为默认人设（建议先切换默认人设再清理）' : '');
            const pFacets = [isBuiltin ? 'src:builtin' : 'src:user'];
            if (isCritical) pFacets.push('crit:essential');

            personaItems.push(registerItem({
                key: `persona:${avatarFile}`,
                categoryId: 'personas',
                subgroupId: 'user_personas',
                title: `${alias} (${avatarFile})`,
                subtitle: `人设头像: ${avatarFile}${isDefault ? ' · 默认人设' : ''}${isBuiltin ? ' · ⚠️ 官方人设底座' : ''}${lorebook}`,
                sizeBytes: 0,
                isActive,
                isCritical,
                criticalReason,
                facets: pFacets,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(isCritical ? [{ text: '⚠️ 核心底座', type: 'critical' }] : []),
                    ...(isDefault ? [{ text: '默认人设', type: 'warn' }] : []),
                    ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : [{ text: '用户自建', type: 'user' }]),
                ],
                payload: {
                    kind: 'user_persona',
                    avatar: avatarFile,
                    name: alias,
                },
            }));
        }

        // 2. Backgrounds
        const parsedBgs = parseBackgroundsPayload(bgsRes);
        const activeBgRaw = String(
            settingsData?.settings?.background
            || powerUser?.custom_background
            || '',
        );
        const bgItems = [];
        for (const bg of parsedBgs) {
            const isActive = Boolean(activeBgRaw && (activeBgRaw === bg.filename || activeBgRaw.includes(bg.filename)));
            const isBuiltin = OFFICIAL_BUILTIN_BACKGROUNDS.has(bg.filename);
            bgItems.push(registerItem({
                key: `bg:${bg.filename}`,
                categoryId: 'personas',
                subgroupId: 'backgrounds',
                title: bg.filename,
                subtitle: `${bg.isAnimated ? '动态视频/动图背景' : '静态背景图片'}${isBuiltin ? ' · 酒馆官方自带背景（删后重启不会自动恢复）' : ' · 用户上传背景'}`,
                sizeBytes: 0,
                isActive,
                facets: [
                    isBuiltin ? 'src:builtin' : 'src:user',
                    bg.isAnimated ? 'bg:animated' : 'bg:static',
                ],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(bg.isAnimated ? [{ text: '动态', type: 'info' }] : []),
                    ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : [{ text: '用户上传', type: 'user' }]),
                ],
                payload: {
                    kind: 'background',
                    bg: bg.filename,
                },
            }));
        }

        // 3. Custom Themes
        const themes = Array.isArray(settingsData?.themes) ? settingsData.themes : [];
        const activeTheme = powerUser?.theme || settingsData?.settings?.theme || '';
        const themeItems = [];
        for (const th of themes) {
            const name = typeof th === 'string' ? th : th?.name;
            if (!name) continue;
            const isActive = name === activeTheme;
            const isBuiltin = OFFICIAL_BUILTIN_THEMES.has(name);
            const isCritical = name === 'Dark Lite';
            const criticalReason = isCritical
                ? '酒馆基础兜底主题（全部主题删空后配色下拉框为空且重启不会自动恢复）'
                : '';
            const tFacets = [isBuiltin ? 'src:builtin' : 'src:user'];
            if (isCritical) tFacets.push('crit:essential');

            themeItems.push(registerItem({
                key: `theme:${name}`,
                categoryId: 'personas',
                subgroupId: 'themes',
                title: name,
                subtitle: `${isCritical ? '⚠️ 酒馆基础兜底配色主题' : (isBuiltin ? '酒馆官方自带配色主题' : '用户自定义配色主题')} (.json)`,
                sizeBytes: 0,
                isActive,
                isCritical,
                criticalReason,
                facets: tFacets,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(isCritical ? [{ text: '⚠️ 核心底座', type: 'critical' }] : []),
                    ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : [{ text: '用户自建', type: 'user' }]),
                ],
                payload: {
                    kind: 'theme',
                    name,
                },
            }));
        }

        return [
            { id: 'user_personas', label: '用户人设', items: personaItems },
            { id: 'backgrounds', label: '背景图片', items: bgItems },
            { id: 'themes', label: '自定义主题', items: themeItems },
        ];
    }

    async function scanMediaCategory(signal, onProgress) {
        const ctx = getContext();
        const extSettings = ctx?.extensionSettings || ctx?.extension_settings || {};
        const chatMeta = ctx?.chatMetadata || ctx?.chat_metadata || {};
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const charByAvatar = new Map(
            characters
                .filter(c => c && c.avatar)
                .map(c => [c.avatar, c.name || stripExt(c.avatar, '.png')]),
        );
        const settingsData = await getSettingsSnapshot(signal);

        // 1. Quick Replies
        const qrPresets = Array.isArray(settingsData?.quickReplyPresets) ? settingsData.quickReplyPresets : [];
        const qrConfig = extSettings?.quickReplyV2 || {};
        const activeQrNames = new Set();
        if (Array.isArray(qrConfig?.config?.setList)) {
            for (const s of qrConfig.config.setList) {
                if (s?.set) activeQrNames.add(s.set);
                if (typeof s === 'string') activeQrNames.add(s);
            }
        }
        const qrItems = [];
        for (const qr of qrPresets) {
            const name = typeof qr === 'string' ? qr : qr?.name;
            if (!name) continue;
            const count = Array.isArray(qr?.qrList) ? qr.qrList.length : 0;
            const isActive = activeQrNames.has(name);
            const isBuiltin = name === 'Default';
            const isCritical = name === 'Default';
            const qrFacets = [isBuiltin ? 'src:builtin' : 'src:user'];
            if (isCritical) qrFacets.push('crit:essential');

            qrItems.push(registerItem({
                key: `qr:${name}`,
                categoryId: 'media',
                subgroupId: 'quick_replies',
                title: name,
                subtitle: `快捷回复集 · ${count} 条动作按钮${isCritical ? ' · ⚠️ 官方默认快捷回复底座' : ''}`,
                sizeBytes: 0,
                sortMetric: count,
                isActive,
                isCritical,
                criticalReason: isCritical ? '官方默认快捷回复底座（删后重启酒馆不会自动恢复）' : '',
                facets: qrFacets,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(isCritical ? [{ text: '⚠️ 核心底座', type: 'critical' }] : []),
                    ...(isBuiltin ? [{ text: '官方自带', type: 'builtin' }] : []),
                    { text: `${count} 条`, type: 'muted' },
                ],
                payload: {
                    kind: 'quick_reply',
                    name,
                },
            }));
        }

        // 2. Data Bank Attachments (global, character, current chat)
        const databankItems = [];
        const pushAttachment = (att, scope, ownerKey, ownerLabel, isActive) => {
            if (!att?.url) return;
            const url = String(att.url);
            const baseName = url.replace(/\\/g, '/').split('/').pop() || '';
            if (!baseName) return;
            // SillyTavern's POST api/files/delete resolves relative to user root (`user/files/<name>`)
            const serverRelPath = `user/files/${baseName}`;
            databankItems.push(registerItem({
                key: `databank:${scope}::${ownerKey}::${url}`,
                categoryId: 'media',
                subgroupId: 'databank',
                title: String(att.name || baseName),
                subtitle: `${ownerLabel} · 文件: ${baseName}${att.size ? ` · ${Math.max(1, Math.round(Number(att.size) / 1024))} KB` : ''}`,
                sizeBytes: Number(att.size) || 0,
                sortTimeMs: parseTavernTimestamp(att.created),
                isActive,
                facets: ['src:user'],
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    { text: scope === 'global' ? '全局资料库' : (scope === 'character' ? '角色资料库' : '当前会话'), type: 'info' },
                ],
                payload: {
                    kind: 'databank',
                    scope,
                    ownerKey,
                    url,
                    filePath: serverRelPath,
                    name: String(att.name || baseName),
                },
            }));
        };

        if (Array.isArray(extSettings.attachments)) {
            const disabledGlobal = new Set(Array.isArray(extSettings.disabled_attachments) ? extSettings.disabled_attachments : []);
            for (const att of extSettings.attachments) {
                pushAttachment(att, 'global', 'global', '全局资料库附件', !disabledGlobal.has(att?.url));
            }
        }
        if (extSettings.character_attachments && typeof extSettings.character_attachments === 'object') {
            const activeIdx = ctx?.characterId !== undefined && ctx?.characterId !== null && ctx?.characterId !== '' ? Number(ctx.characterId) : -1;
            const activeAvatar = activeIdx >= 0 ? characters[activeIdx]?.avatar : null;
            for (const [avatar, arr] of Object.entries(extSettings.character_attachments)) {
                if (!Array.isArray(arr)) continue;
                const cName = charByAvatar.get(avatar) || avatar;
                for (const att of arr) {
                    pushAttachment(att, 'character', avatar, `角色资料库: ${cName}`, avatar === activeAvatar);
                }
            }
        }
        if (Array.isArray(chatMeta?.attachments)) {
            for (const att of chatMeta.attachments) {
                pushAttachment(att, 'chat', 'current_chat', '当前打开会话附件', true);
            }
        }

        // 3. Gallery & Chat Images
        const galleryItems = [];
        const folders = await apiJson('api/images/folders', { method: 'POST', body: {}, signal }).catch(() => []);
        if (Array.isArray(folders) && folders.length > 0) {
            let doneFolders = 0;
            await mapWithConcurrency(folders, 4, async (folder) => {
                if (!folder) return;
                try {
                    const files = await apiJson('api/images/list', {
                        method: 'POST',
                        body: { folder, type: 7 },
                        signal,
                    });
                    if (Array.isArray(files)) {
                        for (const file of files) {
                            const fName = typeof file === 'string' ? file : file?.fileName || file?.name;
                            if (!fName) continue;
                            const relPath = `user/images/${folder}/${fName}`;
                            galleryItems.push(registerItem({
                                key: `gallery:${relPath}`,
                                categoryId: 'media',
                                subgroupId: 'gallery_images',
                                title: `${folder} / ${fName}`,
                                subtitle: `画廊目录: ${folder} · 路径: ${relPath}`,
                                sizeBytes: 0,
                                isActive: false,
                                facets: ['src:user', `folder:${folder}`],
                                badges: [{ text: `📁 ${folder}`, type: 'muted' }],
                                payload: {
                                    kind: 'gallery_image',
                                    folder,
                                    fileName: fName,
                                    path: relPath,
                                },
                            }));
                        }
                    }
                } catch {
                    // Skip unreadable image subfolder
                }
                doneFolders++;
                onProgress?.(`正在扫描画廊图片目录 (${doneFolders}/${folders.length})...`);
            }, signal);
        }

        // 4. Built-in User Audio Assets (`POST api/assets/get` -> bgm / ambient / blip)
        const assetItems = [];
        const assetsMap = await apiJson('api/assets/get', {
            method: 'POST',
            body: {},
            signal,
            allow404: true,
        }).catch(() => ({}));
        if (assetsMap && typeof assetsMap === 'object' && !assetsMap.__notFound) {
            const assetCats = [
                { key: 'bgm', label: '背景音乐 BGM' },
                { key: 'ambient', label: '环境音效 Ambient' },
                { key: 'blip', label: '对话音效 Blip' },
            ];
            for (const ac of assetCats) {
                const list = assetsMap[ac.key];
                if (!Array.isArray(list)) continue;
                for (const rel of list) {
                    const fileName = String(rel || '').replace(/\\/g, '/').split('/').pop() || '';
                    if (!fileName || fileName === '.placeholder') continue;
                    assetItems.push(registerItem({
                        key: `asset:${ac.key}::${fileName}`,
                        categoryId: 'media',
                        subgroupId: 'user_assets',
                        title: fileName,
                        subtitle: `${ac.label} · 路径: assets/${ac.key}/${fileName}`,
                        sizeBytes: 0,
                        isActive: false,
                        facets: ['src:user'],
                        badges: [{ text: ac.key.toUpperCase(), type: 'muted' }],
                        payload: {
                            kind: 'user_asset',
                            category: ac.key,
                            filename: fileName,
                        },
                    }));
                }
            }
        }

        // 5. Custom ComfyUI Workflows (`POST api/sd/comfy/workflows`)
        const workflowItems = [];
        const workflows = await apiJson('api/sd/comfy/workflows', {
            method: 'POST',
            body: {},
            signal,
            allow404: true,
        }).catch(() => []);
        if (Array.isArray(workflows)) {
            const activeWorkflow = String(extSettings?.sd?.comfy_workflow || '');
            for (const wf of workflows) {
                const fileName = String(wf || '').trim();
                if (!fileName || BUILTIN_COMFY_WORKFLOWS.has(fileName)) continue;
                const isActive = fileName === activeWorkflow;
                workflowItems.push(registerItem({
                    key: `workflow:${fileName}`,
                    categoryId: 'media',
                    subgroupId: 'comfy_workflows',
                    title: stripExt(fileName, '.json'),
                    subtitle: `ComfyUI 工作流 · 文件: user/workflows/${fileName}`,
                    sizeBytes: 0,
                    isActive,
                    facets: ['src:user'],
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                        { text: 'ComfyUI', type: 'muted' },
                    ],
                    payload: {
                        kind: 'comfy_workflow',
                        fileName,
                    },
                }));
            }
        }

        // 6. Character Tags
        const tags = Array.isArray(ctx?.tags) ? ctx.tags : [];
        const tagMap = ctx?.tagMap || ctx?.tag_map || {};
        const tagRefCounts = new Map();
        for (const list of Object.values(tagMap)) {
            if (!Array.isArray(list)) continue;
            for (const tid of list) {
                tagRefCounts.set(tid, (tagRefCounts.get(tid) || 0) + 1);
            }
        }
        const tagItems = [];
        for (const tag of tags) {
            if (!tag?.id) continue;
            const refs = tagRefCounts.get(tag.id) || 0;
            tagItems.push(registerItem({
                key: `tag:${tag.id}`,
                categoryId: 'media',
                subgroupId: 'tags',
                title: String(tag.name || tag.id),
                subtitle: `仅移除标签定义与绑定（绝不删除所属 ${refs} 张角色卡）`,
                sizeBytes: 0,
                sortMetric: refs,
                isActive: false,
                facets: ['src:user', refs === 0 ? 'tag_state:empty' : 'tag_state:used'],
                badges: [{ text: refs > 0 ? `关联 ${refs} 角色` : '空置无角色', type: refs > 0 ? 'info' : 'muted' }],
                payload: {
                    kind: 'tag',
                    id: tag.id,
                    name: String(tag.name || tag.id),
                },
            }));
        }

        return [
            { id: 'quick_replies', label: '快捷回复集', items: qrItems },
            { id: 'databank', label: '资料库附件', items: databankItems },
            { id: 'gallery_images', label: '画廊与聊天图片', items: galleryItems },
            { id: 'user_assets', label: '音效与环境音资产', items: assetItems },
            { id: 'comfy_workflows', label: 'ComfyUI 生图工作流', items: workflowItems },
            { id: 'tags', label: '角色标签', items: tagItems },
        ];
    }

    async function scanExtensionsCategory(signal, onProgress) {
        const ctx = getContext();
        const extSettings = ctx?.extensionSettings || ctx?.extension_settings || {};
        const settingsData = await getSettingsSnapshot(signal);
        const isAdmin = checkIsAdmin(ctx, settingsData);
        const warnings = [];

        // 1. Third-party extensions (`api/extensions/discover`)
        const extItems = [];
        const discovered = await apiJson('api/extensions/discover', { method: 'GET', signal }).catch(() => []);
        const disabledExtensions = new Set(Array.isArray(extSettings.disabledExtensions) ? extSettings.disabledExtensions : []);
        if (Array.isArray(discovered)) {
            for (const ext of discovered) {
                if (!ext?.name || ext.type === 'system') continue;
                const rawName = String(ext.name);
                const strippedName = rawName.replace(/^third-party\//i, '');
                if (!strippedName || excludedExtNames.has(strippedName.toLowerCase())) {
                    continue; // Strictly never list ST-Cleaner / self
                }
                const isGlobal = ext.type === 'global';
                if (isGlobal && !isAdmin) {
                    continue; // Non-admin cannot delete global extensions
                }
                const isDisabled = disabledExtensions.has(rawName) || disabledExtensions.has(`third-party/${strippedName}`);
                const coreEcoLabel = matchCoreEcosystemExt(strippedName);
                const isCritical = Boolean(coreEcoLabel);
                const criticalReason = coreEcoLabel
                    ? `${coreEcoLabel}（大量角色卡前端状态栏、脚本与提示词变量强依赖此扩展，卸载后将大面积失效）`
                    : '';

                const extFacets = [isDisabled ? 'ext:disabled' : 'ext:enabled'];
                if (isCritical) extFacets.push('crit:essential');

                extItems.push(registerItem({
                    key: `ext:${isGlobal ? 'global' : 'local'}::${strippedName}`,
                    categoryId: 'extensions',
                    subgroupId: 'third_party_ext',
                    title: strippedName,
                    subtitle: `${isGlobal ? '全局第三方扩展 (global)' : '当前账号第三方扩展 (local)'} · ${isDisabled ? '已禁用' : '已启用'}${coreEcoLabel ? ` · ⚠️ ${coreEcoLabel}` : ''}`,
                    sizeBytes: 0,
                    isActive: !isDisabled,
                    isCritical,
                    criticalReason,
                    facets: extFacets,
                    badges: [
                        ...(!isDisabled ? [{ text: '正在使用', type: 'active' }] : [{ text: '已禁用', type: 'muted' }]),
                        ...(isCritical ? [{ text: '⚠️ 核心底座', type: 'critical' }] : []),
                        { text: isGlobal ? '全局' : '本地', type: isGlobal ? 'warn' : 'info' },
                    ],
                    payload: {
                        kind: 'third_party_ext',
                        extensionName: strippedName,
                        rawName,
                        global: isGlobal,
                    },
                }));
            }
        }

        // 2. Vector Collections (`api/vector/list` -> `api/vector/purge`)
        const vectorItems = [];
        const hashFn = typeof ctx?.getStringHash === 'function' ? ctx.getStringHash : computeStringHash;
        const vectorSource = extSettings?.vectors?.source || 'transformers';
        /** @type {{ id: string, label: string }[]} */
        const candidateCollections = [];
        const seenCol = new Set();
        const pushCol = (id, label) => {
            const cid = String(id || '').trim();
            if (!cid || seenCol.has(cid)) return;
            seenCol.add(cid);
            candidateCollections.push({ id: cid, label });
        };

        if (Array.isArray(extSettings?.attachments)) {
            for (const a of extSettings.attachments) {
                if (a?.url) pushCol(`file_${hashFn(a.url)}`, `全局附件向量: ${a.name || a.url}`);
            }
        }
        if (extSettings?.character_attachments && typeof extSettings.character_attachments === 'object') {
            for (const arr of Object.values(extSettings.character_attachments)) {
                if (!Array.isArray(arr)) continue;
                for (const a of arr) {
                    if (a?.url) pushCol(`file_${hashFn(a.url)}`, `角色附件向量: ${a.name || a.url}`);
                }
            }
        }
        const worldNames = Array.isArray(ctx?.worldNames) && ctx.worldNames.length > 0
            ? ctx.worldNames
            : (Array.isArray(settingsData?.world_names) ? settingsData.world_names : []);
        for (const w of worldNames) {
            if (w) pushCol(`world_${hashFn(w)}`, `世界书向量缓存: ${w}`);
        }
        if (typeof ctx?.getCurrentChatId === 'function') {
            const currentChatId = ctx.getCurrentChatId();
            if (currentChatId) pushCol(String(currentChatId), `当前聊天向量缓存: ${currentChatId}`);
        }

        await mapWithConcurrency(candidateCollections, 4, async (cand) => {
            try {
                const hashes = await apiJson('api/vector/list', {
                    method: 'POST',
                    body: { collectionId: cand.id, source: vectorSource },
                    signal,
                    allow404: true,
                });
                if (Array.isArray(hashes) && hashes.length > 0) {
                    vectorItems.push(registerItem({
                        key: `vector:${cand.id}`,
                        categoryId: 'extensions',
                        subgroupId: 'vectors',
                        title: cand.label,
                        subtitle: `集合 ID: ${cand.id} · 已缓存 ${hashes.length} 个向量分块`,
                        sizeBytes: 0,
                        sortMetric: hashes.length,
                        isActive: false,
                        facets: ['ext:cache_orphan'],
                        badges: [{ text: `${hashes.length} 分块`, type: 'info' }],
                        payload: {
                            kind: 'vector_collection',
                            collectionId: cand.id,
                        },
                    }));
                }
            } catch {
                // Vector backend unconfigured or empty collection; skip silently
            }
        }, signal);

        // 3. Chat Backups (`api/backups/chat/get`)
        const backupItems = [];
        const backupsRes = await apiJson('api/backups/chat/get', {
            method: 'POST',
            body: {},
            signal,
            allow404: true,
        }).catch(() => []);
        if (Array.isArray(backupsRes)) {
            for (const b of backupsRes) {
                const fileName = String(b?.file_name || '').trim();
                if (!fileName) continue;
                backupItems.push(registerItem({
                    key: `backup:${fileName}`,
                    categoryId: 'extensions',
                    subgroupId: 'chat_backups',
                title: fileName,
                subtitle: `聊天自动备份${b.file_size ? ` · ${b.file_size}` : ''}${b.chat_items !== undefined ? ` · ${b.chat_items} 条消息` : ''}`,
                sizeBytes: parseSizeStringBytes(b.file_size),
                sortTimeMs: parseTavernTimestamp(b.last_mes, fileName),
                sortMetric: (Number(b.chat_items) || 0) * 1024 + parseSizeStringBytes(b.file_size),
                isActive: false,
                    facets: ['ext:cache_orphan'],
                    badges: [{ text: '备份快照', type: 'muted' }],
                    payload: {
                        kind: 'chat_backup',
                        name: fileName,
                    },
                }));
            }
        }

        // 4. Data Maid Orphan Files (`api/data-maid/report`, ST 1.16+, graceful 404 fallback)
        const maidItems = [];
        onProgress?.('正在检测无主孤儿冗余文件 (Data Maid)...');
        const maidRes = await apiJson('api/data-maid/report', {
            method: 'POST',
            body: {},
            signal,
            allow404: true,
        }).catch(() => ({ __notFound: true }));

        if (maidRes?.__notFound) {
            dataMaidAvailable = false;
            dataMaidToken = null;
            warnings.push('当前酒馆版本不支持 Data Maid 孤儿扫描接口，已自动跳过该子项。');
        } else if (maidRes?.report && maidRes?.token) {
            dataMaidAvailable = true;
            dataMaidToken = String(maidRes.token);
            const maidTypeLabels = {
                images: '无主聊天图片',
                files: '无主附件文件',
                chats: '无主单聊文件',
                groupChats: '无主群聊文件',
                avatarThumbnails: '失效角色缩略图',
                backgroundThumbnails: '失效背景缩略图',
                personaThumbnails: '失效人设缩略图',
                chatBackups: '过期聊天备份',
                // Deliberately exclude settingsBackups so settings snapshots are never touched
            };
            for (const [typeKey, typeLabel] of Object.entries(maidTypeLabels)) {
                const list = maidRes.report[typeKey];
                if (!Array.isArray(list)) continue;
                for (const entry of list) {
                    if (!entry?.hash) continue;
                    const displayPath = entry.parent ? `${entry.parent}/${entry.name}` : String(entry.name || entry.hash.slice(0, 8));
                    maidItems.push(registerItem({
                        key: `maid:${entry.hash}`,
                        categoryId: 'extensions',
                        subgroupId: 'data_maid',
                        title: `${displayPath}`,
                        subtitle: `${typeLabel}${entry.size ? ` · ${Math.round(Number(entry.size) / 1024)} KB` : ''}`,
                        sizeBytes: Number(entry.size) || 0,
                        isActive: false,
                        facets: ['ext:cache_orphan'],
                        badges: [{ text: typeLabel, type: 'warn' }],
                        payload: {
                            kind: 'data_maid',
                            hash: entry.hash,
                            name: displayPath,
                        },
                    }));
                }
            }
        }

        const groups = [
            { id: 'third_party_ext', label: '第三方扩展', items: extItems },
            { id: 'vectors', label: '向量缓存集合', items: vectorItems },
            { id: 'chat_backups', label: '聊天备份文件', items: backupItems },
        ];
        if (dataMaidAvailable !== false) {
            groups.push({ id: 'data_maid', label: '无主冗余孤儿文件', items: maidItems });
        }
        return { groups, warnings };
    }

    /**
     * Builds ordered, non-zero secondary classification facets (`{ id, label, count, tone }[]`)
     * for the scanned category so users can filter by tags, binding scopes, user vs built-in, etc.
     */
    function buildCategoryFacets(categoryId, groups) {
        const ctx = getContext();
        const tags = Array.isArray(ctx?.tags) ? ctx.tags.filter(t => t && t.id !== undefined && t.id !== null) : [];
        const facetCounts = new Map();
        for (const g of groups) {
            for (const item of g.items) {
                if (!Array.isArray(item.facets)) continue;
                for (const fid of item.facets) {
                    facetCounts.set(fid, (facetCounts.get(fid) || 0) + 1);
                }
            }
        }

        /** @type {Array<{ id: string, label: string, count: number, tone?: string }>} */
        const out = [];
        const pushIfAny = (id, label, tone = 'default') => {
            const count = facetCounts.get(id) || 0;
            if (count > 0) {
                out.push({ id, label, count, tone });
            }
        };
        const pushDynamicTags = () => {
            const tagEntries = [];
            for (const t of tags) {
                const fid = `tag:${t.id}`;
                const c = facetCounts.get(fid) || 0;
                if (c > 0) {
                    tagEntries.push({ id: fid, label: `#${t.name || t.id}`, count: c, tone: 'tag' });
                }
            }
            tagEntries.sort((a, b) => b.count - a.count);
            out.push(...tagEntries);
        };

        switch (categoryId) {
            case 'characters':
                pushIfAny('char:idle', '闲置无群聊/非收藏', 'safe');
                pushIfAny('char:fav', '★ 星标收藏', 'warn');
                pushIfAny('char:ingroup', '群聊成员');
                pushIfAny('src:builtin', '官方初始角色');
                pushDynamicTags();
                pushIfAny('tag:__untagged__', '未打标签');
                break;

            case 'worldinfo':
                pushIfAny('wi:unbound', '未绑定闲置', 'safe');
                pushIfAny('wi:global', '全局常驻启用', 'warn');
                pushIfAny('wi:char_primary', '角色主世界书');
                pushIfAny('wi:char_extra', '角色辅助书');
                pushIfAny('wi:persona_chat', '人设/会话绑定');
                pushIfAny('wi:embedded', '角色卡内嵌');
                pushIfAny('src:user', '用户自建');
                pushIfAny('src:builtin', '官方自带');
                pushDynamicTags();
                break;

            case 'chats':
                pushIfAny('chat:branch', '历史旧分支', 'safe');
                pushIfAny('chat:short_test', '极短测试档 (≤2条)', 'safe');
                pushIfAny('chat:current_default', '各角色当前主会话', 'warn');
                pushDynamicTags();
                break;

            case 'regex':
                pushIfAny('rx:disabled', '已停用闲置', 'safe');
                pushIfAny('rx:enabled', '启用中', 'warn');
                pushIfAny('rx:st_regex', '原生正则');
                pushIfAny('rx:tavern_helper', '酒馆助手脚本');
                pushIfAny('rx:folder', '文件夹归档脚本');
                pushIfAny('rx:vars_combos', '变量与开关组合');
                break;

            case 'presets':
                pushIfAny('src:user', '用户自建预设', 'safe');
                pushIfAny('src:builtin', '酒馆官方自带');
                pushIfAny('crit:essential', '⚠️ 核心兜底底座', 'critical');
                break;

            case 'profiles': {
                for (const [fid, count] of facetCounts.entries()) {
                    if (fid.startsWith('api:') && count > 0) {
                        out.push({ id: fid, label: `API: ${fid.slice(4)}`, count, tone: 'default' });
                    }
                }
                break;
            }

            case 'personas':
                pushIfAny('src:user', '用户自建/上传', 'safe');
                pushIfAny('src:builtin', '酒馆官方自带');
                pushIfAny('bg:animated', '动态背景');
                pushIfAny('crit:essential', '⚠️ 核心兜底底座', 'critical');
                break;

            case 'media': {
                pushIfAny('src:user', '用户资源', 'safe');
                pushIfAny('tag_state:empty', '空置无角色标签', 'safe');
                pushIfAny('crit:essential', '⚠️ 核心兜底底座', 'critical');
                const folderEntries = [];
                for (const [fid, count] of facetCounts.entries()) {
                    if (fid.startsWith('folder:') && count > 0) {
                        folderEntries.push({ id: fid, label: `📁 ${fid.slice(7)}`, count, tone: 'tag' });
                    }
                }
                folderEntries.sort((a, b) => b.count - a.count);
                out.push(...folderEntries);
                break;
            }

            case 'extensions':
                pushIfAny('ext:disabled', '已禁用扩展', 'safe');
                pushIfAny('ext:cache_orphan', '缓存/备份/孤儿文件', 'safe');
                pushIfAny('ext:enabled', '已启用扩展', 'warn');
                pushIfAny('crit:essential', '⚠️ 核心生态底座', 'critical');
                break;

            default:
                break;
        }

        return out;
    }

    /**
     * Scans a single top-level category (or returns cached result unless `force` is true).
     * @param {string} categoryId
     * @param {{ force?: boolean, signal?: AbortSignal, onProgress?: (msg: string) => void }} [opts]
     */
    async function scanCategory(categoryId, opts = {}) {
        const { force = false, signal, onProgress } = opts;
        if (!force && categoryCache.has(categoryId)) {
            return categoryCache.get(categoryId);
        }

        unregisterCategoryKeys(categoryId);
        let rawResult;
        switch (categoryId) {
            case 'characters':
                rawResult = await scanCharactersCategory(signal);
                break;
            case 'chats':
                rawResult = await scanChatsCategory(signal, onProgress);
                break;
            case 'regex':
                rawResult = await scanRegexCategory(signal, onProgress);
                break;
            case 'worldinfo':
                rawResult = await scanWorldInfoCategory(signal, onProgress);
                break;
            case 'presets':
                rawResult = await scanPresetsCategory(signal);
                break;
            case 'profiles':
                rawResult = await scanProfilesCategory();
                break;
            case 'personas':
                rawResult = await scanPersonasCategory(signal);
                break;
            case 'media':
                rawResult = await scanMediaCategory(signal, onProgress);
                break;
            case 'extensions':
                rawResult = await scanExtensionsCategory(signal, onProgress);
                break;
            default:
                throw new Error(`Unknown category: ${categoryId}`);
        }

        if (signal?.aborted) {
            unregisterCategoryKeys(categoryId);
            throw new DOMException('Scan aborted', 'AbortError');
        }

        const groups = Array.isArray(rawResult) ? rawResult : rawResult.groups;
        const warnings = Array.isArray(rawResult) ? [] : (rawResult.warnings || []);

        let totalCount = 0;
        let activeCount = 0;
        let criticalCount = 0;
        for (const g of groups) {
            totalCount += g.items.length;
            for (const item of g.items) {
                if (item.isActive) activeCount++;
                if (item.isCritical) criticalCount++;
            }
        }

        const facets = buildCategoryFacets(categoryId, groups);

        const record = {
            categoryId,
            groups,
            facets,
            totalCount,
            activeCount,
            criticalCount,
            warnings,
            scannedAt: Date.now(),
        };
        categoryCache.set(categoryId, record);
        return record;
    }

    /**
     * Warms `api/settings/get` in background when modal opens so Bento tile counts
     * for worldinfo/presets/themes/quick-replies populate immediately without scanning chats.
     */
    async function warmOverviewMetadata(signal) {
        await getSettingsSnapshot(signal);
        return getOverviewSummary();
    }

    function invalidateCategories(categoryIds) {
        for (const cid of categoryIds) {
            categoryCache.delete(cid);
            unregisterCategoryKeys(cid);
        }
        settingsSnapshot = null;
    }

    function dispose() {
        whitelistMap.clear();
        categoryCache.clear();
        settingsSnapshot = null;
        settingsPromise = null;
        dataMaidToken = null;
    }

    /**
     * Runs an on-demand multi-category deep diagnostic scan without blocking UI responsiveness.
     * @param {{ signal?: AbortSignal, onProgress?: (msg: string) => void }} [opts]
     */
    async function runDeepHealthScan(opts = {}) {
        const { signal, onProgress } = opts;
        const targetCats = ['characters', 'worldinfo', 'regex', 'chats', 'media', 'extensions'];
        for (let i = 0; i < targetCats.length; i++) {
            if (signal?.aborted) throw new DOMException('Scan aborted', 'AbortError');
            const cid = targetCats[i];
            const def = CATEGORY_DEFS.find(c => c.id === cid);
            onProgress?.(`正在深度体检 (${i + 1}/${targetCats.length})：${def?.label || cid}...`);
            await scanCategory(cid, { force: false, signal, onProgress });
        }
        return categoryCache;
    }

    return {
        whitelistMap,
        getOverviewSummary,
        warmOverviewMetadata,
        scanCategory,
        runDeepHealthScan,
        getCachedCategory: (cid) => categoryCache.get(cid) || null,
        getAllCachedCategories: () => categoryCache,
        invalidateCategories,
        getDataMaidToken: () => dataMaidToken,
        getSettingsSnapshot,
        dispose,
    };
}
