/*!
 * The Indic shaper (Bengali, Devanagari, Gujarati, Gurmukhi, Kannada, Malayalam, Oriya, Tamil, Telugu), ported from
 * HarfBuzz (hb-ot-shaper-indic.cc, hb-ot-shaper-indic-machine.rl)
 * Copyright © 2011,2012 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
import { isLigated, isSubstituted, isMultiplied, generalCategory, isMark } from "../buffer.js";
import { decompose, compose, unicodeCategory } from "../shape.js";
import { indicCategory } from "../unicode-data.js";
import { value } from "../unicode.js";
import { lazyScanner, cat, seq, alt, opt, star, any } from "./machine.js";
import { forEachSyllable, insertDottedCircles, vowelConstraintsPreprocess } from "./syllabic.js";
const CATEGORY_NAMES = {
    X: 0, C: 1, V: 2, N: 3, H: 4, ZWNJ: 5, ZWJ: 6, M: 7, SM: 8, A: 9, VD: 9, PLACEHOLDER: 10,
    DOTTEDCIRCLE: 11, RS: 12, MPst: 13, Repha: 14, Ra: 15, CM: 16, Symbol: 17, CS: 18, VAbv: 20, VBlw: 21,
    VPre: 22, VPst: 23, Robatic: 25, Xgroup: 26, Ygroup: 27, IV: 2, DB: 3, GB: 10, As: 32, MH: 35, MR: 36,
    MW: 37, MY: 38, PT: 39, VS: 40, ML: 41, SMPst: 57,
};
const POSITION_NAMES = {
    START: 0, RA_TO_BECOME_REPH: 1, PRE_M: 2, PRE_C: 3, BASE_C: 4, AFTER_MAIN: 5,
    ABOVE_C: 6, BEFORE_SUB: 7, BELOW_C: 8, AFTER_SUB: 9, BEFORE_POST: 10, POST_C: 11,
    AFTER_POST: 12, SMVD: 13, END: 14,
};
const properties = new Map();
export function indicProperties(u) {
    const v = value(indicCategory, u);
    let p = properties.get(v);
    if (!p) {
        const [category, position] = v.split('/');
        properties.set(v, p = [CATEGORY_NAMES[category], POSITION_NAMES[position]]);
    }
    return p;
}
export function setIndicProperties(info) {
    [info.category, info.position] = indicProperties(info.codepoint);
}
export const isOneOf = (info, categories) => !isLigated(info) && categories.includes(info.category);
const CONSONANTS = [1, 18, 15, 16, 2, 10, 11];
const JOINERS = [6, 5];
const isConsonant = (info) => isOneOf(info, CONSONANTS);
const isJoiner = (info) => isOneOf(info, JOINERS);
const isHalant = (info) => isOneOf(info, [4]);
const findSyllables = lazyScanner(() => {
    const c = cat(1, 15);
    const n = seq(opt(opt(cat(5)), cat(12)), opt(cat(3), opt(cat(3))));
    const z = cat(6, 5);
    const reph = alt(seq(cat(15), cat(4)), cat(14));
    const sm = cat(8, 57);
    const cn = seq(c, opt(cat(6)), opt(n));
    const symbol = seq(cat(17), opt(cat(3)));
    const matraGroup = seq(star(z), alt(cat(7), seq(opt(sm), cat(13))), opt(cat(3)), opt(cat(4)));
    const syllableTail = seq(opt(opt(z), sm, opt(sm), opt(cat(5))), star(cat(9, 9)));
    const halantGroup = seq(opt(z), cat(4), opt(cat(6), opt(cat(3))));
    const finalHalantGroup = alt(halantGroup, seq(cat(4), cat(5)));
    const medialGroup = opt(cat(16));
    const halantOrMatraGroup = alt(finalHalantGroup, star(matraGroup));
    const complexSyllableTail = seq(star(halantGroup, cn), medialGroup, halantOrMatraGroup, syllableTail);
    const consonantSyllable = seq(opt(cat(14, 18)), cn, complexSyllableTail);
    const vowelSyllable = seq(opt(reph), cat(2), opt(n), alt(cat(6), complexSyllableTail));
    const standaloneCluster = seq(alt(seq(opt(cat(14, 18)), cat(10)), seq(opt(reph), cat(11))), opt(n), complexSyllableTail);
    const symbolCluster = seq(symbol, syllableTail);
    const brokenCluster = seq(opt(reph), opt(n), complexSyllableTail);
    return [
        [consonantSyllable, 0],
        [vowelSyllable, 1],
        [standaloneCluster, 2],
        [symbolCluster, 3],
        [cat(57), 5],
        [brokenCluster, 4],
        [any, 5],
    ];
});
export function setSyllables(buffer, syllables, broken) {
    let serial = 1;
    for (const [start, end, type] of syllables) {
        for (let i = start; i < end; i++)
            buffer.info[i].syllable = serial << 4 | type;
        if (type === broken)
            buffer.hasBrokenSyllable = true;
        if (++serial === 16)
            serial = 1;
    }
}
const DEFAULT_CONFIG = { hasOldSpec: false, virama: 0, rephPos: 10, rephMode: 0, blwfMode: 0 };
const CONFIGS = {
    Deva: { hasOldSpec: true, virama: 0x094d, rephPos: 10, rephMode: 0, blwfMode: 0 },
    Beng: { hasOldSpec: true, virama: 0x09cd, rephPos: 9, rephMode: 0, blwfMode: 0 },
    Guru: { hasOldSpec: true, virama: 0x0a4d, rephPos: 7, rephMode: 0, blwfMode: 0 },
    Gujr: { hasOldSpec: true, virama: 0x0acd, rephPos: 10, rephMode: 0, blwfMode: 0 },
    Orya: { hasOldSpec: true, virama: 0x0b4d, rephPos: 5, rephMode: 0, blwfMode: 0 },
    Taml: { hasOldSpec: true, virama: 0x0bcd, rephPos: 12, rephMode: 0, blwfMode: 0 },
    Telu: { hasOldSpec: true, virama: 0x0c4d, rephPos: 12, rephMode: 1, blwfMode: 1 },
    Knda: { hasOldSpec: true, virama: 0x0ccd, rephPos: 12, rephMode: 0, blwfMode: 1 },
    Mlym: { hasOldSpec: true, virama: 0x0d4d, rephPos: 5, rephMode: 2, blwfMode: 0 },
};
const FEATURES = [
    ['nukt', 13 | 64],
    ['akhn', 13 | 64],
    ['rphf', 12 | 64],
    ['rkrf', 13 | 64],
    ['pref', 12 | 64],
    ['blwf', 12 | 64],
    ['abvf', 12 | 64],
    ['half', 12 | 64],
    ['pstf', 12 | 64],
    ['vatu', 13 | 64],
    ['cjct', 13 | 64],
    ['init', 12 | 64],
    ['pres', 13 | 64],
    ['abvs', 13 | 64],
    ['blws', 13 | 64],
    ['psts', 13 | 64],
    ['haln', 13 | 64],
];
export class WouldSubstitute {
    zeroContext;
    lookups;
    constructor(plan, tag, zeroContext) {
        this.zeroContext = zeroContext;
        this.lookups = plan.map.stageLookups(0, tag).map(l => l.index);
    }
    would(font, glyphs) {
        if (!font.gsub)
            return false;
        for (const index of this.lookups) {
            const l = font.gsub.lookup(index);
            if (l && l.would(glyphs, this.zeroContext))
                return true;
        }
        return false;
    }
}
function collectFeatures(planner) {
    const map = planner.map;
    map.addGsubPause(setupSyllables);
    map.enableFeature('locl', 64);
    map.enableFeature('ccmp', 64);
    map.addGsubPause(initialReordering);
    let i = 0;
    for (; i < 11; i++) {
        map.addFeature(FEATURES[i][0], FEATURES[i][1]);
        map.addGsubPause(null);
    }
    map.addGsubPause(finalReordering);
    for (; i < 17; i++)
        map.addFeature(FEATURES[i][0], FEATURES[i][1]);
}
function overrideFeatures(planner) {
    planner.map.disableFeature('liga');
    planner.map.addGsubPause(null);
}
function dataCreate(plan) {
    const config = CONFIGS[plan.script] ?? DEFAULT_CONFIG;
    const isOldSpec = config.hasOldSpec && plan.map.chosenScript[0][3] !== '2';
    const zeroContext = !isOldSpec && plan.script !== 'Mlym';
    return {
        config, isOldSpec, viramaGlyph: -1,
        rphf: new WouldSubstitute(plan, 'rphf', zeroContext),
        pref: new WouldSubstitute(plan, 'pref', zeroContext),
        blwf: new WouldSubstitute(plan, 'blwf', zeroContext),
        pstf: new WouldSubstitute(plan, 'pstf', zeroContext),
        vatu: new WouldSubstitute(plan, 'vatu', zeroContext),
        masks: FEATURES.map(([tag, flags]) => flags & 1 ? 0 : plan.map.get1Mask(tag)),
    };
}
function viramaGlyph(indic, font) {
    if (indic.viramaGlyph === -1)
        indic.viramaGlyph = indic.config.virama ? font.glyph(indic.config.virama) : 0;
    return indic.viramaGlyph;
}
function consonantPositionFromFace(indic, consonant, virama, font) {
    const a = [virama, consonant], b = [consonant, virama];
    if (indic.blwf.would(font, a) || indic.blwf.would(font, b) || indic.vatu.would(font, a) || indic.vatu.would(font, b))
        return 8;
    if (indic.pstf.would(font, a) || indic.pstf.would(font, b))
        return 11;
    if (indic.pref.would(font, a) || indic.pref.would(font, b))
        return 11;
    return 4;
}
function setupSyllables(_plan, _font, buffer) {
    setSyllables(buffer, findSyllables(buffer.info.map(info => info.category)), 4);
}
function initialReorderingConsonantSyllable(plan, font, buffer, start, end) {
    const indic = plan.data, info = buffer.info;
    if (buffer.script === 'Knda' && start + 3 <= end && isOneOf(info[start], [15]) && isOneOf(info[start + 1], [4]) && isOneOf(info[start + 2], [6])) {
        buffer.mergeClusters(start + 1, start + 3);
        [info[start + 1], info[start + 2]] = [info[start + 2], info[start + 1]];
    }
    let base = end, hasReph = false;
    {
        let limit = start;
        const config = indic.config;
        if (indic.masks[2] && start + 3 <= end
            && (config.rephMode === 0 && !isJoiner(info[start + 2]) || config.rephMode === 1 && info[start + 2].category === 6)) {
            const glyphs = [info[start].codepoint, info[start + 1].codepoint, config.rephMode === 1 ? info[start + 2].codepoint : 0];
            if (indic.rphf.would(font, glyphs.slice(0, 2)) || config.rephMode === 1 && indic.rphf.would(font, glyphs)) {
                limit += 2;
                while (limit < end && isJoiner(info[limit]))
                    limit++;
                base = start;
                hasReph = true;
            }
        }
        else if (config.rephMode === 2 && info[start].category === 14) {
            limit += 1;
            while (limit < end && isJoiner(info[limit]))
                limit++;
            base = start;
            hasReph = true;
        }
        let i = end, seenBelow = false;
        do {
            i--;
            if (isConsonant(info[i])) {
                if (info[i].position !== 8 && (info[i].position !== 11 || seenBelow)) {
                    base = i;
                    break;
                }
                if (info[i].position === 8)
                    seenBelow = true;
                base = i;
            }
            else if (start < i && info[i].category === 6 && info[i - 1].category === 4)
                break;
        } while (i > limit);
        if (hasReph && base === start && limit - base <= 2)
            hasReph = false;
    }
    for (let i = start; i < base; i++)
        info[i].position = Math.min(3, info[i].position);
    if (base < end)
        info[base].position = 4;
    if (hasReph)
        info[start].position = 1;
    if (indic.isOldSpec) {
        const disallowDoubleHalants = buffer.script === 'Knda';
        for (let i = base + 1; i < end; i++)
            if (info[i].category === 4) {
                let j = end - 1;
                for (; j > i; j--)
                    if (isConsonant(info[j]) || disallowDoubleHalants && info[j].category === 4)
                        break;
                if (info[j].category !== 4 && j > i) {
                    const t = info[i];
                    for (let k = i; k < j; k++)
                        info[k] = info[k + 1];
                    info[j] = t;
                }
                break;
            }
    }
    {
        let lastPos = 0;
        for (let i = start; i < end; i++) {
            const category = info[i].category;
            if ([6, 5, 3, 12, 16, 4].includes(category)) {
                info[i].position = lastPos;
                if (category === 4 && info[i].position === 2)
                    for (let j = i; j > start; j--)
                        if (info[j - 1].position !== 2) {
                            info[i].position = info[j - 1].position;
                            break;
                        }
            }
            else if (info[i].position !== 13) {
                if (category === 13 && i > start && info[i - 1].category === 8)
                    info[i - 1].position = info[i].position;
                lastPos = info[i].position;
            }
        }
    }
    {
        let last = base;
        for (let i = base + 1; i < end; i++)
            if (isConsonant(info[i])) {
                for (let j = last + 1; j < i; j++)
                    if (info[j].position < 13)
                        info[j].position = info[i].position;
                last = i;
            }
            else if (info[i].category === 7 || info[i].category === 13)
                last = i;
    }
    {
        const syllable = info[start].syllable;
        for (let i = start; i < end; i++)
            info[i].syllable = i - start;
        const sorted = info.slice(start, end).sort((a, b) => a.position - b.position || a.syllable - b.syllable);
        for (let i = start; i < end; i++)
            info[i] = sorted[i - start];
        let firstLeftMatra = end, lastLeftMatra = end;
        base = end;
        for (let i = start; i < end; i++) {
            if (info[i].position === 4) {
                base = i;
                break;
            }
            else if (info[i].position === 2) {
                if (firstLeftMatra === end)
                    firstLeftMatra = i;
                lastLeftMatra = i;
            }
        }
        if (firstLeftMatra < lastLeftMatra) {
            buffer.reverseRange(firstLeftMatra, lastLeftMatra + 1);
            let i = firstLeftMatra;
            for (let j = i; j <= lastLeftMatra; j++)
                if (info[j].category === 7 || info[j].category === 13) {
                    buffer.reverseRange(i, j + 1);
                    i = j + 1;
                }
        }
        if (indic.isOldSpec || end - start > 127)
            buffer.mergeClusters(base, end);
        else {
            for (let i = base; i < end; i++)
                if (info[i].syllable !== 255) {
                    let min = i, max = i, j = start + info[i].syllable;
                    while (j !== i) {
                        min = Math.min(min, j);
                        max = Math.max(max, j);
                        const next = start + info[j].syllable;
                        info[j].syllable = 255;
                        j = next;
                    }
                    buffer.mergeClusters(Math.max(base, min), max + 1);
                }
        }
        for (let i = start; i < end; i++)
            info[i].syllable = syllable;
    }
    for (let i = start; i < end && info[i].position === 1; i++)
        info[i].mask |= indic.masks[2];
    let mask = indic.masks[7];
    if (!indic.isOldSpec && indic.config.blwfMode === 0)
        mask |= indic.masks[5];
    for (let i = start; i < base; i++)
        info[i].mask |= mask;
    mask = indic.masks[5] | indic.masks[6] | indic.masks[8];
    for (let i = base + 1; i < end; i++)
        info[i].mask |= mask;
    if (indic.isOldSpec && buffer.script === 'Deva')
        for (let i = start; i + 1 < base; i++)
            if (info[i].category === 15 && info[i + 1].category === 4 && (i + 2 === base || info[i + 2].category !== 6)) {
                info[i].mask |= indic.masks[5];
                info[i + 1].mask |= indic.masks[5];
            }
    const prefLength = 2;
    if (indic.masks[4] && base + prefLength < end)
        for (let i = base + 1; i + prefLength - 1 < end; i++) {
            if (indic.pref.would(font, [info[i].codepoint, info[i + 1].codepoint])) {
                for (let j = 0; j < prefLength; j++)
                    info[i++].mask |= indic.masks[4];
                break;
            }
        }
    for (let i = start + 1; i < end; i++)
        if (isJoiner(info[i])) {
            const nonJoiner = info[i].category === 5;
            let j = i;
            do {
                j--;
                if (nonJoiner)
                    info[j].mask &= ~indic.masks[7];
            } while (j > start && !isConsonant(info[j]));
        }
}
function initialReordering(plan, font, buffer) {
    const indic = plan.data;
    const virama = viramaGlyph(indic, font);
    if (virama)
        for (const info of buffer.info)
            if (info.position === 4)
                info.position = consonantPositionFromFace(indic, info.codepoint, virama, font);
    insertDottedCircles(font, buffer, 4, 11, 14, 14);
    forEachSyllable(buffer, (start, end) => {
        const type = buffer.info[start].syllable & 0x0f;
        if (type === 0 || type === 1 || type === 4 || type === 2)
            initialReorderingConsonantSyllable(plan, font, buffer, start, end);
    });
}
function finalReorderingSyllable(plan, buffer, start, end) {
    const indic = plan.data, info = buffer.info;
    const virama = indic.viramaGlyph;
    if (virama > 0)
        for (let i = start; i < end; i++)
            if (info[i].codepoint === virama && isLigated(info[i]) && isMultiplied(info[i])) {
                info[i].category = 4;
                info[i].glyphProps &= ~(32 | 64);
            }
    let tryPref = !!indic.masks[4];
    let base = start;
    for (; base < end; base++)
        if (info[base].position >= 4) {
            if (tryPref && base + 1 < end) {
                for (let i = base + 1; i < end; i++)
                    if (info[i].mask & indic.masks[4]) {
                        if (!(isSubstituted(info[i]) && isLigated(info[i]) && !isMultiplied(info[i]))) {
                            base = i;
                            while (base < end && isHalant(info[base]))
                                base++;
                            if (base < end)
                                info[base].position = 4;
                            tryPref = false;
                        }
                        break;
                    }
                if (base === end)
                    break;
            }
            if (buffer.script === 'Mlym')
                for (let i = base + 1; i < end; i++) {
                    while (i < end && isJoiner(info[i]))
                        i++;
                    if (i === end || !isHalant(info[i]))
                        break;
                    i++;
                    while (i < end && isJoiner(info[i]))
                        i++;
                    if (i < end && isConsonant(info[i]) && info[i].position === 8) {
                        base = i;
                        info[base].position = 4;
                    }
                }
            if (start < base && info[base].position > 4)
                base--;
            break;
        }
    if (base === end && start < base && isOneOf(info[base - 1], [6]))
        base--;
    if (base < end)
        while (start < base && isOneOf(info[base], [3, 4]))
            base--;
    if (start + 1 < end && start < base) {
        let newPos = base === end ? base - 2 : base - 1;
        if (buffer.script !== 'Mlym' && buffer.script !== 'Taml') {
            for (;;) {
                while (newPos > start && !isOneOf(info[newPos], [7, 13, 4]))
                    newPos--;
                if (isHalant(info[newPos]) && info[newPos].position !== 2) {
                    if (newPos + 1 < end && info[newPos + 1].category === 6 && newPos > start) {
                        newPos--;
                        continue;
                    }
                }
                else
                    newPos = start;
                break;
            }
        }
        if (start < newPos && info[newPos].position !== 2) {
            for (let i = newPos; i > start; i--)
                if (info[i - 1].position === 2) {
                    const oldPos = i - 1;
                    if (oldPos < base && base <= newPos)
                        base--;
                    const tmp = info[oldPos];
                    for (let k = oldPos; k < newPos; k++)
                        info[k] = info[k + 1];
                    info[newPos] = tmp;
                    buffer.mergeClusters(newPos, Math.min(end, base + 1));
                    newPos--;
                }
        }
        else {
            for (let i = start; i < base; i++)
                if (info[i].position === 2) {
                    buffer.mergeClusters(i, Math.min(end, base + 1));
                    break;
                }
        }
    }
    if (start + 1 < end && info[start].position === 1
        && (info[start].category === 14) !== (isLigated(info[start]) && !isMultiplied(info[start]))) {
        const rephPos = indic.config.rephPos;
        let newRephPos = -1;
        const afterHalant = () => {
            let p = start + 1;
            while (p < base && !isHalant(info[p]))
                p++;
            if (p < base && isHalant(info[p])) {
                if (p + 1 < base && isJoiner(info[p + 1]))
                    p++;
                return p;
            }
            return -1;
        };
        if (rephPos !== 12)
            newRephPos = afterHalant();
        if (newRephPos < 0 && rephPos === 5) {
            let p = base;
            while (p + 1 < end && info[p + 1].position <= 5)
                p++;
            if (p < end)
                newRephPos = p;
        }
        if (newRephPos < 0 && rephPos === 9) {
            let p = base;
            while (p + 1 < end && ![11, 12, 13].includes(info[p + 1].position))
                p++;
            if (p < end)
                newRephPos = p;
        }
        if (newRephPos < 0)
            newRephPos = afterHalant();
        if (newRephPos < 0) {
            newRephPos = end - 1;
            while (newRephPos > start && info[newRephPos].position === 13)
                newRephPos--;
            if (isHalant(info[newRephPos]))
                for (let i = base + 1; i < newRephPos; i++)
                    if (info[i].category === 7 || info[i].category === 13)
                        newRephPos--;
        }
        buffer.mergeClusters(start, newRephPos + 1);
        const reph = info[start];
        for (let k = start; k < newRephPos; k++)
            info[k] = info[k + 1];
        info[newRephPos] = reph;
        if (start < base && base <= newRephPos)
            base--;
    }
    if (tryPref && base + 1 < end)
        for (let i = base + 1; i < end; i++)
            if (info[i].mask & indic.masks[4]) {
                if (isLigated(info[i]) && !isMultiplied(info[i])) {
                    let newPos = base;
                    if (buffer.script !== 'Mlym' && buffer.script !== 'Taml')
                        while (newPos > start && !isOneOf(info[newPos - 1], [7, 13, 4]))
                            newPos--;
                    if (newPos > start && isHalant(info[newPos - 1]) && newPos < end && isJoiner(info[newPos]))
                        newPos++;
                    const oldPos = i;
                    buffer.mergeClusters(newPos, oldPos + 1);
                    const tmp = info[oldPos];
                    for (let k = oldPos; k > newPos; k--)
                        info[k] = info[k - 1];
                    info[newPos] = tmp;
                    if (newPos <= base && base < oldPos)
                        base++;
                }
                break;
            }
    if (info[start].position === 2) {
        const c = start ? generalCategory(info[start - 1]) : -1;
        if (!start || !(c >= 1 && c <= 12))
            info[start].mask |= indic.masks[11];
    }
}
function finalReordering(plan, _font, buffer) {
    if (!buffer.len)
        return;
    forEachSyllable(buffer, (start, end) => finalReorderingSyllable(plan, buffer, start, end));
}
export const indicShaper = {
    collectFeatures,
    overrideFeatures,
    dataCreate,
    preprocessText: (_plan, buffer) => vowelConstraintsPreprocess(buffer),
    decompose: (_c, ab) => {
        if (ab === 0x0931 || ab === 0x09dc || ab === 0x09dd || ab === 0x0b94)
            return null;
        return decompose(ab);
    },
    compose: (_c, a, b) => {
        if (isMark(unicodeCategory(a)))
            return 0;
        if (a === 0x09af && b === 0x09bc)
            return 0x09df;
        return compose(a, b);
    },
    setupMasks: (_plan, buffer) => {
        for (const info of buffer.info)
            setIndicProperties(info);
    },
    normalization: 3,
    zeroWidthMarks: 0,
    fallbackPosition: false,
};
