/*!
 * The Thai and Lao shaper, ported from HarfBuzz (hb-ot-shaper-thai.cc)
 * Copyright © 2010,2012 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
import { setGeneralCategory } from "../buffer.js";
const consonantType = (u) => {
    if (u === 0x0e1b || u === 0x0e1d || u === 0x0e1f)
        return 1;
    if (u === 0x0e0d || u === 0x0e10)
        return 2;
    if (u === 0x0e0e || u === 0x0e0f)
        return 3;
    if (u >= 0x0e01 && u <= 0x0e2e)
        return 0;
    return 4;
};
const markType = (u) => {
    if (u === 0x0e31 || u >= 0x0e34 && u <= 0x0e37 || u === 0x0e47 || u >= 0x0e4d && u <= 0x0e4e)
        return 0;
    if (u >= 0x0e38 && u <= 0x0e3a)
        return 1;
    if (u >= 0x0e48 && u <= 0x0e4c)
        return 2;
    return 3;
};
const PUA = {
    [1]: [[0x0e48, 0xf70a, 0xf88b], [0x0e49, 0xf70b, 0xf88e], [0x0e4a, 0xf70c, 0xf891], [0x0e4b, 0xf70d, 0xf894], [0x0e4c, 0xf70e, 0xf897],
        [0x0e38, 0xf718, 0xf89b], [0x0e39, 0xf719, 0xf89c], [0x0e3a, 0xf71a, 0xf89d]],
    [3]: [[0x0e48, 0xf705, 0xf88c], [0x0e49, 0xf706, 0xf88f], [0x0e4a, 0xf707, 0xf892], [0x0e4b, 0xf708, 0xf895], [0x0e4c, 0xf709, 0xf898]],
    [2]: [[0x0e48, 0xf713, 0xf88a], [0x0e49, 0xf714, 0xf88d], [0x0e4a, 0xf715, 0xf890], [0x0e4b, 0xf716, 0xf893], [0x0e4c, 0xf717, 0xf896],
        [0x0e31, 0xf710, 0xf884], [0x0e34, 0xf701, 0xf885], [0x0e35, 0xf702, 0xf886], [0x0e36, 0xf703, 0xf887], [0x0e37, 0xf704, 0xf888],
        [0x0e47, 0xf712, 0xf889], [0x0e4d, 0xf711, 0xf899]],
    [4]: [[0x0e0d, 0xf70f, 0xf89a], [0x0e10, 0xf700, 0xf89e]],
};
function puaShape(u, action, font) {
    if (action === 0)
        return u;
    for (const [from, win, mac] of PUA[action])
        if (from === u) {
            if (font.hasGlyph(win))
                return win;
            if (font.hasGlyph(mac))
                return mac;
            break;
        }
    return u;
}
const ABOVE_START = [0, 1, 0, 0, 3];
const ABOVE = [
    [[0, 3], [0, 0], [1, 3]],
    [[2, 2], [0, 1], [3, 2]],
    [[0, 3], [0, 2], [2, 3]],
    [[0, 3], [0, 3], [0, 3]],
];
const BELOW_START = [0, 0, 1, 2, 2];
const BELOW = [
    [[0, 0], [0, 2], [0, 0]],
    [[0, 1], [4, 2], [0, 1]],
    [[0, 2], [1, 2], [0, 2]],
];
function puaShaping(buffer, font) {
    let above = ABOVE_START[4], below = BELOW_START[4], base = 0;
    const info = buffer.info;
    for (let i = 0; i < info.length; i++) {
        const mt = markType(info[i].codepoint);
        if (mt === 3) {
            const ct = consonantType(info[i].codepoint);
            above = ABOVE_START[ct];
            below = BELOW_START[ct];
            base = i;
            continue;
        }
        const aboveEdge = ABOVE[above][mt], belowEdge = BELOW[below][mt];
        above = aboveEdge[1];
        below = belowEdge[1];
        const action = aboveEdge[0] !== 0 ? aboveEdge[0] : belowEdge[0];
        if (action === 4)
            info[base].codepoint = puaShape(info[base].codepoint, action, font);
        else
            info[i].codepoint = puaShape(info[i].codepoint, action, font);
    }
}
const isSaraAm = (u) => (u & ~0x80) === 0x0e33;
const isAboveBaseMark = (u) => {
    const v = u & ~0x80;
    return v >= 0x0e34 && v <= 0x0e37 || v >= 0x0e47 && v <= 0x0e4e || v === 0x0e31 || v === 0x0e3b;
};
function preprocessText(plan, buffer, font) {
    buffer.clearOutput();
    const count = buffer.len;
    for (buffer.idx = 0; buffer.idx < count;) {
        const u = buffer.cur().codepoint;
        if (!isSaraAm(u)) {
            buffer.nextGlyph();
            continue;
        }
        const nikhahit = buffer.outputGlyph(u - 0x0e33 + 0x0e4d);
        buffer.hasContinuations = true;
        nikhahit.unicodeProps |= 128;
        buffer.replaceGlyph(u - 1);
        const end = buffer.outLen;
        setGeneralCategory(buffer.outInfo[end - 2], 12);
        let start = end - 2;
        while (start > 0 && isAboveBaseMark(buffer.outInfo[start - 1].codepoint))
            start--;
        if (start + 2 < end) {
            buffer.mergeOutClusters(start, end);
            const t = buffer.outInfo[end - 2];
            for (let k = end - 2; k > start; k--)
                buffer.outInfo[k] = buffer.outInfo[k - 1];
            buffer.outInfo[start] = t;
        }
        if (start)
            buffer.mergeOutClusters(start - 1, end);
    }
    buffer.sync();
    if (plan.script === 'Thai' && !plan.map.foundScript[0])
        puaShaping(buffer, font);
}
export const thaiShaper = {
    preprocessText,
    normalization: 4,
    zeroWidthMarks: 2,
    fallbackPosition: false,
};
