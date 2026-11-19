/*!
 * The Rasterizer class is translated from font-rs (https://github.com/raphlinus/font-rs)
 * Copyright 2015 Google Inc., Apache License 2.0 (see THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt)
 */
import { Font } from "./font.js";
import { Hinter } from "./hinting.js";
import { parseColorLayers, parseBitmaps } from "./color.js";
import { shapeFont, shapeRun, isDefaultIgnorableCodepoint } from "./shape.js";
import "./shapers/index.js";
import { classOf, resolve, lineLevels } from "./bidi.js";
import { lineBreaks } from "./linebreak.js";
import { graphemeBoundaries, scripts } from "./segment.js";
import { parsePaintGlyphs, paintExtent, renderPaintGlyph } from "./colr.js";
import { decode as decodePNG } from "../codecs/png.js";
import { resample, TRIANGLE } from "../util/resample.js";
const SUBPIXELS = 4;
const MAX_GLYPH_PIXELS = 1 << 26;
const fonts = new WeakMap();
const hinters = new WeakMap();
const colorTables = new WeakMap();
const sizes = new WeakMap();
const SIZES = 16;
export function loadFont(data) {
    let regions = fonts.get(data.buffer);
    if (!regions)
        fonts.set(data.buffer, regions = new Map());
    const key = `${data.byteOffset}:${data.byteLength}`;
    let font = regions.get(key);
    if (!font)
        regions.set(key, font = new Font(data));
    return font;
}
const AXES = { weight: 'wght', width: 'wdth', slant: 'slnt', italic: 'ital', opticalSize: 'opsz' };
export function axisValues(variations) {
    const values = {};
    for (const [key, value] of Object.entries(variations)) {
        const tag = AXES[key] ?? (key.length === 4 ? key : null);
        if (!tag)
            throw new RangeError(`Unknown font variation ${key}: use weight, width, slant, italic, opticalSize or an axis tag`);
        const v = typeof value === 'boolean' ? +value : value;
        if (typeof v !== 'number' || !Number.isFinite(v))
            throw new RangeError(`Invalid font variation ${key}: ${String(value)}`);
        values[tag] = v;
    }
    return values;
}
function sizedFont(data, size, hinting, variations) {
    const font = loadFont(data).withVariations({ opsz: size, ...variations });
    let bySize = sizes.get(font);
    if (!bySize)
        sizes.set(font, bySize = new Map());
    const key = `${size}:${hinting}`;
    let sized = bySize.get(key);
    if (sized)
        return sized;
    let hinter = null;
    if (hinting && font.outlines === 'glyf') {
        hinter = hinters.get(font) ?? null;
        if (!hinter)
            hinters.set(font, hinter = new Hinter(font));
        if (!hinter.hasInstructions)
            hinter = null;
    }
    let shared = colorTables.get(font);
    if (!shared)
        colorTables.set(font, shared = { layers: parseColorLayers(font), paints: parsePaintGlyphs(font) });
    if (bySize.size >= SIZES)
        bySize.clear();
    bySize.set(key, sized = { font, scale: size / font.unitsPerEm, hinter, layers: shared.layers, bitmaps: parseBitmaps(font, size), paints: shared.paints, shaping: shapeFont(font), glyphs: new Map() });
    return sized;
}
function glyphOf(f, index, size) {
    let g = f.glyphs.get(index);
    if (g)
        return g;
    const { font, scale, hinter } = f;
    const paint = f.paints !== null && f.paints.paint(index) !== null;
    const bitmap = paint ? null : f.bitmaps?.(index) ?? null, layers = paint || bitmap ? null : f.layers?.(index) ?? null;
    const advance = font.advance(index) * scale;
    g = { index, font: f, path: [], scale, advance: hinter ? Math.round(advance) : advance, ink: null, bitmaps: [], color: null, colors: new Map() };
    if (paint) {
        g.color = { paint: true };
        const extent = paintExtent(font, f.paints, index, glyph => font.outline(glyph));
        g.ink = extent && { left: extent.left * scale, right: extent.right * scale };
    }
    else if (bitmap) {
        const s = size / bitmap.ppem;
        g.color = { bitmap };
        g.ink = { left: bitmap.left * s, right: (bitmap.left + bitmap.width) * s };
    }
    else if (layers) {
        g.color = { layers };
        g.ink = inkExtent(layers.flatMap(layer => font.outline(layer.glyph)), scale);
    }
    else {
        const hinted = hinter && hinter.glyph(index, size);
        if (hinted)
            Object.assign(g, { path: hinted.path, scale: 1, advance: hinted.advance, ink: inkExtent(hinted.path, 1) });
        else {
            g.path = font.outline(index);
            g.ink = inkExtent(g.path, scale);
        }
    }
    f.glyphs.set(index, g);
    return g;
}
export async function render(fonts, size, text, layout, hinting = false, foreground = 0xffffffff, features = [], variations = {}) {
    try {
        return await layOut(fonts, size, text, layout, hinting, foreground, features, variations);
    }
    catch (err) {
        if (err instanceof RangeError && !(err instanceof TooLarge))
            throw new Error('Font: damaged or truncated font data', { cause: err });
        throw err;
    }
}
const MAX_PIXELS = 1 << 28;
class TooLarge extends RangeError {
}
async function layOut(fonts, size, text, layout, hinting, foreground, features, variations) {
    const sized = [];
    const font = (i) => sized[i] ??= sizedFont(fonts[i], size, hinting, variations);
    const primary = font(0);
    const ascent = Math.ceil(primary.font.ascender * primary.scale);
    const lineHeight = Math.max(1, Math.ceil((primary.font.ascender - primary.font.descender + primary.font.lineGap) * primary.scale));
    const paragraphs = layout.wrapHardBreaks ? text.split(/\r\n|[\r\n\u0085\u2028\u2029]/) : [text.replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, '')];
    const lines = [];
    for (const paragraph of paragraphs)
        lines.push(...layOutParagraph(analyze(paragraph, fonts.length, font), layout, font, size, features));
    let visible = lines;
    if (isFinite(layout.maxHeight)) {
        const count = Math.max(1, Math.floor(layout.maxHeight / lineHeight));
        if (count < lines.length) {
            const start = layout.verticalAlign === 'bottom' ? lines.length - count
                : layout.verticalAlign === 'middle' ? lines.length - count >> 1 : 0;
            visible = lines.slice(start, start + count);
        }
    }
    const width = Math.max(1, Math.ceil(Math.max(0, ...visible.map(line => line.extent))));
    const height = visible.length * lineHeight;
    if (!(width * height <= MAX_PIXELS))
        throw new TooLarge(`Text too large to render (${width}x${height} pixels)`);
    const coverage = new Uint8Array(width * height);
    let color = null;
    for (const [n, line] of visible.entries()) {
        let offset = layout.horizontalAlign === 'right' ? width - line.extent
            : layout.horizontalAlign === 'center' ? (width - line.extent) / 2 : 0;
        if (primary.hinter)
            offset = Math.round(offset);
        const baseline = ascent + n * lineHeight;
        for (const { x, dx, dy, glyph: g } of line.glyphs) {
            if (!g.ink)
                continue;
            const position = g.font.hinter ? Math.round(offset + x + dx) : Math.round((offset + x + dx) * SUBPIXELS) / SUBPIXELS;
            const y = baseline - Math.round(dy);
            const pixel = Math.floor(position);
            let subpixel = Math.round((position - pixel) * SUBPIXELS);
            if (g.color) {
                if ('bitmap' in g.color)
                    subpixel = 0;
                const key = 'bitmap' in g.color ? '0' : `${subpixel}:${foreground}`;
                let bitmap = g.colors.get(key);
                if (bitmap === undefined)
                    g.colors.set(key, bitmap = 'bitmap' in g.color
                        ? await scaledBitmap(g.color.bitmap, size / g.color.bitmap.ppem)
                        : 'layers' in g.color ? layeredGlyph(g, g.color.layers, subpixel / SUBPIXELS, foreground)
                            : paintedGlyph(g, subpixel / SUBPIXELS, foreground));
                if (bitmap)
                    blitColor(color ??= new Uint8ClampedArray(width * height * 4), width, height, bitmap, pixel + bitmap.left, y - bitmap.top);
                continue;
            }
            if (g.bitmaps[subpixel] === undefined)
                g.bitmaps[subpixel] = rasterizeGlyph(g.path, g.scale, subpixel / SUBPIXELS);
            const bitmap = g.bitmaps[subpixel];
            if (bitmap)
                blit(coverage, width, height, bitmap, pixel + bitmap.left, y - bitmap.top);
        }
    }
    return { width, height, coverage, color };
}
function analyze(text, count, font) {
    const codepoints = Array.from(text, char => char.codePointAt(0));
    const n = codepoints.length;
    const has = (f, codepoint) => f.font.glyphIndex(codepoint) !== 0;
    const isColor = (f, codepoint) => {
        const index = f.font.glyphIndex(codepoint);
        return !!(f.paints && f.paints.paint(index) !== null || f.bitmaps?.(index) || f.layers?.(index));
    };
    const choose = (grapheme) => {
        const needed = grapheme.filter(c => !isDefaultIgnorableCodepoint(c));
        const variation = grapheme.find(c => c === 0xfe0f || c === 0xfe0e);
        let first = -1;
        for (let i = 0; i < count; i++) {
            const f = font(i);
            if (!needed.every(c => has(f, c)))
                continue;
            if (first < 0)
                first = i;
            if (!variation || !needed.length || (variation === 0xfe0f) === isColor(f, needed[0]))
                return i;
        }
        return first;
    };
    const normalized = (grapheme, form) => Array.from(String.fromCodePoint(...grapheme).normalize(form), char => char.codePointAt(0));
    const graphemes = graphemeBoundaries(codepoints), fontOf = new Int32Array(n);
    for (let start = 0; start < n;) {
        let end = start + 1;
        while (end < n && !graphemes[end])
            end++;
        const grapheme = codepoints.slice(start, end);
        let chosen = grapheme.length > 1 ? choose(normalized(grapheme, 'NFC')) : choose(grapheme);
        if (chosen < 0)
            chosen = choose(grapheme.length > 1 ? grapheme : normalized(grapheme, 'NFD'));
        if (chosen >= 0)
            fontOf.fill(chosen, start, end);
        else
            for (let k = start; k < end; k++)
                fontOf[k] = Math.max(0, choose([codepoints[k]]));
        start = end;
    }
    return {
        codepoints, fontOf, graphemes,
        bidi: resolve(codepoints.map(classOf), codepoints),
        scripts: scripts(codepoints),
        breaks: lineBreaks(codepoints),
    };
}
const CONTEXT = 5;
function shapeRange(p, start, end, levels, font, size, features) {
    const runs = [];
    let lastLevel = p.bidi.level;
    const levelAt = (i) => levels[i] >= 0 ? lastLevel = levels[i] : lastLevel;
    for (let i = start; i < end;) {
        const level = levelAt(i), script = p.scripts[i], f = p.fontOf[i];
        let j = i + 1;
        while (j < end && (levels[j] < 0 || levels[j] === level) && p.scripts[j] === script && p.fontOf[j] === f)
            j++;
        runs.push([i, j, level]);
        i = j;
    }
    let highest = 0, lowestOdd = Infinity;
    for (const [, , level] of runs) {
        highest = Math.max(highest, level);
        if (level & 1)
            lowestOdd = Math.min(lowestOdd, level);
    }
    for (let level = highest; level >= lowestOdd; level--)
        for (let i = 0; i < runs.length;) {
            if (runs[i][2] < level) {
                i++;
                continue;
            }
            let j = i;
            while (j < runs.length && runs[j][2] >= level)
                j++;
            const reversed = runs.slice(i, j).reverse();
            for (let k = i; k < j; k++)
                runs[k] = reversed[k - i];
            i = j;
        }
    const glyphs = [], advances = new Map();
    let x = 0, adjustment = 0;
    for (const [rs, re, level] of runs) {
        const f = font(p.fontOf[rs]);
        const before = p.codepoints.slice(Math.max(0, rs - CONTEXT), rs).reverse(), after = p.codepoints.slice(re, re + CONTEXT);
        const clusters = Array.from({ length: re - rs }, (_, k) => rs + k);
        const shaped = shapeRun(f.shaping, p.codepoints.slice(rs, re), p.scripts[rs], level & 1 ? 5 : 4, clusters, { before, after }, features);
        for (const info of shaped) {
            const g = glyphOf(f, info.codepoint, size);
            let advance;
            if (f.hinter) {
                const before = Math.round(adjustment);
                glyphs.push({ x, dx: Math.round(adjustment + info.xOffset * f.scale) - before, dy: Math.round(info.yOffset * f.scale), glyph: g });
                adjustment += (info.xAdvance - f.font.advance(info.codepoint)) * f.scale;
                advance = g.advance + Math.round(adjustment) - before;
            }
            else {
                advance = info.xAdvance * f.scale;
                glyphs.push({ x, dx: info.xOffset * f.scale, dy: info.yOffset * f.scale, glyph: g });
            }
            advances.set(info.cluster, (advances.get(info.cluster) ?? 0) + advance);
            x += advance;
        }
    }
    return { glyphs, width: x, advances };
}
const isSpace = (codepoint) => codepoint === 0x20 || codepoint === 0x09 || codepoint === 0x3000 || codepoint >= 0x2000 && codepoint <= 0x200a;
function layOutParagraph(p, layout, font, size, features) {
    const n = p.codepoints.length;
    if (!n)
        return [{ glyphs: [], extent: 0 }];
    const whole = shapeRange(p, 0, n, p.bidi.levels, font, size, features);
    const width = new Float64Array(n), starts = new Uint8Array(n + 1);
    starts[n] = 1;
    for (const [cluster, advance] of whole.advances) {
        width[cluster] = advance;
        starts[cluster] = 1;
    }
    starts[0] = 1;
    const canBreak = (i) => starts[i] === 1 && (layout.wrapStyle === 'char' ? p.graphemes[i] === 1 : p.breaks[i] !== 0);
    const ranges = [];
    let lineStart = 0;
    while (lineStart < n) {
        let fit = -1, emergency = -1, used = 0, trailing = 0;
        for (let i = lineStart; i < n; i++) {
            used += width[i];
            trailing = isSpace(p.codepoints[i]) ? trailing + width[i] : 0;
            const end = i + 1;
            if (!starts[end])
                continue;
            if (p.breaks[end] === 2 && end < n && layout.wrapHardBreaks) {
                fit = end;
                break;
            }
            const fits = used - trailing <= layout.maxWidth;
            if (!fits)
                break;
            if (canBreak(end))
                fit = end;
            if (p.graphemes[end])
                emergency = end;
        }
        if (fit < 0) {
            fit = emergency;
            if (fit < 0) {
                fit = lineStart + 1;
                while (fit < n && !(starts[fit] && p.graphemes[fit]))
                    fit++;
            }
        }
        ranges.push([lineStart, fit]);
        lineStart = fit;
    }
    return ranges.map(([start, end]) => {
        const levels = lineLevels(p.bidi, start, end);
        const shifted = new Int8Array(n);
        shifted.set(levels, start);
        const { glyphs } = ranges.length === 1 ? whole : shapeRange(p, start, end, shifted, font, size, features);
        let extent = 0;
        for (const { x, dx, glyph } of glyphs)
            if (glyph.ink)
                extent = Math.max(extent, x + dx + glyph.ink.right);
        return { glyphs, extent };
    });
}
async function scaledBitmap(glyph, scale) {
    let decoded;
    try {
        decoded = await decodePNG(glyph.png);
    }
    catch {
        return null;
    }
    const width = Math.max(1, Math.round(decoded.width * scale)), height = Math.max(1, Math.round(decoded.height * scale));
    const data = new Uint8ClampedArray(width * height * 4);
    resample(new Uint8ClampedArray(decoded.pixels.buffer, decoded.pixels.byteOffset, decoded.pixels.length), decoded.width, decoded.height, width, height, TRIANGLE, data, true);
    premultiply(data);
    return { data, width, height, left: Math.round(glyph.left * scale), top: Math.round(glyph.top * scale) };
}
function layeredGlyph(g, layers, offset, foreground) {
    const rasters = layers.map(layer => ({ bitmap: rasterizeGlyph(g.font.font.outline(layer.glyph), g.scale, offset), color: layer.color ?? foreground }));
    let left = Infinity, top = -Infinity, right = -Infinity, bottom = Infinity;
    for (const { bitmap } of rasters)
        if (bitmap) {
            left = Math.min(left, bitmap.left);
            top = Math.max(top, bitmap.top);
            right = Math.max(right, bitmap.left + bitmap.width);
            bottom = Math.min(bottom, bitmap.top - bitmap.height);
        }
    if (right <= left)
        return null;
    const width = right - left, height = top - bottom;
    const data = new Uint8ClampedArray(width * height * 4);
    for (const { bitmap, color } of rasters) {
        if (!bitmap)
            continue;
        const r = color >>> 24, gr = color >> 16 & 255, b = color >> 8 & 255, a = color & 255;
        for (let y = 0; y < bitmap.height; y++)
            for (let x = 0; x < bitmap.width; x++) {
                const coverage = bitmap.data[y * bitmap.width + x];
                if (!coverage)
                    continue;
                const o = ((top - bitmap.top + y) * width + bitmap.left - left + x) * 4;
                const sa = coverage * a / 255, keep = 1 - sa / 255;
                data[o] = r * sa / 255 + data[o] * keep;
                data[o + 1] = gr * sa / 255 + data[o + 1] * keep;
                data[o + 2] = b * sa / 255 + data[o + 2] * keep;
                data[o + 3] = sa + data[o + 3] * keep;
            }
    }
    return { data, width, height, left, top };
}
function paintedGlyph(g, offset, foreground) {
    const { font } = g.font;
    return renderPaintGlyph(font, g.font.paints, g.index, g.scale, offset, foreground, glyph => font.outline(glyph), (path, clip) => rasterizeGlyph(path, 1, 0, clip));
}
function premultiply(rgba) {
    for (let i = 0; i < rgba.length; i += 4) {
        const a = rgba[i + 3] / 255;
        rgba[i] *= a;
        rgba[i + 1] *= a;
        rgba[i + 2] *= a;
    }
}
function inkExtent(path, scale) {
    let left = Infinity, right = -Infinity;
    for (const command of path)
        for (let i = 1; i < command.length; i += 2) {
            left = Math.min(left, command[i] * scale);
            right = Math.max(right, command[i] * scale);
        }
    return right > left ? { left, right } : null;
}
function clipped(width, height, bitmap, x0, y0) {
    return [Math.max(0, -x0), Math.min(bitmap.width, width - x0), Math.max(0, -y0), Math.min(bitmap.height, height - y0)];
}
function blit(target, width, height, bitmap, x0, y0) {
    const [xs, xe, ys, ye] = clipped(width, height, bitmap, x0, y0);
    for (let y = ys; y < ye; y++)
        for (let x = xs, s = y * bitmap.width + xs, o = (y0 + y) * width + x0 + xs; x < xe; x++, s++, o++) {
            const v = bitmap.data[s];
            if (v)
                target[o] = Math.min(255, target[o] + v);
        }
}
function blitColor(target, width, height, bitmap, x0, y0) {
    const [xs, xe, ys, ye] = clipped(width, height, bitmap, x0, y0);
    for (let y = ys; y < ye; y++)
        for (let x = xs, s = (y * bitmap.width + xs) * 4, o = ((y0 + y) * width + x0 + xs) * 4; x < xe; x++, s += 4, o += 4) {
            const sa = bitmap.data[s + 3];
            if (!sa)
                continue;
            const keep = 1 - sa / 255;
            target[o] = bitmap.data[s] + target[o] * keep;
            target[o + 1] = bitmap.data[s + 1] + target[o + 1] * keep;
            target[o + 2] = bitmap.data[s + 2] + target[o + 2] * keep;
            target[o + 3] = sa + target[o + 3] * keep;
        }
}
export function rasterizeGlyph(path, scale, offset = 0, clip) {
    if (!path.length)
        return null;
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const command of path)
        for (let i = 1; i < command.length; i += 2) {
            const x = command[i] * scale + offset, y = command[i + 1] * scale;
            if (x < xmin)
                xmin = x;
            if (x > xmax)
                xmax = x;
            if (y < ymin)
                ymin = y;
            if (y > ymax)
                ymax = y;
        }
    let left = Math.floor(xmin), right = Math.ceil(xmax), bottom = Math.floor(ymin), top = Math.ceil(ymax);
    if (clip) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
        bottom = Math.max(bottom, clip.bottom);
        top = Math.min(top, clip.top);
    }
    const width = right - left, height = top - bottom;
    if (!(width > 0 && height > 0) || width * height > MAX_GLYPH_PIXELS)
        return null;
    const raster = new Rasterizer(width, height);
    const tx = (x) => x * scale + offset - left;
    const ty = (y) => top - y * scale;
    let sx = 0, sy = 0, cx = 0, cy = 0;
    for (const command of path) {
        switch (command[0]) {
            case 'M':
                sx = cx = tx(command[1]);
                sy = cy = ty(command[2]);
                break;
            case 'L': {
                const x = tx(command[1]), y = ty(command[2]);
                raster.line(cx, cy, x, y);
                cx = x;
                cy = y;
                break;
            }
            case 'Q': {
                const x = tx(command[3]), y = ty(command[4]);
                raster.quad(cx, cy, tx(command[1]), ty(command[2]), x, y);
                cx = x;
                cy = y;
                break;
            }
            case 'C': {
                const x = tx(command[5]), y = ty(command[6]);
                raster.cubic(cx, cy, tx(command[1]), ty(command[2]), tx(command[3]), ty(command[4]), x, y);
                cx = x;
                cy = y;
                break;
            }
            case 'Z':
                if (cx !== sx || cy !== sy)
                    raster.line(cx, cy, sx, sy);
                cx = sx;
                cy = sy;
                break;
        }
    }
    return { data: raster.coverage(), width, height, left, top };
}
export class Rasterizer {
    width;
    height;
    accumulation;
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.accumulation = new Float32Array(width * height + 4);
    }
    line(x0, y0, x1, y1) {
        if (y0 === y1)
            return;
        for (const edge of [0, this.width])
            if ((x0 - edge) * (x1 - edge) < 0) {
                const y = y0 + (y1 - y0) * (edge - x0) / (x1 - x0);
                this.line(x0, y0, edge, y);
                this.line(edge, y, x1, y1);
                return;
            }
        x0 = x0 < 0 ? 0 : x0 > this.width ? this.width : x0;
        x1 = x1 < 0 ? 0 : x1 > this.width ? this.width : x1;
        let dir = 1;
        if (y0 > y1) {
            dir = -1;
            [x0, y0, x1, y1] = [x1, y1, x0, y0];
        }
        const a = this.accumulation;
        const w = this.width;
        const dxdy = (x1 - x0) / (y1 - y0);
        let x = x0;
        if (y0 < 0)
            x -= y0 * dxdy;
        const yEnd = Math.min(this.height, Math.ceil(y1));
        for (let y = Math.max(0, y0 | 0); y < yEnd; y++) {
            const lineStart = y * w;
            const dy = Math.min(y + 1, y1) - Math.max(y, y0);
            let xNext = x + dxdy * dy;
            xNext = xNext < 0 ? 0 : xNext > w ? w : xNext;
            const d = dy * dir;
            const xa = x < xNext ? x : xNext, xb = x < xNext ? xNext : x;
            const xaFloor = Math.floor(xa);
            const xai = xaFloor;
            const xbCeil = Math.ceil(xb);
            const xbi = xbCeil;
            const index = lineStart + xai;
            if (index >= 0) {
                if (xbi <= xai + 1) {
                    const xmf = 0.5 * (x + xNext) - xaFloor;
                    a[index] += d - d * xmf;
                    a[index + 1] += d * xmf;
                }
                else {
                    const s = 1 / (xb - xa);
                    const xaf = xa - xaFloor;
                    const a0 = 0.5 * s * (1 - xaf) * (1 - xaf);
                    const xbf = xb - xbCeil + 1;
                    const am = 0.5 * s * xbf * xbf;
                    a[index] += d * a0;
                    if (xbi === xai + 2)
                        a[index + 1] += d * (1 - a0 - am);
                    else {
                        const a1 = s * (1.5 - xaf);
                        a[index + 1] += d * (a1 - a0);
                        for (let xi = xai + 2; xi < xbi - 1; xi++)
                            a[lineStart + xi] += d * s;
                        const a2 = a1 + (xbi - xai - 3) * s;
                        a[lineStart + xbi - 1] += d * (1 - a2 - am);
                    }
                    a[lineStart + xbi] += d * am;
                }
            }
            x = xNext;
        }
    }
    quad(x0, y0, x1, y1, x2, y2) {
        const devx = x0 - 2 * x1 + x2;
        const devy = y0 - 2 * y1 + y2;
        const devsq = devx * devx + devy * devy;
        if (devsq < 0.333)
            return this.line(x0, y0, x2, y2);
        const n = 1 + Math.floor(Math.sqrt(Math.sqrt(3 * devsq)));
        let px = x0, py = y0;
        for (let i = 1; i <= n; i++) {
            const t = i / n, mt = 1 - t;
            const x = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
            const y = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
            this.line(px, py, x, y);
            px = x;
            py = y;
        }
    }
    cubic(x0, y0, x1, y1, x2, y2, x3, y3) {
        const dx = Math.max(Math.abs(x0 - 2 * x1 + x2), Math.abs(x1 - 2 * x2 + x3));
        const dy = Math.max(Math.abs(y0 - 2 * y1 + y2), Math.abs(y1 - 2 * y2 + y3));
        const devsq = dx * dx + dy * dy;
        if (devsq < 0.333)
            return this.line(x0, y0, x3, y3);
        const n = 1 + Math.floor(Math.sqrt(Math.sqrt(6 * devsq)));
        let px = x0, py = y0;
        for (let i = 1; i <= n; i++) {
            const t = i / n, mt = 1 - t;
            const x = mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
            const y = mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
            this.line(px, py, x, y);
            px = x;
            py = y;
        }
    }
    coverage() {
        const length = this.width * this.height;
        const out = new Uint8Array(length);
        let acc = 0;
        for (let i = 0; i < length; i++) {
            acc += this.accumulation[i];
            const v = acc < 0 ? -acc : acc;
            out[i] = v >= 1 ? 255 : v * 255 + 0.5 | 0;
        }
        return out;
    }
}
