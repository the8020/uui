/*!
 * SVG text layout, ported from usvg (https://github.com/linebender/resvg, crates/usvg/src/text: layout.rs,
 * flatten.rs, mod.rs; crates/usvg/src/parser/text.rs; Copyright 2019 the Resvg Authors, MIT License), with fonts
 * matched like fontdb's queries (https://github.com/RazrFalcon/fontdb, MIT License) and arc lengths along text paths
 * measured like kurbo's (https://github.com/linebender/kurbo, src/cubicbez.rs, param_curve.rs, common.rs; Copyright 2018
 * Raph Levien, MIT License). See THIRD_PARTY_NOTICES.md
 */
import { shapeFont, shapeRun, isDefaultIgnorableCodepoint, scriptOf } from "./shape.js";
import "./shapers/index.js";
import { classOf, resolve, lineLevels } from "./bidi.js";
import { graphemeBoundaries, scripts } from "./segment.js";
import { loadFont } from "./text.js";
import { parseColorLayers, parseBitmaps } from "./color.js";
import { parsePaintGlyphs } from "./colr.js";
import { multiply } from "../util/matrix.js";
const faces = new WeakMap();
function names(font, ids) {
    const table = font.tables.name;
    if (!table)
        return [];
    const base = table.offset, count = font.u16(base + 2), strings = base + font.u16(base + 4);
    const out = [];
    for (let i = 0; i < count; i++) {
        const record = base + 6 + i * 12;
        const platform = font.u16(record), nameId = font.u16(record + 6), length = font.u16(record + 8), offset = strings + font.u16(record + 10);
        if (nameId !== ids || offset + length > font.data.length)
            continue;
        let name = '';
        if (platform === 0 || platform === 3)
            for (let k = 0; k + 1 < length; k += 2)
                name += String.fromCharCode(font.u16(offset + k));
        else if (platform === 1)
            for (let k = 0; k < length; k++)
                name += String.fromCharCode(font.u8(offset + k));
        else
            continue;
        name = name.trim();
        if (name && !out.includes(name))
            out.push(name);
    }
    return out;
}
export function fontFace(data, descriptors) {
    let font;
    try {
        font = loadFont(data);
    }
    catch {
        return null;
    }
    const cached = !descriptors && faces.get(font);
    if (cached)
        return cached;
    const os2 = font.tables['OS/2'] && font.tables['OS/2'].length >= 78 ? font.tables['OS/2'].offset : -1;
    const post = font.tables.post && font.tables.post.length >= 16 ? font.tables.post.offset : -1;
    const version = os2 >= 0 ? font.u16(os2) : 0;
    const selection = os2 >= 0 ? font.u16(os2 + 62) : 0;
    let families = [...names(font, 16), ...names(font, 1)];
    if (descriptors?.family)
        families = [descriptors.family];
    const weight = descriptors?.weight ?? (os2 >= 0 && font.u16(os2 + 4) ? Math.min(1000, font.u16(os2 + 4)) : 400);
    const style = descriptors?.style ?? (selection & 1 ? 'italic' : selection & 512 ? 'oblique' : 'normal');
    const stretch = os2 >= 0 && font.u16(os2 + 6) >= 1 && font.u16(os2 + 6) <= 9 ? font.u16(os2 + 6) : 5;
    let ascent = font.ascender, descent = font.descender;
    if (os2 >= 0 && (selection & 128 || (!ascent && !descent))) {
        ascent = font.i16(os2 + 68);
        descent = font.i16(os2 + 70);
    }
    const units = font.unitsPerEm;
    const sxHeight = os2 >= 0 && version >= 2 && font.tables['OS/2'].length >= 88 ? font.i16(os2 + 86) : 0;
    const xHeight = sxHeight > 0 ? sxHeight : Math.round((ascent - descent) * 0.45);
    const strikeout = os2 >= 0 ? font.i16(os2 + 28) : 0;
    const underlineThickness = post >= 0 && font.i16(post + 10) > 0 ? font.i16(post + 10) : Math.trunc(units / 12);
    const generic = new Set();
    const familyType = os2 >= 0 ? font.u8(os2 + 32) : 0, serifStyle = os2 >= 0 ? font.u8(os2 + 33) : 0, familyClass = os2 >= 0 ? font.u8(os2 + 30) : 0;
    const fixed = post >= 0 && font.u32(post + 12) !== 0;
    if (fixed && font.glyphIndex(0x61))
        generic.add('monospace');
    if (familyType === 3 || familyClass === 10)
        generic.add('cursive');
    else if (familyType === 4 || familyClass === 9)
        generic.add('fantasy');
    else if ((familyType === 2 && serifStyle >= 2 && serifStyle <= 10) || (familyClass >= 1 && familyClass <= 7 && familyClass !== 6))
        generic.add('serif');
    else if ((familyType === 2 && serifStyle >= 11 && serifStyle <= 15) || familyClass === 8)
        generic.add('sans-serif');
    const axis = (tag) => font.axes.find(a => a.tag === tag);
    const wght = axis('wght'), wdth = axis('wdth'), ital = axis('ital'), slnt = axis('slnt');
    const classes = (min, max) => {
        const lo = STRETCH_PERCENT.findIndex(p => p >= min), hi = STRETCH_PERCENT.filter(p => p <= max).length - 1;
        return lo >= 0 && hi >= lo ? [lo + 1, hi + 1] : null;
    };
    const ranges = font.axes.length ? {
        weight: wght ? [wght.min, wght.max] : null, stretch: wdth ? classes(wdth.min, wdth.max) : null,
        italic: !!ital && ital.max >= 1, oblique: !!slnt && slnt.min < 0,
    } : null;
    const face = {
        font, families: families.map(name => name.toLowerCase()), weight, style, stretch, ranges, generic,
        ascent, descent, xHeight,
        underlinePosition: post >= 0 ? font.i16(post + 8) : -Math.trunc(units / 9),
        underlineThickness,
        lineThroughPosition: strikeout || Math.trunc(xHeight / 2),
        subscriptOffset: os2 >= 0 ? font.i16(os2 + 16) : Math.round(units / 0.2),
        superscriptOffset: os2 >= 0 ? font.i16(os2 + 24) : Math.round(units / 0.4),
    };
    if (!descriptors)
        faces.set(font, face);
    return face;
}
const STRETCH_PERCENT = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200];
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);
function bestMatch(faces, query) {
    const clamp = (v, range, own) => range ? Math.min(Math.max(v, range[0]), range[1]) : own;
    const candidates = faces.map(f => !f.ranges ? f : {
        ...f, face: f, weight: clamp(query.weight, f.ranges.weight, f.weight), stretch: clamp(query.stretch, f.ranges.stretch, f.stretch),
        style: query.style === 'italic' && f.ranges.italic ? 'italic' : query.style === 'oblique' && f.ranges.oblique ? 'oblique' : f.style,
    });
    const original = (f) => f.face ?? f;
    const pick = (values, wanted, below) => {
        if (values.includes(wanted))
            return wanted;
        const lower = values.filter(v => v < wanted).sort((a, b) => b - a), higher = values.filter(v => v > wanted).sort((a, b) => a - b);
        return below ? lower[0] ?? higher[0] : higher[0] ?? lower[0];
    };
    const stretch = pick(candidates.map(f => f.stretch), query.stretch, query.stretch <= 5);
    let list = candidates.filter(f => f.stretch === stretch);
    const order = query.style === 'italic' ? ['italic', 'oblique', 'normal'] : query.style === 'oblique' ? ['oblique', 'italic', 'normal'] : ['normal', 'oblique', 'italic'];
    const style = order.find(s => list.some(f => f.style === s));
    list = list.filter(f => f.style === style);
    const weights = list.map(f => f.weight), w = query.weight;
    let weight;
    if (weights.includes(w))
        weight = w;
    else if (w >= 400 && w <= 500) {
        const up = weights.filter(v => v > w && v <= 500).sort((a, b) => a - b)[0];
        weight = up ?? pick(weights.filter(v => v < w || v > 500), w, true);
    }
    else
        weight = pick(weights, w, w < 400);
    return original(list.find(f => f.weight === weight));
}
const variedFaces = new WeakMap();
export function variedFace(face, query, fontSize) {
    if (!face.font.axes.length)
        return face;
    const values = { wght: query.weight };
    if (query.stretch !== 5)
        values.wdth = STRETCH_PERCENT[query.stretch - 1];
    if (query.style === 'italic')
        values.ital = 1;
    if (query.style === 'oblique')
        values.slnt = -12;
    if (query.opticalSizing)
        values.opsz = fontSize;
    const font = face.font.withVariations({ ...values, ...query.variations });
    if (font === face.font)
        return face;
    let byCoords = variedFaces.get(face);
    if (!byCoords)
        variedFaces.set(face, byCoords = new Map());
    const key = font.coords.join(',');
    let varied = byCoords.get(key);
    if (!varied)
        byCoords.set(key, varied = { ...face, font, ascent: face.ascent + font.ascender - face.font.ascender, descent: face.descent + font.descender - face.font.descender });
    return varied;
}
export function matchFont(fonts, query) {
    if (!fonts.length)
        return null;
    const family = (name) => fonts.filter(f => f.families.includes(name));
    for (const name of query.families) {
        let candidates;
        if (GENERIC.has(name)) {
            const first = fonts.find(f => f.generic.has(name));
            candidates = first ? family(first.families[0]) : [];
        }
        else
            candidates = family(name);
        if (candidates.length)
            return bestMatch(candidates, query);
    }
    return bestMatch(family(fonts[0].families[0]).length ? family(fonts[0].families[0]) : [fonts[0]], query);
}
function fallbackFont(fonts, base, grapheme, tried) {
    for (const f of fonts) {
        if (tried.has(f))
            continue;
        if (f.style !== base.style && f.weight !== base.weight && f.stretch !== base.stretch)
            continue;
        if (grapheme.every(c => isDefaultIgnorableCodepoint(c) || f.font.glyphIndex(c)))
            return f;
    }
    return null;
}
const colorTables = new WeakMap();
export function colorTablesOf(font) {
    let tables = colorTables.get(font);
    if (tables)
        return tables;
    const strikes = new Map();
    const bitmapTables = !!(font.tables.CBDT && font.tables.CBLC || font.tables.sbix);
    tables = {
        paints: parsePaintGlyphs(font), layers: parseColorLayers(font), svg: svgDocuments(font),
        bitmaps: size => {
            if (!bitmapTables)
                return null;
            if (!strikes.has(size))
                strikes.set(size, parseBitmaps(font, size));
            return strikes.get(size) ?? null;
        },
    };
    colorTables.set(font, tables);
    return tables;
}
function svgDocuments(font) {
    const table = font.tables['SVG '];
    if (!table || table.length < 10)
        return null;
    const list = table.offset + font.u32(table.offset + 2), count = font.u16(list);
    return glyph => {
        for (let i = 0; i < count; i++) {
            const e = list + 2 + i * 12;
            if (glyph < font.u16(e) || glyph > font.u16(e + 2))
                continue;
            const start = list + font.u32(e + 4), length = font.u32(e + 8);
            return start + length <= font.data.length ? font.data.subarray(start, start + length) : null;
        }
        return null;
    };
}
function colorKind(face, glyph, fontSize) {
    const t = colorTablesOf(face.font);
    if (t.paints && t.paints.paint(glyph) !== null)
        return 'paint';
    if (t.layers && t.layers(glyph))
        return 'layers';
    if (t.svg && t.svg(glyph))
        return 'svg';
    if (t.bitmaps(fontSize)?.(glyph))
        return 'bitmap';
    return null;
}
export function parseVariationSettings(value) {
    const out = {};
    if (value.trim().toLowerCase() === 'normal')
        return out;
    for (const part of value.split(',')) {
        const m = /^\s*(["'])(.{4})\1\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*$/i.exec(part);
        if (m)
            out[m[2]] = Number(m[3]);
    }
    return out;
}
export function parseFontFamilies(value) {
    const families = [];
    for (const part of value.split(',')) {
        let name = part.trim();
        if (/^(['"]).*\1$/.test(name))
            name = name.slice(1, -1);
        else
            name = name.replace(/\s+/g, ' ');
        if (name)
            families.push(name.toLowerCase());
    }
    return families;
}
const IDENTITY = [1, 0, 0, 1, 0, 0];
const translate = (m, x, y) => multiply(m, [1, 0, 0, 1, x, y]);
const scale = (m, x, y) => multiply(m, [x, 0, 0, y, 0, 0]);
function rotate(m, degrees, cx = 0, cy = 0) {
    const r = degrees * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    return translate(multiply(translate(m, cx, cy), [cos, sin, -sin, cos, 0, 0]), -cx, -cy);
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const UNSPACED = new Set(['Arab', 'Syrc', 'Nkoo', 'Mani', 'Phlp', 'Mand', 'Mong', 'Phag', 'Deva', 'Beng', 'Guru', 'Modi', 'Shrd', 'Sylo', 'Tirh', 'Ogam']);
const WORD_SEPARATORS = new Set([0x20, 0xa0, 0x1361, 0x10100, 0x10101, 0x1039f, 0x1091f]);
function upright(u) {
    return (u >= 0x1100 && u <= 0x11ff) || (u >= 0x2e80 && u <= 0xa4cf) || (u >= 0xa960 && u <= 0xa97f) || (u >= 0xac00 && u <= 0xd7ff)
        || (u >= 0xf900 && u <= 0xfaff) || (u >= 0xfe10 && u <= 0xfe1f) || (u >= 0xfe30 && u <= 0xfe4f) || (u >= 0xff00 && u <= 0xff60)
        || (u >= 0xffe0 && u <= 0xffe7) || (u >= 0x1f000 && u <= 0x1faff) || (u >= 0x20000 && u <= 0x3fffd)
        || (u >= 0x2460 && u <= 0x24ff) || (u >= 0x2600 && u <= 0x27bf && u !== 0x2771 && u !== 0x2770);
}
const spanAt = (chunk, i) => chunk.spans.find(s => i >= s.start && i < s.end);
function shapeChunk(chunk, fonts, primary) {
    const cps = chunk.codepoints, n = cps.length;
    const faceOf = new Array(n).fill(null);
    const fallback = new Array(n).fill(null);
    const graphemes = graphemeBoundaries(cps);
    for (let start = 0; start < n;) {
        let end = start + 1;
        while (end < n && !graphemes[end])
            end++;
        const span = spanAt(chunk, start), base = span && primary.get(span);
        if (base) {
            const grapheme = cps.slice(start, end);
            let face = base;
            if (!grapheme.every(c => isDefaultIgnorableCodepoint(c) || base.font.glyphIndex(c))) {
                const other = fallbackFont(fonts, base, grapheme, new Set([base]));
                face = other && span ? variedFace(other, span.font, span.fontSize) : base;
            }
            faceOf.fill(face, start, end);
            if (face !== base)
                fallback.fill(face, start, end);
        }
        start = end;
    }
    const paragraph = resolve(cps.map(classOf), cps, 0), levels = lineLevels(paragraph, 0, n);
    let last = 0;
    const levelAt = (i) => levels[i] >= 0 ? last = levels[i] : last;
    const script = [];
    for (let i = 0; i < n;) {
        const level = levelAt(i);
        let j = i + 1;
        while (j < n && (levels[j] < 0 || levels[j] === level))
            j++;
        script.push(...scripts(cps.slice(i, j)));
        i = j;
    }
    last = 0;
    const featuresOf = (span) => span ? `${+span.smallCaps}${+span.kerning}` : '';
    const runs = [];
    for (let i = 0; i < n;) {
        const level = levelAt(i), span = spanAt(chunk, i);
        let j = i + 1;
        while (j < n && (levels[j] < 0 || levels[j] === level) && script[j] === script[i] && fallback[j] === fallback[i] && !faceOf[j] === !faceOf[i]
            && featuresOf(spanAt(chunk, j)) === featuresOf(span))
            j++;
        runs.push([i, j, level]);
        i = j;
    }
    let highest = 0, lowestOdd = Infinity;
    for (const [, , level] of runs) {
        highest = Math.max(highest, level);
        if (level & 1)
            lowestOdd = Math.min(lowestOdd, level);
    }
    for (let level = highest; level >= lowestOdd; level--)
        for (let i = 0; i < runs.length;) {
            if (runs[i][2] < level) {
                i++;
                continue;
            }
            let j = i;
            while (j < runs.length && runs[j][2] >= level)
                j++;
            runs.splice(i, j - i, ...runs.slice(i, j).reverse());
            i = j;
        }
    const glyphs = [];
    for (const [rs, re, level] of runs) {
        const base = faceOf[rs];
        if (!base)
            continue;
        const span = spanAt(chunk, rs);
        const features = [];
        if (span.smallCaps)
            features.push(['smcp', 1]);
        if (!span.kerning)
            features.push(['kern', 0]);
        const clusters = Array.from({ length: re - rs }, (_, k) => rs + k);
        const context = { before: cps.slice(Math.max(0, rs - 5), rs).reverse(), after: cps.slice(re, re + 5) };
        const shape = (face) => {
            const shaping = shapeFont(face.font);
            return shapeRun(shaping, cps.slice(rs, re), script[rs], level & 1 ? 5 : 4, clusters, context, features)
                .map(info => ({ face, glyph: info.codepoint, cluster: info.cluster, advance: info.xAdvance, dx: info.xOffset, dy: info.yOffset }));
        };
        const shaped = shape(base);
        const faces = new Set(faceOf.slice(rs, re));
        if (faces.size === 1) {
            glyphs.push(...shaped);
            continue;
        }
        const others = new Map([...faces].filter(f => f && f !== base).map(f => [f, shape(f)]));
        const starts = [...new Set(shaped.map(g => g.cluster))].sort((a, b) => a - b);
        for (let i = 0; i < shaped.length;) {
            let j = i + 1;
            while (j < shaped.length && shaped[j].cluster === shaped[i].cluster)
                j++;
            const c = shaped[i].cluster, end = starts.find(v => v > c) ?? re;
            const other = faceOf[c] && others.get(faceOf[c]);
            if (!other)
                glyphs.push(...shaped.slice(i, j));
            else {
                const own = other.filter(g => g.cluster >= c && g.cluster < end);
                const before = other.reduce((m, g) => g.cluster <= c ? Math.max(m, g.cluster) : m, -1);
                if (own.length)
                    glyphs.push(...own);
                else if (!(before >= 0 && before < c))
                    glyphs.push(...shaped.slice(i, j));
            }
            i = j;
        }
    }
    const out = [];
    for (let i = 0; i < glyphs.length;) {
        let j = i + 1;
        while (j < glyphs.length && glyphs[j].cluster === glyphs[i].cluster)
            j++;
        const start = glyphs[i].cluster, span = spanAt(chunk, start);
        if (span) {
            const fontSize = span.fontSize, face = glyphs[i].face;
            let x = 0, width = 0, advance = 0;
            const placed = [];
            for (let k = i; k < j; k++) {
                const g = glyphs[k], s = fontSize / g.face.font.unitsPerEm;
                placed.push({ face: g.face, glyph: g.glyph, x: x + g.dx, y: g.dy });
                x += g.advance;
                advance += g.advance * s;
                width = Math.max(width, g.advance * s);
            }
            const s = fontSize / face.font.unitsPerEm;
            out.push({
                start, codepoint: cps[start], fontSize, width, advance, textLengthSpacing: 0, ascent: face.ascent * s, descent: face.descent * s,
                hasRelativeShift: false, glyphs: placed, transform: IDENTITY, pathTransform: IDENTITY, visible: true,
            });
        }
        i = j;
    }
    return out;
}
function applyWritingMode(clusters) {
    for (const c of clusters) {
        if (upright(c.codepoint)) {
            let m = translate(IDENTITY, 0, (c.ascent + c.descent) / 2);
            m = rotate(m, -90, c.width / 2, -(c.ascent + c.descent) / 2);
            c.pathTransform = m;
            c.ascent = c.width / 2;
            c.descent = -c.width / 2;
        }
        else
            c.transform = translate(c.transform, 0, (c.ascent + c.descent) / 2);
    }
}
function applySpacing(chunk, clusters) {
    if (chunk.spans.some(s => s.letterSpacing)) {
        clusters.forEach((c, i) => {
            const span = spanAt(chunk, c.start);
            if (!span || UNSPACED.has(scriptOf(c.codepoint)))
                return;
            if (i !== clusters.length - 1)
                c.advance += span.letterSpacing;
            if (!(c.advance >= 0)) {
                c.width = c.advance = 0;
                c.glyphs = [];
            }
        });
    }
    if (chunk.spans.some(s => s.wordSpacing))
        for (const c of clusters) {
            const span = spanAt(chunk, c.start);
            if (span && WORD_SEPARATORS.has(c.codepoint))
                c.advance += span.wordSpacing;
        }
}
function applyLengthAdjust(chunk, clusters) {
    for (const span of chunk.spans) {
        if (span.textLength === null)
            continue;
        const indices = clusters.map((c, i) => c.start >= span.start && c.start < span.end ? i : -1).filter(i => i >= 0);
        if (!indices.length)
            continue;
        const width = indices.reduce((w, i) => w + clusters[i].width, 0);
        if (!span.spacingAndGlyphs) {
            const factor = indices.length > 1 ? (span.textLength - width) / (indices.length - 1) : 0;
            for (const i of indices) {
                clusters[i].advance = clusters[i].width + factor;
                clusters[i].textLengthSpacing = factor;
            }
        }
        else {
            const factor = span.textLength / width;
            if (!(factor >= 0.001))
                continue;
            for (const i of indices) {
                clusters[i].transform = scale(clusters[i].transform, factor, 1);
                if (chunk.path) {
                    clusters[i].advance *= factor;
                    clusters[i].width *= factor;
                }
            }
        }
    }
}
function relativeShifts(text, chunk, clusters) {
    const order = clusters.map((_, i) => i).sort((a, b) => clusters[a].start - clusters[b].start);
    const shifts = clusters.map(() => [0, 0]);
    let sx = 0, sy = 0;
    for (const i of order) {
        const cp = chunk.offset + clusters[i].start;
        sx += text.dx[cp] ?? 0;
        sy += text.dy[cp] ?? 0;
        shifts[i] = [sx, sy];
    }
    return { shifts, order };
}
const anchorShift = (anchor, width) => anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
function positionLinear(text, chunk, clusters) {
    const { shifts, order } = relativeShifts(text, chunk, clusters);
    const first = order[0], last = order[order.length - 1];
    if (text.vertical)
        for (const shift of shifts)
            [shift[0], shift[1]] = [shift[1], -shift[0]];
    for (let i = 1; i < clusters.length; i++)
        if (shifts[i][0] !== shifts[i - 1][0] || shifts[i][1] !== shifts[i - 1][1])
            clusters[i].hasRelativeShift = true;
    let left = Infinity, right = -Infinity, advance = 0;
    clusters.forEach((c, i) => {
        const start = advance + shifts[i][0], end = start + c.advance - c.textLengthSpacing;
        left = Math.min(left, start, end);
        right = Math.max(right, start, end);
        advance += c.advance;
    });
    let x = shifts[first][0] - left + anchorShift(chunk.anchor, right - left);
    clusters.forEach((c, i) => {
        c.transform = translate(c.transform, x + shifts[i][0], shifts[i][1]);
        const angle = text.rotate[chunk.offset + c.start];
        if (angle) {
            c.transform = rotate(c.transform, angle);
            c.hasRelativeShift = true;
        }
        x += c.advance;
    });
    return [x + shifts[last][0], shifts[last][1]];
}
function pathSegments(path) {
    const segments = [];
    let x = 0, y = 0, sx = 0, sy = 0;
    const line = (ex, ey) => {
        segments.push([x, y, x + (ex - x) * 0.33, y + (ey - y) * 0.33, x + (ex - x) * 0.66, y + (ey - y) * 0.66, ex, ey]);
        x = ex;
        y = ey;
    };
    for (const c of path) {
        switch (c[0]) {
            case 'M':
                x = sx = c[1];
                y = sy = c[2];
                break;
            case 'L':
                line(c[1], c[2]);
                break;
            case 'Q':
                segments.push([x, y, x + 2 / 3 * (c[1] - x), y + 2 / 3 * (c[2] - y), c[3] + 2 / 3 * (c[1] - c[3]), c[4] + 2 / 3 * (c[2] - c[4]), c[3], c[4]]);
                x = c[3];
                y = c[4];
                break;
            case 'C':
                segments.push([x, y, c[1], c[2], c[3], c[4], c[5], c[6]]);
                x = c[5];
                y = c[6];
                break;
            case 'Z':
                line(sx, sy);
                break;
        }
    }
    return segments;
}
function cubicAt(s, t) {
    const mt = 1 - t;
    return [s[0] * (mt * mt * mt) + (s[2] * (mt * mt * 3) + (s[4] * (mt * 3) + s[6] * t) * t) * t,
        s[1] * (mt * mt * mt) + (s[3] * (mt * mt * 3) + (s[5] * (mt * 3) + s[7] * t) * t) * t];
}
function cubicTangent(s, t) {
    const mt = 1 - t;
    const q = [3 * (s[2] - s[0]), 3 * (s[3] - s[1]), 3 * (s[4] - s[2]), 3 * (s[5] - s[3]), 3 * (s[6] - s[4]), 3 * (s[7] - s[5])];
    return [q[0] * (mt * mt) + (q[2] * (mt * 2) + q[4] * t) * t, q[1] * (mt * mt) + (q[3] * (mt * 2) + q[5] * t) * t];
}
const GAUSS_8 = [[0.3626837833783620, -0.1834346424956498], [0.3626837833783620, 0.1834346424956498], [0.3137066458778873, -0.5255324099163290],
    [0.3137066458778873, 0.5255324099163290], [0.2223810344533745, -0.7966664774136267], [0.2223810344533745, 0.7966664774136267],
    [0.1012285362903763, -0.9602898564975363], [0.1012285362903763, 0.9602898564975363]];
const GAUSS_8_HALF = [[0.3626837833783620, 0.1834346424956498], [0.3137066458778873, 0.5255324099163290], [0.2223810344533745, 0.7966664774136267],
    [0.1012285362903763, 0.9602898564975363]];
const GAUSS_16_HALF = [[0.1894506104550685, 0.0950125098376374], [0.1826034150449236, 0.2816035507792589], [0.1691565193950025, 0.4580167776572274],
    [0.1495959888165767, 0.6178762444026438], [0.1246289712555339, 0.7554044083550030], [0.0951585116824928, 0.8656312023878318],
    [0.0622535239386479, 0.9445750230732326], [0.0271524594117541, 0.9894009349916499]];
const GAUSS_24_HALF = [[0.1279381953467522, 0.0640568928626056], [0.1258374563468283, 0.1911188674736163], [0.1216704729278034, 0.3150426796961634],
    [0.1155056680537256, 0.4337935076260451], [0.1074442701159656, 0.5454214713888396], [0.0976186521041139, 0.6480936519369755],
    [0.0861901615319533, 0.7401241915785544], [0.0733464814110803, 0.8200019859739029], [0.0592985849154368, 0.8864155270044011],
    [0.0442774388174198, 0.9382745520027328], [0.0285313886289337, 0.9747285559713095], [0.0123412297999872, 0.9951872199970213]];
function arcLength(c, accuracy, depth = 0) {
    const d03x = c[6] - c[0], d03y = c[7] - c[1], d01x = c[2] - c[0], d01y = c[3] - c[1];
    const d12x = c[4] - c[2], d12y = c[5] - c[3], d23x = c[6] - c[4], d23y = c[7] - c[5];
    const lpLc = Math.hypot(d01x, d01y) + Math.hypot(d12x, d12y) + Math.hypot(d23x, d23y) - Math.hypot(d03x, d03y);
    const dd1x = d12x - d01x, dd1y = d12y - d01y, dd2x = d23x - d12x, dd2y = d23y - d12y;
    const dmx = 0.25 * (d01x + d23x) + 0.5 * d12x, dmy = 0.25 * (d01y + d23y) + 0.5 * d12y;
    const dm1x = 0.5 * (dd2x + dd1x), dm1y = 0.5 * (dd2y + dd1y), dm2x = 0.25 * (dd2x - dd1x), dm2y = 0.25 * (dd2y - dd1y);
    let est = 0;
    for (const [w, x] of GAUSS_8) {
        const dx = dmx + dm1x * x + dm2x * (x * x), dy = dmy + dm1y * x + dm2y * (x * x);
        const ddx = dm1x + dm2x * (2 * x), ddy = dm1y + dm2y * (2 * x);
        est += w * ((ddx * ddx + ddy * ddy) / (dx * dx + dy * dy));
    }
    const quadrature = (coeffs) => {
        let sum = 0;
        for (const [w, x] of coeffs) {
            const dx = dmx + dm2x * (x * x), dy = dmy + dm2y * (x * x);
            sum += (Math.sqrt(2.25) * w) * (Math.hypot(dx + dm1x * x, dy + dm1y * x) + Math.hypot(dx - dm1x * x, dy - dm1y * x));
        }
        return sum;
    };
    if (Math.min(est ** 3 * 2.5e-6, 3e-2) * lpLc < accuracy)
        return quadrature(GAUSS_8_HALF);
    if (Math.min(est ** 6 * 1.5e-11, 9e-3) * lpLc < accuracy)
        return quadrature(GAUSS_16_HALF);
    if (Math.min(est ** 9 * 3.5e-16, 3.5e-3) * lpLc < accuracy || depth >= 20)
        return quadrature(GAUSS_24_HALF);
    const [mx, my] = cubicAt(c, 0.5);
    const left = [c[0], c[1], (c[0] + c[2]) / 2, (c[1] + c[3]) / 2, (c[0] + c[2] * 2 + c[4]) * 0.25, (c[1] + c[3] * 2 + c[5]) * 0.25, mx, my];
    const right = [mx, my, (c[2] + c[4] * 2 + c[6]) * 0.25, (c[3] + c[5] * 2 + c[7]) * 0.25, (c[4] + c[6]) / 2, (c[5] + c[7]) / 2, c[6], c[7]];
    return arcLength(left, accuracy * 0.5, depth + 1) + arcLength(right, accuracy * 0.5, depth + 1);
}
function subsegment(c, t0, t1) {
    const [x0, y0] = cubicAt(c, t0), [x3, y3] = cubicAt(c, t1), [d0x, d0y] = cubicTangent(c, t0), [d1x, d1y] = cubicTangent(c, t1);
    const k = (t1 - t0) * (1 / 3);
    return [x0, y0, x0 + k * d0x, y0 + k * d0y, x3 - k * d1x, y3 - k * d1y, x3, y3];
}
const copysign = (m, s) => s < 0 || Object.is(s, -0) ? -Math.abs(m) : Math.abs(m);
function inverseArcLength(c, length, accuracy) {
    if (length <= 0)
        return 0;
    const total = arcLength(c, accuracy);
    if (length >= total)
        return 1;
    let tLast = 0, lengthLast = 0;
    const epsilon = accuracy / total;
    const n = 1 - Math.min(0, Math.ceil(Math.log2(epsilon)));
    const inner = accuracy / n;
    const f = (t) => {
        const arc = t > tLast ? arcLength(subsegment(c, tLast, t), inner) : -arcLength(subsegment(c, t, tLast), inner);
        lengthLast += arc;
        tLast = t;
        return lengthLast - length;
    };
    let a = 0, b = 1, ya = -length, yb = total - length;
    const k1 = 0.2;
    const nmax = 1 + Math.max(0, Math.ceil(Math.log2((b - a) / epsilon)) - 1);
    let scaled = epsilon * 2 ** nmax;
    while (b - a > 2 * epsilon) {
        const half = 0.5 * (a + b), r = scaled - 0.5 * (b - a), xf = (yb * a - ya * b) / (yb - ya), sigma = half - xf;
        const delta = k1 * (b - a) ** 2;
        const xt = delta <= Math.abs(half - xf) ? xf + copysign(delta, sigma) : half;
        const x = Math.abs(xt - half) <= r ? xt : half - copysign(r, sigma);
        const y = f(x);
        if (y > 0) {
            b = x;
            yb = y;
        }
        else if (y < 0) {
            a = x;
            ya = y;
        }
        else
            return x;
        scaled *= 0.5;
    }
    return 0.5 * (a + b);
}
export function pathLength(path) {
    let length = 0;
    for (const s of pathSegments(path))
        length += arcLength(s, 0.5);
    return length;
}
function pathNormals(path, offsets, scale) {
    const out = offsets.map(() => null);
    const accuracy = 0.5 / Math.max(1, scale);
    let length = 0;
    for (const s of pathSegments(path)) {
        const segment = arcLength(s, accuracy);
        offsets.forEach((offset, i) => {
            if (out[i] || offset < 0 || offset < length || offset > length + segment)
                return;
            const t = Math.min(1, Math.max(0, inverseArcLength(s, offset - length, accuracy)));
            const [x, y] = cubicAt(s, t), [tx, ty] = cubicTangent(s, t);
            out[i] = [x, y, Math.atan2(tx, -ty) * 180 / Math.PI - 90];
        });
        length += segment;
    }
    return out;
}
function positionOnPath(text, chunk, clusters, spanShift) {
    const flow = chunk.path;
    const { shifts } = relativeShifts(text, chunk, clusters);
    const chunkOffset = (text.vertical ? chunk.y : chunk.x) ?? 0;
    const start = chunkOffset + flow.startOffset + anchorShift(chunk.anchor, clusters.reduce((w, c) => w + c.advance, 0));
    const offsets = [];
    let advance = start;
    clusters.forEach((c, i) => {
        offsets.push(advance + shifts[i][0] + c.width / 2);
        advance += c.advance;
    });
    const normals = pathNormals(flow.path, offsets, text.scale);
    let lastX = 0, lastY = 0;
    clusters.forEach((c, i) => {
        const normal = normals[i];
        if (!normal) {
            c.visible = false;
            return;
        }
        const [x, y, angle] = normal;
        c.hasRelativeShift = true;
        const original = c.transform, half = c.width / 2;
        let m = translate(IDENTITY, x - half, y);
        m = rotate(m, angle, half, 0);
        const span = spanAt(chunk, c.start);
        const baseline = span ? -spanShift(span) : 0;
        const dy = shifts[i][1];
        if (dy || baseline)
            m = translate(m, 0, dy - baseline);
        const turn = text.rotate[chunk.offset + c.start];
        if (turn)
            m = rotate(m, turn);
        c.transform = multiply(m, original);
        lastX = x + c.advance;
        lastY = y;
    });
    return [lastX, lastY];
}
function baselineShift(span, face, vertical) {
    const s = span.fontSize / face.font.unitsPerEm;
    let shift = 0;
    for (let i = span.baselineShift.length - 1; i >= 0; i--) {
        const b = span.baselineShift[i];
        shift += b === 'sub' ? -face.subscriptOffset * s : b === 'super' ? face.superscriptOffset * s : b;
    }
    shift = -shift;
    if (!vertical) {
        let alignment = span.alignmentBaseline;
        if (alignment === 'auto' || alignment === 'baseline')
            alignment = span.dominantBaseline;
        const ascent = face.ascent * s, descent = face.descent * s;
        switch (alignment) {
            case 'before-edge':
            case 'text-before-edge':
                shift += ascent;
                break;
            case 'middle':
                shift += face.xHeight * s * 0.5;
                break;
            case 'central':
                shift += ascent - (ascent - descent) * 0.5;
                break;
            case 'after-edge':
            case 'text-after-edge':
            case 'ideographic':
                shift += descent;
                break;
            case 'hanging':
                shift += ascent * 0.8;
                break;
            case 'mathematical':
                shift += ascent * 0.5;
                break;
        }
    }
    return shift;
}
export function placeOutline(out, outline, m) {
    let x = 0, y = 0;
    for (const c of outline) {
        switch (c[0]) {
            case 'M':
            case 'L': {
                out.push([c[0], ...apply(m, c[1], c[2])]);
                x = c[1];
                y = c[2];
                break;
            }
            case 'Q': {
                const c1 = apply(m, x + 2 / 3 * (c[1] - x), y + 2 / 3 * (c[2] - y)), c2 = apply(m, c[3] + 2 / 3 * (c[1] - c[3]), c[4] + 2 / 3 * (c[2] - c[4]));
                out.push(['C', ...c1, ...c2, ...apply(m, c[3], c[4])]);
                x = c[3];
                y = c[4];
                break;
            }
            case 'C': {
                out.push(['C', ...apply(m, c[1], c[2]), ...apply(m, c[3], c[4]), ...apply(m, c[5], c[6])]);
                x = c[5];
                y = c[6];
                break;
            }
            case 'Z':
                out.push(['Z']);
                break;
        }
    }
}
function rectPath(m, x, y, w, h) {
    return [['M', ...apply(m, x, y)], ['L', ...apply(m, x + w, y)], ['L', ...apply(m, x + w, y + h)], ['L', ...apply(m, x, y + h)], ['Z']];
}
export function layOutText(text, fonts) {
    if (!fonts.length)
        return null;
    const primary = new Map();
    for (const chunk of text.chunks)
        for (const span of chunk.spans) {
            const face = matchFont(fonts, span.font);
            if (face)
                primary.set(span, variedFace(face, span.font, span.fontSize));
        }
    const spans = [];
    let box = null;
    const extend = (path) => {
        for (const c of path)
            for (let i = 1; i + 1 < c.length; i += 2) {
                const x = c[i], y = c[i + 1];
                if (!box)
                    box = { x0: x, y0: y, x1: x, y1: y };
                else {
                    box.x0 = Math.min(box.x0, x);
                    box.y0 = Math.min(box.y0, y);
                    box.x1 = Math.max(box.x1, x);
                    box.y1 = Math.max(box.y1, y);
                }
            }
    };
    let lastX = 0, lastY = 0;
    for (const chunk of text.chunks) {
        const [x, y] = chunk.path ? [0, 0] : [chunk.x ?? lastX, chunk.y ?? lastY];
        const clusters = shapeChunk(chunk, fonts, primary);
        if (!clusters.length)
            continue;
        if (text.vertical)
            applyWritingMode(clusters);
        applySpacing(chunk, clusters);
        applyLengthAdjust(chunk, clusters);
        const shiftOf = (span) => {
            const face = primary.get(span);
            return face ? baselineShift(span, face, text.vertical) : 0;
        };
        const position = chunk.path ? positionOnPath(text, chunk, clusters, shiftOf) : positionLinear(text, chunk, clusters);
        const textMatrix = text.vertical && !chunk.path ? rotate(IDENTITY, 90, x, y) : IDENTITY;
        for (const span of chunk.spans) {
            const face = primary.get(span);
            if (!face)
                continue;
            let spanMatrix = translate(textMatrix, x, y);
            if (!chunk.path)
                spanMatrix = translate(spanMatrix, 0, shiftOf(span));
            const s = span.fontSize / face.font.unitsPerEm;
            const out = { paint: span.paint, visible: span.visible, glyphs: [], colors: [], before: [], after: [] };
            const runs = [];
            let current = null;
            for (const c of clusters) {
                if (c.start >= span.start && c.start < span.end) {
                    if (current && c.hasRelativeShift)
                        current = null;
                    if (!current)
                        runs.push(current = { width: c.advance, transform: c.transform });
                    else
                        current.width += c.advance;
                }
                else
                    current = null;
            }
            const decoration = (paint, offset, list) => {
                if (!paint || !runs.length)
                    return;
                const thickness = face.underlineThickness * s, path = [];
                for (const run of runs)
                    if (run.width > 0)
                        path.push(...rectPath(multiply(spanMatrix, translate(run.transform, 0, offset)), 0, -thickness / 2, run.width, thickness));
                if (!path.length)
                    return;
                extend(path);
                list.push({ path, paint });
            };
            const height = (face.ascent - face.descent) * s;
            decoration(span.overline, text.vertical ? -height / 2 : -face.ascent * s, out.before);
            decoration(span.underline, text.vertical ? height / 2 : -face.underlinePosition * s, out.before);
            decoration(span.lineThrough, text.vertical ? 0 : -face.lineThroughPosition * s, out.after);
            let any = false;
            for (const c of clusters) {
                if (!c.visible)
                    continue;
                const m = multiply(spanMatrix, multiply(c.transform, c.pathTransform));
                extend(rectPath(m, 0, -c.ascent, c.advance > 0 ? c.advance : 1, c.ascent - c.descent));
                if (c.start < span.start || c.start >= span.end)
                    continue;
                any = true;
                for (const g of c.glyphs) {
                    const gs = c.fontSize / g.face.font.unitsPerEm, matrix = scale(translate(scale(m, gs, gs), g.x, -g.y), 1, -1);
                    const kind = colorKind(g.face, g.glyph, c.fontSize);
                    if (kind)
                        out.colors.push({ face: g.face, glyph: g.glyph, kind, fontSize: c.fontSize, matrix });
                    else
                        placeOutline(out.glyphs, g.face.font.outline(g.glyph), matrix);
                }
            }
            if (any || out.before.length || out.after.length)
                spans.push(out);
        }
        if (text.vertical && !chunk.path)
            position.reverse();
        lastX = x + position[0];
        lastY = y + position[1];
    }
    const b = box;
    if (!b || !spans.length)
        return null;
    return { spans, bbox: { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } };
}
