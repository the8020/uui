import { Image } from "../image.js";
export const LINEAR = new Float32Array(256).map((_, v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const encodeSRGB = (v) => 255 * (v <= 0.0031308 ? 12.92 * Math.max(0, v) : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055);
const LUMA = [0.2126, 0.7152, 0.0722];
const gainTables = (map) => [0, 1, 2].map(c => {
    const min = map.gainMapMin[c], max = map.gainMapMax[c], gamma = map.gamma[c];
    return new Float32Array(256).map((_, v) => min + (max - min) * (v / 255) ** (1 / gamma));
});
export function decodeGains(map) {
    const { bitmap } = map.image;
    const gains = new Float32Array(bitmap.length / 4 * 3);
    const tables = gainTables(map);
    for (let i = 0, g = 0; i < bitmap.length; i += 4, g += 3) {
        gains[g] = tables[0][bitmap[i]];
        gains[g + 1] = tables[1][bitmap[i + 1]];
        gains[g + 2] = tables[2][bitmap[i + 2]];
    }
    return gains;
}
export function encodeGains(map, gains, width, height, single) {
    const min = map.gainMapMin.slice(), max = map.gainMapMax.slice();
    for (let g = 0; g < gains.length; g += 3)
        for (let c = 0; c < 3; c++) {
            const v = gains[g + c];
            if (v < min[c])
                min[c] = v;
            if (v > max[c])
                max[c] = v;
        }
    if (single) {
        const lo = Math.min(...min), hi = Math.max(...max);
        min.fill(lo);
        max.fill(hi);
        const gamma = map.gamma[0];
        map.gamma = [gamma, gamma, gamma];
    }
    map.gainMapMin = min;
    map.gainMapMax = max;
    const image = map.image.width === width && map.image.height === height ? map.image : new Image(width, height);
    const out = image.bitmap;
    for (let i = 0, g = 0; i < out.length; i += 4, g += 3) {
        for (let c = 0; c < 3; c++) {
            const t = max[c] > min[c] ? (gains[g + c] - min[c]) / (max[c] - min[c]) : 0;
            out[i + c] = 255 * Math.min(1, Math.max(0, t)) ** map.gamma[c];
        }
        out[i + 3] = 255;
    }
    map.image = image;
}
export function neutralMap(like, likeWidth, width, height) {
    const scale = like.width / likeWidth;
    const size = (n) => Math.max(1, Math.round(n * scale));
    const map = like.clone();
    const image = new Image(size(width), size(height));
    const neutral = like.__neutral__();
    const bitmap = image.bitmap;
    for (let i = 0; i < bitmap.length; i += 4) {
        bitmap[i] = neutral[0];
        bitmap[i + 1] = neutral[1];
        bitmap[i + 2] = neutral[2];
        bitmap[i + 3] = 255;
    }
    map.image = image;
    map.gainMapMin = map.gainMapMin.map(v => Math.min(v, 0));
    map.gainMapMax = map.gainMapMax.map(v => Math.max(v, 0));
    return map;
}
const sample = (gains, width, height, x, y, out) => {
    const u = Math.min(width - 1, Math.max(0, x - 0.5)), v = Math.min(height - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = u - x0, fy = v - y0;
    const a = 3 * (y0 * width + x0), b = 3 * (y0 * width + x1), c = 3 * (y1 * width + x0), d = 3 * (y1 * width + x1);
    for (let k = 0; k < 3; k++)
        out[k] = (gains[a + k] * (1 - fx) + gains[b + k] * fx) * (1 - fy) + (gains[c + k] * (1 - fx) + gains[d + k] * fx) * fy;
};
export function redraw(image, map, left, top, right, bottom, light, single = map.channels === 1, extraMax = 0) {
    const { width, height, bitmap } = image;
    if (right <= left || bottom <= top)
        return;
    const mapWidth = map.width, mapHeight = map.height;
    const sx = mapWidth / width, sy = mapHeight / height;
    const oS = map.offsetSDR, oH = map.offsetHDR;
    const lo = Math.min(0, ...map.gainMapMin), hi = Math.max(0, ...map.gainMapMax, extraMax);
    const S = [0, 0, 0], H = [0, 0, 0], sumS = [0, 0, 0], sumH = [0, 0, 0];
    const i0 = Math.max(0, Math.floor(left * sx)), i1 = Math.min(mapWidth, Math.ceil(right * sx));
    const j0 = Math.max(0, Math.floor(top * sy)), j1 = Math.min(mapHeight, Math.ceil(bottom * sy));
    if (i1 <= i0 || j1 <= j0)
        return;
    const tables = gainTables(map), stored = map.image.bitmap;
    const regionWidth = i1 - i0;
    const next = new Float32Array(regionWidth * (j1 - j0) * 3);
    for (let j = j0; j < j1; j++) {
        const y0 = Math.max(0, Math.floor(j / sy)), y1 = Math.min(height, Math.max(y0 + 1, Math.floor((j + 1) / sy)));
        for (let i = i0; i < i1; i++) {
            const x0 = Math.max(0, Math.floor(i / sx)), x1 = Math.min(width, Math.max(x0 + 1, Math.floor((i + 1) / sx)));
            const m = 4 * (j * mapWidth + i), g = 3 * ((j - j0) * regionWidth + (i - i0));
            const boost = [2 ** tables[0][stored[m]], 2 ** tables[1][stored[m + 1]], 2 ** tables[2][stored[m + 2]]];
            sumS.fill(0);
            sumH.fill(0);
            for (let y = y0; y < y1; y++)
                for (let x = x0, p = 4 * (y * width + x0); x < x1; x++, p += 4) {
                    for (let c = 0; c < 3; c++)
                        S[c] = LINEAR[bitmap[p + c]];
                    if (x >= left && x < right && y >= top && y < bottom)
                        light(x, y, S, boost, H);
                    else
                        for (let c = 0; c < 3; c++)
                            H[c] = (S[c] + oS[c]) * boost[c] - oH[c];
                    for (let c = 0; c < 3; c++) {
                        sumS[c] += S[c];
                        sumH[c] += H[c];
                    }
                }
            const n = (y1 - y0) * (x1 - x0);
            if (single) {
                let s = 0, h = 0;
                for (let c = 0; c < 3; c++) {
                    s += LUMA[c] * (sumS[c] / n + oS[c]);
                    h += LUMA[c] * (sumH[c] / n + oH[c]);
                }
                next[g] = next[g + 1] = next[g + 2] = ratio(h, s, lo, hi);
            }
            else
                for (let c = 0; c < 3; c++)
                    next[g + c] = ratio(sumH[c] / n + oH[c], sumS[c] / n + oS[c], lo, hi);
        }
    }
    const { gainMapMin: min, gainMapMax: max, gamma } = map;
    let fits = !single || (min[0] === min[1] && min[1] === min[2] && max[0] === max[1] && max[1] === max[2] && gamma[0] === gamma[1] && gamma[1] === gamma[2]);
    for (let g = 0; fits && g < next.length; g += 3)
        for (let c = 0; c < 3; c++)
            if (!(next[g + c] >= min[c] && next[g + c] <= max[c]))
                fits = false;
    if (fits) {
        for (let j = j0; j < j1; j++)
            for (let i = i0, g = 3 * (j - j0) * regionWidth, m = 4 * (j * mapWidth + i0); i < i1; i++, g += 3, m += 4)
                for (let c = 0; c < 3; c++) {
                    const t = max[c] > min[c] ? (next[g + c] - min[c]) / (max[c] - min[c]) : 0;
                    stored[m + c] = 255 * Math.min(1, Math.max(0, t)) ** gamma[c];
                }
        return;
    }
    const gains = decodeGains(map);
    for (let j = j0; j < j1; j++)
        for (let i = i0, g = 3 * (j - j0) * regionWidth, m = 3 * (j * mapWidth + i0); i < i1; i++, g += 3, m += 3) {
            gains[m] = next[g];
            gains[m + 1] = next[g + 1];
            gains[m + 2] = next[g + 2];
        }
    encodeGains(map, gains, mapWidth, mapHeight, single);
}
const ratio = (h, s, lo, hi) => {
    if (!(s > 1e-3))
        return h > 1e-3 ? hi : 0;
    const g = Math.log2(Math.max(h, 1e-6) / s);
    return Number.isFinite(g) ? Math.min(hi + 4, Math.max(lo - 4, g)) : 0;
};
export function gainSampler(source) {
    const map = source.gainMap;
    if (!map)
        return null;
    const gains = decodeGains(map), width = map.width, height = map.height;
    const sx = width / source.width, sy = height / source.height;
    return (x, y, out) => sample(gains, width, height, (x + 0.5) * sx, (y + 0.5) * sy, out);
}
const encodeExtended = (v) => v <= 0.0031308 ? 12.92 * Math.max(0, v) : 1.055 * v ** (1 / 2.4) - 0.055;
const decodeExtended = (e) => e <= 0.04045 ? Math.max(0, e) / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
export function recolor(map, before, apply, exact) {
    const gains = decodeGains(map);
    const b = before.bitmap;
    const sdr = new Float32Array(gains.length);
    if (exact)
        for (let i = 0, g = 0; i < b.length; i += 4, g += 3)
            for (let c = 0; c < 3; c++)
                sdr[g + c] = decodeExtended(Math.min(1, exact(b[i + c] / 255)));
    else {
        const sdrImage = before.clone();
        apply(sdrImage);
        const a = sdrImage.bitmap;
        for (let i = 0, g = 0; i < a.length; i += 4, g += 3)
            for (let c = 0; c < 3; c++)
                sdr[g + c] = LINEAR[a[i + c]];
    }
    const oS = map.offsetSDR, oH = map.offsetHDR;
    const light = new Float32Array(gains.length), encoded = new Float32Array(gains.length), scale = new Float32Array(gains.length / 3);
    let peak = 1;
    for (let i = 0, g = 0; i < b.length; i += 4, g += 3) {
        let m = 1;
        for (let c = 0; c < 3; c++) {
            const h = light[g + c] = Math.max(0, (LINEAR[b[i + c]] + oS[c]) * 2 ** gains[g + c] - oH[c]);
            peak = Math.max(peak, h);
            m = Math.max(m, encoded[g + c] = encodeExtended(h));
        }
        scale[g / 3] = m;
    }
    const changed = new Float32Array(gains.length);
    if (exact)
        for (let g = 0; g < gains.length; g++)
            changed[g] = decodeExtended(exact(encoded[g]));
    else {
        const proxy = new Image(before.width, before.height), p = proxy.bitmap;
        for (let i = 0, g = 0; i < p.length; i += 4, g += 3) {
            for (let c = 0; c < 3; c++)
                p[i + c] = Math.round(255 * encoded[g + c] / scale[g / 3]);
            p[i + 3] = b[i + 3];
        }
        const original = p.slice();
        apply(proxy);
        for (let i = 0, g = 0; i < p.length; i += 4, g += 3) {
            const m = scale[g / 3];
            for (let c = 0; c < 3; c++) {
                const was = original[i + c], is = p[i + c];
                changed[g + c] = was === is ? light[g + c] : was >= 32 ? light[g + c] * decodeExtended(is * m / 255) / decodeExtended(was * m / 255) : decodeExtended(is * m / 255);
            }
        }
    }
    let changedPeak = 1;
    for (let g = 0; g < changed.length; g++)
        changedPeak = Math.max(changedPeak, changed[g]);
    const lo = Math.min(0, ...map.gainMapMin), hi = Math.max(Math.log2(Math.max(peak, changedPeak)), ...map.gainMapMax);
    const single = map.channels === 1;
    for (let g = 0; g < gains.length; g += 3) {
        if (single) {
            let s = 0, h = 0;
            for (let c = 0; c < 3; c++) {
                s += LUMA[c] * (sdr[g + c] + oS[c]);
                h += LUMA[c] * (changed[g + c] + oH[c]);
            }
            gains[g] = gains[g + 1] = gains[g + 2] = ratio(h, s, lo, hi);
        }
        else
            for (let c = 0; c < 3; c++)
                gains[g + c] = ratio(changed[g + c] + oH[c], sdr[g + c] + oS[c], lo, hi);
    }
    encodeGains(map, gains, map.width, map.height, single);
}
