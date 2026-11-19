import { TXFM_DIMENSIONS } from "./tables.js";
import { inverseBasis, transformTypes1D, passShift } from "./itx.js";
import { dct4, dct8, dct16 } from "./fdct-lee.js";
function pseudoInverse(b, n, k) {
    const g = new Float64Array(k * 2 * k);
    for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
            let s = 0;
            for (let r = 0; r < n; r++)
                s += b[r * k + i] * b[r * k + j];
            g[i * 2 * k + j] = s;
        }
        g[i * 2 * k + k + i] = 1;
    }
    for (let c = 0; c < k; c++) {
        let p = c;
        for (let r = c + 1; r < k; r++)
            if (Math.abs(g[r * 2 * k + c]) > Math.abs(g[p * 2 * k + c]))
                p = r;
        if (p !== c) {
            for (let j = 0; j < 2 * k; j++) {
                const t = g[c * 2 * k + j];
                g[c * 2 * k + j] = g[p * 2 * k + j];
                g[p * 2 * k + j] = t;
            }
        }
        const pivot = g[c * 2 * k + c];
        for (let j = 0; j < 2 * k; j++)
            g[c * 2 * k + j] /= pivot;
        for (let r = 0; r < k; r++) {
            if (r === c)
                continue;
            const f = g[r * 2 * k + c];
            if (f)
                for (let j = 0; j < 2 * k; j++)
                    g[r * 2 * k + j] -= f * g[c * 2 * k + j];
        }
    }
    const out = new Float64Array(k * n);
    for (let i = 0; i < k; i++) {
        for (let r = 0; r < n; r++) {
            let s = 0;
            for (let j = 0; j < k; j++)
                s += g[i * 2 * k + k + j] * b[r * k + j];
            out[i * n + r] = s;
        }
    }
    return out;
}
const projections = new Map();
const projection = (log2, type) => {
    const key = log2 * 4 + type;
    let p = projections.get(key);
    if (!p) {
        const n = 4 << log2;
        projections.set(key, p = pseudoInverse(inverseBasis(log2, type), n, Math.min(n, 32)));
    }
    return p;
};
const tmp = new Float64Array(64 * 32);
const TWIDDLES = new Float64Array(64);
for (let n = 32; n <= 64; n *= 2)
    for (let i = 0; i < n / 2; i++)
        TWIDDLES[n / 2 + i] = 1 / (2 * Math.cos(Math.PI * (2 * i + 1) / (2 * n)));
function dct(x, o, n, scratch, so) {
    if (n === 4)
        return dct4(x, o);
    if (n === 8)
        return dct8(x, o);
    if (n === 16)
        return dct16(x, o);
    const half = n / 2;
    for (let i = 0; i < half; i++) {
        const a = x[o + i], b = x[o + n - 1 - i];
        scratch[so + i] = a + b;
        scratch[so + half + i] = (a - b) * TWIDDLES[half + i];
    }
    dct(scratch, so, half, x, o);
    dct(scratch, so + half, half, x, o + half);
    for (let k = 0; k < half; k++) {
        x[o + 2 * k] = scratch[so + k];
        x[o + 2 * k + 1] = scratch[so + half + k] + (k + 1 < half ? scratch[so + half + k + 1] : 0);
    }
}
const dctScales = new Map();
const dctScale = (log2) => {
    let s = dctScales.get(log2);
    if (!s) {
        const n = 4 << log2, k = Math.min(n, 32), p = projection(log2, 0);
        s = Float64Array.from({ length: k }, (_, j) => p[j * n] / Math.cos(Math.PI * j / (2 * n)));
        dctScales.set(log2, s);
    }
    return s;
};
const line = new Float64Array(64), scratch = new Float64Array(64);
function forward1D(log2, type, inp, io, step, out, oo, outStep) {
    const n = 4 << log2, k = Math.min(n, 32);
    if (type === 0) {
        for (let i = 0; i < n; i++)
            line[i] = inp[io + i * step];
        dct(line, 0, n, scratch, 0);
        const s = dctScale(log2);
        for (let j = 0; j < k; j++)
            out[oo + j * outStep] = line[j] * s[j];
        return;
    }
    const p = projection(log2, type);
    for (let i = 0; i < n; i++)
        line[i] = inp[io + i * step];
    for (let j = 0; j < k; j += 4) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let i = 0, r = j * n; i < n; i++, r++) {
            const v = line[i];
            s0 += p[r] * v;
            s1 += p[r + n] * v;
            s2 += p[r + 2 * n] * v;
            s3 += p[r + 3 * n] * v;
        }
        out[oo + j * outStep] = s0;
        out[oo + (j + 1) * outStep] = s1;
        out[oo + (j + 2) * outStep] = s2;
        out[oo + (j + 3) * outStep] = s3;
    }
}
export function forwardTransform(res, tx, txtp, out) {
    const w = 4 * TXFM_DIMENSIONS[tx * 8], h = 4 * TXFM_DIMENSIONS[tx * 8 + 1];
    const lw = TXFM_DIMENSIONS[tx * 8 + 2], lh = TXFM_DIMENSIONS[tx * 8 + 3];
    const kw = Math.min(w, 32), kh = Math.min(h, 32);
    const [rowType, colType] = transformTypes1D(txtp);
    const scale = 16 * 2 ** passShift(tx) / (w * 2 === h || h * 2 === w ? 181 / 256 : 1);
    for (let y = 0; y < h; y++)
        forward1D(lw, rowType, res, y * w, 1, tmp, y * kw, 1);
    for (let kx = 0; kx < kw; kx++)
        forward1D(lh, colType, tmp, kx, kw, out, kx * kh, 1);
    for (let i = 0; i < kw * kh; i++)
        out[i] *= scale;
}
const energies = new Map();
export function pixelEnergy(tx) {
    let e = energies.get(tx);
    if (e === undefined) {
        const w = 4 * TXFM_DIMENSIONS[tx * 8], h = 4 * TXFM_DIMENSIONS[tx * 8 + 1];
        const lw = TXFM_DIMENSIONS[tx * 8 + 2], lh = TXFM_DIMENSIONS[tx * 8 + 3];
        const norm = (log2) => {
            const n = 4 << log2, k = Math.min(n, 32), b = inverseBasis(log2, 0);
            let s = 0;
            for (let i = 0; i < n * k; i++)
                s += b[i] * b[i];
            return s / k;
        };
        const scale = (w * 2 === h || h * 2 === w ? 181 / 256 : 1) / (16 * 2 ** passShift(tx));
        energies.set(tx, e = scale * scale * norm(lw) * norm(lh));
    }
    return e;
}
export function forwardWht(res, out) {
    for (let i = 0; i < 4; i++) {
        let a = res[i], b = res[4 + i], c = res[8 + i], d = res[12 + i];
        a += b;
        d -= c;
        const e = (a - d) >> 1;
        b = e - b;
        c = e - c;
        a -= c;
        d += b;
        out[i] = a;
        out[4 + i] = c;
        out[8 + i] = d;
        out[12 + i] = b;
    }
    for (let i = 0; i < 4; i++) {
        let a = out[i * 4], b = out[i * 4 + 1], c = out[i * 4 + 2], d = out[i * 4 + 3];
        a += b;
        d -= c;
        const e = (a - d) >> 1;
        b = e - b;
        c = e - c;
        a -= c;
        d += b;
        out[i * 4] = a;
        out[i * 4 + 1] = c;
        out[i * 4 + 2] = d;
        out[i * 4 + 3] = b;
    }
}
