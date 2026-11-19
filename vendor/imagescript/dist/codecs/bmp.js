import { MAX_PIXELS, checkPixels } from "../util/limits.js";
const BI_RGB = 0, BI_RLE8 = 1, BI_RLE4 = 2, BI_BITFIELDS = 3, BI_JPEG = 4, BI_PNG = 5, BI_ALPHABITFIELDS = 6;
const u16 = (d, o) => d[o] | d[o + 1] << 8;
const u32 = (d, o) => (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0;
const i32 = (d, o) => d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24;
const WINDOWS_HEADERS = [40, 52, 56, 108, 124];
const isHeaderSize = (size) => size === 12 || WINDOWS_HEADERS.includes(size) || (size >= 16 && size <= 64 && size % 4 === 0);
export function isBMP(d) {
    return d.length >= 26 && d[0] === 0x42 && d[1] === 0x4d && isHeaderSize(u32(d, 14));
}
function channel(mask) {
    mask >>>= 0;
    let shift = 0;
    if (mask)
        while (!(mask >>> shift & 1))
            shift++;
    const max = mask >>> shift;
    let table = null;
    if (max && max < 65536) {
        table = new Uint8Array(max + 1);
        for (let v = 0; v <= max; v++)
            table[v] = Math.round(v * 255 / max);
    }
    return { mask, shift, max, table };
}
function sample(c, v) {
    if (!c.max)
        return 0;
    const x = (v & c.mask) >>> c.shift;
    return c.table ? c.table[x] : Math.round(x * 255 / c.max);
}
function readInfo(d, o) {
    const size = u32(d, o);
    if (!isHeaderSize(size))
        throw new Error(`BMP: unknown header size ${size}`);
    if (o + size > d.length)
        throw new Error('BMP: truncated header');
    if (size === 12) {
        return { width: u16(d, o + 4), height: u16(d, o + 6), topDown: false, bits: u16(d, o + 10), compression: BI_RGB, headerEnd: o + 12, entryBytes: 3, colors: 0, masks: null };
    }
    const os2 = !WINDOWS_HEADERS.includes(size);
    const width = i32(d, o + 4), rawHeight = i32(d, o + 8);
    const bits = u16(d, o + 14);
    let compression = size >= 20 ? u32(d, o + 16) : BI_RGB;
    if (os2 && (compression === 3 || compression === 4))
        throw new Error(`BMP: unsupported OS/2 compression (${compression === 3 ? 'Huffman 1D' : 'RLE24'})`);
    const colors = size >= 36 ? u32(d, o + 32) : 0;
    let masks = null;
    let headerEnd = o + size;
    if (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS) {
        if (size >= 52)
            masks = [u32(d, o + 40), u32(d, o + 44), u32(d, o + 48), size >= 56 ? u32(d, o + 52) : 0];
        else {
            const count = compression === BI_ALPHABITFIELDS ? 4 : 3;
            if (headerEnd + count * 4 > d.length)
                throw new Error('BMP: truncated bit fields');
            masks = [u32(d, headerEnd), u32(d, headerEnd + 4), u32(d, headerEnd + 8), count === 4 ? u32(d, headerEnd + 12) : 0];
            headerEnd += count * 4;
        }
        compression = BI_BITFIELDS;
    }
    if (width <= 0 || rawHeight === 0 || rawHeight === -0x80000000)
        throw new Error(`BMP: invalid dimensions ${width}x${rawHeight}`);
    return { width, height: Math.abs(rawHeight), topDown: rawHeight < 0, bits, compression, headerEnd, entryBytes: 4, colors, masks };
}
function readPalette(d, info, end) {
    const { bits, entryBytes, headerEnd } = info;
    if (bits > 8)
        return null;
    let count = info.colors || 1 << bits;
    count = Math.max(0, Math.min(count, Math.floor((Math.min(end, d.length) - headerEnd) / entryBytes)));
    const palette = new Uint32Array(Math.max(count, 1 << bits));
    palette.fill(0xff000000);
    for (let i = 0; i < count; i++) {
        const p = headerEnd + i * entryBytes;
        palette[i] = (0xff000000 | d[p] << 16 | d[p + 1] << 8 | d[p + 2]) >>> 0;
    }
    return palette;
}
export function decodeDIB(d, o, pixelOffset, maxPixels, ico = false) {
    const info = readInfo(d, o);
    const { width, bits, compression, topDown } = info;
    const height = ico ? info.height >> 1 : info.height;
    if (!height)
        throw new Error('BMP: invalid dimensions');
    if (compression === BI_JPEG || compression === BI_PNG) {
        const start = pixelOffset ?? info.headerEnd;
        return { embedded: compression === BI_JPEG ? 'jpeg' : 'png', data: d.subarray(start) };
    }
    if (![1, 2, 4, 8, 16, 24, 32, 64].includes(bits))
        throw new Error(`BMP: unsupported bit depth ${bits}`);
    if (compression === BI_RLE8 && bits !== 8 || compression === BI_RLE4 && bits !== 4)
        throw new Error('BMP: RLE compression of the wrong bit depth');
    if (compression === BI_BITFIELDS && bits !== 16 && bits !== 32)
        throw new Error('BMP: bit fields need 16 or 32 bit pixels');
    if (compression > BI_PNG)
        throw new Error(`BMP: unsupported compression ${compression}`);
    checkPixels(width, height, maxPixels);
    const palette = readPalette(d, info, pixelOffset ?? d.length);
    const start = pixelOffset ?? info.headerEnd + (bits <= 8 ? info.colors || 1 << bits : info.colors) * info.entryBytes;
    const pixels = new Uint8Array(width * height * 4);
    const out = new Uint32Array(pixels.buffer);
    const row = (y) => (topDown ? y : height - 1 - y) * width;
    if (compression === BI_RLE8 || compression === BI_RLE4) {
        decodeRLE(d, start, width, height, compression === BI_RLE4, palette, out, row);
        return { width, height, pixels };
    }
    const stride = (width * bits + 31 >>> 5) * 4;
    if (start + stride * (height - 1) + Math.ceil(width * bits / 8) > d.length)
        throw new Error('BMP: truncated pixel data');
    if (palette) {
        const mask = (1 << bits) - 1;
        for (let y = 0; y < height; y++) {
            const r = start + y * stride, o = row(y);
            for (let x = 0; x < width; x++) {
                const bit = x * bits;
                out[o + x] = palette[d[r + (bit >> 3)] >> (8 - bits - (bit & 7)) & mask];
            }
        }
    }
    else if (bits === 24) {
        for (let y = 0; y < height; y++) {
            const r = start + y * stride, o = row(y);
            for (let x = 0; x < width; x++) {
                const p = r + x * 3;
                out[o + x] = (0xff000000 | d[p] << 16 | d[p + 1] << 8 | d[p + 2]) >>> 0;
            }
        }
    }
    else if (bits === 64) {
        const srgb = (v) => {
            const c = Math.min(1, Math.max(0, v / 8192));
            return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
        };
        const s16 = (p) => d[p] | d[p + 1] << 8 << 16 >> 16;
        for (let y = 0; y < height; y++) {
            const r = start + y * stride, o = row(y) * 4;
            for (let x = 0; x < width; x++) {
                const p = r + x * 8, q = o + x * 4;
                pixels[q] = srgb(s16(p + 4));
                pixels[q + 1] = srgb(s16(p + 2));
                pixels[q + 2] = srgb(s16(p));
                pixels[q + 3] = Math.round(Math.min(1, Math.max(0, s16(p + 6) / 8192)) * 255);
            }
        }
    }
    else {
        const masks = info.masks ?? (bits === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, ico && bits === 32 ? 0xff000000 : 0]);
        const [cr, cg, cb, ca] = masks.map(channel);
        const fast = bits === 32 && cr.mask === 0xff0000 && cg.mask === 0xff00 && cb.mask === 0xff;
        let alphaSeen = false;
        for (let y = 0; y < height; y++) {
            const r = start + y * stride, o = row(y);
            for (let x = 0; x < width; x++) {
                const v = bits === 16 ? u16(d, r + x * 2) : u32(d, r + x * 4);
                const a = ca.max ? sample(ca, v) : 255;
                if (ca.max && a)
                    alphaSeen = true;
                out[o + x] = fast
                    ? (a << 24 | (v & 0xff) << 16 | v & 0xff00 | v >> 16 & 0xff) >>> 0
                    : (a << 24 | sample(cb, v) << 16 | sample(cg, v) << 8 | sample(cr, v)) >>> 0;
            }
        }
        if (ca.max && !alphaSeen)
            for (let i = 0; i < out.length; i++)
                out[i] |= 0xff000000;
        if (ico && bits === 32 && alphaSeen)
            return { width, height, pixels };
    }
    if (ico) {
        const maskStart = start + stride * height, maskStride = (width + 31 >>> 5) * 4;
        if (maskStart + maskStride * (height - 1) + Math.ceil(width / 8) <= d.length) {
            for (let y = 0; y < height; y++) {
                const r = maskStart + y * maskStride, o = row(y);
                for (let x = 0; x < width; x++)
                    if (d[r + (x >> 3)] >> (7 - (x & 7)) & 1)
                        out[o + x] = 0;
            }
        }
    }
    return { width, height, pixels };
}
function decodeRLE(d, o, width, height, four, palette, out, row) {
    let x = 0, y = 0;
    const put = (index) => {
        if (x < width && y < height)
            out[row(y) + x] = palette[index];
        x++;
    };
    while (y < height) {
        if (o + 1 >= d.length)
            throw new Error('BMP: truncated RLE data');
        const n = d[o], v = d[o + 1];
        o += 2;
        if (n) {
            for (let i = 0; i < n; i++)
                put(four ? (i & 1 ? v & 15 : v >> 4) : v);
        }
        else if (v === 0) {
            x = 0;
            y++;
        }
        else if (v === 1) {
            break;
        }
        else if (v === 2) {
            if (o + 1 >= d.length)
                throw new Error('BMP: truncated RLE data');
            x += d[o];
            y += d[o + 1];
            o += 2;
        }
        else {
            const bytes = four ? v + 1 >> 1 : v;
            if (o + bytes > d.length)
                throw new Error('BMP: truncated RLE data');
            for (let i = 0; i < v; i++)
                put(four ? (i & 1 ? d[o + (i >> 1)] & 15 : d[o + (i >> 1)] >> 4) : d[o + i]);
            o += bytes + (bytes & 1);
        }
    }
}
export function decode(d, maxPixels = MAX_PIXELS) {
    if (!isBMP(d))
        throw new Error('BMP: invalid header');
    const offset = u32(d, 10);
    return decodeDIB(d, 14, offset >= 26 && offset < d.length ? offset : null, maxPixels);
}
export function encode(rgba, width, height) {
    if (width < 1 || height < 1)
        throw new RangeError('BMP: dimensions must be at least 1');
    const count = width * height;
    if (rgba.byteOffset % 4)
        rgba = rgba.slice(0, count * 4);
    const pixels = new Uint32Array(rgba.buffer, rgba.byteOffset, count);
    let opaque = true;
    for (let i = 3; i < count * 4; i += 4)
        if (rgba[i] !== 255) {
            opaque = false;
            break;
        }
    let colors = null;
    if (opaque) {
        colors = new Map();
        for (let i = 0; i < count && colors; i++) {
            if (!colors.has(pixels[i])) {
                if (colors.size === 256)
                    colors = null;
                else
                    colors.set(pixels[i], colors.size);
            }
        }
    }
    const bits = colors ? colors.size <= 2 ? 1 : colors.size <= 16 ? 4 : 8 : opaque ? 24 : 32;
    const headerSize = bits === 32 ? 108 : 40;
    const paletteSize = colors ? (1 << bits) * 4 : 0;
    const stride = (width * bits + 31 >>> 5) * 4;
    const offset = 14 + headerSize + paletteSize;
    const size = offset + stride * height;
    if (size > 0xffffffff)
        throw new RangeError('BMP: image too large');
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    out[0] = 0x42;
    out[1] = 0x4d;
    view.setUint32(2, size, true);
    view.setUint32(10, offset, true);
    view.setUint32(14, headerSize, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, bits, true);
    view.setUint32(30, bits === 32 ? BI_BITFIELDS : BI_RGB, true);
    view.setUint32(34, stride * height, true);
    view.setUint32(38, 2835, true);
    view.setUint32(42, 2835, true);
    if (bits === 32) {
        view.setUint32(54, 0x00ff0000, true);
        view.setUint32(58, 0x0000ff00, true);
        view.setUint32(62, 0x000000ff, true);
        view.setUint32(66, 0xff000000, true);
        view.setUint32(70, 0x73524742, true);
    }
    if (colors)
        for (const [color, index] of colors) {
            const p = 14 + headerSize + index * 4;
            out[p] = color >> 16 & 255;
            out[p + 1] = color >> 8 & 255;
            out[p + 2] = color & 255;
        }
    for (let y = 0; y < height; y++) {
        const r = offset + (height - 1 - y) * stride, s = y * width * 4;
        if (colors) {
            const map = colors;
            for (let x = 0; x < width; x++)
                out[r + (x * bits >> 3)] |= map.get(pixels[y * width + x]) << (8 - bits - (x * bits & 7));
        }
        else if (bits === 24) {
            for (let x = 0; x < width; x++) {
                const p = r + x * 3, q = s + x * 4;
                out[p] = rgba[q + 2];
                out[p + 1] = rgba[q + 1];
                out[p + 2] = rgba[q];
            }
        }
        else {
            for (let x = 0; x < width; x++) {
                const p = r + x * 4, q = s + x * 4;
                out[p] = rgba[q + 2];
                out[p + 1] = rgba[q + 1];
                out[p + 2] = rgba[q];
                out[p + 3] = rgba[q + 3];
            }
        }
    }
    return out;
}
