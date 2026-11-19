/*!
 * The Universal Shaping Engine, ported from HarfBuzz (hb-ot-shaper-use.cc, hb-ot-shaper-use-machine.rl)
 * Copyright © 2015 Mozilla Foundation, © 2015 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and
 * licenses/HarfBuzz.txt)
 */
import { isLigated, isSubstituted, ligComp, isUnicodeMark, isMark } from "../buffer.js";
import { compose, unicodeCategory } from "../shape.js";
import { useCategory } from "../unicode-data.js";
import { value } from "../unicode.js";
import { lazyScanner, cat, seq, alt, opt, star, plus, any } from "./machine.js";
import { forEachSyllable, insertDottedCircles, vowelConstraintsPreprocess } from "./syllabic.js";
import { dataCreate as arabicDataCreate, setupMasksArabic } from "./arabic.js";
const CATEGORIES = {
    O: 0, B: 1, N: 4, GB: 5, CGJ: 6, SUB: 11, H: 12, HN: 13, ZWNJ: 14, WJ: 16, R: 18, CS: 43, IS: 44, Sk: 48, G: 49,
    J: 50, SB: 51, SE: 52, HVM: 53, HM: 54, HR: 55, RK: 56, FAbv: 24, FBlw: 25, FPst: 26, MAbv: 27, MBlw: 28,
    MPst: 29, MPre: 30, CMAbv: 31, CMBlw: 32, VAbv: 33, VBlw: 34, VPst: 35, VPre: 22, VMAbv: 37, VMBlw: 38,
    VMPst: 39, VMPre: 23, SMAbv: 41, SMBlw: 42, FMAbv: 45, FMBlw: 46, FMPst: 47,
};
const findSyllables = lazyScanner(() => {
    const s = (...c) => star(cat(...c));
    const h = cat(12, 53, 44, 48);
    const consonantModifiers = seq(s(31), s(32), star(alt(seq(h, cat(1)), cat(11)), s(31), s(32)));
    const medialConsonants = seq(opt(cat(30)), opt(cat(27)), opt(cat(28)), opt(cat(29)));
    const dependentVowels = alt(seq(s(22), s(33), s(34), s(35)), cat(12));
    const vowelModifiers = seq(opt(cat(53)), s(23), s(37), s(38), s(39));
    const finalConsonants = seq(s(24), s(25), s(26));
    const finalModifiers = alt(seq(s(45), s(46)), opt(cat(47)));
    const complexSyllableStart = seq(opt(cat(18, 43)), cat(1, 5));
    const complexSyllableMiddle = seq(consonantModifiers, medialConsonants, dependentVowels, vowelModifiers, star(cat(48), cat(1)));
    const complexSyllableTail = seq(complexSyllableMiddle, finalConsonants, finalModifiers);
    const numberJoinerTerminatedClusterTail = seq(star(cat(13), cat(4)), cat(13));
    const numeralClusterTail = plus(cat(13), cat(4));
    const symbolClusterTail = alt(seq(plus(cat(41)), s(42)), plus(cat(42)));
    const viramaTerminatedClusterTail = seq(consonantModifiers, cat(44, 56));
    const viramaTerminatedCluster = seq(complexSyllableStart, viramaTerminatedClusterTail);
    const sakotTerminatedClusterTail = seq(complexSyllableMiddle, cat(48));
    const sakotTerminatedCluster = seq(complexSyllableStart, sakotTerminatedClusterTail);
    const standardCluster = seq(complexSyllableStart, complexSyllableTail);
    const tail = alt(complexSyllableTail, sakotTerminatedClusterTail, symbolClusterTail, viramaTerminatedClusterTail);
    const brokenCluster = seq(opt(cat(18)), alt(tail, numberJoinerTerminatedClusterTail, numeralClusterTail));
    const numberJoinerTerminatedCluster = seq(cat(4), numberJoinerTerminatedClusterTail);
    const numeralCluster = seq(cat(4), opt(numeralClusterTail));
    const symbolCluster = seq(cat(0, 5, 51), opt(tail));
    const g = seq(cat(49), opt(cat(55)), opt(cat(54)), s(52));
    const hieroglyphCluster = seq(s(51), g, star(cat(50), s(51), opt(g)));
    const zwnj = opt(cat(14));
    return [
        [seq(viramaTerminatedCluster, zwnj), 0],
        [seq(sakotTerminatedCluster, zwnj), 1],
        [seq(standardCluster, zwnj), 2],
        [seq(numberJoinerTerminatedCluster, zwnj), 3],
        [seq(numeralCluster, zwnj), 4],
        [seq(symbolCluster, zwnj), 5],
        [seq(hieroglyphCluster, zwnj), 6],
        [cat(47), 8],
        [seq(brokenCluster, zwnj), 7],
        [any, 8],
    ];
});
function setupSyllables(plan, _font, buffer) {
    const info = buffer.info, kept = [];
    for (let i = 0; i < info.length; i++) {
        if (info[i].category === 6)
            continue;
        if (info[i].category === 14) {
            let j = i + 1;
            while (j < info.length && info[j].category === 6)
                j++;
            if (j < info.length && isUnicodeMark(info[j]))
                continue;
        }
        kept.push(i);
    }
    let serial = 1;
    for (const [start, end, type] of findSyllables(kept.map(i => info[i].category))) {
        const from = kept[start], to = end < kept.length ? kept[end] : info.length;
        for (let i = from; i < to; i++)
            info[i].syllable = serial << 4 | type;
        if (type === 7)
            buffer.hasBrokenSyllable = true;
        if (++serial === 16)
            serial = 1;
    }
    setupRphfMask(plan, buffer);
    setupTopographicalMasks(plan, buffer);
}
function setupRphfMask(plan, buffer) {
    const mask = plan.data.rphfMask;
    if (!mask)
        return;
    const info = buffer.info;
    forEachSyllable(buffer, (start, end) => {
        const limit = info[start].category === 18 ? 1 : Math.min(3, end - start);
        for (let i = start; i < start + limit; i++)
            info[i].mask |= mask;
    });
}
const TOPOGRAPHICAL = ['isol', 'init', 'medi', 'fina'];
function setupTopographicalMasks(plan, buffer) {
    if (plan.data.arabic)
        return;
    const masks = TOPOGRAPHICAL.map(tag => {
        const m = plan.map.get1Mask(tag);
        return m === plan.map.globalMask ? 0 : m;
    });
    const all = masks.reduce((a, b) => a | b, 0);
    if (!all)
        return;
    const others = ~all, info = buffer.info;
    let lastStart = 0, lastForm = 4;
    forEachSyllable(buffer, (start, end) => {
        const type = info[start].syllable & 0x0f;
        if (type === 6 || type === 8)
            lastForm = 4;
        else {
            const join = lastForm === 3 || lastForm === 0;
            if (join) {
                lastForm = lastForm === 3 ? 2 : 1;
                for (let i = lastStart; i < start; i++)
                    info[i].mask = info[i].mask & others | masks[lastForm];
            }
            lastForm = join ? 3 : 0;
            for (let i = start; i < end; i++)
                info[i].mask = info[i].mask & others | masks[lastForm];
        }
        lastStart = start;
    });
}
function clearSubstitutionFlags(_plan, _font, buffer) {
    for (const info of buffer.info)
        info.glyphProps &= ~16;
}
function recordRphf(plan, _font, buffer) {
    const mask = plan.data.rphfMask;
    if (!mask)
        return;
    const info = buffer.info;
    forEachSyllable(buffer, (start, end) => {
        for (let i = start; i < end && info[i].mask & mask; i++)
            if (isSubstituted(info[i])) {
                info[i].category = 18;
                break;
            }
    });
}
function recordPref(_plan, _font, buffer) {
    const info = buffer.info;
    forEachSyllable(buffer, (start, end) => {
        for (let i = start; i < end; i++)
            if (isSubstituted(info[i])) {
                info[i].category = 22;
                break;
            }
    });
}
const isHalant = (info) => (info.category === 12 || info.category === 53 || info.category === 44) && !isLigated(info);
const POST_BASE = new Set([24, 25, 26, 45, 46, 47, 27, 28, 29, 30, 33, 34, 35, 22, 37,
    38, 39, 23]);
const REORDERED = new Set([0, 1, 2, 5, 7]);
function reorderSyllable(buffer, start, end) {
    const info = buffer.info;
    if (!REORDERED.has(info[start].syllable & 0x0f))
        return;
    if (info[start].category === 18 && end - start > 1)
        for (let i = start + 1; i < end; i++) {
            const postBase = POST_BASE.has(info[i].category) || isHalant(info[i]);
            if (postBase || i === end - 1) {
                if (postBase)
                    i--;
                buffer.mergeClusters(start, i + 1);
                const t = info[start];
                for (let k = start; k < i; k++)
                    info[k] = info[k + 1];
                info[i] = t;
                break;
            }
        }
    let j = start;
    for (let i = start; i < end; i++) {
        const category = info[i].category;
        if (isHalant(info[i]))
            j = i + 1;
        else if ((category === 22 || category === 23) && ligComp(info[i]) === 0 && j < i) {
            buffer.mergeClusters(j, i + 1);
            const t = info[i];
            for (let k = i; k > j; k--)
                info[k] = info[k - 1];
            info[j] = t;
        }
    }
}
function reorder(_plan, font, buffer) {
    insertDottedCircles(font, buffer, 7, 1, 18, -1);
    forEachSyllable(buffer, (start, end) => reorderSyllable(buffer, start, end));
}
function collectFeatures(planner) {
    const map = planner.map;
    map.addGsubPause(setupSyllables);
    map.enableFeature('locl', 64);
    map.enableFeature('ccmp', 64);
    map.enableFeature('nukt', 64);
    map.enableFeature('akhn', 8 | 64);
    map.addGsubPause(clearSubstitutionFlags);
    map.addFeature('rphf', 8 | 64);
    map.addGsubPause(recordRphf);
    map.addGsubPause(clearSubstitutionFlags);
    map.enableFeature('pref', 8 | 64);
    map.addGsubPause(recordPref);
    for (const tag of ['rkrf', 'abvf', 'blwf', 'half', 'pstf', 'vatu', 'cjct'])
        map.enableFeature(tag, 8 | 64);
    map.addGsubPause(reorder);
    map.addGsubPause(null);
    for (const tag of TOPOGRAPHICAL)
        map.addFeature(tag);
    map.addGsubPause(null);
    for (const tag of ['abvs', 'blws', 'haln', 'pres', 'psts'])
        map.enableFeature(tag, 8);
}
const ARABIC_JOINING = new Set(['Adlm', 'Arab', 'Chrs', 'Rohg', 'Mand', 'Mani', 'Mong', 'Nkoo', 'Ougr', 'Phag', 'Phlp', 'Sogd', 'Syrc']);
export const useShaper = {
    collectFeatures,
    dataCreate: (plan) => ({ rphfMask: plan.map.get1Mask('rphf'), arabic: ARABIC_JOINING.has(plan.script) ? arabicDataCreate(plan) : null }),
    preprocessText: (_plan, buffer) => vowelConstraintsPreprocess(buffer),
    compose: (_c, a, b) => isMark(unicodeCategory(a)) ? 0 : compose(a, b),
    setupMasks: (plan, buffer) => {
        const use = plan.data;
        if (use.arabic)
            setupMasksArabic(use.arabic, buffer, plan.script);
        for (const info of buffer.info)
            info.category = CATEGORIES[value(useCategory, info.codepoint)];
    },
    normalization: 3,
    zeroWidthMarks: 1,
    fallbackPosition: false,
};
