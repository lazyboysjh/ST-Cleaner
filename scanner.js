/**
 * @file scanner.js
 * Multi-version SillyTavern data scanner & reference analyzer (ST 1.13.x -> 1.19.x+).
 * Lazy per-category scanning, shallow-character hydration, strict composite-key whitelist.
 */

export const SELF_EXTENSION_ID = 'delEverything';

/**
 * 9 top-level categories & sub-group definitions for Bento overview + virtualized list.
 */
export const CATEGORY_DEFS = [
    {
        id: 'characters',
        label: '角色与群组',
        shortDesc: '角色卡、立绘表情与群聊房间',
        icon: 'fa-solid fa-users',
        bootBucketKey: 'characters',
        subgroups: [
            { id: 'char_cards', label: '角色卡' },
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
        label: '正则脚本',
        shortDesc: '全局、角色局部、预设内嵌正则与开关组合',
        icon: 'fa-solid fa-code',
        bootBucketKey: null,
        subgroups: [
            { id: 'regex_global', label: '全局正则' },
            { id: 'regex_scoped', label: '角色局部正则' },
            { id: 'regex_preset', label: '预设内嵌正则' },
            { id: 'regex_combos', label: '正则预设组合' },
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
        label: '媒体与辅助',
        shortDesc: '快捷回复、资料库附件、画廊图片与标签',
        icon: 'fa-solid fa-photo-film',
        bootBucketKey: null,
        subgroups: [
            { id: 'quick_replies', label: '快捷回复集' },
            { id: 'databank', label: '资料库附件' },
            { id: 'gallery_images', label: '画廊与聊天图片' },
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

const DEFAULT_BUILTIN_PRESET_NAMES = new Set([
    'Default',
    'Default (ChatML)',
    'Roleplay',
    'Alpaca',
    'ChatML',
    'Vicuna',
    'Llama 3',
    'Command R',
    'Mistral',
    'Metharme',
    'DeepSeek',
    'Qwen',
    'Claude',
    'NovelAI Default',
    'Universal-Light',
    'SimpleProxyForTavern',
]);

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
        if (!filename || seen.has(filename)) continue;
        seen.add(filename);
        out.push({ filename, isAnimated });
    }
    return out;
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
export function extractNamedPresets(settingsArr, namesMapOrArr) {
    const out = [];
    const seen = new Set();

    if (namesMapOrArr && typeof namesMapOrArr === 'object' && !Array.isArray(namesMapOrArr)) {
        for (const [name, idx] of Object.entries(namesMapOrArr)) {
            if (!name || name === 'gui' || seen.has(name)) continue;
            seen.add(name);
            const data = Array.isArray(settingsArr) ? settingsArr[Number(idx)] : undefined;
            out.push({ name, data: data || {} });
        }
        return out;
    }

    if (Array.isArray(namesMapOrArr)) {
        for (let i = 0; i < namesMapOrArr.length; i++) {
            const entry = namesMapOrArr[i];
            const name = typeof entry === 'string' ? entry : entry?.name;
            if (!name || name === 'gui' || seen.has(name)) continue;
            seen.add(name);
            const data = typeof entry === 'object' ? entry : (Array.isArray(settingsArr) ? settingsArr[i] : {});
            out.push({ name, data: data || {} });
        }
        return out;
    }

    if (Array.isArray(settingsArr)) {
        for (const entry of settingsArr) {
            const name = typeof entry === 'string' ? entry : entry?.name;
            if (!name || name === 'gui' || seen.has(name)) continue;
            seen.add(name);
            out.push({ name, data: typeof entry === 'object' ? entry : {} });
        }
    }
    return out;
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
        const ctx = getContext();
        const headers = { ...getHeaders(ctx) };
        const init = { method, headers, signal };
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
    }

    async function getSettingsSnapshot(signal, force = false) {
        if (settingsSnapshot && !force) return settingsSnapshot;
        if (settingsPromise && !force) return settingsPromise;
        settingsPromise = apiJson('api/settings/get', { method: 'POST', body: {}, signal })
            .then((data) => {
                settingsSnapshot = data || {};
                settingsPromise = null;
                return settingsSnapshot;
            })
            .catch(() => {
                settingsPromise = null;
                settingsSnapshot = {};
                return settingsSnapshot;
            });
        return settingsPromise;
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
                } catch {
                    // Keep existing partial entry rather than aborting entire scan
                }
                done++;
                onProgress?.(`正在补全懒加载角色卡数据 (${done}/${shallowIndexes.length})...`);
            }, signal);
        }

        unshallowDone = true;
        return characters;
    }

    function registerItem(item) {
        whitelistMap.set(item.key, item);
        return item;
    }

    function unregisterCategoryKeys(categoryId) {
        for (const [key, item] of whitelistMap.entries()) {
            if (item.categoryId === categoryId) {
                whitelistMap.delete(key);
            }
        }
    }

    /**
     * Collects all worldbook binding relationships across global, characters, and personas.
     */
    function collectWorldInfoBindings(ctx) {
        /** @type {Map<string, string[]>} worldName -> human-readable bound targets */
        const bindings = new Map();
        const addBinding = (worldName, label) => {
            const name = String(worldName || '').trim();
            if (!name) return;
            let arr = bindings.get(name);
            if (!arr) {
                arr = [];
                bindings.set(name, arr);
            }
            if (!arr.includes(label)) {
                arr.push(label);
            }
        };

        const globalWorlds = ctx?.worldInfo?.globalSelect
            || ctx?.selected_world_info
            || settingsSnapshot?.settings?.world_info?.globalSelect
            || [];
        if (Array.isArray(globalWorlds)) {
            for (const w of globalWorlds) {
                addBinding(w, '全局启用');
            }
        }

        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        for (const ch of characters) {
            const primary = ch?.data?.extensions?.world;
            if (primary) {
                addBinding(primary, `角色主世界书:${ch.name || ch.avatar}`);
            }
        }

        const charLore = ctx?.worldInfo?.charLore
            || ctx?.world_info?.charLore
            || settingsSnapshot?.settings?.world_info?.charLore
            || [];
        if (Array.isArray(charLore)) {
            for (const entry of charLore) {
                const targetName = entry?.name || '角色附加';
                const books = Array.isArray(entry?.extraBooks) ? entry.extraBooks : [];
                for (const b of books) {
                    addBinding(b, `角色附加:${targetName}`);
                }
            }
        }

        const powerUser = ctx?.powerUserSettings || ctx?.power_user || {};
        if (powerUser.persona_description_lorebook) {
            addBinding(powerUser.persona_description_lorebook, '当前人设世界书');
        }
        if (powerUser.persona_descriptions && typeof powerUser.persona_descriptions === 'object') {
            for (const [avatar, desc] of Object.entries(powerUser.persona_descriptions)) {
                if (desc?.lorebook) {
                    const pName = powerUser.personas?.[avatar] || avatar;
                    addBinding(desc.lorebook, `人设:${pName}`);
                }
            }
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
                    let scopedCount = 0;
                    for (const c of characters) {
                        const arr = c?.data?.extensions?.regex_scripts;
                        if (Array.isArray(arr)) scopedCount += arr.length;
                    }
                    approx = globalCount + comboCount + scopedCount;
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
        const tagsById = new Map((Array.isArray(ctx?.tags) ? ctx.tags : []).map(t => [t.id, t.name]));

        const charItems = [];
        for (const ch of characters) {
            if (!ch?.avatar) continue;
            const inGroups = groups.filter(g => Array.isArray(g?.members) && g.members.includes(ch.avatar));
            const tagIds = Array.isArray(tagMap[ch.avatar]) ? tagMap[ch.avatar] : [];
            const tagLabels = tagIds.map(id => tagsById.get(id)).filter(Boolean);
            const worldName = ch?.data?.extensions?.world || '';
            const scopedRegexCount = Array.isArray(ch?.data?.extensions?.regex_scripts) ? ch.data.extensions.regex_scripts.length : 0;

            const subtitleParts = [ch.avatar];
            if (inGroups.length > 0) subtitleParts.push(`关联 ${inGroups.length} 个群聊`);
            if (worldName) subtitleParts.push(`世界书:${worldName}`);
            if (scopedRegexCount > 0) subtitleParts.push(`局部正则:${scopedRegexCount}`);
            if (tagLabels.length > 0) subtitleParts.push(`标签:${tagLabels.slice(0, 3).join('/')}`);

            const isActive = ch.avatar === activeCharAvatar;
            charItems.push(registerItem({
                key: `char_card:${ch.avatar}`,
                categoryId: 'characters',
                subgroupId: 'char_cards',
                title: String(ch.name || stripExt(ch.avatar, '.png')),
                subtitle: subtitleParts.join(' · '),
                sizeBytes: Number(ch.chat_size) || 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(inGroups.length > 0 ? [{ text: `群成员×${inGroups.length}`, type: 'info' }] : []),
                ],
                payload: {
                    kind: 'char_card',
                    avatar: ch.avatar,
                    name: String(ch.name || stripExt(ch.avatar, '.png')),
                    spriteDirName: stripExt(ch.avatar, '.png'),
                },
            }));
        }

        const groupItems = [];
        for (const g of groups) {
            if (!g?.id) continue;
            const memberCount = Array.isArray(g.members) ? g.members.length : 0;
            const chatCount = Array.isArray(g.chats) ? g.chats.length : 0;
            const isActive = String(g.id) === String(activeGroupId);
            groupItems.push(registerItem({
                key: `group:${g.id}`,
                categoryId: 'characters',
                subgroupId: 'groups',
                title: String(g.name || `群聊 ${g.id}`),
                subtitle: `ID: ${g.id} · ${memberCount} 位成员 · ${chatCount} 条会话`,
                sizeBytes: 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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
                    for (const info of list) {
                        const fileName = String(info?.file_name || '').trim();
                        if (!fileName) continue;
                        const baseName = stripExt(fileName, '.jsonl');
                        const isActive = Boolean(activeChatBase && baseName === activeChatBase);
                        const msgCount = info?.chat_items ?? info?.mes_count ?? '';
                        const lastMes = info?.last_mes ? ` · 最近: ${String(info.last_mes).slice(0, 24)}` : '';
                        const sizeText = info?.file_size ? ` · ${info.file_size}` : '';
                        charChatItems.push(registerItem({
                            key: `char_chat:${ch.avatar}::${fileName}`,
                            categoryId: 'chats',
                            subgroupId: 'char_chats',
                            title: `${ch.name || stripExt(ch.avatar, '.png')} — ${baseName}`,
                            subtitle: `角色: ${ch.name || ch.avatar}${msgCount !== '' ? ` · ${msgCount} 条消息` : ''}${sizeText}${lastMes}`,
                            sizeBytes: 0,
                            isActive,
                            badges: [
                                ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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
                const isActive = isGroupSelected && String(g.chat_id) === cid;
                groupChatItems.push(registerItem({
                    key: `group_chat:${g.id}::${cid}`,
                    categoryId: 'chats',
                    subgroupId: 'group_chats',
                    title: `${g.name || g.id} — ${cid}`,
                    subtitle: `所属群聊: ${g.name || g.id} · 会话 ID: ${cid}`,
                    sizeBytes: 0,
                    isActive,
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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
                        badges: [
                            ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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

        return [
            { id: 'regex_global', label: '全局正则', items: globalItems },
            { id: 'regex_scoped', label: '角色局部正则', items: scopedItems },
            { id: 'regex_preset', label: '预设内嵌正则', items: presetRegexItems },
            { id: 'regex_combos', label: '正则预设组合', items: comboItems },
        ];
    }

    async function scanWorldInfoCategory(signal, onProgress) {
        await ensureCharactersUnshallowed(signal, onProgress);
        const settingsData = await getSettingsSnapshot(signal);
        const ctx = getContext();
        const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
        const activeCharIndex = ctx?.characterId !== undefined && ctx?.characterId !== null && ctx?.characterId !== ''
            ? Number(ctx.characterId)
            : -1;
        const activeChar = activeCharIndex >= 0 ? characters[activeCharIndex] : null;

        const rawNames = Array.isArray(ctx?.worldNames) && ctx.worldNames.length > 0
            ? ctx.worldNames
            : (Array.isArray(settingsData?.world_names) ? settingsData.world_names : []);
        const worldNames = [...new Set(rawNames.map(x => String(x || '').trim()).filter(Boolean))];
        const bindings = collectWorldInfoBindings(ctx);

        const globalActiveSet = new Set(
            Array.isArray(ctx?.worldInfo?.globalSelect)
                ? ctx.worldInfo.globalSelect
                : (Array.isArray(ctx?.selected_world_info) ? ctx.selected_world_info : []),
        );
        const activeCharWorld = activeChar?.data?.extensions?.world || '';

        const unboundItems = [];
        const boundItems = [];
        for (const name of worldNames) {
            const boundTargets = bindings.get(name) || [];
            const isActive = globalActiveSet.has(name) || name === activeCharWorld;
            if (boundTargets.length === 0) {
                unboundItems.push(registerItem({
                    key: `wi:standalone::${name}`,
                    categoryId: 'worldinfo',
                    subgroupId: 'wi_unbound',
                    title: name,
                    subtitle: '独立世界书 · 未被全局/角色/人设绑定（闲置可安全清理）',
                    sizeBytes: 0,
                    isActive: false,
                    badges: [{ text: '未绑定', type: 'muted' }],
                    payload: {
                        kind: 'wi_standalone',
                        name,
                        boundTargets: [],
                    },
                }));
            } else {
                boundItems.push(registerItem({
                    key: `wi:standalone::${name}`,
                    categoryId: 'worldinfo',
                    subgroupId: 'wi_bound',
                    title: name,
                    subtitle: `已绑定至: ${boundTargets.join('、')}`,
                    sizeBytes: 0,
                    isActive,
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                        { text: `绑定×${boundTargets.length}`, type: 'warn' },
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
                : (book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : []);
            if (!book || entries.length === 0) continue;

            const isActive = activeChar?.avatar === ch.avatar;
            embeddedItems.push(registerItem({
                key: `wi:embedded::${ch.avatar}`,
                categoryId: 'worldinfo',
                subgroupId: 'wi_embedded',
                title: `${ch.name || stripExt(ch.avatar, '.png')} — 内嵌世界书${book.name ? ` (${book.name})` : ''}`,
                subtitle: `清空角色卡内嵌 character_book（保留角色卡与聊天记录） · 共 ${entries.length} 条目`,
                sizeBytes: 0,
                isActive,
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
            const items = [];
            for (const entry of bucket.list) {
                if (!entry.name || entry.name === 'gui') continue;
                const isActive = Boolean(bucket.activeName && entry.name === bucket.activeName);
                const isDefaultRestorable = DEFAULT_BUILTIN_PRESET_NAMES.has(entry.name);
                const fallbackItem = bucket.list.find(x => x.name && x.name !== 'gui' && x.name !== entry.name);
                items.push(registerItem({
                    key: `preset:${bucket.apiId}::${entry.name}`,
                    categoryId: 'presets',
                    subgroupId: bucket.subgroupId,
                    title: entry.name,
                    subtitle: `${bucket.label} (${bucket.apiId})${isDefaultRestorable ? ' · 默认模板（重启酒馆后可能自动恢复副本）' : ''}`,
                    sizeBytes: 0,
                    isActive,
                    badges: [
                        ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                        ...(isDefaultRestorable ? [{ text: '默认可恢复', type: 'muted' }] : []),
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
            items.push(registerItem({
                key: `profile:${p.id}`,
                categoryId: 'profiles',
                subgroupId: 'conn_profiles',
                title: String(p.name || p.id),
                subtitle: details.length > 0 ? `${details.join(' · ')}（不动 secrets.json 密钥）` : `ID: ${p.id}（不动 secrets.json 密钥）`,
                sizeBytes: 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(p.api ? [{ text: String(p.api), type: 'info' }] : []),
                ],
                payload: {
                    kind: 'conn_profile',
                    id: p.id,
                    name: String(p.name || p.id),
                },
            }));
        }

        return [{ id: 'conn_profiles', label: '连接配置插头', items }];
    }

    async function scanPersonasCategory(signal) {
        const ctx = getContext();
        const powerUser = ctx?.powerUserSettings || ctx?.power_user || {};
        const chatMeta = ctx?.chatMetadata || ctx?.chat_metadata || {};

        const [avatarsRes, bgsRes, settingsData] = await Promise.all([
            apiJson('api/avatars/get', { method: 'POST', body: {}, signal }).catch(() => []),
            apiJson('api/backgrounds/all', { method: 'POST', body: {}, signal }).catch(() => []),
            getSettingsSnapshot(signal),
        ]);

        // 1. User Personas
        const avatarSet = new Set(Array.isArray(avatarsRes) ? avatarsRes : []);
        if (powerUser?.personas && typeof powerUser.personas === 'object') {
            for (const k of Object.keys(powerUser.personas)) {
                if (k) avatarSet.add(k);
            }
        }

        const activePersona = ctx?.userAvatar || settingsData?.settings?.user_avatar || chatMeta?.persona || '';
        const defaultPersona = powerUser?.default_persona || '';
        const personaItems = [];
        for (const avatarFile of avatarSet) {
            const alias = powerUser?.personas?.[avatarFile] || stripExt(avatarFile, '.png');
            const descObj = powerUser?.persona_descriptions?.[avatarFile];
            const lorebook = descObj?.lorebook ? ` · 绑定世界书:${descObj.lorebook}` : '';
            const isActive = avatarFile === activePersona;
            const isDefault = avatarFile === defaultPersona;
            personaItems.push(registerItem({
                key: `persona:${avatarFile}`,
                categoryId: 'personas',
                subgroupId: 'user_personas',
                title: `${alias} (${avatarFile})`,
                subtitle: `人设头像: ${avatarFile}${isDefault ? ' · 默认人设' : ''}${lorebook}`,
                sizeBytes: 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(isDefault ? [{ text: '默认人设', type: 'warn' }] : []),
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
            bgItems.push(registerItem({
                key: `bg:${bg.filename}`,
                categoryId: 'personas',
                subgroupId: 'backgrounds',
                title: bg.filename,
                subtitle: bg.isAnimated ? '动态视频/动图背景' : '静态背景图片',
                sizeBytes: 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    ...(bg.isAnimated ? [{ text: '动态', type: 'info' }] : []),
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
            themeItems.push(registerItem({
                key: `theme:${name}`,
                categoryId: 'personas',
                subgroupId: 'themes',
                title: name,
                subtitle: '自定义界面配色主题 (.json)',
                sizeBytes: 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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
        const charByAvatar = new Map(characters.map(c => [c.avatar, c.name || stripExt(c.avatar, '.png')]));
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
            qrItems.push(registerItem({
                key: `qr:${name}`,
                categoryId: 'media',
                subgroupId: 'quick_replies',
                title: name,
                subtitle: `快捷回复集 · ${count} 条动作按钮`,
                sizeBytes: 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
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
            // Server files/delete expects basename inside user/files
            const fileName = url.split('/').pop() || url;
            databankItems.push(registerItem({
                key: `databank:${scope}::${ownerKey}::${url}`,
                categoryId: 'media',
                subgroupId: 'databank',
                title: String(att.name || fileName),
                subtitle: `${ownerLabel} · 文件: ${fileName}${att.size ? ` · ${Math.round(Number(att.size) / 1024)} KB` : ''}`,
                sizeBytes: Number(att.size) || 0,
                isActive,
                badges: [
                    ...(isActive ? [{ text: '正在使用', type: 'active' }] : []),
                    { text: scope === 'global' ? '全局资料库' : (scope === 'character' ? '角色资料库' : '当前会话'), type: 'info' },
                ],
                payload: {
                    kind: 'databank',
                    scope,
                    ownerKey,
                    url,
                    filePath: fileName,
                    name: String(att.name || fileName),
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
                                badges: [{ text: folder, type: 'muted' }],
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

        // 4. Character Tags
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
                isActive: false,
                badges: [{ text: `关联 ${refs} 角色`, type: refs > 0 ? 'info' : 'muted' }],
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
                    continue; // Strictly never list delEverything / self
                }
                const isGlobal = ext.type === 'global';
                if (isGlobal && !isAdmin) {
                    continue; // Non-admin cannot delete global extensions
                }
                const isDisabled = disabledExtensions.has(rawName) || disabledExtensions.has(`third-party/${strippedName}`);
                extItems.push(registerItem({
                    key: `ext:${isGlobal ? 'global' : 'local'}::${strippedName}`,
                    categoryId: 'extensions',
                    subgroupId: 'third_party_ext',
                    title: strippedName,
                    subtitle: `${isGlobal ? '全局第三方扩展 (global)' : '当前账号第三方扩展 (local)'} · ${isDisabled ? '已禁用' : '已启用'}`,
                    sizeBytes: 0,
                    isActive: !isDisabled,
                    badges: [
                        ...(!isDisabled ? [{ text: '正在使用', type: 'active' }] : [{ text: '已禁用', type: 'muted' }]),
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
                        isActive: false,
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
                    sizeBytes: 0,
                    isActive: false,
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

        const groups = Array.isArray(rawResult) ? rawResult : rawResult.groups;
        const warnings = Array.isArray(rawResult) ? [] : (rawResult.warnings || []);

        let totalCount = 0;
        let activeCount = 0;
        for (const g of groups) {
            totalCount += g.items.length;
            for (const item of g.items) {
                if (item.isActive) activeCount++;
            }
        }

        const record = {
            categoryId,
            groups,
            totalCount,
            activeCount,
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

    return {
        whitelistMap,
        getOverviewSummary,
        warmOverviewMetadata,
        scanCategory,
        invalidateCategories,
        getDataMaidToken: () => dataMaidToken,
        getSettingsSnapshot,
        dispose,
    };
}
