/**
 * @file deleter.js
 * Three-stage high-speed safe deletion & reference unbinding engine for SillyTavern.
 *
 * Stage 1: Bounded 5-worker concurrency pool for independent file/API deletions
 * Stage 2: Coalesced single-request writebacks per character, preset, and group
 * Stage 3: Unified in-memory reference cleanup, guarded event emission & immediate saveSettings flush
 */

import {
    SELF_EXTENSION_ID,
    BUILTIN_COMFY_WORKFLOWS,
    resolveSelfFolderName,
    stripExt,
    loadHostModules,
    pruneTavernHelperTree,
} from './scanner.js';

export const STAGE1_CONCURRENCY = 5;
export const STAGE2_CONCURRENCY = 3;

/**
 * Validates that a single-token identifier (filename / name / id) contains no
 * path traversal sequences or directory separators.
 * @param {string} val
 * @returns {boolean}
 */
export function isSafeSingleToken(val) {
    const s = String(val ?? '');
    if (!s || s === '.' || s === '..') return false;
    if (s.includes('..') || s.includes('/') || s.includes('\\') || s.includes('\0')) {
        return false;
    }
    return true;
}

/**
 * Validates gallery relative image paths (`user/images/<folder>/<file>`).
 * @param {string} relPath
 * @returns {boolean}
 */
export function isSafeGalleryPath(relPath) {
    const s = String(relPath ?? '');
    if (!s.startsWith('user/images/')) return false;
    if (s.includes('..') || s.includes('\\') || s.includes('\0')) return false;
    const parts = s.split('/');
    return parts.length >= 4 && parts.every(Boolean);
}

/**
 * Validates Data Bank relative file paths (`user/files/<file>`).
 * @param {string} relPath
 * @returns {boolean}
 */
export function isSafeUserFilesPath(relPath) {
    const s = String(relPath ?? '');
    if (!s.startsWith('user/files/')) return false;
    if (s.includes('..') || s.includes('\\') || s.includes('\0')) return false;
    const parts = s.split('/');
    return parts.length === 3 && isSafeSingleToken(parts[2]);
}

/**
 * Builds a pre-deletion impact summary for the 75dvh confirmation bottom sheet.
 * @param {Iterable<string>} selectedKeys
 * @param {import('./scanner.js').createScannerSession extends (...args: any[]) => infer R ? R : any} scanner
 * @param {{ skipActive?: boolean }} [opts]
 */
export function buildDeletionPreview(selectedKeys, scanner, opts = {}) {
    const skipActive = opts.skipActive !== false;
    const validItems = [];
    const skippedActiveItems = [];
    const rejectedKeys = [];
    const boundWorldbooks = [];
    const restorablePresets = [];
    const affectedCharWritebacks = new Set();
    const affectedPresetWritebacks = new Set();
    const affectedGroupWritebacks = new Set();
    let requiresReload = false;

    for (const key of selectedKeys || []) {
        const item = scanner?.whitelistMap?.get(key);
        if (!item) {
            rejectedKeys.push(key);
            continue;
        }
        if (skipActive && item.isActive) {
            skippedActiveItems.push(item);
            continue;
        }
        validItems.push(item);
        if (item.isActive) {
            requiresReload = true;
        }
        if (item.payload?.kind === 'third_party_ext' && item.isActive) {
            requiresReload = true;
        }
        if (item.payload?.kind === 'wi_standalone' && item.payload.boundTargets?.length > 0) {
            boundWorldbooks.push(item);
        }
        if (item.payload?.kind === 'preset' && item.badges?.some(b => b.text === '默认可恢复')) {
            restorablePresets.push(item);
        }
        if (item.payload?.kind === 'regex_scoped' || item.payload?.kind === 'th_char' || item.payload?.kind === 'wi_embedded') {
            affectedCharWritebacks.add(item.payload.avatar);
        }
        if (item.payload?.kind === 'regex_preset' || item.payload?.kind === 'th_preset') {
            affectedPresetWritebacks.add(`${item.payload.apiId}::${item.payload.presetName}`);
        }
        if (item.payload?.kind === 'group_chat') {
            affectedGroupWritebacks.add(String(item.payload.groupId));
        }
    }

    /** @type {Map<string, { categoryId: string, subgroupId: string, items: any[] }>} */
    const groupedMap = new Map();
    for (const item of validItems) {
        const gKey = `${item.categoryId}::${item.subgroupId}`;
        let group = groupedMap.get(gKey);
        if (!group) {
            group = { categoryId: item.categoryId, subgroupId: item.subgroupId, items: [] };
            groupedMap.set(gKey, group);
        }
        group.items.push(item);
    }

    return {
        validItems,
        skippedActiveItems,
        rejectedKeys,
        groupedList: [...groupedMap.values()],
        boundWorldbooks,
        restorablePresets,
        coalescedStats: {
            charWritebacks: affectedCharWritebacks.size,
            presetWritebacks: affectedPresetWritebacks.size,
            groupWritebacks: affectedGroupWritebacks.size,
        },
        requiresReload,
    };
}

/**
 * Guarded event emitter: checks both eventSource.emit and non-empty eventType
 * so missing event_types constants in older ST versions never throw or emit `undefined`.
 */
function safeEmit(ctx, eventTypeKey, ...args) {
    try {
        const eventSource = ctx?.eventSource;
        const eventTypes = ctx?.eventTypes || ctx?.event_types || {};
        const eventName = eventTypes[eventTypeKey];
        if (!eventName || typeof eventSource?.emit !== 'function') {
            return Promise.resolve();
        }
        const res = eventSource.emit(eventName, ...args);
        return res && typeof res.then === 'function' ? res.catch(() => {}) : Promise.resolve();
    } catch {
        return Promise.resolve();
    }
}

/**
 * Executes the 3-stage safe deletion pipeline.
 *
 * @param {object} params
 * @param {Iterable<string>} params.selectedKeys
 * @param {any} params.scanner
 * @param {boolean} [params.skipActive=true]
 * @param {() => any} [params.getContext]
 * @param {typeof fetch} [params.fetchFn]
 * @param {() => Promise<any>} [params.saveSettingsImmediate]
 * @param {string} [params.selfFolderName]
 * @param {(progress: { stage: number, stageLabel: string, completed: number, total: number, percent: number, currentTitle: string }) => void} [params.onProgress]
 */
export async function executeBatchDelete(params) {
    const {
        selectedKeys,
        scanner,
        skipActive = true,
        onProgress,
    } = params;

    const getContext = params.getContext || (() => globalThis.SillyTavern?.getContext?.() || {});
    const fetchFn = params.fetchFn || ((...args) => globalThis.fetch(...args));
    const runtimeFolder = (params.selfFolderName || resolveSelfFolderName()).toLowerCase();
    const forbiddenExtNames = new Set([SELF_EXTENSION_ID.toLowerCase(), runtimeFolder]);

    const ctx = getContext();
    const headers = (() => {
        try {
            if (typeof ctx?.getRequestHeaders === 'function') {
                return { ...ctx.getRequestHeaders() };
            }
        } catch {
            // Fallback below
        }
        return { 'Content-Type': 'application/json' };
    })();

    async function sendRequest(url, { method = 'POST', body } = {}) {
        const reqHeaders = { ...headers };
        const init = { method, headers: reqHeaders };
        if (method !== 'GET' && method !== 'HEAD') {
            init.body = JSON.stringify(body ?? {});
        } else {
            delete reqHeaders['Content-Type'];
        }
        return fetchFn(url, init);
    }

    const preview = buildDeletionPreview(selectedKeys, scanner, { skipActive });
    const succeeded = [];
    const skipped = preview.skippedActiveItems.map(item => ({
        key: item.key,
        title: item.title,
        reason: '正在使用（已开启自动跳过保护）',
    }));
    const failed = preview.rejectedKeys.map(key => ({
        key,
        title: String(key),
        reason: '未通过白名单安全校验，已拦截',
    }));

    if (preview.validItems.length === 0) {
        return {
            succeeded,
            skipped,
            failed,
            requiresReload: false,
            affectedCategories: [],
        };
    }

    // Pre-validate every item's payload safety before touching the server
    const executableItems = [];
    for (const item of preview.validItems) {
        const p = item.payload || {};
        let unsafeReason = '';

        switch (p.kind) {
            case 'char_card':
                if (!isSafeSingleToken(p.avatar)) unsafeReason = '角色头像文件名包含非法路径字符';
                break;
            case 'char_sprites':
                if (!isSafeSingleToken(p.avatar) || !isSafeSingleToken(p.spriteDirName)) unsafeReason = '角色立绘目录名非法';
                break;
            case 'group':
                if (!isSafeSingleToken(p.id)) unsafeReason = '群组 ID 非法';
                break;
            case 'char_chat':
                if (!isSafeSingleToken(p.avatar) || !isSafeSingleToken(p.fileName)) unsafeReason = '聊天文件名包含非法路径字符';
                break;
            case 'group_chat':
                if (!isSafeSingleToken(p.groupId) || !isSafeSingleToken(p.chatId)) unsafeReason = '群聊会话 ID 非法';
                break;
            case 'wi_standalone':
                if (!isSafeSingleToken(p.name)) unsafeReason = '世界书名称包含非法路径字符';
                break;
            case 'preset':
                if (p.name === 'gui' || !isSafeSingleToken(p.name)) unsafeReason = '预设名称受保护或包含非法字符';
                break;
            case 'user_persona':
                if (!isSafeSingleToken(p.avatar)) unsafeReason = '人设头像文件名非法';
                break;
            case 'background':
                if (!isSafeSingleToken(p.bg)) unsafeReason = '背景文件名包含非法路径字符';
                break;
            case 'theme':
                if (!isSafeSingleToken(p.name)) unsafeReason = '主题名称包含非法路径字符';
                break;
            case 'quick_reply':
                if (!isSafeSingleToken(p.name)) unsafeReason = '快捷回复名称包含非法路径字符';
                break;
            case 'databank':
                if (!isSafeUserFilesPath(p.filePath)) unsafeReason = '资料库附件路径非法';
                break;
            case 'gallery_image':
                if (!isSafeGalleryPath(p.path)) unsafeReason = '画廊图片路径越界';
                break;
            case 'user_asset':
                if (!['bgm', 'ambient', 'blip'].includes(p.category) || !isSafeSingleToken(p.filename)) {
                    unsafeReason = '音效资产分类或文件名非法';
                } else if (!/^[a-zA-Z0-9_\-.]+$/.test(String(p.filename))) {
                    unsafeReason = '酒馆官方 /api/assets/delete 仅允许英文字母、数字、下划线或连字符文件名，含中文文件请在 assets 目录手动移除';
                }
                break;
            case 'comfy_workflow':
                if (
                    !isSafeSingleToken(p.fileName)
                    || !String(p.fileName).toLowerCase().endsWith('.json')
                    || BUILTIN_COMFY_WORKFLOWS.has(p.fileName)
                ) {
                    unsafeReason = '禁止删除内置默认工作流或非法文件名';
                }
                break;
            case 'third_party_ext':
                if (!isSafeSingleToken(p.extensionName) || forbiddenExtNames.has(String(p.extensionName).toLowerCase())) {
                    unsafeReason = '禁止卸载核心系统扩展或本清理插件自身';
                }
                break;
            case 'vector_collection':
                if (!isSafeSingleToken(p.collectionId)) unsafeReason = '向量集合 ID 非法';
                break;
            case 'chat_backup':
                if (!isSafeSingleToken(p.name) || !String(p.name).startsWith('chat_')) {
                    unsafeReason = '非聊天备份文件已拦截（保护设置快照）';
                }
                break;
            default:
                break;
        }

        if (unsafeReason) {
            failed.push({ key: item.key, title: item.title, reason: unsafeReason });
        } else {
            executableItems.push(item);
        }
    }

    // Track whole-entity deletions so child items in the same batch don't double-write
    const plannedCharDeletes = new Set(
        executableItems.filter(i => i.payload.kind === 'char_card').map(i => i.payload.avatar),
    );
    const plannedGroupDeletes = new Set(
        executableItems.filter(i => i.payload.kind === 'group').map(i => String(i.payload.id)),
    );
    const plannedPresetDeletes = new Set(
        executableItems.filter(i => i.payload.kind === 'preset').map(i => `${i.payload.apiId}::${i.payload.name}`),
    );

    // Partition items into Stage 1, Stage 2, and Stage 3-only tasks
    const stage1Tasks = [];
    const dataMaidItems = [];
    const stage2CharOps = new Map(); // avatar -> { items: [], removeRegexIds: Set, clearBook: boolean }
    const stage2PresetOps = new Map(); // apiId::name -> { apiId, presetName, presetData, items: [], removeRegexIds: Set }
    const stage2GroupChatRemovals = new Map(); // groupId -> Set<chatId>
    const stage3DirectItems = []; // regex_global, regex_combo, conn_profile, tag

    for (const item of executableItems) {
        const p = item.payload;
        switch (p.kind) {
            case 'data_maid':
                dataMaidItems.push(item);
                break;

            case 'char_card':
            case 'group':
            case 'wi_standalone':
            case 'preset':
            case 'user_persona':
            case 'background':
            case 'theme':
            case 'quick_reply':
            case 'databank':
            case 'gallery_image':
            case 'user_asset':
            case 'comfy_workflow':
            case 'third_party_ext':
            case 'vector_collection':
            case 'chat_backup':
                stage1Tasks.push(item);
                break;

            case 'char_sprites':
                if (plannedCharDeletes.has(p.avatar)) {
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    stage1Tasks.push(item);
                }
                break;

            case 'char_chat':
                if (plannedCharDeletes.has(p.avatar)) {
                    // Covered by character deletion (`delete_chats: true`)
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    stage1Tasks.push(item);
                }
                break;

            case 'group_chat':
                if (plannedGroupDeletes.has(String(p.groupId))) {
                    // Covered by group deletion
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    stage1Tasks.push(item);
                }
                break;

            case 'regex_scoped':
                if (plannedCharDeletes.has(p.avatar)) {
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    let op = stage2CharOps.get(p.avatar);
                    if (!op) {
                        op = { avatar: p.avatar, items: [], removeRegexIds: new Set(), removeThIds: new Set(), clearBook: false };
                        stage2CharOps.set(p.avatar, op);
                    }
                    op.items.push(item);
                    op.removeRegexIds.add(String(p.scriptId));
                }
                break;

            case 'th_char':
                if (plannedCharDeletes.has(p.avatar)) {
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    let op = stage2CharOps.get(p.avatar);
                    if (!op) {
                        op = { avatar: p.avatar, items: [], removeRegexIds: new Set(), removeThIds: new Set(), clearBook: false };
                        stage2CharOps.set(p.avatar, op);
                    }
                    op.items.push(item);
                    op.removeThIds.add(String(p.scriptId));
                }
                break;

            case 'wi_embedded':
                if (plannedCharDeletes.has(p.avatar)) {
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    let op = stage2CharOps.get(p.avatar);
                    if (!op) {
                        op = { avatar: p.avatar, items: [], removeRegexIds: new Set(), removeThIds: new Set(), clearBook: false };
                        stage2CharOps.set(p.avatar, op);
                    }
                    op.items.push(item);
                    op.clearBook = true;
                }
                break;

            case 'regex_preset': {
                const pKey = `${p.apiId}::${p.presetName}`;
                if (plannedPresetDeletes.has(pKey)) {
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    let op = stage2PresetOps.get(pKey);
                    if (!op) {
                        op = {
                            apiId: p.apiId,
                            presetName: p.presetName,
                            presetData: p.presetData,
                            items: [],
                            removeRegexIds: new Set(),
                            removeThIds: new Set(),
                        };
                        stage2PresetOps.set(pKey, op);
                    }
                    op.items.push(item);
                    op.removeRegexIds.add(String(p.scriptId));
                }
                break;
            }

            case 'th_preset': {
                const pKey = `${p.apiId}::${p.presetName}`;
                if (plannedPresetDeletes.has(pKey)) {
                    succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                } else {
                    let op = stage2PresetOps.get(pKey);
                    if (!op) {
                        op = {
                            apiId: p.apiId,
                            presetName: p.presetName,
                            presetData: p.presetData,
                            items: [],
                            removeRegexIds: new Set(),
                            removeThIds: new Set(),
                        };
                        stage2PresetOps.set(pKey, op);
                    }
                    op.items.push(item);
                    op.removeThIds.add(String(p.scriptId));
                }
                break;
            }

            case 'regex_global':
            case 'regex_combo':
            case 'th_global':
            case 'global_var':
            case 'conn_profile':
            case 'tag':
                stage3DirectItems.push(item);
                break;

            default:
                failed.push({ key: item.key, title: item.title, reason: `未知数据类型: ${p.kind}` });
                break;
        }
    }

    const totalWorkUnits = stage1Tasks.length
        + (dataMaidItems.length > 0 ? 1 : 0)
        + stage2CharOps.size
        + stage2PresetOps.size
        + 1; // +1 for Stage 3 unified unbind & settings flush
    let completedUnits = 0;

    const emitProgress = (stage, stageLabel, currentTitle) => {
        const pct = totalWorkUnits > 0
            ? Math.min(100, Math.round((completedUnits / totalWorkUnits) * 100))
            : 100;
        onProgress?.({
            stage,
            stageLabel,
            completed: completedUnits,
            total: totalWorkUnits,
            percent: pct,
            currentTitle: currentTitle || '',
        });
    };

    // Track succeeded Stage 1 entities for Stage 2 & Stage 3 unbinding
    const deletedCharRecords = []; // { avatar, pastChatIds: string[], item }
    const deletedGroupIds = new Set();
    const deletedWorldNames = new Set();
    const deletedPresets = [];
    const deletedPersonas = [];
    const deletedBackgrounds = [];
    const deletedThemes = [];
    const deletedQuickReplies = [];
    const deletedDatabankItems = [];
    const deletedExtensions = [];
    const deletedComfyWorkflows = [];
    const deletedRegexIdsAllScopes = new Set();
    const deletedPhysicalFiles = new Set();

    // =========================================================================
    // STAGE 1: Bounded 5-Worker Independent File Deletions
    // =========================================================================
    emitProgress(1, '第一阶段：并发清理独立文件与资源', '准备启动并发队列...');

    let stage1Cursor = 0;
    async function runStage1Worker() {
        while (stage1Cursor < stage1Tasks.length) {
            const idx = stage1Cursor++;
            const item = stage1Tasks[idx];
            const p = item.payload;
            emitProgress(1, '第一阶段：并发清理独立文件与资源', item.title);

            try {
                let res = null;
                let pastChatIds = [];

                switch (p.kind) {
                    case 'char_card': {
                        // Collect past chat IDs first so CHAT_DELETED can clean vectors/attachments
                        try {
                            const chatRes = await sendRequest('api/characters/chats', {
                                method: 'POST',
                                body: { avatar_url: p.avatar, simple: true },
                            });
                            if (chatRes.ok) {
                                const chatList = await chatRes.json();
                                if (Array.isArray(chatList)) {
                                    pastChatIds = chatList
                                        .map(c => c?.file_id || stripExt(c?.file_name || '', '.jsonl'))
                                        .filter(Boolean);
                                }
                            }
                        } catch {
                            // Non-fatal
                        }

                        // Clean character sprites folder if any sprites exist
                        if (isSafeSingleToken(p.spriteDirName)) {
                            try {
                                const spRes = await sendRequest(
                                    `api/sprites/get?name=${encodeURIComponent(p.spriteDirName)}`,
                                    { method: 'GET' },
                                );
                                if (spRes.ok) {
                                    const spList = await spRes.json();
                                    if (Array.isArray(spList) && spList.length > 0) {
                                        for (const sp of spList) {
                                            const rawFile = String(sp?.path || '').split('?')[0].split('/').pop() || '';
                                            const spriteName = rawFile.replace(/\.[^.]+$/, '');
                                            if (spriteName && sp?.label) {
                                                await sendRequest('api/sprites/delete', {
                                                    method: 'POST',
                                                    body: {
                                                        name: p.spriteDirName,
                                                        label: sp.label,
                                                        spriteName,
                                                    },
                                                }).catch(() => {});
                                            }
                                        }
                                    }
                                }
                            } catch {
                                // Non-fatal
                            }
                        }

                        res = await sendRequest('api/characters/delete', {
                            method: 'POST',
                            body: { avatar_url: p.avatar, delete_chats: true },
                        });
                        break;
                    }

                    case 'group':
                        res = await sendRequest('api/groups/delete', {
                            method: 'POST',
                            body: { id: p.id },
                        });
                        break;

                    case 'char_chat':
                        res = await sendRequest('api/chats/delete', {
                            method: 'POST',
                            body: { chatfile: p.fileName, avatar_url: p.avatar },
                        });
                        break;

                    case 'group_chat':
                        res = await sendRequest('api/chats/group/delete', {
                            method: 'POST',
                            body: { id: p.chatId },
                        });
                        break;

                    case 'wi_standalone':
                        res = await sendRequest('api/worldinfo/delete', {
                            method: 'POST',
                            body: { name: p.name },
                        });
                        break;

                    case 'preset':
                        res = await sendRequest('api/presets/delete', {
                            method: 'POST',
                            body: { name: p.name, apiId: p.apiId },
                        });
                        break;

                    case 'user_persona':
                        res = await sendRequest('api/avatars/delete', {
                            method: 'POST',
                            body: { avatar: p.avatar },
                        });
                        break;

                    case 'background':
                        res = await sendRequest('api/backgrounds/delete', {
                            method: 'POST',
                            body: { bg: p.bg },
                        });
                        break;

                    case 'theme':
                        res = await sendRequest('api/themes/delete', {
                            method: 'POST',
                            body: { name: p.name },
                        });
                        break;

                    case 'quick_reply':
                        res = await sendRequest('api/quick-replies/delete', {
                            method: 'POST',
                            body: { name: p.name },
                        });
                        break;

                    case 'databank':
                        if (deletedPhysicalFiles.has(p.filePath)) {
                            res = { ok: true, status: 200 };
                        } else {
                            res = await sendRequest('api/files/delete', {
                                method: 'POST',
                                body: { path: p.filePath },
                            });
                            if (res.ok || res.status === 404) {
                                deletedPhysicalFiles.add(p.filePath);
                            }
                        }
                        break;

                    case 'gallery_image':
                        res = await sendRequest('api/images/delete', {
                            method: 'POST',
                            body: { path: p.path },
                        });
                        break;

                    case 'char_sprites': {
                        const spArr = Array.isArray(p.sprites) ? p.sprites : [];
                        let lastRes = { ok: true, status: 200 };
                        for (const sp of spArr) {
                            if (!sp?.label || !sp?.spriteName) continue;
                            lastRes = await sendRequest('api/sprites/delete', {
                                method: 'POST',
                                body: {
                                    name: p.spriteDirName,
                                    label: sp.label,
                                    spriteName: sp.spriteName,
                                },
                            });
                        }
                        res = lastRes;
                        break;
                    }

                    case 'user_asset':
                        res = await sendRequest('api/assets/delete', {
                            method: 'POST',
                            body: { category: p.category, filename: p.filename },
                        });
                        break;

                    case 'comfy_workflow':
                        res = await sendRequest('api/sd/comfy/delete-workflow', {
                            method: 'POST',
                            body: { file_name: p.fileName },
                        });
                        break;

                    case 'third_party_ext':
                        res = await sendRequest('api/extensions/delete', {
                            method: 'POST',
                            body: { extensionName: p.extensionName, global: Boolean(p.global) },
                        });
                        break;

                    case 'vector_collection':
                        res = await sendRequest('api/vector/purge', {
                            method: 'POST',
                            body: { collectionId: p.collectionId },
                        });
                        break;

                    case 'chat_backup':
                        res = await sendRequest('api/backups/chat/delete', {
                            method: 'POST',
                            body: { name: p.name },
                        });
                        break;

                    default:
                        break;
                }

                const is404 = res && res.status === 404;
                const isOk = res && (res.ok || is404);

                if (!isOk) {
                    failed.push({
                        key: item.key,
                        title: item.title,
                        reason: `服务端返回 HTTP ${res?.status ?? '未知错误'}`,
                    });
                } else {
                    if (is404) {
                        skipped.push({
                            key: item.key,
                            title: item.title,
                            reason: '磁盘文件已不存在，已同步清理残留引用',
                        });
                    } else {
                        succeeded.push({
                            key: item.key,
                            title: item.title,
                            categoryId: item.categoryId,
                        });
                    }

                    // Record successful/404 entities for Stage 2 & Stage 3 reference unbinding
                    switch (p.kind) {
                        case 'char_card':
                            deletedCharRecords.push({ avatar: p.avatar, pastChatIds, item });
                            break;
                        case 'group':
                            deletedGroupIds.add(String(p.id));
                            break;
                        case 'char_chat':
                            await safeEmit(ctx, 'CHAT_DELETED', p.fileId);
                            break;
                        case 'group_chat': {
                            let set = stage2GroupChatRemovals.get(String(p.groupId));
                            if (!set) {
                                set = new Set();
                                stage2GroupChatRemovals.set(String(p.groupId), set);
                            }
                            set.add(String(p.chatId));
                            await safeEmit(ctx, 'CHAT_DELETED', p.chatId);
                            break;
                        }
                        case 'wi_standalone':
                            deletedWorldNames.add(p.name);
                            break;
                        case 'preset':
                            deletedPresets.push(p);
                            break;
                        case 'user_persona':
                            deletedPersonas.push(p);
                            break;
                        case 'background':
                            deletedBackgrounds.push(p);
                            break;
                        case 'theme':
                            deletedThemes.push(p);
                            break;
                        case 'quick_reply':
                            deletedQuickReplies.push(p);
                            break;
                        case 'databank':
                            deletedDatabankItems.push(p);
                            break;
                        case 'third_party_ext':
                            deletedExtensions.push(p);
                            break;
                        case 'comfy_workflow':
                            deletedComfyWorkflows.push(p);
                            break;
                        default:
                            break;
                    }
                }
            } catch (err) {
                failed.push({
                    key: item.key,
                    title: item.title,
                    reason: err?.message || '网络请求异常',
                });
            }

            completedUnits++;
            emitProgress(1, '第一阶段：并发清理独立文件与资源', item.title);
        }
    }

    if (stage1Tasks.length > 0) {
        const workerCount = Math.min(STAGE1_CONCURRENCY, stage1Tasks.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(runStage1Worker());
        }
        await Promise.all(workers);
    }

    // Batch Data Maid delete in a single atomic call if selected
    if (dataMaidItems.length > 0) {
        emitProgress(1, '第一阶段：批量清理无主孤儿文件', `共 ${dataMaidItems.length} 个冗余文件`);
        const token = scanner?.getDataMaidToken?.();
        if (!token) {
            for (const dm of dataMaidItems) {
                failed.push({ key: dm.key, title: dm.title, reason: 'Data Maid 会话令牌已失效，请重新扫描' });
            }
        } else {
            try {
                const hashes = dataMaidItems.map(dm => dm.payload.hash);
                const dmRes = await sendRequest('api/data-maid/delete', {
                    method: 'POST',
                    body: { token, hashes },
                });
                if (dmRes.ok) {
                    for (const dm of dataMaidItems) {
                        succeeded.push({ key: dm.key, title: dm.title, categoryId: dm.categoryId });
                    }
                    await sendRequest('api/data-maid/finalize', {
                        method: 'POST',
                        body: { token },
                    }).catch(() => {});
                } else {
                    for (const dm of dataMaidItems) {
                        failed.push({ key: dm.key, title: dm.title, reason: `Data Maid 删除失败 (HTTP ${dmRes.status})` });
                    }
                }
            } catch (err) {
                for (const dm of dataMaidItems) {
                    failed.push({ key: dm.key, title: dm.title, reason: err?.message || 'Data Maid 请求失败' });
                }
            }
        }
        completedUnits++;
        emitProgress(1, '第一阶段：批量清理无主孤儿文件', '完成');
    }

    // =========================================================================
    // STAGE 2: Coalesced Single-Request Writebacks (Characters, Presets, Groups)
    // =========================================================================
    const deletedCharAvatarSet = new Set(deletedCharRecords.map(r => r.avatar));
    const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
    const groups = Array.isArray(ctx?.groups) ? ctx.groups : [];

    // Also unbind deleted standalone worldbooks from surviving characters' primary `data.extensions.world`
    if (deletedWorldNames.size > 0) {
        for (const ch of characters) {
            if (!ch?.avatar || deletedCharAvatarSet.has(ch.avatar)) continue;
            const boundPrimary = ch?.data?.extensions?.world;
            if (boundPrimary && deletedWorldNames.has(boundPrimary)) {
                let op = stage2CharOps.get(ch.avatar);
                if (!op) {
                    op = { avatar: ch.avatar, items: [], removeRegexIds: new Set(), removeThIds: new Set(), clearBook: false, unbindWorld: true };
                    stage2CharOps.set(ch.avatar, op);
                } else {
                    op.unbindWorld = true;
                }
            }
        }
    }

    // 2A. Coalesced character `api/characters/merge-attributes`
    const charOpList = [...stage2CharOps.values()].filter(op => !deletedCharAvatarSet.has(op.avatar));
    if (charOpList.length > 0) {
        let charCursor = 0;
        const runCharWorker = async () => {
            while (charCursor < charOpList.length) {
                const op = charOpList[charCursor++];
                const ch = characters.find(c => c?.avatar === op.avatar);
                const label = ch?.name || op.avatar;
                emitProgress(2, '第二阶段：合并写回角色卡与内嵌数据', label);

                try {
                    const patch = { avatar: op.avatar, data: {} };
                    if (op.removeRegexIds.size > 0 || op.removeThIds.size > 0 || op.unbindWorld) {
                        patch.data.extensions = {};
                    }
                    if (op.removeRegexIds.size > 0) {
                        const existingScripts = Array.isArray(ch?.data?.extensions?.regex_scripts)
                            ? ch.data.extensions.regex_scripts
                            : [];
                        const nextScripts = existingScripts.filter((s, idx) => {
                            const sid = String(s?.id ?? `idx_${idx}`);
                            return !op.removeRegexIds.has(sid);
                        });
                        patch.data.extensions.regex_scripts = nextScripts;
                    }
                    if (op.removeThIds.size > 0) {
                        const existingExt = ch?.data?.extensions || {};
                        if (existingExt.tavern_helper && Array.isArray(existingExt.tavern_helper.scripts)) {
                            patch.data.extensions.tavern_helper = {
                                ...existingExt.tavern_helper,
                                scripts: pruneTavernHelperTree(existingExt.tavern_helper.scripts, op.removeThIds),
                            };
                        }
                        if (Array.isArray(existingExt.TavernHelper_scripts)) {
                            patch.data.extensions.TavernHelper_scripts = pruneTavernHelperTree(existingExt.TavernHelper_scripts, op.removeThIds);
                        }
                    }
                    if (op.unbindWorld) {
                        patch.data.extensions.world = '';
                    }
                    if (op.clearBook) {
                        patch.data.character_book = null;
                    }

                    const res = await sendRequest('api/characters/merge-attributes', {
                        method: 'POST',
                        body: patch,
                    });

                    if (res.ok) {
                        // Sync in-memory character object immediately
                        if (ch) {
                            ch.data = ch.data || {};
                            ch.data.extensions = ch.data.extensions || {};
                            if (op.removeRegexIds.size > 0) {
                                ch.data.extensions.regex_scripts = patch.data.extensions.regex_scripts;
                                for (const id of op.removeRegexIds) deletedRegexIdsAllScopes.add(id);
                            }
                            if (op.removeThIds.size > 0) {
                                if (patch.data.extensions.tavern_helper) {
                                    ch.data.extensions.tavern_helper = patch.data.extensions.tavern_helper;
                                }
                                if (patch.data.extensions.TavernHelper_scripts) {
                                    ch.data.extensions.TavernHelper_scripts = patch.data.extensions.TavernHelper_scripts;
                                }
                            }
                            if (op.unbindWorld) {
                                ch.data.extensions.world = '';
                            }
                            if (op.clearBook) {
                                ch.data.character_book = null;
                            }
                        }
                        for (const subItem of op.items) {
                            succeeded.push({ key: subItem.key, title: subItem.title, categoryId: subItem.categoryId });
                        }
                    } else {
                        for (const subItem of op.items) {
                            failed.push({ key: subItem.key, title: subItem.title, reason: `角色合并写回失败 (HTTP ${res.status})` });
                        }
                    }
                } catch (err) {
                    for (const subItem of op.items) {
                        failed.push({ key: subItem.key, title: subItem.title, reason: err?.message || '角色写回异常' });
                    }
                }

                if (op.items.length > 0) {
                    completedUnits++;
                }
                emitProgress(2, '第二阶段：合并写回角色卡与内嵌数据', label);
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(STAGE2_CONCURRENCY, charOpList.length); i++) {
            workers.push(runCharWorker());
        }
        await Promise.all(workers);
    }

    // 2B. Coalesced preset `api/presets/save`
    const presetOpList = [...stage2PresetOps.values()];
    if (presetOpList.length > 0) {
        let presetCursor = 0;
        const runPresetWorker = async () => {
            while (presetCursor < presetOpList.length) {
                const op = presetOpList[presetCursor++];
                emitProgress(2, '第二阶段：合并写回预设内嵌正则', op.presetName);
                try {
                    const cloned = JSON.parse(JSON.stringify(op.presetData || {}));
                    cloned.extensions = cloned.extensions || {};
                    if (op.removeRegexIds.size > 0) {
                        const currentScripts = Array.isArray(cloned.extensions.regex_scripts)
                            ? cloned.extensions.regex_scripts
                            : [];
                        cloned.extensions.regex_scripts = currentScripts.filter((s, idx) => {
                            const sid = String(s?.id ?? `idx_${idx}`);
                            return !op.removeRegexIds.has(sid);
                        });
                    }
                    if (op.removeThIds.size > 0 && cloned.extensions.tavern_helper && Array.isArray(cloned.extensions.tavern_helper.scripts)) {
                        cloned.extensions.tavern_helper.scripts = pruneTavernHelperTree(
                            cloned.extensions.tavern_helper.scripts,
                            op.removeThIds,
                        );
                    }

                    const res = await sendRequest('api/presets/save', {
                        method: 'POST',
                        body: {
                            apiId: op.apiId,
                            name: op.presetName,
                            preset: cloned,
                        },
                    });

                    if (res.ok) {
                        if (op.removeRegexIds.size > 0 && op.presetData?.extensions && Array.isArray(op.presetData.extensions.regex_scripts)) {
                            op.presetData.extensions.regex_scripts = cloned.extensions.regex_scripts;
                        }
                        if (op.removeThIds.size > 0 && op.presetData?.extensions?.tavern_helper) {
                            op.presetData.extensions.tavern_helper.scripts = cloned.extensions.tavern_helper.scripts;
                        }
                        for (const id of op.removeRegexIds) deletedRegexIdsAllScopes.add(id);
                        for (const subItem of op.items) {
                            succeeded.push({ key: subItem.key, title: subItem.title, categoryId: subItem.categoryId });
                        }
                    } else {
                        for (const subItem of op.items) {
                            failed.push({ key: subItem.key, title: subItem.title, reason: `预设写回失败 (HTTP ${res.status})` });
                        }
                    }
                } catch (err) {
                    for (const subItem of op.items) {
                        failed.push({ key: subItem.key, title: subItem.title, reason: err?.message || '预设写回异常' });
                    }
                }
                completedUnits++;
                emitProgress(2, '第二阶段：合并写回预设内嵌正则', op.presetName);
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(STAGE2_CONCURRENCY, presetOpList.length); i++) {
            workers.push(runPresetWorker());
        }
        await Promise.all(workers);
    }

    // 2C. Coalesced group `api/groups/edit` (for deleted character members AND/OR deleted group_chat sessions)
    const groupsToEdit = [];
    for (const g of groups) {
        if (!g?.id || deletedGroupIds.has(String(g.id))) continue;
        const removedChats = stage2GroupChatRemovals.get(String(g.id));
        const hasDeletedMember = deletedCharAvatarSet.size > 0
            && Array.isArray(g.members)
            && g.members.some(m => deletedCharAvatarSet.has(m));
        const hasDeletedChat = Boolean(removedChats && removedChats.size > 0);
        if (hasDeletedMember || hasDeletedChat) {
            groupsToEdit.push({ group: g, removedChats });
        }
    }

    if (groupsToEdit.length > 0) {
        await Promise.all(groupsToEdit.map(async ({ group, removedChats }) => {
            const updatedGroup = { ...group };
            if (Array.isArray(updatedGroup.members) && deletedCharAvatarSet.size > 0) {
                updatedGroup.members = updatedGroup.members.filter(m => !deletedCharAvatarSet.has(m));
            }
            if (Array.isArray(updatedGroup.disabled_members) && deletedCharAvatarSet.size > 0) {
                updatedGroup.disabled_members = updatedGroup.disabled_members.filter(m => !deletedCharAvatarSet.has(m));
            }
            if (Array.isArray(updatedGroup.chats) && removedChats?.size > 0) {
                updatedGroup.chats = updatedGroup.chats.filter(cid => !removedChats.has(String(cid)));
                if (removedChats.has(String(updatedGroup.chat_id))) {
                    updatedGroup.chat_id = updatedGroup.chats[0] || '';
                }
            }
            try {
                const res = await sendRequest('api/groups/edit', {
                    method: 'POST',
                    body: updatedGroup,
                });
                if (res.ok) {
                    Object.assign(group, updatedGroup);
                }
            } catch {
                // Non-fatal
            }
        }));
    }

    // =========================================================================
    // STAGE 3: Unified In-Memory Reference Cleanup, Native Events & Immediate Flush
    // =========================================================================
    emitProgress(3, '第三阶段：解绑残留引用并持久化设置', '正在同步内存状态...');

    const hostMods = await loadHostModules();
    const extSettings = ctx?.extensionSettings || ctx?.extension_settings || {};
    const powerUser = ctx?.powerUserSettings || ctx?.power_user || {};
    const chatMeta = ctx?.chatMetadata || ctx?.chat_metadata || {};
    const tagMap = ctx?.tagMap || ctx?.tag_map || {};
    const worldInfo = hostMods?.worldInfo?.world_info || ctx?.worldInfo || ctx?.world_info || {};

    // Process Stage 3 direct settings-backed items (regex_global, regex_combo, conn_profile, tag)
    for (const item of stage3DirectItems) {
        const p = item.payload;
        switch (p.kind) {
            case 'regex_global': {
                if (Array.isArray(extSettings.regex)) {
                    extSettings.regex = extSettings.regex.filter((s, idx) => {
                        const sid = String(s?.id ?? `idx_${idx}`);
                        return sid !== String(p.scriptId);
                    });
                }
                deletedRegexIdsAllScopes.add(String(p.scriptId));
                succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                break;
            }
            case 'regex_combo': {
                if (Array.isArray(extSettings.regex_presets)) {
                    extSettings.regex_presets = extSettings.regex_presets.filter((c) => {
                        if (p.comboId !== null && p.comboId !== undefined && c?.id !== undefined) {
                            return String(c.id) !== String(p.comboId);
                        }
                        return String(c?.name) !== String(p.comboName);
                    });
                }
                succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                break;
            }
            case 'th_global': {
                const removeSet = new Set([String(p.scriptId)]);
                if (extSettings?.tavern_helper?.script && Array.isArray(extSettings.tavern_helper.script.scripts)) {
                    extSettings.tavern_helper.script.scripts = pruneTavernHelperTree(
                        extSettings.tavern_helper.script.scripts,
                        removeSet,
                    );
                }
                if (extSettings?.TavernHelper?.script && Array.isArray(extSettings.TavernHelper.script.scriptsRepository)) {
                    extSettings.TavernHelper.script.scriptsRepository = pruneTavernHelperTree(
                        extSettings.TavernHelper.script.scriptsRepository,
                        removeSet,
                    );
                }
                succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                break;
            }
            case 'global_var': {
                if (extSettings?.variables?.global && typeof extSettings.variables.global === 'object') {
                    delete extSettings.variables.global[p.varKey];
                }
                succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                break;
            }
            case 'conn_profile': {
                const cm = extSettings.connectionManager;
                if (cm && Array.isArray(cm.profiles)) {
                    const target = cm.profiles.find(pr => pr?.id === p.id);
                    cm.profiles = cm.profiles.filter(pr => pr?.id !== p.id);
                    if (cm.selectedProfile === p.id) {
                        cm.selectedProfile = '';
                    }
                    if (target) {
                        await safeEmit(ctx, 'CONNECTION_PROFILE_DELETED', target);
                    }
                }
                succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                break;
            }
            case 'tag': {
                if (Array.isArray(ctx?.tags)) {
                    const idx = ctx.tags.findIndex(t => t?.id === p.id);
                    if (idx !== -1) ctx.tags.splice(idx, 1);
                }
                for (const key of Object.keys(tagMap)) {
                    if (Array.isArray(tagMap[key])) {
                        tagMap[key] = tagMap[key].filter(tid => tid !== p.id);
                    }
                }
                succeeded.push({ key: item.key, title: item.title, categoryId: item.categoryId });
                break;
            }
            default:
                break;
        }
    }

    // Strip any deleted regex IDs from `extension_settings.regex_presets` toggle combos
    if (deletedRegexIdsAllScopes.size > 0 && Array.isArray(extSettings.regex_presets)) {
        for (const combo of extSettings.regex_presets) {
            if (!combo || typeof combo !== 'object') continue;
            for (const bucket of ['global', 'scoped', 'preset']) {
                if (Array.isArray(combo[bucket])) {
                    combo[bucket] = combo[bucket].filter(entry => {
                        const id = typeof entry === 'string' ? entry : entry?.id;
                        return !deletedRegexIdsAllScopes.has(String(id));
                    });
                }
            }
        }
    }

    // Unbind deleted characters completely & emit native CHARACTER_DELETED
    for (const rec of deletedCharRecords) {
        const { avatar } = rec;
        const charIdx = characters.findIndex(c => c?.avatar === avatar);
        const charObj = charIdx >= 0 ? characters[charIdx] : { avatar, name: rec.item.payload.name };
        const charName = charObj?.name || stripExt(avatar, '.png');

        if (charIdx >= 0) {
            characters.splice(charIdx, 1);
        }
        delete tagMap[avatar];
        if (extSettings.character_attachments && typeof extSettings.character_attachments === 'object') {
            delete extSettings.character_attachments[avatar];
        }
        if (powerUser.persona_descriptions && typeof powerUser.persona_descriptions === 'object') {
            for (const desc of Object.values(powerUser.persona_descriptions)) {
                if (Array.isArray(desc?.connections)) {
                    desc.connections = desc.connections.filter(conn => {
                        const cid = typeof conn === 'string' ? conn : (conn?.id ?? conn?.avatar);
                        return cid !== avatar && cid !== charName;
                    });
                }
            }
        }
        if (Array.isArray(worldInfo.charLore)) {
            worldInfo.charLore = worldInfo.charLore.filter(entry => entry?.name !== charName && entry?.name !== stripExt(avatar, '.png'));
        }
        // Clean TavernHelper (酒馆助手) character script allowlists
        if (extSettings?.tavern_helper?.script?.enabled && Array.isArray(extSettings.tavern_helper.script.enabled.characters)) {
            extSettings.tavern_helper.script.enabled.characters = extSettings.tavern_helper.script.enabled.characters.filter(
                c => c !== avatar && c !== charName,
            );
        }
        if (extSettings?.tavern_helper?.script?.popuped && Array.isArray(extSettings.tavern_helper.script.popuped.characters)) {
            extSettings.tavern_helper.script.popuped.characters = extSettings.tavern_helper.script.popuped.characters.filter(
                c => c !== avatar && c !== charName,
            );
        }
        if (extSettings?.TavernHelper?.script && Array.isArray(extSettings.TavernHelper.script.characters_with_scripts)) {
            extSettings.TavernHelper.script.characters_with_scripts = extSettings.TavernHelper.script.characters_with_scripts.filter(
                c => c !== avatar && c !== charName,
            );
        }

        // Clean accountStorage / localStorage alert flags
        for (const storage of [ctx?.accountStorage, globalThis.localStorage]) {
            if (!storage || typeof storage.removeItem !== 'function') continue;
            try {
                storage.removeItem(`AlertWI_${avatar}`);
                storage.removeItem(`AlertRegex_${avatar}`);
                storage.removeItem(`mediaWarningShown:${avatar}`);
            } catch {
                // Ignore storage errors
            }
        }

        for (const chatId of rec.pastChatIds) {
            await safeEmit(ctx, 'CHAT_DELETED', chatId);
        }
        await safeEmit(ctx, 'CHARACTER_DELETED', { id: charIdx >= 0 ? charIdx : 0, character: charObj });
    }

    // Unbind deleted groups from ctx.groups
    if (deletedGroupIds.size > 0 && Array.isArray(ctx?.groups)) {
        for (let i = ctx.groups.length - 1; i >= 0; i--) {
            if (deletedGroupIds.has(String(ctx.groups[i]?.id))) {
                ctx.groups.splice(i, 1);
            }
        }
    }

    // Unbind deleted standalone worldbooks across globalSelect, charLore, and personas
    if (deletedWorldNames.size > 0) {
        for (const namesArr of [hostMods?.worldInfo?.world_names, ctx?.worldNames]) {
            if (Array.isArray(namesArr)) {
                for (let i = namesArr.length - 1; i >= 0; i--) {
                    if (deletedWorldNames.has(namesArr[i])) {
                        namesArr.splice(i, 1);
                    }
                }
            }
        }
        for (const arrRef of [hostMods?.worldInfo?.selected_world_info, worldInfo.globalSelect, ctx?.selected_world_info]) {
            if (Array.isArray(arrRef)) {
                for (let i = arrRef.length - 1; i >= 0; i--) {
                    if (deletedWorldNames.has(arrRef[i])) {
                        arrRef.splice(i, 1);
                    }
                }
            }
        }
        if (Array.isArray(worldInfo.charLore)) {
            for (let i = worldInfo.charLore.length - 1; i >= 0; i--) {
                const entry = worldInfo.charLore[i];
                if (Array.isArray(entry?.extraBooks)) {
                    entry.extraBooks = entry.extraBooks.filter(b => !deletedWorldNames.has(b));
                    if (entry.extraBooks.length === 0) {
                        worldInfo.charLore.splice(i, 1);
                    }
                }
            }
        }
        if (powerUser.persona_description_lorebook && deletedWorldNames.has(powerUser.persona_description_lorebook)) {
            powerUser.persona_description_lorebook = '';
        }
        if (powerUser.persona_descriptions && typeof powerUser.persona_descriptions === 'object') {
            for (const desc of Object.values(powerUser.persona_descriptions)) {
                if (desc?.lorebook && deletedWorldNames.has(desc.lorebook)) {
                    desc.lorebook = '';
                }
            }
        }
        for (const wName of deletedWorldNames) {
            try { hostMods?.worldInfo?.worldInfoCache?.delete?.(wName); } catch {}
            await safeEmit(ctx, 'WORLDINFO_UPDATED', wName, null);
        }
        try { await hostMods?.worldInfo?.updateWorldInfoList?.(); } catch {}
    }

    // Unbind deleted presets & emit PRESET_DELETED
    for (const pr of deletedPresets) {
        if (pr.isActive) {
            if (pr.apiId === 'openai' && ctx?.chatCompletionSettings) {
                ctx.chatCompletionSettings.preset_settings_openai = pr.fallbackPresetName || 'Default';
            } else if (powerUser?.[pr.apiId] && typeof powerUser[pr.apiId] === 'object') {
                powerUser[pr.apiId].preset = pr.fallbackPresetName || '';
            }
        }
        if (extSettings?.tavern_helper?.script?.enabled && Array.isArray(extSettings.tavern_helper.script.enabled.presets)) {
            extSettings.tavern_helper.script.enabled.presets = extSettings.tavern_helper.script.enabled.presets.filter(
                n => n !== pr.name,
            );
        }
        if (extSettings?.tavern_helper?.script?.popuped && Array.isArray(extSettings.tavern_helper.script.popuped.presets)) {
            extSettings.tavern_helper.script.popuped.presets = extSettings.tavern_helper.script.popuped.presets.filter(
                n => n !== pr.name,
            );
        }
        await safeEmit(ctx, 'PRESET_DELETED', { apiId: pr.apiId, name: pr.name });
    }

    for (const wf of deletedComfyWorkflows) {
        if (extSettings?.sd && extSettings.sd.comfy_workflow === wf.fileName) {
            extSettings.sd.comfy_workflow = 'Default_Comfy_Workflow.json';
        }
    }

    // Unbind deleted user personas, backgrounds & themes
    for (const per of deletedPersonas) {
        if (powerUser?.personas) delete powerUser.personas[per.avatar];
        if (powerUser?.persona_descriptions) delete powerUser.persona_descriptions[per.avatar];
        if (powerUser?.default_persona === per.avatar) powerUser.default_persona = '';
        if (chatMeta?.persona === per.avatar) delete chatMeta.persona;
    }
    for (const bg of deletedBackgrounds) {
        if (powerUser?.custom_background && String(powerUser.custom_background).includes(bg.bg)) {
            powerUser.custom_background = '';
        }
    }
    for (const th of deletedThemes) {
        if (powerUser?.theme === th.name) {
            powerUser.theme = '';
        }
    }

    // Unbind Quick Replies
    if (deletedQuickReplies.length > 0 && extSettings?.quickReplyV2?.config?.setList) {
        const qrSet = new Set(deletedQuickReplies.map(q => q.name));
        extSettings.quickReplyV2.config.setList = extSettings.quickReplyV2.config.setList.filter(s => {
            const sName = typeof s === 'string' ? s : s?.set;
            return !qrSet.has(sName);
        });
    }

    // Unbind Data Bank attachments
    for (const db of deletedDatabankItems) {
        if (db.scope === 'global' && Array.isArray(extSettings.attachments)) {
            extSettings.attachments = extSettings.attachments.filter(a => a?.url !== db.url);
        } else if (db.scope === 'character' && Array.isArray(extSettings.character_attachments?.[db.ownerKey])) {
            extSettings.character_attachments[db.ownerKey] = extSettings.character_attachments[db.ownerKey].filter(a => a?.url !== db.url);
        } else if (db.scope === 'chat' && Array.isArray(chatMeta?.attachments)) {
            chatMeta.attachments = chatMeta.attachments.filter(a => a?.url !== db.url);
        }
        if (Array.isArray(extSettings.disabled_attachments)) {
            extSettings.disabled_attachments = extSettings.disabled_attachments.filter(u => u !== db.url);
        }
        await safeEmit(ctx, 'FILE_ATTACHMENT_DELETED', db.url);
    }

    // Unbind deleted third-party extensions from disabledExtensions list
    if (deletedExtensions.length > 0 && Array.isArray(extSettings.disabledExtensions)) {
        const extNames = new Set();
        for (const ext of deletedExtensions) {
            extNames.add(ext.rawName);
            extNames.add(`third-party/${ext.extensionName}`);
            extNames.add(ext.extensionName);
        }
        extSettings.disabledExtensions = extSettings.disabledExtensions.filter(n => !extNames.has(n));
    }

    // Single immediate settings flush (never rely solely on unawaited debounce before reload!)
    await flushSaveSettingsImmediate(ctx, params.saveSettingsImmediate, hostMods);

    // Refresh live SillyTavern host lists in-place when reload is not required
    const requiresReload = preview.requiresReload && succeeded.length > 0;
    if (!requiresReload) {
        if (deletedCharRecords.length > 0 || deletedGroupIds.size > 0) {
            try { await hostMods?.script?.getCharacters?.(); } catch {}
        }
        if (deletedPersonas.length > 0) {
            try { await hostMods?.personas?.getUserAvatars?.(true); } catch {}
        }
    }

    // Invalidate affected categories in scanner session cache
    const affectedCategories = [...new Set(
        [...succeeded, ...skipped].map(s => s.categoryId).filter(Boolean),
    )];
    // Also invalidate dependent categories if characters or worldbooks changed
    if (deletedCharRecords.length > 0) {
        affectedCategories.push('characters', 'chats', 'regex', 'worldinfo', 'media');
    }
    if (deletedWorldNames.size > 0) {
        affectedCategories.push('worldinfo', 'characters', 'personas');
    }
    scanner?.invalidateCategories?.([...new Set(affectedCategories)]);

    completedUnits = totalWorkUnits;
    emitProgress(3, '清理完成', '所有数据与引用已安全同步');

    return {
        succeeded,
        skipped,
        failed,
        requiresReload,
        affectedCategories: [...new Set(affectedCategories)],
    };
}

/**
 * Performs an immediate, awaited settings save to disk.
 * Primary path: dynamically imports `saveSettings` from SillyTavern's root `script.js`.
 * Fallback path: calls `ctx.saveSettingsDebounced()` and waits for settle window.
 */
export async function flushSaveSettingsImmediate(ctx, injectedSaveFn, hostMods) {
    if (typeof injectedSaveFn === 'function') {
        await injectedSaveFn();
        return;
    }
    if (typeof ctx?.saveSettings === 'function') {
        await ctx.saveSettings();
        return;
    }
    if (typeof hostMods?.script?.saveSettings === 'function') {
        await hostMods.script.saveSettings();
        return;
    }
    try {
        const scriptUrl = new URL('../../../../script.js', import.meta.url).href;
        const mod = await import(scriptUrl);
        if (typeof mod?.saveSettings === 'function') {
            await mod.saveSettings();
            return;
        }
    } catch {
        // Fallback below when running outside standard third-party path
    }
    if (typeof ctx?.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
        await new Promise(resolve => setTimeout(resolve, 1100));
    }
}
