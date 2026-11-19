import { parsePalette } from "./color.js";
import { multiply, invert } from "../util/matrix.js";
const MAX_DEPTH = 64;
const SAMPLES = 4;
const MAX_PIXELS = 1 << 20;
const around = (cx, cy, m) => multiply(multiply([1, 0, 0, 1, cx, cy], m), [1, 0, 0, 1, -cx, -cy]);
export function parsePaintGlyphs(font) {
    const colr = font.tables.COLR?.offset;
    if (colr === undefined || font.u16(colr) < 1)
        return null;
    const baseList = font.u32(colr + 14) ? colr + font.u32(colr + 14) : 0;
    if (!baseList)
        return null;
    const clipList = font.u32(colr + 22) ? colr + font.u32(colr + 22) : 0;
    const count = font.u32(baseList), clips = clipList ? font.u32(clipList + 1) : 0;
    return {
        paint: glyph => {
            for (let lo = 0, hi = count - 1; lo <= hi;) {
                const mid = lo + hi >> 1, record = baseList + 4 + mid * 6, id = font.u16(record);
                if (id < glyph)
                    lo = mid + 1;
                else if (id > glyph)
                    hi = mid - 1;
                else
                    return baseList + font.u32(record + 2);
            }
            return null;
        },
        clip: glyph => {
            for (let lo = 0, hi = clips - 1; lo <= hi;) {
                const mid = lo + hi >> 1, record = clipList + 5 + mid * 7;
                if (font.u16(record + 2) < glyph)
                    lo = mid + 1;
                else if (font.u16(record) > glyph)
                    hi = mid - 1;
                else {
                    const box = clipList + (font.u8(record + 4) << 16 | font.u16(record + 5));
                    return [font.i16(box + 1), font.i16(box + 3), font.i16(box + 5), font.i16(box + 7)];
                }
            }
            return null;
        }
    };
}
class Paints {
    font;
    layerList;
    palette;
    glyphs;
    constructor(font, glyphs) {
        this.font = font;
        this.glyphs = glyphs;
        const colr = font.tables.COLR.offset;
        this.layerList = font.u32(colr + 18) ? colr + font.u32(colr + 18) : 0;
        const cpal = font.tables.CPAL?.offset;
        this.palette = cpal === undefined ? () => null : parsePalette(font, cpal);
    }
    offset24(o) {
        return this.font.u8(o) << 16 | this.font.u16(o + 1);
    }
    child(paint, at = 1) {
        return paint + this.offset24(paint + at);
    }
    f2dot14(o) {
        return this.font.i16(o) / 16384;
    }
    layer(index) {
        return this.layerList + this.font.u32(this.layerList + 4 + index * 4);
    }
    transform(paint, format) {
        const font = this.font, p = paint;
        const f = (o) => this.f2dot14(p + o);
        const degrees = (o) => f(o) * Math.PI;
        switch (format) {
            case 12:
            case 13: {
                const t = this.child(p, 4), fixed = (k) => font.i32(t + k * 4) / 65536;
                return [fixed(0), fixed(1), fixed(2), fixed(3), fixed(4), fixed(5)];
            }
            case 14:
            case 15: return [1, 0, 0, 1, font.i16(p + 4), font.i16(p + 6)];
            case 16:
            case 17: return [f(4), 0, 0, f(6), 0, 0];
            case 18:
            case 19: return around(font.i16(p + 8), font.i16(p + 10), [f(4), 0, 0, f(6), 0, 0]);
            case 20:
            case 21: return [f(4), 0, 0, f(4), 0, 0];
            case 22:
            case 23: return around(font.i16(p + 6), font.i16(p + 8), [f(4), 0, 0, f(4), 0, 0]);
            case 24:
            case 25:
            case 26:
            case 27: {
                const a = degrees(4), cos = Math.cos(a), sin = Math.sin(a), m = [cos, sin, -sin, cos, 0, 0];
                return format >= 26 ? around(font.i16(p + 6), font.i16(p + 8), m) : m;
            }
            default: {
                const m = [1, Math.tan(degrees(6)), Math.tan(-degrees(4)), 1, 0, 0];
                return format >= 30 ? around(font.i16(p + 8), font.i16(p + 10), m) : m;
            }
        }
    }
    bounds(paint, m, outline, depth = 0) {
        if (depth > MAX_DEPTH)
            return null;
        const font = this.font, format = font.u8(paint);
        const union = (a, b) => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        switch (format) {
            case 1: {
                let box = null;
                const first = font.u32(paint + 2);
                for (let i = 0, n = font.u8(paint + 1); i < n; i++)
                    box = union(box, this.bounds(this.layer(first + i), m, outline, depth + 1));
                return box;
            }
            case 10: {
                let box = null;
                for (const command of outline(font.u16(paint + 4)))
                    for (let i = 1; i < command.length; i += 2) {
                        const x = command[i], y = command[i + 1];
                        const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
                        box = union(box, [px, py, px, py]);
                    }
                return box;
            }
            case 11: {
                const base = this.glyphs.paint(font.u16(paint + 1));
                return base === null ? null : this.bounds(base, m, outline, depth + 1);
            }
            case 32: return union(this.bounds(this.child(paint), m, outline, depth + 1), this.bounds(this.child(paint, 5), m, outline, depth + 1));
            default:
                if (format >= 12 && format <= 31)
                    return this.bounds(this.child(paint), multiply(m, this.transform(paint, format)), outline, depth + 1);
                return null;
        }
    }
}
const paintsOf = new WeakMap();
const paintsFor = (font, glyphs) => {
    let paints = paintsOf.get(glyphs);
    if (!paints)
        paintsOf.set(glyphs, paints = new Paints(font, glyphs));
    return paints;
};
export function paintExtent(font, glyphs, glyph, outline) {
    const clip = glyphs.clip(glyph);
    if (clip)
        return { left: clip[0], right: clip[2] };
    const root = glyphs.paint(glyph);
    const box = root === null ? null : paintsFor(font, glyphs).bounds(root, [1, 0, 0, 1, 0, 0], outline);
    return box && box[2] > box[0] ? { left: box[0], right: box[2] } : null;
}
export function renderPaintGlyph(font, glyphs, glyph, scale, offset, foreground, outline, rasterize) {
    const root = glyphs.paint(glyph);
    if (root === null)
        return null;
    const p = paintsFor(font, glyphs);
    const base = [scale, 0, 0, scale, offset, 0];
    const clip = glyphs.clip(glyph);
    const box = clip ? [clip[0] * scale + offset, clip[1] * scale, clip[2] * scale + offset, clip[3] * scale] : p.bounds(root, base, outline);
    if (!box)
        return null;
    const em = font.unitsPerEm * scale;
    const left = Math.floor(Math.max(box[0], -2 * em)), top = Math.ceil(Math.min(box[3], 3 * em));
    const width = Math.ceil(Math.min(box[2], 3 * em)) - left, height = top - Math.floor(Math.max(box[1], -3 * em));
    if (!(width > 0 && height > 0) || width * height > MAX_PIXELS)
        return null;
    const S = Math.max(1, Math.min(SAMPLES, Math.floor(Math.sqrt(MAX_PIXELS / (width * height)))));
    const canvas = { left: left * S, top: top * S, width: width * S, height: height * S };
    const layer = render(p, root, [scale * S, 0, 0, scale * S, offset * S, 0], canvas, [0, 0, canvas.width, canvas.height], foreground, outline, rasterize, 0);
    const sum = new Float32Array(width * height * 4);
    if (layer) {
        const [x0, y0, x1, y1] = layer.box, stride = x1 - x0;
        for (let y = y0; y < y1; y++)
            for (let x = x0, i = (y - y0) * stride * 4; x < x1; x++, i += 4) {
                const o = ((y / S | 0) * width + (x / S | 0)) * 4;
                sum[o] += layer.data[i];
                sum[o + 1] += layer.data[i + 1];
                sum[o + 2] += layer.data[i + 2];
                sum[o + 3] += layer.data[i + 3];
            }
    }
    const data = new Uint8ClampedArray(width * height * 4), share = 255 / (S * S);
    for (let i = 0; i < data.length; i++)
        data[i] = sum[i] * share;
    return { data, width, height, left, top };
}
const blank = (box) => ({ data: new Float32Array((box[2] - box[0]) * (box[3] - box[1]) * 4), box });
const unionBox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const empty = (box) => box[0] >= box[2] || box[1] >= box[3];
function render(p, paint, m, canvas, region, foreground, outline, rasterize, depth) {
    if (depth > MAX_DEPTH || empty(region))
        return null;
    const font = p.font, format = font.u8(paint);
    const next = (child, matrix, r) => render(p, child, matrix, canvas, r, foreground, outline, rasterize, depth + 1);
    switch (format) {
        case 1: {
            let out = null;
            const first = font.u32(paint + 2);
            for (let i = 0, n = font.u8(paint + 1); i < n; i++) {
                const layer = next(p.layer(first + i), m, region);
                if (layer)
                    out = out ? composite(3, layer, out) : layer;
            }
            return out;
        }
        case 2:
        case 3: {
            const color = colorOf(p, font.u16(paint + 1), p.f2dot14(paint + 3), foreground);
            const out = blank(region);
            for (let o = 0; o < out.data.length; o += 4)
                out.data.set(color, o);
            return out;
        }
        case 4:
        case 5:
        case 6:
        case 7:
        case 8:
        case 9:
            return gradient(p, paint, format, m, canvas, region, foreground);
        case 10: {
            const path = outline(font.u16(paint + 4)).map(command => transformCommand(command, m));
            const mask = rasterize(path, { left: canvas.left + region[0], right: canvas.left + region[2], top: canvas.top - region[1], bottom: canvas.top - region[3] });
            if (!mask)
                return null;
            const mx = mask.left - canvas.left, my = canvas.top - mask.top;
            const inner = [Math.max(region[0], mx), Math.max(region[1], my), Math.min(region[2], mx + mask.width), Math.min(region[3], my + mask.height)];
            if (empty(inner))
                return null;
            const child = p.child(paint), childFormat = font.u8(child);
            const solid = childFormat === 2 || childFormat === 3 ? colorOf(p, font.u16(child + 1), p.f2dot14(child + 3), foreground) : null;
            const layer = solid ? blank(inner) : next(child, m, inner);
            if (!layer)
                return null;
            const [x0, y0, x1, y1] = layer.box, data = layer.data;
            for (let y = y0, o = 0; y < y1; y++)
                for (let x = x0, k = (y - my) * mask.width + x0 - mx; x < x1; x++, k++, o += 4) {
                    const c = mask.data[k] / 255;
                    if (solid) {
                        data[o] = solid[0] * c;
                        data[o + 1] = solid[1] * c;
                        data[o + 2] = solid[2] * c;
                        data[o + 3] = solid[3] * c;
                    }
                    else {
                        data[o] *= c;
                        data[o + 1] *= c;
                        data[o + 2] *= c;
                        data[o + 3] *= c;
                    }
                }
            return layer;
        }
        case 11: {
            const base = p.glyphs.paint(font.u16(paint + 1));
            return base === null ? null : next(base, m, region);
        }
        case 32: {
            const backdrop = next(p.child(paint, 5), m, region);
            const source = next(p.child(paint), m, region);
            if (!backdrop && !source)
                return null;
            const box = (backdrop ?? source).box;
            return composite(font.u8(paint + 4), source ?? blank(box), backdrop ?? blank(box));
        }
        default:
            if (format >= 12 && format <= 31)
                return next(p.child(paint), multiply(m, p.transform(paint, format)), region);
            return null;
    }
}
function transformCommand(command, m) {
    const out = [command[0]];
    for (let i = 1; i < command.length; i += 2) {
        const x = command[i], y = command[i + 1];
        out.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    }
    return out;
}
function colorOf(p, index, alpha, foreground) {
    const rgba = p.palette(index) ?? foreground;
    const a = (rgba & 255) / 255 * Math.min(1, Math.max(0, alpha));
    return [(rgba >>> 24) / 255 * a, (rgba >>> 16 & 255) / 255 * a, (rgba >>> 8 & 255) / 255 * a, a];
}
const LUT = 256;
function gradient(p, paint, format, m, canvas, region, foreground) {
    const font = p.font, inverse = invert(m);
    if (!inverse)
        return null;
    const line = p.child(paint), extend = font.u8(line), count = font.u16(line + 1), stride = format & 1 ? 10 : 6;
    if (!count)
        return null;
    const stops = Array.from({ length: count }, (_, i) => {
        const o = line + 3 + i * stride;
        return { offset: p.f2dot14(o), color: colorOf(p, font.u16(o + 2), p.f2dot14(o + 4), foreground) };
    }).sort((a, b) => a.offset - b.offset);
    const start = stops[0].offset, end = stops[stops.length - 1].offset, span = end - start;
    const table = new Float32Array(LUT * 4);
    for (let i = 0; i < LUT; i++) {
        const t = start + span * i / (LUT - 1);
        let k = 0;
        while (k < stops.length - 2 && stops[k + 1].offset < t)
            k++;
        const a = stops[k], b = stops[Math.min(k + 1, stops.length - 1)];
        const f = b.offset > a.offset ? Math.min(1, Math.max(0, (t - a.offset) / (b.offset - a.offset))) : t >= b.offset ? 1 : 0;
        for (let c = 0; c < 4; c++)
            table[i * 4 + c] = a.color[c] + (b.color[c] - a.color[c]) * f;
    }
    const x0 = font.i16(paint + 4), y0 = font.i16(paint + 6);
    let position;
    if (format <= 5) {
        let dx = font.i16(paint + 8) - x0, dy = font.i16(paint + 10) - y0;
        const nx = font.i16(paint + 12) - x0, ny = font.i16(paint + 14) - y0, perp = nx * nx + ny * ny;
        if (perp) {
            const k = (dx * -ny + dy * nx) / perp;
            dx = -ny * k;
            dy = nx * k;
        }
        const length = dx * dx + dy * dy;
        if (!length)
            return null;
        position = (x, y) => ((x - x0) * dx + (y - y0) * dy) / length;
    }
    else if (format <= 7) {
        const r0 = font.u16(paint + 8), cx = font.i16(paint + 10) - x0, cy = font.i16(paint + 12) - y0, dr = font.u16(paint + 14) - r0;
        const a = cx * cx + cy * cy - dr * dr;
        position = (x, y) => {
            const px = x - x0, py = y - y0;
            const b = px * cx + py * cy + r0 * dr, c = px * px + py * py - r0 * r0;
            if (Math.abs(a) < 1e-9) {
                const t = c / (2 * b);
                return b && r0 + t * dr >= 0 ? t : NaN;
            }
            const discriminant = b * b - a * c;
            if (discriminant < 0)
                return NaN;
            const root = Math.sqrt(discriminant), t1 = (b + root) / a, t2 = (b - root) / a;
            const high = Math.max(t1, t2), low = Math.min(t1, t2);
            return r0 + high * dr >= 0 ? high : r0 + low * dr >= 0 ? low : NaN;
        };
    }
    else {
        const startAngle = (p.f2dot14(paint + 8) + 1) * 180, endAngle = (p.f2dot14(paint + 10) + 1) * 180;
        position = (x, y) => {
            let angle = Math.atan2(y - y0, x - x0) * 180 / Math.PI;
            if (angle < 0)
                angle += 360;
            return endAngle === startAngle ? (angle >= startAngle ? 1 : 0) : (angle - startAngle) / (endAngle - startAngle);
        };
    }
    const out = blank(region), data = out.data;
    for (let py = region[1], o = 0; py < region[3]; py++)
        for (let px = region[0]; px < region[2]; px++, o += 4) {
            const x = canvas.left + px + 0.5, y = canvas.top - py - 0.5;
            const t = position(inverse[0] * x + inverse[2] * y + inverse[4], inverse[1] * x + inverse[3] * y + inverse[5]);
            if (t !== t)
                continue;
            let u = span > 0 ? (t - start) / span : t >= start ? 1 : 0;
            if (extend === 1)
                u -= Math.floor(u);
            else if (extend === 2) {
                u = Math.abs(u) % 2;
                if (u > 1)
                    u = 2 - u;
            }
            const i = Math.round(Math.min(1, Math.max(0, u)) * (LUT - 1)) * 4;
            data[o] = table[i];
            data[o + 1] = table[i + 1];
            data[o + 2] = table[i + 2];
            data[o + 3] = table[i + 3];
        }
    return out;
}
const softLight = (b, s) => {
    if (s <= 0.5)
        return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
};
const hardLight = (b, s) => s <= 0.5 ? b * 2 * s : 1 - (1 - b) * (1 - (2 * s - 1));
const BLEND = {
    13: (b, s) => b + s - b * s,
    14: (b, s) => hardLight(s, b),
    15: Math.min,
    16: Math.max,
    17: (b, s) => b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)),
    18: (b, s) => b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s),
    19: hardLight,
    20: softLight,
    21: (b, s) => Math.abs(b - s),
    22: (b, s) => b + s - 2 * b * s,
    23: (b, s) => b * s
};
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const clipColor = (c) => {
    const l = lum(c), n = Math.min(...c), x = Math.max(...c);
    return c.map(v => n < 0 ? l + (v - l) * l / (l - n) : x > 1 ? l + (v - l) * (1 - l) / (x - l) : v);
};
const setLum = (c, l) => clipColor(c.map(v => v + l - lum(c)));
const sat = (c) => Math.max(...c) - Math.min(...c);
const setSat = (c, s) => {
    const max = Math.max(...c), min = Math.min(...c);
    return c.map(v => max > min ? (v - min) * s / (max - min) : 0);
};
const NON_SEPARABLE = {
    24: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
    25: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
    26: (b, s) => setLum(s, lum(b)),
    27: (b, s) => setLum(b, lum(s))
};
function composite(mode, source, backdrop) {
    const box = unionBox(source.box, backdrop.box);
    let out = backdrop;
    if (box[0] < backdrop.box[0] || box[1] < backdrop.box[1] || box[2] > backdrop.box[2] || box[3] > backdrop.box[3]) {
        out = blank(box);
        const [x0, y0, x1] = backdrop.box, w = x1 - x0, ow = box[2] - box[0];
        for (let y = y0; y < backdrop.box[3]; y++)
            out.data.set(backdrop.data.subarray((y - y0) * w * 4, (y - y0 + 1) * w * 4), ((y - box[1]) * ow + x0 - box[0]) * 4);
    }
    const d = out.data, s = source.data, ow = box[2] - box[0];
    const [sx0, sy0, sx1, sy1] = source.box, sw = sx1 - sx0;
    if (mode === 3) {
        for (let y = sy0; y < sy1; y++)
            for (let x = sx0, i = (y - sy0) * sw * 4, o = ((y - box[1]) * ow + sx0 - box[0]) * 4; x < sx1; x++, i += 4, o += 4) {
                const keep = 1 - s[i + 3];
                if (keep === 1)
                    continue;
                d[o] = s[i] + d[o] * keep;
                d[o + 1] = s[i + 1] + d[o + 1] * keep;
                d[o + 2] = s[i + 2] + d[o + 2] * keep;
                d[o + 3] = s[i + 3] + d[o + 3] * keep;
            }
        return out;
    }
    const blend = BLEND[mode], nonSeparable = NON_SEPARABLE[mode];
    const src = new Float32Array(4);
    for (let y = box[1]; y < box[3]; y++)
        for (let x = box[0], o = (y - box[1]) * ow * 4; x < box[2]; x++, o += 4) {
            if (x >= sx0 && x < sx1 && y >= sy0 && y < sy1)
                src.set(s.subarray(((y - sy0) * sw + x - sx0) * 4, ((y - sy0) * sw + x - sx0) * 4 + 4));
            else
                src.fill(0);
            const as = src[3], ab = d[o + 3];
            let fa = 0, fb = 0;
            switch (mode) {
                case 0:
                    fa = 0;
                    fb = 0;
                    break;
                case 1:
                    fa = 1;
                    fb = 0;
                    break;
                case 2:
                    fa = 0;
                    fb = 1;
                    break;
                case 4:
                    fa = 1 - ab;
                    fb = 1;
                    break;
                case 5:
                    fa = ab;
                    fb = 0;
                    break;
                case 6:
                    fa = 0;
                    fb = as;
                    break;
                case 7:
                    fa = 1 - ab;
                    fb = 0;
                    break;
                case 8:
                    fa = 0;
                    fb = 1 - as;
                    break;
                case 9:
                    fa = ab;
                    fb = 1 - as;
                    break;
                case 10:
                    fa = 1 - ab;
                    fb = as;
                    break;
                case 11:
                    fa = 1 - ab;
                    fb = 1 - as;
                    break;
                case 12:
                    fa = 1;
                    fb = 1;
                    break;
                default: {
                    if (!blend && !nonSeparable || !as || !ab) {
                        fa = 1;
                        fb = 1 - as;
                        break;
                    }
                    const sc = [src[0] / as, src[1] / as, src[2] / as], b = [d[o] / ab, d[o + 1] / ab, d[o + 2] / ab];
                    const mixed = nonSeparable ? nonSeparable(b, sc) : [blend(b[0], sc[0]), blend(b[1], sc[1]), blend(b[2], sc[2])];
                    for (let c = 0; c < 3; c++)
                        d[o + c] = src[c] * (1 - ab) + d[o + c] * (1 - as) + as * ab * mixed[c];
                    d[o + 3] = as + ab - as * ab;
                    continue;
                }
            }
            for (let c = 0; c < 4; c++)
                d[o + c] = Math.min(1, src[c] * fa + d[o + c] * fb);
        }
    return out;
}
