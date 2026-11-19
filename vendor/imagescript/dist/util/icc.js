const s15Fixed16 = (view, o) => view.getInt32(o) / 65536;
const SRGB_D50 = [
    0.4360747, 0.3850649, 0.1430804,
    0.2225045, 0.7168786, 0.0606169,
    0.0139322, 0.0971045, 0.7141733,
];
function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det || !Number.isFinite(det))
        return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const multiply3 = (m, n) => Array.from({ length: 9 }, (_, k) => {
    const r = k / 3 | 0, c = k % 3;
    return m[r * 3] * n[c] + m[r * 3 + 1] * n[3 + c] + m[r * 3 + 2] * n[6 + c];
});
const srgbEncode = (v) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
function curve(view, o, size) {
    if (size < 12)
        return null;
    const type = view.getUint32(o);
    if (type === 0x63757276) {
        const n = view.getUint32(o + 8);
        if (12 + n * 2 > size)
            return null;
        if (n === 0)
            return v => v;
        if (n === 1) {
            const gamma = view.getUint16(o + 12) / 256;
            return v => v ** gamma;
        }
        const table = new Float64Array(n);
        for (let i = 0; i < n; i++)
            table[i] = view.getUint16(o + 12 + i * 2) / 65535;
        return v => {
            const x = Math.min(1, Math.max(0, v)) * (n - 1), i = Math.min(n - 2, Math.floor(x));
            return table[i] + (table[i + 1] - table[i]) * (x - i);
        };
    }
    if (type === 0x70617261) {
        const kind = view.getUint16(o + 8), counts = [1, 3, 4, 5, 7];
        if (kind > 4 || 12 + counts[kind] * 4 > size)
            return null;
        const p = Array.from({ length: counts[kind] }, (_, i) => s15Fixed16(view, o + 12 + i * 4));
        const [g, a, b, c, d, e, f] = p;
        switch (kind) {
            case 0: return v => v ** g;
            case 1: return v => v >= -b / a ? (a * v + b) ** g : 0;
            case 2: return v => v >= -b / a ? (a * v + b) ** g + c : c;
            case 3: return v => v >= d ? (a * v + b) ** g : c * v;
            default: return v => v >= d ? (a * v + b) ** g + e : c * v + f;
        }
    }
    return null;
}
export function parseProfile(icc) {
    if (icc.length < 132)
        return null;
    const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
    const space = view.getUint32(16), pcs = view.getUint32(20);
    if (pcs !== 0x58595a20)
        return null;
    const gray = space === 0x47524159;
    if (!gray && space !== 0x52474220)
        return null;
    const tags = new Map();
    const count = view.getUint32(128);
    for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i++) {
        const e = 132 + i * 12, offset = view.getUint32(e + 4), size = view.getUint32(e + 8);
        if (offset + size <= icc.length)
            tags.set(String.fromCharCode(...icc.subarray(e, e + 4)), [offset, size]);
    }
    const curveOf = (tag) => {
        const t = tags.get(tag);
        return t ? curve(view, t[0], t[1]) : null;
    };
    if (gray) {
        const k = curveOf('kTRC');
        return k ? { gray, matrix: [], curves: [k] } : null;
    }
    const xyz = (tag) => {
        const t = tags.get(tag);
        if (!t || t[1] < 20 || view.getUint32(t[0]) !== 0x58595a20)
            return null;
        return [s15Fixed16(view, t[0] + 8), s15Fixed16(view, t[0] + 12), s15Fixed16(view, t[0] + 16)];
    };
    const r = xyz('rXYZ'), g = xyz('gXYZ'), b = xyz('bXYZ');
    const curves = [curveOf('rTRC'), curveOf('gTRC'), curveOf('bTRC')];
    if (!r || !g || !b || curves.some(c => !c))
        return null;
    return { gray, matrix: [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]], curves: curves };
}
function isSRGB(p) {
    if (!p.gray && p.matrix.some((v, i) => Math.abs(v - SRGB_D50[i]) > 0.002))
        return false;
    for (const c of p.curves)
        for (let i = 0; i <= 255; i += 5)
            if (Math.abs(srgbEncode(c(i / 255)) * 255 - i) > 0.4)
                return false;
    return true;
}
export function profileTransform(icc) {
    let p;
    try {
        p = parseProfile(icc);
    }
    catch {
        return null;
    }
    return p && transform(p);
}
const CICP_PRIMARIES = {
    1: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06], [0.3127, 0.3290]],
    4: [[0.67, 0.33], [0.21, 0.71], [0.14, 0.08], [0.310, 0.316]],
    5: [[0.64, 0.33], [0.29, 0.60], [0.15, 0.06], [0.3127, 0.3290]],
    6: [[0.630, 0.340], [0.310, 0.595], [0.155, 0.070], [0.3127, 0.3290]],
    7: [[0.630, 0.340], [0.310, 0.595], [0.155, 0.070], [0.3127, 0.3290]],
    8: [[0.681, 0.319], [0.243, 0.692], [0.145, 0.049], [0.310, 0.316]],
    9: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046], [0.3127, 0.3290]],
    11: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060], [0.314, 0.351]],
    12: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060], [0.3127, 0.3290]],
    22: [[0.630, 0.340], [0.295, 0.605], [0.155, 0.077], [0.3127, 0.3290]],
};
const D50 = [0.9642, 1, 0.8249];
const BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
export function cicpTransform(primaries, transfer) {
    const xy = CICP_PRIMARIES[primaries];
    if (!xy || transfer === 16 || transfer === 18)
        return null;
    const curve = transfer === 4 ? v => v ** 2.2 : transfer === 5 ? v => v ** 2.8 : transfer === 8 ? v => v : srgbDecode;
    return colorSpaceTransform(xy, curve);
}
export const srgbDecode = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export function colorSpaceTransform(xy, curve) {
    if (!xy)
        return transform({ gray: true, matrix: SRGB_D50, curves: [curve, curve, curve] });
    if (xy.some(([x, y]) => !(y > 0) || !Number.isFinite(x)))
        return null;
    const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];
    const p = [0, 1, 2].map(i => xyz(xy[i])), white = xyz(xy[3]);
    const columns = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], p[0][2], p[1][2], p[2][2]];
    const inverse = invert3(columns);
    if (!inverse)
        return null;
    const scale = [0, 1, 2].map(r => inverse[r * 3] * white[0] + inverse[r * 3 + 1] * white[1] + inverse[r * 3 + 2] * white[2]);
    const matrix = columns.map((v, i) => v * scale[i % 3]);
    const cone = (v) => [0, 1, 2].map(r => BRADFORD[r * 3] * v[0] + BRADFORD[r * 3 + 1] * v[1] + BRADFORD[r * 3 + 2] * v[2]);
    const from = cone(white), to = cone(D50);
    const adapt = multiply3(invert3(BRADFORD), multiply3([to[0] / from[0], 0, 0, 0, to[1] / from[1], 0, 0, 0, to[2] / from[2]], BRADFORD));
    return transform({ gray: false, matrix: multiply3(adapt, matrix), curves: [curve, curve, curve] });
}
function transform(p) {
    if (isSRGB(p))
        return null;
    const linear = p.curves.map(c => Float32Array.from({ length: 256 }, (_, i) => c(i / 255)));
    const N = 4096, encode = new Uint8Array(N + 1);
    for (let i = 0; i <= N; i++)
        encode[i] = Math.round(srgbEncode(i / N) * 255);
    const out = (v) => encode[v <= 0 ? 0 : v >= 1 ? N : Math.round(v * N)];
    if (p.gray) {
        const k = linear[0], lut = Uint8Array.from({ length: 256 }, (_, i) => out(k[i]));
        return rgba => {
            for (let i = 0; i < rgba.length; i += 4)
                if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2])
                    return;
            for (let i = 0; i < rgba.length; i += 4)
                rgba[i] = rgba[i + 1] = rgba[i + 2] = lut[rgba[i]];
        };
    }
    const inverse = invert3(SRGB_D50);
    const m = multiply3(inverse, p.matrix);
    if (m.some(v => !Number.isFinite(v)))
        return null;
    const [r0, r1, r2, g0, g1, g2, b0, b1, b2] = m.map(v => v * N), [lr, lg, lb] = linear;
    return rgba => {
        for (let i = 0; i < rgba.length; i += 4) {
            const r = lr[rgba[i]], g = lg[rgba[i + 1]], b = lb[rgba[i + 2]];
            const x = r0 * r + r1 * g + r2 * b + 0.5, y = g0 * r + g1 * g + g2 * b + 0.5, z = b0 * r + b1 * g + b2 * b + 0.5;
            rgba[i] = encode[x <= 0 ? 0 : x >= N ? N : x | 0];
            rgba[i + 1] = encode[y <= 0 ? 0 : y >= N ? N : y | 0];
            rgba[i + 2] = encode[z <= 0 ? 0 : z >= N ? N : z | 0];
        }
    };
}
