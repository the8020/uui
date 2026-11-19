/*!
 * The Myanmar shaper, ported from HarfBuzz (hb-ot-shaper-myanmar.cc, hb-ot-shaper-myanmar-machine.rl)
 * Copyright © 2011,2012,2013 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
import { lazyScanner, cat, seq, alt, opt, star, any } from "./machine.js";
import { forEachSyllable, insertDottedCircles } from "./syllabic.js";
import { indicProperties, isOneOf, setSyllables } from "./indic.js";
const findSyllables = lazyScanner(() => {
    const j = cat(6, 5);
    const k = seq(cat(15), cat(32), cat(4));
    const sm = cat(8, 57);
    const c = cat(1, 15);
    const medialGroup = seq(opt(cat(38)), opt(cat(32)), opt(cat(36)), opt(alt(seq(cat(37), opt(cat(35)), opt(cat(41))), seq(cat(35), opt(cat(41))), cat(41)), opt(cat(32))));
    const mainVowelGroup = seq(star(cat(22), opt(cat(40))), star(cat(20)), star(cat(21)), star(cat(9)), opt(cat(3), opt(cat(32))));
    const postVowelGroup = seq(cat(23), opt(cat(35)), opt(cat(41)), star(cat(32)), star(cat(20)), star(cat(9)), opt(cat(3), opt(cat(32))));
    const toneGroup = alt(sm, seq(cat(39), star(cat(9)), opt(cat(3)), opt(cat(32))));
    const complexSyllableTail = seq(star(cat(32)), medialGroup, mainVowelGroup, star(postVowelGroup), star(toneGroup), opt(j));
    const syllableTail = seq(star(cat(4), alt(c, cat(2)), opt(cat(40))), alt(cat(4), complexSyllableTail));
    const consonantSyllable = seq(opt(alt(k, cat(18))), alt(c, cat(2), cat(10), cat(11)), opt(cat(40)), syllableTail);
    const brokenCluster = seq(opt(k), opt(cat(40)), syllableTail);
    return [
        [consonantSyllable, 0],
        [alt(j, cat(57)), 2],
        [brokenCluster, 1],
        [any, 2],
    ];
});
const CONSONANTS = [1, 18, 15, 2, 10, 11];
const isConsonant = (info) => isOneOf(info, CONSONANTS);
function reorderConsonantSyllable(buffer, start, end) {
    const info = buffer.info;
    let base = end, hasReph = false, limit = start;
    if (start + 3 <= end && info[start].category === 15 && info[start + 1].category === 32 && info[start + 2].category === 4) {
        limit += 3;
        base = start;
        hasReph = true;
    }
    if (!hasReph)
        base = limit;
    for (let i = limit; i < end; i++)
        if (isConsonant(info[i])) {
            base = i;
            break;
        }
    let i = start;
    for (; i < start + (hasReph ? 3 : 0); i++)
        info[i].position = 5;
    for (; i < base; i++)
        info[i].position = 3;
    if (i < end)
        info[i++].position = 4;
    let pos = 5;
    for (; i < end; i++) {
        const category = info[i].category;
        if (category === 36)
            info[i].position = 3;
        else if (category === 22)
            info[i].position = 2;
        else if (category === 40)
            info[i].position = info[i - 1].position;
        else if (pos === 5 && category === 21)
            info[i].position = pos = 8;
        else if (pos === 8 && category === 9)
            info[i].position = 7;
        else if (pos === 8 && category === 21)
            info[i].position = pos;
        else if (pos === 8)
            info[i].position = pos = 9;
        else
            info[i].position = pos;
    }
    buffer.sort(start, end, (a, b) => a.position - b.position);
    let firstLeftMatra = end, lastLeftMatra = end;
    for (let k = start; k < end; k++)
        if (info[k].position === 2) {
            if (firstLeftMatra === end)
                firstLeftMatra = k;
            lastLeftMatra = k;
        }
    if (firstLeftMatra < lastLeftMatra) {
        buffer.reverseRange(firstLeftMatra, lastLeftMatra + 1);
        let k = firstLeftMatra;
        for (let j = k; j <= lastLeftMatra; j++)
            if (info[j].category === 22) {
                buffer.reverseRange(k, j + 1);
                k = j + 1;
            }
    }
}
function reorder(_plan, font, buffer) {
    insertDottedCircles(font, buffer, 1, 11, -1, -1);
    forEachSyllable(buffer, (start, end) => {
        const type = buffer.info[start].syllable & 0x0f;
        if (type === 0 || type === 1)
            reorderConsonantSyllable(buffer, start, end);
    });
}
function collectFeatures(planner) {
    const map = planner.map;
    map.addGsubPause((_plan, _font, buffer) => setSyllables(buffer, findSyllables(buffer.info.map(info => info.category)), 1));
    map.enableFeature('locl', 64);
    map.enableFeature('ccmp', 64);
    map.addGsubPause(reorder);
    for (const tag of ['rphf', 'pref', 'blwf', 'pstf']) {
        map.enableFeature(tag, 8 | 64);
        map.addGsubPause(null);
    }
    map.addGsubPause(null);
    for (const tag of ['pres', 'abvs', 'blws', 'psts'])
        map.enableFeature(tag, 8);
}
export const myanmarShaper = {
    collectFeatures,
    setupMasks: (_plan, buffer) => {
        for (const info of buffer.info)
            info.category = indicProperties(info.codepoint)[0];
    },
    normalization: 3,
    zeroWidthMarks: 1,
    fallbackPosition: false,
};
