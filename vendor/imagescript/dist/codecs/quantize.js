const WR = 3, WG = 4, WB = 2;
export function dominantColor(pixels, include, clusters = 8) {
    const { palette, weights } = medianCut(pixels, clusters, 4, include);
    if (!weights.length)
        return null;
    let best = 0;
    for (let i = 1; i < weights.length; i++)
        if (weights[i] > weights[best])
            best = i;
    return [Math.round(palette[best * 3]), Math.round(palette[best * 3 + 1]), Math.round(palette[best * 3 + 2])];
}
export function quantize(pixels, width, { maxColors = 256, quality = 95, transparent = false } = {}) {
    const length = pixels.length >> 2;
    let hasTransparency = transparent;
    for (let i = 3; i < pixels.length; i += 4)
        if (pixels[i] < 128) {
            hasTransparency = true;
            break;
        }
    quality = Math.min(100, Math.max(1, quality));
    const limit = Math.min(maxColors, Math.round(8 * 32 ** (Math.min(quality, 90) / 90)));
    const colors = hasTransparency ? limit - 1 : limit;
    const exact = exactPalette(pixels, colors);
    let palette, indices;
    if (exact)
        ({ palette, indices } = exact);
    else {
        palette = Uint8Array.from(medianCut(pixels, colors, Math.ceil(quality / 25)).palette, Math.round);
        indices = ditherMap(pixels, width, palette, palette.length / 3);
    }
    let transparentIndex = -1;
    if (hasTransparency) {
        transparentIndex = palette.length / 3;
        const padded = new Uint8Array(palette.length + 3);
        padded.set(palette);
        palette = padded;
        for (let i = 0; i < length; i++)
            if (pixels[i * 4 + 3] < 128)
                indices[i] = transparentIndex;
    }
    return { palette, indices, transparentIndex };
}
function exactPalette(pixels, limit) {
    const lookup = new Map();
    const indices = new Uint8Array(pixels.length >> 2);
    const palette = [];
    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        if (pixels[i + 3] < 128)
            continue;
        const key = pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2];
        let index = lookup.get(key);
        if (index === undefined) {
            if (lookup.size >= limit)
                return null;
            index = lookup.size;
            lookup.set(key, index);
            palette.push(pixels[i], pixels[i + 1], pixels[i + 2]);
        }
        indices[p] = index;
    }
    if (!palette.length)
        palette.push(0, 0, 0);
    return { palette: Uint8Array.from(palette), indices };
}
export function buildPalette(pixels, colors, minAlpha) {
    const seen = new Set();
    let exact = true;
    for (let i = 0; i < pixels.length && exact; i += 4) {
        if (pixels[i + 3] < minAlpha)
            continue;
        const key = pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2];
        if (seen.has(key))
            continue;
        if (seen.size === colors)
            exact = false;
        else
            seen.add(key);
    }
    if (exact) {
        const palette = new Uint8Array(seen.size * 3);
        let p = 0;
        for (const key of seen) {
            palette[p++] = key >> 16;
            palette[p++] = key >> 8 & 255;
            palette[p++] = key & 255;
        }
        return palette;
    }
    return Uint8Array.from(medianCut(pixels, colors, 4, undefined, minAlpha).palette, Math.round);
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const FLOYD_STEINBERG = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
const ATKINSON = [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
export function applyPalette(pixels, width, height, palette, dither, strength) {
    const entries = palette.length / 3;
    if (!entries)
        return;
    const nearest = nearestSearch(palette, entries);
    const clampFloat = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
    if (dither === 'none' || dither === 'ordered') {
        const spread = dither === 'ordered' ? strength * 255 / Math.cbrt(entries) : 0;
        for (let y = 0, p = 0; y < height; y++) {
            for (let x = 0; x < width; x++, p++) {
                if (!pixels[p * 4 + 3])
                    continue;
                const offset = spread ? ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * spread : 0;
                const index = nearest(clampFloat(pixels[p * 4] + offset), clampFloat(pixels[p * 4 + 1] + offset), clampFloat(pixels[p * 4 + 2] + offset));
                pixels[p * 4] = palette[index * 3];
                pixels[p * 4 + 1] = palette[index * 3 + 1];
                pixels[p * 4 + 2] = palette[index * 3 + 2];
            }
        }
        return;
    }
    const pattern = dither === 'atkinson' ? ATKINSON : FLOYD_STEINBERG;
    const rows = [new Float32Array(width * 3), new Float32Array(width * 3), new Float32Array(width * 3)];
    for (let y = 0; y < height; y++) {
        const direction = y & 1 ? -1 : 1;
        const current = rows[y % 3];
        for (let step = 0; step < width; step++) {
            const x = direction === 1 ? step : width - 1 - step;
            const p = y * width + x;
            if (!pixels[p * 4 + 3])
                continue;
            const e = x * 3;
            const r = clampFloat(pixels[p * 4] + current[e]);
            const g = clampFloat(pixels[p * 4 + 1] + current[e + 1]);
            const b = clampFloat(pixels[p * 4 + 2] + current[e + 2]);
            const index = nearest(r, g, b);
            const errors = [r - palette[index * 3], g - palette[index * 3 + 1], b - palette[index * 3 + 2]];
            pixels[p * 4] = palette[index * 3];
            pixels[p * 4 + 1] = palette[index * 3 + 1];
            pixels[p * 4 + 2] = palette[index * 3 + 2];
            for (const [dx, dy, weight] of pattern) {
                const tx = x + dx * direction, ty = y + dy;
                if (tx < 0 || tx >= width || ty >= height)
                    continue;
                const target = rows[ty % 3], t = tx * 3;
                for (let c = 0; c < 3; c++)
                    target[t + c] += errors[c] * weight * strength;
            }
        }
        current.fill(0);
    }
}
function medianCut(pixels, colors, iterations, include, minAlpha = 128) {
    const count = new Float64Array(32768);
    const sumR = new Float64Array(32768);
    const sumG = new Float64Array(32768);
    const sumB = new Float64Array(32768);
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < minAlpha)
            continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (include && !include(r, g, b))
            continue;
        const bin = (r >> 3) << 10 | (g >> 3) << 5 | b >> 3;
        count[bin]++;
        sumR[bin] += r;
        sumG[bin] += g;
        sumB[bin] += b;
    }
    let n = 0;
    for (let i = 0; i < 32768; i++)
        if (count[i])
            n++;
    const points = { c: [new Float64Array(n), new Float64Array(n), new Float64Array(n)], w: new Float64Array(n) };
    for (let i = 0, p = 0; i < 32768; i++) {
        if (!count[i])
            continue;
        points.c[0][p] = sumR[i] / count[i];
        points.c[1][p] = sumG[i] / count[i];
        points.c[2][p] = sumB[i] / count[i];
        points.w[p++] = count[i];
    }
    if (!n)
        return { palette: new Float64Array(0), weights: new Float64Array(0) };
    const boxes = [makeBox(points, Int32Array.from({ length: n }, (_, i) => i))];
    const scratch = new Int32Array(n);
    while (boxes.length < colors) {
        let target = -1;
        for (let i = 0; i < boxes.length; i++)
            if (boxes[i].members.length > 1 && (target === -1 || boxes[i].error > boxes[target].error))
                target = i;
        if (target === -1)
            break;
        const { members, axis, weight } = boxes[target];
        sortBy(members, points.c[axis], scratch);
        const half = weight / 2;
        let split = 1;
        for (let acc = 0; split < members.length - 1; split++) {
            acc += points.w[members[split - 1]];
            if (acc >= half)
                break;
        }
        boxes.splice(target, 1, makeBox(points, members.subarray(0, split)), makeBox(points, members.subarray(split)));
    }
    const palette = new Float64Array(boxes.length * 3);
    boxes.forEach((box, i) => palette.set(box.mean, i * 3));
    const entries = boxes.length;
    const [pr, pg, pb] = points.c, pw = points.w;
    const weights = Float64Array.from(boxes, box => box.weight);
    for (let iteration = 0; iteration < iterations; iteration++) {
        const acc = new Float64Array(entries * 4);
        const nearest = nearestSearch(palette, entries);
        for (let i = 0; i < n; i++) {
            const index = nearest(pr[i], pg[i], pb[i]);
            acc[index * 4] += pr[i] * pw[i];
            acc[index * 4 + 1] += pg[i] * pw[i];
            acc[index * 4 + 2] += pb[i] * pw[i];
            acc[index * 4 + 3] += pw[i];
        }
        for (let i = 0; i < entries; i++) {
            const w = weights[i] = acc[i * 4 + 3];
            if (!w)
                continue;
            palette[i * 3] = acc[i * 4] / w;
            palette[i * 3 + 1] = acc[i * 4 + 1] / w;
            palette[i * 3 + 2] = acc[i * 4 + 2] / w;
        }
    }
    return { palette, weights };
}
function makeBox({ c: [r, g, b], w }, members) {
    let weight = 0;
    const sum = [0, 0, 0];
    const sq = [0, 0, 0];
    for (let m = 0; m < members.length; m++) {
        const i = members[m];
        weight += w[i];
        sum[0] += r[i] * w[i];
        sq[0] += r[i] * r[i] * w[i];
        sum[1] += g[i] * w[i];
        sq[1] += g[i] * g[i] * w[i];
        sum[2] += b[i] * w[i];
        sq[2] += b[i] * b[i] * w[i];
    }
    const mean = sum.map(v => v / weight);
    const error = sq.map((v, k) => (v - sum[k] * mean[k]) * [WR, WG, WB][k]);
    const axis = error.indexOf(Math.max(...error));
    return { members, weight, mean, axis, error: error[0] + error[1] + error[2] };
}
function sortBy(indices, keys, scratch) {
    const n = indices.length;
    const RUN = 16;
    for (let start = 0; start < n; start += RUN) {
        const end = Math.min(n, start + RUN);
        for (let i = start + 1; i < end; i++) {
            const v = indices[i], key = keys[v];
            let j = i - 1;
            for (; j >= start && keys[indices[j]] > key; j--)
                indices[j + 1] = indices[j];
            indices[j + 1] = v;
        }
    }
    let src = indices, dst = scratch.subarray(0, n);
    for (let width = RUN; width < n; width *= 2) {
        for (let start = 0; start < n; start += 2 * width) {
            const mid = Math.min(n, start + width), end = Math.min(n, start + 2 * width);
            let i = start, j = mid, o = start;
            if (mid >= end || keys[src[mid - 1]] <= keys[src[mid]]) {
                dst.set(src.subarray(start, end), start);
                continue;
            }
            while (i < mid && j < end)
                dst[o++] = keys[src[j]] < keys[src[i]] ? src[j++] : src[i++];
            while (i < mid)
                dst[o++] = src[i++];
            while (j < end)
                dst[o++] = src[j++];
        }
        [src, dst] = [dst, src];
    }
    if (src !== indices)
        indices.set(src);
}
function nearestSearch(palette, entries) {
    const weights = [WR, WG, WB];
    let axis = 0, spread = -1;
    for (let k = 0; k < 3; k++) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < entries; i++) {
            min = Math.min(min, palette[i * 3 + k]);
            max = Math.max(max, palette[i * 3 + k]);
        }
        if ((max - min) * weights[k] > spread) {
            spread = (max - min) * weights[k];
            axis = k;
        }
    }
    const order = Int32Array.from({ length: entries }, (_, i) => i).sort((a, b) => palette[a * 3 + axis] - palette[b * 3 + axis]);
    const keys = Float64Array.from(order, i => palette[i * 3 + axis]);
    const weight = weights[axis];
    return (r, g, b) => {
        const key = axis === 0 ? r : axis === 1 ? g : b;
        let best = 0, bestDistance = Infinity;
        const test = (i) => {
            const dr = r - palette[i * 3], dg = g - palette[i * 3 + 1], db = b - palette[i * 3 + 2];
            const distance = WR * dr * dr + WG * dg * dg + WB * db * db;
            if (distance < bestDistance || (distance === bestDistance && i < best)) {
                bestDistance = distance;
                best = i;
            }
        };
        let lo = 0, hi = entries;
        while (lo < hi) {
            const mid = lo + hi >> 1;
            if (keys[mid] < key)
                lo = mid + 1;
            else
                hi = mid;
        }
        for (let up = lo, down = lo - 1; up < entries || down >= 0;) {
            if (up < entries) {
                const d = key - keys[up];
                if (weight * d * d > bestDistance)
                    up = entries;
                else
                    test(order[up++]);
            }
            if (down >= 0) {
                const d = key - keys[down];
                if (weight * d * d > bestDistance)
                    down = -1;
                else
                    test(order[down--]);
            }
        }
        return best;
    };
}
function createLookup(palette, entries) {
    const cache = new Int16Array(1 << 18).fill(-1);
    const nearest = nearestSearch(palette, entries);
    return (r, g, b) => {
        const key = (r >> 2) << 12 | (g >> 2) << 6 | b >> 2;
        let index = cache[key];
        if (index === -1)
            index = cache[key] = nearest(r, g, b);
        return index;
    };
}
function ditherMap(pixels, width, palette, entries) {
    const height = (pixels.length >> 2) / width;
    const lookup = createLookup(palette, entries);
    const indices = new Uint8Array(pixels.length >> 2);
    let current = new Float32Array((width + 2) * 3);
    let next = new Float32Array((width + 2) * 3);
    const strength = 0.85;
    for (let y = 0; y < height; y++) {
        const reverse = y & 1;
        for (let step = 0; step < width; step++) {
            const x = reverse ? width - 1 - step : step;
            const p = y * width + x;
            const e = (x + 1) * 3;
            if (pixels[p * 4 + 3] < 128)
                continue;
            const r = clamp(pixels[p * 4] + current[e] * strength);
            const g = clamp(pixels[p * 4 + 1] + current[e + 1] * strength);
            const b = clamp(pixels[p * 4 + 2] + current[e + 2] * strength);
            const index = indices[p] = lookup(r, g, b);
            const er = r - palette[index * 3];
            const eg = g - palette[index * 3 + 1];
            const eb = b - palette[index * 3 + 2];
            const forward = reverse ? -3 : 3;
            diffuse(current, next, e, forward, er);
            diffuse(current, next, e + 1, forward, eg);
            diffuse(current, next, e + 2, forward, eb);
        }
        [current, next] = [next, current];
        next.fill(0);
    }
    return indices;
}
function diffuse(current, next, i, forward, error) {
    current[i + forward] += error * 7 / 16;
    next[i - forward] += error * 3 / 16;
    next[i] += error * 5 / 16;
    next[i + forward] += error / 16;
}
function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
