const ALPHA = new Int32Array(new Uint8Array([0, 0, 0, 255]).buffer)[0];
const ALPHA_COST = 4 / 3;
export class Optimizer {
    width;
    height;
    options;
    canvas;
    shown;
    state;
    final = [];
    last = null;
    count = 0;
    cleared;
    opaque = true;
    denseTotal = 0;
    chosenTotal = 0;
    constructor(width, height, options) {
        this.width = width;
        this.height = height;
        this.options = options;
        const size = width * height * 4;
        this.canvas = new Uint8Array(size);
        this.shown = new Uint8Array(size);
        this.state = { canvas32: new Int32Array(this.canvas.buffer), shown32: new Int32Array(this.shown.buffer), width, replace: options.replace, tolerance: options.tolerance };
        this.cleared = { x: 0, y: 0, width, height };
    }
    push(f) {
        const { canvas, width, height } = this;
        const saved = f.dispose === 2 ? canvas.slice() : null;
        const area = clip(f, width, height);
        if (this.cleared && contains(this.cleared, area))
            copy(canvas, width, f, area);
        else
            draw(canvas, width, height, f);
        this.cleared = null;
        this.add(f.duration);
        if (f.dispose === 1) {
            clear(canvas, width, area);
            this.cleared = area;
        }
        else if (saved)
            canvas.set(saved);
    }
    take() {
        return this.final.splice(0);
    }
    end() {
        const rest = this.take();
        if (this.last)
            rest.push(this.last);
        this.last = null;
        return rest;
    }
    output(frame) {
        if (this.last)
            this.final.push(this.last);
        this.last = frame;
        this.count++;
    }
    add(duration) {
        const { width, height, canvas, shown, state } = this;
        const { replace, even, alpha, palette, tolerance } = this.options;
        let changed = bounds(state, { x: 0, y: 0, width, height });
        if (!changed) {
            if (this.last)
                this.last.duration += duration;
            else {
                this.output(empty(duration));
                this.opaque = false;
            }
            return;
        }
        if (even)
            changed = evenArea(changed);
        let area = tolerance === undefined ? sparse(state, changed) : sparseBlocks(state, changed);
        let blend = true;
        if (area.unblendable && replace)
            blend = false;
        else if (area.unblendable && this.last) {
            const last = this.last;
            grow(last, union(last, area.unblendable));
            last.dispose = true;
            clear(shown, width, last);
            changed = bounds(state, { x: 0, y: 0, width, height });
            if (!changed)
                return void this.output(empty(duration));
            if (even)
                changed = evenArea(changed);
            area = sparse(state, changed);
        }
        const { x, y, width: w, height: h } = changed;
        const pixels = area.pixels;
        if (!this.count && (w !== width || h !== height))
            this.opaque = false;
        if (!area.denseOpaque)
            this.opaque = false;
        const sparseCost = alpha === 'frame' && area.denseOpaque ? area.sparseChanges * ALPHA_COST : area.sparseChanges;
        const dense = !blend || (tolerance !== undefined ? !area.unchangedBlocks : area.denseChanges < sparseCost
            || (palette !== undefined && colors(new Int32Array(pixels.buffer), w, { x: 0, y: 0, width: w, height: h }, palette + 1) > palette
                && colors(state.canvas32, width, changed, palette + 1) <= palette));
        this.denseTotal += area.denseChanges;
        this.chosenTotal += dense ? area.denseChanges : area.sparseChanges;
        if (dense) {
            for (let row = 0; row < h; row++)
                pixels.set(canvas.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
            if (replace)
                blend = false;
        }
        if (!dense && tolerance !== undefined) {
            const pixels32 = new Int32Array(pixels.buffer);
            for (let row = 0, k = 0; row < h; row++)
                for (let p = (y + row) * width + x, end = p + w; p < end; p++, k++)
                    if (pixels32[k] & ALPHA)
                        state.shown32[p] = pixels32[k];
        }
        else
            for (let row = 0; row < h; row++) {
                const start = ((y + row) * width + x) * 4;
                shown.set(canvas.subarray(start, start + w * 4), start);
            }
        this.output({ x, y, width: w, height: h, duration, dispose: false, blend, pixels });
    }
}
export class Compositor {
    width;
    height;
    canvas;
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.canvas = new Uint8Array(width * height * 4);
    }
    push(f) {
        const { canvas, width, height } = this;
        const saved = f.dispose === 2 ? canvas.slice() : null;
        draw(canvas, width, height, f);
        const shown = canvas.slice();
        if (f.dispose === 1)
            clear(canvas, width, clip(f, width, height));
        else if (saved)
            canvas.set(saved);
        return shown;
    }
}
export function optimize(frames, width, height, options) {
    const optimizer = new Optimizer(width, height, options);
    const output = [];
    for (const f of frames) {
        optimizer.push(f);
        output.push(...optimizer.take());
    }
    output.push(...optimizer.end());
    const { alpha, cover } = options;
    if (typeof alpha === 'function' && optimizer.opaque && output.some(f => f.blend) && optimizer.denseTotal < optimizer.chosenTotal * alpha(output)) {
        const shown32 = new Int32Array(width * height);
        for (const f of output)
            fillUnchanged(f, shown32, width);
    }
    if (cover && output.length)
        coverCanvas(output[0], width, height);
    return output;
}
export function fillUnchanged(f, shown32, width) {
    const pixels32 = new Int32Array(f.pixels.buffer, f.pixels.byteOffset, f.width * f.height);
    for (let row = 0, k = 0; row < f.height; row++, k += f.width) {
        const start = (f.y + row) * width + f.x;
        if (!f.blend)
            shown32.set(pixels32.subarray(k, k + f.width), start);
        else
            for (let i = k, p = start, end = k + f.width; i < end; i++, p++) {
                if ((pixels32[i] & ALPHA) === 0)
                    pixels32[i] = shown32[p];
                else
                    shown32[p] = pixels32[i];
            }
    }
    f.blend = false;
}
export function coverCanvas(frame, width, height) {
    grow(frame, { x: 0, y: 0, width, height });
}
function colors(image32, width, { x, y, width: w, height: h }, limit) {
    const seen = new Set();
    for (let row = y; row < y + h; row++) {
        let previous;
        for (let p = row * width + x, end = p + w; p < end; p++) {
            const value = image32[p];
            if (value === previous)
                continue;
            previous = value;
            seen.add(value);
            if (seen.size >= limit)
                return seen.size;
        }
    }
    return seen.size;
}
const empty = (duration) => ({ x: 0, y: 0, width: 1, height: 1, duration, dispose: false, blend: true, pixels: new Uint8Array(4) });
function clip(r, width, height) {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, width: Math.max(0, Math.min(width, r.x + r.width) - x), height: Math.max(0, Math.min(height, r.y + r.height) - y) };
}
function contains(a, b) {
    return b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
}
function union(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
function similar(a, i, b, j, tolerance) {
    const alpha = a[i + 3];
    if (alpha !== b[j + 3])
        return false;
    const limit = tolerance * 255;
    return Math.abs(a[i] - b[j]) * alpha <= limit && Math.abs(a[i + 1] - b[j + 1]) * alpha <= limit && Math.abs(a[i + 2] - b[j + 2]) * alpha <= limit;
}
function evenArea({ x, y, width, height }) {
    return { x: x & ~1, y: y & ~1, width: width + (x & 1), height: height + (y & 1) };
}
const BLOCK = 8;
function sparseBlocks({ canvas32, shown32, width, tolerance = 0 }, { x, y, width: w, height: h }) {
    const canvas = new Uint8Array(canvas32.buffer), shown = new Uint8Array(shown32.buffer);
    const pixels = new Uint8Array(w * h * 4), pixels32 = new Int32Array(pixels.buffer);
    let left = w, right = -1, top = h, bottom = -1, translucent = 0, unchangedBlocks = 0;
    for (let by = 0; by < h; by += BLOCK)
        for (let bx = 0; bx < w; bx += BLOCK) {
            const bw = Math.min(BLOCK, w - bx), bh = Math.min(BLOCK, h - by);
            let unchanged = true;
            for (let row = by; row < by + bh && unchanged; row++)
                for (let p = (y + row) * width + x + bx, end = p + bw; p < end; p++) {
                    const value = canvas32[p], before = shown32[p];
                    if (value !== before && ((value | before) & ALPHA) !== 0 && !similar(canvas, p * 4, shown, p * 4, tolerance)) {
                        unchanged = false;
                        break;
                    }
                }
            if (unchanged) {
                unchangedBlocks++;
                let r = 0, g = 0, b = 0;
                for (let row = by; row < by + bh; row++)
                    for (let p = ((y + row) * width + x + bx) * 4, end = p + bw * 4; p < end; p += 4) {
                        r += shown[p];
                        g += shown[p + 1];
                        b += shown[p + 2];
                    }
                const n = bw * bh;
                r = r / n | 0;
                g = g / n | 0;
                b = b / n | 0;
                for (let row = by; row < by + bh; row++)
                    for (let k = ((row * w) + bx) * 4, end = k + bw * 4; k < end; k += 4) {
                        pixels[k] = r;
                        pixels[k + 1] = g;
                        pixels[k + 2] = b;
                    }
            }
            for (let row = by; row < by + bh; row++)
                for (let i = bx, k = row * w + bx, p = (y + row) * width + x + bx; i < bx + bw; i++, k++, p++) {
                    const value = canvas32[p];
                    translucent |= ~value & ALPHA;
                    if (unchanged)
                        continue;
                    pixels32[k] = value;
                    if ((value & ALPHA) !== ALPHA && ((value | shown32[p]) & ALPHA) !== 0) {
                        if (i < left)
                            left = i;
                        if (i > right)
                            right = i;
                        if (row < top)
                            top = row;
                        if (row > bottom)
                            bottom = row;
                    }
                }
        }
    const unblendable = right < 0 ? null : { x: x + left, y: y + top, width: right - left + 1, height: bottom - top + 1 };
    return { pixels, sparseChanges: 0, denseChanges: 0, unblendable, denseOpaque: translucent === 0, unchangedBlocks };
}
function sparse({ canvas32, shown32, width, replace }, { x, y, width: w, height: h }) {
    const pixels = new Uint8Array(w * h * 4), pixels32 = new Int32Array(pixels.buffer);
    let sparseChanges = 0, denseChanges = 0, lastSparse = -1, lastDense = -1;
    let left = w, right = -1, top = h, bottom = -1, translucent = 0;
    for (let row = 0, k = 0; row < h; row++) {
        const start = (y + row) * width + x;
        for (let i = 0, p = start; i < w; i++, p++, k++) {
            const value = canvas32[p], before = shown32[p];
            if (value === before || ((value | before) & ALPHA) === 0) {
                if (lastSparse !== 0)
                    sparseChanges++;
                lastSparse = 0;
            }
            else {
                pixels32[k] = value;
                if (value !== lastSparse)
                    sparseChanges++;
                lastSparse = value;
                if ((value & ALPHA) !== ALPHA && (replace || (before & ALPHA) !== 0)) {
                    if (i < left)
                        left = i;
                    if (i > right)
                        right = i;
                    if (row < top)
                        top = row;
                    bottom = row;
                }
            }
            if (value !== lastDense) {
                denseChanges++;
                translucent |= ~value & ALPHA;
            }
            lastDense = value;
        }
    }
    const unblendable = right < 0 ? null : { x: x + left, y: y + top, width: right - left + 1, height: bottom - top + 1 };
    return { pixels, sparseChanges, denseChanges, unblendable, denseOpaque: translucent === 0 };
}
function bounds({ canvas32, shown32, width, tolerance }, area) {
    const x0 = area.x, x1 = area.x + area.width, y0 = area.y, y1 = area.y + area.height;
    const canvas = new Uint8Array(canvas32.buffer), shown = new Uint8Array(shown32.buffer);
    const test = (p) => {
        const c = canvas32[p], s = shown32[p];
        return c !== s && ((c | s) & ALPHA) !== 0 && (tolerance === undefined || !similar(canvas, p * 4, shown, p * 4, tolerance));
    };
    const rowHas = (y, from, to) => {
        for (let x = from, p = y * width + from; x < to; x++, p++)
            if (test(p))
                return x;
        return -1;
    };
    let top = y0, first = -1;
    for (; top < y1; top++)
        if ((first = rowHas(top, x0, x1)) >= 0)
            break;
    if (top === y1)
        return null;
    let bottom = y1 - 1;
    while (bottom > top && rowHas(bottom, x0, x1) < 0)
        bottom--;
    let left = first, right = first;
    for (let y = top; y <= bottom; y++) {
        if (left > x0) {
            const x = rowHas(y, x0, left);
            if (x >= 0)
                left = x;
        }
        for (let x = x1 - 1, p = y * width + x; x > right; x--, p--)
            if (test(p)) {
                right = x;
                break;
            }
    }
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
function draw(canvas, width, height, f) {
    const { x: x0, y: y0, width: w, height: h } = clip(f, width, height);
    const pixels = f.pixels.byteOffset % 4 ? f.pixels.slice() : f.pixels;
    const src = new Int32Array(pixels.buffer, pixels.byteOffset, f.width * f.height);
    const dst = new Int32Array(canvas.buffer, canvas.byteOffset, width * height);
    for (let y = y0; y < y0 + h; y++)
        for (let x = x0, s = (y - f.y) * f.width + x - f.x, d = y * width + x; x < x0 + w; x++, s++, d++) {
            let n = 0;
            while (n < x0 + w - x && (src[s + n] & ALPHA) === ALPHA)
                n++;
            if (n) {
                if (n >= 16)
                    dst.set(src.subarray(s, s + n), d);
                else
                    for (let i = 0; i < n; i++)
                        dst[d + i] = src[s + i];
                x += n - 1;
                s += n - 1;
                d += n - 1;
                continue;
            }
            const value = src[s], alpha = value & ALPHA;
            if (alpha === 0)
                continue;
            if (alpha === ALPHA || (dst[d] & ALPHA) === 0)
                dst[d] = value;
            else {
                const sa = pixels[s * 4 + 3], da = canvas[d * 4 + 3];
                const u = sa * 255, v = (255 - sa) * da, al = u + v;
                for (let c = 0; c < 3; c++)
                    canvas[d * 4 + c] = (pixels[s * 4 + c] * u + canvas[d * 4 + c] * v) / al | 0;
                canvas[d * 4 + 3] = al / 255 | 0;
            }
        }
}
function copy(canvas, width, f, { x, y, width: w, height: h }) {
    const canvas32 = new Int32Array(canvas.buffer, canvas.byteOffset, width * (y + h));
    for (let row = y; row < y + h; row++) {
        const s = ((row - f.y) * f.width + x - f.x) * 4, d = row * width + x;
        canvas.set(f.pixels.subarray(s, s + w * 4), d * 4);
        for (let p = d; p < d + w; p++)
            if ((canvas32[p] & ALPHA) === 0)
                canvas32[p] = 0;
    }
}
function clear(canvas, width, r) {
    for (let y = r.y; y < r.y + r.height; y++)
        canvas.fill(0, (y * width + r.x) * 4, (y * width + r.x + r.width) * 4);
}
function grow(frame, area) {
    if (area.x === frame.x && area.y === frame.y && area.width === frame.width && area.height === frame.height)
        return;
    const pixels = new Uint8Array(area.width * area.height * 4);
    for (let row = 0; row < frame.height; row++)
        pixels.set(frame.pixels.subarray(row * frame.width * 4, (row + 1) * frame.width * 4), ((frame.y - area.y + row) * area.width + frame.x - area.x) * 4);
    Object.assign(frame, area, { pixels });
}
