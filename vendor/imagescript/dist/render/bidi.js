import { bidiClass, brackets as bracketData, mirrors as mirrorData } from "./unicode-data.js";
import { valueIndex } from "./unicode.js";
const NAMES = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'];
export const BIDI_CLASSES = Object.fromEntries(NAMES.map((name, i) => [name, i]));
const fromTable = Uint8Array.from(bidiClass.names, name => BIDI_CLASSES[name]);
export function classOf(codepoint) {
    return fromTable[valueIndex(bidiClass, codepoint)];
}
let bracketMap = null;
let mirrorMap = null;
export function mirror(codepoint) {
    if (!mirrorMap) {
        mirrorMap = new Map();
        for (let i = 0; i < mirrorData.length; i += 2)
            mirrorMap.set(mirrorData[i], mirrorData[i + 1]);
    }
    return mirrorMap.get(codepoint) ?? codepoint;
}
function bracket(codepoint) {
    if (!bracketMap) {
        bracketMap = new Map();
        for (let i = 0; i < bracketData.length; i += 3)
            bracketMap.set(bracketData[i], { pair: bracketData[i + 1], opening: bracketData[i + 2] === 1 });
    }
    return bracketMap.get(codepoint);
}
const canonical = (codepoint) => codepoint === 0x2329 ? 0x3008 : codepoint === 0x232a ? 0x3009 : codepoint;
const MAX_DEPTH = 125;
const isIsolateInitiator = (t) => t === 19 || t === 20 || t === 21;
const isRemoved = (t) => t === 9 || t >= 14 && t <= 18;
export function resolve(classes, codepoints, direction = -1) {
    const n = classes.length;
    const original = Uint8Array.from(classes);
    const types = Uint8Array.from(classes);
    const matching = new Int32Array(n).fill(-1);
    {
        const open = [];
        for (let i = 0; i < n; i++) {
            if (isIsolateInitiator(original[i]))
                open.push(i);
            else if (original[i] === 22 && open.length)
                matching[open.pop()] = i;
            else if (original[i] === 10)
                open.length = 0;
        }
    }
    const firstStrong = (start, end) => {
        for (let i = start; i < end; i++) {
            const t = original[i];
            if (t === 0)
                return 0;
            if (t === 1 || t === 2)
                return 1;
            if (isIsolateInitiator(t)) {
                if (matching[i] < 0)
                    return -1;
                i = matching[i];
            }
            else if (t === 10)
                return -1;
        }
        return -1;
    };
    const paragraphLevel = direction >= 0 ? direction : Math.max(0, firstStrong(0, n));
    const levels = new Int8Array(n);
    const stack = [{ level: paragraphLevel, override: -1, isolate: false }];
    let overflowIsolates = 0, overflowEmbeddings = 0, validIsolates = 0;
    for (let i = 0; i < n; i++) {
        const t = original[i], top = stack[stack.length - 1];
        switch (t) {
            case 16:
            case 14:
            case 17:
            case 15: {
                const rtl = t === 16 || t === 17;
                const level = rtl ? top.level + 1 | 1 : top.level + 2 & ~1;
                if (level <= MAX_DEPTH && !overflowIsolates && !overflowEmbeddings)
                    stack.push({ level, override: t === 17 ? 1 : t === 15 ? 0 : -1, isolate: false });
                else if (!overflowIsolates)
                    overflowEmbeddings++;
                levels[i] = top.level;
                break;
            }
            case 20:
            case 19:
            case 21: {
                levels[i] = top.level;
                if (top.override >= 0)
                    types[i] = top.override;
                const rtl = t === 20 || t === 21 && firstStrong(i + 1, matching[i] >= 0 ? matching[i] : n) === 1;
                const level = rtl ? top.level + 1 | 1 : top.level + 2 & ~1;
                if (level <= MAX_DEPTH && !overflowIsolates && !overflowEmbeddings) {
                    validIsolates++;
                    stack.push({ level, override: -1, isolate: true });
                }
                else
                    overflowIsolates++;
                break;
            }
            case 22:
                if (overflowIsolates)
                    overflowIsolates--;
                else if (validIsolates) {
                    overflowEmbeddings = 0;
                    while (!stack[stack.length - 1].isolate)
                        stack.pop();
                    stack.pop();
                    validIsolates--;
                }
                levels[i] = stack[stack.length - 1].level;
                if (stack[stack.length - 1].override >= 0)
                    types[i] = stack[stack.length - 1].override;
                break;
            case 18:
                if (overflowIsolates) {
                }
                else if (overflowEmbeddings)
                    overflowEmbeddings--;
                else if (!top.isolate && stack.length > 1)
                    stack.pop();
                levels[i] = top.level;
                break;
            case 10:
                levels[i] = paragraphLevel;
                break;
            case 9:
                levels[i] = top.level;
                break;
            default:
                levels[i] = top.level;
                if (top.override >= 0)
                    types[i] = top.override;
        }
    }
    const runs = [];
    {
        let run = [];
        for (let i = 0; i < n; i++) {
            if (isRemoved(original[i]))
                continue;
            if (run.length && levels[i] !== levels[run[run.length - 1]]) {
                runs.push(run);
                run = [];
            }
            run.push(i);
        }
        if (run.length)
            runs.push(run);
    }
    const matched = new Uint8Array(n);
    for (let i = 0; i < n; i++)
        if (matching[i] >= 0)
            matched[matching[i]] = 1;
    const runOf = new Int32Array(n).fill(-1);
    runs.forEach((run, r) => runOf[run[0]] = r);
    const sequences = [];
    for (const run of runs) {
        const first = run[0];
        if (original[first] === 22 && matched[first])
            continue;
        const sequence = [...run];
        for (let last = sequence[sequence.length - 1]; isIsolateInitiator(original[last]) && matching[last] >= 0;) {
            const next = runOf[matching[last]];
            if (next < 0)
                break;
            sequence.push(...runs[next]);
            last = sequence[sequence.length - 1];
        }
        sequences.push(sequence);
    }
    const embeddingLevels = levels.slice();
    const levelOfNeighbor = (index, step) => {
        for (let i = index + step; i >= 0 && i < n; i += step)
            if (!isRemoved(original[i]))
                return embeddingLevels[i];
        return paragraphLevel;
    };
    for (const sequence of sequences) {
        const level = embeddingLevels[sequence[0]], m = sequence.length;
        const embedding = level & 1 ? 1 : 0;
        const first = sequence[0], last = sequence[m - 1];
        const sos = Math.max(level, levelOfNeighbor(first, -1)) & 1 ? 1 : 0;
        const eos = Math.max(level, isIsolateInitiator(original[last]) ? paragraphLevel : levelOfNeighbor(last, 1)) & 1 ? 1 : 0;
        const t = sequence.map(i => types[i]);
        for (let k = 0; k < m; k++)
            if (t[k] === 8)
                t[k] = k === 0 ? sos : isIsolateInitiator(t[k - 1]) || t[k - 1] === 22 ? 13 : t[k - 1];
        for (let k = 0, strong = sos; k < m; k++) {
            if (t[k] === 0 || t[k] === 1 || t[k] === 2)
                strong = t[k];
            else if (t[k] === 3 && strong === 2)
                t[k] = 6;
        }
        for (let k = 0; k < m; k++)
            if (t[k] === 2)
                t[k] = 1;
        for (let k = 1; k + 1 < m; k++) {
            if (t[k] === 4 && t[k - 1] === 3 && t[k + 1] === 3)
                t[k] = 3;
            else if (t[k] === 7 && (t[k - 1] === 3 || t[k - 1] === 6) && t[k + 1] === t[k - 1])
                t[k] = t[k - 1];
        }
        for (let k = 0; k < m; k++) {
            if (t[k] !== 5)
                continue;
            let end = k;
            while (end < m && t[end] === 5)
                end++;
            if (k > 0 && t[k - 1] === 3 || end < m && t[end] === 3)
                for (let j = k; j < end; j++)
                    t[j] = 3;
            k = end - 1;
        }
        for (let k = 0; k < m; k++)
            if (t[k] === 4 || t[k] === 5 || t[k] === 7)
                t[k] = 13;
        for (let k = 0, strong = sos; k < m; k++) {
            if (t[k] === 0 || t[k] === 1)
                strong = t[k];
            else if (t[k] === 3 && strong === 0)
                t[k] = 0;
        }
        if (codepoints) {
            const pairs = [];
            const open = [];
            for (let k = 0; k < m; k++) {
                if (t[k] !== 13)
                    continue;
                const cp = codepoints[sequence[k]], b = bracket(cp);
                if (!b)
                    continue;
                if (b.opening) {
                    if (open.length === 63)
                        break;
                    open.push({ k, pair: canonical(b.pair) });
                }
                else {
                    for (let j = open.length - 1; j >= 0; j--)
                        if (open[j].pair === canonical(cp)) {
                            pairs.push([open[j].k, k]);
                            open.length = j;
                            break;
                        }
                }
            }
            pairs.sort((a, b) => a[0] - b[0]);
            const strongOf = (type) => type === 0 ? 0 : type === 1 || type === 3 || type === 6 ? 1 : -1;
            for (const [o, c] of pairs) {
                let inside = -1;
                for (let k = o + 1; k < c; k++) {
                    const s = strongOf(t[k]);
                    if (s === embedding) {
                        inside = embedding;
                        break;
                    }
                    if (s >= 0)
                        inside = s;
                }
                if (inside < 0)
                    continue;
                let resolved = embedding;
                if (inside !== embedding) {
                    let before = sos;
                    for (let k = o - 1; k >= 0; k--) {
                        const s = strongOf(t[k]);
                        if (s >= 0) {
                            before = s;
                            break;
                        }
                    }
                    resolved = before === inside ? inside : embedding;
                }
                t[o] = t[c] = resolved;
                for (const b of [o, c])
                    for (let k = b + 1; k < m && original[sequence[k]] === 8; k++)
                        t[k] = resolved;
            }
        }
        const isNeutral = (type) => type === 10 || type === 11 || type === 12 || type === 13 || isIsolateInitiator(type) || type === 22;
        for (let k = 0; k < m; k++) {
            if (!isNeutral(t[k]))
                continue;
            let end = k;
            while (end < m && isNeutral(t[end]))
                end++;
            const before = k === 0 ? sos : t[k - 1] === 0 ? 0 : 1;
            const after = end === m ? eos : t[end] === 0 ? 0 : 1;
            const resolved = before === after ? before : embedding;
            for (let j = k; j < end; j++)
                t[j] = resolved;
            k = end - 1;
        }
        for (let k = 0; k < m; k++) {
            const i = sequence[k];
            if (level & 1) {
                if (t[k] === 0 || t[k] === 3 || t[k] === 6)
                    levels[i]++;
            }
            else if (t[k] === 1)
                levels[i]++;
            else if (t[k] === 6 || t[k] === 3)
                levels[i] += 2;
        }
    }
    for (let i = 0; i < n; i++)
        if (isRemoved(original[i]))
            levels[i] = -1;
    return { level: paragraphLevel, levels, classes: original };
}
export function lineLevels(paragraph, start, end) {
    const levels = paragraph.levels.slice(start, end), classes = paragraph.classes;
    const trailing = (t) => t === 12 || isIsolateInitiator(t) || t === 22 || isRemoved(t);
    for (let i = end - 1, atEnd = true; i >= start; i--) {
        const t = classes[i];
        if (t === 11 || t === 10) {
            levels[i - start] = paragraph.level;
            atEnd = true;
        }
        else if (atEnd && trailing(t)) {
            if (!isRemoved(t))
                levels[i - start] = paragraph.level;
        }
        else
            atEnd = false;
    }
    return levels;
}
export function visualOrder(levels) {
    const order = [];
    for (let i = 0; i < levels.length; i++)
        if (levels[i] >= 0)
            order.push(i);
    let highest = 0, lowestOdd = Infinity;
    for (const i of order) {
        highest = Math.max(highest, levels[i]);
        if (levels[i] & 1)
            lowestOdd = Math.min(lowestOdd, levels[i]);
    }
    for (let level = highest; level >= lowestOdd; level--)
        for (let k = 0; k < order.length; k++) {
            if (levels[order[k]] < level)
                continue;
            let end = k;
            while (end < order.length && levels[order[end]] >= level)
                end++;
            order.splice(k, end - k, ...order.slice(k, end).reverse());
            k = end - 1;
        }
    return order;
}
