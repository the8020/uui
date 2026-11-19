/*!
 * TrueType hinting interpreter. Where the TrueType specification leaves details open, its behavior and parts of its
 * logic follow FreeType's TrueType interpreter (src/truetype/ttinterp.c): fixed point rounding, original distances
 * on the unscaled outline (IP, IUP, MDRP, MD), the IUP interpolation, the movement along near-perpendicular vectors
 * and the tolerance of invalid references. Portions of this software are copyright © 2026 The FreeType Project
 * (https://freetype.org). All rights reserved. FreeType License, see THIRD_PARTY_NOTICES.md and licenses/FTL.txt
 */
import { contourToPath } from "./font.js";
class HintError extends Error {
}
class SkipInstruction extends Error {
}
const roundHalfAway = (v) => v < 0 ? -Math.round(-v) : Math.round(v);
const mulFix = (a, b) => roundHalfAway(a * b / 65536);
const mulDiv = (a, b, c) => {
    if (!c)
        return a * b < 0 ? -0x7fffffff : 0x7fffffff;
    const d = Math.floor((Math.abs(a * b) + Math.abs(c) / 2) / Math.abs(c));
    return a * b * c < 0 ? -d : d;
};
const divFix = (a, b) => {
    if (b === 0)
        return a < 0 ? -0x7fffffff : 0x7fffffff;
    const n = Math.abs(a) * 65536 + Math.floor(Math.abs(b) / 2), d = Math.abs(b);
    let q = Math.floor(n / d);
    if (q * d > n)
        q--;
    else if ((q + 1) * d <= n)
        q++;
    return (a < 0) !== (b < 0) ? -q : q;
};
const mulFix14 = (a, b) => {
    const ab = a * b;
    return Math.floor((ab + 0x2000 + (ab < 0 ? -1 : 0)) / 0x4000);
};
const dotFix14 = (ax, ay, bx, by) => {
    const c = ax * bx + ay * by;
    return Math.floor((c + 0x2000 + (c < 0 ? -1 : 0)) / 0x4000);
};
const X_AXIS = { x: 0x4000, y: 0 }, Y_AXIS = { x: 0, y: 0x4000 };
function normalize(vx, vy) {
    if (vx === 0 && vy === 0)
        return null;
    const sx = vx < 0 ? -1 : 1, sy = vy < 0 ? -1 : 1;
    let x = Math.abs(vx) >>> 0, y = Math.abs(vy) >>> 0;
    if (x === 0)
        return { x: 0, y: sy * 0x4000 };
    if (y === 0)
        return { x: sx * 0x4000, y: 0 };
    let l = (x > y ? x + (y >>> 1) : y + (x >>> 1)) >>> 0;
    let shift = 31 - (31 - Math.clz32(l));
    shift -= 15 + (l >= 0xaaaaaaaa >>> shift ? 1 : 0);
    if (shift > 0) {
        x = x << shift >>> 0;
        y = y << shift >>> 0;
        l = (x > y ? x + (y >>> 1) : y + (x >>> 1)) >>> 0;
    }
    else {
        x >>>= -shift;
        y >>>= -shift;
        l >>>= -shift;
    }
    let b = 0x10000 - l | 0, u, v, z;
    const x_ = x | 0, y_ = y | 0;
    do {
        u = x_ + (Math.imul(x_, b) >> 16) >>> 0;
        v = y_ + (Math.imul(y_, b) >> 16) >>> 0;
        z = Math.trunc(-(Math.imul(u, u) + Math.imul(v, v) | 0) / 0x200);
        z = Math.trunc(Math.imul(z, 0x10000 + b >> 8) / 0x10000);
        b = b + z | 0;
    } while (z > 0);
    return { x: Math.trunc(sx * u / 4), y: Math.trunc(sy * v / 4) };
}
const ROUND_GRID = { period: 64, phase: 0, threshold: 32 };
const defaultState = () => ({
    pv: X_AXIS, fv: X_AXIS, dv: X_AXIS,
    rp0: 0, rp1: 0, rp2: 0, zp0: 1, zp1: 1, zp2: 1, loop: 1,
    minimumDistance: 64, cvtCutIn: 68, singleWidthCutIn: 0, singleWidth: 0,
    deltaBase: 9, deltaShift: 3, autoFlip: true, round: ROUND_GRID, instructControl: 0
});
function makeZone(count) {
    return {
        curX: new Float64Array(count), curY: new Float64Array(count), orgX: new Float64Array(count), orgY: new Float64Array(count),
        orusX: new Float64Array(count), orusY: new Float64Array(count),
        touchX: new Uint8Array(count), touchY: new Uint8Array(count), on: new Uint8Array(count), ends: []
    };
}
const MAX_INSTRUCTIONS = 1_000_000;
const MAX_POINTS = 65536;
export class Hinter {
    font;
    fpgm;
    prep;
    cvt;
    maxStack;
    maxStorage;
    maxTwilight;
    sizes = new Map();
    scaleFixed = 0;
    loading = new Set();
    points = 0;
    constructor(font) {
        this.font = font;
        const table = (tag) => {
            const t = font.tables[tag];
            return t ? font.data.subarray(t.offset, t.offset + t.length) : new Uint8Array(0);
        };
        this.fpgm = table('fpgm');
        this.prep = table('prep');
        const cvt = table('cvt ');
        this.cvt = new Int32Array(cvt.length >> 1);
        for (let i = 0; i < this.cvt.length; i++)
            this.cvt[i] = font.i16(font.tables['cvt '].offset + i * 2) * 64;
        const deltas = font.cvtDeltas(this.cvt.length);
        if (deltas)
            for (let i = 0; i < this.cvt.length; i++)
                this.cvt[i] += Math.floor(deltas[i] * 64 + 0.5);
        const maxp = font.tables.maxp.offset;
        const version = font.u32(maxp);
        this.maxTwilight = version >= 0x10000 ? font.u16(maxp + 16) : 0;
        this.maxStorage = version >= 0x10000 ? font.u16(maxp + 18) : 0;
        this.maxStack = version >= 0x10000 ? font.u16(maxp + 24) : 0;
    }
    get hasInstructions() {
        return this.font.outlines === 'glyf' && (this.fpgm.length > 0 || this.prep.length > 0 || this.cvt.length > 0);
    }
    size(ppem) {
        let size = this.sizes.get(ppem);
        if (size)
            return size;
        const scaleFixed = divFix(ppem * 64, this.font.unitsPerEm);
        const scale = scaleFixed / 65536;
        size = {
            ppem, scale, scaleFixed,
            cvt: Float64Array.from(this.cvt, v => mulFix(v, scaleFixed >> 6)),
            storage: new Int32Array(Math.max(this.maxStorage, 64)),
            state: defaultState(),
            twilight: makeZone(Math.max(this.maxTwilight, 1)),
            functions: new Map(),
            instructions: new Map(),
            broken: false
        };
        try {
            const fpgm = new Execution(this, size, size.twilight, makeZone(0));
            fpgm.run(this.fpgm);
            const prep = new Execution(this, size, size.twilight, makeZone(0));
            prep.run(this.prep);
            size.state = { ...prep.gs, pv: { ...prep.gs.pv }, fv: { ...prep.gs.fv }, dv: { ...prep.gs.dv } };
        }
        catch (err) {
            if (!(err instanceof HintError))
                throw err;
            size.broken = true;
        }
        this.sizes.set(ppem, size);
        return size;
    }
    glyph(glyph, size) {
        const ppem = Math.round(size);
        if (ppem < 1 || ppem > 1000)
            return null;
        const state = this.size(ppem);
        if (state.broken)
            return null;
        try {
            this.loading.clear();
            this.points = 0;
            const outline = this.load(glyph, state, 0);
            if (!outline)
                return { path: [], advance: Math.round(this.font.advance(glyph) * state.scale / 64) };
            const { zone, count } = outline;
            const originX = zone.curX[count], advance = Math.round((zone.curX[count + 1] - originX) / 64);
            const xs = new Float64Array(count), ys = new Float64Array(count);
            for (let i = 0; i < count; i++) {
                xs[i] = (zone.curX[i] - originX) / 64;
                ys[i] = zone.curY[i] / 64;
            }
            const path = [];
            let first = 0;
            for (const last of zone.ends) {
                contourToPath(path, xs, ys, zone.on, first, last);
                first = last + 1;
            }
            return { path, advance };
        }
        catch (err) {
            if (!(err instanceof HintError))
                throw err;
            return null;
        }
    }
    load(glyph, size, depth) {
        if (depth > 8)
            throw new HintError('composite glyphs nested too deep');
        if (this.loading.has(glyph))
            throw new HintError('composite glyph containing itself');
        const font = this.font;
        const data = font.glyfPoints(glyph);
        if (!data)
            return null;
        this.points += data.xs.length;
        if (this.points > MAX_POINTS)
            throw new HintError('too many points');
        const scaleFixed = this.scaleFixed = size.scaleFixed;
        const lsb = font.leftSideBearing(glyph), advance = font.advance(glyph);
        let count, zone;
        if (data.components) {
            let total = 0;
            const xsAll = [], ysAll = [], on = [], ends = [];
            let useMetrics = null;
            this.loading.add(glyph);
            for (const component of data.components) {
                const part = this.load(component.glyph, size, depth + 1);
                if (!part)
                    continue;
                const [a, b, c, d] = component.matrix;
                const transformed = a !== 1 || b !== 0 || c !== 0 || d !== 1;
                let dx, dy;
                if (component.match) {
                    const [parentPoint, childPoint] = component.match;
                    if (parentPoint >= total || childPoint >= part.count)
                        throw new HintError('invalid point matching');
                    const cx = part.zone.curX[childPoint], cy = part.zone.curY[childPoint];
                    dx = xsAll[parentPoint] - (a * cx + c * cy);
                    dy = ysAll[parentPoint] - (b * cx + d * cy);
                }
                else {
                    dx = mulFix(component.dx, scaleFixed);
                    dy = mulFix(component.dy, scaleFixed);
                    if (component.round) {
                        dx = Math.round(dx / 64) * 64;
                        dy = Math.round(dy / 64) * 64;
                    }
                }
                for (let i = 0; i < part.count; i++) {
                    const x = part.zone.curX[i], y = part.zone.curY[i];
                    xsAll.push(transformed ? a * x + c * y + dx : x + dx);
                    ysAll.push(transformed ? b * x + d * y + dy : y + dy);
                    on.push(part.zone.on[i]);
                }
                for (const end of part.zone.ends)
                    ends.push(end + total);
                total += part.count;
                if (component.useMetrics)
                    useMetrics = part;
            }
            this.loading.delete(glyph);
            count = total;
            zone = makeZone(count + 4);
            zone.ends = ends;
            zone.curX.set(xsAll);
            zone.curY.set(ysAll);
            zone.orgX.set(xsAll);
            zone.orgY.set(ysAll);
            zone.orusX.set(xsAll);
            zone.orusY.set(ysAll);
            zone.on.set(on);
            this.phantoms(zone, count, data.xMin - lsb, advance, useMetrics, data.instructions.length > 0);
            if (data.instructions.length && !(size.state.instructControl & 1)) {
                new Execution(this, size, size.twilight, zone, true).run(data.instructions, true);
            }
            return { zone, count };
        }
        count = data.xs.length;
        zone = makeZone(count + 4);
        zone.ends = data.ends;
        for (let i = 0; i < count; i++) {
            zone.orusX[i] = data.xs[i];
            zone.orusY[i] = data.ys[i];
            zone.orgX[i] = mulFix(data.xs[i], scaleFixed);
            zone.orgY[i] = mulFix(data.ys[i], scaleFixed);
            zone.on[i] = data.on[i] ? 1 : 0;
        }
        zone.curX.set(zone.orgX);
        zone.curY.set(zone.orgY);
        this.phantoms(zone, count, data.xMin - lsb, advance, null);
        if (data.instructions.length && !(size.state.instructControl & 1))
            new Execution(this, size, size.twilight, zone).run(data.instructions, true);
        return { zone, count };
    }
    phantoms(zone, count, origin, advance, metrics, round = true) {
        const font = this.font;
        const units = [origin, origin + advance, font.ascender, font.descender];
        const org = units.map(v => mulFix(v, this.scaleFixed));
        zone.orusX[count] = units[0];
        zone.orusX[count + 1] = units[1];
        zone.orusY[count + 2] = units[2];
        zone.orusY[count + 3] = units[3];
        const grid = (v) => round ? Math.round(v / 64) * 64 : v;
        zone.orgX[count] = org[0];
        zone.orgX[count + 1] = org[1];
        zone.curX[count] = grid(org[0]);
        zone.curX[count + 1] = grid(org[1]);
        zone.orgY[count + 2] = org[2];
        zone.orgY[count + 3] = org[3];
        zone.curY[count + 2] = grid(org[2]);
        zone.curY[count + 3] = grid(org[3]);
        if (metrics) {
            for (const k of [0, 1]) {
                zone.orusX[count + k] = metrics.zone.orusX[metrics.count + k];
                zone.orgX[count + k] = metrics.zone.orgX[metrics.count + k];
                zone.curX[count + k] = metrics.zone.curX[metrics.count + k];
            }
        }
    }
}
class Execution {
    hinter;
    size;
    gs;
    zones;
    stack = [];
    callDepth = 0;
    steps = 0;
    isGlyph = false;
    unitsScale;
    constructor(hinter, size, twilight, glyph, composite = false) {
        this.hinter = hinter;
        this.size = size;
        const s = size.state;
        this.gs = { ...s, pv: { ...s.pv }, fv: { ...s.fv }, dv: { ...s.dv } };
        this.zones = [twilight, glyph];
        this.unitsScale = composite ? 0x10000 : size.scaleFixed;
    }
    run(code, glyph = false) {
        this.isGlyph = glyph;
        if (glyph) {
            const gs = this.gs;
            gs.pv = gs.fv = gs.dv = X_AXIS;
            gs.rp0 = gs.rp1 = gs.rp2 = 0;
            gs.zp0 = gs.zp1 = gs.zp2 = 1;
            gs.loop = 1;
            gs.round = ROUND_GRID;
            const t = this.zones[0];
            t.curX.fill(0);
            t.curY.fill(0);
            t.orgX.fill(0);
            t.orgY.fill(0);
            t.touchX.fill(0);
            t.touchY.fill(0);
        }
        this.execute(code, 0, code.length);
    }
    pop() {
        return this.stack.length ? this.stack.pop() : 0;
    }
    push(v) {
        if (this.stack.length > Math.max(this.hinter.maxStack, 256) + 64)
            throw new HintError('stack overflow');
        this.stack.push(v);
    }
    zone(n) {
        if (n !== 0 && n !== 1)
            throw new SkipInstruction();
        return this.zones[n];
    }
    point(zone, p) {
        if (!(p >= 0 && p < zone.curX.length))
            throw new SkipInstruction();
        return p;
    }
    project(dx, dy) {
        return dotFix14(dx, dy, this.gs.pv.x, this.gs.pv.y);
    }
    dualProject(dx, dy) {
        return dotFix14(dx, dy, this.gs.dv.x, this.gs.dv.y);
    }
    moveVector() {
        const { fv, pv } = this.gs;
        const dot = Math.floor((pv.x * fv.x + pv.y * fv.y + 0x2000) / 0x4000);
        if (dot >= 0x3ffe)
            return { x: fv.x * 4, y: fv.y * 4 };
        if (dot > -0x1555 && dot < 0x1555)
            return { x: 0, y: 0 };
        return { x: Math.trunc(fv.x * 0x10000 / dot), y: Math.trunc(fv.y * 0x10000 / dot) };
    }
    move(zone, p, distance) {
        const mv = this.moveVector();
        if (mv.x !== 0) {
            zone.curX[p] += mulFix(distance, mv.x);
            zone.touchX[p] = 1;
        }
        if (mv.y !== 0) {
            zone.curY[p] += mulFix(distance, mv.y);
            zone.touchY[p] = 1;
        }
    }
    moveOriginal(zone, p, distance) {
        const mv = this.moveVector();
        if (mv.x !== 0)
            zone.orgX[p] += mulFix(distance, mv.x);
        if (mv.y !== 0)
            zone.orgY[p] += mulFix(distance, mv.y);
    }
    round(d) {
        const r = this.gs.round;
        if (!r)
            return d;
        if (d >= 0) {
            const v = Math.floor((d - r.phase + r.threshold) / r.period) * r.period + r.phase;
            return v < 0 ? r.phase : v;
        }
        const v = -(Math.floor((-d - r.phase + r.threshold) / r.period) * r.period + r.phase);
        return v > 0 ? -r.phase : v;
    }
    lineVector(p1, p2, perpendicular, original, current) {
        const z1 = this.zone(this.gs.zp1), z2 = this.zone(this.gs.zp2);
        this.point(z1, p1);
        this.point(z2, p2);
        let x = (original ? z1.orgX[p1] - z2.orgX[p2] : z1.curX[p1] - z2.curX[p2]);
        let y = (original ? z1.orgY[p1] - z2.orgY[p2] : z1.curY[p1] - z2.curY[p2]);
        if (x === 0 && y === 0) {
            x = 0x4000;
            y = 0;
            perpendicular = false;
        }
        if (perpendicular)
            [x, y] = [-y, x];
        return normalize(x, y) ?? current;
    }
    originalDistance(za, a, zb, b, twilight = za === 0 || zb === 0, round = true) {
        const A = this.zones[za], B = this.zones[zb];
        if (twilight)
            return this.dualProject(A.orgX[a] - B.orgX[b], A.orgY[a] - B.orgY[b]);
        const d = this.dualProject(A.orusX[a] - B.orusX[b], A.orusY[a] - B.orusY[b]);
        return round ? mulFix(d, this.unitsScale) : d;
    }
    loopCount() {
        const n = this.gs.loop;
        this.gs.loop = 1;
        return n;
    }
    skip(code, ip, end, stopAtElse) {
        let depth = 0;
        while (ip < end) {
            const op = code[ip];
            if (op === 0x58)
                depth++;
            else if (op === 0x59) {
                if (depth === 0)
                    return ip;
                depth--;
            }
            else if (op === 0x1b && depth === 0 && stopAtElse)
                return ip;
            ip += instructionLength(code, ip);
        }
        throw new HintError('unterminated block');
    }
    execute(code, start, end) {
        if (++this.callDepth > 64)
            throw new HintError('calls nested too deep');
        const gs = this.gs, size = this.size;
        let ip = start;
        while (ip < end) {
            if (++this.steps > MAX_INSTRUCTIONS)
                throw new HintError('too many instructions');
            const op = code[ip];
            const length = instructionLength(code, ip);
            if (ip + length > end)
                throw new HintError('truncated instruction');
            let next = ip + length;
            const idef = size.instructions.get(op);
            if (idef) {
                this.execute(idef.code, idef.start, idef.end);
                ip = next;
                continue;
            }
            try {
                switch (op) {
                    case 0x00:
                    case 0x01: {
                        gs.pv = gs.fv = gs.dv = op & 1 ? X_AXIS : Y_AXIS;
                        break;
                    }
                    case 0x02:
                    case 0x03:
                        gs.pv = gs.dv = op & 1 ? X_AXIS : Y_AXIS;
                        break;
                    case 0x04:
                    case 0x05:
                        gs.fv = op & 1 ? X_AXIS : Y_AXIS;
                        break;
                    case 0x06:
                    case 0x07: {
                        const p2 = this.pop(), p1 = this.pop();
                        gs.pv = gs.dv = this.lineVector(p1, p2, (op & 1) === 1, false, gs.pv);
                        break;
                    }
                    case 0x08:
                    case 0x09: {
                        const p2 = this.pop(), p1 = this.pop();
                        gs.fv = this.lineVector(p1, p2, (op & 1) === 1, false, gs.fv);
                        break;
                    }
                    case 0x86:
                    case 0x87: {
                        const p2 = this.pop(), p1 = this.pop();
                        gs.dv = this.lineVector(p1, p2, (op & 1) === 1, true, gs.dv);
                        gs.pv = this.lineVector(p1, p2, (op & 1) === 1, false, gs.pv);
                        break;
                    }
                    case 0x0a:
                    case 0x0b: {
                        const y = this.pop() << 16 >> 16, x = this.pop() << 16 >> 16;
                        if (op === 0x0a)
                            gs.pv = gs.dv = normalize(x, y) ?? gs.pv;
                        else
                            gs.fv = normalize(x, y) ?? gs.fv;
                        break;
                    }
                    case 0x0c:
                    case 0x0d: {
                        const v = op === 0x0c ? gs.pv : gs.fv;
                        this.push(v.x);
                        this.push(v.y);
                        break;
                    }
                    case 0x0e:
                        gs.fv = gs.pv;
                        break;
                    case 0x0f: {
                        const b1 = this.pop(), b0 = this.pop(), a1 = this.pop(), a0 = this.pop(), p = this.pop();
                        const za = this.zone(gs.zp1), zb = this.zone(gs.zp0), z = this.zone(gs.zp2);
                        [a0, a1].forEach(i => this.point(za, i));
                        [b0, b1].forEach(i => this.point(zb, i));
                        this.point(z, p);
                        const ax0 = Math.round(za.curX[a0]), ay0 = Math.round(za.curY[a0]), ax1 = Math.round(za.curX[a1]), ay1 = Math.round(za.curY[a1]);
                        const bx0 = Math.round(zb.curX[b0]), by0 = Math.round(zb.curY[b0]), bx1 = Math.round(zb.curX[b1]), by1 = Math.round(zb.curY[b1]);
                        const dax = ax1 - ax0, day = ay1 - ay0, dbx = bx1 - bx0, dby = by1 - by0;
                        const discriminant = mulDiv(dax, -dby, 64) + mulDiv(day, dbx, 64);
                        const dotProduct = mulDiv(dax, dbx, 64) + mulDiv(day, dby, 64);
                        if (19 * Math.abs(discriminant) > Math.abs(dotProduct)) {
                            const v = mulDiv(bx0 - ax0, -dby, 64) + mulDiv(by0 - ay0, dbx, 64);
                            z.curX[p] = ax0 + mulDiv(v, dax, discriminant);
                            z.curY[p] = ay0 + mulDiv(v, day, discriminant);
                        }
                        else {
                            z.curX[p] = Math.trunc((ax0 + ax1 + bx0 + bx1) / 4);
                            z.curY[p] = Math.trunc((ay0 + ay1 + by0 + by1) / 4);
                        }
                        z.touchX[p] = z.touchY[p] = 1;
                        break;
                    }
                    case 0x10:
                        gs.rp0 = this.pop();
                        break;
                    case 0x11:
                        gs.rp1 = this.pop();
                        break;
                    case 0x12:
                        gs.rp2 = this.pop();
                        break;
                    case 0x13:
                        gs.zp0 = this.zoneNumber();
                        break;
                    case 0x14:
                        gs.zp1 = this.zoneNumber();
                        break;
                    case 0x15:
                        gs.zp2 = this.zoneNumber();
                        break;
                    case 0x16:
                        gs.zp0 = gs.zp1 = gs.zp2 = this.zoneNumber();
                        break;
                    case 0x17: {
                        const n = this.pop();
                        if (n < 0)
                            throw new HintError('invalid loop');
                        gs.loop = Math.min(n, 65535);
                        break;
                    }
                    case 0x18:
                        gs.round = ROUND_GRID;
                        break;
                    case 0x19:
                        gs.round = { period: 64, phase: 32, threshold: 32 };
                        break;
                    case 0x3d:
                        gs.round = { period: 32, phase: 0, threshold: 16 };
                        break;
                    case 0x7d:
                        gs.round = { period: 64, phase: 0, threshold: 0 };
                        break;
                    case 0x7c:
                        gs.round = { period: 64, phase: 0, threshold: 63 };
                        break;
                    case 0x7a:
                        gs.round = null;
                        break;
                    case 0x76:
                    case 0x77: {
                        const n = this.pop();
                        const grid = op === 0x76 ? 0x4000 : 0x2d41;
                        const period = [grid >> 1, grid, grid * 2, grid][n >> 6 & 3];
                        const phase = [0, period >> 2, period >> 1, Math.trunc(period * 3 / 4)][n >> 4 & 3];
                        const t = n & 15;
                        const threshold = t === 0 ? period - 1 : Math.trunc((t - 4) * period / 8);
                        gs.round = { period: period >> 8, phase: phase >> 8, threshold: threshold >> 8 };
                        break;
                    }
                    case 0x1a:
                        gs.minimumDistance = this.pop();
                        break;
                    case 0x1d:
                        gs.cvtCutIn = this.pop();
                        break;
                    case 0x1e:
                        gs.singleWidthCutIn = this.pop();
                        break;
                    case 0x1f:
                        gs.singleWidth = mulFix(this.pop(), size.scaleFixed);
                        break;
                    case 0x4d:
                        gs.autoFlip = true;
                        break;
                    case 0x4e:
                        gs.autoFlip = false;
                        break;
                    case 0x5e:
                        gs.deltaBase = this.pop();
                        break;
                    case 0x5f:
                        gs.deltaShift = this.pop();
                        break;
                    case 0x85:
                    case 0x8d:
                    case 0x7e:
                    case 0x7f:
                    case 0x4f:
                        this.pop();
                        break;
                    case 0x8e: {
                        const selector = this.pop(), value = this.pop();
                        if (!this.isGlyph && selector >= 1 && selector <= 3) {
                            const bit = 1 << selector - 1;
                            gs.instructControl = value ? gs.instructControl | bit : gs.instructControl & ~bit;
                        }
                        break;
                    }
                    case 0x20: {
                        const v = this.pop();
                        this.push(v);
                        this.push(v);
                        break;
                    }
                    case 0x21:
                        this.pop();
                        break;
                    case 0x22:
                        this.stack.length = 0;
                        break;
                    case 0x23: {
                        const b = this.pop(), a = this.pop();
                        this.push(b);
                        this.push(a);
                        break;
                    }
                    case 0x24:
                        this.push(this.stack.length);
                        break;
                    case 0x25: {
                        const k = this.pop();
                        if (k < 1 || k > this.stack.length)
                            throw new HintError('invalid index');
                        this.push(this.stack[this.stack.length - k]);
                        break;
                    }
                    case 0x26: {
                        const k = this.pop();
                        if (k < 1 || k > this.stack.length)
                            throw new HintError('invalid index');
                        this.push(this.stack.splice(this.stack.length - k, 1)[0]);
                        break;
                    }
                    case 0x8a: {
                        const a = this.pop(), b = this.pop(), c = this.pop();
                        this.push(b);
                        this.push(a);
                        this.push(c);
                        break;
                    }
                    case 0x40:
                    case 0x41:
                    case 0xb0:
                    case 0xb1:
                    case 0xb2:
                    case 0xb3:
                    case 0xb4:
                    case 0xb5:
                    case 0xb6:
                    case 0xb7:
                    case 0xb8:
                    case 0xb9:
                    case 0xba:
                    case 0xbb:
                    case 0xbc:
                    case 0xbd:
                    case 0xbe:
                    case 0xbf: {
                        const words = op === 0x41 || op >= 0xb8;
                        const count = op === 0x40 || op === 0x41 ? code[ip + 1] : (op & 7) + 1;
                        let p = ip + (op === 0x40 || op === 0x41 ? 2 : 1);
                        for (let i = 0; i < count; i++) {
                            if (words) {
                                this.push(code[p] << 24 >> 16 | code[p + 1]);
                                p += 2;
                            }
                            else
                                this.push(code[p++]);
                        }
                        break;
                    }
                    case 0x42: {
                        const v = this.pop(), l = this.pop();
                        this.storageIndex(l);
                        size.storage[l] = v;
                        break;
                    }
                    case 0x43: {
                        const l = this.pop();
                        this.push(l >= 0 && l < size.storage.length ? size.storage[l] : 0);
                        break;
                    }
                    case 0x44: {
                        const v = this.pop(), l = this.pop();
                        this.cvtIndex(l);
                        size.cvt[l] = v;
                        break;
                    }
                    case 0x70: {
                        const v = this.pop(), l = this.pop();
                        this.cvtIndex(l);
                        size.cvt[l] = mulFix(v, size.scaleFixed);
                        break;
                    }
                    case 0x45: {
                        const l = this.pop();
                        this.push(l >= 0 && l < size.cvt.length ? Math.round(size.cvt[l]) : 0);
                        break;
                    }
                    case 0x46:
                    case 0x47: {
                        const p = this.pop(), z = this.zone(gs.zp2);
                        this.point(z, p);
                        this.push(Math.round(op === 0x46 ? this.project(z.curX[p], z.curY[p]) : this.dualProject(z.orgX[p], z.orgY[p])));
                        break;
                    }
                    case 0x48: {
                        const value = this.pop(), p = this.pop(), z = this.zone(gs.zp2);
                        this.point(z, p);
                        this.move(z, p, value - this.project(z.curX[p], z.curY[p]));
                        if (gs.zp2 === 0) {
                            z.orgX[p] = z.curX[p];
                            z.orgY[p] = z.curY[p];
                        }
                        break;
                    }
                    case 0x49:
                    case 0x4a: {
                        const k = this.pop(), l = this.pop();
                        const z0 = this.zone(gs.zp0), z1 = this.zone(gs.zp1);
                        this.point(z0, l);
                        this.point(z1, k);
                        const d = op & 1 ? this.project(z0.curX[l] - z1.curX[k], z0.curY[l] - z1.curY[k])
                            : this.originalDistance(gs.zp0, l, gs.zp1, k);
                        this.push(Math.round(d));
                        break;
                    }
                    case 0x4b:
                    case 0x4c:
                        this.push(size.ppem);
                        break;
                    case 0x50: {
                        const b = this.pop(), a = this.pop();
                        this.push(a < b ? 1 : 0);
                        break;
                    }
                    case 0x51: {
                        const b = this.pop(), a = this.pop();
                        this.push(a <= b ? 1 : 0);
                        break;
                    }
                    case 0x52: {
                        const b = this.pop(), a = this.pop();
                        this.push(a > b ? 1 : 0);
                        break;
                    }
                    case 0x53: {
                        const b = this.pop(), a = this.pop();
                        this.push(a >= b ? 1 : 0);
                        break;
                    }
                    case 0x54: {
                        const b = this.pop(), a = this.pop();
                        this.push(a === b ? 1 : 0);
                        break;
                    }
                    case 0x55: {
                        const b = this.pop(), a = this.pop();
                        this.push(a !== b ? 1 : 0);
                        break;
                    }
                    case 0x56:
                    case 0x57: {
                        const v = this.round(this.pop()) >> 6 & 1;
                        this.push(op === 0x56 ? v : 1 - v);
                        break;
                    }
                    case 0x5a: {
                        const b = this.pop(), a = this.pop();
                        this.push(a && b ? 1 : 0);
                        break;
                    }
                    case 0x5b: {
                        const b = this.pop(), a = this.pop();
                        this.push(a || b ? 1 : 0);
                        break;
                    }
                    case 0x5c:
                        this.push(this.pop() ? 0 : 1);
                        break;
                    case 0x60: {
                        const b = this.pop(), a = this.pop();
                        this.push(a + b);
                        break;
                    }
                    case 0x61: {
                        const b = this.pop(), a = this.pop();
                        this.push(a - b);
                        break;
                    }
                    case 0x62: {
                        const b = this.pop(), a = this.pop();
                        if (b === 0)
                            throw new HintError('division by zero');
                        this.push(Math.trunc(a * 64 / b));
                        break;
                    }
                    case 0x63: {
                        const b = this.pop(), a = this.pop();
                        const product = a * b;
                        this.push(product < 0 ? -Math.floor((-product + 32) / 64) : Math.floor((product + 32) / 64));
                        break;
                    }
                    case 0x64:
                        this.push(Math.abs(this.pop()));
                        break;
                    case 0x65:
                        this.push(-this.pop());
                        break;
                    case 0x66:
                        this.push(Math.floor(this.pop() / 64) * 64);
                        break;
                    case 0x67:
                        this.push(Math.ceil(this.pop() / 64) * 64);
                        break;
                    case 0x8b: {
                        const b = this.pop(), a = this.pop();
                        this.push(Math.max(a, b));
                        break;
                    }
                    case 0x8c: {
                        const b = this.pop(), a = this.pop();
                        this.push(Math.min(a, b));
                        break;
                    }
                    case 0x68:
                    case 0x69:
                    case 0x6a:
                    case 0x6b:
                        this.push(Math.round(this.round(this.pop())));
                        break;
                    case 0x6c:
                    case 0x6d:
                    case 0x6e:
                    case 0x6f: break;
                    case 0x58: {
                        if (!this.pop()) {
                            const target = this.skip(code, next, end, true);
                            next = target + 1;
                        }
                        break;
                    }
                    case 0x1b:
                        next = this.skip(code, next, end, false) + 1;
                        break;
                    case 0x59: break;
                    case 0x1c:
                        next = ip + this.pop();
                        break;
                    case 0x78: {
                        const e = this.pop(), offset = this.pop();
                        if (e)
                            next = ip + offset;
                        break;
                    }
                    case 0x79: {
                        const e = this.pop(), offset = this.pop();
                        if (!e)
                            next = ip + offset;
                        break;
                    }
                    case 0x2c:
                    case 0x89: {
                        const n = this.pop();
                        let p = next;
                        while (p < end && code[p] !== 0x2d) {
                            if (code[p] === 0x2c || code[p] === 0x89)
                                throw new HintError('nested definition');
                            p += instructionLength(code, p);
                        }
                        if (p >= end)
                            throw new HintError('unterminated definition');
                        (op === 0x2c ? size.functions : size.instructions).set(n, { code, start: next, end: p });
                        next = p + 1;
                        break;
                    }
                    case 0x2d: return void this.callDepth--;
                    case 0x2b:
                    case 0x2a: {
                        const f = this.pop();
                        const count = op === 0x2a ? this.pop() : 1;
                        const def = size.functions.get(f);
                        if (!def)
                            throw new HintError('undefined function');
                        for (let i = 0; i < count; i++)
                            this.execute(def.code, def.start, def.end);
                        break;
                    }
                    case 0x88: {
                        const selector = this.pop();
                        let result = 0;
                        if (selector & 1)
                            result |= 35;
                        if (selector & 32)
                            result |= 1 << 12;
                        this.push(result);
                        break;
                    }
                    case 0x2e:
                    case 0x2f: {
                        const p = this.pop(), z = this.zone(gs.zp0);
                        this.point(z, p);
                        const d = this.project(z.curX[p], z.curY[p]);
                        this.move(z, p, op & 1 ? this.round(d) - d : 0);
                        gs.rp0 = gs.rp1 = p;
                        break;
                    }
                    case 0x3e:
                    case 0x3f: {
                        const n = this.pop(), p = this.pop(), z = this.zone(gs.zp0);
                        this.point(z, p);
                        this.cvtIndex(n);
                        let distance = size.cvt[n];
                        if (gs.zp0 === 0) {
                            z.orgX[p] = z.curX[p] = mulFix14(distance, gs.fv.x);
                            z.orgY[p] = z.curY[p] = mulFix14(distance, gs.fv.y);
                        }
                        const current = this.project(z.curX[p], z.curY[p]);
                        if (op & 1) {
                            if (Math.abs(distance - current) > gs.cvtCutIn)
                                distance = current;
                            distance = this.round(distance);
                        }
                        this.move(z, p, distance - current);
                        gs.rp0 = gs.rp1 = p;
                        break;
                    }
                    case 0x3a:
                    case 0x3b: {
                        const d = this.pop(), p = this.pop();
                        const z0 = this.zone(gs.zp0), z1 = this.zone(gs.zp1);
                        this.point(z0, gs.rp0);
                        this.point(z1, p);
                        if (gs.zp1 === 0) {
                            z1.orgX[p] = z0.orgX[gs.rp0];
                            z1.orgY[p] = z0.orgY[gs.rp0];
                            this.moveOriginal(z1, p, d);
                            z1.curX[p] = z1.orgX[p];
                            z1.curY[p] = z1.orgY[p];
                        }
                        const distance = this.project(z1.curX[p] - z0.curX[gs.rp0], z1.curY[p] - z0.curY[gs.rp0]);
                        this.move(z1, p, d - distance);
                        gs.rp1 = gs.rp0;
                        gs.rp2 = p;
                        if (op & 1)
                            gs.rp0 = p;
                        break;
                    }
                    case 0x32:
                    case 0x33:
                    case 0x34:
                    case 0x35:
                    case 0x36:
                    case 0x37: {
                        const refZoneNumber = op & 1 ? gs.zp0 : gs.zp1;
                        const refZone = this.zone(refZoneNumber), ref = op & 1 ? gs.rp1 : gs.rp2;
                        this.point(refZone, ref);
                        const d = this.project(refZone.curX[ref] - refZone.orgX[ref], refZone.curY[ref] - refZone.orgY[ref]);
                        const mv = this.moveVector();
                        const dx = mulFix(d, mv.x), dy = mulFix(d, mv.y);
                        const shift = (z, p, touch) => {
                            z.curX[p] += dx;
                            z.curY[p] += dy;
                            if (touch) {
                                if (gs.fv.x !== 0)
                                    z.touchX[p] = 1;
                                if (gs.fv.y !== 0)
                                    z.touchY[p] = 1;
                            }
                        };
                        if (op <= 0x33) {
                            const z = this.zone(gs.zp2);
                            for (let n = this.loopCount(); n > 0; n--)
                                shift(z, this.point(z, this.pop()), true);
                        }
                        else if (op <= 0x35) {
                            const c = this.pop(), z = this.zone(gs.zp2);
                            if (c < 0 || c >= z.ends.length)
                                throw new HintError('invalid contour');
                            const first = c === 0 ? 0 : z.ends[c - 1] + 1;
                            for (let p = first; p <= z.ends[c]; p++)
                                if (z !== refZone || p !== ref)
                                    shift(z, p, true);
                        }
                        else {
                            const z = this.zone(this.pop());
                            const limit = z === this.zones[1] ? z.curX.length - 4 : z.curX.length;
                            for (let p = 0; p < limit; p++)
                                if (z !== refZone || p !== ref)
                                    shift(z, p, false);
                        }
                        break;
                    }
                    case 0x38: {
                        const d = this.pop(), z = this.zone(gs.zp2);
                        for (let n = this.loopCount(); n > 0; n--) {
                            const p = this.point(z, this.pop());
                            if (gs.fv.x !== 0) {
                                z.curX[p] += mulFix14(d, gs.fv.x);
                                z.touchX[p] = 1;
                            }
                            if (gs.fv.y !== 0) {
                                z.curY[p] += mulFix14(d, gs.fv.y);
                                z.touchY[p] = 1;
                            }
                        }
                        break;
                    }
                    case 0x39: {
                        const z0 = this.zone(gs.zp0), z1 = this.zone(gs.zp1), z2 = this.zone(gs.zp2);
                        this.point(z0, gs.rp1);
                        this.point(z1, gs.rp2);
                        const curBaseX = z0.curX[gs.rp1], curBaseY = z0.curY[gs.rp1];
                        const twilight = gs.zp0 === 0 || gs.zp1 === 0 || gs.zp2 === 0;
                        const oldRange = this.originalDistance(gs.zp1, gs.rp2, gs.zp0, gs.rp1, twilight, false);
                        const curRange = this.project(z1.curX[gs.rp2] - curBaseX, z1.curY[gs.rp2] - curBaseY);
                        for (let n = this.loopCount(); n > 0; n--) {
                            const p = this.point(z2, this.pop());
                            const orgDistance = this.originalDistance(gs.zp2, p, gs.zp0, gs.rp1, twilight, false);
                            const curDistance = this.project(z2.curX[p] - curBaseX, z2.curY[p] - curBaseY);
                            const newDistance = orgDistance === 0 ? 0 : oldRange !== 0 ? mulDiv(orgDistance, curRange, oldRange) : orgDistance;
                            this.move(z2, p, newDistance - curDistance);
                        }
                        break;
                    }
                    case 0x3c: {
                        const z0 = this.zone(gs.zp0), z1 = this.zone(gs.zp1);
                        this.point(z0, gs.rp0);
                        for (let n = this.loopCount(); n > 0; n--) {
                            const p = this.point(z1, this.pop());
                            this.move(z1, p, -this.project(z1.curX[p] - z0.curX[gs.rp0], z1.curY[p] - z0.curY[gs.rp0]));
                        }
                        break;
                    }
                    case 0x27: {
                        const p2 = this.pop(), p1 = this.pop();
                        const z0 = this.zone(gs.zp0), z1 = this.zone(gs.zp1);
                        this.point(z0, p2);
                        this.point(z1, p1);
                        const d = Math.trunc(Math.round(this.project(z0.curX[p2] - z1.curX[p1], z0.curY[p2] - z1.curY[p1])) / 2);
                        this.move(z1, p1, d);
                        this.move(z0, p2, -d);
                        break;
                    }
                    case 0x29: {
                        const p = this.pop(), z = this.zone(gs.zp0);
                        this.point(z, p);
                        if (gs.fv.x !== 0)
                            z.touchX[p] = 0;
                        if (gs.fv.y !== 0)
                            z.touchY[p] = 0;
                        break;
                    }
                    case 0x30:
                    case 0x31:
                        this.interpolateUntouched(op === 0x31);
                        break;
                    case 0x80: {
                        const z = this.zone(gs.zp0);
                        for (let n = this.loopCount(); n > 0; n--) {
                            const p = this.point(z, this.pop());
                            z.on[p] ^= 1;
                        }
                        break;
                    }
                    case 0x81:
                    case 0x82: {
                        const high = this.pop(), low = this.pop(), z = this.zone(gs.zp0);
                        this.point(z, high);
                        this.point(z, low);
                        for (let p = low; p <= high; p++)
                            z.on[p] = op === 0x81 ? 1 : 0;
                        break;
                    }
                    case 0x5d:
                    case 0x71:
                    case 0x72:
                    case 0x73:
                    case 0x74:
                    case 0x75: {
                        const n = Math.max(0, Math.min(this.pop(), this.stack.length >> 1));
                        const range = op === 0x5d || op === 0x73 ? 0 : op === 0x71 || op === 0x74 ? 16 : 32;
                        for (let k = 0; k < n; k++) {
                            const target = this.pop(), arg = this.pop();
                            if ((arg >> 4 & 15) + gs.deltaBase + range !== size.ppem)
                                continue;
                            let steps = (arg & 15) - 8;
                            if (steps >= 0)
                                steps++;
                            const amount = steps * 64 / (1 << gs.deltaShift);
                            if (op <= 0x72) {
                                const z = this.zone(gs.zp0);
                                this.move(z, this.point(z, target), amount);
                            }
                            else {
                                this.cvtIndex(target);
                                size.cvt[target] += amount;
                            }
                        }
                        break;
                    }
                    default:
                        if (op >= 0xc0) {
                            this.relativePoint(op);
                            break;
                        }
                        throw new HintError(`unknown instruction 0x${op.toString(16)}`);
                }
            }
            catch (err) {
                if (!(err instanceof SkipInstruction))
                    throw err;
            }
            ip = next;
        }
        this.callDepth--;
    }
    zoneNumber() {
        const n = this.pop();
        if (n !== 0 && n !== 1)
            throw new SkipInstruction();
        return n;
    }
    storageIndex(l) {
        if (!(l >= 0 && l < this.size.storage.length))
            throw new SkipInstruction();
    }
    cvtIndex(l) {
        if (!(l >= 0 && l < this.size.cvt.length))
            throw new SkipInstruction();
    }
    relativePoint(op) {
        const gs = this.gs, size = this.size;
        const indirect = op >= 0xe0;
        const setRp0 = (op & 16) !== 0, keepMinimum = (op & 8) !== 0, round = (op & 4) !== 0;
        const n = indirect ? this.pop() : -1;
        const p = this.pop();
        const z0 = this.zone(gs.zp0), z1 = this.zone(gs.zp1);
        if (!(p >= 0 && p < z1.curX.length && gs.rp0 >= 0 && gs.rp0 < z0.curX.length && (!indirect || n >= -1 && n < size.cvt.length))) {
            gs.rp1 = gs.rp0;
            gs.rp2 = p;
            if (setRp0)
                gs.rp0 = p;
            return;
        }
        const orgDistance = indirect ? this.dualProject(z1.orgX[p] - z0.orgX[gs.rp0], z1.orgY[p] - z0.orgY[gs.rp0])
            : this.originalDistance(gs.zp1, p, gs.zp0, gs.rp0);
        const curDistance = this.project(z1.curX[p] - z0.curX[gs.rp0], z1.curY[p] - z0.curY[gs.rp0]);
        let distance;
        if (indirect) {
            let cvt = n < 0 ? 0 : size.cvt[n];
            if (Math.abs(cvt - gs.singleWidth) < gs.singleWidthCutIn)
                cvt = cvt >= 0 ? gs.singleWidth : -gs.singleWidth;
            if (gs.zp1 === 0) {
                z1.orgX[p] = z0.orgX[gs.rp0] + mulFix14(cvt, gs.fv.x);
                z1.orgY[p] = z0.orgY[gs.rp0] + mulFix14(cvt, gs.fv.y);
                z1.curX[p] = z1.orgX[p];
                z1.curY[p] = z1.orgY[p];
            }
            if (gs.autoFlip && (orgDistance ^ cvt) < 0 && orgDistance !== 0 && cvt !== 0)
                cvt = -cvt;
            if (round) {
                if (gs.zp0 === gs.zp1 && Math.abs(cvt - orgDistance) > gs.cvtCutIn)
                    cvt = orgDistance;
                distance = this.round(cvt);
            }
            else
                distance = cvt;
        }
        else {
            let d = orgDistance;
            if (Math.abs(d - gs.singleWidth) < gs.singleWidthCutIn)
                d = d >= 0 ? gs.singleWidth : -gs.singleWidth;
            distance = round ? this.round(d) : d;
        }
        if (keepMinimum) {
            if (orgDistance >= 0) {
                if (distance < gs.minimumDistance)
                    distance = gs.minimumDistance;
            }
            else if (distance > -gs.minimumDistance)
                distance = -gs.minimumDistance;
        }
        const current = indirect && gs.zp1 === 0 ? this.project(z1.curX[p] - z0.curX[gs.rp0], z1.curY[p] - z0.curY[gs.rp0]) : curDistance;
        this.move(z1, p, distance - current);
        gs.rp1 = gs.rp0;
        gs.rp2 = p;
        if (setRp0)
            gs.rp0 = p;
    }
    interpolateUntouched(x) {
        const z = this.zones[1];
        const cur = x ? z.curX : z.curY, org = x ? z.orgX : z.orgY, orus = x ? z.orusX : z.orusY, touched = x ? z.touchX : z.touchY;
        let first = 0;
        const interpolate = (from, to, a, b) => {
            if (from > to)
                return;
            if (orus[a] > orus[b])
                [a, b] = [b, a];
            const org1 = org[a], org2 = org[b], cur1 = cur[a], cur2 = cur[b];
            const delta1 = cur1 - org1, delta2 = cur2 - org2;
            const flat = cur1 === cur2 || orus[a] === orus[b];
            const factor = flat ? 0 : divFix(cur2 - cur1, orus[b] - orus[a]);
            for (let p = from; p <= to; p++) {
                const o = org[p];
                if (o <= org1)
                    cur[p] = o + delta1;
                else if (o >= org2)
                    cur[p] = o + delta2;
                else
                    cur[p] = flat ? cur1 : cur1 + mulFix(orus[p] - orus[a], factor);
            }
        };
        for (const last of z.ends) {
            let p = first;
            while (p <= last && !touched[p])
                p++;
            if (p > last) {
                first = last + 1;
                continue;
            }
            const firstTouched = p;
            let current = p;
            for (p++; p <= last; p++) {
                if (!touched[p])
                    continue;
                interpolate(current + 1, p - 1, current, p);
                current = p;
            }
            if (current === firstTouched) {
                const d = cur[current] - org[current];
                if (d !== 0)
                    for (let i = first; i <= last; i++)
                        if (i !== current)
                            cur[i] += d;
            }
            else {
                interpolate(current + 1, last, current, firstTouched);
                if (firstTouched > first)
                    interpolate(first, firstTouched - 1, current, firstTouched);
            }
            first = last + 1;
        }
    }
}
function instructionLength(code, ip) {
    const op = code[ip];
    if (op === 0x40)
        return 2 + code[ip + 1];
    if (op === 0x41)
        return 2 + 2 * code[ip + 1];
    if (op >= 0xb0 && op <= 0xb7)
        return 2 + (op & 7);
    if (op >= 0xb8 && op <= 0xbf)
        return 1 + 2 * ((op & 7) + 1);
    return 1;
}
