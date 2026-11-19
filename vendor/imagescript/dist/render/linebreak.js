import { lineBreak, generalCategory, eastAsianWidth, extendedPictographic } from "./unicode-data.js";
import { value, valueIndex } from "./unicode.js";
const DOTTED_CIRCLE = 0x25cc;
export function lineBreaks(codepoints) {
    const n = codepoints.length;
    const breaks = new Uint8Array(n + 1);
    if (!n)
        return breaks;
    const cls = new Array(n), gc = new Array(n), wide = new Uint8Array(n), pictographicCn = new Uint8Array(n), attached = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const cp = codepoints[i];
        let c = value(lineBreak, cp);
        const g = value(generalCategory, cp);
        if (c === 'AI' || c === 'SG' || c === 'XX')
            c = 'AL';
        else if (c === 'SA')
            c = g === 'Mn' || g === 'Mc' ? 'CM' : 'AL';
        else if (c === 'CJ')
            c = 'NS';
        cls[i] = c;
        gc[i] = g;
        const ea = value(eastAsianWidth, cp);
        wide[i] = ea === 'F' || ea === 'W' || ea === 'H' ? 1 : 0;
        pictographicCn[i] = valueIndex(extendedPictographic, cp) && g === 'Cn' ? 1 : 0;
    }
    const raw = cls.slice();
    for (let i = 0; i < n; i++) {
        if (cls[i] !== 'CM' && cls[i] !== 'ZWJ')
            continue;
        const base = i > 0 ? i - 1 : -1;
        if (base >= 0 && !['BK', 'CR', 'LF', 'NL', 'SP', 'ZW'].includes(cls[base])) {
            attached[i] = 1;
            cls[i] = cls[base];
            gc[i] = gc[base];
            wide[i] = wide[base];
            pictographicCn[i] = pictographicCn[base];
        }
        else {
            cls[i] = 'AL';
            gc[i] = 'Lu';
            wide[i] = 0;
            pictographicCn[i] = 0;
        }
    }
    const before = (i) => {
        let j = i - 1;
        while (j >= 0 && attached[j])
            j--;
        return j;
    };
    const after = (i) => {
        let j = i;
        while (j < n && attached[j])
            j++;
        return j;
    };
    const beforeSpaces = (i) => {
        let j = before(i);
        while (j >= 0 && cls[j] === 'SP')
            j = before(j);
        return j;
    };
    const is = (j, ...classes) => j >= 0 && j < n && classes.includes(cls[j]);
    for (let i = 1; i < n; i++) {
        const a = i - 1, b = i;
        const B = cls[b], rawA = raw[a], rawB = raw[b];
        breaks[i] = (() => {
            if (rawA === 'BK')
                return 2;
            if (rawA === 'CR' && rawB === 'LF')
                return 0;
            if (rawA === 'CR' || rawA === 'LF' || rawA === 'NL')
                return 2;
            if (rawB === 'BK' || rawB === 'CR' || rawB === 'LF' || rawB === 'NL')
                return 0;
            if (rawB === 'SP' || rawB === 'ZW')
                return 0;
            if (is(beforeSpaces(b), 'ZW') && raw[beforeSpaces(b)] === 'ZW')
                return 1;
            if (rawA === 'ZWJ')
                return 0;
            if (attached[b])
                return 0;
            const p = before(b), P = cls[p];
            if (B === 'WJ' || P === 'WJ')
                return 0;
            if (P === 'GL')
                return 0;
            if (B === 'GL' && !['SP', 'HY', 'HH'].includes(P))
                return 0;
            if (B === 'CL' || B === 'CP' || B === 'EX' || B === 'SY')
                return 0;
            const s = beforeSpaces(b);
            if (is(s, 'OP'))
                return 0;
            if (is(s, 'QU') && gc[s] === 'Pi') {
                const q = before(s);
                if (q < 0 || ['BK', 'CR', 'LF', 'NL', 'OP', 'QU', 'GL', 'SP', 'ZW'].includes(cls[q]))
                    return 0;
            }
            if (B === 'QU' && gc[b] === 'Pf') {
                const q = after(b + 1);
                if (q >= n || ['SP', 'GL', 'WJ', 'CL', 'QU', 'CP', 'EX', 'IS', 'SY', 'BK', 'CR', 'LF', 'NL', 'ZW'].includes(cls[q]))
                    return 0;
            }
            if (P === 'SP' && B === 'IS' && is(after(b + 1), 'NU'))
                return 1;
            if (B === 'IS')
                return 0;
            if (is(s, 'CL', 'CP') && B === 'NS')
                return 0;
            if (is(s, 'B2') && B === 'B2')
                return 0;
            if (P === 'SP')
                return 1;
            if (B === 'QU' && gc[b] !== 'Pi')
                return 0;
            if (P === 'QU' && gc[p] !== 'Pf')
                return 0;
            if (B === 'QU') {
                if (!wide[p])
                    return 0;
                const q = after(b + 1);
                if (q >= n || !wide[q])
                    return 0;
            }
            if (P === 'QU') {
                if (!wide[b])
                    return 0;
                const q = before(p);
                if (q < 0 || !wide[q])
                    return 0;
            }
            if (B === 'CB' || P === 'CB')
                return 1;
            if ((P === 'HY' || P === 'HH') && (B === 'AL' || B === 'HL')) {
                const q = before(p);
                if (q < 0 || ['BK', 'CR', 'LF', 'NL', 'SP', 'ZW', 'CB', 'GL'].includes(cls[q]))
                    return 0;
            }
            if (B === 'BA' || B === 'HH' || B === 'HY' || B === 'NS' || P === 'BB')
                return 0;
            if ((P === 'HY' || P === 'HH') && B !== 'HL' && is(before(p), 'HL'))
                return 0;
            if (P === 'SY' && B === 'HL')
                return 0;
            if (B === 'IN')
                return 0;
            if ((P === 'AL' || P === 'HL') && B === 'NU' || P === 'NU' && (B === 'AL' || B === 'HL'))
                return 0;
            if (P === 'PR' && (B === 'ID' || B === 'EB' || B === 'EM') || (P === 'ID' || P === 'EB' || P === 'EM') && B === 'PO')
                return 0;
            if ((P === 'PR' || P === 'PO') && (B === 'AL' || B === 'HL') || (P === 'AL' || P === 'HL') && (B === 'PR' || B === 'PO'))
                return 0;
            if (B === 'PO' || B === 'PR' || B === 'NU') {
                let q = p;
                if (B !== 'NU' && (cls[q] === 'CL' || cls[q] === 'CP'))
                    q = before(q);
                while (is(q, 'SY', 'IS'))
                    q = before(q);
                if (is(q, 'NU'))
                    return 0;
            }
            if ((P === 'PO' || P === 'PR') && B === 'OP') {
                const q = after(b + 1);
                if (is(q, 'NU') || is(q, 'IS') && is(after(q + 1), 'NU'))
                    return 0;
            }
            if ((P === 'PO' || P === 'PR' || P === 'HY' || P === 'IS') && B === 'NU')
                return 0;
            if (P === 'JL' && ['JL', 'JV', 'H2', 'H3'].includes(B))
                return 0;
            if ((P === 'JV' || P === 'H2') && (B === 'JV' || B === 'JT'))
                return 0;
            if ((P === 'JT' || P === 'H3') && B === 'JT')
                return 0;
            if (['JL', 'JV', 'JT', 'H2', 'H3'].includes(P) && B === 'PO' || P === 'PR' && ['JL', 'JV', 'JT', 'H2', 'H3'].includes(B))
                return 0;
            if ((P === 'AL' || P === 'HL') && (B === 'AL' || B === 'HL'))
                return 0;
            const aksara = (j) => is(j, 'AK', 'AS') || j >= 0 && j < n && codepoints[j] === DOTTED_CIRCLE;
            if (P === 'AP' && aksara(b))
                return 0;
            if (aksara(p) && (B === 'VF' || B === 'VI'))
                return 0;
            if (P === 'VI' && aksara(before(p)) && (B === 'AK' || codepoints[b] === DOTTED_CIRCLE))
                return 0;
            if (aksara(p) && aksara(b) && is(after(b + 1), 'VF'))
                return 0;
            if (P === 'IS' && (B === 'AL' || B === 'HL'))
                return 0;
            if ((P === 'AL' || P === 'HL' || P === 'NU') && B === 'OP' && !wide[b])
                return 0;
            if (P === 'CP' && !wide[p] && (B === 'AL' || B === 'HL' || B === 'NU'))
                return 0;
            if (P === 'RI' && B === 'RI') {
                let count = 0;
                for (let q = p; is(q, 'RI'); q = before(q))
                    count++;
                if (count % 2)
                    return 0;
            }
            if (B === 'EM' && (P === 'EB' || pictographicCn[p]))
                return 0;
            return 1;
        })();
    }
    breaks[n] = 2;
    return breaks;
}
