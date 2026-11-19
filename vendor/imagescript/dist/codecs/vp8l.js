/*!
 * WebP lossless (VP8L) bitstream, as specified in RFC 9649 ("WebP Image Format") section 3 onwards, including its
 * table of short distance codes. Copyright (c) 2024 IETF Trust and the persons identified as the document authors,
 * Revised BSD License (see THIRD_PARTY_NOTICES.md). The encoder's choice of transforms follows libwebp's entropy
 * analysis (src/enc/vp8l_enc.c, AnalyzeEntropy), its color transform search libwebp's (src/enc/predictor_enc.c).
 * Copyright (c) 2012 Google Inc., BSD-3-Clause License
 */
import { ByteWriter } from "../util/bytes.js";
import { MAX_PIXELS, checkPixels } from "../util/limits.js";
import { runChunks, shared } from "../util/threads.js";
const SIGNATURE = 0x2f;
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const DISTANCE_MAP = Int8Array.of(0, 1, 1, 0, 1, 1, -1, 1, 0, 2, 2, 0, 1, 2, -1, 2, 2, 1, -2, 1, 2, 2, -2, 2, 0, 3, 3, 0, 1, 3, -1, 3, 3, 1, -3, 1, 2, 3, -2, 3, 3, 2, -3, 2, 0, 4, 4, 0, 1, 4, -1, 4, 4, 1, -4, 1, 3, 3, -3, 3, 2, 4, -2, 4, 4, 2, -4, 2, 0, 5, 3, 4, -3, 4, 4, 3, -4, 3, 5, 0, 1, 5, -1, 5, 5, 1, -5, 1, 2, 5, -2, 5, 5, 2, -5, 2, 4, 4, -4, 4, 3, 5, -3, 5, 5, 3, -5, 3, 0, 6, 6, 0, 1, 6, -1, 6, 6, 1, -6, 1, 2, 6, -2, 6, 6, 2, -6, 2, 4, 5, -4, 5, 5, 4, -5, 4, 3, 6, -3, 6, 6, 3, -6, 3, 0, 7, 7, 0, 1, 7, -1, 7, 5, 5, -5, 5, 7, 1, -7, 1, 4, 6, -4, 6, 6, 4, -6, 4, 2, 7, -2, 7, 7, 2, -7, 2, 3, 7, -3, 7, 7, 3, -7, 3, 5, 6, -5, 6, 6, 5, -6, 5, 8, 0, 4, 7, -4, 7, 7, 4, -7, 4, 8, 1, 8, 2, 6, 6, -6, 6, 8, 3, 5, 7, -5, 7, 7, 5, -7, 5, 8, 4, 6, 7, -6, 7, 7, 6, -7, 6, 8, 5, 7, 7, -7, 7, 8, 6, 8, 7);
const NUM_LITERAL_CODES = 256;
const NUM_LENGTH_CODES = 24;
const NUM_DISTANCE_CODES = 40;
export class BitReader {
    data;
    pos = 0;
    buffer = 0;
    count = 0;
    constructor(data, offset = 0) {
        this.data = data;
        this.pos = offset;
    }
    fill() {
        while (this.count <= 24) {
            const byte = this.pos < this.data.length ? this.data[this.pos] : 0;
            if (this.pos > this.data.length + 8)
                throw new Error('VP8L: unexpected end of data');
            this.pos++;
            this.buffer |= byte << this.count;
            this.count += 8;
        }
    }
    read(bits) {
        if (bits === 0)
            return 0;
        if (this.count < bits)
            this.fill();
        const value = this.buffer & (1 << bits) - 1;
        this.buffer >>>= bits;
        this.count -= bits;
        return value;
    }
    peek() {
        if (this.count < 24)
            this.fill();
        return this.buffer & 0xffffff;
    }
    skip(bits) {
        this.buffer >>>= bits;
        this.count -= bits;
    }
    get overrun() {
        return this.pos - (this.count >> 3) > this.data.length;
    }
}
const ROOT_BITS = 8;
const SUBTABLE = 0x40000000;
export function buildCode(lengths, size) {
    let nonZero = 0, last = 0, maxLength = 0;
    const counts = new Int32Array(16);
    for (let s = 0; s < size; s++) {
        const l = lengths[s];
        if (l) {
            nonZero++;
            last = s;
            counts[l]++;
            if (l > maxLength)
                maxLength = l;
        }
    }
    if (nonZero === 0)
        throw new Error('VP8L: empty prefix code');
    if (nonZero === 1)
        return { table: new Int32Array(0), single: last };
    const next = new Int32Array(16);
    let code = 0, left = 1;
    for (let l = 1; l <= 15; l++) {
        code = code + counts[l - 1] << 1;
        next[l] = code;
        left = (left << 1) - counts[l];
        if (left < 0)
            throw new Error('VP8L: invalid prefix code (oversubscribed)');
    }
    if (left !== 0)
        throw new Error('VP8L: invalid prefix code (incomplete)');
    const reverse = (c, len) => {
        let r = 0;
        for (let i = 0; i < len; i++, c >>= 1)
            r = r << 1 | c & 1;
        return r;
    };
    const rootSize = 1 << ROOT_BITS;
    const subBits = new Int32Array(rootSize);
    const symbolCodes = new Int32Array(size);
    for (let s = 0; s < size; s++) {
        const l = lengths[s];
        if (!l)
            continue;
        const c = reverse(next[l]++, l);
        symbolCodes[s] = c;
        if (l > ROOT_BITS) {
            const root = c & rootSize - 1;
            subBits[root] = Math.max(subBits[root], l - ROOT_BITS);
        }
    }
    let total = rootSize;
    const subOffset = new Int32Array(rootSize);
    for (let r = 0; r < rootSize; r++)
        if (subBits[r]) {
            subOffset[r] = total;
            total += 1 << subBits[r];
        }
    const table = new Int32Array(total);
    for (let r = 0; r < rootSize; r++)
        if (subBits[r])
            table[r] = SUBTABLE | subOffset[r] << 4 | subBits[r];
    for (let s = 0; s < size; s++) {
        const l = lengths[s];
        if (!l)
            continue;
        const c = symbolCodes[s];
        if (l <= ROOT_BITS) {
            for (let i = c; i < rootSize; i += 1 << l)
                table[i] = s << 4 | l;
        }
        else {
            const root = c & rootSize - 1;
            const bits = subBits[root];
            const rest = c >> ROOT_BITS, restLength = l - ROOT_BITS;
            for (let i = rest; i < 1 << bits; i += 1 << restLength)
                table[subOffset[root] + i] = s << 4 | l;
        }
    }
    return { table, single: -1 };
}
export function readSymbol(reader, code) {
    if (code.single >= 0)
        return code.single;
    const bits = reader.peek();
    let entry = code.table[bits & (1 << ROOT_BITS) - 1];
    if (entry & SUBTABLE) {
        const offset = (entry & ~SUBTABLE) >> 4, sub = entry & 15;
        entry = code.table[offset + (bits >> ROOT_BITS & (1 << sub) - 1)];
    }
    reader.skip(entry & 15);
    return entry >> 4;
}
function readCode(reader, alphabetSize) {
    const lengths = new Uint8Array(alphabetSize);
    if (reader.read(1)) {
        const count = reader.read(1) + 1;
        const first = reader.read(reader.read(1) ? 8 : 1);
        if (first >= alphabetSize)
            throw new Error('VP8L: invalid simple prefix code');
        if (count === 1)
            return { table: new Int32Array(0), single: first };
        const second = reader.read(8);
        if (second >= alphabetSize)
            throw new Error('VP8L: invalid simple prefix code');
        lengths[first] = 1;
        lengths[second] = 1;
        if (first === second)
            return { table: new Int32Array(0), single: first };
        return buildCode(lengths, alphabetSize);
    }
    const codeLengthLengths = new Uint8Array(19);
    const count = reader.read(4) + 4;
    if (count > 19)
        throw new Error('VP8L: invalid code length code');
    for (let i = 0; i < count; i++)
        codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.read(3);
    const lengthCode = buildCode(codeLengthLengths, 19);
    let maxSymbol = alphabetSize;
    if (reader.read(1)) {
        const bits = 2 + 2 * reader.read(3);
        maxSymbol = 2 + reader.read(bits);
        if (maxSymbol > alphabetSize)
            throw new Error('VP8L: invalid max symbol');
    }
    let previous = 8;
    for (let symbol = 0; symbol < alphabetSize;) {
        if (maxSymbol-- === 0)
            break;
        const length = readSymbol(reader, lengthCode);
        if (length < 16) {
            lengths[symbol++] = length;
            if (length)
                previous = length;
            continue;
        }
        const repeat = length === 16 ? 3 + reader.read(2) : length === 17 ? 3 + reader.read(3) : 11 + reader.read(7);
        const value = length === 16 ? previous : 0;
        if (symbol + repeat > alphabetSize)
            throw new Error('VP8L: invalid code lengths');
        lengths.fill(value, symbol, symbol + repeat);
        symbol += repeat;
    }
    return buildCode(lengths, alphabetSize);
}
const subSize = (size, bits) => (size + (1 << bits) - 1) >> bits;
function prefixValue(reader, symbol) {
    if (symbol < 4)
        return symbol + 1;
    const extra = (symbol - 2) >> 1;
    const offset = (2 + (symbol & 1)) << extra;
    return offset + reader.read(extra) + 1;
}
function decodeImage(reader, width, height, isMain) {
    let cacheBits = 0;
    if (reader.read(1)) {
        cacheBits = reader.read(4);
        if (cacheBits < 1 || cacheBits > 11)
            throw new Error('VP8L: invalid color cache size');
    }
    let prefixBits = 0, prefixWidth = 1, groupImage = null, groupCount = 1;
    if (isMain && reader.read(1)) {
        prefixBits = reader.read(3) + 2;
        prefixWidth = subSize(width, prefixBits);
        groupImage = decodeImage(reader, prefixWidth, subSize(height, prefixBits), false);
        for (let i = 0; i < groupImage.length; i++) {
            const group = groupImage[i] >> 8 & 0xffff;
            groupImage[i] = group;
            if (group >= groupCount)
                groupCount = group + 1;
        }
    }
    const cacheSize = cacheBits ? 1 << cacheBits : 0;
    const greenSize = NUM_LITERAL_CODES + NUM_LENGTH_CODES + cacheSize;
    const groups = [];
    for (let g = 0; g < groupCount; g++)
        groups.push([
            readCode(reader, greenSize),
            readCode(reader, NUM_LITERAL_CODES),
            readCode(reader, NUM_LITERAL_CODES),
            readCode(reader, NUM_LITERAL_CODES),
            readCode(reader, NUM_DISTANCE_CODES)
        ]);
    const total = width * height;
    const pixels = new Uint32Array(total);
    const cache = cacheSize ? new Uint32Array(cacheSize) : null;
    const cacheShift = 32 - cacheBits;
    let cached = 0;
    const prefixMask = (1 << prefixBits) - 1;
    let group = groups[0];
    for (let i = 0, x = 0, y = 0; i < total;) {
        if (groupImage && (x & prefixMask) === 0)
            group = groups[groupImage[(y >> prefixBits) * prefixWidth + (x >> prefixBits)]];
        const green = readSymbol(reader, group[0]);
        if (green < NUM_LITERAL_CODES) {
            const red = readSymbol(reader, group[1]);
            const blue = readSymbol(reader, group[2]);
            const alpha = readSymbol(reader, group[3]);
            pixels[i++] = (alpha << 24 | red << 16 | green << 8 | blue) >>> 0;
            if (++x === width) {
                x = 0;
                y++;
            }
        }
        else if (green < NUM_LITERAL_CODES + NUM_LENGTH_CODES) {
            const length = prefixValue(reader, green - NUM_LITERAL_CODES);
            const distanceSymbol = readSymbol(reader, group[4]);
            let distance = prefixValue(reader, distanceSymbol);
            if (distance > 120)
                distance -= 120;
            else {
                const dx = DISTANCE_MAP[2 * distance - 2], dy = DISTANCE_MAP[2 * distance - 1];
                distance = Math.max(1, dy * width + dx);
            }
            if (distance > i || i + length > total)
                throw new Error('VP8L: invalid backward reference');
            for (let k = 0; k < length; k++, i++)
                pixels[i] = pixels[i - distance];
            x += length;
            while (x >= width) {
                x -= width;
                y++;
            }
            if (groupImage)
                group = groups[groupImage[(y >> prefixBits) * prefixWidth + (x >> prefixBits)]];
        }
        else {
            if (!cache)
                throw new Error('VP8L: invalid color cache symbol');
            for (; cached < i; cached++)
                cache[Math.imul(pixels[cached], 0x1e35a7bd) >>> cacheShift] = pixels[cached];
            pixels[i++] = cache[green - NUM_LITERAL_CODES - NUM_LENGTH_CODES];
            if (++x === width) {
                x = 0;
                y++;
            }
        }
        if (reader.overrun)
            throw new Error('VP8L: unexpected end of data');
    }
    return pixels;
}
const average2 = (a, b) => (((a ^ b) & 0xfefefefe) >>> 1) + (a & b) >>> 0;
const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
function clampAddSubtractFull(a, b, c) {
    return (clamp255((a & 255) + (b & 255) - (c & 255))
        | clamp255((a >>> 8 & 255) + (b >>> 8 & 255) - (c >>> 8 & 255)) << 8
        | clamp255((a >>> 16 & 255) + (b >>> 16 & 255) - (c >>> 16 & 255)) << 16
        | clamp255((a >>> 24) + (b >>> 24) - (c >>> 24)) << 24) >>> 0;
}
function clampAddSubtractHalf(a, b) {
    const a0 = a & 255, a1 = a >>> 8 & 255, a2 = a >>> 16 & 255, a3 = a >>> 24;
    return (clamp255(a0 + ((a0 - (b & 255)) / 2 | 0))
        | clamp255(a1 + ((a1 - (b >>> 8 & 255)) / 2 | 0)) << 8
        | clamp255(a2 + ((a2 - (b >>> 16 & 255)) / 2 | 0)) << 16
        | clamp255(a3 + ((a3 - (b >>> 24)) / 2 | 0)) << 24) >>> 0;
}
function select(l, t, tl) {
    const tl0 = tl & 255, tl1 = tl >>> 8 & 255, tl2 = tl >>> 16 & 255, tl3 = tl >>> 24;
    const pl = Math.abs((t & 255) - tl0) + Math.abs((t >>> 8 & 255) - tl1) + Math.abs((t >>> 16 & 255) - tl2) + Math.abs((t >>> 24) - tl3);
    const pt = Math.abs((l & 255) - tl0) + Math.abs((l >>> 8 & 255) - tl1) + Math.abs((l >>> 16 & 255) - tl2) + Math.abs((l >>> 24) - tl3);
    return pl < pt ? l : t;
}
const addPixels = (a, b) => ((a & 0xff00ff00) + (b & 0xff00ff00) & 0xff00ff00 | (a & 0x00ff00ff) + (b & 0x00ff00ff) & 0x00ff00ff) >>> 0;
function predictRun(mode, p, i, n, width, out, o) {
    const restore = out === p;
    const end = i + n;
    switch (mode) {
        case 1:
            for (; i < end; i++, o++)
                out[o] = restore ? addPixels(p[i], p[i - 1]) : p[i - 1];
            return;
        case 2:
            for (; i < end; i++, o++)
                out[o] = restore ? addPixels(p[i], p[i - width]) : p[i - width];
            return;
        case 3:
            for (; i < end; i++, o++)
                out[o] = restore ? addPixels(p[i], p[i - width + 1]) : p[i - width + 1];
            return;
        case 4:
            for (; i < end; i++, o++)
                out[o] = restore ? addPixels(p[i], p[i - width - 1]) : p[i - width - 1];
            return;
        case 5:
            for (; i < end; i++, o++) {
                const v = average2(average2(p[i - 1], p[i - width + 1]), p[i - width]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 6:
            for (; i < end; i++, o++) {
                const v = average2(p[i - 1], p[i - width - 1]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 7:
            for (; i < end; i++, o++) {
                const v = average2(p[i - 1], p[i - width]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 8:
            for (; i < end; i++, o++) {
                const v = average2(p[i - width - 1], p[i - width]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 9:
            for (; i < end; i++, o++) {
                const v = average2(p[i - width], p[i - width + 1]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 10:
            for (; i < end; i++, o++) {
                const v = average2(average2(p[i - 1], p[i - width - 1]), average2(p[i - width], p[i - width + 1]));
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 11:
            for (; i < end; i++, o++) {
                const v = select(p[i - 1], p[i - width], p[i - width - 1]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 12:
            for (; i < end; i++, o++) {
                const v = clampAddSubtractFull(p[i - 1], p[i - width], p[i - width - 1]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        case 13:
            for (; i < end; i++, o++) {
                const v = clampAddSubtractHalf(average2(p[i - 1], p[i - width]), p[i - width - 1]);
                out[o] = restore ? addPixels(p[i], v) : v;
            }
            return;
        default: for (; i < end; i++, o++)
            out[o] = restore ? addPixels(p[i], 0xff000000) : 0xff000000;
    }
}
function inversePredictor(p, width, height, bits, modes) {
    const blocksPerRow = subSize(width, bits);
    p[0] = addPixels(p[0], 0xff000000);
    for (let x = 1; x < width; x++)
        p[x] = addPixels(p[x], p[x - 1]);
    for (let y = 1; y < height; y++) {
        const row = y * width;
        p[row] = addPixels(p[row], p[row - width]);
        const modeRow = (y >> bits) * blocksPerRow;
        for (let x = 1; x < width;) {
            const end = Math.min(width, (x >> bits) + 1 << bits);
            predictRun(modes[modeRow + (x >> bits)] >> 8 & 15, p, row + x, end - x, width, p, row + x);
            x = end;
        }
    }
}
const colorDelta = (t, c) => ((t << 24 >> 24) * (c << 24 >> 24)) >> 5;
function inverseColorTransform(p, width, height, bits, elements) {
    const blocksPerRow = subSize(width, bits);
    for (let y = 0; y < height; y++) {
        const elementRow = (y >> bits) * blocksPerRow;
        for (let x = 0; x < width; x++) {
            const e = elements[elementRow + (x >> bits)];
            const greenToRed = e & 255, greenToBlue = e >> 8 & 255, redToBlue = e >> 16 & 255;
            const i = y * width + x, argb = p[i];
            const green = argb >> 8 & 255;
            const red = (argb >> 16) + colorDelta(greenToRed, green) & 255;
            const blue = (argb & 255) + colorDelta(greenToBlue, green) + colorDelta(redToBlue, red) & 255;
            p[i] = (argb & 0xff00ff00 | red << 16 | blue) >>> 0;
        }
    }
}
function addGreen(p) {
    for (let i = 0; i < p.length; i++) {
        const argb = p[i], green = argb >> 8 & 255;
        const redBlue = (argb & 0x00ff00ff) + (green << 16 | green) & 0x00ff00ff;
        p[i] = (argb & 0xff00ff00 | redBlue) >>> 0;
    }
}
function inverseColorIndexing(packed, packedWidth, width, height, bits, palette) {
    const out = new Uint32Array(width * height);
    const lookup = (index) => index < palette.length ? palette[index] : 0;
    if (bits === 0) {
        for (let i = 0; i < out.length; i++)
            out[i] = lookup(packed[i] >> 8 & 255);
        return out;
    }
    const perByte = 1 << bits, bitsPerIndex = 8 >> bits, mask = (1 << bitsPerIndex) - 1;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const green = packed[y * packedWidth + (x >> bits)] >> 8 & 255;
            out[y * width + x] = lookup(green >> (x & perByte - 1) * bitsPerIndex & mask);
        }
    return out;
}
export function readHeader(data) {
    if (data.length < 5 || data[0] !== SIGNATURE)
        throw new Error('VP8L: invalid signature');
    const reader = new BitReader(data, 1);
    const width = reader.read(14) + 1;
    const height = reader.read(14) + 1;
    const hasAlpha = reader.read(1) === 1;
    if (reader.read(3) !== 0)
        throw new Error('VP8L: unsupported version');
    return { width, height, hasAlpha };
}
export function decode(data, maxPixels = MAX_PIXELS) {
    const { width, height, hasAlpha } = readHeader(data);
    checkPixels(width, height, maxPixels);
    const reader = new BitReader(data, 5);
    return { width, height, hasAlpha, argb: decodeStream(reader, width, height) };
}
export function decodeStream(reader, width, height) {
    const transforms = [];
    let codedWidth = width;
    const seen = new Set();
    while (reader.read(1)) {
        const type = reader.read(2);
        if (seen.has(type))
            throw new Error('VP8L: transform used twice');
        seen.add(type);
        if (type === 0 || type === 1) {
            const bits = reader.read(3) + 2;
            const data = decodeImage(reader, subSize(codedWidth, bits), subSize(height, bits), false);
            transforms.push({ type, width: codedWidth, bits, data });
        }
        else if (type === 2) {
            transforms.push({ type, width: codedWidth, bits: 0, data: new Uint32Array(0) });
        }
        else {
            const size = reader.read(8) + 1;
            const palette = decodeImage(reader, size, 1, false);
            for (let i = 1; i < size; i++)
                palette[i] = addPixels(palette[i], palette[i - 1]);
            const bits = size <= 2 ? 3 : size <= 4 ? 2 : size <= 16 ? 1 : 0;
            transforms.push({ type, width: codedWidth, bits, data: palette });
            codedWidth = subSize(codedWidth, bits);
        }
    }
    let pixels = decodeImage(reader, codedWidth, height, true);
    for (let t = transforms.length - 1; t >= 0; t--) {
        const { type, width: w, bits, data } = transforms[t];
        if (type === 0)
            inversePredictor(pixels, w, height, bits, data);
        else if (type === 1)
            inverseColorTransform(pixels, w, height, bits, data);
        else if (type === 2)
            addGreen(pixels);
        else
            pixels = inverseColorIndexing(pixels, subSize(w, bits), w, height, bits, data);
    }
    return pixels;
}
class BitWriter extends ByteWriter {
    bits = 0;
    count = 0;
    constructor() {
        super(1 << 16);
    }
    write(value, size) {
        while (size > 0) {
            const take = Math.min(size, 24 - this.count);
            this.bits |= (value & (1 << take) - 1) << this.count;
            this.count += take;
            value >>>= take;
            size -= take;
            while (this.count >= 8) {
                this.byte(this.bits & 255);
                this.bits >>>= 8;
                this.count -= 8;
            }
        }
    }
    finish() {
        if (this.count > 0)
            this.write(0, 8 - this.count);
        return super.finish();
    }
}
function codeLengths(counts, maxLength) {
    const size = counts.length;
    const lengths = new Uint8Array(size);
    let freq = Array.from(counts);
    for (;;) {
        const used = [];
        for (let s = 0; s < size; s++)
            if (freq[s] > 0)
                used.push(s);
        if (used.length === 0)
            return lengths;
        if (used.length === 1) {
            lengths[used[0]] = 1;
            return lengths;
        }
        used.sort((a, b) => freq[a] - freq[b] || a - b);
        const n = used.length;
        const weight = new Float64Array(2 * n), parent = new Int32Array(2 * n);
        for (let i = 0; i < n; i++)
            weight[i] = freq[used[i]];
        let leaf = 0, node = n, next = n;
        const pick = () => {
            if (leaf < n && (node >= next || weight[leaf] <= weight[node]))
                return leaf++;
            return node++;
        };
        for (; next < 2 * n - 1; next++) {
            const a = pick(), b = pick();
            weight[next] = weight[a] + weight[b];
            parent[a] = parent[b] = next;
        }
        let longest = 0;
        const depth = new Int32Array(2 * n);
        for (let i = 2 * n - 3; i >= 0; i--)
            depth[i] = depth[parent[i]] + 1;
        for (let i = 0; i < n; i++) {
            lengths[used[i]] = depth[i];
            if (depth[i] > longest)
                longest = depth[i];
        }
        if (longest <= maxLength)
            return lengths;
        lengths.fill(0);
        freq = freq.map(f => f > 0 ? (f >> 1) + 1 : 0);
    }
}
function canonicalCodes(lengths) {
    const counts = new Int32Array(16), next = new Int32Array(16);
    for (const l of lengths)
        if (l)
            counts[l]++;
    let code = 0;
    for (let l = 1; l <= 15; l++) {
        code = code + counts[l - 1] << 1;
        next[l] = code;
    }
    const codes = new Uint16Array(lengths.length);
    for (let s = 0; s < lengths.length; s++) {
        const l = lengths[s];
        if (!l)
            continue;
        let c = next[l]++, r = 0;
        for (let i = 0; i < l; i++, c >>= 1)
            r = r << 1 | c & 1;
        codes[s] = r;
    }
    return codes;
}
function buildEncodeCode(counts, maxLength = 15) {
    const lengths = codeLengths(counts, maxLength);
    return { lengths, codes: canonicalCodes(lengths) };
}
const writeSymbol = (w, code, symbol) => {
    const l = code.lengths[symbol];
    if (l && code.codes.length)
        w.write(code.codes[symbol], l);
};
function writeCode(w, counts) {
    const used = [];
    for (let s = 0; s < counts.length; s++)
        if (counts[s] > 0)
            used.push(s);
    if (used.length <= 2 && used.every(s => s < 256)) {
        const symbols = used.length ? used : [0];
        w.write(1, 1);
        w.write(symbols.length - 1, 1);
        if (symbols[0] <= 1) {
            w.write(0, 1);
            w.write(symbols[0], 1);
        }
        else {
            w.write(1, 1);
            w.write(symbols[0], 8);
        }
        if (symbols.length === 2)
            w.write(symbols[1], 8);
        const lengths = new Uint8Array(counts.length);
        if (symbols.length === 1)
            return { lengths, codes: new Uint16Array(0) };
        lengths[symbols[0]] = lengths[symbols[1]] = 1;
        return { lengths, codes: canonicalCodes(lengths) };
    }
    const code = buildEncodeCode(counts);
    const tokens = [], extras = [];
    const lengths = code.lengths;
    let previous = 8;
    for (let i = 0; i < lengths.length;) {
        const l = lengths[i];
        let run = 1;
        while (i + run < lengths.length && lengths[i + run] === l)
            run++;
        if (l === 0) {
            let left = run;
            while (left > 0) {
                if (left < 3) {
                    tokens.push(0);
                    extras.push(0);
                    left--;
                }
                else if (left <= 10) {
                    tokens.push(17);
                    extras.push(left - 3);
                    left = 0;
                }
                else {
                    const n = Math.min(left, 138);
                    tokens.push(18);
                    extras.push(n - 11);
                    left -= n;
                }
            }
        }
        else {
            let left = run;
            if (l !== previous) {
                tokens.push(l);
                extras.push(0);
                left--;
                previous = l;
            }
            while (left > 0) {
                if (left < 3) {
                    tokens.push(l);
                    extras.push(0);
                    left--;
                }
                else {
                    const n = Math.min(left, 6);
                    tokens.push(16);
                    extras.push(n - 3);
                    left -= n;
                }
            }
        }
        i += run;
    }
    const lengthCounts = new Int32Array(19);
    for (const t of tokens)
        lengthCounts[t]++;
    const lengthCode = buildEncodeCode(lengthCounts, 7);
    let lengthCodeLengths = lengthCode.lengths;
    if (lengthCodeLengths.filter(l => l).length === 1) {
        lengthCodeLengths = lengthCodeLengths.slice();
        const only = lengthCodeLengths.findIndex(l => l !== 0);
        lengthCodeLengths[only] = 1;
        lengthCodeLengths[only === 0 ? 1 : 0] = 1;
    }
    const lengthCodes = canonicalCodes(lengthCodeLengths);
    let count = 19;
    while (count > 4 && lengthCodeLengths[CODE_LENGTH_ORDER[count - 1]] === 0)
        count--;
    w.write(0, 1);
    w.write(count - 4, 4);
    for (let i = 0; i < count; i++)
        w.write(lengthCodeLengths[CODE_LENGTH_ORDER[i]], 3);
    w.write(0, 1);
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        w.write(lengthCodes[t], lengthCodeLengths[t]);
        if (t === 16)
            w.write(extras[i], 2);
        else if (t === 17)
            w.write(extras[i], 3);
        else if (t === 18)
            w.write(extras[i], 7);
    }
    return used.length === 1 ? { lengths: code.lengths, codes: new Uint16Array(0) } : code;
}
function prefixEncode(value) {
    const d = value - 1;
    if (d < 4)
        return { symbol: d, bits: 0, extra: 0 };
    const h = 31 - Math.clz32(d);
    const second = d >> h - 1 & 1;
    return { symbol: 2 * h + second, bits: h - 1, extra: d & (1 << h - 1) - 1 };
}
const ALL_MODES = Array.from({ length: 14 }, (_, i) => i);
export const TUNING = [
    { chain: 4, predictedChain: 0, lazy: false, cacheSearch: false, groups: false, colorTransform: false, analyze: true, modes: [1, 2, 11], tryPredicted: false },
    { chain: 8, nearOnly: true, lazy: true, cacheSearch: true, groups: true, colorTransform: false, analyze: true, modes: ALL_MODES, tryPredicted: false },
    { chain: 24, nearOnly: true, lazy: true, cacheSearch: true, groups: true, colorTransform: true, analyze: true, modes: ALL_MODES, tryPredicted: true },
];
function tokenize(pixels, width, tuning = TUNING[2]) {
    const n = pixels.length;
    const ops = new Uint8Array(n), values = new Uint32Array(n), distances = new Uint32Array(n);
    let count = 0;
    const shortCodes = new Map();
    for (let c = 119; c >= 0; c--) {
        const d = DISTANCE_MAP[2 * c + 1] * width + DISTANCE_MAP[2 * c];
        if (d >= 1)
            shortCodes.set(d, c + 1);
    }
    const distanceCode = (d) => shortCodes.get(d) ?? d + 120;
    const HASH_BITS = 15, CHAIN = tuning.chain, MAX_LENGTH = 4096, MIN_LENGTH = 3, WINDOW = (1 << 20) - 120;
    const head = new Int32Array(1 << HASH_BITS).fill(-1);
    const chain = new Int32Array(n);
    const hashes = new Int32Array(n);
    for (let i = 0; i + 1 < n; i++)
        hashes[i] = Math.imul(Math.imul(pixels[i], 0x1e35a7bd) ^ pixels[i + 1], 0x9e3779b1) >>> 32 - HASH_BITS;
    let inserted = 0;
    const insertUpTo = (end) => {
        for (; inserted < end && inserted + 1 < n; inserted++) {
            const h = hashes[inserted];
            chain[inserted] = head[h];
            head[h] = inserted;
        }
        if (inserted < end)
            inserted = end;
    };
    const matchLength = (i, j) => {
        const max = Math.min(MAX_LENGTH, n - i);
        let l = 0;
        while (l < max && pixels[i + l] === pixels[j + l])
            l++;
        return l;
    };
    let bestLength = 0, bestDistance = 0;
    const find = (i) => {
        bestLength = 0;
        bestDistance = 0;
        if (i >= 1) {
            const l = matchLength(i, i - 1);
            if (l > bestLength) {
                bestLength = l;
                bestDistance = 1;
            }
        }
        if (width <= i) {
            const l = matchLength(i, i - width);
            if (l > bestLength) {
                bestLength = l;
                bestDistance = width;
            }
        }
        if (i + 1 < n && bestLength < MAX_LENGTH) {
            for (let j = head[hashes[i]], k = 0; j >= 0 && k < CHAIN && i - j <= WINDOW; j = chain[j], k++) {
                if (i - j >= bestDistance && (i + bestLength >= n || pixels[j + bestLength] !== pixels[i + bestLength]))
                    continue;
                const l = matchLength(i, j);
                if (l > bestLength || l === bestLength && l > 0 && i - j < bestDistance) {
                    bestLength = l;
                    bestDistance = i - j;
                }
                if (l === MAX_LENGTH)
                    break;
            }
        }
    };
    for (let i = 0; i < n;) {
        insertUpTo(i);
        find(i);
        if (tuning.lazy && bestLength >= MIN_LENGTH && bestLength < MAX_LENGTH && i + 1 < n) {
            const length = bestLength, distance = bestDistance;
            insertUpTo(i + 1);
            find(i + 1);
            if (bestLength > length + 1) {
                ops[count] = 0;
                values[count++] = pixels[i++];
                continue;
            }
            bestLength = length;
            bestDistance = distance;
        }
        if (bestLength >= MIN_LENGTH) {
            ops[count] = 1;
            values[count] = bestLength;
            distances[count++] = distanceCode(bestDistance);
            i += bestLength;
            continue;
        }
        ops[count] = 0;
        values[count++] = pixels[i++];
    }
    return { ops, values, distances, count };
}
function withCache(stream, pixels, bits) {
    if (!bits)
        return stream;
    const { ops, values, distances, count } = stream;
    const out = { ops: ops.slice(0, count), values: values.slice(0, count), distances, count };
    const cache = new Uint32Array(1 << bits), shift = 32 - bits;
    for (let k = 0, i = 0; k < count; k++) {
        if (ops[k] === 1) {
            for (const end = i + values[k]; i < end; i++)
                cache[Math.imul(pixels[i], 0x1e35a7bd) >>> shift] = pixels[i];
            continue;
        }
        const argb = pixels[i++], key = Math.imul(argb, 0x1e35a7bd) >>> shift;
        if (cache[key] === argb) {
            out.ops[k] = 2;
            out.values[k] = key;
        }
        cache[key] = argb;
    }
    return out;
}
function histograms(stream, cacheBits) {
    const greenSize = NUM_LITERAL_CODES + NUM_LENGTH_CODES + (cacheBits ? 1 << cacheBits : 0);
    const counts = [new Int32Array(greenSize), new Int32Array(256), new Int32Array(256), new Int32Array(256), new Int32Array(NUM_DISTANCE_CODES)];
    const { ops, values, distances, count } = stream;
    for (let k = 0; k < count; k++) {
        const v = values[k];
        if (ops[k] === 0) {
            counts[0][v >> 8 & 255]++;
            counts[1][v >> 16 & 255]++;
            counts[2][v & 255]++;
            counts[3][v >>> 24]++;
        }
        else if (ops[k] === 1) {
            counts[0][NUM_LITERAL_CODES + prefixEncode(v).symbol]++;
            counts[4][prefixEncode(distances[k]).symbol]++;
        }
        else
            counts[0][NUM_LITERAL_CODES + NUM_LENGTH_CODES + v]++;
    }
    return counts;
}
function bestCacheBits(stream, pixels) {
    const { ops, values, count } = stream;
    const caches = Array.from({ length: 11 }, (_, b) => new Uint32Array(1 << b));
    const literals = Array.from({ length: 11 }, () => [0, 1, 2, 3].map(() => new Float64Array(256)));
    const hits = Array.from({ length: 11 }, (_, b) => new Float64Array(1 << b));
    for (let k = 0, i = 0; k < count; k++) {
        if (ops[k] === 1) {
            for (const end = i + values[k]; i < end; i++) {
                const p = pixels[i], h = Math.imul(p, 0x1e35a7bd);
                for (let b = 1; b <= 10; b++)
                    caches[b][h >>> 32 - b] = p;
            }
            continue;
        }
        const p = pixels[i++], h = Math.imul(p, 0x1e35a7bd);
        const l0 = literals[0];
        l0[0][p >> 8 & 255]++;
        l0[1][p >> 16 & 255]++;
        l0[2][p & 255]++;
        l0[3][p >>> 24]++;
        for (let b = 1; b <= 10; b++) {
            const key = h >>> 32 - b, cache = caches[b];
            if (cache[key] === p)
                hits[b][key]++;
            else {
                const l = literals[b];
                l[0][p >> 8 & 255]++;
                l[1][p >> 16 & 255]++;
                l[2][p & 255]++;
                l[3][p >>> 24]++;
                cache[key] = p;
            }
        }
    }
    const bitsOf = (h, total) => {
        let bits = 0;
        for (let i = 0; i < h.length; i++)
            if (h[i])
                bits += 5 - h[i] * Math.log2(h[i] / total);
        return bits;
    };
    let best = 0, bestBits = Infinity;
    for (let b = 0; b <= 10; b++) {
        const l = literals[b];
        let n = 0;
        for (let i = 0; i < 256; i++)
            n += l[0][i];
        let hitCount = 0;
        for (let i = 0; i < hits[b].length; i++)
            hitCount += hits[b][i];
        const green = n + hitCount;
        let bits = bitsOf(l[1], n) + bitsOf(l[2], n) + bitsOf(l[3], n);
        for (let i = 0; i < 256; i++)
            if (l[0][i])
                bits += 5 - l[0][i] * Math.log2(l[0][i] / green);
        if (b)
            for (let i = 0; i < hits[b].length; i++)
                if (hits[b][i])
                    bits += 5 - hits[b][i] * Math.log2(hits[b][i] / green);
        if (bits < bestBits) {
            bestBits = bits;
            best = b;
        }
    }
    return best;
}
function streamBits(stream, pixels) {
    const cacheBits = 10;
    let bits = entropyBits(histograms(withCache(stream, pixels, cacheBits), cacheBits));
    const { ops, values, distances, count } = stream;
    for (let k = 0; k < count; k++)
        if (ops[k] === 1)
            bits += prefixEncode(values[k]).bits + prefixEncode(distances[k]).bits;
    return bits;
}
function entropyBits(counts) {
    let bits = 0;
    for (const c of counts) {
        let total = 0;
        for (let i = 0; i < c.length; i++)
            total += c[i];
        for (let i = 0; i < c.length; i++)
            if (c[i])
                bits += 5 - c[i] * Math.log2(c[i] / total);
    }
    return bits;
}
function tokenSymbols(stream, k, out) {
    const v = stream.values[k], op = stream.ops[k];
    out[1] = out[2] = out[3] = out[4] = -1;
    if (op === 0) {
        out[0] = v >> 8 & 255;
        out[1] = v >> 16 & 255;
        out[2] = v & 255;
        out[3] = v >>> 24;
    }
    else if (op === 1) {
        out[0] = NUM_LITERAL_CODES + prefixEncode(v).symbol;
        out[4] = prefixEncode(stream.distances[k]).symbol;
    }
    else
        out[0] = NUM_LITERAL_CODES + NUM_LENGTH_CODES + v;
}
async function prefixGroups(stream, width, height, cacheBits, bits, threads) {
    const bw = subSize(width, bits), bh = subSize(height, bits), nb = bw * bh;
    const greenSize = NUM_LITERAL_CODES + NUM_LENGTH_CODES + (cacheBits ? 1 << cacheBits : 0);
    const sizes = [greenSize, 256, 256, 256, NUM_DISTANCE_CODES], offsets = [0, greenSize, greenSize + 256, greenSize + 512, greenSize + 768];
    const total = greenSize + 768 + NUM_DISTANCE_CODES;
    const syms = new Int32Array(5), keys = [];
    for (let k = 0, i = 0; k < stream.count; k++) {
        const x = i % width, y = (i / width) | 0, blk = (y >> bits) * bw + (x >> bits);
        tokenSymbols(stream, k, syms);
        for (let c = 0; c < 5; c++)
            if (syms[c] >= 0)
                keys.push(blk * total + offsets[c] + syms[c]);
        i += stream.ops[k] === 1 ? stream.values[k] : 1;
    }
    const sorted = Int32Array.from(keys).sort();
    const starts = new Int32Array(nb + 1), sparse = [];
    let blk = 0;
    for (let e = 0; e < sorted.length;) {
        const key = sorted[e], b = Math.floor(key / total);
        while (blk < b)
            starts[++blk] = sparse.length;
        let n = 0;
        while (e < sorted.length && sorted[e] === key) {
            n++;
            e++;
        }
        sparse.push(key - b * total, n);
    }
    while (blk < nb)
        starts[++blk] = sparse.length;
    const array = (Type, bytes, length) => new Type(threads ? new SharedArrayBuffer(bytes * length) : new ArrayBuffer(bytes * length));
    const entries = array(Float64Array, 8, sparse.length);
    entries.set(sparse);
    const sharedStarts = threads ? shared(starts) : starts;
    const logs = (cl) => {
        const t = totals(cl), out = new Float64Array(total);
        for (let c = 0; c < 5; c++) {
            const o = offsets[c], d = t[c] + 0.5 * sizes[c];
            for (let s = 0; s < sizes[c]; s++)
                out[o + s] = -Math.log2((cl[o + s] + 0.5) / d);
        }
        return out;
    };
    const totals = (cl) => Float64Array.from(offsets, (o, c) => {
        let t = 0;
        for (let s = 0; s < sizes[c]; s++)
            t += cl[o + s];
        return t;
    });
    const clusterBits = (cl) => {
        let b = 0;
        const t = totals(cl);
        for (let c = 0; c < 5; c++) {
            for (let s = 0; s < sizes[c]; s++) {
                const n = cl[offsets[c] + s];
                if (n)
                    b += 5 - n * Math.log2(n / t[c]);
            }
        }
        return b;
    };
    const used = Int32Array.from(Array.from({ length: nb }, (_, i) => i).filter(i => starts[i + 1] > starts[i]));
    const sharedUsed = threads ? shared(used) : used;
    const costs = array(Float64Array, 8, used.length), nearest = array(Int32Array, 4, used.length);
    const blockCosts = async (logs) => {
        const task = { task: 'vp8l-costs', entries, starts: sharedStarts, used: sharedUsed, logs, costs, nearest };
        await runChunks(threads, task, Math.ceil(used.length / COST_BLOCKS), costChunks(task));
    };
    const single = new Float64Array(total);
    for (const blk of used)
        for (let e = starts[blk]; e < starts[blk + 1]; e += 2)
            single[entries[e]] += entries[e + 1];
    let bestBits = clusterBits(single), best = null;
    const assign = new Int32Array(nb);
    for (const k of [4, 8, 16]) {
        if (k > used.length)
            break;
        const blockHistogram = (blk) => {
            const h = new Float64Array(total);
            for (let e = starts[blk]; e < starts[blk + 1]; e += 2)
                h[entries[e]] = entries[e + 1];
            return h;
        };
        const centers = [blockHistogram(used[0])];
        const dist = new Float64Array(nb).fill(Infinity);
        while (centers.length < k) {
            await blockCosts([logs(centers[centers.length - 1])]);
            let far = -1;
            for (let u = 0; u < used.length; u++) {
                const blk = used[u];
                dist[blk] = Math.min(dist[blk], costs[u]);
                if (far < 0 || dist[blk] > dist[far])
                    far = blk;
            }
            centers.push(blockHistogram(far));
        }
        let clusters = centers;
        for (let iter = 0; iter < 3; iter++) {
            await blockCosts(clusters.map(logs));
            for (let u = 0; u < used.length; u++)
                assign[used[u]] = nearest[u];
            clusters = clusters.map(() => new Float64Array(total));
            for (const blk of used) {
                const cl = clusters[assign[blk]];
                for (let e = starts[blk]; e < starts[blk + 1]; e += 2)
                    cl[entries[e]] += entries[e + 1];
            }
        }
        const remap = new Int32Array(k).fill(-1), kept = [];
        for (const blk of used)
            if (remap[assign[blk]] < 0) {
                remap[assign[blk]] = kept.length;
                kept.push(clusters[assign[blk]]);
            }
        const groups = new Int32Array(nb);
        for (const blk of used)
            groups[blk] = remap[assign[blk]];
        const b = kept.reduce((sum, cl) => sum + clusterBits(cl), 0) + nb;
        if (b < bestBits) {
            bestBits = b;
            best = [groups, kept];
        }
        else
            break;
    }
    if (!best)
        return null;
    const [groups, kept] = best;
    return [groups, kept.map(cl => sizes.map((size, c) => Int32Array.from(cl.subarray(offsets[c], offsets[c] + size)))), bestBits];
}
const COST_BLOCKS = 1024;
export function costChunks({ entries, starts, used, logs, costs, nearest }) {
    const cost = (blk, log) => {
        let bitsSum = 0;
        for (let e = starts[blk]; e < starts[blk + 1]; e += 2)
            bitsSum += entries[e + 1] * log[entries[e]];
        return bitsSum;
    };
    return chunk => {
        for (let u = chunk * COST_BLOCKS; u < Math.min(used.length, (chunk + 1) * COST_BLOCKS); u++) {
            const blk = used[u];
            if (logs.length === 1) {
                costs[u] = cost(blk, logs[0]);
                continue;
            }
            let bc = 0, bv = Infinity;
            for (let j = 0; j < logs.length; j++) {
                const v = cost(blk, logs[j]);
                if (v < bv) {
                    bv = v;
                    bc = j;
                }
            }
            nearest[u] = bc;
        }
    };
}
async function writeImage(w, pixels, width, isMain, threads = null, tuning = TUNING[2]) {
    let chain = tuning.chain, tokens = null;
    if (isMain && tuning.nearOnly && chain) {
        const near = { ...tuning, chain: 0 };
        if (pixels.length <= 1 << 20) {
            const a = tokenize(pixels, width, near), b = tokenize(pixels, width, tuning);
            tokens = streamBits(a, pixels) < streamBits(b, pixels) ? a : b;
        }
        else {
            const height = pixels.length / width, rows = Math.max(8, Math.floor(height / 24));
            let nearBits = 0, farBits = 0;
            for (let k = 0; k < 3; k++) {
                const top = Math.max(0, Math.min(height - rows, Math.floor((k + 0.5) * height / 3 - rows / 2)));
                const band = pixels.subarray(top * width, (top + rows) * width);
                nearBits += streamBits(tokenize(band, width, near), band);
                farBits += streamBits(tokenize(band, width, tuning), band);
            }
            if (nearBits < farBits)
                chain = 0;
        }
    }
    tokens ??= tokenize(pixels, width, chain === tuning.chain ? tuning : { ...tuning, chain });
    const cacheBits = !isMain ? 0 : tuning.cacheSearch ? bestCacheBits(tokens, pixels) : pixels.length > 4096 ? 10 : 0;
    const stream = withCache(tokens, pixels, cacheBits), counts = histograms(stream, cacheBits);
    const best = entropyBits(counts);
    const height = pixels.length / width;
    let groups = null, groupCounts = [counts], prefixBits = 0;
    if (isMain && tuning.groups && pixels.length > 4096) {
        const r = await prefixGroups(stream, width, height, cacheBits, 4, threads);
        if (r && r[2] < best) {
            [groups, groupCounts] = r;
            prefixBits = 4;
        }
    }
    if (cacheBits) {
        w.write(1, 1);
        w.write(cacheBits, 4);
    }
    else
        w.write(0, 1);
    if (isMain) {
        w.write(groups ? 1 : 0, 1);
        if (groups) {
            w.write(prefixBits - 2, 3);
            await writeImage(w, Uint32Array.from(groups, g => g << 8), subSize(width, prefixBits), false, null, tuning);
        }
    }
    const { ops, values, distances, count } = stream;
    const codes = groupCounts.map(g => g.map(c => writeCode(w, c)));
    const bw = subSize(width, prefixBits);
    let group = codes[0];
    for (let k = 0, i = 0; k < count; k++) {
        if (groups) {
            const x = i % width, y = (i / width) | 0;
            group = codes[groups[(y >> prefixBits) * bw + (x >> prefixBits)]];
        }
        const v = values[k];
        if (ops[k] === 0) {
            writeSymbol(w, group[0], v >> 8 & 255);
            writeSymbol(w, group[1], v >> 16 & 255);
            writeSymbol(w, group[2], v & 255);
            writeSymbol(w, group[3], v >>> 24);
            i++;
        }
        else if (ops[k] === 1) {
            const length = prefixEncode(v), distance = prefixEncode(distances[k]);
            writeSymbol(w, group[0], NUM_LITERAL_CODES + length.symbol);
            w.write(length.extra, length.bits);
            writeSymbol(w, group[4], distance.symbol);
            w.write(distance.extra, distance.bits);
            i += v;
        }
        else {
            writeSymbol(w, group[0], NUM_LITERAL_CODES + NUM_LENGTH_CODES + v);
            i++;
        }
    }
}
const subPixels = (a, b) => ((a | 0x00ff00ff) - (b & 0xff00ff00) & 0xff00ff00 | (a | 0xff00ff00) - (b & 0x00ff00ff) & 0x00ff00ff) >>> 0;
const BYTE_COST = Uint8Array.from({ length: 256 }, (_, c) => c < 128 ? c : 256 - c);
const residualCost = (r) => BYTE_COST[r & 255] + BYTE_COST[r >>> 8 & 255] + BYTE_COST[r >>> 16 & 255] + BYTE_COST[r >>> 24];
function redBlueBits(p) {
    const red = new Uint32Array(256), blue = new Uint32Array(256);
    for (let i = 0; i < p.length; i++) {
        red[p[i] >> 16 & 255]++;
        blue[p[i] & 255]++;
    }
    let bits = 0;
    for (const h of [red, blue])
        for (const n of h)
            if (n)
                bits += n * Math.log2(p.length / n);
    return bits;
}
const slog = (v) => v ? v * Math.log2(v) : 0;
let SLOG;
function crossColorCost(accumulated, accumulatedSlogs, accumulatedLogs, counts, touched, n, accumulatedSum, accumulatedSlog) {
    const table = SLOG;
    let sum = accumulatedSlog, sumX = 0;
    for (let k = 0; k < n; k++) {
        const i = touched[k], x = counts[i], y = accumulated[i];
        sumX += x;
        if (x + y < table.length)
            sum += table[x] + table[x + y] - accumulatedSlogs[i];
        else {
            const t = x / y;
            sum += table[x] + x * accumulatedLogs[i] + (x + y) * (t - t * t / 2 + t * t * t / 3) * Math.LOG2E;
        }
    }
    let bias = 3 * counts[0], weight = 240;
    for (let i = 1; i < 16; i++) {
        bias += weight * (counts[i] + counts[256 - i]) / 100;
        weight *= 0.6;
    }
    return slog(sumX) + slog(sumX + accumulatedSum) - sum - bias / 10;
}
function colorTransform(p, width, height, bits) {
    const size = 1 << bits, blocksX = subSize(width, bits), blocksY = subSize(height, bits);
    const image = new Uint32Array(blocksX * blocksY);
    const accumulatedRed = new Uint32Array(256), accumulatedBlue = new Uint32Array(256), histo = new Uint32Array(256), touched = new Int32Array(256);
    const green = new Int32Array(size * size), red = new Int32Array(size * size), redByte = new Int32Array(size * size), blue = new Int32Array(size * size);
    const s8 = (v) => v << 24 >> 24;
    SLOG ??= Float64Array.from({ length: 65536 }, (_, v) => slog(v));
    const redSlogs = new Float64Array(256), blueSlogs = new Float64Array(256), redLogs = new Float64Array(256), blueLogs = new Float64Array(256);
    const sums = (h, slogs, logs) => {
        let total = 0, entropy = 0;
        for (let i = 0; i < 256; i++) {
            total += h[i];
            entropy += slogs[i] = slog(h[i]);
            logs[i] = h[i] ? Math.log2(h[i]) : 0;
        }
        return [total, entropy];
    };
    let prevX = [0, 0, 0], prevY = [0, 0, 0];
    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            const x0 = bx * size, y0 = by * size, x1 = Math.min(width, x0 + size), y1 = Math.min(height, y0 + size);
            if (by) {
                const above = image[(by - 1) * blocksX + bx];
                prevY = [above & 255, above >> 8 & 255, above >> 16 & 255];
            }
            let count = 0;
            for (let y = y0; y < y1; y++)
                for (let i = y * width + x0 + (y & 3), end = y * width + x1; i < end; i += 4, count++) {
                    const v = p[i];
                    green[count] = s8(v >> 8);
                    red[count] = s8(v >> 16);
                    redByte[count] = v >> 16 & 255;
                    blue[count] = v & 255;
                }
            const [redSum, redSlog] = sums(accumulatedRed, redSlogs, redLogs);
            const redCost = (gtr) => {
                const m = s8(gtr);
                let n = 0;
                for (let k = 0; k < count; k++) {
                    const v = redByte[k] - (m * green[k] >> 5) & 255;
                    if (!histo[v]++)
                        touched[n++] = v;
                }
                let cost = crossColorCost(accumulatedRed, redSlogs, redLogs, histo, touched, n, redSum, redSlog);
                for (let k = 0; k < n; k++)
                    histo[touched[k]] = 0;
                if ((gtr & 255) === prevX[0])
                    cost -= 3;
                if ((gtr & 255) === prevY[0])
                    cost -= 3;
                if (gtr === 0)
                    cost -= 3;
                return cost;
            };
            let gtr = 0, best = redCost(0);
            for (let iter = 0; iter < 6; iter++) {
                const step = 32 >> iter;
                for (const offset of [-step, step]) {
                    const cost = redCost(gtr + offset);
                    if (cost < best)
                        [best, gtr] = [cost, gtr + offset];
                }
            }
            const [blueSum, blueSlog] = sums(accumulatedBlue, blueSlogs, blueLogs);
            const blueCost = (gtb, rtb) => {
                const mg = s8(gtb), mr = s8(rtb);
                let n = 0;
                for (let k = 0; k < count; k++) {
                    const v = blue[k] - (mg * green[k] >> 5) - (mr * red[k] >> 5) & 255;
                    if (!histo[v]++)
                        touched[n++] = v;
                }
                let cost = crossColorCost(accumulatedBlue, blueSlogs, blueLogs, histo, touched, n, blueSum, blueSlog);
                for (let k = 0; k < n; k++)
                    histo[touched[k]] = 0;
                if ((gtb & 255) === prevX[1])
                    cost -= 3;
                if ((gtb & 255) === prevY[1])
                    cost -= 3;
                if ((rtb & 255) === prevX[2])
                    cost -= 3;
                if ((rtb & 255) === prevY[2])
                    cost -= 3;
                if (gtb === 0)
                    cost -= 3;
                if (rtb === 0)
                    cost -= 3;
                return cost;
            };
            let gtb = 0, rtb = 0;
            best = blueCost(0, 0);
            for (const step of [16, 8, 4]) {
                for (const [dg, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
                    const cost = blueCost(gtb + dg * step, rtb + dr * step);
                    if (cost < best)
                        [best, gtb, rtb] = [cost, gtb + dg * step, rtb + dr * step];
                }
            }
            prevX = [gtr & 255, gtb & 255, rtb & 255];
            image[by * blocksX + bx] = (0xff000000 | prevX[2] << 16 | prevX[1] << 8 | prevX[0]) >>> 0;
            const mgr = s8(gtr), mgb = s8(gtb), mrb = s8(rtb);
            for (let y = y0; y < y1; y++)
                for (let i = y * width + x0, end = y * width + x1; i < end; i++) {
                    const v = p[i], g = s8(v >> 8), rs = s8(v >> 16);
                    const r = (v >> 16) - (mgr * g >> 5) & 255, b = v - (mgb * g >> 5) - (mrb * rs >> 5) & 255;
                    p[i] = (v & 0xff00ff00 | r << 16 | b) >>> 0;
                }
            for (let y = y0; y < y1; y++)
                for (let i = y * width + x0, end = y * width + x1; i < end; i++) {
                    const v = p[i];
                    if (i >= 2 && v === p[i - 2] && v === p[i - 1])
                        continue;
                    if (i >= width + 2 && p[i - 2] === p[i - width - 2] && p[i - 1] === p[i - width - 1] && v === p[i - width])
                        continue;
                    accumulatedRed[v >> 16 & 255]++;
                    accumulatedBlue[v & 255]++;
                }
        }
    }
    return image;
}
function analyze(argb, width, height, bits) {
    const h = Array.from({ length: 12 }, () => new Uint32Array(256));
    let prev = argb[0];
    for (let i = 0; i < argb.length; i++) {
        const p = argb[i], d = subPixels(p, prev);
        prev = p;
        if (d === 0 || (i >= width && p === argb[i - width]))
            continue;
        h[0][p >>> 24]++;
        h[1][p >> 16 & 255]++;
        h[2][p >> 8 & 255]++;
        h[3][p & 255]++;
        h[4][d >>> 24]++;
        h[5][d >> 16 & 255]++;
        h[6][d >> 8 & 255]++;
        h[7][d & 255]++;
        h[8][(p >> 16) - (p >> 8) & 255]++;
        h[9][p - (p >> 8) & 255]++;
        h[10][(d >> 16) - (d >> 8) & 255]++;
        h[11][d - (d >> 8) & 255]++;
    }
    for (const k of [4, 5, 6, 7, 10, 11])
        h[k][0]++;
    const bitsOf = (counts) => {
        let total = 0, sum = 0;
        for (const n of counts)
            total += n;
        for (const n of counts)
            if (n)
                sum += n * Math.log2(total / n);
        return sum;
    };
    const e = h.map(bitsOf), blocks = subSize(width, bits) * subSize(height, bits);
    const entropy = [
        e[0] + e[1] + e[2] + e[3], e[4] + e[5] + e[6] + e[7] + blocks * Math.log2(14),
        e[0] + e[8] + e[2] + e[9], e[4] + e[10] + e[6] + e[11] + blocks * Math.log2(24),
    ];
    const best = entropy.indexOf(Math.min(...entropy));
    return { predict: best === 1 || best === 3, subtractGreen: best >= 2 };
}
async function applyPredictor(p, width, height, bits, threads, candidates = ALL_MODES) {
    const blocksX = subSize(width, bits), blocksY = subSize(height, bits);
    const task = {
        task: 'vp8l-predictor', p, src: threads ? shared(p) : p.slice(), width, height, bits, candidates,
        modes: new Uint32Array(threads ? new SharedArrayBuffer(4 * blocksX * blocksY) : new ArrayBuffer(4 * blocksX * blocksY)),
    };
    await runChunks(threads, task, Math.ceil(blocksY / PREDICTOR_ROWS), predictorChunks(task));
    return task.modes;
}
const PREDICTOR_ROWS = 4;
export function predictorChunks({ p, src, modes, width, height, bits, candidates }) {
    const blocksX = subSize(width, bits), blocksY = subSize(height, bits), size = 1 << bits;
    const predicted = new Uint32Array(size);
    const predictRow = (mode, x0, x1, y) => {
        const row = y * width;
        if (y === 0) {
            for (let x = x0; x < x1; x++)
                predicted[x - x0] = x === 0 ? 0xff000000 : src[row + x - 1];
            return;
        }
        let x = x0;
        if (x === 0)
            predicted[x++] = src[row - width];
        predictRun(mode, src, row + x, x1 - x, width, predicted, x - x0);
    };
    return chunk => {
        for (let by = chunk * PREDICTOR_ROWS; by < Math.min(blocksY, (chunk + 1) * PREDICTOR_ROWS); by++)
            for (let bx = 0; bx < blocksX; bx++) {
                let best = candidates[0], bestCost = Infinity;
                const x0 = bx * size, y0 = by * size, x1 = Math.min(width, x0 + size), y1 = Math.min(height, y0 + size);
                for (const mode of candidates) {
                    let cost = 0;
                    for (let y = y0; y < y1 && cost < bestCost; y++) {
                        predictRow(mode, x0, x1, y);
                        for (let x = x0, i = y * width + x0; x < x1; x++, i++)
                            cost += residualCost(subPixels(src[i], predicted[x - x0]));
                    }
                    if (cost < bestCost) {
                        bestCost = cost;
                        best = mode;
                    }
                }
                modes[by * blocksX + bx] = (0xff000000 | best << 8) >>> 0;
                for (let y = y0; y < y1; y++) {
                    predictRow(best, x0, x1, y);
                    for (let x = x0, i = y * width + x0; x < x1; x++, i++)
                        p[i] = subPixels(src[i], predicted[x - x0]);
                }
            }
    };
}
export async function encode(argb, width, height, threads = null, effort = 2) {
    if (width < 1 || height < 1 || width > 16384 || height > 16384)
        throw new RangeError('VP8L: dimensions must be 1-16384');
    const tuning = TUNING[Math.min(2, effort)];
    const colors = new Map();
    for (let i = 0; i < argb.length && colors.size <= 256; i++)
        if (!colors.has(argb[i]))
            colors.set(argb[i], colors.size);
    if (colors.size > 256)
        return encodeWith(argb, width, height, null, threads, tuning);
    const indexed = await encodeWith(argb, width, height, colors, threads, tuning);
    if (colors.size <= 16 || !tuning.tryPredicted)
        return indexed;
    const predicted = await encodeWith(argb, width, height, null, threads, tuning);
    return predicted.length < indexed.length ? predicted : indexed;
}
async function encodeWith(argb, width, height, colors, threads, tuning) {
    const w = new BitWriter();
    let hasAlpha = false;
    for (let i = 0; i < argb.length; i++)
        if (argb[i] >>> 24 !== 255) {
            hasAlpha = true;
            break;
        }
    w.write(SIGNATURE, 8);
    w.write(width - 1, 14);
    w.write(height - 1, 14);
    w.write(hasAlpha ? 1 : 0, 1);
    w.write(0, 3);
    let pixels, codedWidth = width, predicted = false;
    if (colors) {
        const palette = Uint32Array.from([...colors.keys()].sort((a, b) => a - b));
        palette.forEach((c, i) => colors.set(c, i));
        const bits = palette.length <= 2 ? 3 : palette.length <= 4 ? 2 : palette.length <= 16 ? 1 : 0;
        w.write(1, 1);
        w.write(3, 2);
        w.write(palette.length - 1, 8);
        const deltas = palette.slice();
        for (let i = palette.length - 1; i > 0; i--)
            deltas[i] = subPixels(palette[i], palette[i - 1]);
        await writeImage(w, deltas, palette.length, false, null, tuning);
        codedWidth = subSize(width, bits);
        pixels = new Uint32Array(codedWidth * height);
        const perPixel = 8 >> bits;
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const o = y * codedWidth + (x >> bits);
                pixels[o] = (pixels[o] | 0xff000000 | colors.get(argb[y * width + x]) << 8 + (x & (1 << bits) - 1) * perPixel) >>> 0;
            }
    }
    else {
        pixels = threads ? shared(argb) : argb.slice();
        let redBlue = false;
        for (let i = 0; i < pixels.length && !redBlue; i++)
            if (pixels[i] & 0x00ff00ff)
                redBlue = true;
        const { predict, subtractGreen } = tuning.analyze ? analyze(argb, width, height, 4) : { predict: true, subtractGreen: true };
        if (redBlue && subtractGreen) {
            w.write(1, 1);
            w.write(2, 2);
            for (let i = 0; i < pixels.length; i++) {
                const p = pixels[i], green = p >> 8 & 255;
                pixels[i] = (p & 0xff00ff00 | (p | 0x0000ff00) - (green << 16 | green) & 0x00ff00ff) >>> 0;
            }
        }
        const bits = 4;
        if (predict) {
            predicted = true;
            w.write(1, 1);
            w.write(0, 2);
            w.write(bits - 2, 3);
            const modes = await applyPredictor(pixels, width, height, bits, threads, tuning.modes);
            await writeImage(w, modes, subSize(width, bits), false, null, tuning);
            if (redBlue && tuning.colorTransform) {
                const colorBits = 5, before = pixels.slice(), multipliers = colorTransform(pixels, width, height, colorBits);
                const changed = multipliers.reduce((n, m) => n + (m !== 0xff000000 ? 1 : 0), 0);
                if (changed && redBlueBits(pixels) + 12 * changed >= redBlueBits(before))
                    pixels.set(before);
                else if (changed) {
                    w.write(1, 1);
                    w.write(1, 2);
                    w.write(colorBits - 2, 3);
                    await writeImage(w, multipliers, subSize(width, colorBits), false, null, tuning);
                }
            }
        }
    }
    w.write(0, 1);
    const chain = predicted && tuning.predictedChain !== undefined ? tuning.predictedChain : tuning.chain;
    await writeImage(w, pixels, codedWidth, true, threads, { ...tuning, chain });
    return w.finish();
}
