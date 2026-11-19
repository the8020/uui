import { ByteWriter } from "../util/bytes.js";
import { quantize } from "./quantize.js";
import { MAX_PIXELS, PixelBudget, checkPixels } from "../util/limits.js";
const DISPOSAL_TO_GIF = [0, 1, 3, 2];
const DISPOSAL_FROM_GIF = [0, 1, 3, 2, 0, 0, 0, 0];
const MAX_CODE = 4095;
const UNEXPECTED_END = new Error('GIF: unexpected end of data');
export function encode({ width, height, loopCount = -1, frames }, quality = 95, comments = []) {
    const restores = frames.some(frame => frame.dispose === 3);
    const parts = [header(width, height, loopCount, comments)];
    for (const [i, frame] of frames.entries())
        parts.push(encodeFrame(frame, quality, frame.dispose === 3 || (i === 0 && restores)));
    parts.push(new Uint8Array([0x3b]));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}
export function header(width, height, loopCount, comments) {
    const out = new GIFWriter();
    out.bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    out.u16(width);
    out.u16(height);
    out.bytes(0x00, 0x00, 0x00);
    if (loopCount !== 0) {
        out.bytes(0x21, 0xff, 0x0b);
        out.string('NETSCAPE2.0');
        out.bytes(0x03, 0x01);
        out.u16(loopCount === -1 || loopCount === Infinity ? 0 : loopCount);
        out.bytes(0x00);
    }
    for (const comment of comments) {
        out.bytes(0x21, 0xfe);
        writeSubBlocks(out, comment);
    }
    return out.finish();
}
export function encodeFrame(frame, quality, transparent) {
    const out = new GIFWriter();
    const { palette, indices, transparentIndex } = quantize(frame.pixels, frame.width, { quality, transparent });
    const entries = palette.length / 3;
    const bits = Math.max(1, Math.ceil(Math.log2(entries)));
    out.bytes(0x21, 0xf9, 0x04);
    out.bytes(DISPOSAL_TO_GIF[frame.dispose] << 2 | (transparentIndex === -1 ? 0 : 1));
    out.u16(Math.min(0xffff, Math.max(0, Math.round(frame.delay))));
    out.bytes(transparentIndex === -1 ? 0 : transparentIndex, 0x00);
    out.bytes(0x2c);
    out.u16(frame.x);
    out.u16(frame.y);
    out.u16(frame.width);
    out.u16(frame.height);
    out.bytes(0x80 | bits - 1);
    const table = new Uint8Array(3 << bits);
    table.set(palette);
    out.array(table);
    const minCodeSize = Math.max(2, bits);
    out.bytes(minCodeSize);
    writeSubBlocks(out, lzwEncode(indices, minCodeSize));
    return out.finish();
}
function lzwEncode(indices, minCodeSize) {
    const out = new GIFWriter(indices.length);
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    const dictionary = new Int16Array(4096 * 256);
    let codeSize = 0, next = 0, buffer = 0, bufferBits = 0;
    const emit = (code) => {
        buffer |= code << bufferBits;
        bufferBits += codeSize;
        while (bufferBits >= 8) {
            out.byte(buffer & 0xff);
            buffer >>>= 8;
            bufferBits -= 8;
        }
    };
    const reset = () => {
        dictionary.fill(0);
        codeSize = minCodeSize + 1;
        next = eoi + 1;
    };
    reset();
    emit(clear);
    if (!indices.length) {
        emit(eoi);
        if (bufferBits)
            out.byte(buffer & 0xff);
        return out.finish();
    }
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const index = indices[i];
        const key = prefix << 8 | index;
        const code = dictionary[key];
        if (code) {
            prefix = code;
            continue;
        }
        emit(prefix);
        if (next <= MAX_CODE) {
            dictionary[key] = next;
            if (next === 1 << codeSize && codeSize < 12)
                codeSize++;
            next++;
        }
        else {
            emit(clear);
            reset();
        }
        prefix = index;
    }
    emit(prefix);
    emit(eoi);
    if (bufferBits)
        out.byte(buffer & 0xff);
    return out.finish();
}
function writeSubBlocks(out, data) {
    for (let i = 0; i < data.length; i += 255) {
        const block = data.subarray(i, i + 255);
        out.byte(block.length);
        out.array(block);
    }
    out.byte(0x00);
}
export function decode(data, onlyFirstFrame = false, maxPixels = MAX_PIXELS) {
    const reader = new ByteReader(data);
    const signature = reader.string(6);
    if (signature !== 'GIF87a' && signature !== 'GIF89a')
        throw new Error('GIF: invalid signature');
    const width = reader.u16();
    const height = reader.u16();
    const flags = reader.u8();
    reader.skip(2);
    const globalTable = flags & 0x80 ? reader.slice(3 << (flags & 7) + 1) : null;
    const frames = [];
    let loopCount = 0;
    let control = null;
    const budget = new PixelBudget(maxPixels);
    try {
        parse();
    }
    catch (err) {
        if (err !== UNEXPECTED_END)
            throw err;
    }
    checkPixels(width, height, maxPixels, Math.max(1, frames.length));
    return { width, height, loopCount, frames };
    function parse() {
        while (reader.offset < data.length) {
            const block = reader.u8();
            if (block === 0x3b)
                break;
            if (block === 0x21) {
                const label = reader.u8();
                if (label === 0xf9) {
                    const size = reader.u8();
                    const packed = reader.u8();
                    control = {
                        dispose: DISPOSAL_FROM_GIF[packed >> 2 & 7],
                        delay: reader.u16(),
                        transparentIndex: packed & 1 ? reader.u8() : (reader.skip(1), -1)
                    };
                    reader.skip(size - 4);
                    skipSubBlocks(reader);
                }
                else if (label === 0xff) {
                    const size = reader.u8();
                    const id = reader.string(size);
                    if (id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') {
                        for (let length; (length = reader.u8());) {
                            const sub = reader.slice(length);
                            if (sub[0] === 1 && length >= 3) {
                                const count = sub[1] | sub[2] << 8;
                                loopCount = count === 0 ? -1 : count;
                            }
                        }
                    }
                    else
                        skipSubBlocks(reader);
                }
                else
                    skipSubBlocks(reader);
                continue;
            }
            if (block !== 0x2c) {
                if (frames.length)
                    break;
                throw new Error(`GIF: unknown block type 0x${block.toString(16)}`);
            }
            const x = reader.u16();
            const y = reader.u16();
            const fw = reader.u16();
            const fh = reader.u16();
            const descriptor = reader.u8();
            const localTable = descriptor & 0x80 ? reader.slice(3 << (descriptor & 7) + 1) : null;
            const interlaced = !!(descriptor & 0x40);
            const table = localTable || globalTable;
            const minCodeSize = reader.u8();
            const compressed = readSubBlocks(reader);
            budget.take(fw, fh);
            const indices = lzwDecode(compressed, minCodeSize, fw * fh);
            const { dispose = 0, delay = 0, transparentIndex = -1 } = control || {};
            control = null;
            if (!fw || !fh)
                continue;
            const colors = new Uint32Array(256), bytes = new Uint8Array(colors.buffer);
            for (let index = 0; index < 256; index++) {
                if (table && index * 3 + 2 < table.length)
                    bytes.set(table.subarray(index * 3, index * 3 + 3), index * 4);
                bytes[index * 4 + 3] = 0xff;
            }
            let ordered = indices;
            if (interlaced) {
                const rows = interlacedRows(fh);
                ordered = new Uint8Array(indices.length);
                for (let row = 0; row < fh; row++)
                    ordered.set(indices.subarray(row * fw, (row + 1) * fw), rows[row] * fw);
            }
            frames.push({ x, y, width: fw, height: fh, delay, dispose, indices: ordered, colors, transparentIndex });
            if (onlyFirstFrame)
                break;
        }
    }
}
export function composite({ width, height, frames }) {
    const canvas = new Uint32Array(width * height);
    const output = [];
    for (const frame of frames) {
        const previous = frame.dispose === 2 ? canvas.slice() : null;
        const { indices, colors, transparentIndex } = frame;
        const x0 = Math.min(frame.x, width), x1 = Math.min(frame.x + frame.width, width);
        const y0 = Math.min(frame.y, height), y1 = Math.min(frame.y + frame.height, height);
        for (let y = y0; y < y1; y++) {
            const srcRow = (y - frame.y) * frame.width - frame.x;
            const dstRow = y * width;
            if (transparentIndex < 0)
                for (let x = x0; x < x1; x++)
                    canvas[dstRow + x] = colors[indices[srcRow + x]];
            else
                for (let x = x0; x < x1; x++) {
                    const index = indices[srcRow + x];
                    if (index !== transparentIndex)
                        canvas[dstRow + x] = colors[index];
                }
        }
        output.push({ pixels: new Uint8Array(canvas.slice().buffer), delay: frame.delay });
        if (frame.dispose === 3) {
            for (let y = y0; y < y1; y++)
                canvas.fill(0, y * width + x0, y * width + x1);
        }
        else if (previous)
            canvas.set(previous);
    }
    if (!output.length)
        output.push({ pixels: new Uint8Array(width * height * 4), delay: 0 });
    return output;
}
function interlacedRows(height) {
    const rows = [];
    for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]])
        for (let y = start; y < height; y += step)
            rows.push(y);
    return rows;
}
function lzwDecode(data, minCodeSize, pixelCount) {
    const output = new Uint8Array(pixelCount);
    if (minCodeSize < 1 || minCodeSize > 11)
        return output;
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    const positions = new Int32Array(4096);
    const lengths = new Uint16Array(4096).fill(1, 0, clear);
    let codeSize = minCodeSize + 1;
    let next = eoi + 1;
    let previous = -1, previousOut = 0;
    let buffer = 0, bufferBits = 0, position = 0, out = 0;
    while (out < pixelCount) {
        while (bufferBits < codeSize) {
            if (position >= data.length)
                return output;
            buffer |= data[position++] << bufferBits;
            bufferBits += 8;
        }
        const code = buffer & (1 << codeSize) - 1;
        buffer >>>= codeSize;
        bufferBits -= codeSize;
        if (code === clear) {
            codeSize = minCodeSize + 1;
            next = eoi + 1;
            previous = -1;
            continue;
        }
        if (code === eoi)
            break;
        if (code > next || (code === next && previous === -1))
            break;
        if (previous === -1 && code >= clear)
            break;
        const start = out;
        if (code < clear)
            output[out++] = code;
        else {
            const kwk = code === next;
            const from = kwk ? previousOut : positions[code];
            const length = kwk ? lengths[previous] + 1 : lengths[code];
            const count = Math.min(length, pixelCount - out) - (kwk ? 1 : 0);
            if (count < 16)
                for (let i = 0; i < count; i++)
                    output[out + i] = output[from + i];
            else
                output.copyWithin(out, from, from + count);
            if (kwk && out + count < pixelCount)
                output[out + count] = output[from];
            out = Math.min(out + length, pixelCount);
        }
        if (previous !== -1 && next <= MAX_CODE) {
            positions[next] = previousOut;
            lengths[next] = lengths[previous] + 1;
            next++;
            if (next === 1 << codeSize && codeSize < 12)
                codeSize++;
        }
        previous = code;
        previousOut = start;
    }
    return output;
}
function readSubBlocks(reader) {
    const blocks = [];
    let total = 0;
    for (let length; reader.offset < reader.data.length && (length = reader.u8());) {
        const block = reader.slice(length);
        blocks.push(block);
        total += block.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const block of blocks) {
        out.set(block, offset);
        offset += block.length;
    }
    return out;
}
function skipSubBlocks(reader) {
    for (let length; reader.offset < reader.data.length && (length = reader.u8());)
        reader.skip(length);
}
class ByteReader {
    data;
    offset;
    constructor(data) {
        this.data = data;
        this.offset = 0;
    }
    u8() {
        if (this.offset >= this.data.length)
            throw UNEXPECTED_END;
        return this.data[this.offset++];
    }
    u16() {
        return this.u8() | this.u8() << 8;
    }
    skip(length) {
        this.offset += length;
    }
    slice(length) {
        const slice = this.data.subarray(this.offset, this.offset + length);
        this.offset += length;
        return slice;
    }
    string(length) {
        return String.fromCharCode(...this.slice(length));
    }
}
class GIFWriter extends ByteWriter {
    u16(value) {
        this.bytes(value & 0xff, value >> 8 & 0xff);
    }
    string(value) {
        for (let i = 0; i < value.length; i++)
            this.byte(value.charCodeAt(i));
    }
}
