/**
 * @file ui.js
 * Editorial Pastel SaaS Dashboard UI + Fixed-Height Windowed Virtual List.
 * Pure crisp #FFFFFF canvas, obsidian active sidebar pill, Morandi pastel metric cards,
 * sleek Statistics progress bars, and rounded-square Teal-Mint checkboxes.
 */

import {
    readBootHistory,
    readBootTrend,
    collectStartupSnapshot,
    analyzeTavernHealth,
    formatDuration,
    formatBytes,
} from './profiler.js';
import {
    prewarmSearchIndexTimeSliced,
    parseQueryTerms,
    matchesSearchTerms,
    releasePinyinCache,
} from './pinyin.js';
import {
    CATEGORY_DEFS,
    createScannerSession,
} from './scanner.js';
import {
    buildDeletionPreview,
    executeBatchDelete,
} from './deleter.js';

const GROUP_ROW_HEIGHT = 40;
const ITEM_ROW_HEIGHT = 56;
const GROUP_BOTTOM_GAP = 8;
const OVERSCAN_PX = 280;

const NAME_COLLATOR = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
    ? new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
    : null;

function compareItemNames(aTitle, bTitle) {
    const a = String(aTitle || '');
    const b = String(bTitle || '');
    if (NAME_COLLATOR) return NAME_COLLATOR.compare(a, b);
    return a < b ? -1 : (a > b ? 1 : 0);
}

/**
 * High-speed O(N log N) sorter for category items using precomputed numeric fields
 * and a singleton `Intl.Collator` instance (zero allocations when `sortBy === 'default'`).
 * @param {any[]} items
 * @param {string} sortBy
 * @returns {any[]}
 */
export function sortCategoryItems(items, sortBy = 'default') {
    if (!Array.isArray(items) || items.length <= 1 || !sortBy || sortBy === 'default') {
        return items;
    }
    const copy = items.slice();
    switch (sortBy) {
        case 'cleanable_first': {
            const rankOf = (it) => {
                if (it.isCritical) return 3;
                if (it.isActive) return 2;
                if (it.isCaution) return 1;
                return 0;
            };
            copy.sort((a, b) => (rankOf(a) - rankOf(b)) || ((a.scanOrder || 0) - (b.scanOrder || 0)));
            return copy;
        }
        case 'name_asc':
            copy.sort((a, b) => compareItemNames(a.title, b.title) || ((a.scanOrder || 0) - (b.scanOrder || 0)));
            return copy;
        case 'name_desc':
            copy.sort((a, b) => compareItemNames(b.title, a.title) || ((a.scanOrder || 0) - (b.scanOrder || 0)));
            return copy;
        case 'time_desc':
            copy.sort((a, b) => {
                const ta = a.sortTimeMs || 0;
                const tb = b.sortTimeMs || 0;
                if (ta > 0 && tb > 0 && tb !== ta) return tb - ta;
                if (ta > 0 && tb === 0) return -1;
                if (tb > 0 && ta === 0) return 1;
                return (b.scanOrder || 0) - (a.scanOrder || 0);
            });
            return copy;
        case 'time_asc':
            copy.sort((a, b) => {
                const ta = a.sortTimeMs || 0;
                const tb = b.sortTimeMs || 0;
                if (ta > 0 && tb > 0 && ta !== tb) return ta - tb;
                if (ta > 0 && tb === 0) return -1;
                if (tb > 0 && ta === 0) return 1;
                return (a.scanOrder || 0) - (b.scanOrder || 0);
            });
            return copy;
        case 'metric_desc':
            copy.sort((a, b) => {
                const ma = Number(a.sortMetric) || 0;
                const mb = Number(b.sortMetric) || 0;
                if (mb !== ma) return mb - ma;
                const sa = Number(a.sizeBytes) || 0;
                const sb = Number(b.sizeBytes) || 0;
                if (sb !== sa) return sb - sa;
                return (a.scanOrder || 0) - (b.scanOrder || 0);
            });
            return copy;
        default:
            return items;
    }
}

let activeModalInstance = null;

/**
 * Strict HTML entity escaper for untrusted character/chat/regex/worldbook names.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Reads persisted appearance ('light' | 'dark'), defaulting to crisp Editorial Light Mode.
 * @returns {'dark' | 'light'}
 */
function resolveInitialTheme() {
    try {
        const saved = localStorage.getItem('st_cleaner_theme_v1') || localStorage.getItem('st_delEverything_theme_v1');
        if (saved === 'dark' || saved === 'light') return saved;
    } catch {
        // Ignore storage errors
    }
    return 'light';
}

/**
 * Binary search to find the first virtual row whose bottom edge exceeds `targetY`.
 * @param {Array<{ offsetY: number, height: number }>} rows
 * @param {number} targetY
 * @returns {number}
 */
function findFirstRowAtOffset(rows, targetY) {
    let lo = 0;
    let hi = rows.length - 1;
    let ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const bottom = rows[mid].offsetY + rows[mid].height;
        if (bottom >= targetY) {
            ans = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return ans;
}

/**
 * Opens (or focuses) the ST-Cleaner modal.
 * @param {object} [options]
 * @param {() => any} [options.getContext]
 * @param {typeof fetch} [options.fetchFn]
 * @param {() => Promise<any>} [options.saveSettingsImmediate]
 * @param {string} [options.initialTab] 'overview' | 'workspace'
 * @param {string} [options.initialCategory]
 */
export function openCleanerModal(options = {}) {
    if (activeModalInstance) {
        activeModalInstance.focus();
        return activeModalInstance;
    }

    const scanner = createScannerSession({
        getContext: options.getContext,
        fetchFn: options.fetchFn,
        requestTimeoutMs: options.requestTimeoutMs,
    });

    const getLiveCtx = options.getContext || (() => globalThis.SillyTavern?.getContext?.() || {});

    const SORT_LABELS = {
        default: '默认顺序',
        cleanable_first: '闲置优先',
        name_asc: '名称 A→Z',
        name_desc: '名称 Z→A',
        time_desc: '最新优先',
        time_asc: '最早旧档',
        metric_desc: '体量优先',
    };
    const SORT_OPTIONS = [
        { value: 'default', label: '默认顺序' },
        { value: 'cleanable_first', label: '闲置可删优先' },
        { value: 'name_asc', label: '名称 A → Z' },
        { value: 'name_desc', label: '名称 Z → A' },
        { value: 'time_desc', label: '时间：最新优先' },
        { value: 'time_asc', label: '时间：最早旧档' },
        { value: 'metric_desc', label: '体量 / 条数优先' },
    ];

    let isDisposed = false;
    const state = {
        theme: resolveInitialTheme(),
        activeTab: options.initialTab === 'workspace' ? 'workspace' : 'overview',
        sheetMode: null, // null | 'confirm' | 'filter' | 'cats'
        matchedCount: 0,
        diagTab: 'perf', // 'perf' | 'health' | 'requests'
        isDeepScanning: false,
        deepScanText: '',
        activeCategory: options.initialCategory || 'characters',
        activeSubgroup: 'all',
        activeFacet: 'all',
        sortBy: 'default',
        searchQuery: '',
        skipActive: true,
        isDeleting: false,
        /** @type {Set<string>} */
        selectedKeys: new Set(),
        /** @type {Set<string>} */
        collapsedGroups: new Set(),
        /** @type {Array<any>} */
        flatRows: [],
        totalVirtualHeight: 0,
        lastRenderedRange: [-1, -1],
        scanAbort: null,
        diagAbort: null,
        indexAbort: null,
        searchDebounceTimer: null,
    };

    const catDefMap = new Map(CATEGORY_DEFS.map(c => [c.id, c]));

    // Build root DOM once; virtual list mutates only its ~35-row window
    const root = document.createElement('div');
    root.className = 'st-cleaner-root';
    root.dataset.theme = state.theme;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '数据清理与启动诊断中心');

    root.innerHTML = `
        <div class="st-cleaner-modal">
            <div class="st-cleaner-shell">
                <aside class="st-cleaner-sidebar" aria-label="主导航">
                    <div class="st-cleaner-brand">
                        <span class="st-cleaner-brand-logo"><i class="fa-solid fa-broom"></i></span>
                        <div class="st-cleaner-brand-meta">
                            <span class="st-cleaner-brand-name">ST-Cleaner</span>
                            <span class="st-cleaner-brand-tag">数据清理中心</span>
                        </div>
                    </div>
                    <nav class="st-cleaner-nav-scroll st-cleaner-scroll" data-ref="sidebar"></nav>
                    <div class="st-cleaner-sidebar-promo">
                        <div class="st-cleaner-promo-dot"></div>
                        <div class="st-cleaner-promo-title">安全防呆引擎已就绪</div>
                        <div class="st-cleaner-promo-desc">覆盖 30 类资产与多维标签细分，默认保护活跃项与酒馆核心底座</div>
                    </div>
                </aside>

                <div class="st-cleaner-canvas">
                    <header class="st-cleaner-header">
                        <div class="st-cleaner-header-titles">
                            <div class="st-cleaner-header-title-line">
                                <button type="button" class="st-cleaner-mobile-back" data-action="nav-overview" data-ref="mobile-back" hidden aria-label="返回数据总览">
                                    <i class="fa-solid fa-chevron-left"></i>
                                    <span>总览</span>
                                </button>
                                <h2 class="st-cleaner-page-title" data-ref="page-title">数据总览</h2>
                                <button type="button" class="st-cleaner-mobile-cat-trigger" data-action="open-cat-sheet" data-ref="mobile-cat-trigger" hidden aria-label="切换数据分类">
                                    <span data-ref="mobile-cat-title">分类清理</span>
                                    <span class="st-cleaner-mobile-cat-dot" data-ref="mobile-cat-dot" hidden></span>
                                    <i class="fa-solid fa-chevron-down st-cleaner-mobile-cat-caret"></i>
                                </button>
                            </div>
                            <p class="st-cleaner-page-sub" data-ref="page-sub">查看启动耗时分布与全部 9 大类可清理资产</p>
                        </div>
                        <div class="st-cleaner-top-actions">
                            <button type="button" class="st-cleaner-icon-btn" data-action="header-refresh" title="刷新扫描数据" aria-label="刷新数据">
                                <i class="fa-solid fa-rotate-right"></i>
                            </button>
                            <button type="button" class="st-cleaner-icon-btn" data-action="toggle-theme" data-ref="theme-btn" title="切换浅色 / 深色外观" aria-label="切换浅色或深色外观">
                                <i class="fa-solid ${state.theme === 'dark' ? 'fa-sun' : 'fa-moon'}"></i>
                            </button>
                            <button type="button" class="st-cleaner-icon-btn st-cleaner-close-btn" data-action="close-modal" title="关闭 (Esc)" aria-label="关闭窗口">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </header>

                    <section class="st-cleaner-overview st-cleaner-scroll" data-view="overview">
                        <div class="st-cleaner-bento-grid" data-ref="bento-grid"></div>
                        <div class="st-cleaner-stats-panel" data-ref="boot-card"></div>
                    </section>

                    <section class="st-cleaner-workspace" data-view="workspace" hidden>
                        <div class="st-cleaner-toolbar">
                            <div class="st-cleaner-search-row">
                                <div class="st-cleaner-search-box">
                                    <i class="fa-solid fa-magnifying-glass st-cleaner-search-icon"></i>
                                    <input
                                        type="search"
                                        class="st-cleaner-search-input"
                                        data-ref="search-input"
                                        placeholder="搜索名称 / 全拼 / 首字母..."
                                        autocomplete="off"
                                        spellcheck="false"
                                    />
                                    <button type="button" class="st-cleaner-search-clear" data-action="clear-search" hidden aria-label="清空搜索">
                                        <i class="fa-solid fa-circle-xmark"></i>
                                    </button>
                                </div>
                                <button type="button" class="st-cleaner-mobile-filter-btn" data-action="open-filter-sheet" data-ref="mobile-filter-btn" aria-label="打开筛选与排序面板">
                                    <i class="fa-solid fa-sliders"></i>
                                    <span data-ref="mobile-filter-btn-text">筛选</span>
                                </button>
                                <div class="st-cleaner-sort-wrap" title="切换列表排序规则">
                                    <i class="fa-solid fa-arrow-down-wide-short st-cleaner-sort-icon"></i>
                                    <select class="st-cleaner-sort-select" data-ref="sort-select" aria-label="排序规则">
                                        <option value="default">默认顺序</option>
                                        <option value="cleanable_first">闲置可删优先</option>
                                        <option value="name_asc">名称 A → Z</option>
                                        <option value="name_desc">名称 Z → A</option>
                                        <option value="time_desc">时间：最新优先</option>
                                        <option value="time_asc">时间：最早旧档</option>
                                        <option value="metric_desc">体量 / 条数优先</option>
                                    </select>
                                </div>
                                <div class="st-cleaner-bulk-btns">
                                    <button type="button" class="st-cleaner-btn-ghost" data-action="select-visible">全选结果</button>
                                    <button type="button" class="st-cleaner-btn-ghost is-muted" data-action="deselect-visible">取消本页</button>
                                </div>
                            </div>
                            <div class="st-cleaner-mobile-bar" data-ref="mobile-bar">
                                <button type="button" class="st-cleaner-mobile-summary-chip" data-action="open-filter-sheet" data-ref="mobile-summary-chip">
                                    <span class="st-cleaner-mobile-summary-text" data-ref="mobile-summary-text">全部 · 默认顺序</span>
                                    <i class="fa-solid fa-chevron-down"></i>
                                </button>
                                <div class="st-cleaner-mobile-quick-btns">
                                    <button type="button" class="st-cleaner-btn-ghost" data-action="select-visible">全选</button>
                                    <button type="button" class="st-cleaner-btn-ghost is-muted" data-action="deselect-visible">取消</button>
                                </div>
                            </div>
                            <div class="st-cleaner-subpills" data-ref="subpills"></div>
                            <div class="st-cleaner-facetbar" data-ref="facetbar" hidden></div>
                        </div>

                        <div class="st-cleaner-scan-banner" data-ref="scan-banner" hidden></div>

                        <div class="st-cleaner-vlist-viewport st-cleaner-scroll" data-ref="vlist-viewport">
                            <div class="st-cleaner-vlist-spacer" data-ref="vlist-spacer">
                                <div class="st-cleaner-vlist-window" data-ref="vlist-window"></div>
                            </div>
                            <div class="st-cleaner-empty" data-ref="vlist-empty" hidden></div>
                        </div>
                    </section>

                    <footer class="st-cleaner-footer">
                        <div class="st-cleaner-footer-left">
                            <button type="button" class="st-cleaner-selected-summary" data-action="open-confirm">
                                <span class="st-cleaner-summary-dot"></span>
                                <span data-ref="selected-count-text">已选 0 项</span>
                            </button>
                            <label class="st-cleaner-skip-toggle" title="默认开启：自动跳过当前正在使用的项目与删后会导致酒馆异常的核心底座项">
                                <input type="checkbox" class="st-cleaner-switch-input" data-ref="skip-active-checkbox" checked />
                                <span class="st-cleaner-switch-track" aria-hidden="true"><span class="st-cleaner-switch-thumb"></span></span>
                                <span>跳过活跃与核心底座项</span>
                            </label>
                        </div>
                        <div class="st-cleaner-footer-right">
                            <button type="button" class="st-cleaner-btn-secondary" data-action="clear-all-selected" data-ref="clear-sel-btn" hidden>
                                清空已选
                            </button>
                            <button type="button" class="st-cleaner-primary-btn" data-action="open-confirm" data-ref="delete-btn" disabled>
                                <i class="fa-solid fa-trash-can"></i>
                                <span data-ref="delete-btn-label">清理所选</span>
                            </button>
                        </div>
                    </footer>
                </div>
            </div>

            <div class="st-cleaner-sheet-mask" data-ref="sheet-mask" hidden>
                <div class="st-cleaner-sheet" data-ref="sheet"></div>
            </div>
        </div>
    `;

    const popover = document.createElement('div');
    popover.className = 'st-cleaner-popover';
    popover.hidden = true;

    document.body.appendChild(root);
    document.body.appendChild(popover);

    const refs = {
        pageTitle: root.querySelector('[data-ref="page-title"]'),
        pageSub: root.querySelector('[data-ref="page-sub"]'),
        mobileBack: root.querySelector('[data-ref="mobile-back"]'),
        mobileCatTrigger: root.querySelector('[data-ref="mobile-cat-trigger"]'),
        mobileCatTitle: root.querySelector('[data-ref="mobile-cat-title"]'),
        mobileCatDot: root.querySelector('[data-ref="mobile-cat-dot"]'),
        mobileFilterBtn: root.querySelector('[data-ref="mobile-filter-btn"]'),
        mobileFilterBtnText: root.querySelector('[data-ref="mobile-filter-btn-text"]'),
        mobileSummaryChip: root.querySelector('[data-ref="mobile-summary-chip"]'),
        mobileSummaryText: root.querySelector('[data-ref="mobile-summary-text"]'),
        overviewSection: root.querySelector('[data-view="overview"]'),
        workspaceSection: root.querySelector('[data-view="workspace"]'),
        bootCard: root.querySelector('[data-ref="boot-card"]'),
        bentoGrid: root.querySelector('[data-ref="bento-grid"]'),
        sidebar: root.querySelector('[data-ref="sidebar"]'),
        searchInput: root.querySelector('[data-ref="search-input"]'),
        searchClear: root.querySelector('[data-action="clear-search"]'),
        sortSelect: root.querySelector('[data-ref="sort-select"]'),
        subpills: root.querySelector('[data-ref="subpills"]'),
        facetbar: root.querySelector('[data-ref="facetbar"]'),
        scanBanner: root.querySelector('[data-ref="scan-banner"]'),
        viewport: root.querySelector('[data-ref="vlist-viewport"]'),
        spacer: root.querySelector('[data-ref="vlist-spacer"]'),
        windowEl: root.querySelector('[data-ref="vlist-window"]'),
        emptyEl: root.querySelector('[data-ref="vlist-empty"]'),
        selectedCountText: root.querySelector('[data-ref="selected-count-text"]'),
        skipCheckbox: root.querySelector('[data-ref="skip-active-checkbox"]'),
        clearSelBtn: root.querySelector('[data-ref="clear-sel-btn"]'),
        deleteBtn: root.querySelector('[data-ref="delete-btn"]'),
        deleteBtnLabel: root.querySelector('[data-ref="delete-btn-label"]'),
        sheetMask: root.querySelector('[data-ref="sheet-mask"]'),
        sheet: root.querySelector('[data-ref="sheet"]'),
    };

    function getBootData() {
        const hist = readBootHistory();
        const history = readBootTrend();
        if (hist.currentBoot) return { ...hist, history };
        return {
            currentBoot: collectStartupSnapshot(),
            previousBoot: hist.previousBoot,
            history,
        };
    }

    function countSelectedByCategory() {
        const map = new Map();
        for (const key of state.selectedKeys) {
            const item = scanner.whitelistMap.get(key);
            if (!item) continue;
            map.set(item.categoryId, (map.get(item.categoryId) || 0) + 1);
        }
        return map;
    }

    function updateHeaderTitles() {
        root.dataset.viewMode = state.activeTab;
        if (state.activeTab === 'overview') {
            refs.pageTitle.textContent = '数据总览';
            refs.pageSub.textContent = '按分类浏览酒馆数据资产、酒馆助手脚本与本次启动耗时统计';
            if (refs.mobileBack) refs.mobileBack.hidden = true;
            if (refs.mobileCatTrigger) refs.mobileCatTrigger.hidden = true;
        } else {
            const def = catDefMap.get(state.activeCategory);
            const label = def ? def.label : '分类清理';
            refs.pageTitle.textContent = label;
            refs.pageSub.textContent = def ? def.shortDesc : '勾选不需要的冗余资产进行安全批量清理';
            if (refs.mobileBack) refs.mobileBack.hidden = false;
            if (refs.mobileCatTrigger) refs.mobileCatTrigger.hidden = false;
            if (refs.mobileCatTitle) refs.mobileCatTitle.textContent = label;
        }
    }

    // =========================================================================
    // Persistent Left Sidebar & Mobile Header State
    // =========================================================================
    function renderNavigation() {
        const overviewSummary = scanner.getOverviewSummary();
        const selectedByCat = countSelectedByCategory();
        const totalSelected = state.selectedKeys.size;
        const isOverview = state.activeTab === 'overview';

        const overviewNavHtml = `
            <button
                type="button"
                class="st-cleaner-nav-item ${isOverview ? 'is-active' : ''}"
                data-action="nav-overview"
            >
                <span class="st-cleaner-nav-left">
                    <span class="st-cleaner-nav-icon"><i class="fa-solid fa-table-cells-large"></i></span>
                    <span class="st-cleaner-nav-label">数据总览</span>
                </span>
                <span class="st-cleaner-nav-right">
                    ${totalSelected > 0 ? `<span class="st-cleaner-nav-badge">${totalSelected}</span>` : ''}
                </span>
            </button>
            <div class="st-cleaner-nav-group-label">分类管理</div>
        `;

        const catItemsHtml = CATEGORY_DEFS.map(def => {
            const isActive = !isOverview && def.id === state.activeCategory;
            const info = overviewSummary[def.id];
            const selCount = selectedByCat.get(def.id) || 0;
            const hasCount = info?.count !== null && info?.count !== undefined;
            const countLabel = hasCount ? info.count : '';

            return `
                <button
                    type="button"
                    class="st-cleaner-nav-item ${isActive ? 'is-active' : ''}"
                    data-action="select-category"
                    data-cat="${escapeHtml(def.id)}"
                >
                    <span class="st-cleaner-nav-left">
                        <span class="st-cleaner-nav-icon"><i class="${escapeHtml(def.icon)}"></i></span>
                        <span class="st-cleaner-nav-label">${escapeHtml(def.label)}</span>
                    </span>
                    <span class="st-cleaner-nav-right">
                        ${selCount > 0
                            ? `<span class="st-cleaner-nav-badge">${selCount}</span>`
                            : (countLabel !== '' ? `<span class="st-cleaner-nav-count">${escapeHtml(countLabel)}</span>` : '')}
                    </span>
                </button>
            `;
        }).join('');

        refs.sidebar.innerHTML = overviewNavHtml + catItemsHtml;

        if (refs.mobileCatDot) {
            const otherCatSelected = totalSelected - (selectedByCat.get(state.activeCategory) || 0);
            refs.mobileCatDot.hidden = otherCatSelected <= 0;
        }
    }

    // =========================================================================
    // View 1: Morandi Pastel Metric Cards + Multi-Dimensional Diagnostics Center
    // =========================================================================
    function renderOverview() {
        const { currentBoot, previousBoot, history } = getBootData();
        const overviewSummary = scanner.getOverviewSummary();
        const selectedByCat = countSelectedByCategory();
        const buckets = Array.isArray(currentBoot?.buckets) ? currentBoot.buckets : [];
        const bucketMap = new Map(buckets.map(b => [b.id, b]));
        const health = analyzeTavernHealth({
            ctx: getLiveCtx(),
            bootSnapshot: currentBoot,
            cachedCategories: scanner.getAllCachedCategories(),
        });

        // 1. 9-Tile Low-Saturation Morandi Pastel Bento Cards
        refs.bentoGrid.innerHTML = CATEGORY_DEFS.map(def => {
            const info = overviewSummary[def.id] || { badgeText: '待扫描' };
            const selCount = selectedByCat.get(def.id) || 0;
            const bootBucket = def.bootBucketKey ? bucketMap.get(def.bootBucketKey) : null;
            const slowNote = bootBucket && bootBucket.durationMs >= 120
                ? ` · 启动 ${formatDuration(bootBucket.durationMs)}`
                : '';
            const rawCount = String(info.badgeText || '').replace(/\s*项$/, '');
            const isNumeric = /^\d+\+?$/.test(rawCount);

            return `
                <button
                    type="button"
                    class="st-cleaner-bento-tile"
                    data-pastel="${escapeHtml(def.id)}"
                    data-action="jump-category"
                    data-cat="${escapeHtml(def.id)}"
                    data-sub="all"
                >
                    <div class="st-cleaner-tile-top">
                        <span class="st-cleaner-tile-icon"><i class="${escapeHtml(def.icon)}"></i></span>
                        <div class="st-cleaner-tile-metric">
                            ${selCount > 0 ? `<span class="st-cleaner-nav-badge">已选 ${selCount}</span>` : ''}
                            <span class="${isNumeric ? 'st-cleaner-tile-bignum' : 'st-cleaner-tile-scanpill'}">${escapeHtml(rawCount || '浏览')}</span>
                        </div>
                    </div>
                    <div class="st-cleaner-tile-bottom">
                        <div class="st-cleaner-tile-title-row">
                            <span class="st-cleaner-tile-title">${escapeHtml(def.label)}</span>
                            <i class="fa-solid fa-arrow-right st-cleaner-tile-arrow"></i>
                        </div>
                        <div class="st-cleaner-tile-desc">${escapeHtml(def.shortDesc)}${escapeHtml(slowNote)}</div>
                    </div>
                </button>
            `;
        }).join('');

        // 2. Multi-Dimensional Startup & Health Diagnostics Panel
        const totalMs = currentBoot?.totalMs || 0;
        let deltaHtml = '<span class="st-cleaner-boot-delta is-neutral">首次诊断基线</span>';
        if (previousBoot && previousBoot.totalMs > 0 && totalMs > 0) {
            const diff = totalMs - previousBoot.totalMs;
            if (Math.abs(diff) < 30) {
                deltaHtml = `<span class="st-cleaner-boot-delta is-neutral">与上次持平 (${formatDuration(previousBoot.totalMs)})</span>`;
            } else if (diff < 0) {
                deltaHtml = `<span class="st-cleaner-boot-delta is-faster">提速 ${formatDuration(Math.abs(diff))}</span>`;
            } else {
                deltaHtml = `<span class="st-cleaner-boot-delta is-slower">+${formatDuration(diff)}</span>`;
            }
        }

        const gradeTone = health.grade === 'A'
            ? 'is-grade-a'
            : (health.grade === 'B' ? 'is-grade-b' : 'is-grade-c');

        const actionableCount = health.findings.filter(f => f.level !== 'good').length;

        let bodyHtml = '';
        if (state.diagTab === 'perf') {
            const phases = currentBoot?.phases || {};
            const sumBucketMs = Math.max(1, totalMs || buckets.reduce((acc, b) => acc + (b.durationMs || 0), 0));
            const sortedBuckets = [...buckets].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
            const topBars = sortedBuckets.slice(0, 4);

            const historyChip = Array.isArray(history) && history.length >= 2
                ? `<span class="st-cleaner-phase-pill">近 ${history.length} 次均值: <strong>${escapeHtml(formatDuration(Math.round(history.reduce((s, x) => s + (x.totalMs || 0), 0) / history.length)))}</strong></span>`
                : '';

            const phasePillsHtml = `
                <div class="st-cleaner-phase-strip">
                    <span class="st-cleaner-phase-pill">首字节 TTFB: <strong>${escapeHtml(formatDuration(phases.ttfbMs || 0))}</strong></span>
                    <span class="st-cleaner-phase-pill">DOM 就绪: <strong>${escapeHtml(formatDuration(phases.domReadyMs || 0))}</strong></span>
                    <span class="st-cleaner-phase-pill">资源传输: <strong>${escapeHtml(formatBytes(currentBoot?.totalBytes || 0))}</strong> (${phases.requestCount || 0} 请求)</span>
                    <span class="st-cleaner-phase-pill">懒加载: <strong>${health.telemetry.lazyLoadEnabled ? `已启用 (${health.telemetry.shallowCount}/${health.telemetry.charCount})` : '未启用/全量'}</strong></span>
                    ${historyChip}
                </div>
            `;

            const statBarsHtml = topBars.map((b, idx) => {
                const dur = b.durationMs || 0;
                const pct = dur > 0 ? Math.min(100, Math.max(6, Math.round((dur / sumBucketMs) * 100))) : 4;
                const barTone = idx % 2 === 1 ? 'is-emerald' : 'is-obsidian';
                return `
                    <button
                        type="button"
                        class="st-cleaner-stat-item st-cleaner-stat-clickable"
                        data-action="jump-category"
                        data-cat="${escapeHtml(b.targetCategory)}"
                        data-sub="${escapeHtml(b.targetSub || 'all')}"
                        title="点击前往「${escapeHtml(b.label)}」对应分类清理"
                    >
                        <div class="st-cleaner-stat-row">
                            <span class="st-cleaner-stat-label">${escapeHtml(b.label)}</span>
                            <span class="st-cleaner-stat-val">
                                <strong>${escapeHtml(formatDuration(dur))}</strong>
                                <em>/ ${escapeHtml(formatBytes(b.bytes || 0))}</em>
                            </span>
                        </div>
                        <div class="st-cleaner-stat-track">
                            <div class="st-cleaner-stat-fill ${barTone}" style="width:${pct}%"></div>
                        </div>
                    </button>
                `;
            }).join('');

            bodyHtml = `${phasePillsHtml}<div class="st-cleaner-stat-bars">${statBarsHtml}</div>`;
        } else if (state.diagTab === 'health') {
            const tel = health.telemetry;
            const heapStr = tel.jsHeapUsedBytes > 0 ? formatBytes(tel.jsHeapUsedBytes) : '浏览器未开放';
            const telHtml = `
                <div class="st-cleaner-phase-strip">
                    <span class="st-cleaner-phase-pill">角色库规模: <strong>${tel.charCount} 张</strong></span>
                    <span class="st-cleaner-phase-pill">实时生效正则: <strong>${tel.activeRegexCount} 条</strong></span>
                    <span class="st-cleaner-phase-pill">已停用脚本: <strong>${tel.disabledRegexCount} 条</strong></span>
                    <span class="st-cleaner-phase-pill">JS 堆内存: <strong>${escapeHtml(heapStr)}</strong></span>
                </div>
            `;
            const findingsHtml = health.findings.map(f => {
                const dotCls = f.level === 'warn' ? 'is-warn' : (f.level === 'good' ? 'is-good' : 'is-info');
                const btnHtml = f.targetCategory
                    ? `<button
                        type="button"
                        class="st-cleaner-finding-btn"
                        data-action="jump-finding"
                        data-cat="${escapeHtml(f.targetCategory)}"
                        data-sub="${escapeHtml(f.targetSub || 'all')}"
                        data-facet="${escapeHtml(f.targetFacet || 'all')}"
                       >${escapeHtml(f.actionLabel || '前往处理')} <i class="fa-solid fa-arrow-right"></i></button>`
                    : '';
                return `
                    <div class="st-cleaner-finding-row">
                        <span class="st-cleaner-finding-dot ${dotCls}"></span>
                        <div class="st-cleaner-finding-texts">
                            <div class="st-cleaner-finding-title">${escapeHtml(f.title)}</div>
                            <div class="st-cleaner-finding-detail">${escapeHtml(f.detail)}</div>
                        </div>
                        ${btnHtml}
                    </div>
                `;
            }).join('');

            bodyHtml = `${telHtml}<div class="st-cleaner-finding-list">${findingsHtml}</div>`;
        } else {
            const slowest = Array.isArray(currentBoot?.slowestResources) ? currentBoot.slowestResources : [];
            const slowestHtml = slowest.length > 0
                ? `
                    <div class="st-cleaner-subhead-mini">首屏最慢单项请求 Top ${Math.min(4, slowest.length)}</div>
                    ${slowest.slice(0, 4).map(r => `
                        <div class="st-cleaner-api-row is-compact">
                            <div class="st-cleaner-api-info">
                                <div class="st-cleaner-api-name">${escapeHtml(r.shortName)}</div>
                                <div class="st-cleaner-api-meta">传输 ${escapeHtml(formatBytes(r.bytes || 0))}</div>
                            </div>
                            <div class="st-cleaner-api-right">
                                <strong>${escapeHtml(formatDuration(r.durationMs))}</strong>
                            </div>
                        </div>
                    `).join('')}
                    <div class="st-cleaner-subhead-mini" style="margin-top:4px">各模块接口归类汇总</div>
                `
                : '';

            const detailRowsHtml = buckets.map(b => `
                <div class="st-cleaner-api-row is-compact">
                    <div class="st-cleaner-api-info">
                        <div class="st-cleaner-api-name">${escapeHtml(b.label)}</div>
                        <div class="st-cleaner-api-meta">${b.count || 0} 次请求 · 传输 ${escapeHtml(formatBytes(b.bytes || 0))}</div>
                    </div>
                    <div class="st-cleaner-api-right">
                        <strong>${escapeHtml(formatDuration(b.durationMs))}</strong>
                        <button
                            type="button"
                            class="st-cleaner-link-btn"
                            data-action="jump-category"
                            data-cat="${escapeHtml(b.targetCategory)}"
                            data-sub="${escapeHtml(b.targetSub || 'all')}"
                        >
                            去清理 <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            bodyHtml = `<div class="st-cleaner-boot-detail is-flat">${slowestHtml}${detailRowsHtml}</div>`;
        }

        const deepBtnLabel = state.isDeepScanning
            ? `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(state.deepScanText || '体检中...')}`
            : `<i class="fa-solid fa-stethoscope"></i> ${health.isDeepScanned ? '重新深度体检' : '一键深度体检'}`;

        refs.bootCard.innerHTML = `
            <div class="st-cleaner-stats-head">
                <div class="st-cleaner-stats-title-group">
                    <span class="st-cleaner-health-pill ${gradeTone}" title="综合启动速度、角色懒加载、生效正则数量与冗余资产评估">
                        健康度 ${escapeHtml(health.grade)} · ${health.score}分 (${escapeHtml(health.statusLabel)})
                    </span>
                    <span class="st-cleaner-stats-heading">启动 ${escapeHtml(formatDuration(totalMs))}</span>
                    ${deltaHtml}
                </div>
                <div class="st-cleaner-diag-controls">
                    <div class="st-cleaner-diag-tabs" role="tablist">
                        <button type="button" class="st-cleaner-diag-tab ${state.diagTab === 'perf' ? 'is-active' : ''}" data-action="select-diag-tab" data-dtab="perf">启动性能</button>
                        <button type="button" class="st-cleaner-diag-tab ${state.diagTab === 'health' ? 'is-active' : ''}" data-action="select-diag-tab" data-dtab="health">
                            健康建议${actionableCount > 0 ? ` <em>${actionableCount}</em>` : ''}
                        </button>
                        <button type="button" class="st-cleaner-diag-tab ${state.diagTab === 'requests' ? 'is-active' : ''}" data-action="select-diag-tab" data-dtab="requests">慢请求明细</button>
                    </div>
                    <button type="button" class="st-cleaner-deep-btn" data-action="run-deep-diag" ${state.isDeepScanning ? 'disabled' : ''}>
                        ${deepBtnLabel}
                    </button>
                </div>
            </div>
            ${bodyHtml}
        `;
    }

    // =========================================================================
    // View 2: Subpills + Facet Bar + Fixed-Height Windowed Virtual List
    // =========================================================================
    function renderSubpills(categoryRecord) {
        if (!categoryRecord) {
            refs.subpills.innerHTML = '';
            refs.facetbar.hidden = true;
            refs.facetbar.innerHTML = '';
            return;
        }
        const groups = categoryRecord.groups || [];
        const allCount = categoryRecord.totalCount || 0;
        const pills = [
            `<button type="button" class="st-cleaner-subpill ${state.activeSubgroup === 'all' ? 'is-active' : ''}" data-action="select-subgroup" data-sub="all">全部 (${allCount})</button>`,
        ];
        for (const g of groups) {
            const isAct = state.activeSubgroup === g.id;
            pills.push(
                `<button type="button" class="st-cleaner-subpill ${isAct ? 'is-active' : ''}" data-action="select-subgroup" data-sub="${escapeHtml(g.id)}">${escapeHtml(g.label)} (${g.items.length})</button>`,
            );
        }
        refs.subpills.innerHTML = pills.join('');
        renderFacets(categoryRecord);
    }

    function computeVisibleFacets(categoryRecord) {
        if (!categoryRecord || !Array.isArray(categoryRecord.facets) || categoryRecord.facets.length === 0) {
            return [];
        }
        const scopedCounts = new Map();
        for (const g of categoryRecord.groups || []) {
            if (state.activeSubgroup !== 'all' && g.id !== state.activeSubgroup) continue;
            for (const item of g.items) {
                if (!Array.isArray(item.facets)) continue;
                for (const fid of item.facets) {
                    scopedCounts.set(fid, (scopedCounts.get(fid) || 0) + 1);
                }
            }
        }
        return categoryRecord.facets
            .map(f => ({ ...f, scopedCount: scopedCounts.get(f.id) || 0 }))
            .filter(f => f.scopedCount > 0);
    }

    function updateMobileToolbarSummary(categoryRecord) {
        const activeFilters = (state.activeSubgroup !== 'all' ? 1 : 0)
            + (state.activeFacet !== 'all' ? 1 : 0)
            + (state.sortBy !== 'default' ? 1 : 0);

        if (refs.mobileFilterBtn && refs.mobileFilterBtnText) {
            refs.mobileFilterBtn.classList.toggle('is-active', activeFilters > 0);
            refs.mobileFilterBtnText.textContent = activeFilters > 0 ? `筛选 · ${activeFilters}` : '筛选';
        }

        if (refs.mobileSummaryText && refs.mobileSummaryChip) {
            const groups = categoryRecord?.groups || [];
            const subObj = state.activeSubgroup !== 'all'
                ? groups.find(g => g.id === state.activeSubgroup)
                : null;
            const subLabel = subObj ? subObj.label : '全部';

            let facetLabel = '';
            if (state.activeFacet !== 'all' && Array.isArray(categoryRecord?.facets)) {
                const fObj = categoryRecord.facets.find(f => f.id === state.activeFacet);
                if (fObj) facetLabel = fObj.label;
            }

            const sortLabel = SORT_LABELS[state.sortBy] || '默认顺序';
            const parts = [subLabel];
            if (facetLabel) parts.push(facetLabel);
            parts.push(sortLabel);
            refs.mobileSummaryText.textContent = `${parts.join(' · ')} (${state.matchedCount})`;
            refs.mobileSummaryChip.classList.toggle('has-active-filter', activeFilters > 0);
        }
    }

    function renderFacets(categoryRecord) {
        const visibleFacets = computeVisibleFacets(categoryRecord);
        if (visibleFacets.length === 0) {
            state.activeFacet = 'all';
            refs.facetbar.hidden = true;
            refs.facetbar.innerHTML = '';
            return;
        }

        if (state.activeFacet !== 'all' && !visibleFacets.some(f => f.id === state.activeFacet)) {
            state.activeFacet = 'all';
        }

        const html = [
            `<span class="st-cleaner-facet-label"><i class="fa-solid fa-sliders"></i> 细分</span>`,
            `<button type="button" class="st-cleaner-facetpill ${state.activeFacet === 'all' ? 'is-active' : ''}" data-action="select-facet" data-facet="all">不限</button>`,
        ];

        for (const f of visibleFacets) {
            const isAct = state.activeFacet === f.id;
            const toneCls = f.tone ? `is-tone-${f.tone}` : '';
            html.push(
                `<button type="button" class="st-cleaner-facetpill ${toneCls} ${isAct ? 'is-active' : ''}" data-action="select-facet" data-facet="${escapeHtml(f.id)}">${escapeHtml(f.label)} <em>${f.scopedCount}</em></button>`,
            );
        }

        refs.facetbar.innerHTML = html.join('');
        refs.facetbar.hidden = false;
    }

    /**
     * Recomputes flat virtual rows (`flatRows`) for the active category, subgroup, facet & search terms.
     */
    function rebuildVirtualRows(categoryRecord) {
        state.flatRows = [];
        state.totalVirtualHeight = 0;
        state.lastRenderedRange = [-1, -1];

        if (!categoryRecord) {
            refs.spacer.style.height = '0px';
            refs.windowEl.innerHTML = '';
            return;
        }

        const terms = parseQueryTerms(state.searchQuery);
        const facetFilter = state.activeFacet;
        let offsetY = 4;
        let matchedItemCount = 0;

        for (const group of categoryRecord.groups || []) {
            if (state.activeSubgroup !== 'all' && group.id !== state.activeSubgroup) {
                continue;
            }
            const matchedItems = group.items.filter(item => {
                if (facetFilter !== 'all' && (!Array.isArray(item.facets) || !item.facets.includes(facetFilter))) {
                    return false;
                }
                if (terms.length > 0 && !matchesSearchTerms(item, terms)) {
                    return false;
                }
                return true;
            });

            if (matchedItems.length === 0) continue;
            const filteredItems = sortCategoryItems(matchedItems, state.sortBy);
            matchedItemCount += filteredItems.length;

            const collapseKey = `${categoryRecord.categoryId}::${group.id}`;
            const isCollapsed = state.collapsedGroups.has(collapseKey);

            state.flatRows.push({
                type: 'group',
                collapseKey,
                groupId: group.id,
                label: group.label,
                items: filteredItems,
                isCollapsed,
                offsetY,
                height: GROUP_ROW_HEIGHT,
            });
            offsetY += GROUP_ROW_HEIGHT;

            if (!isCollapsed) {
                for (let i = 0; i < filteredItems.length; i++) {
                    state.flatRows.push({
                        type: 'item',
                        item: filteredItems[i],
                        isFirst: i === 0,
                        isLast: i === filteredItems.length - 1,
                        offsetY,
                        height: ITEM_ROW_HEIGHT,
                    });
                    offsetY += ITEM_ROW_HEIGHT;
                }
            }
            offsetY += GROUP_BOTTOM_GAP;
        }

        state.matchedCount = matchedItemCount;
        state.totalVirtualHeight = offsetY + 8;
        refs.spacer.style.height = `${state.totalVirtualHeight}px`;
        updateMobileToolbarSummary(categoryRecord);

        if (matchedItemCount === 0) {
            refs.spacer.hidden = true;
            refs.emptyEl.hidden = false;
            const warnHtml = categoryRecord.warnings?.length
                ? `<div class="st-cleaner-empty-warn">${escapeHtml(categoryRecord.warnings.join(' '))}</div>`
                : '';
            refs.emptyEl.innerHTML = `
                <div class="st-cleaner-empty-icon"><i class="fa-regular fa-folder-open"></i></div>
                <div class="st-cleaner-empty-title">${terms.length > 0 ? '未找到匹配搜索条件的数据项' : '当前分类暂无可清理数据'}</div>
                ${warnHtml}
            `;
            refs.windowEl.innerHTML = '';
        } else {
            refs.spacer.hidden = false;
            refs.emptyEl.hidden = true;
            renderVisibleVirtualWindow(true);
        }
    }

    /**
     * Renders ONLY the visible slice of `state.flatRows` inside `.st-cleaner-vlist-window`.
     */
    function renderVisibleVirtualWindow(force = false) {
        const rows = state.flatRows;
        if (rows.length === 0) {
            refs.windowEl.innerHTML = '';
            return;
        }

        const scrollTop = refs.viewport.scrollTop;
        const viewportH = refs.viewport.clientHeight || 520;
        const minY = Math.max(0, scrollTop - OVERSCAN_PX);
        const maxY = scrollTop + viewportH + OVERSCAN_PX;

        const startIdx = findFirstRowAtOffset(rows, minY);
        let endIdx = startIdx;
        while (endIdx < rows.length && rows[endIdx].offsetY <= maxY) {
            endIdx++;
        }

        if (
            !force
            && state.lastRenderedRange[0] === startIdx
            && state.lastRenderedRange[1] === endIdx
        ) {
            return;
        }
        state.lastRenderedRange = [startIdx, endIdx];

        const baseOffsetY = rows[startIdx]?.offsetY || 0;
        refs.windowEl.style.transform = `translateY(${baseOffsetY}px)`;

        const htmlChunks = [];
        for (let i = startIdx; i < endIdx; i++) {
            const row = rows[i];
            if (row.type === 'group') {
                const selectablePool = state.skipActive
                    ? row.items.filter(it => !it.isActive && !it.isCritical)
                    : row.items;
                const anyCheckedInGroup = row.items.some(it => state.selectedKeys.has(it.key));
                const allGroupSelected = selectablePool.length > 0
                    ? selectablePool.every(it => state.selectedKeys.has(it.key))
                    : anyCheckedInGroup;
                const isAllProtected = state.skipActive && selectablePool.length === 0 && !anyCheckedInGroup;

                htmlChunks.push(`
                    <div class="st-cleaner-vgroup-row" data-row-idx="${i}">
                        <div class="st-cleaner-vgroup-title" data-action="toggle-collapse" data-collapse-key="${escapeHtml(row.collapseKey)}">
                            <i class="fa-solid fa-chevron-${row.isCollapsed ? 'right' : 'down'}"></i>
                            <span class="st-cleaner-vgroup-name">${escapeHtml(row.label)}</span>
                            <span class="st-cleaner-vgroup-count">${row.items.length}</span>
                        </div>
                        <button type="button" class="st-cleaner-vgroup-btn" data-action="toggle-group-select" data-row-idx="${i}" ${isAllProtected ? 'disabled' : ''}>
                            ${isAllProtected ? '均受保护' : (allGroupSelected ? '取消本组' : '全选本组')}
                        </button>
                    </div>
                `);
            } else {
                const item = row.item;
                const checked = state.selectedKeys.has(item.key);
                const badgesHtml = (item.badges || []).slice(0, 3).map(b => {
                    let cls = 'st-cleaner-badge-muted';
                    switch (b.type) {
                        case 'active': cls = 'st-cleaner-badge-active'; break;
                        case 'critical': cls = 'st-cleaner-badge-critical'; break;
                        case 'fav': cls = 'st-cleaner-badge-fav'; break;
                        case 'warn': cls = 'st-cleaner-badge-warn'; break;
                        case 'tag': cls = 'st-cleaner-badge-tag'; break;
                        case 'info': cls = 'st-cleaner-badge-info'; break;
                        case 'user': cls = 'st-cleaner-badge-user'; break;
                        case 'builtin': cls = 'st-cleaner-badge-builtin'; break;
                        default: cls = 'st-cleaner-badge-muted'; break;
                    }
                    return `<span class="st-cleaner-badge ${cls}">${escapeHtml(b.text)}</span>`;
                }).join('');

                htmlChunks.push(`
                    <div
                        class="st-cleaner-vitem-row ${row.isFirst ? 'is-group-first' : ''} ${row.isLast ? 'is-group-last' : ''} ${checked ? 'is-checked' : ''} ${item.isCritical ? 'is-critical' : ''}"
                        data-action="toggle-item"
                        data-key="${escapeHtml(item.key)}"
                    >
                        <span class="st-cleaner-check"><i class="fa-solid fa-check"></i></span>
                        <div class="st-cleaner-item-texts">
                            <span class="st-cleaner-item-title">${escapeHtml(item.title)}</span>
                            <span class="st-cleaner-item-sub">${escapeHtml(item.subtitle || '')}</span>
                        </div>
                        <div class="st-cleaner-item-right">
                            ${badgesHtml}
                            <button
                                type="button"
                                class="st-cleaner-more-btn"
                                data-action="show-item-popover"
                                data-key="${escapeHtml(item.key)}"
                                title="查看完整名称与详情"
                                aria-label="查看详情"
                            >
                                <i class="fa-solid fa-ellipsis"></i>
                            </button>
                        </div>
                    </div>
                `);
            }
        }

        refs.windowEl.innerHTML = htmlChunks.join('');
    }

    function updateFooterBar() {
        const preview = buildDeletionPreview(state.selectedKeys, scanner, {
            skipActive: state.skipActive,
        });
        const rawTotal = state.selectedKeys.size;
        const execCount = preview.validItems.length;
        const skippedCount = preview.skippedActiveItems.length;

        if (rawTotal === 0) {
            refs.selectedCountText.textContent = '已选 0 项';
        } else if (skippedCount > 0) {
            refs.selectedCountText.textContent = `已选 ${rawTotal} 项（可执行 ${execCount} · 保护 ${skippedCount}）`;
        } else {
            refs.selectedCountText.textContent = `已选 ${execCount} 项`;
        }

        refs.selectedCountText.parentElement?.classList.toggle('has-selection', rawTotal > 0);
        if (refs.clearSelBtn) {
            refs.clearSelBtn.hidden = rawTotal === 0 || state.isDeleting;
        }
        refs.deleteBtn.disabled = execCount === 0 || state.isDeleting;
        refs.deleteBtnLabel.textContent = execCount > 0 ? `清理所选 (${execCount})` : '清理所选';
    }

    // =========================================================================
    // Category Loading & Time-Sliced Pinyin Index Warming
    // =========================================================================
    let currentCategoryRecord = null;

    async function loadActiveCategory(force = false) {
        if (state.scanAbort) state.scanAbort.abort();
        if (state.indexAbort) state.indexAbort.abort();

        const scanController = new AbortController();
        state.scanAbort = scanController;

        refs.scanBanner.hidden = false;
        refs.scanBanner.innerHTML = `<span><i class="fa-solid fa-spinner fa-spin"></i> 正在扫描分类数据...</span>`;

        try {
            const record = await scanner.scanCategory(state.activeCategory, {
                force,
                signal: scanController.signal,
                onProgress: (msg) => {
                    if (!scanController.signal.aborted) {
                        refs.scanBanner.innerHTML = `<span><i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(msg)}</span>`;
                    }
                },
            });

            if (scanController.signal.aborted) return;
            currentCategoryRecord = record;
            refs.scanBanner.hidden = true;

            renderNavigation();
            renderSubpills(record);
            rebuildVirtualRows(record);
            updateFooterBar();
            if (state.activeTab === 'overview') {
                renderOverview();
            }

            // Prewarm Pinyin search index in <= 6ms background slices
            const allCatItems = record.groups.flatMap(g => g.items);
            const idxController = new AbortController();
            state.indexAbort = idxController;
            prewarmSearchIndexTimeSliced(allCatItems, { signal: idxController.signal }).catch(() => {});
        } catch (err) {
            if (err?.name === 'AbortError') return;
            refs.scanBanner.hidden = false;
            refs.scanBanner.innerHTML = `<span>扫描出现异常: ${escapeHtml(err?.message || '未知错误')}</span>`;
        }
    }

    function switchTab(nextTab) {
        hidePopover();
        state.activeTab = nextTab === 'workspace' ? 'workspace' : 'overview';
        updateHeaderTitles();
        renderNavigation();

        if (state.activeTab === 'overview') {
            refs.overviewSection.hidden = false;
            refs.workspaceSection.hidden = true;
            renderOverview();
        } else {
            refs.overviewSection.hidden = true;
            refs.workspaceSection.hidden = false;
            loadActiveCategory(false);
        }
    }

    function selectCategoryAndOpen(catId, subId = 'all', facetId = 'all') {
        state.activeCategory = catId;
        state.activeSubgroup = subId || 'all';
        state.activeFacet = facetId || 'all';
        refs.viewport.scrollTop = 0;
        if (state.activeTab !== 'workspace') {
            switchTab('workspace');
        } else {
            updateHeaderTitles();
            renderNavigation();
            loadActiveCategory(false);
        }
    }

    async function runDeepDiagnostics() {
        if (state.isDeepScanning) return;
        if (state.diagAbort) state.diagAbort.abort();
        const ctrl = new AbortController();
        state.diagAbort = ctrl;
        state.isDeepScanning = true;
        state.diagTab = 'health';
        state.deepScanText = '准备深度体检...';
        renderOverview();

        try {
            await scanner.runDeepHealthScan({
                signal: ctrl.signal,
                onProgress: (msg) => {
                    if (!ctrl.signal.aborted) {
                        state.deepScanText = msg.replace(/^正在深度体检\s*/, '体检 ');
                        if (state.activeTab === 'overview') renderOverview();
                    }
                },
            });
        } catch {
            // Aborted or partial error; render whatever was collected
        } finally {
            if (state.diagAbort === ctrl) {
                state.isDeepScanning = false;
                state.deepScanText = '';
                state.diagAbort = null;
                renderNavigation();
                if (state.activeTab === 'overview') renderOverview();
            }
        }
    }

    // =========================================================================
    // Popover for 500-char Ultra-Long Names & Critical Safety Details
    // =========================================================================
    function showItemPopover(key, anchorEl) {
        const item = scanner.whitelistMap.get(key);
        if (!item || !anchorEl) return;

        const badgesText = (item.badges || []).map(b => b.text).join(' · ');
        const critHtml = item.isCritical && item.criticalReason
            ? `<div class="st-cleaner-pop-crit">⚠️ 重点保护：${escapeHtml(item.criticalReason)}</div>`
            : '';
        popover.innerHTML = `
            <div class="st-cleaner-pop-title">${escapeHtml(item.title)}</div>
            <div class="st-cleaner-pop-sub">${escapeHtml(item.subtitle || '无附加描述')}</div>
            ${critHtml}
            ${badgesText ? `<div class="st-cleaner-pop-meta">标记：${escapeHtml(badgesText)}</div>` : ''}
        `;
        popover.hidden = false;

        const rect = anchorEl.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = Math.min(vw - popRect.width - 12, Math.max(12, rect.right - popRect.width));
        let top = rect.bottom + 6;
        if (top + popRect.height > vh - 12) {
            top = Math.max(12, rect.top - popRect.height - 6);
        }
        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    function hidePopover() {
        popover.hidden = true;
    }

    // =========================================================================
    // Mobile Native-Grade Bottom Sheets: 1) Category Grid Switcher, 2) Filter & Sort
    // =========================================================================
    function openCategorySwitcherSheet() {
        hidePopover();
        state.sheetMode = 'cats';
        const overviewSummary = scanner.getOverviewSummary();
        const selectedByCat = countSelectedByCategory();
        const totalSelected = state.selectedKeys.size;

        const gridHtml = CATEGORY_DEFS.map(def => {
            const isAct = state.activeTab === 'workspace' && def.id === state.activeCategory;
            const info = overviewSummary[def.id];
            const selCount = selectedByCat.get(def.id) || 0;
            const countLabel = info?.count !== null && info?.count !== undefined ? info.count : '浏览';
            return `
                <button
                    type="button"
                    class="st-cleaner-mcat-card ${isAct ? 'is-active' : ''}"
                    data-action="pick-mobile-cat"
                    data-cat="${escapeHtml(def.id)}"
                >
                    <div class="st-cleaner-mcat-top">
                        <span class="st-cleaner-mcat-icon"><i class="${escapeHtml(def.icon)}"></i></span>
                        <span class="st-cleaner-mcat-meta">
                            ${selCount > 0 ? `<span class="st-cleaner-nav-badge">${selCount}</span>` : ''}
                            <span class="st-cleaner-mcat-count">${escapeHtml(countLabel)}</span>
                        </span>
                    </div>
                    <div class="st-cleaner-mcat-name">${escapeHtml(def.label)}</div>
                </button>
            `;
        }).join('');

        refs.sheet.innerHTML = `
            <div class="st-cleaner-sheet-head">
                <div>
                    <div class="st-cleaner-sheet-title">切换数据分类</div>
                    <div class="st-cleaner-sheet-sub">9 大类完整展示 · 点击即切换</div>
                </div>
                <button type="button" class="st-cleaner-icon-btn" data-action="close-sheet" aria-label="关闭分类菜单">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="st-cleaner-sheet-body st-cleaner-scroll">
                <button type="button" class="st-cleaner-mcat-overview" data-action="pick-mobile-overview">
                    <span class="st-cleaner-mcat-ov-left">
                        <i class="fa-solid fa-table-cells-large"></i>
                        <span>返回数据总览与启动体检</span>
                    </span>
                    <span class="st-cleaner-mcat-ov-right">
                        ${totalSelected > 0 ? `<span class="st-cleaner-nav-badge">已选 ${totalSelected}</span>` : ''}
                        <i class="fa-solid fa-chevron-right"></i>
                    </span>
                </button>
                <div class="st-cleaner-mcat-grid">
                    ${gridHtml}
                </div>
            </div>
        `;
        refs.sheetMask.hidden = false;
    }

    function renderFilterSortSheetContent() {
        const record = currentCategoryRecord;
        const groups = record?.groups || [];
        const allCount = record?.totalCount || 0;
        const visibleFacets = computeVisibleFacets(record);
        const isDefaultAll = state.activeSubgroup === 'all' && state.activeFacet === 'all' && state.sortBy === 'default';

        const subPillsHtml = [
            `<button type="button" class="st-cleaner-mfilter-pill ${state.activeSubgroup === 'all' ? 'is-active' : ''}" data-action="sheet-sub" data-sub="all">全部 <em>${allCount}</em></button>`,
            ...groups.map(g => {
                const isAct = state.activeSubgroup === g.id;
                return `<button type="button" class="st-cleaner-mfilter-pill ${isAct ? 'is-active' : ''}" data-action="sheet-sub" data-sub="${escapeHtml(g.id)}">${escapeHtml(g.label)} <em>${g.items.length}</em></button>`;
            }),
        ].join('');

        const facetSectionHtml = visibleFacets.length > 0
            ? `
                <div class="st-cleaner-mfilter-sec">
                    <div class="st-cleaner-mfilter-title">细分标签与状态</div>
                    <div class="st-cleaner-mfilter-wrap">
                        <button type="button" class="st-cleaner-mfilter-pill ${state.activeFacet === 'all' ? 'is-active' : ''}" data-action="sheet-facet" data-facet="all">不限</button>
                        ${visibleFacets.map(f => {
                            const isAct = state.activeFacet === f.id;
                            const toneCls = f.tone ? `is-tone-${f.tone}` : '';
                            return `<button type="button" class="st-cleaner-mfilter-pill ${toneCls} ${isAct ? 'is-active' : ''}" data-action="sheet-facet" data-facet="${escapeHtml(f.id)}">${escapeHtml(f.label)} <em>${f.scopedCount}</em></button>`;
                        }).join('')}
                    </div>
                </div>
            `
            : '';

        const sortGridHtml = SORT_OPTIONS.map(opt => {
            const isAct = state.sortBy === opt.value;
            return `
                <button type="button" class="st-cleaner-msort-opt ${isAct ? 'is-active' : ''}" data-action="sheet-sort" data-sort="${escapeHtml(opt.value)}">
                    <span>${escapeHtml(opt.label)}</span>
                    ${isAct ? '<i class="fa-solid fa-check"></i>' : ''}
                </button>
            `;
        }).join('');

        refs.sheet.innerHTML = `
            <div class="st-cleaner-sheet-head">
                <div>
                    <div class="st-cleaner-sheet-title">筛选与排序</div>
                    <div class="st-cleaner-sheet-sub">全部筛选项完整平铺 · 点击实时生效</div>
                </div>
                <button type="button" class="st-cleaner-icon-btn" data-action="close-sheet" aria-label="关闭筛选面板">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="st-cleaner-sheet-body st-cleaner-scroll">
                <div class="st-cleaner-mfilter-sec">
                    <div class="st-cleaner-mfilter-title">数据子分类</div>
                    <div class="st-cleaner-mfilter-wrap">
                        ${subPillsHtml}
                    </div>
                </div>
                ${facetSectionHtml}
                <div class="st-cleaner-mfilter-sec">
                    <div class="st-cleaner-mfilter-title">列表排序方式</div>
                    <div class="st-cleaner-msort-grid">
                        ${sortGridHtml}
                    </div>
                </div>
            </div>
            <div class="st-cleaner-sheet-foot">
                <button type="button" class="st-cleaner-btn-secondary" data-action="reset-mobile-filter" ${isDefaultAll ? 'disabled' : ''}>重置默认</button>
                <button type="button" class="st-cleaner-primary-btn st-cleaner-mfilter-apply" data-action="close-sheet">
                    查看 ${state.matchedCount} 项结果
                </button>
            </div>
        `;
    }

    function openFilterSortSheet() {
        hidePopover();
        state.sheetMode = 'filter';
        renderFilterSortSheetContent();
        refs.sheetMask.hidden = false;
    }

    // =========================================================================
    // Confirmation Dialog -> 3-Stage Smooth Progress -> Completion Report
    // =========================================================================
    function openConfirmationSheet() {
        hidePopover();
        state.sheetMode = 'confirm';
        const preview = buildDeletionPreview(state.selectedKeys, scanner, {
            skipActive: state.skipActive,
        });

        if (preview.validItems.length === 0 && preview.skippedActiveItems.length === 0) {
            return;
        }

        const catLabelMap = new Map(CATEGORY_DEFS.map(c => [c.id, c.label]));
        const subLabelMap = new Map(
            CATEGORY_DEFS.flatMap(c => c.subgroups.map(s => [`${c.id}::${s.id}`, `${c.label} · ${s.label}`])),
        );

        const warnings = [];
        if (preview.skippedActiveItems.length > 0) {
            const activeSkipped = preview.skippedActiveItems.filter(i => i.isActive).length;
            const critSkipped = preview.skippedActiveItems.length - activeSkipped;
            const skipDetail = [
                activeSkipped > 0 ? `${activeSkipped} 项正在使用` : '',
                critSkipped > 0 ? `${critSkipped} 项酒馆核心底座` : '',
            ].filter(Boolean).join('、');
            warnings.push(`已开启安全保护：自动跳过 ${preview.skippedActiveItems.length} 项（${skipDetail}）。`);
        }
        if (preview.requiresReload) {
            warnings.push('所选项目中包含当前启用资源或核心组件，清理并落盘完成后将提示刷新页面。');
        }
        if (preview.boundWorldbooks.length > 0) {
            warnings.push(`包含 ${preview.boundWorldbooks.length} 本已绑定独立世界书，删除后将自动解绑角色、全局与人设引用。`);
        }
        if (preview.builtinItems?.length > 0) {
            warnings.push(`包含 ${preview.builtinItems.length} 项酒馆官方初始模板/资产，受酒馆 content.log 机制影响，删除后重启不会自动恢复。`);
        }

        const criticalBoxHtml = preview.criticalItems?.length > 0
            ? `
                <div class="st-cleaner-danger-box">
                    <div class="st-cleaner-danger-head">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>重点高危预警：已勾选 ${preview.criticalItems.length} 项酒馆核心底座！</span>
                    </div>
                    <div class="st-cleaner-danger-desc">以下项目删空后重启酒馆不会自动恢复，可能导致对应功能面板报错、无默认回退或角色卡前端/脚本大面积失效：</div>
                    <div class="st-cleaner-danger-list">
                        ${preview.criticalItems.slice(0, 6).map(ci => `
                            <div class="st-cleaner-danger-item">
                                <strong>${escapeHtml(ci.title)}</strong>
                                <span>— ${escapeHtml(ci.criticalReason || '酒馆核心底座项，强烈建议保留')}</span>
                            </div>
                        `).join('')}
                        ${preview.criticalItems.length > 6 ? `<div class="st-cleaner-danger-item">…及其他 ${preview.criticalItems.length - 6} 项核心底座</div>` : ''}
                    </div>
                </div>
            `
            : '';

        const coalescedParts = [];
        if (preview.coalescedStats.charWritebacks > 0) {
            coalescedParts.push(`${preview.coalescedStats.charWritebacks} 次角色合并写回`);
        }
        if (preview.coalescedStats.presetWritebacks > 0) {
            coalescedParts.push(`${preview.coalescedStats.presetWritebacks} 次预设合并写回`);
        }
        if (preview.coalescedStats.groupWritebacks > 0) {
            coalescedParts.push(`${preview.coalescedStats.groupWritebacks} 次群组同步写回`);
        }

        const groupCardsHtml = preview.groupedList.map(g => {
            const headerTitle = subLabelMap.get(`${g.categoryId}::${g.subgroupId}`)
                || catLabelMap.get(g.categoryId)
                || g.categoryId;
            const sampleNames = g.items.slice(0, 5).map(i => escapeHtml(i.title)).join('、');
            const moreSuffix = g.items.length > 5 ? ` 等共 ${g.items.length} 项` : '';
            return `
                <div class="st-cleaner-confirm-group">
                    <div class="st-cleaner-confirm-group-head">
                        <span>${escapeHtml(headerTitle)}</span>
                        <span class="st-cleaner-badge st-cleaner-badge-muted">${g.items.length} 项</span>
                    </div>
                    <div class="st-cleaner-confirm-sample">${sampleNames}${moreSuffix}</div>
                </div>
            `;
        }).join('');

        refs.sheet.innerHTML = `
            <div class="st-cleaner-sheet-head">
                <div>
                    <div class="st-cleaner-sheet-title">确认清理清单（共 ${preview.validItems.length} 项）</div>
                    <div class="st-cleaner-sheet-sub">永久删除前请核对以下分类汇总</div>
                </div>
                <button type="button" class="st-cleaner-icon-btn" data-action="close-sheet" aria-label="关闭确认面板">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="st-cleaner-sheet-body st-cleaner-scroll">
                ${criticalBoxHtml}
                ${warnings.length > 0 ? `<div class="st-cleaner-warn-box">${warnings.map(w => `<div>• ${escapeHtml(w)}</div>`).join('')}</div>` : ''}
                ${coalescedParts.length > 0 ? `<div class="st-cleaner-coalesce-note"><i class="fa-solid fa-bolt"></i> 高速同源合并写回：内嵌脚本与世界书仅需 ${escapeHtml(coalescedParts.join(' + '))}</div>` : ''}
                ${groupCardsHtml || '<div class="st-cleaner-empty-inline">当前无可执行的非保护项目（已选项目均受到活跃或核心底座防呆保护）。</div>'}
            </div>
            <div class="st-cleaner-sheet-foot">
                <button type="button" class="st-cleaner-btn-ghost is-danger" data-action="clear-all-selected" style="margin-right:auto">清空已选</button>
                <button type="button" class="st-cleaner-btn-secondary" data-action="close-sheet">取消</button>
                <button type="button" class="st-cleaner-danger-btn" data-action="confirm-execute-delete" ${preview.validItems.length === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-trash-can"></i> 确认永久删除 (${preview.validItems.length})
                </button>
            </div>
        `;
        refs.sheetMask.hidden = false;
    }

    async function runDeletionWithProgress() {
        if (state.isDeleting) return;
        state.isDeleting = true;
        updateFooterBar();

        refs.sheet.innerHTML = `
            <div class="st-cleaner-sheet-head">
                <span class="st-cleaner-sheet-title">正在高速安全清理...</span>
                <span class="st-cleaner-nav-badge" data-ref="prog-pct">0%</span>
            </div>
            <div class="st-cleaner-sheet-body">
                <div class="st-cleaner-progress-bar-wrap">
                    <div class="st-cleaner-progress-bar-fill" data-ref="prog-bar" style="width:4%"></div>
                </div>
                <div class="st-cleaner-stage-list">
                    <div class="st-cleaner-stage-item is-running" data-stage-row="1">
                        <span>1. 独立文件并发删除池 (5 路并发)</span>
                        <span data-stage-status="1">执行中</span>
                    </div>
                    <div class="st-cleaner-stage-item" data-stage-row="2">
                        <span>2. 角色 / 预设 / 群组同源合并写回</span>
                        <span data-stage-status="2">等待中</span>
                    </div>
                    <div class="st-cleaner-stage-item" data-stage-row="3">
                        <span>3. 引用精确解绑与设置立即落盘</span>
                        <span data-stage-status="3">等待中</span>
                    </div>
                </div>
                <div class="st-cleaner-current-op" data-ref="prog-op">正在校验白名单...</div>
            </div>
        `;

        const pctEl = refs.sheet.querySelector('[data-ref="prog-pct"]');
        const barEl = refs.sheet.querySelector('[data-ref="prog-bar"]');
        const opEl = refs.sheet.querySelector('[data-ref="prog-op"]');
        const stageRows = {
            1: refs.sheet.querySelector('[data-stage-row="1"]'),
            2: refs.sheet.querySelector('[data-stage-row="2"]'),
            3: refs.sheet.querySelector('[data-stage-row="3"]'),
        };
        const stageStatuses = {
            1: refs.sheet.querySelector('[data-stage-status="1"]'),
            2: refs.sheet.querySelector('[data-stage-status="2"]'),
            3: refs.sheet.querySelector('[data-stage-status="3"]'),
        };

        let report;
        try {
            report = await executeBatchDelete({
                selectedKeys: state.selectedKeys,
                scanner,
                skipActive: state.skipActive,
                getContext: options.getContext,
                fetchFn: options.fetchFn,
                saveSettingsImmediate: options.saveSettingsImmediate,
                requestTimeoutMs: options.requestTimeoutMs,
                onProgress: (prog) => {
                    if (pctEl) pctEl.textContent = `${prog.percent}%`;
                    if (barEl) barEl.style.width = `${Math.max(4, prog.percent)}%`;
                    if (opEl) opEl.textContent = `${prog.stageLabel} · ${prog.currentTitle} (${prog.completed}/${prog.total})`;

                    for (const s of [1, 2, 3]) {
                        const row = stageRows[s];
                        const st = stageStatuses[s];
                        if (!row || !st) continue;
                        row.classList.remove('is-running', 'is-done');
                        if (s < prog.stage || prog.percent === 100) {
                            row.classList.add('is-done');
                            st.textContent = '已完成 ✓';
                        } else if (s === prog.stage) {
                            row.classList.add('is-running');
                            st.textContent = '执行中...';
                        } else {
                            st.textContent = '等待中';
                        }
                    }
                },
            });
        } catch (err) {
            report = {
                succeeded: [],
                skipped: [],
                failed: [{
                    key: '__fatal__',
                    title: '清理任务异常中断',
                    reason: err?.message || '未知宿主异常',
                }],
                requiresReload: false,
                affectedCategories: [],
            };
        } finally {
            state.isDeleting = false;
        }

        for (const item of report.succeeded) {
            state.selectedKeys.delete(item.key);
        }
        for (const item of report.skipped) {
            if (item.reason.includes('磁盘文件已不存在')) {
                state.selectedKeys.delete(item.key);
            }
        }

        const failedHtml = report.failed.length > 0
            ? `<div class="st-cleaner-warn-box">
                <div style="font-weight:600;margin-bottom:4px">部分项目未删除 (${report.failed.length} 项)：</div>
                ${report.failed.slice(0, 8).map(f => `<div>• ${escapeHtml(f.title)}：${escapeHtml(f.reason)}</div>`).join('')}
               </div>`
            : '';

        refs.sheet.innerHTML = `
            <div class="st-cleaner-sheet-head">
                <span class="st-cleaner-sheet-title">清理执行完毕</span>
                <span class="st-cleaner-badge st-cleaner-badge-active">已完成落盘</span>
            </div>
            <div class="st-cleaner-sheet-body st-cleaner-scroll">
                <div class="st-cleaner-confirm-group">
                    <div class="st-cleaner-confirm-group-head">
                        <span>本次清理统计</span>
                    </div>
                    <div class="st-cleaner-confirm-sample">
                        成功删除 <strong>${report.succeeded.length}</strong> 项 · 保护/跳过 <strong>${report.skipped.length}</strong> 项 · 失败拦截 <strong>${report.failed.length}</strong> 项
                    </div>
                </div>
                ${failedHtml}
                ${report.requiresReload ? '<div class="st-cleaner-warn-box">已清理当前正在使用的活跃项并完成设置持久化，建议立即刷新页面同步酒馆界面状态。</div>' : ''}
            </div>
            <div class="st-cleaner-sheet-foot">
                <button type="button" class="st-cleaner-btn-secondary" data-action="finish-report">继续管理</button>
                ${report.requiresReload ? '<button type="button" class="st-cleaner-primary-btn" data-action="reload-page"><i class="fa-solid fa-rotate-right"></i> 立即刷新页面</button>' : ''}
            </div>
        `;

        await scanner.warmOverviewMetadata().catch(() => {});
        renderOverview();
        renderNavigation();
        if (state.activeTab === 'workspace') {
            await loadActiveCategory(true);
        } else {
            updateFooterBar();
        }
    }

    // =========================================================================
    // Event Delegation & Lifecycle Management
    // =========================================================================
    refs.viewport.addEventListener('scroll', () => {
        hidePopover();
        renderVisibleVirtualWindow(false);
    }, { passive: true });

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
            if (state.activeTab === 'workspace') {
                renderVisibleVirtualWindow(true);
            }
        });
        resizeObserver.observe(refs.viewport);
    }

    refs.searchInput.addEventListener('input', () => {
        const val = refs.searchInput.value || '';
        refs.searchClear.hidden = val.length === 0;
        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
            state.searchQuery = val;
            refs.viewport.scrollTop = 0;
            rebuildVirtualRows(currentCategoryRecord);
        }, 120);
    });

    refs.sortSelect.addEventListener('change', () => {
        state.sortBy = refs.sortSelect.value || 'default';
        refs.viewport.scrollTop = 0;
        rebuildVirtualRows(currentCategoryRecord);
    });

    refs.skipCheckbox.addEventListener('change', () => {
        state.skipActive = Boolean(refs.skipCheckbox.checked);
        renderVisibleVirtualWindow(true);
        updateFooterBar();
    });

    root.addEventListener('click', (ev) => {
        const target = ev.target instanceof Element ? ev.target : null;
        if (!target) return;

        if (!target.closest('[data-action="show-item-popover"]')) {
            hidePopover();
        }

        if (target === root && !state.isDeleting) {
            closeModal();
            return;
        }
        if (target === refs.sheetMask && !state.isDeleting) {
            refs.sheetMask.hidden = true;
            state.sheetMode = null;
            return;
        }

        const actionEl = target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;

        switch (action) {
            case 'close-modal':
                if (!state.isDeleting) closeModal();
                break;

            case 'open-cat-sheet':
                if (!state.isDeleting) openCategorySwitcherSheet();
                break;

            case 'pick-mobile-overview':
                refs.sheetMask.hidden = true;
                state.sheetMode = null;
                if (state.activeTab !== 'overview') switchTab('overview');
                break;

            case 'pick-mobile-cat':
                refs.sheetMask.hidden = true;
                state.sheetMode = null;
                if (actionEl.dataset.cat) {
                    selectCategoryAndOpen(actionEl.dataset.cat, 'all', 'all');
                }
                break;

            case 'open-filter-sheet':
                if (!state.isDeleting && currentCategoryRecord) {
                    openFilterSortSheet();
                }
                break;

            case 'sheet-sub':
                state.activeSubgroup = actionEl.dataset.sub || 'all';
                refs.viewport.scrollTop = 0;
                renderSubpills(currentCategoryRecord);
                rebuildVirtualRows(currentCategoryRecord);
                renderFilterSortSheetContent();
                break;

            case 'sheet-facet':
                state.activeFacet = actionEl.dataset.facet || 'all';
                refs.viewport.scrollTop = 0;
                renderFacets(currentCategoryRecord);
                rebuildVirtualRows(currentCategoryRecord);
                renderFilterSortSheetContent();
                break;

            case 'sheet-sort':
                state.sortBy = actionEl.dataset.sort || 'default';
                if (refs.sortSelect) refs.sortSelect.value = state.sortBy;
                refs.viewport.scrollTop = 0;
                rebuildVirtualRows(currentCategoryRecord);
                renderFilterSortSheetContent();
                break;

            case 'reset-mobile-filter':
                state.activeSubgroup = 'all';
                state.activeFacet = 'all';
                state.sortBy = 'default';
                if (refs.sortSelect) refs.sortSelect.value = 'default';
                refs.viewport.scrollTop = 0;
                renderSubpills(currentCategoryRecord);
                rebuildVirtualRows(currentCategoryRecord);
                renderFilterSortSheetContent();
                break;

            case 'toggle-theme': {
                state.theme = state.theme === 'dark' ? 'light' : 'dark';
                root.dataset.theme = state.theme;
                try {
                    localStorage.setItem('st_cleaner_theme_v1', state.theme);
                } catch {
                    // Ignore storage errors
                }
                const iconEl = actionEl.querySelector('i');
                if (iconEl) {
                    iconEl.className = `fa-solid ${state.theme === 'dark' ? 'fa-sun' : 'fa-moon'}`;
                }
                break;
            }

            case 'nav-overview':
                if (state.activeTab !== 'overview') {
                    switchTab('overview');
                }
                break;

            case 'header-refresh':
                if (state.activeTab === 'overview') {
                    scanner.warmOverviewMetadata().then(() => {
                        renderOverview();
                        renderNavigation();
                    }).catch(() => {});
                } else {
                    loadActiveCategory(true);
                }
                break;

            case 'select-diag-tab':
                state.diagTab = actionEl.dataset.dtab || 'perf';
                renderOverview();
                break;

            case 'run-deep-diag':
                runDeepDiagnostics();
                break;

            case 'jump-finding':
                selectCategoryAndOpen(
                    actionEl.dataset.cat || 'characters',
                    actionEl.dataset.sub || 'all',
                    actionEl.dataset.facet || 'all',
                );
                break;

            case 'jump-category':
                selectCategoryAndOpen(actionEl.dataset.cat || 'characters', actionEl.dataset.sub || 'all');
                break;

            case 'select-category':
                if (actionEl.dataset.cat) {
                    selectCategoryAndOpen(actionEl.dataset.cat, 'all');
                }
                break;

            case 'select-subgroup':
                state.activeSubgroup = actionEl.dataset.sub || 'all';
                refs.viewport.scrollTop = 0;
                renderSubpills(currentCategoryRecord);
                rebuildVirtualRows(currentCategoryRecord);
                break;

            case 'select-facet':
                state.activeFacet = actionEl.dataset.facet || 'all';
                refs.viewport.scrollTop = 0;
                renderFacets(currentCategoryRecord);
                rebuildVirtualRows(currentCategoryRecord);
                break;

            case 'clear-search':
                refs.searchInput.value = '';
                refs.searchClear.hidden = true;
                state.searchQuery = '';
                refs.viewport.scrollTop = 0;
                rebuildVirtualRows(currentCategoryRecord);
                break;

            case 'rescan-category':
                loadActiveCategory(true);
                break;

            case 'select-visible': {
                for (const row of state.flatRows) {
                    if (row.type === 'group') {
                        for (const item of row.items) {
                            if (state.skipActive && (item.isActive || item.isCritical)) continue;
                            state.selectedKeys.add(item.key);
                        }
                    }
                }
                renderVisibleVirtualWindow(true);
                renderNavigation();
                updateFooterBar();
                break;
            }

            case 'deselect-visible': {
                for (const row of state.flatRows) {
                    if (row.type === 'group') {
                        for (const item of row.items) {
                            state.selectedKeys.delete(item.key);
                        }
                    }
                }
                renderVisibleVirtualWindow(true);
                renderNavigation();
                updateFooterBar();
                break;
            }

            case 'toggle-collapse': {
                const cKey = actionEl.dataset.collapseKey;
                if (!cKey) break;
                if (state.collapsedGroups.has(cKey)) {
                    state.collapsedGroups.delete(cKey);
                } else {
                    state.collapsedGroups.add(cKey);
                }
                rebuildVirtualRows(currentCategoryRecord);
                break;
            }

            case 'toggle-group-select': {
                const idx = Number(actionEl.dataset.rowIdx);
                const row = state.flatRows[idx];
                if (!row || row.type !== 'group') break;
                const selectable = state.skipActive
                    ? row.items.filter(it => !it.isActive && !it.isCritical)
                    : row.items;
                const anyChecked = row.items.some(it => state.selectedKeys.has(it.key));
                if (selectable.length === 0) {
                    if (anyChecked) {
                        for (const it of row.items) state.selectedKeys.delete(it.key);
                    }
                } else {
                    const allChecked = selectable.every(it => state.selectedKeys.has(it.key));
                    if (allChecked) {
                        for (const it of row.items) state.selectedKeys.delete(it.key);
                    } else {
                        for (const it of selectable) state.selectedKeys.add(it.key);
                    }
                }
                renderVisibleVirtualWindow(true);
                renderNavigation();
                updateFooterBar();
                break;
            }

            case 'show-item-popover':
                ev.stopPropagation();
                showItemPopover(actionEl.dataset.key, actionEl);
                break;

            case 'toggle-item': {
                const key = actionEl.dataset.key;
                if (!key) break;
                if (state.selectedKeys.has(key)) {
                    state.selectedKeys.delete(key);
                    actionEl.classList.remove('is-checked');
                } else {
                    state.selectedKeys.add(key);
                    actionEl.classList.add('is-checked');
                }
                renderVisibleVirtualWindow(true);
                renderNavigation();
                updateFooterBar();
                break;
            }

            case 'open-confirm':
                if (!state.isDeleting && state.selectedKeys.size > 0) {
                    openConfirmationSheet();
                }
                break;

            case 'close-sheet':
            case 'finish-report':
                if (!state.isDeleting) {
                    refs.sheetMask.hidden = true;
                    state.sheetMode = null;
                }
                break;

            case 'clear-all-selected':
                state.selectedKeys.clear();
                refs.sheetMask.hidden = true;
                renderVisibleVirtualWindow(true);
                renderNavigation();
                if (state.activeTab === 'overview') renderOverview();
                updateFooterBar();
                break;

            case 'confirm-execute-delete':
                runDeletionWithProgress();
                break;

            case 'reload-page':
                window.location.reload();
                break;

            default:
                break;
        }
    });

    function onKeyDown(ev) {
        if (ev.key === 'Escape' && !state.isDeleting) {
            if (!popover.hidden) {
                hidePopover();
            } else if (!refs.sheetMask.hidden) {
                refs.sheetMask.hidden = true;
            } else {
                closeModal();
            }
        }
    }
    document.addEventListener('keydown', onKeyDown);

    function closeModal() {
        isDisposed = true;
        if (state.scanAbort) state.scanAbort.abort();
        if (state.diagAbort) state.diagAbort.abort();
        if (state.indexAbort) state.indexAbort.abort();
        clearTimeout(state.searchDebounceTimer);
        resizeObserver?.disconnect();
        document.removeEventListener('keydown', onKeyDown);
        scanner.dispose();
        releasePinyinCache();
        state.selectedKeys.clear();
        state.flatRows = [];
        popover.remove();
        root.remove();
        activeModalInstance = null;
    }

    // Initial render + non-blocking metadata warm
    switchTab(state.activeTab);
    scanner.warmOverviewMetadata().then(() => {
        if (!isDisposed) {
            renderNavigation();
            if (state.activeTab === 'overview') {
                renderOverview();
            }
        }
    }).catch(() => {});

    activeModalInstance = {
        close: closeModal,
        focus: () => root.focus?.(),
        getState: () => state,
    };
    return activeModalInstance;
}
