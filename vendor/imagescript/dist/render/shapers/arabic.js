/*!
 * The Arabic shaper (Arabic, Syriac, and joining for Mongolian, N'Ko and others through USE), ported from HarfBuzz
 * (hb-ot-shaper-arabic.cc)
 * Copyright © 2010,2012 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
import { generalCategory, isDefaultIgnorable, isMultiplied, ligComp, combiningClass, setCombiningClass } from "../buffer.js";
import { syntheticLookup, applySynthetic } from "../layout.js";
import { unicodeCategory } from "../shape.js";
import { joiningType as joiningTable, ARABIC_SHAPING_FIRST, arabicShaping, arabicLigatures, arabicLigatures3, arabicMarkLigatures } from "../unicode-data.js";
import { value } from "../unicode.js";
const JOINING = { U: 0, L: 1, R: 2, D: 3, C: 3, T: 6, ALAPH: 4, DALATH_RISH: 5 };
export const joiningType = (u, category) => {
    const type = JOINING[value(joiningTable, u)];
    if (type !== undefined)
        return type;
    return category === 12 || category === 11 || category === 1 ? 6 : 0;
};
const FEATURES = ['isol', 'fina', 'fin2', 'fin3', 'medi', 'med2', 'init'];
const isSyriacFeature = (tag) => tag[3] === '2' || tag[3] === '3';
const N = 7, ISOL = 0, FINA = 1, FIN2 = 2, FIN3 = 3, MEDI = 4, MED2 = 5, INIT = 6;
const STATES = [
    [[N, N, 0], [N, ISOL, 2], [N, ISOL, 1], [N, ISOL, 2], [N, ISOL, 1], [N, ISOL, 6]],
    [[N, N, 0], [N, ISOL, 2], [N, ISOL, 1], [N, ISOL, 2], [N, FIN2, 5], [N, ISOL, 6]],
    [[N, N, 0], [N, ISOL, 2], [INIT, FINA, 1], [INIT, FINA, 3], [INIT, FINA, 4], [INIT, FINA, 6]],
    [[N, N, 0], [N, ISOL, 2], [MEDI, FINA, 1], [MEDI, FINA, 3], [MEDI, FINA, 4], [MEDI, FINA, 6]],
    [[N, N, 0], [N, ISOL, 2], [MED2, ISOL, 1], [MED2, ISOL, 2], [MED2, FIN2, 5], [MED2, ISOL, 6]],
    [[N, N, 0], [N, ISOL, 2], [ISOL, ISOL, 1], [ISOL, ISOL, 2], [ISOL, FIN2, 5], [ISOL, ISOL, 6]],
    [[N, N, 0], [N, ISOL, 2], [N, ISOL, 1], [N, ISOL, 2], [N, FIN3, 5], [N, ISOL, 6]],
];
function fallbackPlan(plan, font) {
    const lookups = [];
    const features = ['init', 'medi', 'fina', 'isol', 'rlig', 'rlig', 'rlig'];
    for (let i = 0; i < features.length; i++) {
        const mask = plan.map.get1Mask(features[i]);
        if (!mask)
            continue;
        let lookup = null;
        if (i < 4) {
            const single = new Map();
            for (let k = 0; k < arabicShaping.length / 4; k++) {
                const u = ARABIC_SHAPING_FIRST + k, s = arabicShaping[k * 4 + i];
                const ug = font.glyph(u), sg = s && font.glyph(s);
                if (!s || !ug || !sg || ug === sg)
                    continue;
                if (!single.has(ug))
                    single.set(ug, sg);
            }
            if (single.size)
                lookup = syntheticLookup(8, single, null);
        }
        else {
            const table = i === 4 ? arabicLigatures3 : i === 5 ? arabicLigatures : arabicMarkLigatures;
            const ligatures = new Map();
            for (const [first, list] of table) {
                const fg = font.glyph(first);
                if (!fg)
                    continue;
                for (const entry of list) {
                    const lg = font.glyph(entry[entry.length - 1]);
                    if (!lg)
                        continue;
                    const components = entry.slice(0, -1).map(u => font.glyph(u));
                    if (components.some(g => !g))
                        continue;
                    if (!ligatures.has(fg))
                        ligatures.set(fg, []);
                    ligatures.get(fg).push([components, lg]);
                }
            }
            if (ligatures.size)
                lookup = syntheticLookup(i === 6 ? 0 : 8, null, ligatures);
        }
        if (lookup)
            lookups.push([lookup, mask]);
    }
    return lookups;
}
function fallbackShape(plan, font, buffer) {
    const arabic = plan.data;
    if (!arabic.doFallback)
        return;
    arabic.fallback ??= fallbackPlan(plan, font);
    for (const [lookup, mask] of arabic.fallback)
        applySynthetic(buffer, font.gdef, lookup, mask);
}
function recordStch(plan, _font, buffer) {
    if (!plan.data.hasStch)
        return;
    for (const info of buffer.info)
        if (isMultiplied(info)) {
            info.category = ligComp(info) % 2 ? 9 : 8;
            buffer.hasStch = true;
        }
}
function collectFeatures(planner) {
    const map = planner.map;
    map.enableFeature('stch');
    map.addGsubPause(recordStch);
    map.enableFeature('ccmp', 8);
    map.enableFeature('locl', 8);
    map.addGsubPause(null);
    for (const tag of FEATURES) {
        const fallback = planner.script === 'Arab' && !isSyriacFeature(tag);
        map.addFeature(tag, 8 | (fallback ? 2 : 0));
        map.addGsubPause(null);
    }
    map.addGsubPause(null);
    map.enableFeature('rlig', 8 | 2);
    if (planner.script === 'Arab')
        map.addGsubPause(fallbackShape);
    map.enableFeature('calt', 8);
    if (!map.hasFeature('rclt'))
        map.addGsubPause(null);
    map.enableFeature('liga', 8);
    map.enableFeature('clig', 8);
    map.enableFeature('mset', 8);
}
export function dataCreate(plan) {
    const doFallback = plan.script === 'Arab' && FEATURES.every(tag => isSyriacFeature(tag) || plan.map.needsFallback(tag));
    return { masks: [...FEATURES.map(tag => plan.map.get1Mask(tag)), 0], hasStch: !!plan.map.get1Mask('stch'), doFallback, fallback: null };
}
export function arabicJoining(buffer) {
    const info = buffer.info;
    let prev = -1, state = 0;
    for (const u of buffer.context[0]) {
        const type = joiningType(u, unicodeCategory(u));
        if (type === 6)
            continue;
        state = STATES[state][type][2];
        break;
    }
    for (let i = 0; i < info.length; i++) {
        const type = joiningType(info[i].codepoint, generalCategory(info[i]));
        if (type === 6) {
            info[i].category = 7;
            continue;
        }
        const entry = STATES[state][type];
        if (entry[0] !== 7 && prev >= 0)
            info[prev].category = entry[0];
        info[i].category = entry[1];
        prev = i;
        state = entry[2];
    }
    for (const u of buffer.context[1]) {
        const type = joiningType(u, unicodeCategory(u));
        if (type === 6)
            continue;
        const entry = STATES[state][type];
        if (entry[0] !== 7 && prev >= 0)
            info[prev].category = entry[0];
        break;
    }
}
export function setupMasksArabic(arabic, buffer, script) {
    arabicJoining(buffer);
    const info = buffer.info;
    if (script === 'Mong')
        for (let i = 1; i < info.length; i++) {
            const u = info[i].codepoint;
            if (u >= 0x180b && u <= 0x180d || u === 0x180f)
                info[i].category = info[i - 1].category;
        }
    for (const g of info)
        g.mask |= arabic.masks[g.category];
}
const isWord = (category) => [2, 3, 6, 7, 10, 11, 12, 13,
    14, 15, 23, 24, 25, 26].includes(category);
const isStch = (info) => info.category === 8 || info.category === 9;
function applyStch(buffer, font) {
    if (!buffer.hasStch)
        return;
    const rtl = buffer.direction === 5;
    if (!rtl)
        buffer.reverse();
    const MAX_GLYPHS = 256;
    const info = buffer.info, out = [];
    for (let i = info.length; i;) {
        if (!isStch(info[i - 1])) {
            out.push(info[--i]);
            continue;
        }
        let wTotal = 0, wFixed = 0, wRepeating = 0, nFixed = 0, nRepeating = 0;
        const end = i;
        while (i && isStch(info[i - 1])) {
            i--;
            const width = font.advance(info[i].codepoint);
            if (info[i].category === 8) {
                wFixed += width;
                nFixed++;
            }
            else {
                wRepeating += width;
                nRepeating++;
            }
        }
        const start = i;
        let context = i;
        while (context && !isStch(info[context - 1]) && (isDefaultIgnorable(info[context - 1]) || isWord(generalCategory(info[context - 1])))) {
            context--;
            wTotal += info[context].xAdvance;
        }
        let copies = 0;
        const wRemainingSigned = wTotal - wFixed;
        let wRemaining = wTotal - wFixed;
        if (wRemainingSigned > wRepeating && wRepeating > 0)
            copies = Math.trunc(wRemainingSigned / wRepeating) - 1;
        let overlap = 0;
        const shortfall = wRemainingSigned - wRepeating * (copies + 1);
        if (shortfall > 0 && nRepeating > 0) {
            copies++;
            const excess = (copies + 1) * wRepeating - wRemainingSigned;
            if (excess > 0) {
                overlap = Math.trunc(excess / (copies * nRepeating));
                wRemaining = 0;
            }
        }
        let maxCopies = 0;
        if (nRepeating > 0 && nFixed + nRepeating < MAX_GLYPHS)
            maxCopies = Math.trunc((MAX_GLYPHS - nFixed - nRepeating) / nRepeating);
        copies = Math.min(copies, maxCopies);
        let xOffset = Math.trunc(wRemaining / 2);
        for (let k = end; k > start; k--) {
            const width = font.advance(info[k - 1].codepoint);
            const repeat = info[k - 1].category === 9 ? 1 + copies : 1;
            info[k - 1].xAdvance = 0;
            for (let n = 0; n < repeat; n++) {
                if (rtl) {
                    xOffset -= width;
                    if (n > 0)
                        xOffset += overlap;
                }
                info[k - 1].xOffset = xOffset;
                out.push(info[k - 1].clone());
                if (!rtl) {
                    xOffset += width;
                    if (n > 0)
                        xOffset -= overlap;
                }
            }
        }
    }
    out.reverse();
    buffer.info = out;
    if (!rtl)
        buffer.reverse();
}
const MODIFIER_COMBINING_MARKS = new Set([0x0654, 0x0655, 0x0658, 0x06dc, 0x06e3, 0x06e7, 0x06e8, 0x08ca, 0x08cb, 0x08cd, 0x08ce, 0x08cf, 0x08d3, 0x08f3]);
function reorderMarks(_plan, buffer, start, end) {
    const info = buffer.info;
    let i = start;
    for (let cc = 220; cc <= 230; cc += 10) {
        while (i < end && combiningClass(info[i]) < cc)
            i++;
        if (i === end)
            break;
        if (combiningClass(info[i]) > cc)
            continue;
        let j = i;
        while (j < end && combiningClass(info[j]) === cc && MODIFIER_COMBINING_MARKS.has(info[j].codepoint))
            j++;
        if (i === j)
            continue;
        buffer.mergeClusters(start, j);
        const moved = info.slice(i, j);
        info.copyWithin(start + j - i, start, i);
        for (let k = 0; k < moved.length; k++)
            info[start + k] = moved[k];
        const newStart = start + j - i, newCC = cc === 220 ? 25 : 26;
        while (start < newStart)
            setCombiningClass(info[start++], newCC);
        i = j;
    }
}
export const arabicShaper = {
    collectFeatures,
    dataCreate,
    setupMasks: (plan, buffer) => setupMasksArabic(plan.data, buffer, plan.script),
    postprocessGlyphs: (_plan, buffer, font) => applyStch(buffer, font),
    reorderMarks,
    normalization: 4,
    zeroWidthMarks: 2,
    fallbackPosition: true,
};
