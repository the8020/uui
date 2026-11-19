export function parsePalette(font, cpal) {
    const entries = font.u16(cpal + 2), records = cpal + font.u32(cpal + 8), first = font.u16(cpal + 12);
    return index => {
        if (index === 0xffff || index >= entries)
            return null;
        const o = records + (first + index) * 4;
        return (font.u8(o + 2) << 24 | font.u8(o + 1) << 16 | font.u8(o) << 8 | font.u8(o + 3)) >>> 0;
    };
}
export function parseColorLayers(font) {
    const colr = font.tables.COLR?.offset, cpal = font.tables.CPAL?.offset;
    if (colr === undefined || cpal === undefined)
        return null;
    const baseCount = font.u16(colr + 2), bases = colr + font.u32(colr + 4), layers = colr + font.u32(colr + 8);
    if (!baseCount)
        return null;
    const color = parsePalette(font, cpal);
    const cache = new Map();
    return glyph => {
        let result = cache.get(glyph);
        if (result !== undefined)
            return result;
        result = null;
        for (let lo = 0, hi = baseCount - 1; lo <= hi;) {
            const mid = lo + hi >> 1, record = bases + mid * 6, id = font.u16(record);
            if (id < glyph)
                lo = mid + 1;
            else if (id > glyph)
                hi = mid - 1;
            else {
                const start = font.u16(record + 2), count = font.u16(record + 4);
                result = [];
                for (let i = 0; i < count; i++) {
                    const layer = layers + (start + i) * 4;
                    result.push({ glyph: font.u16(layer), color: color(font.u16(layer + 2)) });
                }
                break;
            }
        }
        cache.set(glyph, result);
        return result;
    };
}
export function parseBitmaps(font, size) {
    return parseCBDT(font, size) ?? parseSbix(font, size);
}
function closestStrike(ppems, size) {
    let best = -1;
    for (const [i, ppem] of ppems.entries()) {
        const current = best < 0 ? 0 : ppems[best];
        if (best < 0 || (current < size ? ppem > current : ppem >= size && ppem < current))
            best = i;
    }
    return best;
}
function parseSbix(font, size) {
    const sbix = font.tables.sbix?.offset;
    if (sbix === undefined)
        return null;
    const strikes = Array.from({ length: font.u32(sbix + 4) }, (_, i) => sbix + font.u32(sbix + 8 + i * 4));
    const index = closestStrike(strikes.map(strike => font.u16(strike)), size);
    if (index < 0)
        return null;
    const strike = strikes[index], ppem = font.u16(strike);
    const cache = new Map();
    const lookup = (glyph, depth) => {
        if (glyph >= font.numGlyphs || depth > 4)
            return null;
        const start = strike + font.u32(strike + 4 + glyph * 4), end = strike + font.u32(strike + 8 + glyph * 4);
        if (end - start < 8)
            return null;
        const type = font.u32(start + 4);
        if (type === 0x64757065)
            return lookup(font.u16(start + 8), depth + 1);
        if (type !== 0x706e6720)
            return null;
        const png = font.data.subarray(start + 8, end);
        if (png.length < 24)
            return null;
        const header = new DataView(png.buffer, png.byteOffset + 16, 8), height = header.getUint32(4);
        return { png, ppem, width: header.getUint32(0), height, left: font.i16(start), top: font.i16(start + 2) + height };
    };
    return glyph => {
        let result = cache.get(glyph);
        if (result === undefined)
            cache.set(glyph, result = lookup(glyph, 0));
        return result;
    };
}
function parseCBDT(font, size) {
    const cblc = font.tables.CBLC?.offset, cbdt = font.tables.CBDT?.offset;
    if (cblc === undefined || cbdt === undefined)
        return null;
    const ppems = Array.from({ length: font.u32(cblc + 4) }, (_, i) => font.u8(cblc + 8 + i * 48 + 45));
    const index = closestStrike(ppems, size);
    if (index < 0)
        return null;
    const strike = cblc + 8 + index * 48, strikePpem = ppems[index];
    const array = cblc + font.u32(strike), subtables = font.u32(strike + 8);
    const locate = (glyph) => {
        for (let i = 0; i < subtables; i++) {
            const entry = array + i * 8, firstGlyph = font.u16(entry), lastGlyph = font.u16(entry + 2);
            if (glyph < firstGlyph || glyph > lastGlyph)
                continue;
            const header = array + font.u32(entry + 4);
            const indexFormat = font.u16(header), format = font.u16(header + 2), data = cbdt + font.u32(header + 4), k = glyph - firstGlyph;
            switch (indexFormat) {
                case 1: {
                    const start = font.u32(header + 8 + k * 4), end = font.u32(header + 12 + k * 4);
                    return end > start ? { offset: data + start, format, metrics: -1 } : null;
                }
                case 2: return { offset: data + k * font.u32(header + 8), format, metrics: header + 12 };
                case 3: {
                    const start = font.u16(header + 8 + k * 2), end = font.u16(header + 10 + k * 2);
                    return end > start ? { offset: data + start, format, metrics: -1 } : null;
                }
                case 4: {
                    const count = font.u32(header + 8);
                    for (let j = 0; j < count; j++) {
                        const pair = header + 12 + j * 4;
                        if (font.u16(pair) === glyph)
                            return { offset: data + font.u16(pair + 2), format, metrics: -1 };
                    }
                    return null;
                }
                case 5: {
                    const size = font.u32(header + 8), count = font.u32(header + 20);
                    for (let j = 0; j < count; j++)
                        if (font.u16(header + 24 + j * 2) === glyph)
                            return { offset: data + j * size, format, metrics: header + 12 };
                    return null;
                }
                default: return null;
            }
        }
        return null;
    };
    const cache = new Map();
    return glyph => {
        let result = cache.get(glyph);
        if (result !== undefined)
            return result;
        result = null;
        const location = locate(glyph);
        if (location) {
            const { format } = location;
            let o = location.offset, metrics = location.metrics;
            if (format === 17) {
                metrics = o;
                o += 5;
            }
            else if (format === 18) {
                metrics = o;
                o += 8;
            }
            if ((format === 17 || format === 18 || format === 19) && metrics >= 0) {
                const length = font.u32(o);
                result = { png: font.data.subarray(o + 4, o + 4 + length), ppem: strikePpem, width: font.u8(metrics + 1), height: font.u8(metrics), left: font.i8(metrics + 2), top: font.i8(metrics + 3) };
            }
        }
        cache.set(glyph, result);
        return result;
    };
}
