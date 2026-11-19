import { graphemeBreak, conjunctBreak, extendedPictographic, script, brackets } from "./unicode-data.js";
import { value, valueIndex } from "./unicode.js";
export function graphemeBoundaries(codepoints) {
    const n = codepoints.length, boundaries = new Uint8Array(n + 1);
    if (!n)
        return boundaries;
    boundaries[0] = boundaries[n] = 1;
    const gcb = new Array(n), incb = new Array(n), pictographic = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        gcb[i] = value(graphemeBreak, codepoints[i]);
        incb[i] = value(conjunctBreak, codepoints[i]);
        pictographic[i] = valueIndex(extendedPictographic, codepoints[i]) ? 1 : 0;
    }
    let emoji = false, emojiZWJ = false, ri = 0;
    let linker = false;
    for (let i = 1; i < n; i++) {
        const a = gcb[i - 1], b = gcb[i];
        emojiZWJ = emoji && a === 'ZWJ';
        if (pictographic[i - 1])
            emoji = true;
        else if (a !== 'EX')
            emoji = false;
        ri = a === 'RI' ? ri + 1 : 0;
        if (incb[i - 1] === 'Linker')
            linker = true;
        else if (incb[i - 1] !== 'Extend')
            linker = false;
        let boundary;
        if (a === 'CR' && b === 'LF')
            boundary = false;
        else if (a === 'CN' || a === 'CR' || a === 'LF' || b === 'CN' || b === 'CR' || b === 'LF')
            boundary = true;
        else if (a === 'L' && (b === 'L' || b === 'V' || b === 'LV' || b === 'LVT'))
            boundary = false;
        else if ((a === 'LV' || a === 'V') && (b === 'V' || b === 'T'))
            boundary = false;
        else if ((a === 'LVT' || a === 'T') && b === 'T')
            boundary = false;
        else if (b === 'EX' || b === 'ZWJ' || b === 'SM' || a === 'PP')
            boundary = false;
        else if (linker && incb[i] === 'Consonant')
            boundary = false;
        else if (emojiZWJ && pictographic[i])
            boundary = false;
        else if (a === 'RI' && b === 'RI')
            boundary = ri % 2 === 0;
        else
            boundary = true;
        boundaries[i] = boundary ? 1 : 0;
    }
    return boundaries;
}
let pairs = null;
const closingOf = (u) => {
    if (!pairs) {
        pairs = new Map();
        for (let i = 0; i < brackets.length; i += 3)
            if (brackets[i + 2] === 1)
                pairs.set(brackets[i], brackets[i + 1]);
    }
    return pairs.get(u) ?? 0;
};
export function scripts(codepoints) {
    const n = codepoints.length, out = new Array(n);
    let current = '';
    const stack = [];
    for (let i = 0; i < n; i++) {
        const u = codepoints[i];
        let s = value(script, u);
        if (s === 'Zyyy' || s === 'Zinh' || s === 'Zzzz') {
            const closing = closingOf(u);
            if (closing) {
                if (stack.length >= 64)
                    stack.shift();
                stack.push([closing, current]);
                s = current;
            }
            else {
                let k = stack.length - 1;
                while (k >= 0 && stack[k][0] !== u && !(u === 0x232a && stack[k][0] === 0x3009) && !(u === 0x3009 && stack[k][0] === 0x232a))
                    k--;
                if (k >= 0) {
                    s = stack[k][1];
                    stack.length = k;
                }
                else
                    s = current;
            }
        }
        else {
            if (!current)
                for (const entry of stack)
                    if (!entry[1])
                        entry[1] = s;
            current = s;
        }
        out[i] = s;
    }
    const first = out.find(s => s) ?? 'Zyyy';
    for (let i = 0; i < n && !out[i]; i++)
        out[i] = first;
    for (let i = 0; i < n; i++)
        if (!out[i])
            out[i] = first;
    return out;
}
