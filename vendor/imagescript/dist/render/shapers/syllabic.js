/*!
 * Helpers of the syllabic shapers, ported from HarfBuzz (hb-ot-shaper-syllabic.cc, hb-ot-shaper-vowel-constraints.cc)
 * Copyright © 2021 Behdad Esfahbod, © 2018 Google, Inc., Old MIT license (see THIRD_PARTY_NOTICES.md and
 * licenses/HarfBuzz.txt)
 */
import { GlyphInfo } from "../buffer.js";
import { scriptOf } from "../shape.js";
import { vowelConstraints } from "../unicode-data.js";
export function nextSyllable(buffer, start) {
    const info = buffer.info;
    if (start >= info.length)
        return info.length;
    const syllable = info[start].syllable;
    while (++start < info.length && syllable === info[start].syllable)
        ;
    return start;
}
export function forEachSyllable(buffer, f) {
    for (let start = 0, end = buffer.len ? nextSyllable(buffer, 0) : 0; start < buffer.len; start = end, end = nextSyllable(buffer, start))
        f(start, end);
}
export function insertDottedCircles(font, buffer, brokenType, category, repha, position) {
    if (!buffer.hasBrokenSyllable)
        return false;
    const glyph = font.glyph(0x25cc);
    if (!glyph)
        return false;
    buffer.clearOutput();
    buffer.idx = 0;
    let last = 0;
    while (buffer.idx < buffer.len && buffer.successful) {
        const syllable = buffer.cur().syllable;
        if (last !== syllable && (syllable & 0x0f) === brokenType) {
            last = syllable;
            const info = new GlyphInfo();
            info.codepoint = glyph;
            info.category = category;
            if (position !== -1)
                info.position = position;
            info.cluster = buffer.cur().cluster;
            info.mask = buffer.cur().mask;
            info.syllable = syllable;
            if (repha !== -1)
                while (buffer.idx < buffer.len && buffer.successful && last === buffer.cur().syllable && buffer.cur().category === repha)
                    buffer.nextGlyph();
            buffer.outputInfo(info);
        }
        else
            buffer.nextGlyph();
    }
    buffer.sync();
    return true;
}
let constraints = null;
function constraintsOf(script) {
    if (!constraints) {
        constraints = new Map();
        for (const sequence of vowelConstraints) {
            const s = scriptOf(sequence[0]);
            let list = constraints.get(s);
            if (!list)
                constraints.set(s, list = []);
            list.push(sequence);
        }
        for (const list of constraints.values())
            list.sort((a, b) => a.length - b.length);
    }
    return constraints.get(script) ?? [];
}
export function vowelConstraintsPreprocess(buffer) {
    const list = constraintsOf(buffer.script);
    if (!list.length)
        return;
    buffer.clearOutput();
    const count = buffer.len;
    for (buffer.idx = 0; buffer.idx + 1 < count && buffer.successful;) {
        let matched = null;
        for (const sequence of list) {
            if (buffer.idx + sequence.length > count)
                continue;
            let k = 0;
            while (k < sequence.length && buffer.info[buffer.idx + k].codepoint === sequence[k])
                k++;
            if (k === sequence.length) {
                matched = sequence;
                break;
            }
        }
        if (!matched) {
            buffer.nextGlyph();
            continue;
        }
        for (let k = 0; k < matched.length - 1; k++)
            buffer.nextGlyph();
        const circle = buffer.outputGlyph(0x25cc);
        circle.unicodeProps &= ~128;
        buffer.nextGlyph();
    }
    buffer.sync();
}
