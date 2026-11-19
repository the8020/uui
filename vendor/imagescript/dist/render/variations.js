const fixed = (r, o) => r.i32(o) / 65536;
const f2dot14 = (r, o) => r.i16(o) / 16384;
export function parseFvar(r, fvar) {
    const axesOffset = r.u16(fvar + 4), count = r.u16(fvar + 8), size = r.u16(fvar + 10);
    const axes = [];
    for (let i = 0; i < count; i++) {
        const o = fvar + axesOffset + i * size;
        const tag = String.fromCharCode(r.u8(o), r.u8(o + 1), r.u8(o + 2), r.u8(o + 3));
        const min = fixed(r, o + 4), def = fixed(r, o + 8), max = fixed(r, o + 12);
        axes.push({ tag, min: Math.min(min, def), default: def, max: Math.max(max, def) });
    }
    return axes;
}
export function parseAvar(r, avar, axisCount) {
    if (r.u16(avar) !== 1 || r.u16(avar + 6) !== axisCount)
        return null;
    const maps = [];
    let o = avar + 8;
    for (let a = 0; a < axisCount; a++) {
        const count = r.u16(o), map = [];
        for (let i = 0; i < count; i++)
            map.push(f2dot14(r, o + 2 + i * 4), f2dot14(r, o + 4 + i * 4));
        maps.push(map);
        o += 2 + count * 4;
    }
    return maps;
}
export function normalize(axes, avar, values) {
    return axes.map((axis, a) => {
        const v = Math.min(Math.max(values[axis.tag] ?? axis.default, axis.min), axis.max);
        let n = v < axis.default ? (v - axis.default) / (axis.default - axis.min) : v > axis.default ? (v - axis.default) / (axis.max - axis.default) : 0;
        const map = avar?.[a];
        if (map && map.length >= 6) {
            for (let i = 2; i < map.length; i += 2) {
                if (n > map[i])
                    continue;
                const [x0, y0, x1, y1] = [map[i - 2], map[i - 1], map[i], map[i + 1]];
                n = x1 === x0 ? y1 : y0 + (n - x0) * (y1 - y0) / (x1 - x0);
                break;
            }
        }
        return Math.round(n * 16384) / 16384;
    });
}
export function scalar(coords, peak, start, end) {
    let s = 1;
    for (let a = 0; a < peak.length; a++) {
        const p = peak[a];
        if (p === 0)
            continue;
        const v = coords[a] ?? 0, lo = start ? start[a] : Math.min(p, 0), hi = end ? end[a] : Math.max(p, 0);
        if (start && end && (lo > p || p > hi || lo < 0 && hi > 0))
            continue;
        if (v === p)
            continue;
        if (v <= lo || v >= hi)
            return 0;
        s *= v < p ? (v - lo) / (p - lo) : (hi - v) / (hi - p);
    }
    return s;
}
export class ItemVariationStore {
    r;
    regions = [];
    data = [];
    scalars = null;
    scalarsFor = null;
    constructor(r, store) {
        this.r = r;
        const regionList = store + r.u32(store + 2), count = r.u16(store + 6);
        const axisCount = r.u16(regionList), regionCount = r.u16(regionList + 2);
        for (let i = 0; i < regionCount; i++) {
            const region = { peak: [], start: [], end: [] };
            for (let a = 0; a < axisCount; a++) {
                const o = regionList + 4 + (i * axisCount + a) * 6;
                region.start.push(f2dot14(r, o));
                region.peak.push(f2dot14(r, o + 2));
                region.end.push(f2dot14(r, o + 4));
            }
            this.regions.push(region);
        }
        for (let i = 0; i < count; i++) {
            const o = store + r.u32(store + 8 + i * 4);
            const words = r.u16(o + 2), regionIndexCount = r.u16(o + 4), regions = [];
            for (let k = 0; k < regionIndexCount; k++)
                regions.push(r.u16(o + 6 + k * 2));
            this.data.push({ itemCount: r.u16(o), wordCount: words & 0x7fff, long: (words & 0x8000) !== 0, regions, offset: o + 6 + regionIndexCount * 2 });
        }
    }
    delta(coords, outer, inner) {
        const d = this.data[outer];
        if (!d || inner >= d.itemCount)
            return 0;
        if (this.scalarsFor !== coords) {
            this.scalars = Float64Array.from(this.regions, region => scalar(coords, region.peak, region.start, region.end));
            this.scalarsFor = coords;
        }
        const scalars = this.scalars, r = this.r;
        const big = d.long ? 4 : 2, small = d.long ? 2 : 1;
        let o = d.offset + inner * (d.wordCount * big + (d.regions.length - d.wordCount) * small), delta = 0;
        for (let k = 0; k < d.regions.length; k++) {
            const s = scalars[d.regions[k]] ?? 0;
            let v;
            if (k < d.wordCount) {
                v = d.long ? r.i32(o) : r.i16(o);
                o += big;
            }
            else {
                v = d.long ? r.i16(o) : r.i8(o);
                o += small;
            }
            if (s)
                delta += s * v;
        }
        return delta;
    }
}
export function deltaSetIndexMap(r, map) {
    const format = r.u8(map), entryFormat = r.u8(map + 1);
    const count = format === 0 ? r.u16(map + 2) : r.u32(map + 2), start = map + (format === 0 ? 4 : 6);
    const size = (entryFormat >> 4 & 3) + 1, innerBits = (entryFormat & 15) + 1;
    return index => {
        if (!count)
            return [0, index];
        const i = Math.min(index, count - 1);
        let v = 0;
        for (let k = 0; k < size; k++)
            v = v * 256 + r.u8(start + i * size + k);
        return [Math.floor(v / 2 ** innerBits), v % 2 ** innerBits];
    };
}
function readPoints(r, o) {
    let count = r.u8(o++);
    if (count & 0x80)
        count = (count & 0x7f) << 8 | r.u8(o++);
    if (!count)
        return [null, o];
    const points = [];
    let point = 0;
    while (points.length < count) {
        const control = r.u8(o++), words = control & 0x80, run = (control & 0x7f) + 1;
        for (let i = 0; i < run && points.length < count; i++) {
            point += words ? r.u16(o) : r.u8(o);
            o += words ? 2 : 1;
            points.push(point);
        }
    }
    return [points, o];
}
function readDeltas(r, o, n) {
    const deltas = new Int32Array(n);
    for (let i = 0; i < n;) {
        const control = r.u8(o++), run = (control & 0x3f) + 1;
        for (let k = 0; k < run && i < n; k++, i++) {
            if (control & 0x80)
                deltas[i] = 0;
            else if (control & 0x40) {
                deltas[i] = r.i16(o);
                o += 2;
            }
            else
                deltas[i] = r.i8(o++);
        }
    }
    return [deltas, o];
}
function readTuples(r, base, header, axisCount, sharedTuples) {
    const countField = r.u16(header), count = countField & 0xfff, dataOffset = r.u16(header + 2);
    let h = header + 4, data = base + dataOffset;
    let shared = null;
    if (countField & 0x8000)
        [shared, data] = readPoints(r, data);
    const tuples = [];
    for (let i = 0; i < count; i++) {
        const size = r.u16(h), index = r.u16(h + 2);
        h += 4;
        let peak;
        if (index & 0x8000) {
            peak = Array.from({ length: axisCount }, (_, a) => f2dot14(r, h + a * 2));
            h += axisCount * 2;
        }
        else
            peak = sharedTuples[index & 0xfff] ?? new Array(axisCount).fill(0);
        let start = null, end = null;
        if (index & 0x4000) {
            start = Array.from({ length: axisCount }, (_, a) => f2dot14(r, h + a * 2));
            end = Array.from({ length: axisCount }, (_, a) => f2dot14(r, h + axisCount * 2 + a * 2));
            h += axisCount * 4;
        }
        let points = shared, d = data;
        if (index & 0x2000)
            [points, d] = readPoints(r, data);
        tuples.push({ peak, start, end, points, data: d, size: size - (d - data) });
        data += size;
    }
    return tuples;
}
export class Gvar {
    r;
    axisCount;
    sharedTuples = [];
    glyphCount;
    long;
    offsets;
    dataStart;
    constructor(r, gvar) {
        this.r = r;
        this.axisCount = r.u16(gvar + 4);
        const sharedCount = r.u16(gvar + 6), shared = gvar + r.u32(gvar + 8);
        for (let i = 0; i < sharedCount; i++)
            this.sharedTuples.push(Array.from({ length: this.axisCount }, (_, a) => f2dot14(r, shared + (i * this.axisCount + a) * 2)));
        this.glyphCount = r.u16(gvar + 12);
        this.long = (r.u16(gvar + 14) & 1) !== 0;
        this.dataStart = gvar + r.u32(gvar + 16);
        this.offsets = gvar + 20;
    }
    deltas(glyph, coords, n, ends, xs, ys) {
        if (glyph >= this.glyphCount || coords.every(c => c === 0))
            return null;
        const r = this.r;
        const offset = (i) => this.long ? r.u32(this.offsets + i * 4) : r.u16(this.offsets + i * 2) * 2;
        const start = offset(glyph), end = offset(glyph + 1);
        if (end <= start)
            return null;
        const base = this.dataStart + start;
        const out = new Float64Array(2 * n);
        let any = false;
        for (const t of readTuples(r, base, base, this.axisCount, this.sharedTuples)) {
            const s = scalar(coords, t.peak, t.start, t.end);
            if (!s)
                continue;
            const count = t.points ? t.points.length : n;
            const [dx, after] = readDeltas(r, t.data, count), [dy] = readDeltas(r, after, count);
            any = true;
            if (!t.points) {
                for (let i = 0; i < n; i++) {
                    out[2 * i] += s * dx[i];
                    out[2 * i + 1] += s * dy[i];
                }
                continue;
            }
            const tx = new Float64Array(n), ty = new Float64Array(n), touched = new Uint8Array(n);
            t.points.forEach((p, k) => {
                if (p >= n)
                    return;
                tx[p] = dx[k];
                ty[p] = dy[k];
                touched[p] = 1;
            });
            if (ends)
                interpolateUntouched(tx, ty, touched, ends, xs, ys);
            for (let i = 0; i < n; i++) {
                out[2 * i] += s * tx[i];
                out[2 * i + 1] += s * ty[i];
            }
        }
        return any ? out : null;
    }
}
function interpolateUntouched(dx, dy, touched, ends, xs, ys) {
    let first = 0;
    for (const last of ends) {
        let firstTouched = -1;
        for (let i = first; i <= last; i++)
            if (touched[i]) {
                firstTouched = i;
                break;
            }
        if (firstTouched >= 0) {
            for (const [d, c] of [[dx, xs], [dy, ys]]) {
                let prev = firstTouched;
                for (let k = 1; k <= last - first + 1; k++) {
                    const i = first + (firstTouched - first + k) % (last - first + 1);
                    if (!touched[i])
                        continue;
                    infer(d, c, prev, i, first, last);
                    prev = i;
                }
            }
        }
        first = last + 1;
    }
}
function infer(d, c, a, b, first, last) {
    const ca = c[a], cb = c[b], da = d[a], db = d[b];
    const lo = Math.min(ca, cb), hi = Math.max(ca, cb), dlo = ca <= cb ? da : db, dhi = ca <= cb ? db : da;
    for (let i = a === last ? first : a + 1; i !== b; i = i === last ? first : i + 1) {
        const v = c[i];
        d[i] = lo === hi ? (da === db ? da : 0) : v <= lo ? dlo : v >= hi ? dhi : dlo + (v - lo) * (dhi - dlo) / (hi - lo);
    }
}
export function cvarDeltas(r, cvar, axisCount, coords, count) {
    if (coords.every(c => c === 0))
        return null;
    const out = new Float64Array(count);
    let any = false;
    for (const t of readTuples(r, cvar, cvar + 4, axisCount, [])) {
        const s = scalar(coords, t.peak, t.start, t.end);
        if (!s)
            continue;
        const points = t.points ?? Array.from({ length: count }, (_, i) => i);
        const [deltas] = readDeltas(r, t.data, points.length);
        points.forEach((p, k) => {
            if (p < count)
                out[p] += s * deltas[k];
        });
        any = true;
    }
    return any ? out : null;
}
