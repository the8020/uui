import { BitReader } from "./bits.js";
import { EXTRA_ALPHA } from "./headers.js";
import { frameHeader, toc, passShifts, FRAME_LF, FRAME_REGULAR, FRAME_SKIP_PROGRESSIVE, BLEND_REPLACE, BLEND_ADD, BLEND_BLEND, BLEND_MULADD, BLEND_MUL, FLAG_PATCHES, FLAG_SPLINES, FLAG_NOISE, FLAG_USE_LF_FRAME } from "./frame-header.js";
import { ModularImage, TR_RCT, channel, readTree, decodeModular, rctOrder, rctSamples } from "./modular.js";
import { upsample } from "./upsample.js";
import { gaborish, gaborishRows, epf, epfStrip, epfScratch, epfSteps, epfStrips } from "./filters.js";
import { VarDCT, readVarDCTGlobal } from "./vardct.js";
import { runChunks, shared, sharedOf } from "../../util/threads.js";
import { readPatches, applyPatches, readSplines, renderSplines, readNoise, renderNoise } from "./features.js";
import { byte, xybToBytes } from "./color.js";
import { littleEndian } from "../../util/alpha.js";
import { performBlending, PB_REPLACE, PB_ADD, PB_BLEND_ABOVE, PB_ADD_ABOVE, PB_MUL } from "./blend.js";
const NUM_QUANT_TABLES = 17;
class Sections {
    d;
    t;
    single = null;
    constructor(d, t) {
        this.d = d;
        this.t = t;
        if (t.offsets.length === 1)
            this.single = new BitReader(d, t.offsets[0], t.offsets[0] + t.sizes[0]);
    }
    get(i) {
        if (this.single)
            return this.single;
        const end = this.t.offsets[i] + this.t.sizes[i];
        if (end > this.d.length)
            throw new Error('JPEG XL: truncated data');
        return new BitReader(this.d, this.t.offsets[i], end);
    }
}
const MIN_THREADED_PIXELS = 1024 * 1024;
export async function decodeFrame(d, r, state, at, pool) {
    const image = state.image;
    const f = frameHeader(r, image);
    const t = toc(r, f);
    const sections = new Sections(d, t);
    if ((f.isLast || f.duration > 0) && (f.type === FRAME_REGULAR || f.type === FRAME_SKIP_PROGRESSIVE)) {
        state.visible++;
        state.invisible = 0;
    }
    else
        state.invisible++;
    const useLfFrame = (f.flags & FLAG_USE_LF_FRAME) !== 0;
    const lf = lfGlobal(sections.get(0), f, image);
    const vardct = lf.vardct ? new VarDCT(f, lf.vardct, lf.lfDequant, image.bitDepth.bits) : null;
    const lfGroupDim = f.groupDim * 8;
    for (let g = 0; g < f.numLfGroups; g++) {
        const gr = sections.get(1 + g);
        if (vardct && !useLfFrame)
            vardct.readLfCoefficients(gr, g, lf.tree);
        const x = (g % f.lfGroupsPerRow) * lfGroupDim, y = Math.floor(g / f.lfGroupsPerRow) * lfGroupDim;
        decodeModularGroup(gr, lf, f, x, y, lfGroupDim, 3, 1000, 1 + f.numLfGroups + g);
        vardct?.readHfMetadata(gr, g, lf.tree);
    }
    if (vardct) {
        vardct.readHfGlobal(sections.get(1 + f.numLfGroups), lf.tree);
        const lfFrame = useLfFrame ? state.lfFrames[f.lfLevel] : null;
        if (useLfFrame && !lfFrame)
            throw new Error('JPEG XL: no LF frame');
        const many = pool.threads && f.numGroups > 1 && f.width * f.height >= MIN_THREADED_PIXELS;
        vardct.prepare(image.quantBias, image.quantBiasNumerator, lfFrame ? lfFrame.channels.slice(0, 3) : null, many ? [0, 1, 2].map(c => new Float32Array(new SharedArrayBuffer(4 * vardct.stride(c) * (vardct.bh >> vardct.vs[c]) * 8))) : undefined);
    }
    const coeffs = vardct ? [0, 1, 2].map(() => new Int32Array(f.groupDim * f.groupDim)) : [];
    const local = (g) => decodeGroup(g, f, sections, lf, vardct, coeffs);
    let groupsDone = false;
    if (pool.threads && f.numGroups > 1 && f.width * f.height >= MIN_THREADED_PIXELS) {
        if (!pool.data)
            pool.data = shared(d);
        const planes = vardct ? vardct.rendered : null;
        for (const c of lf.modular.channels)
            c.data = shared(c.data);
        const task = {
            task: 'jxl-groups', data: pool.data, at, image, channels: lf.modular.channels, nbMeta: lf.modular.nbMeta,
            vardct: vardct ? vardct.share() : null, planes,
        };
        try {
            await runChunks(pool.threads, task, f.numGroups, local);
            if (vardct && planes)
                vardct.adopt(vardct.share(), planes);
            groupsDone = true;
        }
        catch {
            for (const t of pool.threads)
                t.terminate();
            pool.threads = null;
            if (vardct)
                vardct.rendered.forEach(p => p.fill(0));
        }
    }
    if (!groupsDone)
        for (let g = 0; g < f.numGroups; g++)
            local(g);
    const bytes = !vardct && f.modular && !f.doYCbCr && !f.gab && !f.epf && !lf.patches && !lf.splines && !lf.noise && f.upsampling === 1
        && f.ecUpsampling.every(u => u === 1) && shownAsIs(f, image) && state.output.bytesOfSamples() && !image.bitDepth.float;
    let planes;
    if (bytes)
        planes = await modularToBytes(lf, f, image, pool);
    else {
        lf.modular.undo();
        planes = modularToPlanes(lf, f, image);
    }
    let sigma = null;
    if (vardct) {
        const xyb = vardct.rendered;
        const color = xyb.map((plane, c) => {
            const hs = vardct.hs[c], vs = vardct.vs[c], w = Math.ceil(f.sampleWidth / (1 << hs)), h = Math.ceil(f.sampleHeight / (1 << vs));
            const out = crop(plane, vardct.stride(c), w, h);
            return hs || vs ? chromaUpsample(out, w, h, f.sampleWidth, f.sampleHeight) : out;
        });
        planes = { ...planes, channels: [...color, ...planes.channels] };
        sigma = vardct.sigma;
    }
    planes = await threaded(pool, planes.width * planes.height, threads => filterThreaded(planes, f, image, sigma, vardct ? vardct.bw : 0, threads), () => filter(planes, f, image, sigma, vardct ? vardct.bw : 0));
    const numColor = planes.channels.length - image.extraChannels.length;
    if (lf.patches)
        applyPatches(planes, numColor, lf.patches, state.references, image.extraChannels);
    const baseX = lf.vardct ? lf.vardct.baseX : 0, baseB = lf.vardct ? lf.vardct.baseB : 1;
    if (lf.splines && numColor === 3)
        renderSplines(planes, lf.splines, baseX, baseB);
    planes = upsamplePlanes(planes, f, image);
    if (lf.noise && numColor === 3)
        renderNoise(planes, lf.noise, f.groupDim, state.visible, state.invisible, baseX, baseB);
    const frame = await render(planes, f, state, pool);
    return { ...frame, end: t.end };
}
function decodeGroup(g, f, sections, lf, vardct, coeffs) {
    for (const c of coeffs)
        c.fill(0);
    for (let p = 0; p < f.numPasses; p++) {
        const [min, max] = passShifts(f, p);
        const gr = sections.get(2 + f.numLfGroups + p * f.numGroups + g);
        vardct?.readPassGroup(gr, p, g, coeffs);
        const x = (g % f.groupsPerRow) * f.groupDim, y = Math.floor(g / f.groupsPerRow) * f.groupDim;
        decodeModularGroup(gr, lf, f, x, y, f.groupDim, min, max, 1 + 3 * f.numLfGroups + NUM_QUANT_TABLES + f.numGroups * p + g);
    }
    vardct?.renderGroup(g, coeffs);
}
export function groupChunks(task) {
    const r = new BitReader(task.data, task.at), f = frameHeader(r, task.image), sections = new Sections(task.data, toc(r, f));
    const lf = lfGlobal(sections.get(0), f, task.image, task);
    const vardct = lf.vardct ? new VarDCT(f, lf.vardct, lf.lfDequant, task.image.bitDepth.bits) : null;
    if (vardct) {
        vardct.adopt(task.vardct, task.planes);
        vardct.readHfGlobal(sections.get(1 + f.numLfGroups), lf.tree);
    }
    const coeffs = vardct ? [0, 1, 2].map(() => new Int32Array(f.groupDim * f.groupDim)) : [];
    return g => decodeGroup(g, f, sections, lf, vardct, coeffs);
}
function crop(src, stride, w, h) {
    if (stride === w && src.length === w * h)
        return src;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
        out.set(src.subarray(y * stride, y * stride + w), y * w);
    return out;
}
function chromaUpsample(src, sw, sh, w, h) {
    let cur = src, cw = sw;
    if (sw < w) {
        const out = new Float32Array(w * sh);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < w; x++) {
                const c = x >> 1, n = x & 1 ? Math.min(c + 1, sw - 1) : Math.max(c - 1, 0);
                out[y * w + x] = 0.75 * cur[y * sw + c] + 0.25 * cur[y * sw + n];
            }
        }
        cur = out;
        cw = w;
    }
    if (sh < h) {
        const out = new Float32Array(cw * h);
        for (let y = 0; y < h; y++) {
            const c = y >> 1, n = y & 1 ? Math.min(c + 1, sh - 1) : Math.max(c - 1, 0);
            for (let x = 0; x < cw; x++)
                out[y * cw + x] = 0.75 * cur[c * cw + x] + 0.25 * cur[n * cw + x];
        }
        cur = out;
    }
    return cur;
}
function lfGlobal(r, f, image, given) {
    const patches = f.flags & FLAG_PATCHES ? readPatches(r, image.extraChannels, f.width, f.height) : null;
    const splines = f.flags & FLAG_SPLINES ? readSplines(r, f.width, f.height) : null;
    const noise = f.flags & FLAG_NOISE ? readNoise(r) : null;
    const lfDequant = r.bool() ? [1 / 32, 1 / 4, 1 / 2] : [r.f16(), r.f16(), r.f16()];
    if (lfDequant.some(v => v / 128 < 1e-8))
        throw new Error('JPEG XL: invalid LF dequantization');
    const vardct = f.modular ? null : readVarDCTGlobal(r);
    const numExtra = image.extraChannels.length;
    let tree = null;
    if (r.bool())
        tree = readTree(r, Math.min(1 << 22, 1024 + Math.floor(f.width * f.height * (f.encodedColorChannels + numExtra) / 16)));
    if (given) {
        const modular = new ModularImage(given.channels, image.bitDepth.bits);
        modular.nbMeta = given.nbMeta;
        return { patches, splines, noise, lfDequant, vardct, tree, modular };
    }
    const w = f.sampleWidth, h = f.sampleHeight, list = [];
    if (f.modular) {
        if (f.doYCbCr) {
            const hs = f.jpegUpsampling.map(u => u === 1 || u === 2), vs = f.jpegUpsampling.map(u => u === 1 || u === 3);
            const anyH = hs.some(Boolean), anyV = vs.some(Boolean);
            for (let c = 0; c < 3; c++) {
                const u = f.jpegUpsampling[c];
                const hshift = anyH && (u === 0 || u === 3) ? 1 : 0, vshift = anyV && (u === 0 || u === 2) ? 1 : 0;
                list.push(channel(Math.ceil(w / (1 << hshift)), Math.ceil(h / (1 << vshift)), hshift, vshift));
            }
        }
        else
            for (let c = 0; c < f.encodedColorChannels; c++)
                list.push(channel(w, h));
    }
    const colorShift = Math.log2(f.upsampling);
    for (const up of f.ecUpsampling) {
        const shift = Math.log2(up) - colorShift;
        list.push(channel(Math.ceil(f.upsampledWidth / up), Math.ceil(f.upsampledHeight / up), shift, shift));
    }
    const modular = new ModularImage(list, image.bitDepth.bits);
    decodeModular(r, modular, 0, tree, f.groupDim, false);
    return { patches, splines, noise, lfDequant, vardct, tree, modular };
}
function decodeModularGroup(r, lf, f, x0, y0, dim, minShift, maxShift, stream) {
    const full = lf.modular.channels, nbMeta = lf.modular.nbMeta;
    let c = nbMeta;
    while (c < full.length && full[c].w <= f.groupDim && full[c].h <= f.groupDim)
        c++;
    const parts = [], channels = [];
    for (; c < full.length; c++) {
        const fc = full[c], shift = Math.min(fc.hshift, fc.vshift);
        if (shift > maxShift || shift < minShift)
            continue;
        const x = x0 >> fc.hshift, y = y0 >> fc.vshift;
        const w = Math.max(0, Math.min(dim >> fc.hshift, fc.w - x)), h = Math.max(0, Math.min(dim >> fc.vshift, fc.h - y));
        if (!w || !h)
            continue;
        parts.push([fc, x, y]);
        channels.push(channel(w, h, fc.hshift, fc.vshift));
    }
    if (!channels.length)
        return;
    const gi = new ModularImage(channels, lf.modular.bitDepth);
    decodeModular(r, gi, stream, lf.tree, Infinity, true);
    parts.forEach(([fc, x, y], i) => {
        const g = gi.channels[i];
        for (let row = 0; row < g.h; row++)
            fc.data.set(g.data.subarray(row * g.w, (row + 1) * g.w), (y + row) * fc.w + x);
    });
}
function samplesToFloat(c, depth) {
    const o = new Float32Array(c.w * c.h);
    if (depth.float)
        for (let i = 0; i < o.length; i++)
            o[i] = floatSample(c.data[i], depth.bits, depth.expBits);
    else {
        const scale = 1 / (2 ** depth.bits - 1);
        for (let i = 0; i < o.length; i++)
            o[i] = c.data[i] * scale;
    }
    return o;
}
function modularToPlanes(lf, f, image) {
    const ch = lf.modular.channels.slice(lf.modular.nbMeta);
    const out = [];
    const toFloat = (c, depth = image.bitDepth) => samplesToFloat(c, depth);
    if (!f.modular) {
        image.extraChannels.forEach((ec, i) => out.push(toFloat(ch[i], ec.bitDepth)));
        return { width: f.sampleWidth, height: f.sampleHeight, channels: out };
    }
    const numColor = f.encodedColorChannels;
    if (image.xybEncoded) {
        const [y, x, b] = ch;
        const X = new Float32Array(y.w * y.h), Y = new Float32Array(y.w * y.h), B = new Float32Array(y.w * y.h);
        const mx = lf.lfDequant[0] / 128, my = lf.lfDequant[1] / 128, mb = lf.lfDequant[2] / 128;
        for (let i = 0; i < X.length; i++) {
            X[i] = x.data[i] * mx;
            Y[i] = y.data[i] * my;
            B[i] = (b.data[i] + y.data[i]) * mb;
        }
        out.push(X, Y, B);
    }
    else
        for (let c = 0; c < numColor; c++)
            out.push(toFloat(ch[c]));
    image.extraChannels.forEach((ec, i) => out.push(toFloat(ch[numColor + i], ec.bitDepth)));
    return { width: f.sampleWidth, height: f.sampleHeight, channels: out };
}
async function modularToBytes(lf, f, image, pool) {
    const m = lf.modular, numColor = f.encodedColorChannels, n = f.width * f.height, first = m.transforms[0];
    const rct = numColor === 3 && first?.id === TR_RCT && first.beginC === m.nbMeta ? first : null;
    m.undo(rct ? 1 : 0);
    const color = rct ? m.rctChannels(rct) : [0, 1, 2].map(c => m.channels[m.nbMeta + (numColor === 1 ? 0 : c)].data);
    const task = (threaded) => ({
        task: 'jxl-post', kind: 'samples', w: f.width, h: f.height, inputs: [], outputs: [], samples: threaded ? color.map(sharedOf) : color,
        rctType: rct ? rct.rctType : -1, bits: image.bitDepth.bits, rgba: new Uint8Array(threaded ? new SharedArrayBuffer(4 * n) : new ArrayBuffer(4 * n)),
    });
    const rgba = await threaded(pool, n, async (threads) => {
        const t = task(true);
        await runChunks(threads, t, Math.ceil(f.height / BAND), postChunks(t));
        if (rct)
            for (let c = 0; c < 3; c++)
                m.channels[m.nbMeta + c].data = t.samples[c];
        return new Uint8Array(t.rgba);
    }, () => {
        const t = task(false);
        samplesToBytes(t.samples, t.rctType, t.bits, t.rgba, 0, n);
        return t.rgba;
    });
    if (rct) {
        m.permuteRCT(rct);
        m.transforms.length = 0;
    }
    const ch = m.channels.slice(m.nbMeta);
    return { width: f.width, height: f.height, channels: image.extraChannels.map((ec, i) => samplesToFloat(ch[numColor + i], ec.bitDepth)), rgba };
}
function samplesToBytes(samples, rctType, bits, rgba, i0, i1) {
    if (rctType >= 0)
        rctSamples(samples, rctType, i0, i1);
    const order = rctType >= 0 ? rctOrder(rctType) : [0, 1, 2], [r, g, b] = [0, 1, 2].map(c => samples[order.indexOf(c)]);
    const max = 2 ** bits - 1, scale = 1 / max;
    const table = bits <= 16 ? byteTable(bits) : null;
    if (table && littleEndian) {
        const words = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
        const at = (v) => v >>> 0 <= max ? table[v] : v < 0 ? 0 : 255;
        for (let i = i0; i < i1; i++)
            words[i] = at(r[i]) | at(g[i]) << 8 | at(b[i]) << 16 | 0xff000000;
    }
    else {
        [r, g, b].forEach((data, c) => {
            for (let i = i0, o = 4 * i0 + c; i < i1; i++, o += 4)
                rgba[o] = table ? (data[i] >>> 0 <= max ? table[data[i]] : data[i] < 0 ? 0 : 255) : byte(Math.fround(data[i] * scale));
        });
        for (let o = 4 * i0 + 3; o < 4 * i1; o += 4)
            rgba[o] = 255;
    }
}
const byteTables = new Map();
function byteTable(bits) {
    let table = byteTables.get(bits);
    if (!table) {
        const scale = 1 / (2 ** bits - 1);
        byteTables.set(bits, table = Uint8Array.from({ length: 2 ** bits }, (_, v) => byte(Math.fround(v * scale))));
    }
    return table;
}
function filter(p, f, image, sigma, sigmaStride = 0) {
    if (!f.gab && !f.epf)
        return p;
    const numColor = p.channels.length - image.extraChannels.length;
    let color = numColor === 1 ? [p.channels[0], p.channels[0], p.channels[0]] : p.channels.slice(0, 3);
    if (f.gab)
        color = gaborish(color, p.width, p.height, f.gab);
    if (f.epf)
        color = epf(color, p.width, p.height, f.epf, sigma, sigmaStride);
    return { ...p, channels: [...color.slice(0, numColor), ...p.channels.slice(numColor)] };
}
async function threaded(pool, pixels, inThreads, here) {
    if (pool.threads && pixels >= MIN_THREADED_PIXELS) {
        try {
            return await inThreads(pool.threads);
        }
        catch {
            for (const t of pool.threads)
                t.terminate();
            pool.threads = null;
        }
    }
    return here();
}
const sharedPlanes = (n, w, h) => Array.from({ length: n }, () => new Float32Array(new SharedArrayBuffer(4 * w * h)));
const BAND = 64;
export function postChunks(t) {
    const { w, h, inputs, outputs } = t;
    if (t.kind === 'gaborish')
        return chunk => gaborishRows(inputs, outputs, w, h, t.weights, chunk * BAND, Math.min(h, (chunk + 1) * BAND));
    if (t.kind === 'epf') {
        const scratch = epfScratch(w);
        return chunk => epfStrip(inputs, outputs, w, h, t.epf, t.sigma ?? null, t.bw, t.step, chunk, scratch);
    }
    if (t.kind === 'samples')
        return chunk => samplesToBytes(t.samples, t.rctType, t.bits, t.rgba, chunk * BAND * w, Math.min(h, (chunk + 1) * BAND) * w);
    const [x, y, b] = inputs;
    return chunk => xybToBytes(x, y, b, t.m, t.bias, t.k, t.rgba, chunk * BAND * w, Math.min(h, (chunk + 1) * BAND) * w);
}
async function filterThreaded(p, f, image, sigma, sigmaStride, threads) {
    if (!f.gab && !f.epf)
        return p;
    const numColor = p.channels.length - image.extraChannels.length, w = p.width, h = p.height;
    let color = (numColor === 1 ? [p.channels[0], p.channels[0], p.channels[0]] : p.channels.slice(0, 3)).map(sharedOf);
    if (f.gab) {
        const task = { task: 'jxl-post', kind: 'gaborish', w, h, inputs: color, outputs: sharedPlanes(3, w, h), weights: f.gab };
        await runChunks(threads, task, Math.ceil(h / BAND), postChunks(task));
        color = task.outputs;
    }
    if (f.epf) {
        const s = sigma && sharedOf(sigma);
        for (const step of epfSteps(f.epf)) {
            const task = { task: 'jxl-post', kind: 'epf', w, h, inputs: color, outputs: sharedPlanes(3, w, h), epf: f.epf, sigma: s, bw: sigmaStride, step };
            await runChunks(threads, task, epfStrips(h), postChunks(task));
            color = task.outputs;
        }
    }
    return { ...p, channels: [...color.slice(0, numColor), ...p.channels.slice(numColor)] };
}
function upsamplePlanes(p, f, image) {
    if (f.upsampling === 1 && f.ecUpsampling.every(u => u === 1))
        return p;
    const numColor = p.channels.length - image.extraChannels.length, W = f.upsampledWidth, H = f.upsampledHeight;
    const channels = p.channels.map((c, i) => {
        const up = i < numColor ? f.upsampling : f.ecUpsampling[i - numColor];
        return up === 1 ? c : upsample(c, Math.ceil(W / up), Math.ceil(H / up), up, image, W, H);
    });
    return { width: W, height: H, channels };
}
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function floatSample(v, bits, expBits) {
    if (bits === 32) {
        u32[0] = v;
        return f32[0];
    }
    const mantissaBits = bits - expBits - 1, sign = (v >>> (bits - 1)) & 1;
    const mantissa = v & ((1 << mantissaBits) - 1), exp = (v >>> mantissaBits) & ((1 << expBits) - 1), bias = (1 << (expBits - 1)) - 1;
    let value;
    if (exp === 0)
        value = mantissa / 2 ** mantissaBits * 2 ** (1 - bias);
    else if (exp === (1 << expBits) - 1)
        value = mantissa ? NaN : Infinity;
    else
        value = (1 + mantissa / 2 ** mantissaBits) * 2 ** (exp - bias);
    return sign ? -value : value;
}
const referenced = (f) => !f.isLast && (f.duration === 0 || f.saveAsReference !== 0) && f.type !== FRAME_LF;
const shownAsIs = (f, image) => (f.type === FRAME_REGULAR || f.type === FRAME_SKIP_PROGRESSIVE) && !f.haveCrop
    && f.blending.mode === BLEND_REPLACE && f.ecBlending.every(b => b.mode === BLEND_REPLACE) && f.width === image.width && f.height === image.height
    && !referenced(f) && image.extraChannels.every(e => e.type === EXTRA_ALPHA && !e.alphaAssociated);
async function render(p, f, state, pool) {
    const image = state.image;
    let planes = p;
    if (f.type === FRAME_LF) {
        state.lfFrames[f.lfLevel - 1] = planes;
        return { header: f, canvas: null };
    }
    const canReference = referenced(f);
    if (canReference && f.saveBeforeCT) {
        state.references[f.saveAsReference] = planes;
        state.referenceIsXYB[f.saveAsReference] = image.xybEncoded;
    }
    const normal = f.type === FRAME_REGULAR || f.type === FRAME_SKIP_PROGRESSIVE;
    const final = shownAsIs(f, image) && p.width === image.width && p.height === image.height;
    const bytes = state.output.bytesParams(f.doYCbCr, final), input = planes;
    planes = bytes ? await threaded(pool, planes.width * planes.height, async (threads) => {
        const { width: w, height: h, channels } = input, rgba = new Uint8Array(new SharedArrayBuffer(4 * w * h));
        const task = { task: 'jxl-post', kind: 'xyb', w, h, inputs: channels.slice(0, 3).map(sharedOf), outputs: [], rgba, ...bytes };
        await runChunks(threads, task, Math.ceil(h / BAND), postChunks(task));
        return { width: w, height: h, channels: channels.slice(3), rgba: new Uint8Array(rgba) };
    }, () => state.output.transform(input, f.doYCbCr, final)) : state.output.transform(planes, f.doYCbCr, final);
    const canvas = normal ? blend(planes, f, state) : planes;
    if (canReference && !f.saveBeforeCT) {
        state.references[f.saveAsReference] = canvas;
        state.referenceIsXYB[f.saveAsReference] = false;
    }
    return { header: f, canvas: normal ? canvas : null };
}
const PB_MODES = [];
PB_MODES[BLEND_REPLACE] = PB_REPLACE;
PB_MODES[BLEND_ADD] = PB_ADD;
PB_MODES[BLEND_BLEND] = PB_BLEND_ABOVE;
PB_MODES[BLEND_MULADD] = PB_ADD_ABOVE;
PB_MODES[BLEND_MUL] = PB_MUL;
const blending = (b) => ({ mode: PB_MODES[b.mode], alpha: b.alphaChannel, clamp: b.clamp });
function blend(p, f, state) {
    const image = state.image, W = image.width, H = image.height, numExtra = image.extraChannels.length;
    const n = p.channels.length, numColor = n - numExtra;
    const fullReplace = !f.haveCrop && f.blending.mode === BLEND_REPLACE && f.ecBlending.every(b => b.mode === BLEND_REPLACE);
    if (fullReplace && p.width === W && p.height === H)
        return p;
    const source = (c) => state.references[c < numColor ? f.blending.source : f.ecBlending[c - numColor].source];
    for (let c = 0; c < n; c++)
        if (state.referenceIsXYB[c < numColor ? f.blending.source : f.ecBlending[c - numColor].source] && source(c))
            throw new Error('JPEG XL: blending onto an XYB reference');
    const out = [];
    for (let c = 0; c < n; c++) {
        const bg = source(c), o = new Float32Array(W * H);
        if (bg) {
            if (bg.width < W || bg.height < H)
                throw new Error('JPEG XL: blending onto a cropped reference');
            const plane = bg.channels[c] ?? bg.channels[0];
            for (let y = 0; y < H; y++)
                o.set(plane.subarray(y * bg.width, y * bg.width + W), y * W);
        }
        out.push(o);
    }
    const x0 = Math.max(f.x0, 0), y0 = Math.max(f.y0, 0), x1 = Math.min(f.x0 + p.width, W), y1 = Math.min(f.y0 + p.height, H);
    if (x1 <= x0 || y1 <= y0)
        return { width: W, height: H, channels: out };
    const color = blending(f.blending), ec = f.ecBlending.map(blending);
    for (let y = y0; y < y1; y++) {
        const i = y * W + x0, j = (y - f.y0) * p.width + (x0 - f.x0);
        performBlending(out, i, p.channels, j, out, i, x1 - x0, numColor, color, ec, image.extraChannels);
    }
    return { width: W, height: H, channels: out };
}
