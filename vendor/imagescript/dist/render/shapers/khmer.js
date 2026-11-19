/*!
 * The Khmer shaper, ported from HarfBuzz (hb-ot-shaper-khmer.cc, hb-ot-shaper-khmer-machine.rl)
 * Copyright © 2011,2012 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
import { isMark } from "../buffer.js";
import { decompose, compose, unicodeCategory } from "../shape.js";
import { lazyScanner, cat, seq, alt, opt, star, any } from "./machine.js";
import { forEachSyllable, insertDottedCircles } from "./syllabic.js";
import { indicProperties, setSyllables } from "./indic.js";
const findSyllables = lazyScanner(() => {
    const c = cat(1, 15, 2);
    const joiner = cat(6, 5);
    const cn = seq(c, opt(opt(joiner), cat(25)));
    const xgroup = star(star(joiner), cat(26));
    const ygroup = star(cat(27));
    const matraGroup = seq(opt(cat(22)), xgroup, opt(cat(21)), xgroup, opt(opt(joiner), cat(20)), xgroup, opt(cat(23)));
    const syllableTail = seq(xgroup, matraGroup, xgroup, opt(cat(4), c), ygroup);
    const brokenCluster = seq(opt(cat(25)), star(cat(4), cn), alt(cat(4), syllableTail));
    const consonantSyllable = seq(alt(cn, cat(10), cat(11)), brokenCluster);
    return [[consonantSyllable, 0], [brokenCluster, 1], [any, 2]];
});
const FEATURES = [
    ['pref', 12 | 64],
    ['blwf', 12 | 64],
    ['abvf', 12 | 64],
    ['pstf', 12 | 64],
    ['cfar', 12 | 64],
    ['pres', 13],
    ['abvs', 13],
    ['blws', 13],
    ['psts', 13],
];
function reorderConsonantSyllable(plan, buffer, start, end) {
    const masks = plan.data, info = buffer.info;
    const mask = masks[1] | masks[2] | masks[3];
    for (let i = start + 1; i < end; i++)
        info[i].mask |= mask;
    let coengs = 0;
    for (let i = start + 1; i < end; i++) {
        if (info[i].category === 4 && coengs <= 2 && i + 1 < end) {
            coengs++;
            if (info[i + 1].category === 15) {
                for (let j = 0; j < 2; j++)
                    info[i + j].mask |= masks[0];
                buffer.mergeClusters(start, i + 2);
                const t0 = info[i], t1 = info[i + 1];
                for (let k = i - 1; k >= start; k--)
                    info[k + 2] = info[k];
                info[start] = t0;
                info[start + 1] = t1;
                if (masks[4])
                    for (let j = i + 2; j < end; j++)
                        info[j].mask |= masks[4];
                coengs = 2;
            }
        }
        else if (info[i].category === 22) {
            buffer.mergeClusters(start, i + 1);
            const t = info[i];
            for (let k = i - 1; k >= start; k--)
                info[k + 1] = info[k];
            info[start] = t;
        }
    }
}
function reorder(plan, font, buffer) {
    insertDottedCircles(font, buffer, 1, 11, -1, -1);
    forEachSyllable(buffer, (start, end) => {
        const type = buffer.info[start].syllable & 0x0f;
        if (type === 0 || type === 1)
            reorderConsonantSyllable(plan, buffer, start, end);
    });
}
function collectFeatures(planner) {
    const map = planner.map;
    map.addGsubPause((_plan, _font, buffer) => setSyllables(buffer, findSyllables(buffer.info.map(info => info.category)), 1));
    map.addGsubPause(reorder);
    map.enableFeature('locl', 64);
    map.enableFeature('ccmp', 64);
    let i = 0;
    for (; i < 5; i++)
        map.addFeature(FEATURES[i][0], FEATURES[i][1]);
    map.addGsubPause(null);
    for (; i < FEATURES.length; i++)
        map.addFeature(FEATURES[i][0], FEATURES[i][1]);
}
const SPLIT = new Set([0x17be, 0x17bf, 0x17c0, 0x17c4, 0x17c5]);
export const khmerShaper = {
    collectFeatures,
    overrideFeatures: planner => {
        planner.map.enableFeature('clig');
        planner.map.disableFeature('liga');
    },
    dataCreate: plan => FEATURES.map(([tag, flags]) => flags & 1 ? 0 : plan.map.get1Mask(tag)),
    decompose: (_c, ab) => SPLIT.has(ab) ? [0x17c1, ab] : decompose(ab),
    compose: (_c, a, b) => isMark(unicodeCategory(a)) ? 0 : compose(a, b),
    setupMasks: (_plan, buffer) => {
        for (const info of buffer.info)
            info.category = indicProperties(info.codepoint)[0];
    },
    normalization: 3,
    zeroWidthMarks: 0,
    fallbackPosition: false,
};
