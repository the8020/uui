/*!
 * OpenType shaping, ported from HarfBuzz (hb-ot-shape.cc, hb-ot-shape-normalize.cc, hb-ot-shape-fallback.cc,
 * hb-ot-tag.cc, hb-unicode)
 * Copyright © 2009,2010 Red Hat, Inc., © 2010,2011,2012 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md
 * and licenses/HarfBuzz.txt)
 */
import { Buffer, GlyphInfo, CATEGORY_NAMES, isMark, generalCategory, setGeneralCategory, isUnicodeMark, combiningClass, setCombiningClass, isUnicodeSpace, spaceFallback, setSpaceFallback, isDefaultIgnorable, isHidden, isContinuation, isMarkGlyph, isLigated, ligId, ligComp, ligNumComps, } from "./buffer.js";
import { GDEF, LayoutTable, MapBuilder, ApplyContext, propagateAttachmentOffsets } from "./layout.js";
import { generalCategory as gcTable, combiningClass as cccTable, script as scriptTable, extendedPictographic, decompositions as decompositionData } from "./unicode-data.js";
import { value, valueIndex, varints } from "./unicode.js";
import { mirror } from "./bidi.js";
const categoryIndex = new Map(CATEGORY_NAMES.map((name, i) => [name, i]));
export const unicodeCategory = (u) => categoryIndex.get(value(gcTable, u));
const combiningClassOf = (u) => +value(cccTable, u);
export const scriptOf = (u) => value(scriptTable, u);
const MODIFIED = {
    10: 22, 11: 15, 12: 16, 13: 17, 14: 23, 15: 18, 16: 19, 17: 20, 18: 21, 19: 14, 20: 24, 21: 12, 22: 25, 23: 13, 24: 10, 25: 11, 26: 26,
    27: 28, 28: 29, 29: 30, 30: 31, 31: 32, 32: 33, 33: 27, 34: 34, 35: 35, 36: 36, 84: 4, 91: 5, 103: 3, 107: 107, 118: 118, 122: 122,
    129: 129, 130: 132, 132: 131,
};
export function modifiedCombiningClass(u) {
    if (u === 0x1a60 || u === 0x0fc6)
        return 254;
    if (u === 0x0f39)
        return 127;
    const cc = combiningClassOf(u);
    return MODIFIED[cc] ?? cc;
}
export function isDefaultIgnorableCodepoint(ch) {
    const plane = ch >> 16;
    if (!plane) {
        switch (ch >> 8) {
            case 0x00: return ch === 0x00ad;
            case 0x03: return ch === 0x034f;
            case 0x06: return ch === 0x061c;
            case 0x17: return ch >= 0x17b4 && ch <= 0x17b5;
            case 0x18: return ch >= 0x180b && ch <= 0x180f;
            case 0x20: return ch >= 0x200b && ch <= 0x200f || ch >= 0x202a && ch <= 0x202e || ch >= 0x2060 && ch <= 0x206f;
            case 0xfe: return ch >= 0xfe00 && ch <= 0xfe0f || ch === 0xfeff;
            case 0xff: return ch >= 0xfff0 && ch <= 0xfff8;
            default: return false;
        }
    }
    if (plane === 1)
        return ch >= 0x1d173 && ch <= 0x1d17a;
    if (plane === 0xe)
        return ch >= 0xe0000 && ch <= 0xe0fff;
    return false;
}
const isVariationSelectorCodepoint = (u) => u >= 0xfe00 && u <= 0xfe0f || u >= 0xe0100 && u <= 0xe01ef;
const isRegionalIndicator = (u) => u >= 0x1f1e6 && u <= 0x1f1ff;
const SPACES = {
    0x20: 18, 0xa0: 18, 0x2000: 2, 0x2001: 1, 0x2002: 2, 0x2003: 1, 0x2004: 3, 0x2005: 4,
    0x2006: 6, 0x2007: 19, 0x2008: 20, 0x2009: 5, 0x200a: 16, 0x202f: 21, 0x205f: 17,
    0x3000: 1,
};
let decompositionMap = null, compositionMap = null;
function loadDecompositions() {
    decompositionMap = new Map();
    compositionMap = new Map();
    const numbers = varints(decompositionData);
    const unzigzag = (n) => n & 1 ? -(n + 1) / 2 : n / 2;
    for (let i = 0, u = 0; i < numbers.length; i += 3) {
        u += numbers[i];
        const a = u + unzigzag(numbers[i + 1]);
        const second = numbers[i + 2];
        if (!second)
            decompositionMap.set(u, [a, 0]);
        else {
            const b = u + unzigzag(second - 2 >> 1);
            decompositionMap.set(u, [a, b]);
            if (second - 2 & 1)
                compositionMap.set(a * 0x110000 + b, u);
        }
    }
}
const S_BASE = 0xac00, L_BASE = 0x1100, V_BASE = 0x1161, T_BASE = 0x11a7, L_COUNT = 19, V_COUNT = 21, T_COUNT = 28, N_COUNT = V_COUNT * T_COUNT, S_COUNT = L_COUNT * N_COUNT;
export function decompose(ab) {
    const si = ab - S_BASE;
    if (si >= 0 && si < S_COUNT) {
        const ti = si % T_COUNT;
        if (ti)
            return [S_BASE + si - ti, T_BASE + ti];
        return [L_BASE + Math.floor(si / N_COUNT), V_BASE + Math.floor(si % N_COUNT / T_COUNT)];
    }
    if (!decompositionMap)
        loadDecompositions();
    return decompositionMap.get(ab) ?? null;
}
export function compose(a, b) {
    const si = a - S_BASE;
    if (si >= 0 && si < S_COUNT) {
        if (si % T_COUNT || b <= T_BASE || b >= T_BASE + T_COUNT)
            return 0;
        return a + b - T_BASE;
    }
    if (a >= L_BASE && a < L_BASE + L_COUNT && b >= V_BASE && b < V_BASE + V_COUNT)
        return S_BASE + ((a - L_BASE) * V_COUNT + b - V_BASE) * T_COUNT;
    if (!compositionMap)
        loadDecompositions();
    return compositionMap.get(a * 0x110000 + b) ?? 0;
}
const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Cprt', 'Khar', 'Phnx', 'Nkoo', 'Lydi', 'Avst', 'Armi', 'Phli', 'Prti', 'Sarb', 'Orkh', 'Samr', 'Mand',
    'Merc', 'Mero', 'Mani', 'Mend', 'Nbat', 'Narb', 'Palm', 'Phlp', 'Hatr', 'Adlm', 'Rohg', 'Sogo', 'Sogd', 'Elym', 'Chrs', 'Yezi', 'Ougr', 'Gara', 'Sidt']);
const BIDIRECTIONAL_SCRIPTS = new Set(['Hung', 'Ital', 'Runr', 'Tfng']);
export const scriptDirection = (script) => RTL_SCRIPTS.has(script) ? 5 : BIDIRECTIONAL_SCRIPTS.has(script) ? 0 : 4;
const NEW_TAGS = { Beng: 'bng2', Deva: 'dev2', Gujr: 'gjr2', Guru: 'gur2', Knda: 'knd2', Mlym: 'mlm2', Orya: 'ory2', Taml: 'tml2', Telu: 'tel2', Mymr: 'mym2' };
const OLD_TAGS = { Hira: 'kana', Hrkt: 'kana', Laoo: 'lao ', Yiii: 'yi  ', Nkoo: 'nko ', Vaii: 'vai ', Zmth: 'math' };
export function scriptTags(script) {
    const tags = [];
    const newTag = NEW_TAGS[script];
    if (newTag) {
        if (newTag !== 'mym2')
            tags.push(newTag.slice(0, 3) + '3');
        tags.push(newTag);
    }
    if (script && script !== 'Zyyy' && script !== 'Zinh' && script !== 'Zzzz')
        tags.push(OLD_TAGS[script] ?? script.toLowerCase());
    return tags;
}
export const defaultShaper = { normalization: 4, zeroWidthMarks: 2, fallbackPosition: true };
export const shaperFor = {
    categorize: () => defaultShaper,
};
export class ShapeFont {
    font;
    gdef;
    gsub;
    gpos;
    plans = new Map();
    constructor(font) {
        this.font = font;
        this.gdef = new GDEF(font);
        this.gsub = font.tables.GSUB ? new LayoutTable(font, 'GSUB', font.tables.GSUB.offset) : null;
        this.gpos = font.tables.GPOS ? new LayoutTable(font, 'GPOS', font.tables.GPOS.offset) : null;
    }
    glyph(u) {
        return this.font.glyphIndex(u);
    }
    hasGlyph(u) {
        return this.font.glyphIndex(u) !== 0;
    }
    advance(glyph) {
        return glyph < this.font.numGlyphs ? this.font.advance(glyph) : 0;
    }
    plan(script, direction, features = []) {
        const key = `${script}:${direction}:${features.map(([tag, value]) => `${tag}=${value}`).join(',')}`;
        let plan = this.plans.get(key);
        if (!plan)
            this.plans.set(key, plan = new Planner(this, script, direction, features).compile());
        return plan;
    }
}
const shapeFonts = new WeakMap();
export function shapeFont(font) {
    let f = shapeFonts.get(font);
    if (!f)
        shapeFonts.set(font, f = new ShapeFont(font));
    return f;
}
const COMMON_FEATURES = [['abvm', 1], ['blwm', 1], ['ccmp', 1], ['locl', 1],
    ['mark', 13], ['mkmk', 13], ['rlig', 1]];
const HORIZONTAL_FEATURES = [['calt', 1], ['clig', 1], ['curs', 1],
    ['dist', 1], ['kern', 3], ['liga', 1], ['rclt', 1]];
export class Planner {
    font;
    script;
    direction;
    features;
    map;
    shaper;
    constructor(font, script, direction, features = []) {
        this.font = font;
        this.script = script;
        this.direction = direction;
        this.features = features;
        this.map = new MapBuilder([font.gsub, font.gpos], scriptTags(script));
        this.shaper = shaperFor.categorize(script, direction, this.map.chosenScript[0]);
    }
    compile() {
        const map = this.map, shaper = this.shaper;
        map.enableFeature('rvrn');
        map.addGsubPause(null);
        if (this.direction === 4) {
            map.enableFeature('ltra');
            map.enableFeature('ltrm');
        }
        else {
            map.enableFeature('rtla');
            map.addFeature('rtlm');
        }
        map.addFeature('frac');
        map.addFeature('numr');
        map.addFeature('dnom');
        map.enableFeature('rand', 32, 255);
        map.enableFeature('Harf');
        map.enableFeature('HARF');
        if (shaper.collectFeatures) {
            map.isSimple = false;
            shaper.collectFeatures(this);
        }
        map.enableFeature('Buzz');
        map.enableFeature('BUZZ');
        for (const [tag, flags] of COMMON_FEATURES)
            map.addFeature(tag, flags);
        for (const [tag, flags] of HORIZONTAL_FEATURES)
            map.addFeature(tag, flags);
        if (this.features.length)
            map.isSimple = false;
        for (const [tag, value] of this.features)
            map.addFeature(tag, 1, value);
        if (shaper.overrideFeatures)
            shaper.overrideFeatures(this);
        const m = map.compile();
        const font = this.font;
        const plan = {
            font, script: this.script, direction: this.direction, shaper, map: m, data: null,
            fracMask: m.get1Mask('frac'), numrMask: m.get1Mask('numr'), dnomMask: m.get1Mask('dnom'), hasFrac: false,
            rtlmMask: m.get1Mask('rtlm'), kernMask: m.getMask('kern')[0],
            applyGpos: false, applyKern: false, zeroMarks: false, hasGposMark: false, adjustMarkPositioningWhenZeroing: false, fallbackMarkPositioning: false,
            fallbackGlyphClasses: !font.gdef.hasGlyphClasses,
        };
        plan.hasFrac = !!plan.fracMask || !!plan.numrMask && !!plan.dnomMask;
        const hasGposKern = m.featureIndex(1, 'kern') >= 0;
        const disableGpos = !!shaper.gposTag && shaper.gposTag !== m.chosenScript[1];
        const hasGpos = !disableGpos && !!font.gpos;
        if (hasGpos)
            plan.applyGpos = true;
        if (!hasGposKern || !plan.applyGpos) {
            if (font.font.kernTable)
                plan.applyKern = shaper.fallbackPosition;
        }
        plan.zeroMarks = shaper.zeroWidthMarks !== 0;
        plan.hasGposMark = !!m.get1Mask('mark');
        plan.adjustMarkPositioningWhenZeroing = !plan.applyGpos;
        plan.fallbackMarkPositioning = plan.adjustMarkPositioningWhenZeroing && shaper.fallbackPosition;
        if (shaper.dataCreate)
            plan.data = shaper.dataCreate(plan);
        return plan;
    }
}
export function setUnicodeProps(info, buffer) {
    const u = info.codepoint;
    const category = unicodeCategory(u);
    let props = category;
    if (u >= 0x80) {
        if (isDefaultIgnorableCodepoint(u)) {
            buffer.hasIgnorables = true;
            props |= 32;
            if (u === 0x200c)
                props |= 512;
            else if (u === 0x200d)
                props |= 256;
            else if (u >= 0x180b && u <= 0x180d || u === 0x180f)
                props |= 64;
            else if (u >= 0xe0020 && u <= 0xe007f)
                props |= 64;
            else if (u === 0x034f) {
                buffer.hasCGJ = true;
                props |= 64;
            }
        }
        if (isMark(category)) {
            buffer.hasContinuations = true;
            props |= 128;
            props |= modifiedCombiningClass(u) << 8;
        }
    }
    info.unicodeProps = props;
}
function setUnicodePropsAll(buffer, globalMask) {
    const info = buffer.info, count = info.length;
    for (let i = 0; i < count; i++) {
        info[i].mask = globalMask;
        setUnicodeProps(info[i], buffer);
        const u = info[i].codepoint;
        if (u < 0x80)
            continue;
        const category = generalCategory(info[i]);
        if (category === 5 || category === 9 || category === 8 || category === 7 || category === 29)
            continue;
        if (category === 24 && u >= 0x1f3fb && u <= 0x1f3ff)
            setContinuation(info[i], buffer);
        else if (i && isRegionalIndicator(u)) {
            if (isRegionalIndicator(info[i - 1].codepoint) && !isContinuation(info[i - 1]))
                setContinuation(info[i], buffer);
        }
        else if (u === 0x200d && isDefaultIgnorable(info[i])) {
            setContinuation(info[i], buffer);
            if (i + 1 < count && valueIndex(extendedPictographic, info[i + 1].codepoint)) {
                i++;
                info[i].mask = globalMask;
                setUnicodeProps(info[i], buffer);
                setContinuation(info[i], buffer);
            }
        }
        else if (u >= 0xff9e && u <= 0xff9f || u >= 0xe0020 && u <= 0xe007f)
            setContinuation(info[i], buffer);
    }
}
const setContinuation = (info, buffer) => {
    buffer.hasContinuations = true;
    info.unicodeProps |= 128;
};
const graphemeGroup = (_a, b) => isContinuation(b);
function insertDottedCircle(buffer, font) {
    if (!buffer.beginning || !buffer.len || !isUnicodeMark(buffer.info[0]))
        return;
    if (!font.hasGlyph(0x25cc))
        return;
    const dottedCircle = new GlyphInfo();
    dottedCircle.codepoint = 0x25cc;
    setUnicodeProps(dottedCircle, buffer);
    buffer.clearOutput();
    buffer.idx = 0;
    dottedCircle.cluster = buffer.cur().cluster;
    dottedCircle.mask = buffer.cur().mask;
    buffer.outputInfo(dottedCircle);
    buffer.sync();
}
function formClusters(buffer) {
    if (!buffer.hasContinuations)
        return;
    for (let start = 0; start < buffer.len;) {
        const end = buffer.groupEnd(start, graphemeGroup);
        buffer.mergeClusters(start, end);
        start = end;
    }
}
function ensureNativeDirection(buffer) {
    let horizontal = scriptDirection(buffer.script);
    if (horizontal === 5 && buffer.direction === 4) {
        let number = false, letter = false, ri = false;
        for (const info of buffer.info) {
            const c = generalCategory(info);
            if (c === 5 || c === 6 || c === 7 || c === 8 || c === 9) {
                letter = true;
                break;
            }
            else if (c === 13)
                number = true;
            else if (isRegionalIndicator(info.codepoint))
                ri = true;
        }
        if ((number || ri) && !letter)
            horizontal = 4;
    }
    if (horizontal && buffer.direction !== horizontal) {
        buffer.reverseGroups(graphemeGroup);
        buffer.direction = buffer.direction === 4 ? 5 : 4;
    }
}
function rotateChars(plan, buffer, targetDirection) {
    if (targetDirection !== 5)
        return;
    for (const info of buffer.info) {
        const mirrored = mirror(info.codepoint);
        if (mirrored !== info.codepoint && plan.font.hasGlyph(mirrored))
            info.codepoint = mirrored;
        else
            info.mask |= plan.rtlmMask;
    }
}
function setupMasksFraction(plan, buffer, hasFractionSlash) {
    if (!hasFractionSlash || !plan.hasFrac)
        return;
    const forward = buffer.direction === 4;
    const pre = forward ? plan.numrMask | plan.fracMask : plan.fracMask | plan.dnomMask;
    const post = forward ? plan.fracMask | plan.dnomMask : plan.numrMask | plan.fracMask;
    const info = buffer.info, count = info.length;
    for (let i = 0; i < count; i++) {
        if (info[i].codepoint !== 0x2044)
            continue;
        let start = i, end = i + 1;
        while (start && generalCategory(info[start - 1]) === 13)
            start--;
        while (end < count && generalCategory(info[end]) === 13)
            end++;
        if (start === i || end === i + 1)
            continue;
        for (let j = start; j < i; j++)
            info[j].mask |= pre;
        info[i].mask |= plan.fracMask;
        for (let j = i + 1; j < end; j++)
            info[j].mask |= post;
        i = end - 1;
    }
}
const MAX_COMBINING_MARKS = 32;
function normalize(plan, buffer, font) {
    if (!buffer.len)
        return;
    let mode = plan.shaper.normalization;
    if (mode === 4)
        mode = 2;
    const c = {
        plan, font,
        decompose: plan.shaper.decompose ?? ((_c, ab) => decompose(ab)),
        compose: plan.shaper.compose ?? ((_c, a, b) => compose(a, b)),
    };
    const alwaysShortCircuit = mode === 0;
    const mightShortCircuit = alwaysShortCircuit || mode !== 1 && mode !== 3;
    let allSimple = true;
    buffer.clearOutput();
    const count = buffer.len;
    buffer.idx = 0;
    do {
        let end = buffer.idx + 1;
        for (; end < count; end++)
            if (isUnicodeMark(buffer.info[end]))
                break;
        if (end < count)
            end--;
        if (mightShortCircuit) {
            let done = 0;
            for (let i = buffer.idx; i < end; i++, done++) {
                const glyph = font.glyph(buffer.info[i].codepoint);
                if (!glyph)
                    break;
                buffer.info[i].glyphIndex = glyph;
            }
            buffer.nextGlyphs(done);
        }
        while (buffer.idx < end && buffer.successful)
            decomposeCurrentCharacter(c, buffer, mightShortCircuit);
        if (buffer.idx === count || !buffer.successful)
            break;
        allSimple = false;
        for (end = buffer.idx + 1; end < count; end++)
            if (!isUnicodeMark(buffer.info[end]))
                break;
        decomposeMultiCharCluster(c, buffer, end, alwaysShortCircuit);
    } while (buffer.idx < count && buffer.successful);
    buffer.sync();
    if (!allSimple) {
        const info = buffer.info, n = buffer.len;
        for (let i = 0; i < n; i++) {
            if (!combiningClass(info[i]))
                continue;
            let end = i + 1;
            for (; end < n; end++)
                if (!combiningClass(info[end]))
                    break;
            if (end - i > MAX_COMBINING_MARKS) {
                i = end;
                continue;
            }
            buffer.sort(i, end, (a, b) => combiningClass(a) - combiningClass(b));
            if (plan.shaper.reorderMarks)
                plan.shaper.reorderMarks(plan, buffer, i, end);
            i = end;
        }
    }
    if (buffer.hasCGJ) {
        const info = buffer.info;
        for (let i = 1; i + 1 < info.length; i++)
            if (info[i].codepoint === 0x034f && (!combiningClass(info[i + 1]) || combiningClass(info[i - 1]) <= combiningClass(info[i + 1])))
                info[i].unicodeProps &= ~64;
    }
    if (!allSimple && buffer.successful && (mode === 2 || mode === 3)) {
        buffer.clearOutput();
        const n = buffer.len;
        let starter = 0;
        buffer.nextGlyph();
        while (buffer.idx < n) {
            const cur = buffer.cur();
            if (isUnicodeMark(cur) && (starter === buffer.outLen - 1 || combiningClass(buffer.prev()) < combiningClass(cur))) {
                const composed = c.compose(c, buffer.outInfo[starter].codepoint, cur.codepoint);
                const glyph = composed ? font.glyph(composed) : 0;
                if (composed && glyph) {
                    buffer.nextGlyph();
                    buffer.mergeOutClusters(starter, buffer.outLen);
                    buffer.outLen--;
                    const s = buffer.outInfo[starter];
                    s.codepoint = composed;
                    s.glyphIndex = glyph;
                    setUnicodeProps(s, buffer);
                    continue;
                }
            }
            buffer.nextGlyph();
            if (!combiningClass(buffer.prev()))
                starter = buffer.outLen - 1;
        }
        buffer.sync();
    }
}
function outputChar(buffer, u, glyph) {
    buffer.cur().glyphIndex = glyph;
    const info = buffer.outputGlyph(u);
    setUnicodeProps(info, buffer);
}
function nextChar(buffer, glyph) {
    buffer.cur().glyphIndex = glyph;
    buffer.nextGlyph();
}
function decomposeInto(c, buffer, shortest, ab) {
    const parts = c.decompose(c, ab);
    if (!parts)
        return 0;
    const [a, b] = parts;
    const bGlyph = b ? c.font.glyph(b) : 0;
    if (b && !bGlyph)
        return 0;
    const aGlyph = c.font.glyph(a);
    if (shortest && aGlyph) {
        outputChar(buffer, a, aGlyph);
        if (b) {
            outputChar(buffer, b, bGlyph);
            return 2;
        }
        return 1;
    }
    const ret = decomposeInto(c, buffer, shortest, a);
    if (ret) {
        if (b) {
            outputChar(buffer, b, bGlyph);
            return ret + 1;
        }
        return ret;
    }
    if (aGlyph) {
        outputChar(buffer, a, aGlyph);
        if (b) {
            outputChar(buffer, b, bGlyph);
            return 2;
        }
        return 1;
    }
    return 0;
}
function decomposeCurrentCharacter(c, buffer, shortest) {
    const u = buffer.cur().codepoint;
    const glyph = c.font.glyph(u);
    if (shortest && glyph)
        return nextChar(buffer, glyph);
    if (decomposeInto(c, buffer, shortest, u))
        return buffer.skipGlyph();
    if (!shortest && glyph)
        return nextChar(buffer, glyph);
    if (isUnicodeSpace(buffer.cur())) {
        const type = SPACES[u] ?? 0;
        const space = c.font.glyph(0x20);
        if (type !== 0 && space) {
            setSpaceFallback(buffer.cur(), type);
            nextChar(buffer, space);
            buffer.hasSpaceFallback = true;
            return;
        }
    }
    if (u === 0x2011) {
        const other = c.font.glyph(0x2010);
        if (other)
            return nextChar(buffer, other);
    }
    nextChar(buffer, glyph);
}
function handleVariationSelectorCluster(c, buffer, end) {
    const font = c.font;
    const setGlyph = (info) => {
        info.glyphIndex = font.glyph(info.codepoint);
    };
    while (buffer.idx < end - 1 && buffer.successful) {
        if (isVariationSelectorCodepoint(buffer.cur(1).codepoint)) {
            const glyph = font.font.variationGlyph(buffer.cur().codepoint, buffer.cur(1).codepoint);
            if (glyph) {
                buffer.cur().glyphIndex = glyph;
                const u = buffer.cur().codepoint;
                buffer.replaceGlyphs(2, 1, [u]);
            }
            else {
                setGlyph(buffer.cur());
                buffer.nextGlyph();
                setGeneralCategory(buffer.cur(), 1);
                buffer.cur().unicodeProps |= 1024;
                setGlyph(buffer.cur());
                buffer.nextGlyph();
            }
            while (buffer.idx < end && buffer.successful && isVariationSelectorCodepoint(buffer.cur().codepoint)) {
                setGlyph(buffer.cur());
                buffer.nextGlyph();
            }
        }
        else {
            setGlyph(buffer.cur());
            buffer.nextGlyph();
        }
    }
    if (buffer.idx < end) {
        setGlyph(buffer.cur());
        buffer.nextGlyph();
    }
}
function decomposeMultiCharCluster(c, buffer, end, shortCircuit) {
    for (let i = buffer.idx; i < end && buffer.successful; i++)
        if (isVariationSelectorCodepoint(buffer.info[i].codepoint))
            return handleVariationSelectorCluster(c, buffer, end);
    while (buffer.idx < end && buffer.successful)
        decomposeCurrentCharacter(c, buffer, shortCircuit);
}
function synthesizeGlyphClasses(buffer) {
    for (const info of buffer.info)
        info.glyphProps = generalCategory(info) !== 12 || isDefaultIgnorable(info) ? 2 : 8;
}
function zeroMarkWidthsByGdef(buffer, adjustOffsets) {
    for (const info of buffer.info)
        if (isMarkGlyph(info)) {
            if (adjustOffsets) {
                info.xOffset -= info.xAdvance;
                info.yOffset -= info.yAdvance;
            }
            info.xAdvance = info.yAdvance = 0;
        }
}
function zeroWidthDefaultIgnorables(buffer) {
    if (!buffer.hasIgnorables)
        return;
    for (const info of buffer.info)
        if (isDefaultIgnorable(info))
            info.xAdvance = info.yAdvance = info.xOffset = 0;
}
function hideDefaultIgnorables(buffer, font) {
    if (!buffer.hasIgnorables)
        return;
    const invisible = font.glyph(0x20);
    if (invisible) {
        for (const info of buffer.info)
            if (isDefaultIgnorable(info))
                info.codepoint = invisible;
    }
    else
        buffer.deleteGlyphsInplace(isDefaultIgnorable);
}
function fallbackSpaces(font, buffer) {
    const upem = font.font.unitsPerEm;
    for (const info of buffer.info) {
        if (!isUnicodeSpace(info) || isLigated(info))
            continue;
        const type = spaceFallback(info);
        switch (type) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 16:
                info.xAdvance = Math.trunc((upem + (type >> 1)) / type);
                break;
            case 17:
                info.xAdvance = Math.trunc(upem * 4 / 18);
                break;
            case 19:
                for (let u = 0x30; u <= 0x39; u++) {
                    const glyph = font.glyph(u);
                    if (glyph) {
                        info.xAdvance = font.advance(glyph);
                        break;
                    }
                }
                break;
            case 20: {
                const glyph = font.glyph(0x2e) || font.glyph(0x2c);
                if (glyph)
                    info.xAdvance = font.advance(glyph);
                break;
            }
            case 21:
                info.xAdvance = Math.trunc(info.xAdvance / 2);
                break;
        }
    }
}
function kernTable(plan, buffer) {
    const kern = plan.font.font.kernTable;
    if (!kern)
        return;
    const c = new ApplyContext(1, plan.font.gpos, buffer, plan.font.gdef);
    c.lookupMask = plan.kernMask;
    c.setLookupProps(8);
    const it = c.iterInput, info = buffer.info;
    for (let idx = 0; idx < info.length;) {
        if (!(info[idx].mask & plan.kernMask)) {
            idx++;
            continue;
        }
        it.resetFast(idx);
        it.setMatchFunc(null, null);
        if (!it.next()) {
            idx = it.idx + 1;
            continue;
        }
        const i = idx, j = it.idx;
        const k = kern(info[i].codepoint, info[j].codepoint);
        if (k) {
            const k1 = k >> 1, k2 = k - k1;
            info[i].xAdvance += k1;
            info[j].xAdvance += k2;
            info[j].xOffset += k2;
        }
        idx = it.idx;
    }
}
function recategorizeCombiningClass(u, klass) {
    if (klass >= 200)
        return klass;
    if ((u & ~0xff) === 0x0e00) {
        if (!klass) {
            if ([0x0e31, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e47, 0x0e4c, 0x0e4d, 0x0e4e].includes(u))
                klass = 232;
            else if ([0x0eb1, 0x0eb4, 0x0eb5, 0x0eb6, 0x0eb7, 0x0ebb, 0x0ecc, 0x0ecd].includes(u))
                klass = 230;
            else if (u === 0x0ebc)
                klass = 220;
        }
        else if (u === 0x0e3a)
            klass = 222;
    }
    switch (klass) {
        case 22:
        case 15:
        case 16:
        case 17:
        case 23:
        case 18:
        case 19:
        case 20:
        case 21:
        case 24:
        case 25: return 220;
        case 13: return 214;
        case 10: return 232;
        case 11:
        case 14: return 228;
        case 26: return 230;
        case 12: break;
        case 28:
        case 29:
        case 31:
        case 32:
        case 27:
        case 34:
        case 35:
        case 36: return 230;
        case 30:
        case 33: return 220;
        case 3: return 222;
        case 107: return 232;
        case 118: return 220;
        case 122: return 230;
        case 129: return 220;
        case 132: return 230;
        case 131: return 220;
    }
    return klass;
}
function recategorizeMarks(buffer) {
    for (const info of buffer.info)
        if (generalCategory(info) === 12)
            setCombiningClass(info, recategorizeCombiningClass(info.codepoint, combiningClass(info)));
}
function glyphExtents(font, glyph) {
    const e = font.font.extents(glyph);
    if (!e)
        return null;
    return { xBearing: Math.min(e.xMin, e.xMax), yBearing: e.yMax, width: e.xMax - e.xMin, height: e.yMin - e.yMax };
}
function positionMark(font, buffer, base, i, klass) {
    const info = buffer.info[i];
    const mark = glyphExtents(font, info.codepoint);
    if (!mark)
        return;
    const yGap = Math.trunc(font.font.unitsPerEm / 16);
    info.xOffset = info.yOffset = 0;
    switch (klass) {
        case 233:
        case 234:
            if (buffer.direction === 4) {
                info.xOffset = base.xBearing + base.width - Math.trunc(mark.width / 2) - mark.xBearing;
                break;
            }
            else {
                info.xOffset = base.xBearing - Math.trunc(mark.width / 2) - mark.xBearing;
                break;
            }
        default:
            info.xOffset = base.xBearing + Math.trunc((base.width - mark.width) / 2) - mark.xBearing;
            break;
        case 200:
        case 218:
        case 228:
            info.xOffset = base.xBearing - mark.xBearing;
            break;
        case 216:
        case 222:
        case 232:
            info.xOffset = base.xBearing + base.width - mark.width - mark.xBearing;
            break;
    }
    const below = klass === 233 || klass === 218 || klass === 220 || klass === 222;
    const above = klass === 234 || klass === 228 || klass === 230 || klass === 232;
    if (below || klass === 200 || klass === 202) {
        if (below)
            base.height -= yGap;
        info.yOffset = base.yBearing + base.height - mark.yBearing;
        if (yGap > 0 === info.yOffset > 0) {
            base.height -= info.yOffset;
            info.yOffset = 0;
        }
        base.height += mark.height;
    }
    else if (above || klass === 214 || klass === 216) {
        if (above) {
            base.yBearing += yGap;
            base.height -= yGap;
        }
        info.yOffset = base.yBearing - mark.yBearing - mark.height;
        if (yGap > 0 !== info.yOffset > 0) {
            const correction = -Math.trunc(info.yOffset / 2);
            base.yBearing += correction;
            base.height -= correction;
            info.yOffset += correction;
        }
        base.yBearing -= mark.height;
        base.height += mark.height;
    }
}
function positionAroundBase(plan, font, buffer, base, end, adjustOffsets) {
    const info = buffer.info;
    const extents = glyphExtents(font, info[base].codepoint);
    if (!extents) {
        for (let i = base + 1; i < end; i++)
            if (generalCategory(info[i]) === 12) {
                if (adjustOffsets) {
                    info[i].xOffset -= info[i].xAdvance;
                    info[i].yOffset -= info[i].yAdvance;
                }
                info[i].xAdvance = info[i].yAdvance = 0;
            }
        return;
    }
    extents.yBearing += info[base].yOffset;
    extents.xBearing = 0;
    extents.width = font.advance(info[base].codepoint);
    const id = ligId(info[base]), components = ligNumComps(info[base]);
    let xOffset = 0, yOffset = 0;
    if (buffer.direction === 4) {
        xOffset = -info[base].xAdvance;
        yOffset = -info[base].yAdvance;
    }
    let componentExtents = { ...extents }, lastComponent = -1, lastClass = 255, clusterExtents = { ...extents };
    for (let i = base + 1; i < end; i++) {
        if (combiningClass(info[i])) {
            if (components > 1) {
                const thisId = ligId(info[i]);
                let thisComponent = ligComp(info[i]) - 1;
                if (!id || id !== thisId || thisComponent >= components)
                    thisComponent = components - 1;
                if (lastComponent !== thisComponent) {
                    lastComponent = thisComponent;
                    lastClass = 255;
                    componentExtents = { ...extents };
                    if (plan.direction === 4)
                        componentExtents.xBearing += Math.trunc(thisComponent * componentExtents.width / components);
                    else
                        componentExtents.xBearing += Math.trunc((components - 1 - thisComponent) * componentExtents.width / components);
                    componentExtents.width = Math.trunc(componentExtents.width / components);
                }
            }
            const thisClass = combiningClass(info[i]);
            if (lastClass !== thisClass) {
                lastClass = thisClass;
                clusterExtents = { ...componentExtents };
            }
            positionMark(font, buffer, clusterExtents, i, thisClass);
            info[i].xAdvance = info[i].yAdvance = 0;
            info[i].xOffset += xOffset;
            info[i].yOffset += yOffset;
        }
        else if (buffer.direction === 4) {
            xOffset -= info[i].xAdvance;
            yOffset -= info[i].yAdvance;
        }
        else {
            xOffset += info[i].xAdvance;
            yOffset += info[i].yAdvance;
        }
    }
}
function positionCluster(plan, font, buffer, start, end, adjustOffsets) {
    if (end - start < 2)
        return;
    const info = buffer.info;
    for (let i = start; i < end; i++) {
        if (isUnicodeMark(info[i]))
            continue;
        let j = i + 1;
        for (; j < end; j++) {
            if (isHidden(info[j]) || isDefaultIgnorable(info[j]))
                continue;
            if (!isUnicodeMark(info[j]))
                break;
        }
        positionAroundBase(plan, font, buffer, i, j, adjustOffsets);
        i = j - 1;
    }
}
function fallbackMarkPosition(plan, font, buffer, adjustOffsets) {
    const info = buffer.info;
    let start = 0;
    for (let i = 1; i < info.length; i++)
        if (!isUnicodeMark(info[i]) && !isHidden(info[i]) && !isDefaultIgnorable(info[i])) {
            positionCluster(plan, font, buffer, start, i, adjustOffsets);
            start = i;
        }
    positionCluster(plan, font, buffer, start, info.length, adjustOffsets);
}
function position(plan, font, buffer) {
    for (const info of buffer.info) {
        info.xAdvance = font.advance(info.codepoint);
        info.yAdvance = info.xOffset = info.yOffset = info.attachChain = info.attachType = 0;
    }
    if (buffer.hasSpaceFallback)
        fallbackSpaces(font, buffer);
    const adjustOffsetsWhenZeroing = plan.adjustMarkPositioningWhenZeroing && buffer.direction === 4;
    if (plan.zeroMarks && plan.shaper.zeroWidthMarks === 1)
        zeroMarkWidthsByGdef(buffer, adjustOffsetsWhenZeroing);
    if (plan.applyGpos)
        plan.map.apply(1, font.gpos, buffer, font.gdef, plan, font);
    if (plan.applyKern)
        kernTable(plan, buffer);
    if (plan.zeroMarks && plan.shaper.zeroWidthMarks === 2)
        zeroMarkWidthsByGdef(buffer, adjustOffsetsWhenZeroing);
    zeroWidthDefaultIgnorables(buffer);
    propagateAttachmentOffsets(buffer);
    if (plan.fallbackMarkPositioning)
        fallbackMarkPosition(plan, font, buffer, adjustOffsetsWhenZeroing);
    if (buffer.direction === 5)
        buffer.reverse();
}
export function shapeRun(font, codepoints, script, direction, clusters, context = { before: [], after: [] }, features = []) {
    const buffer = new Buffer();
    buffer.direction = direction;
    buffer.script = script;
    buffer.beginning = !context.before.length;
    buffer.context = [context.before, context.after];
    for (let i = 0; i < codepoints.length; i++) {
        const info = new GlyphInfo();
        info.codepoint = codepoints[i];
        info.cluster = clusters ? clusters[i] : i;
        buffer.info.push(info);
    }
    buffer.limit();
    if (!buffer.len)
        return [];
    const plan = font.plan(script, direction, features);
    const targetDirection = buffer.direction;
    let hasFractionSlash = false;
    for (const info of buffer.info)
        if (info.codepoint === 0x2044)
            hasFractionSlash = true;
    setUnicodePropsAll(buffer, plan.map.globalMask);
    insertDottedCircle(buffer, font);
    formClusters(buffer);
    ensureNativeDirection(buffer);
    if (plan.shaper.preprocessText)
        plan.shaper.preprocessText(plan, buffer, font);
    rotateChars(plan, buffer, targetDirection);
    normalize(plan, buffer, font);
    setupMasksFraction(plan, buffer, hasFractionSlash);
    if (plan.shaper.setupMasks)
        plan.shaper.setupMasks(plan, buffer, font);
    if (plan.fallbackMarkPositioning)
        recategorizeMarks(buffer);
    for (const info of buffer.info)
        info.codepoint = info.glyphIndex;
    for (const info of buffer.info) {
        info.glyphProps = font.gdef.hasGlyphClasses ? font.gdef.glyphProps(info.codepoint) : 0;
        info.ligProps = 0;
    }
    if (plan.fallbackGlyphClasses)
        synthesizeGlyphClasses(buffer);
    plan.map.apply(0, font.gsub, buffer, font.gdef, plan, font);
    position(plan, font, buffer);
    hideDefaultIgnorables(buffer, font);
    if (plan.shaper.postprocessGlyphs)
        plan.shaper.postprocessGlyphs(plan, buffer, font);
    buffer.direction = targetDirection;
    return buffer.info;
}
