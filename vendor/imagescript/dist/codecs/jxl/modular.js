import { unpackSigned } from "./bits.js";
import { EntropyDecoder } from "./entropy.js";
export const channel = (w, h, hshift = 0, vshift = 0) => ({ w, h, hshift, vshift, data: new Int32Array(w * h) });
export const DEFAULT_WP = { p1: 16, p2: 10, p3a: 7, p3b: 7, p3c: 7, p3d: 0, p3e: 0, w: [13, 12, 12, 12] };
function wpHeader(r) {
    if (r.bool())
        return DEFAULT_WP;
    return { p1: r.bits(5), p2: r.bits(5), p3a: r.bits(5), p3b: r.bits(5), p3c: r.bits(5), p3d: r.bits(5), p3e: r.bits(5), w: [r.bits(4), r.bits(4), r.bits(4), r.bits(4)] };
}
const DIV_LOOKUP = new Uint32Array(64).map((_, i) => Math.floor(2 ** 24 / (i + 1)));
const floorLog2 = (x) => 31 - Math.clz32(x);
function mulShift24(a, b) {
    if (Math.abs(a) < 2 ** 28)
        return Math.floor(a * b / 16777216);
    return Number((BigInt(a) * BigInt(b)) >> 24n);
}
function weight(w, e, posN, posNE, posNW) {
    const sum = (e[posN] + e[posNE] + e[posNW]) >>> 0;
    const shift = sum === 0xffffffff ? 27 : Math.max(floorLog2(sum + 1) - 5, 0);
    return 4 + ((w * DIV_LOOKUP[sum >>> shift]) >>> shift);
}
export class WeightedPredictor {
    header;
    xsize;
    e0;
    e1;
    e2;
    e3;
    error;
    w0;
    w1;
    w2;
    w3;
    p0 = 0;
    p1 = 0;
    p2 = 0;
    p3 = 0;
    pred = 0;
    maxError = 0;
    constructor(header, xsize) {
        this.header = header;
        this.xsize = xsize;
        const n = (xsize + 2) * 2;
        [this.e0, this.e1, this.e2, this.e3] = [0, 1, 2, 3].map(() => new Uint32Array(n));
        this.error = new Int32Array(n);
        [this.w0, this.w1, this.w2, this.w3] = header.w;
    }
    predict(x, y, N, W, NE, NW, NN) {
        const h = this.header, xsize = this.xsize;
        const cur = y & 1 ? 0 : xsize + 2, prev = y & 1 ? xsize + 2 : 0;
        const posN = prev + x, posNE = x < xsize - 1 ? posN + 1 : posN, posNW = x > 0 ? posN - 1 : posN;
        let w0 = weight(this.w0, this.e0, posN, posNE, posNW), w1 = weight(this.w1, this.e1, posN, posNE, posNW);
        let w2 = weight(this.w2, this.e2, posN, posNE, posNW), w3 = weight(this.w3, this.e3, posN, posNE, posNW);
        N *= 8;
        W *= 8;
        NE *= 8;
        NW *= 8;
        NN *= 8;
        const err = this.error;
        const teW = x === 0 ? 0 : err[cur + x - 1], teN = err[posN], teNW = err[posNW], teNE = err[posNE];
        let p = teW;
        if (Math.abs(teN) > Math.abs(p))
            p = teN;
        if (Math.abs(teNW) > Math.abs(p))
            p = teNW;
        if (Math.abs(teNE) > Math.abs(p))
            p = teNE;
        this.maxError = p;
        const sumWN = teN + teW;
        const p0 = this.p0 = W + NE - N;
        const p1 = this.p1 = N - Math.floor((sumWN + teNE) * h.p1 / 32);
        const p2 = this.p2 = W - Math.floor((sumWN + teNW) * h.p2 / 32);
        const p3 = this.p3 = N - Math.floor((teNW * h.p3a + teN * h.p3b + teNE * h.p3c + (NN - N) * h.p3d + (NW - W) * h.p3e) / 32);
        const logWeight = floorLog2(w0 + w1 + w2 + w3) - 4;
        w0 >>= logWeight;
        w1 >>= logWeight;
        w2 >>= logWeight;
        w3 >>= logWeight;
        const weightSum = w0 + w1 + w2 + w3;
        const sum = (weightSum >> 1) - 1 + p0 * w0 + p1 * w1 + p2 * w2 + p3 * w3;
        let pred = mulShift24(sum, DIV_LOOKUP[weightSum - 1]);
        if (((teN ^ teW) | (teN ^ teNW)) <= 0) {
            const lo = W < NE ? (W < N ? W : N) : (NE < N ? NE : N), hi = W > NE ? (W > N ? W : N) : (NE > N ? NE : N);
            pred = pred < lo ? lo : pred > hi ? hi : pred;
        }
        this.pred = pred;
        return Math.floor((pred + 3) / 8);
    }
    update(value, x, y) {
        const xsize = this.xsize, cur = y & 1 ? 0 : xsize + 2, i = cur + x, j = (y & 1 ? xsize + 2 : 0) + x + 1;
        const val = value * 8;
        this.error[i] = this.pred - val;
        const e0 = Math.floor((Math.abs(this.p0 - val) + 3) / 8) >>> 0, e1 = Math.floor((Math.abs(this.p1 - val) + 3) / 8) >>> 0;
        const e2 = Math.floor((Math.abs(this.p2 - val) + 3) / 8) >>> 0, e3 = Math.floor((Math.abs(this.p3 - val) + 3) / 8) >>> 0;
        const E0 = this.e0, E1 = this.e1, E2 = this.e2, E3 = this.e3;
        E0[i] = e0;
        E0[j] = (E0[j] + e0) >>> 0;
        E1[i] = e1;
        E1[j] = (E1[j] + e1) >>> 0;
        E2[i] = e2;
        E2[j] = (E2[j] + e2) >>> 0;
        E3[i] = e3;
        E3[j] = (E3[j] + e3) >>> 0;
    }
}
export const clampedGradient = (n, w, l) => {
    const m = n < w ? n : w, M = n < w ? w : n;
    return l < m ? M : l > M ? m : (n + w - l) | 0;
};
function predict(p, left, top, toptop, topleft, topright, leftleft, toprightright, wp) {
    switch (p) {
        case 0: return 0;
        case 1: return left;
        case 2: return top;
        case 3: return Math.trunc((left + top) / 2);
        case 4: return Math.abs(top - topleft) < Math.abs(left - topleft) ? left : top;
        case 5: return clampedGradient(left, top, topleft);
        case 6: return wp;
        case 7: return topright;
        case 8: return topleft;
        case 9: return leftleft;
        case 10: return Math.trunc((left + topleft) / 2);
        case 11: return Math.trunc((topleft + top) / 2);
        case 12: return Math.trunc((top + topright) / 2);
        default: return Math.trunc((6 * top - 2 * toptop + 7 * left + leftleft + toprightright + 3 * topright + 8) / 16);
    }
}
export function readTree(r, limit) {
    const dec = new EntropyDecoder(r, 6);
    if (dec.singleToken(dec.clusters[1]) > 0)
        throw new Error('JPEG XL: infinite MA tree');
    dec.begin(r);
    const property = [], split = [], left = [], right = [];
    const ctx = [], predictor = [], offset = [], multiplier = [];
    let leaves = 0;
    for (let toDecode = 1; toDecode > 0;) {
        if (property.length > Math.min(limit, 1 << 22))
            throw new Error('JPEG XL: MA tree too large');
        toDecode--;
        const prop = dec.read(r, 1) - 1;
        if (prop > 255)
            throw new Error('JPEG XL: invalid MA tree property');
        if (prop < 0) {
            const pred = dec.read(r, 2);
            if (pred > 13)
                throw new Error('JPEG XL: invalid predictor');
            const off = unpackSigned(dec.read(r, 3)), mulLog = dec.read(r, 4);
            if (mulLog > 30)
                throw new Error('JPEG XL: invalid multiplier');
            const mulBits = dec.read(r, 5);
            if (mulBits >= 2 ** (31 - mulLog) - 1)
                throw new Error('JPEG XL: invalid multiplier');
            property.push(-1);
            split.push(0);
            left.push(0);
            right.push(0);
            ctx.push(leaves++);
            predictor.push(pred);
            offset.push(off);
            multiplier.push((mulBits + 1) * 2 ** mulLog);
        }
        else {
            const n = property.length;
            property.push(prop);
            split.push(unpackSigned(dec.read(r, 0)));
            left.push(n + toDecode + 1);
            right.push(n + toDecode + 2);
            ctx.push(0);
            predictor.push(0);
            offset.push(0);
            multiplier.push(1);
            toDecode += 2;
        }
    }
    dec.finish();
    const tree = {
        property: Int32Array.from(property), split: Int32Array.from(split), left: Int32Array.from(left), right: Int32Array.from(right),
        ctx: Int32Array.from(ctx), predictor: Uint8Array.from(predictor), offset: Int32Array.from(offset), multiplier: Int32Array.from(multiplier)
    };
    validateTree(tree);
    return { tree, code: new EntropyDecoder(r, leaves) };
}
function validateTree(t) {
    const n = t.property.length, depth = new Int32Array(n);
    const stack = [[0, new Map()]];
    while (stack.length) {
        const [i, ranges] = stack.pop();
        if (depth[i] > 2048)
            throw new Error('JPEG XL: MA tree too deep');
        const p = t.property[i];
        if (p < 0)
            continue;
        const [lo, hi] = ranges.get(p) ?? [-(2 ** 31), 2 ** 31 - 1];
        const v = t.split[i];
        if (lo > v || hi <= v)
            throw new Error('JPEG XL: invalid MA tree');
        depth[t.left[i]] = depth[t.right[i]] = depth[i] + 1;
        stack.push([t.left[i], new Map(ranges).set(p, [v + 1, hi])], [t.right[i], new Map(ranges).set(p, [lo, v])]);
    }
}
function specialize(t, chan, stream) {
    const map = new Map(), order = [];
    const resolve = (i) => {
        while (t.property[i] === 0 || t.property[i] === 1)
            i = (t.property[i] === 0 ? chan : stream) > t.split[i] ? t.left[i] : t.right[i];
        return i;
    };
    const visit = (i) => {
        i = resolve(i);
        let id = map.get(i);
        if (id === undefined) {
            id = order.length;
            map.set(i, id);
            order.push(i);
        }
        return id;
    };
    visit(0);
    const left = [], right = [];
    for (let k = 0; k < order.length; k++) {
        const i = order[k];
        if (t.property[i] < 0) {
            left.push(0);
            right.push(0);
        }
        else {
            left.push(visit(t.left[i]));
            right.push(visit(t.right[i]));
        }
    }
    const pick = (a) => a.constructor === Uint8Array ? Uint8Array.from(order, i => a[i]) : Int32Array.from(order, i => a[i]);
    return {
        property: pick(t.property), split: pick(t.split), left: Int32Array.from(left), right: Int32Array.from(right),
        ctx: pick(t.ctx), predictor: pick(t.predictor), offset: pick(t.offset), multiplier: pick(t.multiplier)
    };
}
export const TR_RCT = 0, TR_PALETTE = 1, TR_SQUEEZE = 2;
function transform(r) {
    const id = r.u32(0, 1, 2, 3);
    if (id === 3)
        throw new Error('JPEG XL: invalid transform');
    const t = { id, beginC: 0, rctType: 6, numC: 3, nbColors: 256, nbDeltas: 0, predictor: 0, squeezes: [] };
    const beginDist = [[0, 3], [8, 6], [72, 10], [1096, 13]];
    if (id === TR_RCT || id === TR_PALETTE)
        t.beginC = r.u32(...beginDist);
    if (id === TR_RCT) {
        t.rctType = r.u32(6, [0, 2], [2, 4], [10, 6]);
        if (t.rctType >= 42)
            throw new Error('JPEG XL: invalid RCT type');
    }
    if (id === TR_PALETTE) {
        t.numC = r.u32(1, 3, 4, [1, 13]);
        t.nbColors = r.u32([0, 8], [256, 10], [1280, 12], [5376, 16]);
        t.nbDeltas = r.u32(0, [1, 8], [257, 10], [1281, 16]);
        t.predictor = r.bits(4);
        if (t.predictor > 13)
            throw new Error('JPEG XL: invalid predictor');
    }
    if (id === TR_SQUEEZE) {
        const n = r.u32(0, [1, 4], [9, 6], [41, 8]);
        for (let i = 0; i < n; i++)
            t.squeezes.push({ horizontal: r.bool(), inPlace: r.bool(), beginC: r.u32(...beginDist), numC: r.u32(1, 2, 3, [4, 4]) });
    }
    return t;
}
export function rctOrder(rctType) {
    const perm = Math.floor(rctType / 7);
    return [perm % 3, (perm + 1 + Math.floor(perm / 3)) % 3, (perm + 2 - Math.floor(perm / 3)) % 3];
}
export function rctSamples([a, b, c], rctType, i0, i1) {
    const type = rctType % 7;
    if (type === 6) {
        for (let i = i0; i < i1; i++) {
            const Y = a[i], Co = b[i], Cg = c[i];
            const tmp = (Y - (Cg >> 1)) | 0, G = (Cg + tmp) | 0, B = (tmp - (Co >> 1)) | 0;
            a[i] = (B + Co) | 0;
            b[i] = G;
            c[i] = B;
        }
    }
    else if (type !== 0) {
        const second = type >> 1, third = type & 1;
        for (let i = i0; i < i1; i++) {
            const first = a[i];
            if (third)
                c[i] = (c[i] + first) | 0;
            if (second === 1)
                b[i] = (b[i] + first) | 0;
            else if (second === 2)
                b[i] = (b[i] + (((first + c[i]) | 0) >> 1)) | 0;
        }
    }
}
export class ModularImage {
    channels;
    bitDepth;
    nbMeta = 0;
    transforms = [];
    wp = null;
    constructor(channels, bitDepth) {
        this.channels = channels;
        this.bitDepth = bitDepth;
    }
    checkEqual(c1, c2) {
        if (c1 > this.channels.length || c2 >= this.channels.length || c2 < c1)
            throw new Error('JPEG XL: invalid channel range');
        if (c1 < this.nbMeta && c2 >= this.nbMeta)
            throw new Error('JPEG XL: transform of meta and non-meta channels');
        const a = this.channels[c1];
        for (let c = c1 + 1; c <= c2; c++) {
            const b = this.channels[c];
            if (a.w !== b.w || a.h !== b.h || a.hshift !== b.hshift || a.vshift !== b.vshift)
                throw new Error('JPEG XL: transform of different channels');
        }
    }
    meta(t) {
        const ch = this.channels;
        if (t.id === TR_RCT)
            this.checkEqual(t.beginC, t.beginC + 2);
        else if (t.id === TR_PALETTE) {
            const end = t.beginC + t.numC - 1;
            this.checkEqual(t.beginC, end);
            if (t.beginC >= this.nbMeta)
                this.nbMeta++;
            else {
                if (end >= this.nbMeta)
                    throw new Error('JPEG XL: invalid palette');
                this.nbMeta += 2 - t.numC;
            }
            ch.splice(t.beginC + 1, end - t.beginC);
            ch.unshift(channel(t.nbColors + t.nbDeltas, t.numC, -1, -1));
        }
        else {
            if (!t.squeezes.length)
                t.squeezes = this.defaultSqueezes();
            for (const s of t.squeezes) {
                const begin = s.beginC, end = s.beginC + s.numC - 1;
                if (begin >= ch.length || end >= ch.length)
                    throw new Error('JPEG XL: invalid squeeze');
                if (begin < this.nbMeta) {
                    if (end >= this.nbMeta || !s.inPlace)
                        throw new Error('JPEG XL: invalid squeeze');
                    this.nbMeta += s.numC;
                }
                const offset = s.inPlace ? end + 1 : ch.length;
                for (let c = begin; c <= end; c++) {
                    const x = ch[c];
                    if (x.hshift > 30 || x.vshift > 30)
                        throw new Error('JPEG XL: too many squeezes');
                    let w = x.w, h = x.h;
                    if (w === 0 || h === 0)
                        throw new Error('JPEG XL: squeeze of an empty channel');
                    if (s.horizontal) {
                        x.w = (w + 1) >> 1;
                        if (x.hshift >= 0)
                            x.hshift++;
                        w -= x.w;
                    }
                    else {
                        x.h = (h + 1) >> 1;
                        if (x.vshift >= 0)
                            x.vshift++;
                        h -= x.h;
                    }
                    x.data = new Int32Array(x.w * x.h);
                    ch.splice(offset + c - begin, 0, channel(w, h, x.hshift, x.vshift));
                }
            }
        }
    }
    defaultSqueezes() {
        const out = [], ch = this.channels, m = this.nbMeta, n = ch.length - m;
        let w = ch[m].w, h = ch[m].h;
        if (n > 2 && ch[m + 1].w === w && ch[m + 1].h === h) {
            out.push({ horizontal: true, inPlace: false, beginC: m + 1, numC: 2 }, { horizontal: false, inPlace: false, beginC: m + 1, numC: 2 });
        }
        const sq = (horizontal) => out.push({ horizontal, inPlace: true, beginC: m, numC: n });
        if (w <= h && h > 8) {
            sq(false);
            h = (h + 1) >> 1;
        }
        while (w > 8 || h > 8) {
            if (w > 8) {
                sq(true);
                w = (w + 1) >> 1;
            }
            if (h > 8) {
                sq(false);
                h = (h + 1) >> 1;
            }
        }
        return out;
    }
    undo(keep = 0) {
        while (this.transforms.length > keep) {
            const t = this.transforms.pop();
            if (t.id === TR_RCT)
                this.inverseRCT(t);
            else if (t.id === TR_PALETTE)
                this.inversePalette(t);
            else
                for (let i = t.squeezes.length - 1; i >= 0; i--)
                    this.inverseSqueeze(t.squeezes[i]);
        }
    }
    inverseRCT(t) {
        const c = this.channels[t.beginC];
        rctSamples(this.rctChannels(t), t.rctType, 0, c.w * c.h);
        this.permuteRCT(t);
    }
    rctChannels(t) {
        this.checkEqual(t.beginC, t.beginC + 2);
        return [0, 1, 2].map(i => this.channels[t.beginC + i].data);
    }
    permuteRCT(t) {
        const m = t.beginC, ch = this.channels, [c0, c1, c2] = ch.slice(m, m + 3);
        const [o0, o1, o2] = rctOrder(t.rctType).map(o => m + o);
        ch[o0] = c0;
        ch[o1] = c1;
        ch[o2] = c2;
    }
    inversePalette(t) {
        if (this.nbMeta < 1)
            throw new Error('JPEG XL: palette transform without a palette');
        const ch = this.channels, palette = ch[0], nb = palette.h, c0 = t.beginC + 1;
        if (c0 >= ch.length || nb < 1)
            throw new Error('JPEG XL: invalid palette');
        const { w, h } = ch[c0], bitDepth = Math.min(this.bitDepth, 24);
        for (let i = 1; i < nb; i++)
            ch.splice(c0 + 1, 0, channel(w, h, ch[c0].hshift, ch[c0].vshift));
        const indices = ch[c0].data;
        if (nb > 1 || t.nbDeltas || t.predictor)
            ch[c0].data = new Int32Array(w * h);
        for (let c = 0; c < nb; c++) {
            const out = ch[c0 + c].data;
            if (!t.nbDeltas && !t.predictor) {
                for (let i = 0; i < w * h; i++) {
                    const index = nb === 1 ? Math.min(Math.max(indices[i], 0), palette.w - 1) : indices[i];
                    out[i] = paletteValue(palette, index, c, bitDepth);
                }
                continue;
            }
            const wp = t.predictor === 6 ? new WeightedPredictor(this.wp, w) : null;
            for (let y = 0, i = 0; y < h; y++) {
                for (let x = 0; x < w; x++, i++) {
                    const index = indices[i];
                    let v = paletteValue(palette, index, c, bitDepth);
                    if (index < t.nbDeltas) {
                        const left = x ? out[i - 1] : y ? out[i - w] : 0, top = y ? out[i - w] : left;
                        const topleft = x && y ? out[i - w - 1] : left, topright = x + 1 < w && y ? out[i - w + 1] : top;
                        const leftleft = x > 1 ? out[i - 2] : left, toptop = y > 1 ? out[i - 2 * w] : top;
                        const toprightright = x + 2 < w && y ? out[i - w + 2] : topright;
                        const wpPred = wp ? wp.predict(x, y, top, left, topright, topleft, toptop) : 0;
                        v += predict(t.predictor, left, top, toptop, topleft, topright, leftleft, toprightright, wpPred);
                    }
                    out[i] = v;
                    wp?.update(out[i], x, y);
                }
            }
        }
        if (c0 >= this.nbMeta)
            this.nbMeta--;
        else
            this.nbMeta -= 2 - nb;
        ch.shift();
    }
    inverseSqueeze(s) {
        const ch = this.channels, begin = s.beginC, end = s.beginC + s.numC - 1;
        if (begin >= ch.length || end >= ch.length)
            throw new Error('JPEG XL: invalid squeeze');
        const offset = s.inPlace ? end + 1 : ch.length + begin - end - 1;
        if (begin < this.nbMeta)
            this.nbMeta -= s.numC;
        for (let c = begin; c <= end; c++) {
            const rc = offset + c - begin;
            if (rc >= ch.length || ch[c].w < ch[rc].w || ch[c].h < ch[rc].h)
                throw new Error('JPEG XL: invalid squeeze');
            ch[c] = s.horizontal ? unsqueezeH(ch[c], ch[rc]) : unsqueezeV(ch[c], ch[rc]);
        }
        ch.splice(offset, end - begin + 1);
    }
}
const DELTA_PALETTE = [
    0, 0, 0, 4, 4, 4, 11, 0, 0, 0, 0, -13, 0, -12, 0, -10, -10, -10, -18, -18, -18, -27, -27, -27, -18, -18, 0, 0, 0, -32,
    -32, 0, 0, -37, -37, -37, 0, -32, -32, 24, 24, 45, 50, 50, 50, -45, -24, -24, -24, -45, -45, 0, -24, -24, -34, -34, 0,
    -24, 0, -24, -45, -45, -24, 64, 64, 64, -32, 0, -32, 0, -32, 0, -32, 0, 32, -24, -45, -24, 45, 24, 45, 24, -24, -45,
    -45, -24, 24, 80, 80, 80, 64, 0, 0, 0, 0, -64, 0, -64, -64, -24, -24, 45, 96, 96, 96, 64, 64, 0, 45, -24, -24, 34, -34,
    0, 112, 112, 112, 24, -45, -45, 45, 45, -24, 0, -32, 32, 24, -24, 45, 0, 96, 96, 45, -24, 24, 24, -45, -24, -24, -45,
    24, 0, -64, 0, 96, 0, 0, 128, 128, 128, 64, 0, 64, 144, 144, 144, 96, 96, 0, -36, -36, 36, 45, -24, -45, 45, -45, -24,
    0, 0, -96, 0, 128, 128, 0, 96, 0, 45, 24, -45, -128, 0, 0, 24, -45, 24, -45, 24, -45, 64, 0, -64, 64, -64, -64, 96, 0,
    96, 45, -45, 24, 24, 45, -45, 64, 64, -64, 128, 128, 0, 0, 0, -128, -24, 45, -45
];
export function paletteValue(palette, index, c, bitDepth) {
    const size = palette.w;
    if (index < 0) {
        if (c >= 3)
            return 0;
        index = -(index + 1) % 143;
        let v = DELTA_PALETTE[((index + 1) >> 1) * 3 + c] * (index & 1 ? 1 : -1);
        if (bitDepth > 8)
            v *= 2 ** (bitDepth - 8);
        return v | 0;
    }
    if (index >= size && index < size + 64) {
        if (c >= 3)
            return 0;
        const v = ((index - size) >> (2 * c)) % 4;
        return Math.floor(v * (2 ** bitDepth - 1) / 4) + (1 << Math.max(0, bitDepth - 3));
    }
    if (index >= size + 64) {
        if (c >= 3)
            return 0;
        const v = Math.floor((index - size - 64) / [1, 5, 25][c]) % 5;
        return Math.floor(v * (2 ** bitDepth - 1) / 4);
    }
    return palette.data[c * size + index];
}
function tendency(B, a, n) {
    let diff = 0;
    if (B >= a && a >= n) {
        diff = Math.trunc((4 * B - 3 * n - a + 6) / 12);
        if (diff - (diff & 1) > 2 * (B - a))
            diff = 2 * (B - a) + 1;
        if (diff + (diff & 1) > 2 * (a - n))
            diff = 2 * (a - n);
    }
    else if (B <= a && a <= n) {
        diff = Math.trunc((4 * B - 3 * n - a - 6) / 12);
        if (diff + (diff & 1) < 2 * (B - a))
            diff = 2 * (B - a) - 1;
        if (diff - (diff & 1) < 2 * (a - n))
            diff = 2 * (a - n);
    }
    return diff;
}
function unsqueezeH(avg, res) {
    if (avg.w !== ((avg.w + res.w + 1) >> 1) || avg.h !== res.h)
        throw new Error('JPEG XL: invalid squeeze');
    if (res.w === 0)
        return { ...avg, hshift: avg.hshift - 1 };
    const out = channel(avg.w + res.w, avg.h, avg.hshift - 1, avg.vshift), o = out.data, a = avg.data, r = res.data;
    for (let y = 0; y < avg.h; y++) {
        const ra = y * avg.w, rr = y * res.w, ro = y * out.w;
        for (let x = 0; x < res.w; x++) {
            const av = a[ra + x], next = x + 1 < avg.w ? a[ra + x + 1] : av, left = x ? o[ro + 2 * x - 1] : av;
            const diff = r[rr + x] + tendency(left, av, next), A = av + Math.trunc(diff / 2);
            o[ro + 2 * x] = A;
            o[ro + 2 * x + 1] = A - diff;
        }
        if (out.w & 1)
            o[ro + out.w - 1] = a[ra + avg.w - 1];
    }
    return out;
}
function unsqueezeV(avg, res) {
    if (avg.h !== ((avg.h + res.h + 1) >> 1) || avg.w !== res.w)
        throw new Error('JPEG XL: invalid squeeze');
    if (res.h === 0)
        return { ...avg, vshift: avg.vshift - 1 };
    const w = avg.w, out = channel(w, avg.h + res.h, avg.hshift, avg.vshift - 1), o = out.data, a = avg.data, r = res.data;
    for (let y = 0; y < res.h; y++) {
        const ra = y * w, rn = (y + 1 < avg.h ? y + 1 : y) * w, ro = 2 * y * w, rt = y ? (2 * y - 1) * w : -1;
        for (let x = 0; x < w; x++) {
            const av = a[ra + x], next = a[rn + x], top = rt >= 0 ? o[rt + x] : av;
            const diff = r[y * w + x] + tendency(top, av, next), v = av + Math.trunc(diff / 2);
            o[ro + x] = v;
            o[ro + w + x] = v - diff;
        }
    }
    if (out.h & 1)
        o.set(a.subarray((avg.h - 1) * w, avg.h * w), (out.h - 1) * w);
    return out;
}
export function decodeModular(r, image, stream, global, maxChanSize, undo) {
    if (!image.channels.length)
        return;
    const useGlobal = r.bool();
    image.wp = wpHeader(r);
    const n = r.u32(0, 1, [2, 4], [18, 8]);
    if (n > 512)
        throw new Error('JPEG XL: too many transforms');
    for (let i = 0; i < n; i++) {
        const t = transform(r);
        image.transforms.push(t);
        image.meta(t);
    }
    const ch = image.channels;
    let count = 0, distMultiplier = 0, pixels = 0;
    for (let i = 0; i < ch.length; i++) {
        if (!ch[i].w || !ch[i].h)
            continue;
        if (i >= image.nbMeta && (ch[i].w > maxChanSize || ch[i].h > maxChanSize)) {
            count = i;
            break;
        }
        distMultiplier = Math.max(distMultiplier, ch[i].w);
        pixels += ch[i].w * ch[i].h;
        count = i + 1;
    }
    if (count === 0 || !distMultiplier) {
        if (undo)
            image.undo();
        return;
    }
    let config;
    if (useGlobal) {
        if (!global)
            throw new Error('JPEG XL: no global MA tree');
        config = global;
    }
    else
        config = readTree(r, Math.min(1024 + pixels, 1 << 20));
    const dec = config.code.fork();
    dec.begin(r);
    for (let i = 0; i < count; i++) {
        if (!ch[i].w || !ch[i].h)
            continue;
        decodeChannel(r, dec, config.tree, image, i, stream, distMultiplier);
    }
    dec.finish();
    if (undo)
        image.undo();
}
function decodeZero(r, dec, cluster, data, mult, offset, distMultiplier) {
    for (let i = 0; i < data.length; i++)
        data[i] = (Math.imul(unpackSigned(dec.readClustered(r, cluster, distMultiplier)), mult) + offset) | 0;
}
function decodeGradient(r, dec, cluster, data, w, h, distMultiplier) {
    for (let x = 0; x < w; x++)
        data[x] = (unpackSigned(dec.readClustered(r, cluster, distMultiplier)) + (x ? data[x - 1] : 0)) | 0;
    for (let y = 1, i = w; y < h; y++) {
        data[i] = (unpackSigned(dec.readClustered(r, cluster, distMultiplier)) + data[i - w]) | 0;
        i++;
        for (let x = 1; x < w; x++, i++) {
            data[i] = (unpackSigned(dec.readClustered(r, cluster, distMultiplier)) + clampedGradient(data[i - w], data[i - 1], data[i - w - 1])) | 0;
        }
    }
}
function decodeChannel(r, dec, globalTree, image, chan, stream, distMultiplier) {
    const c = image.channels[chan], { w, h } = c, data = c.data;
    const t = specialize(globalTree, chan, stream);
    const clusters = dec.clusters;
    let maxProp = -1, usesWP = false;
    const uses = new Uint8Array(16);
    for (let i = 0; i < t.property.length; i++) {
        if (t.property[i] > maxProp)
            maxProp = t.property[i];
        if (t.property[i] >= 0 && t.property[i] < 16)
            uses[t.property[i]] = 1;
        if (t.property[i] === 15 || (t.property[i] < 0 && t.predictor[i] === 6))
            usesWP = true;
    }
    const neighborProps = uses.subarray(4).some(u => u === 1), gradient = uses[8] === 1 || uses[9] === 1;
    if (t.property[0] < 0) {
        const pred = t.predictor[0], offset = t.offset[0], mult = t.multiplier[0], cluster = clusters[t.ctx[0]];
        if (pred === 0) {
            const single = dec.singleToken(cluster);
            if (single >= 0) {
                data.fill((Math.imul(unpackSigned(single), mult) + offset) | 0);
                return;
            }
            decodeZero(r, dec, cluster, data, mult, offset, distMultiplier);
            return;
        }
        if (pred === 5 && mult === 1 && offset === 0) {
            decodeGradient(r, dec, cluster, data, w, h, distMultiplier);
            return;
        }
    }
    const refs = [];
    const numRefs = maxProp >= 16 ? ((maxProp - 16) >> 2) + 1 : 0;
    for (let j = chan - 1; j >= 0 && refs.length < numRefs; j--) {
        const o = image.channels[j];
        if (o.w === w && o.h === h && o.hshift === c.hshift && o.vshift === c.vshift)
            refs.push(o);
    }
    const props = new Int32Array(16 + 4 * numRefs);
    props[0] = chan;
    props[1] = stream;
    const wp = usesWP ? new WeightedPredictor(image.wp, w) : null;
    const { property, split, left: lc, right: rc, ctx, predictor, offset, multiplier } = t;
    for (let y = 0, i = 0; y < h; y++) {
        props[2] = y;
        props[9] = 0;
        for (let x = 0; x < w; x++, i++) {
            const left = x ? data[i - 1] : y ? data[i - w] : 0, top = y ? data[i - w] : left;
            const topleft = x && y ? data[i - w - 1] : left, topright = x + 1 < w && y ? data[i - w + 1] : top;
            const leftleft = x > 1 ? data[i - 2] : left, toptop = y > 1 ? data[i - 2 * w] : top;
            const toprightright = x + 2 < w && y ? data[i - w + 2] : topright;
            props[3] = x;
            if (neighborProps) {
                props[4] = Math.abs(top);
                props[5] = Math.abs(left);
                props[6] = top;
                props[7] = left;
                if (gradient) {
                    props[8] = left - props[9];
                    props[9] = left + top - topleft;
                }
                props[10] = left - topleft;
                props[11] = topleft - top;
                props[12] = top - topright;
                props[13] = top - toptop;
                props[14] = left - leftleft;
            }
            const wpPred = wp ? wp.predict(x, y, top, left, topright, topleft, toptop) : 0;
            if (wp)
                props[15] = wp.maxError;
            for (let k = 0; k < refs.length; k++) {
                const rd = refs[k].data, v = rd[i];
                const vleft = x ? rd[i - 1] : 0, vtop = y ? rd[i - w] : vleft, vtopleft = x && y ? rd[i - w - 1] : vleft;
                const g = clampedGradient(vleft, vtop, vtopleft);
                props[16 + 4 * k] = Math.abs(v);
                props[17 + 4 * k] = v;
                props[18 + 4 * k] = Math.abs(v - g);
                props[19 + 4 * k] = v - g;
            }
            let node = 0;
            while (property[node] >= 0)
                node = props[property[node]] > split[node] ? lc[node] : rc[node];
            const v = unpackSigned(dec.readClustered(r, clusters[ctx[node]], distMultiplier));
            const guess = offset[node] + predict(predictor[node], left, top, toptop, topleft, topright, leftleft, toprightright, wpPred);
            data[i] = (Math.imul(v, multiplier[node]) + guess) | 0;
            wp?.update(data[i], x, y);
        }
    }
}
