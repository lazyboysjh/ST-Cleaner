/**
 * @fileoverview Lightweight zero-dependency Chinese Pinyin fuzzy search engine.
 * Decodes all 3,755 GB2312 Level-1 characters via standard W3C TextDecoder('gbk')
 * plus Level-2 roleplay character supplements. Caps per-item Pinyin conversion at 64 chars
 * and supports 6ms frame-budget time-sliced indexing so 10,000+ items never block UI.
 */

export const MAX_PINYIN_CHARS = 64;

/** @type {Array<[string, string]>} Exact GB2312-80 Level-1 syllable start anchors */
const GB2312_SYLLABLE_STARTS = [
  ['a', '啊'], ['ai', '埃'], ['an', '鞍'], ['ang', '肮'], ['ao', '凹'],
  ['ba', '芭'], ['bai', '白'], ['ban', '斑'], ['bang', '邦'], ['bao', '苞'], ['bei', '杯'], ['ben', '奔'], ['beng', '崩'], ['bi', '逼'], ['bian', '鞭'], ['biao', '标'], ['bie', '鳖'], ['bin', '彬'], ['bing', '兵'], ['bo', '玻'], ['bu', '捕'],
  ['ca', '擦'], ['cai', '猜'], ['can', '餐'], ['cang', '苍'], ['cao', '操'], ['ce', '厕'], ['ceng', '层'], ['cha', '插'], ['chai', '拆'], ['chan', '搀'], ['chang', '昌'], ['chao', '超'], ['che', '车'], ['chen', '郴'], ['cheng', '撑'], ['chi', '吃'], ['chong', '充'], ['chou', '抽'], ['chu', '初'], ['chuai', '揣'], ['chuan', '川'], ['chuang', '疮'], ['chui', '吹'], ['chun', '春'], ['chuo', '戳'], ['ci', '疵'], ['cong', '囱'], ['cou', '凑'], ['cu', '粗'], ['cuan', '蹿'], ['cui', '崔'], ['cun', '村'], ['cuo', '撮'],
  ['da', '搭'], ['dai', '呆'], ['dan', '耽'], ['dang', '当'], ['dao', '刀'], ['de', '德'], ['deng', '蹬'], ['di', '堤'], ['dian', '颠'], ['diao', '碉'], ['die', '跌'], ['ding', '盯'], ['diu', '丢'], ['dong', '东'], ['dou', '兜'], ['du', '都'], ['duan', '端'], ['dui', '堆'], ['dun', '墩'], ['duo', '哆'],
  ['e', '蛾'], ['en', '恩'], ['er', '而'],
  ['fa', '发'], ['fan', '藩'], ['fang', '坊'], ['fei', '啡'], ['fen', '芬'], ['feng', '丰'], ['fo', '佛'], ['fou', '否'], ['fu', '夫'],
  ['ga', '噶'], ['gai', '该'], ['gan', '干'], ['gang', '冈'], ['gao', '篙'], ['ge', '哥'], ['gei', '给'], ['gen', '根'], ['geng', '耕'], ['gong', '工'], ['gou', '勾'], ['gu', '估'], ['gua', '刮'], ['guai', '乖'], ['guan', '棺'], ['guang', '光'], ['gui', '瑰'], ['gun', '辊'], ['guo', '锅'],
  ['ha', '哈'], ['hai', '骸'], ['han', '酣'], ['hang', '夯'], ['hao', '壕'], ['he', '呵'], ['hei', '黑'], ['hen', '痕'], ['heng', '哼'], ['hong', '哄'], ['hou', '喉'], ['hu', '呼'], ['hua', '花'], ['huai', '徊'], ['huan', '欢'], ['huang', '荒'], ['hui', '灰'], ['hun', '荤'], ['huo', '豁'],
  ['ji', '击'], ['jia', '家'], ['jian', '艰'], ['jiang', '浆'], ['jiao', '胶'], ['jie', '揭'], ['jin', '巾'], ['jing', '荆'], ['jiong', '炯'], ['jiu', '揪'], ['ju', '疽'], ['juan', '捐'], ['jue', '撅'], ['jun', '钧'],
  ['ka', '喀'], ['kai', '开'], ['kan', '刊'], ['kang', '慷'], ['kao', '考'], ['ke', '柯'], ['ken', '肯'], ['keng', '坑'], ['kong', '空'], ['kou', '抠'], ['ku', '枯'], ['kua', '夸'], ['kuai', '块'], ['kuan', '宽'], ['kuang', '匡'], ['kui', '亏'], ['kun', '坤'], ['kuo', '括'],
  ['la', '垃'], ['lai', '莱'], ['lan', '蓝'], ['lang', '琅'], ['lao', '捞'], ['le', '勒'], ['lei', '雷'], ['leng', '棱'], ['li', '璃'], ['lia', '俩'], ['lian', '联'], ['liang', '粮'], ['liao', '撩'], ['lie', '列'], ['lin', '琳'], ['ling', '拎'], ['liu', '溜'], ['long', '窿'], ['lou', '楼'], ['lu', '芦'], ['lv', '驴'], ['luan', '挛'], ['lue', '掠'], ['lun', '抡'], ['luo', '螺'],
  ['ma', '妈'], ['mai', '埋'], ['man', '瞒'], ['mang', '盲'], ['mao', '猫'], ['me', '么'], ['mei', '玫'], ['men', '门'], ['meng', '檬'], ['mi', '眯'], ['mian', '棉'], ['miao', '苗'], ['mie', '蔑'], ['min', '民'], ['ming', '明'], ['miu', '谬'], ['mo', '摸'], ['mou', '谋'], ['mu', '姆'],
  ['na', '拿'], ['nai', '氖'], ['nan', '南'], ['nang', '囊'], ['nao', '挠'], ['ne', '呢'], ['nei', '馁'], ['nen', '嫩'], ['neng', '能'], ['ni', '妮'], ['nian', '蔫'], ['niang', '娘'], ['niao', '鸟'], ['nie', '捏'], ['nin', '您'], ['ning', '柠'], ['niu', '牛'], ['nong', '浓'], ['nu', '奴'], ['nv', '女'], ['nuan', '暖'], ['nue', '虐'], ['nuo', '挪'],
  ['o', '哦'], ['ou', '欧'],
  ['pa', '啪'], ['pai', '徘'], ['pan', '攀'], ['pang', '乓'], ['pao', '抛'], ['pei', '呸'], ['pen', '喷'], ['peng', '砰'], ['pi', '霹'], ['pian', '篇'], ['piao', '飘'], ['pie', '撇'], ['pin', '拼'], ['ping', '乒'], ['po', '坡'], ['pou', '剖'], ['pu', '扑'],
  ['qi', '期'], ['qia', '掐'], ['qian', '牵'], ['qiang', '枪'], ['qiao', '橇'], ['qie', '切'], ['qin', '钦'], ['qing', '轻'], ['qiong', '琼'], ['qiu', '秋'], ['qu', '趋'], ['quan', '圈'], ['que', '缺'], ['qun', '裙'],
  ['ran', '然'], ['rang', '瓤'], ['rao', '饶'], ['re', '惹'], ['ren', '壬'], ['reng', '扔'], ['ri', '日'], ['rong', '戎'], ['rou', '揉'], ['ru', '茹'], ['ruan', '软'], ['rui', '蕊'], ['run', '闰'], ['ruo', '若'],
  ['sa', '撒'], ['sai', '腮'], ['san', '三'], ['sang', '桑'], ['sao', '搔'], ['se', '瑟'], ['sen', '森'], ['seng', '僧'], ['sha', '莎'], ['shai', '筛'], ['shan', '杉'], ['shang', '伤'], ['shao', '梢'], ['she', '奢'], ['shen', '砷'], ['sheng', '牲'], ['shi', '失'], ['shou', '收'], ['shu', '蔬'], ['shua', '刷'], ['shuai', '摔'], ['shuan', '栓'], ['shuang', '霜'], ['shui', '谁'], ['shun', '顺'], ['shuo', '说'], ['si', '司'], ['song', '松'], ['sou', '搜'], ['su', '苏'], ['suan', '酸'], ['sui', '虽'], ['sun', '孙'], ['suo', '梭'],
  ['ta', '塌'], ['tai', '胎'], ['tan', '坍'], ['tang', '汤'], ['tao', '掏'], ['te', '特'], ['teng', '藤'], ['ti', '梯'], ['tian', '天'], ['tiao', '挑'], ['tie', '贴'], ['ting', '厅'], ['tong', '通'], ['tou', '偷'], ['tu', '凸'], ['tuan', '湍'], ['tui', '推'], ['tun', '吞'], ['tuo', '拖'],
  ['wa', '挖'], ['wai', '歪'], ['wan', '豌'], ['wang', '汪'], ['wei', '微'], ['wen', '瘟'], ['weng', '嗡'], ['wo', '挝'], ['wu', '钨'],
  ['xi', '昔'], ['xia', '虾'], ['xian', '掀'], ['xiang', '相'], ['xiao', '消'], ['xie', '楔'], ['xin', '薪'], ['xing', '惺'], ['xiong', '兄'], ['xiu', '休'], ['xu', '墟'], ['xuan', '轩'], ['xue', '靴'], ['xun', '勋'],
  ['ya', '压'], ['yan', '阉'], ['yang', '殃'], ['yao', '邀'], ['ye', '噎'], ['yi', '一'], ['yin', '茵'], ['ying', '鹰'], ['yo', '哟'], ['yong', '拥'], ['you', '幽'], ['yu', '迂'], ['yuan', '鸳'], ['yue', '曰'], ['yun', '酝'],
  ['za', '匝'], ['zai', '栽'], ['zan', '咱'], ['zang', '赃'], ['zao', '遭'], ['ze', '责'], ['zei', '贼'], ['zen', '怎'], ['zeng', '增'], ['zha', '扎'], ['zhai', '摘'], ['zhan', '瞻'], ['zhang', '樟'], ['zhao', '招'], ['zhe', '遮'], ['zhen', '臻'], ['zheng', '狰'], ['zhi', '汁'], ['zhong', '盅'], ['zhou', '周'], ['zhu', '株'], ['zhua', '抓'], ['zhuai', '拽'], ['zhuan', '专'], ['zhuang', '桩'], ['zhui', '椎'], ['zhun', '谆'], ['zhuo', '捉'], ['zi', '兹'], ['zong', '踪'], ['zou', '邹'], ['zu', '租'], ['zuan', '钻'], ['zui', '嘴'], ['zun', '尊'], ['zuo', '昨'],
];

/** Supplemental Level-2 & frequent roleplay / naming characters */
const EXTRA_HANZI_MAP = {
  喵: 'miao', 瑾: 'jin', 曦: 'xi', 泠: 'ling', 鸢: 'yuan', 绾: 'wan', 笙: 'sheng',
  嬛: 'huan', 魇: 'yan', 魅: 'mei', 魍: 'wang', 魉: 'liang', 宸: 'chen', 曜: 'yao',
  冥: 'ming', 潇: 'xiao', 钰: 'yu', 璇: 'xuan', 璐: 'lu', 妍: 'yan', 嫣: 'yan',
  婉: 'wan', 婕: 'jie', 卿: 'qing', 诀: 'jue', 煞: 'sha', 凰: 'huang', 凤: 'feng',
  璃: 'li', 琉: 'liu', 珞: 'luo', 洛: 'luo', 汐: 'xi', 沐: 'mu', 芷: 'zhi',
  若: 'ruo', 芊: 'qian', 芙: 'fu', 蓉: 'rong', 茉: 'mo', 莉: 'li', 薇: 'wei',
  蔷: 'qiang', 薰: 'xun', 瞳: 'tong', 眸: 'mou', 烬: 'jin', 焰: 'yan', 炽: 'chi',
  冽: 'lie', 凛: 'lin', 霜: 'shuang', 霏: 'fei', 霓: 'ni', 裳: 'shang', 绮: 'qi',
  绫: 'ling', 罗: 'luo', 绸: 'chou', 缎: 'duan', 弑: 'shi', 戮: 'lu', 殇: 'shang',
  咒: 'zhou', 箓: 'lu', 傀: 'kui', 儡: 'lei', 妖: 'yao', 姬: 'ji',
  妃: 'fei', 嫔: 'pin', 朕: 'zhen', 陛: 'bi', 臣: 'chen', 妾: 'qie', 婢: 'bi',
  澹: 'tan', 魈: 'xiao', 绯: 'fei', 澪: 'ling', 筱: 'xiao', 玥: 'yue', 璎: 'ying',
  珩: 'heng', 琛: 'chen', 璟: 'jing', 璀: 'cui', 璨: 'can', 昱: 'yu', 暄: 'xuan',
  暝: 'ming', 胧: 'long', 朔: 'shuo', 泓: 'hong', 洵: 'xun', 浔: 'xun', 淞: 'song',
  湮: 'yan', 滢: 'ying', 漪: 'yi', 瀚: 'han', 瀛: 'ying', 烨: 'ye', 烽: 'feng',
  煌: 'huang', 煜: 'yu', 煊: 'xuan', 熠: 'yi', 枭: 'xiao', 貔: 'pi', 貅: 'xiu',
};

/** @type {Map<string, string> | null} */
let cachedPinyinMap = null;

/**
 * Lazily builds and returns the Hanzi -> Pinyin syllable lookup map.
 * @returns {Map<string, string>}
 */
export function getPinyinMap() {
  if (cachedPinyinMap) return cachedPinyinMap;

  const map = new Map();
  try {
    const bytes = [];
    for (let r = 0xb0; r <= 0xd7; r++) {
      const maxC = r === 0xd7 ? 0xf9 : 0xfe;
      for (let c = 0xa1; c <= maxC; c++) {
        bytes.push(r, c);
      }
    }
    const chars = new TextDecoder('gbk').decode(new Uint8Array(bytes));

    const ranges = [];
    let searchFrom = 0;
    for (let i = 0; i < GB2312_SYLLABLE_STARTS.length; i++) {
      const [py, anchor] = GB2312_SYLLABLE_STARTS[i];
      const idx = i === 0 ? 0 : chars.indexOf(anchor, searchFrom);
      if (idx >= 0) {
        ranges.push([idx, py]);
        searchFrom = idx + 1;
      }
    }

    for (let i = 0; i < ranges.length; i++) {
      const [from, py] = ranges[i];
      const to = i + 1 < ranges.length ? ranges[i + 1][0] : chars.length;
      for (let k = from; k < to; k++) {
        map.set(chars[k], py);
      }
    }
  } catch {
    // Fallback if exotic runtime lacks 'gbk' TextDecoder
  }

  for (const [ch, py] of Object.entries(EXTRA_HANZI_MAP)) {
    map.set(ch, py);
  }

  cachedPinyinMap = map;
  return map;
}

/**
 * Releases cached Pinyin map when cleaner modal is closed to keep 0 resident memory.
 */
export function releasePinyinCache() {
  cachedPinyinMap = null;
}

/**
 * Converts a string (capped at MAX_PINYIN_CHARS) into { full, initials }.
 * @param {string} text
 * @returns {{ full: string, initials: string }}
 */
export function toPinyinTokens(text) {
  if (!text) return { full: '', initials: '' };
  const map = getPinyinMap();
  const slice = text.length > MAX_PINYIN_CHARS ? text.slice(0, MAX_PINYIN_CHARS) : text;

  let full = '';
  let initials = '';
  let prevWasAlphaNum = false;

  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    const code = ch.charCodeAt(0);

    // ASCII alphanumeric
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ) {
      const lower = ch.toLowerCase();
      full += lower;
      if (!prevWasAlphaNum) {
        initials += lower;
        prevWasAlphaNum = true;
      }
      continue;
    }

    prevWasAlphaNum = false;

    if (code >= 0x4e00 && code <= 0x9fff) {
      const py = map.get(ch);
      if (py) {
        full += py;
        initials += py[0];
      }
    }
  }

  return { full, initials };
}

/**
 * Attaches cached `_search` index onto a single item if not already computed.
 * @param {{ title?: string, groupTitle?: string, subtitle?: string, _search?: { raw: string, full: string, initials: string } }} item
 */
export function ensureItemSearchIndex(item) {
  if (!item || item._search) return item?._search;

  const title = String(item.title || '');
  const groupTitle = String(item.groupTitle || '');
  const subtitle = String(item.subtitle || '');
  const badgeText = Array.isArray(item.badges)
    ? item.badges.map((b) => b?.text || '').filter(Boolean).join(' ')
    : '';

  const raw = `${title} ${groupTitle} ${subtitle} ${badgeText}`.toLowerCase();
  const tPy = toPinyinTokens(title);
  const gPy = toPinyinTokens(groupTitle);
  const sPy = toPinyinTokens(subtitle);
  const bPy = toPinyinTokens(badgeText);

  item._search = {
    raw,
    full: `${tPy.full} ${gPy.full} ${sPy.full} ${bPy.full}`,
    initials: `${tPy.initials} ${gPy.initials} ${sPy.initials} ${bPy.initials}`,
  };

  return item._search;
}

/**
 * Time-sliced background indexer: builds `_search` in <= 6ms slices so 10,000+ items never freeze UI.
 * @param {Array<any>} items
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<void>}
 */
export async function prewarmSearchIndexTimeSliced(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return;
  const signal = options.signal;
  const FRAME_BUDGET_MS = 6;
  let idx = 0;

  while (idx < items.length) {
    if (signal?.aborted) return;
    const sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    while (idx < items.length) {
      ensureItemSearchIndex(items[idx]);
      idx++;
      if ((idx & 31) === 0) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - sliceStart >= FRAME_BUDGET_MS) break;
      }
    }

    if (idx < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * Normalizes user search query into space-separated terms.
 * @param {string} query
 * @returns {string[]}
 */
export function parseQueryTerms(query) {
  if (!query || typeof query !== 'string') return [];
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Checks whether an item matches all query terms via raw substring, Pinyin full, or Pinyin initials.
 * @param {any} item
 * @param {string[]} terms
 * @returns {boolean}
 */
export function matchesSearchTerms(item, terms) {
  if (!terms || terms.length === 0) return true;
  const idx = ensureItemSearchIndex(item);
  if (!idx) return false;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const compactTerm = term.replace(/['"\-_./\\]/g, '');
    const hit =
      idx.raw.includes(term) ||
      (compactTerm.length > 0 &&
        (idx.full.includes(compactTerm) || idx.initials.includes(compactTerm)));
    if (!hit) return false;
  }
  return true;
}
