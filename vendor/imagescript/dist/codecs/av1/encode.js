import { SymbolEncoder } from "./msac-enc.js";
import { RESTORATION_NONE } from "./obu.js";
import { HeaderWriter, obu, writeSequenceHeader, writeFrameHeader, OBU_FRAME } from "./obu-enc.js";
import { Frame } from "./decode.js";
import { CDF, BLOCK_DIMENSIONS, TXFM_DIMENSIONS, MAX_TXFM_SIZE_FOR_BS, AL_PART_CTX, BLOCK_SIZES, PARTITION_TYPE_COUNT, INTRA_MODE_CONTEXT, TXTP_FROM_UVMODE, TX_TYPES_PER_SET, LO_CTX_OFFSETS, SKIP_CTX, CFL_ALLOWED_MASK, BL_64X64, BL_8X8, PARTITION_NONE, PARTITION_H, PARTITION_V, PARTITION_SPLIT, PARTITION_T_TOP_SPLIT, PARTITION_T_LEFT_SPLIT, PARTITION_T_RIGHT_SPLIT, PARTITION_H4, PARTITION_V4, DC_PRED, VERT_PRED, HOR_PRED, VERT_LEFT_PRED, SMOOTH_PRED, SMOOTH_V_PRED, SMOOTH_H_PRED, PAETH_PRED, CFL_PRED, TX_4X4, TX_64X64, TX_16X16, RTX_4X8, DCT_DCT, IDTX, WHT_WHT, EDGE_I444_TOP_HAS_RIGHT, EDGE_I444_LEFT_HAS_BOTTOM, EDGE_I420_TOP_HAS_RIGHT, EDGE_I420_LEFT_HAS_BOTTOM, edgeTree, defaultCdfs, scan, dequant } from "./tables.js";
import { prepareEdges, predict, preparedAngle, cflAc, cflPredict, ANGLE_USE_EDGE_FILTER, ANGLE_SMOOTH_EDGE } from "./ipred.js";
import { inverseTransformAdd } from "./itx.js";
import { forwardTransform, forwardWht, pixelEnergy } from "./fdct.js";
import { deblock } from "./loopfilter.js";
import { cdef } from "./cdef.js";
import { paletteColors, colorRanks, colorIndexBits } from "./palette.js";
const ADST_DCT = 1, DCT_ADST = 2, ADST_ADST = 3;
const bdim = (bs, i) => BLOCK_DIMENSIONS[bs * 4 + i];
const tdim = (tx, i) => TXFM_DIMENSIONS[tx * 8 + i];
const W = 0, H = 1, LW = 2, LH = 3, MIN = 4, MAX = 5, SUB = 6, CTX = 7;
const isDirectional = (mode) => mode >= VERT_PRED && mode <= VERT_LEFT_PRED;
const smFlag = (mode) => mode === SMOOTH_PRED || mode === SMOOTH_H_PRED || mode === SMOOTH_V_PRED ? ANGLE_SMOOTH_EDGE : 0;
const ZERO_BITS = 0.6;
const coefBits = (q) => q === 0 ? ZERO_BITS : q === 1 ? 2.2 : q === 2 ? 3.4 : q < 15 ? 4.6 + Math.log2(q - 2) : 9 + 2 * Math.log2(q - 14);
const mostlyFew = (counts, n) => {
    if (counts.length <= 8)
        return true;
    const top = counts.slice().sort((a, b) => b - a);
    let sum = 0;
    for (let i = 0; i < 8; i++)
        sum += top[i];
    return sum >= n * 0.7;
};
class TileEncoder {
    f;
    src;
    params;
    seq;
    hdr;
    ssx;
    ssy;
    cdf;
    w = null;
    bx = 0;
    by = 0;
    colStart = 0;
    colEnd = 0;
    rowStart = 0;
    rowEnd = 0;
    dq;
    lambda;
    aMode;
    lMode = new Uint8Array(32);
    aLcoef;
    lLcoef = new Uint8Array(32);
    aCcoef;
    lCcoef = [new Uint8Array(32), new Uint8Array(32)];
    aSkip;
    lSkip = new Uint8Array(32);
    aUvmode;
    lUvmode = new Uint8Array(32);
    aPartition;
    lPartition = new Uint8Array(16);
    aPalSz;
    lPalSz = new Uint8Array(32);
    aPalSzUv;
    lPalSzUv = new Uint8Array(32);
    aPal;
    lPal = new Uint16Array(32 * 24);
    aTxIntra;
    lTxIntra = new Int8Array(32);
    cf = new Int32Array(32 * 32);
    coefs = new Float64Array(32 * 32);
    q = new Int32Array(32 * 32);
    res = new Float64Array(64 * 64);
    levels = new Uint8Array(36 * 36);
    rdoKeep = new Float64Array(32 * 32);
    whtRes = new Int32Array(16);
    whtOut = new Int32Array(16);
    lossless;
    cdefChoice;
    rdoDrop = new Float64Array(32 * 32);
    ac = new Int16Array(32 * 32);
    pairCounts = new Uint32Array(65536);
    bits = 0;
    coded = false;
    static aboveBytes(f) {
        const n = f.b4Stride + 32;
        return 10 * n + (n >> 1) + 1 + 48 * n;
    }
    constructor(f, src, params, above) {
        this.f = f;
        this.src = src;
        this.params = params;
        this.seq = f.seq;
        this.hdr = f.hdr;
        this.ssx = f.ssx;
        this.ssy = f.ssy;
        const n = f.b4Stride + 32, buffer = above ?? new ArrayBuffer(TileEncoder.aboveBytes(f));
        let o = 0;
        const bytes = (length) => new Uint8Array(buffer, (o += length) - length, length);
        this.aMode = bytes(n);
        this.aLcoef = bytes(n);
        this.aCcoef = [bytes(n), bytes(n)];
        this.aSkip = bytes(n);
        this.aUvmode = bytes(n);
        this.aPartition = bytes(n >> 1);
        this.aPalSz = bytes(n);
        this.aPalSzUv = bytes(n);
        this.aTxIntra = new Int8Array(buffer, (o += n) - n, n);
        this.aPal = new Uint16Array(buffer, o + 1 & ~1, n * 24);
        this.cdefChoice = new Int8Array(f.cdefIdx.length);
        this.lossless = this.hdr.allLossless;
        const q = this.hdr.quant;
        this.dq = [[dequant(0, q.yac, 0), dequant(0, q.yac, 1)], [dequant(0, q.yac + q.udcDelta, 0), dequant(0, q.yac + q.uacDelta, 1)], [dequant(0, q.yac + q.vdcDelta, 0), dequant(0, q.yac + q.vacDelta, 1)]];
        const step = this.dq[0][1] / 8;
        this.lambda = 0.08 * step * step;
    }
    resetAbove() {
        this.aUvmode.fill(DC_PRED);
        this.aMode.fill(DC_PRED);
        this.aPartition.fill(0);
        this.aSkip.fill(0);
        this.aLcoef.fill(0x40);
        this.aCcoef[0].fill(0x40);
        this.aCcoef[1].fill(0x40);
        this.aPalSz.fill(0);
        this.aPalSzUv.fill(0);
        this.aTxIntra.fill(-1);
    }
    resetLeft() {
        this.lUvmode.fill(DC_PRED);
        this.lMode.fill(DC_PRED);
        this.lPartition.fill(0);
        this.lSkip.fill(0);
        this.lLcoef.fill(0x40);
        this.lCcoef[0].fill(0x40);
        this.lCcoef[1].fill(0x40);
        this.lPalSz.fill(0);
        this.lPalSzUv.fill(0);
        this.lTxIntra.fill(-1);
    }
    tile(tileRow, tileCol) {
        const f = this.f, t = this.hdr.tiles;
        this.colStart = t.colStarts[tileCol] << 4;
        this.colEnd = Math.min(t.colStarts[tileCol + 1] << 4, f.bw);
        this.rowStart = t.rowStarts[tileRow] << 4;
        this.rowEnd = Math.min(t.rowStarts[tileRow + 1] << 4, f.bh);
    }
    searchTile(tileRow, tileCol) {
        this.tile(tileRow, tileCol);
        const root = edgeTree(false), nodes = [];
        this.resetAbove();
        for (this.by = this.rowStart; this.by < this.rowEnd; this.by += 16) {
            this.resetLeft();
            for (this.bx = this.colStart; this.bx < this.colEnd; this.bx += 16)
                nodes.push(this.search(BL_64X64, root).node);
        }
        return nodes;
    }
    startTile(tileRow, tileCol) {
        this.tile(tileRow, tileCol);
        this.resetAbove();
        return this.rowEnd - this.rowStart + 15 >> 4;
    }
    searchRow(tileRow, tileCol, row, progress) {
        this.tile(tileRow, tileCol);
        const root = edgeTree(false), nodes = [], n = this.colEnd - this.colStart + 15 >> 4;
        this.by = this.rowStart + row * 16;
        this.resetLeft();
        for (let k = 0; k < n; k++) {
            if (row) {
                const need = Math.min(k + 2, n);
                for (let v; (v = Atomics.load(progress, row - 1)) < need;)
                    Atomics.wait(progress, row - 1, v);
            }
            this.bx = this.colStart + k * 16;
            nodes.push(this.search(BL_64X64, root).node);
            Atomics.store(progress, row, k + 1);
            Atomics.notify(progress, row);
        }
        return nodes;
    }
    storeTile(tileRow, tileCol, nodes) {
        this.tile(tileRow, tileCol);
        let i = 0;
        for (this.by = this.rowStart; this.by < this.rowEnd; this.by += 16) {
            for (this.bx = this.colStart; this.bx < this.colEnd; this.bx += 16)
                this.walk(BL_64X64, nodes[i++]);
        }
    }
    walk(bl, n) {
        const f = this.f, hsz = 16 >> bl;
        if (n.bp === PARTITION_NONE) {
            const b = n.b;
            this.storeBlock(BLOCK_SIZES[(bl * 10 + PARTITION_NONE) * 2], b);
            if (!b.skip)
                f.cdefIdx[(this.by >> 4) * (f.b4Stride >> 4) + (this.bx >> 4)] = 0;
            return;
        }
        if (n.bp === PARTITION_H || n.bp === PARTITION_V) {
            const bs = BLOCK_SIZES[(bl * 10 + n.bp) * 2], dx = n.bp === PARTITION_V ? hsz : 0, dy = n.bp === PARTITION_H ? hsz : 0;
            for (let k = 0; k < 2; k++) {
                const b = n.kids[k].b;
                this.storeBlock(bs, b);
                if (!b.skip)
                    f.cdefIdx[(this.by >> 4) * (f.b4Stride >> 4) + (this.bx >> 4)] = 0;
                this.bx += dx;
                this.by += dy;
            }
            this.bx -= 2 * dx;
            this.by -= 2 * dy;
            return;
        }
        for (let k = 0; k < 4; k++) {
            if (!n.kids[k])
                continue;
            const dx = k & 1 ? hsz : 0, dy = k & 2 ? hsz : 0;
            this.bx += dx;
            this.by += dy;
            this.walk(bl + 1, n.kids[k]);
            this.bx -= dx;
            this.by -= dy;
        }
    }
    writeTile(tileRow, tileCol, nodes) {
        this.tile(tileRow, tileCol);
        const root = edgeTree(false);
        this.cdf = defaultCdfs(this.hdr.quant.yac);
        this.w = new SymbolEncoder(!this.hdr.disableCdfUpdate);
        this.resetAbove();
        let i = 0;
        for (this.by = this.rowStart; this.by < this.rowEnd; this.by += 16) {
            this.resetLeft();
            for (this.bx = this.colStart; this.bx < this.colEnd; this.bx += 16) {
                this.writeSb(BL_64X64, root, nodes[i++]);
            }
        }
        const data = this.w.finish();
        this.w = null;
        return data;
    }
    search(bl, node) {
        const f = this.f, hsz = 16 >> bl;
        const haveH = f.bw > this.bx + hsz, haveV = f.bh > this.by + hsz;
        const split = (quarters) => {
            const kids = [null, null, null, null];
            let cost = 0;
            for (const k of quarters) {
                const dx = k & 1 ? hsz : 0, dy = k & 2 ? hsz : 0;
                this.bx += dx;
                this.by += dy;
                const r = this.search(bl + 1, node.split[k]);
                this.bx -= dx;
                this.by -= dy;
                kids[k] = r.node;
                cost += r.cost;
            }
            return { node: { bp: PARTITION_SPLIT, b: null, kids }, cost };
        };
        if (!haveH && !haveV)
            return split([0]);
        if (!haveH)
            return split([0, 2]);
        if (!haveV)
            return split([0, 1]);
        const bs = BLOCK_SIZES[(bl * 10 + PARTITION_NONE) * 2];
        if (bl === BL_8X8) {
            const r = this.searchBlock(bs, node.o);
            return { node: { bp: PARTITION_NONE, b: r.b, kids: [] }, cost: r.cost };
        }
        const saved = this.saveArea(bl), entryContexts = this.saveContexts(bs);
        let result, noneCost, splitCost;
        if (bl <= BL_64X64 + 1) {
            const sp = split([0, 1, 2, 3]);
            const deeper = sp.node.kids.filter(k => k && k.bp === PARTITION_SPLIT).length;
            if (this.params.effort < 2 && deeper >= (bl === BL_64X64 ? 2 : 4))
                return { node: sp.node, cost: sp.cost + this.lambda * 2 };
            const spArea = this.saveArea(bl), contexts = this.saveContexts(bs);
            this.restoreArea(bl, saved);
            const none = this.searchBlock(bs, node.o);
            noneCost = none.cost + this.lambda;
            splitCost = sp.cost + this.lambda * 2;
            if (noneCost < splitCost)
                result = { node: { bp: PARTITION_NONE, b: none.b, kids: [] }, cost: noneCost };
            else {
                this.restoreArea(bl, spArea);
                this.restoreContexts(contexts);
                result = { node: sp.node, cost: splitCost };
            }
        }
        else {
            const none = this.searchBlock(bs, node.o);
            if ((none.b.skip || none.bits < 30) && this.params.effort < 2)
                return { node: { bp: PARTITION_NONE, b: none.b, kids: [] }, cost: none.cost + this.lambda };
            const noneArea = this.saveArea(bl);
            this.restoreArea(bl, saved);
            const sp = split([0, 1, 2, 3]);
            noneCost = none.cost + this.lambda;
            splitCost = sp.cost + this.lambda * 2;
            if (noneCost < splitCost) {
                this.restoreArea(bl, noneArea);
                this.modeContexts(bs, none.b);
                result = { node: { bp: PARTITION_NONE, b: none.b, kids: [] }, cost: noneCost };
            }
            else
                result = { node: sp.node, cost: splitCost };
        }
        const ratio = noneCost / splitCost, deeper = result.node.bp === PARTITION_SPLIT ? result.node.kids.filter(k => k && k.bp !== PARTITION_NONE).length : 0;
        if (this.params.effort && ratio >= 0.9 && ratio < 1.3 && deeper <= 1) {
            let bestArea = this.saveArea(bl), bestContexts = this.saveContexts(bs);
            for (const bp of this.params.effort > 1 ? [PARTITION_H, PARTITION_V] : [this.halvesDirection(bs)]) {
                this.restoreArea(bl, saved);
                this.restoreContexts(entryContexts);
                const r = this.halves(bl, bp, node);
                if (r.cost < result.cost) {
                    result = r;
                    bestArea = this.saveArea(bl);
                    bestContexts = this.saveContexts(bs);
                }
            }
            this.restoreArea(bl, bestArea);
            this.restoreContexts(bestContexts);
        }
        return result;
    }
    halvesDirection(bs) {
        const f = this.f, stride = f.strides[0], src = this.src[0];
        const w = Math.min(bdim(bs, 0), f.bw - this.bx) * 4, h = Math.min(bdim(bs, 1), f.bh - this.by) * 4, o = this.by * 4 * stride + this.bx * 4;
        let top = 0, left = 0, all = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const v = src[o + y * stride + x];
                all += v;
                if (y < h >> 1)
                    top += v;
                if (x < w >> 1)
                    left += v;
            }
        }
        return Math.abs(2 * top - all) >= Math.abs(2 * left - all) ? PARTITION_H : PARTITION_V;
    }
    halves(bl, bp, node) {
        const hsz = 16 >> bl, bs = BLOCK_SIZES[(bl * 10 + bp) * 2], edges = bp === PARTITION_H ? node.h : node.v;
        const dx = bp === PARTITION_V ? hsz : 0, dy = bp === PARTITION_H ? hsz : 0;
        const first = this.searchBlock(bs, edges[0]);
        this.bx += dx;
        this.by += dy;
        const second = this.searchBlock(bs, edges[1]);
        this.bx -= dx;
        this.by -= dy;
        const leaf = (b) => ({ bp: PARTITION_NONE, b, kids: [] });
        return { node: { bp, b: null, kids: [leaf(first.b), leaf(second.b)] }, cost: first.cost + second.cost + this.lambda * 3 };
    }
    saveArea(bl) {
        const f = this.f, n = 64 >> (bl - 1);
        return f.planes.map((plane, p) => {
            const sx = p ? this.ssx : 0, sy = p ? this.ssy : 0, stride = f.strides[p];
            const w = n >> sx, h = n >> sy, x0 = this.bx * 4 >> sx, y0 = this.by * 4 >> sy, out = new Uint16Array(w * h);
            for (let y = 0; y < h; y++)
                out.set(plane.subarray((y0 + y) * stride + x0, (y0 + y) * stride + x0 + w), y * w);
            return out;
        });
    }
    restoreArea(bl, saved) {
        const f = this.f, n = 64 >> (bl - 1);
        f.planes.forEach((plane, p) => {
            const sx = p ? this.ssx : 0, sy = p ? this.ssy : 0, stride = f.strides[p];
            const w = n >> sx, h = n >> sy, x0 = this.bx * 4 >> sx, y0 = this.by * 4 >> sy;
            for (let y = 0; y < h; y++)
                plane.set(saved[p].subarray(y * w, y * w + w), (y0 + y) * stride + x0);
        });
    }
    searchBlock(bs, edgeFlags) {
        const f = this.f, layout = f.layout;
        const lw4 = bdim(bs, 2), lh4 = bdim(bs, 3);
        const b = {
            skip: 0, yMode: DC_PRED, yAngle: 0, uvMode: DC_PRED, uvAngle: 0, cflAlpha: [0, 0],
            tx: this.lossless ? TX_4X4 : MAX_TXFM_SIZE_FOR_BS[bs * 4], txtp: this.lossless ? WHT_WHT : DCT_DCT,
            uvtx: this.lossless ? TX_4X4 : MAX_TXFM_SIZE_FOR_BS[bs * 4 + layout],
            palSz: [0, 0], pal: new Uint16Array(24), palIdx: null, palIdxUv: null
        };
        const palAllowed = this.hdr.allowScreenContentTools && Math.max(bdim(bs, 0), bdim(bs, 1)) <= 16 && bdim(bs, 0) + bdim(bs, 1) >= 4;
        const lambda = this.lambda, sadLambda = Math.sqrt(lambda);
        const angles = lw4 + lh4 >= 2 && this.params.effort > 1 ? [-3, -2, -1, 0, 1, 2, 3] : [0];
        const candidates = [];
        for (let mode = DC_PRED; mode <= PAETH_PRED; mode++) {
            for (const angle of isDirectional(mode) ? angles : [0]) {
                b.yMode = mode;
                b.yAngle = angle;
                this.predictLuma(bs, edgeFlags, b);
                candidates.push({ mode, angle, est: this.satd(0, bs) + sadLambda * (mode === DC_PRED ? 2 : 4.5 + (isDirectional(mode) && lw4 + lh4 >= 2 ? 1.5 : 0)) });
            }
        }
        const directional = candidates.filter(c => isDirectional(c.mode)).sort((x, y) => x.est - y.est)[0];
        if (this.params.effort === 1 && lw4 + lh4 >= 2 && directional && directional.est <= 1.2 * Math.min(...candidates.map(c => c.est))) {
            for (const angle of [-3, -2, -1, 1, 2, 3]) {
                b.yMode = directional.mode;
                b.yAngle = angle;
                this.predictLuma(bs, edgeFlags, b);
                candidates.push({ mode: directional.mode, angle, est: this.satd(0, bs) + sadLambda * 6 });
            }
        }
        candidates.sort((x, y) => x.est - y.est);
        let best = Infinity, bestMode = candidates[0], dist = 0, bits = 0, coded = false, kept = null, bestTx = DCT_DCT;
        const close = this.params.effort < 2 ? 1.1 : Infinity;
        const tries = candidates.slice(0, [1, 2, 3][this.params.effort]).filter(c => c.est <= candidates[0].est * close);
        for (const [i, c] of tries.entries()) {
            b.yMode = c.mode;
            b.yAngle = c.angle;
            const d = this.codeLuma(bs, edgeFlags, b);
            const cost = d + lambda * (this.bits + (c.mode === DC_PRED ? 2 : 4.5));
            if (cost < best) {
                best = cost;
                bestMode = c;
                dist = d;
                bits = this.bits;
                coded = this.coded;
                if (i < tries.length - 1)
                    kept = this.savePlane(0, bs);
                else
                    kept = null;
            }
        }
        b.yMode = bestMode.mode;
        b.yAngle = bestMode.angle;
        if (kept)
            this.restorePlane(0, bs, kept);
        if (this.hdr.txMode === 2 && tdim(b.tx, MAX) > TX_4X4) {
            const modeBits = b.yMode === DC_PRED ? 2 : 4.5, maxDepth = Math.min(tdim(b.tx, MAX), 2);
            let keptDepth = null, bestDepthCost = best + lambda, bestTxSize = b.tx;
            for (let depth = 1, tx = b.tx; depth <= maxDepth; depth++) {
                tx = tdim(tx, SUB);
                if (!keptDepth)
                    keptDepth = this.savePlane(0, bs);
                b.tx = tx;
                const d = this.codeLuma(bs, edgeFlags, b);
                const cost = d + lambda * (this.bits + modeBits + 2 + depth);
                if (cost < bestDepthCost) {
                    bestDepthCost = best = cost;
                    dist = d;
                    bits = this.bits + 1;
                    coded = this.coded;
                    bestTxSize = tx;
                    if (depth < maxDepth)
                        keptDepth = this.savePlane(0, bs);
                }
                else if (depth === maxDepth && keptDepth)
                    this.restorePlane(0, bs, keptDepth);
            }
            b.tx = bestTxSize;
        }
        if (tdim(b.tx, MAX) <= TX_16X16 && this.params.effort && coded && !this.lossless) {
            let keptTx = this.savePlane(0, bs), bestTxCost = best + lambda;
            const single = tdim(b.tx, W) >= Math.min(bdim(bs, 0), this.f.bw - this.bx) && tdim(b.tx, H) >= Math.min(bdim(bs, 1), this.f.bh - this.by);
            let prediction = null;
            if (single) {
                this.codeLuma(bs, edgeFlags, b, true);
                prediction = this.savePlane(0, bs);
            }
            for (const txtp of [ADST_ADST, ADST_DCT, DCT_ADST, IDTX]) {
                b.txtp = txtp;
                if (prediction)
                    this.restorePlane(0, bs, prediction);
                const d = this.codeLuma(bs, edgeFlags, b, false, prediction !== null);
                const cost = d + lambda * (this.bits + 2.5 + (b.yMode === DC_PRED ? 2 : 4.5));
                if (cost < bestTxCost) {
                    bestTxCost = cost;
                    dist = d;
                    bits = this.bits + 1.5;
                    coded = this.coded;
                    keptTx = this.savePlane(0, bs);
                    bestTx = txtp;
                }
            }
            b.txtp = bestTx;
            this.restorePlane(0, bs, keptTx);
        }
        if (palAllowed) {
            const r = this.paletteLuma(bs, edgeFlags, b, dist + lambda * (bits + (b.yMode === DC_PRED ? 2 : 4.5)));
            if (r) {
                dist = r.dist;
                bits = r.bits;
                coded = r.coded;
            }
        }
        if (layout) {
            const cflAllowed = this.cflAllowed(bs);
            const uvCandidates = [];
            for (let mode = DC_PRED; mode <= (cflAllowed ? CFL_PRED : PAETH_PRED); mode++) {
                if (mode === CFL_PRED) {
                    const alpha = this.cflAlphas(bs, b);
                    if (!alpha[0] && !alpha[1])
                        continue;
                    b.uvMode = CFL_PRED;
                    b.cflAlpha = alpha;
                    this.predictChroma(bs, edgeFlags, b);
                    uvCandidates.push({ mode, angle: 0, alpha, est: this.satd(1, bs) + this.satd(2, bs) + sadLambda * 7 });
                    continue;
                }
                if (this.params.effort < 2 && mode !== b.yMode && mode !== DC_PRED && mode !== VERT_PRED && mode !== HOR_PRED && mode !== SMOOTH_PRED && mode !== PAETH_PRED)
                    continue;
                b.uvMode = mode;
                b.uvAngle = 0;
                this.predictChroma(bs, edgeFlags, b);
                uvCandidates.push({ mode, angle: 0, alpha: [0, 0], est: this.satd(1, bs) + this.satd(2, bs) + sadLambda * (mode === DC_PRED ? 1.5 : 4) });
            }
            const uvDirectional = uvCandidates.filter(c => isDirectional(c.mode)).sort((x, y) => x.est - y.est)[0];
            const uvNear = this.params.effort < 2 ? 1.2 : Infinity;
            if (this.params.effort && lw4 + lh4 >= 2 && uvDirectional && uvDirectional.est <= uvNear * Math.min(...uvCandidates.map(c => c.est))) {
                for (const angle of [-3, -2, -1, 1, 2, 3]) {
                    b.uvMode = uvDirectional.mode;
                    b.uvAngle = angle;
                    this.predictChroma(bs, edgeFlags, b);
                    uvCandidates.push({ mode: uvDirectional.mode, angle, alpha: [0, 0], est: this.satd(1, bs) + this.satd(2, bs) + sadLambda * 5.5 });
                }
            }
            uvCandidates.sort((x, y) => x.est - y.est);
            let bestUv = Infinity, bestUvMode = uvCandidates[0], uvDist = 0, uvBits = 0, uvCoded = false, keptUv = null;
            const uvClose = this.params.effort < 2 ? 1.2 : Infinity;
            const uvTries = uvCandidates.slice(0, [1, 2, 2][this.params.effort]).filter(c => c.est <= uvCandidates[0].est * uvClose);
            for (const [i, c] of uvTries.entries()) {
                b.uvMode = c.mode;
                b.uvAngle = c.angle;
                b.cflAlpha = c.alpha;
                const d = this.codeChroma(bs, edgeFlags, b);
                const cost = d + lambda * (this.bits + (c.mode === DC_PRED ? 1.5 : 4));
                if (cost < bestUv) {
                    bestUv = cost;
                    bestUvMode = c;
                    uvDist = d;
                    uvBits = this.bits;
                    uvCoded = this.coded;
                    keptUv = i < uvTries.length - 1 ? [this.savePlane(1, bs), this.savePlane(2, bs)] : null;
                }
            }
            b.uvMode = bestUvMode.mode;
            b.uvAngle = bestUvMode.angle;
            b.cflAlpha = bestUvMode.alpha;
            if (keptUv) {
                this.restorePlane(1, bs, keptUv[0]);
                this.restorePlane(2, bs, keptUv[1]);
            }
            if (palAllowed) {
                const r = this.paletteChroma(bs, edgeFlags, b, bestUv);
                if (r) {
                    uvDist = r.dist;
                    uvBits = r.bits;
                    uvCoded = r.coded;
                }
            }
            dist += uvDist;
            bits += uvBits;
            coded ||= uvCoded;
        }
        b.skip = coded ? 0 : 1;
        this.modeContexts(bs, b);
        return { b, cost: dist + lambda * (bits + 1 + 3), bits };
    }
    paletteLuma(bs, edgeFlags, b, cost) {
        const f = this.f, stride = f.strides[0], src = this.src[0];
        const bw = bdim(bs, 0) * 4, bh = bdim(bs, 1) * 4;
        const w = Math.min(bw, (f.bw - this.bx) * 4), h = Math.min(bh, (f.bh - this.by) * 4), o = this.by * 4 * stride + this.bx * 4;
        const counts = new Uint32Array(256);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
                counts[src[o + y * stride + x]]++;
        const values = [], weights = [];
        for (let v = 0; v < 256; v++)
            if (counts[v]) {
                values.push([v]);
                weights.push(counts[v]);
            }
        if (values.length < 2 || values.length > (this.params.effort ? 64 : 8) || !mostlyFew(weights, w * h))
            return null;
        if (this.lambda * (15 + 5 * Math.min(values.length - 1, 7) + 0.08 * w * h) >= cost)
            return null;
        const colors = paletteColors(values, weights, 8).map(c => c[0]), k = colors.length;
        if (k < 2)
            return null;
        const idx = new Uint8Array(bw * bh);
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const v = src[o + Math.min(y, h - 1) * stride + Math.min(x, w - 1)];
                let best = 0;
                for (let c = 1; c < k; c++)
                    if (Math.abs(colors[c] - v) < Math.abs(colors[best] - v))
                        best = c;
                idx[y * bw + x] = best;
            }
        }
        let maxDelta = 0;
        for (let c = 1; c < k; c++)
            maxDelta = Math.max(maxDelta, colors[c] - colors[c - 1] - 1);
        const overhead = 3 + 10 + (k - 1) * Math.max(5, 32 - Math.clz32(maxDelta)) + colorIndexBits(idx, bw, w, h, k);
        if (this.lambda * (overhead + 2) >= cost)
            return null;
        const kept = this.savePlane(0, bs), mode = [b.yMode, b.yAngle, b.txtp];
        b.yMode = DC_PRED;
        b.yAngle = 0;
        b.palSz[0] = k;
        b.pal.set(colors);
        b.palIdx = idx;
        let best = null, bestCost = cost;
        const txtps = tdim(b.tx, MAX) <= TX_16X16 && this.params.effort && !this.lossless ? [DCT_DCT, IDTX] : [this.lossless ? WHT_WHT : DCT_DCT];
        let keptPal = null, bestTx = DCT_DCT;
        for (const txtp of txtps) {
            b.txtp = txtp;
            const d = this.codeLuma(bs, edgeFlags, b);
            const bits = this.bits + overhead + (txtp === DCT_DCT || this.lossless ? 0 : 1.5);
            const c = d + this.lambda * (bits + 2);
            if (c < bestCost) {
                bestCost = c;
                best = { dist: d, bits, coded: this.coded };
                bestTx = txtp;
                keptPal = txtps.length > 1 && txtp !== txtps[txtps.length - 1] ? this.savePlane(0, bs) : null;
            }
            else if (best && keptPal)
                this.restorePlane(0, bs, keptPal);
        }
        if (best) {
            b.txtp = bestTx;
            return best;
        }
        [b.yMode, b.yAngle, b.txtp] = mode;
        b.palSz[0] = 0;
        b.palIdx = null;
        this.restorePlane(0, bs, kept);
        return null;
    }
    paletteChroma(bs, edgeFlags, b, cost) {
        const f = this.f, ssx = this.ssx, ssy = this.ssy, stride = f.strides[1], su = this.src[1], sv = this.src[2];
        const w4 = Math.min(bdim(bs, 0), f.bw - this.bx), h4 = Math.min(bdim(bs, 1), f.bh - this.by);
        const bw = (bdim(bs, 0) + ssx >> ssx) * 4, bh = (bdim(bs, 1) + ssy >> ssy) * 4;
        const w = (w4 + ssx >> ssx) * 4, h = (h4 + ssy >> ssy) * 4, o = (this.by * 4 >> ssy) * stride + (this.bx * 4 >> ssx);
        const counts = this.pairCounts, keys = [], limit = this.params.effort ? 64 : 8;
        for (let y = 0; y < h && keys.length <= limit; y++) {
            for (let x = 0; x < w; x++) {
                const key = su[o + y * stride + x] << 8 | sv[o + y * stride + x];
                if (!counts[key]++)
                    keys.push(key);
            }
        }
        const weights = keys.map(key => counts[key]);
        for (const key of keys)
            counts[key] = 0;
        if (keys.length < 2 || keys.length > limit || !mostlyFew(weights, w * h))
            return null;
        if (this.lambda * (13.5 + 13 * Math.min(keys.length - 1, 7) + 8 + 0.08 * w * h) >= cost)
            return null;
        const colors = paletteColors(keys.map(key => [key >> 8, key & 255]), weights, 8), k = colors.length;
        if (k < 2)
            return null;
        const idx = new Uint8Array(bw * bh);
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const p = o + Math.min(y, h - 1) * stride + Math.min(x, w - 1), u = su[p], v = sv[p];
                let best = 0, bestD = Infinity;
                for (let c = 0; c < k; c++) {
                    const d = (colors[c][0] - u) ** 2 + (colors[c][1] - v) ** 2;
                    if (d < bestD) {
                        bestD = d;
                        best = c;
                    }
                }
                idx[y * bw + x] = best;
            }
        }
        let maxDelta = 0;
        for (let c = 1; c < k; c++)
            maxDelta = Math.max(maxDelta, colors[c][0] - colors[c - 1][0]);
        const overhead = 1 + 2 + 10 + (k - 1) * Math.max(5, 32 - Math.clz32(maxDelta)) + 8 * k + colorIndexBits(idx, bw, w, h, k);
        if (this.lambda * (overhead + 1.5) >= cost)
            return null;
        const kept = [this.savePlane(1, bs), this.savePlane(2, bs)], mode = [b.uvMode, b.uvAngle], alpha = b.cflAlpha;
        b.uvMode = DC_PRED;
        b.uvAngle = 0;
        b.cflAlpha = [0, 0];
        b.palSz[1] = k;
        for (let c = 0; c < k; c++) {
            b.pal[8 + c] = colors[c][0];
            b.pal[16 + c] = colors[c][1];
        }
        b.palIdxUv = idx;
        const d = this.codeChroma(bs, edgeFlags, b), bits = this.bits + overhead;
        if (d + this.lambda * (bits + 1.5) < cost)
            return { dist: d, bits, coded: this.coded };
        [b.uvMode, b.uvAngle] = mode;
        b.cflAlpha = alpha;
        b.palSz[1] = 0;
        b.palIdxUv = null;
        this.restorePlane(1, bs, kept[0]);
        this.restorePlane(2, bs, kept[1]);
        return null;
    }
    modeContexts(bs, b) {
        const bx4 = this.bx, by4 = this.by & 31, aw = 1 << bdim(bs, 2), lh = 1 << bdim(bs, 3);
        this.aMode.fill(b.yMode, bx4, bx4 + aw);
        this.lMode.fill(b.yMode, by4, by4 + lh);
        if (this.f.layout) {
            const cbx4 = bx4 >> this.ssx, cby4 = by4 >> this.ssy;
            this.aUvmode.fill(b.uvMode, cbx4, cbx4 + (bdim(bs, 0) + this.ssx >> this.ssx));
            this.lUvmode.fill(b.uvMode, cby4, cby4 + (bdim(bs, 1) + this.ssy >> this.ssy));
        }
    }
    saveContexts(bs) {
        const bx4 = this.bx, by4 = this.by & 31, aw = bdim(bs, 0), lh = bdim(bs, 1);
        const cbx4 = bx4 >> this.ssx, cby4 = by4 >> this.ssy, cw = aw + this.ssx >> this.ssx, ch = lh + this.ssy >> this.ssy;
        return [this.aMode.slice(bx4, bx4 + aw), this.lMode.slice(by4, by4 + lh), this.aUvmode.slice(cbx4, cbx4 + cw), this.lUvmode.slice(cby4, cby4 + ch)];
    }
    restoreContexts(c) {
        const bx4 = this.bx, by4 = this.by & 31, cbx4 = bx4 >> this.ssx, cby4 = by4 >> this.ssy;
        this.aMode.set(c[0], bx4);
        this.lMode.set(c[1], by4);
        this.aUvmode.set(c[2], cbx4);
        this.lUvmode.set(c[3], cby4);
    }
    cflAllowed(bs) {
        if (!this.lossless)
            return !!(CFL_ALLOWED_MASK & 1 << bs);
        return (bdim(bs, 0) + this.ssx >> this.ssx) === 1 && (bdim(bs, 1) + this.ssy >> this.ssy) === 1;
    }
    savePlane(p, bs) {
        const f = this.f, sx = p ? this.ssx : 0, sy = p ? this.ssy : 0, stride = f.strides[p];
        const w = bdim(bs, 0) * 4 >> sx, h = bdim(bs, 1) * 4 >> sy, o = (this.by * 4 >> sy) * stride + (this.bx * 4 >> sx);
        const out = new Uint16Array(w * h);
        for (let y = 0; y < h; y++)
            out.set(f.planes[p].subarray(o + y * stride, o + y * stride + w), y * w);
        return out;
    }
    restorePlane(p, bs, saved) {
        const f = this.f, sx = p ? this.ssx : 0, sy = p ? this.ssy : 0, stride = f.strides[p];
        const w = bdim(bs, 0) * 4 >> sx, h = bdim(bs, 1) * 4 >> sy, o = (this.by * 4 >> sy) * stride + (this.bx * 4 >> sx);
        for (let y = 0; y < h; y++)
            f.planes[p].set(saved.subarray(y * w, y * w + w), o + y * stride);
    }
    satd(p, bs) {
        const f = this.f, sx = p ? this.ssx : 0, sy = p ? this.ssy : 0, stride = f.strides[p];
        const w = bdim(bs, 0) * 4 >> sx, h = bdim(bs, 1) * 4 >> sy, x0 = this.bx * 4 >> sx, y0 = this.by * 4 >> sy;
        const pred = f.planes[p], src = this.src[p];
        let sum = 0;
        for (let by = 0; by < h; by += 4) {
            for (let bx = 0; bx < w; bx += 4) {
                let o = (y0 + by) * stride + x0 + bx;
                const d00 = src[o] - pred[o], d01 = src[o + 1] - pred[o + 1], d02 = src[o + 2] - pred[o + 2], d03 = src[o + 3] - pred[o + 3];
                o += stride;
                const d10 = src[o] - pred[o], d11 = src[o + 1] - pred[o + 1], d12 = src[o + 2] - pred[o + 2], d13 = src[o + 3] - pred[o + 3];
                o += stride;
                const d20 = src[o] - pred[o], d21 = src[o + 1] - pred[o + 1], d22 = src[o + 2] - pred[o + 2], d23 = src[o + 3] - pred[o + 3];
                o += stride;
                const d30 = src[o] - pred[o], d31 = src[o + 1] - pred[o + 1], d32 = src[o + 2] - pred[o + 2], d33 = src[o + 3] - pred[o + 3];
                const a0 = d00 + d01, b0 = d00 - d01, c0 = d02 + d03, e0 = d02 - d03;
                const r00 = a0 + c0, r01 = b0 + e0, r02 = a0 - c0, r03 = b0 - e0;
                const a1 = d10 + d11, b1 = d10 - d11, c1 = d12 + d13, e1 = d12 - d13;
                const r10 = a1 + c1, r11 = b1 + e1, r12 = a1 - c1, r13 = b1 - e1;
                const a2 = d20 + d21, b2 = d20 - d21, c2 = d22 + d23, e2 = d22 - d23;
                const r20 = a2 + c2, r21 = b2 + e2, r22 = a2 - c2, r23 = b2 - e2;
                const a3 = d30 + d31, b3 = d30 - d31, c3 = d32 + d33, e3 = d32 - d33;
                const r30 = a3 + c3, r31 = b3 + e3, r32 = a3 - c3, r33 = b3 - e3;
                let a = r00 + r10, b = r00 - r10, c = r20 + r30, e = r20 - r30;
                sum += Math.abs(a + c) + Math.abs(b + e) + Math.abs(a - c) + Math.abs(b - e);
                a = r01 + r11;
                b = r01 - r11;
                c = r21 + r31;
                e = r21 - r31;
                sum += Math.abs(a + c) + Math.abs(b + e) + Math.abs(a - c) + Math.abs(b - e);
                a = r02 + r12;
                b = r02 - r12;
                c = r22 + r32;
                e = r22 - r32;
                sum += Math.abs(a + c) + Math.abs(b + e) + Math.abs(a - c) + Math.abs(b - e);
                a = r03 + r13;
                b = r03 - r13;
                c = r23 + r33;
                e = r23 - r33;
                sum += Math.abs(a + c) + Math.abs(b + e) + Math.abs(a - c) + Math.abs(b - e);
            }
        }
        return sum / 4;
    }
    cflAlphas(bs, b) {
        const f = this.f, ssx = this.ssx, ssy = this.ssy, stride = f.strides[0];
        const bw4 = bdim(bs, 0), bh4 = bdim(bs, 1);
        const w4 = Math.min(bw4, f.bw - this.bx), h4 = Math.min(bh4, f.bh - this.by);
        const cbw4 = bw4 + ssx >> ssx, cbh4 = bh4 + ssy >> ssy, cw4 = w4 + ssx >> ssx, ch4 = h4 + ssy >> ssy;
        const tw = tdim(b.tx, W), th = tdim(b.tx, H);
        const yo = 4 * (this.bx & ~ssx) + 4 * (this.by & ~ssy) * stride;
        const furthestR = ((cw4 << ssx) + tw - 1) & ~(tw - 1), furthestB = ((ch4 << ssy) + th - 1) & ~(th - 1);
        cflAc(this.ac, f.planes[0], yo, stride, cbw4 - (furthestR >> ssx), cbh4 - (furthestB >> ssy), cbw4 * 4, cbh4 * 4, ssx, ssy);
        const alphas = [0, 0], w = cbw4 * 4, h = cbh4 * 4, cstride = f.strides[1];
        const x0 = this.bx * 4 >> ssx, y0 = this.by * 4 >> ssy;
        for (let pl = 0; pl < 2; pl++) {
            const src = this.src[1 + pl];
            let mean = 0;
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++)
                    mean += src[(y0 + y) * cstride + x0 + x];
            mean /= w * h;
            let sxy = 0, sxx = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const a = this.ac[y * w + x];
                    sxy += a * (src[(y0 + y) * cstride + x0 + x] - mean);
                    sxx += a * a;
                }
            }
            alphas[pl] = sxx ? Math.max(-16, Math.min(16, Math.round(sxy / sxx * 64 / 8))) : 0;
        }
        return alphas;
    }
    predictLuma(bs, edgeFlags, b) {
        this.codeLuma(bs, edgeFlags, b, true);
    }
    predictChroma(bs, edgeFlags, b) {
        this.codeChroma(bs, edgeFlags, b, true);
    }
    codeLuma(bs, edgeFlags, b, predictOnly = false, predicted = false) {
        const f = this.f, seq = this.seq;
        const bx = this.bx, by = this.by, bx4 = bx, by4 = by & 31;
        const bw4 = bdim(bs, 0), bh4 = bdim(bs, 1);
        const w4 = Math.min(bw4, f.bw - bx), h4 = Math.min(bh4, f.bh - by);
        const tx = b.tx, tw = tdim(tx, W), th = tdim(tx, H);
        const filterFlag = seq.intraEdgeFilter ? ANGLE_USE_EDGE_FILTER : 0;
        const pic = f.planes[0], stride = f.strides[0];
        let dist = 0;
        this.bits = 0;
        this.coded = false;
        for (let initY = 0; initY < h4; initY += 16) {
            const subH4 = Math.min(h4, 16 + initY);
            for (let initX = 0; initX < w4; initX += 16) {
                const palIdx = b.palSz[0] ? b.palIdx : null;
                if (palIdx) {
                    const d = 4 * (by * stride + bx), bw = bw4 * 4;
                    for (let y = 0; y < bh4 * 4; y++)
                        for (let x = 0; x < bw; x++)
                            pic[d + y * stride + x] = b.pal[palIdx[y * bw + x]];
                }
                const intraFlags = smFlag(this.aMode[bx4]) | smFlag(this.lMode[by4]) | filterFlag;
                const sbHasTr = initX + 16 < w4 ? 1 : initY ? 0 : edgeFlags & EDGE_I444_TOP_HAS_RIGHT;
                const sbHasBl = initX ? 0 : initY + 16 < h4 ? 1 : edgeFlags & EDGE_I444_LEFT_HAS_BOTTOM;
                const subW4 = Math.min(w4, initX + 16);
                for (let y = initY; y < subH4; y += th) {
                    const ty = by + y;
                    let d = 4 * (ty * stride + bx + initX);
                    for (let x = initX; x < subW4; x += tw, d += 4 * tw) {
                        const tx4 = bx + x;
                        const flags = (((y > initY || !sbHasTr) && x + tw >= subW4) ? 0 : EDGE_I444_TOP_HAS_RIGHT) |
                            ((x > initX || (!sbHasBl && y + th >= subH4)) ? 0 : EDGE_I444_LEFT_HAS_BOTTOM);
                        if (!palIdx && !predicted) {
                            const mode = prepareEdges(tx4, tx4 > this.colStart, ty, ty > this.rowStart, this.colEnd, this.rowEnd, flags, pic, d, stride, b.yMode, b.yAngle, tw, th, seq.intraEdgeFilter, f.bitdepth);
                            predict(mode, pic, d, stride, tw * 4, th * 4, preparedAngle | intraFlags, 4 * f.bw - 4 * tx4, 4 * f.bh - 4 * ty, f.bitdepthMax);
                        }
                        if (predictOnly)
                            continue;
                        dist += this.codeTx(0, d, stride, tx, b.txtp, b, bs, this.aLcoef, bx4 + x, this.lLcoef, by4 + y, Math.min(tw, f.bw - tx4), Math.min(th, f.bh - ty), 4 * tx4, 4 * ty);
                    }
                }
            }
        }
        return dist;
    }
    codeChroma(bs, edgeFlags, b, predictOnly = false) {
        const f = this.f, seq = this.seq, ssx = this.ssx, ssy = this.ssy;
        const bx = this.bx, by = this.by, bx4 = bx, by4 = by & 31;
        const cbx4 = bx4 >> ssx, cby4 = by4 >> ssy;
        const bw4 = bdim(bs, 0), bh4 = bdim(bs, 1);
        const w4 = Math.min(bw4, f.bw - bx), h4 = Math.min(bh4, f.bh - by);
        const cw4 = w4 + ssx >> ssx, ch4 = h4 + ssy >> ssy, cbw4 = bw4 + ssx >> ssx, cbh4 = bh4 + ssy >> ssy;
        const tx = b.tx, uvtx = b.uvtx, tw = tdim(tx, W), th = tdim(tx, H), uvtw = tdim(uvtx, W), uvth = tdim(uvtx, H);
        const filterFlag = seq.intraEdgeFilter ? ANGLE_USE_EDGE_FILTER : 0;
        const stride = f.strides[0], cstride = f.strides[1];
        let dist = 0;
        this.bits = 0;
        this.coded = false;
        for (let initY = 0; initY < h4; initY += 16) {
            const subCh4 = Math.min(ch4, initY + 16 >> ssy);
            for (let initX = 0; initX < w4; initX += 16) {
                if (b.uvMode === CFL_PRED) {
                    const yo = 4 * (bx & ~ssx) + 4 * (by & ~ssy) * stride;
                    const furthestR = ((cw4 << ssx) + tw - 1) & ~(tw - 1), furthestB = ((ch4 << ssy) + th - 1) & ~(th - 1);
                    cflAc(this.ac, f.planes[0], yo, stride, cbw4 - (furthestR >> ssx), cbh4 - (furthestB >> ssy), cbw4 * 4, cbh4 * 4, ssx, ssy);
                    const uvOff = 4 * ((bx >> ssx) + (by >> ssy) * cstride);
                    for (let pl = 0; pl < 2; pl++) {
                        if (!b.cflAlpha[pl])
                            continue;
                        const xpos = bx >> ssx, ypos = by >> ssy;
                        const mode = prepareEdges(xpos, xpos > this.colStart >> ssx, ypos, ypos > this.rowStart >> ssy, this.colEnd >> ssx, this.rowEnd >> ssy, 0, f.planes[1 + pl], uvOff, cstride, DC_PRED, 0, uvtw, uvth, false, f.bitdepth);
                        cflPredict(mode, f.planes[1 + pl], uvOff, cstride, uvtw * 4, uvth * 4, this.ac, b.cflAlpha[pl], f.bitdepthMax);
                    }
                }
                else if (b.palSz[1]) {
                    const uvOff = 4 * ((bx >> ssx) + (by >> ssy) * cstride), bw = cbw4 * 4, idx = b.palIdxUv;
                    for (let pl = 1; pl <= 2; pl++) {
                        const plane = f.planes[pl];
                        for (let y = 0; y < cbh4 * 4; y++)
                            for (let x = 0; x < bw; x++)
                                plane[uvOff + y * cstride + x] = b.pal[pl * 8 + idx[y * bw + x]];
                    }
                }
                const smUv = smFlag(this.aUvmode[cbx4]) | smFlag(this.lUvmode[cby4]);
                const edge = f.layout === 1 ? [EDGE_I420_TOP_HAS_RIGHT, EDGE_I420_LEFT_HAS_BOTTOM] : [1, 8];
                const uvSbHasTr = (initX + 16 >> ssx) < cw4 ? 1 : initY ? 0 : edgeFlags & edge[0];
                const uvSbHasBl = initX ? 0 : (initY + 16 >> ssy) < ch4 ? 1 : edgeFlags & edge[1];
                const subCw4 = Math.min(cw4, initX + 16 >> ssx);
                const txtp = this.lossless ? WHT_WHT : tdim(uvtx, MAX) + 1 >= TX_64X64 ? DCT_DCT : TXTP_FROM_UVMODE[b.uvMode];
                for (let pl = 0; pl < 2; pl++) {
                    const plane = f.planes[1 + pl];
                    const aC = this.aCcoef[pl], lC = this.lCcoef[pl];
                    for (let y = initY >> ssy, tyl = by + initY; y < subCh4; y += uvth, tyl += uvth << ssy) {
                        let d = 4 * ((tyl >> ssy) * cstride + (bx + initX >> ssx));
                        for (let x = initX >> ssx, txl = bx + initX; x < subCw4; x += uvtw, txl += uvtw << ssx, d += uvtw * 4) {
                            if (!(b.uvMode === CFL_PRED && b.cflAlpha[pl]) && !b.palSz[1]) {
                                const flags = (((y > (initY >> ssy) || !uvSbHasTr) && x + uvtw >= subCw4) ? 0 : EDGE_I444_TOP_HAS_RIGHT) |
                                    ((x > (initX >> ssx) || (!uvSbHasBl && y + uvth >= subCh4)) ? 0 : EDGE_I444_LEFT_HAS_BOTTOM);
                                const uvMode = b.uvMode === CFL_PRED ? DC_PRED : b.uvMode;
                                const xpos = txl >> ssx, ypos = tyl >> ssy;
                                const mode = prepareEdges(xpos, xpos > this.colStart >> ssx, ypos, ypos > this.rowStart >> ssy, this.colEnd >> ssx, this.rowEnd >> ssy, flags, plane, d, cstride, uvMode, b.uvAngle, uvtw, uvth, seq.intraEdgeFilter, f.bitdepth);
                                predict(mode, plane, d, cstride, uvtw * 4, uvth * 4, preparedAngle | filterFlag | smUv, (4 * f.bw + ssx - 4 * (txl & ~ssx)) >> ssx, (4 * f.bh + ssy - 4 * (tyl & ~ssy)) >> ssy, f.bitdepthMax);
                            }
                            if (predictOnly)
                                continue;
                            const ctw = Math.min(uvtw, (f.bw - txl + ssx) >> ssx), cth = Math.min(uvth, (f.bh - tyl + ssy) >> ssy);
                            dist += this.codeTx(1 + pl, d, cstride, uvtx, txtp, b, bs, aC, cbx4 + x, lC, cby4 + y, ctw, cth, 4 * txl >> ssx, 4 * tyl >> ssy);
                        }
                    }
                }
            }
        }
        return dist;
    }
    codeTx(plane, d, stride, tx, txtp, b, bs, aArr, a, lArr, l, ctw, cth, px, py) {
        const f = this.f, pic = f.planes[plane], src = this.src[plane];
        const w = tdim(tx, W) * 4, h = tdim(tx, H) * 4, sw = Math.min(w, 32), sh = Math.min(h, 32);
        const sx = plane ? this.ssx : 0, sy = plane ? this.ssy : 0;
        const vw = Math.max(0, Math.min(w, (f.width + sx >> sx) - px)), vh = Math.max(0, Math.min(h, (f.height + sy >> sy) - py));
        let eob = -1;
        if (!(this.w && b.skip)) {
            const res = this.res, coefs = this.coefs, q = this.q;
            let sse = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const e = res[y * w + x] = src[d + y * stride + x] - pic[d + y * stride + x];
                    sse += e * e;
                }
            }
            if (this.lossless)
                eob = this.whtCoefs(res, q);
            else if (sse < this.zeroBound(plane, tx))
                eob = -1;
            else {
                forwardTransform(res, tx, txtp, coefs);
                eob = this.quantize(plane, tx, txtp, coefs, q, sw * sh);
            }
            if (eob >= 0)
                this.coded = true;
            if (this.w)
                this.writeCoefs(aArr, a, lArr, l, tx, txtp, bs, b, plane, eob, ctw, cth);
            else
                this.bits += this.estimateBits(tx, q, eob);
            if (eob >= 0) {
                this.dequantize(plane, tx, txtp, q, eob);
                inverseTransformAdd(pic, d, stride, this.cf, eob, tx, txtp, f.bitdepthMax);
            }
        }
        else {
            aArr.fill(0x40, a, a + tdim(tx, W));
            lArr.fill(0x40, l, l + tdim(tx, H));
        }
        let dist = 0;
        for (let y = 0; y < vh; y++) {
            for (let x = 0; x < vw; x++) {
                const e = src[d + y * stride + x] - pic[d + y * stride + x];
                dist += e * e;
            }
        }
        return dist;
    }
    zeroBound(plane, tx) {
        const step = Math.min(this.dq[plane][0], this.dq[plane][1]) / 2 ** Math.max(0, tdim(tx, CTX) - 2);
        return 0.2 * pixelEnergy(tx) * step * step;
    }
    whtCoefs(res, q) {
        const r = this.whtRes, out = this.whtOut;
        for (let i = 0; i < 16; i++)
            r[i] = res[i];
        forwardWht(r, out);
        for (let y = 0; y < 4; y++)
            for (let x = 0; x < 4; x++)
                q[x * 4 + y] = out[y * 4 + x];
        const order = scan(TX_4X4);
        let eob = -1;
        for (let i = 0; i < 16; i++)
            if (q[order[i]])
                eob = i;
        return eob;
    }
    quantize(plane, tx, txtp, coefs, q, n) {
        const dqShift = Math.max(0, tdim(tx, CTX) - 2), [dcq, acq] = this.dq[plane];
        const order = scan(tx), energy = pixelEnergy(tx), lambda = this.lambda;
        const keep = this.rdoKeep, drop = this.rdoDrop;
        void txtp;
        let last = -1, total = 0;
        for (let i = 0; i < n; i++) {
            const rc = order[i], step = (rc ? acq : dcq) / 2 ** dqShift, v = Math.abs(coefs[rc]) / step;
            const e = energy * step * step, dropped = e * v * v;
            drop[i] = dropped;
            total += dropped;
            if (v < 0.5) {
                q[rc] = 0;
                keep[i] = dropped + lambda * ZERO_BITS;
                continue;
            }
            let m = Math.floor(v + 0.5);
            const dm = v - m, dl = v - m + 1;
            if (e * dl * dl + lambda * coefBits(m - 1) < e * dm * dm + lambda * coefBits(m))
                m--;
            q[rc] = coefs[rc] < 0 ? -m : m;
            keep[i] = e * (v - m) * (v - m) + lambda * coefBits(m);
            if (m)
                last = i;
        }
        if (last < 0)
            return -1;
        let best = total + lambda, bestEob = -1, prefix = 0;
        let rest = best - lambda;
        for (let i = 0; i <= last; i++) {
            prefix += keep[i];
            rest -= drop[i];
            if (!q[order[i]])
                continue;
            const cost = prefix + rest + lambda * (2 + 1.5 * Math.log2(i + 2));
            if (cost < best) {
                best = cost;
                bestEob = i;
            }
        }
        for (let i = bestEob + 1; i <= last; i++)
            q[order[i]] = 0;
        return bestEob;
    }
    dequantize(plane, tx, txtp, q, eob) {
        const dqShift = Math.max(0, tdim(tx, CTX) - 2), [dcq, acq] = this.dq[plane];
        const cfMax = (128 << 8) - 1, order = scan(tx), cf = this.cf;
        void txtp;
        for (let i = 0; i <= eob; i++) {
            const rc = order[i], v = q[rc];
            if (!v) {
                cf[rc] = 0;
                continue;
            }
            const m = Math.abs(v), dq = rc ? acq : dcq;
            let c;
            if (m >= 15)
                c = Math.min((dq * m & 0xffffff) >> dqShift, cfMax + (v < 0 ? 1 : 0));
            else
                c = (dq * m) >> dqShift;
            cf[rc] = v < 0 ? -c : c;
        }
    }
    estimateBits(tx, q, eob) {
        if (eob < 0)
            return 1;
        const order = scan(tx);
        let bits = 2 + 1.5 * Math.log2(eob + 2);
        for (let i = 0; i <= eob; i++)
            bits += coefBits(Math.abs(q[order[i]]));
        return bits;
    }
    writeSb(bl, node, n) {
        const f = this.f, w = this.w, cdf = this.cdf;
        const hsz = 16 >> bl;
        const haveH = f.bw > this.bx + hsz, haveV = f.bh > this.by + hsz;
        if (!haveH && !haveV)
            return this.writeSb(bl + 1, node.split[0], n.kids[0]);
        const bx8 = this.bx >> 1, by8 = (this.by & 31) >> 1;
        const ctx = (this.aPartition[bx8] >> (4 - bl) & 1) + ((this.lPartition[by8] >> (4 - bl) & 1) << 1);
        const pc = CDF.partition + (bl * 4 + ctx) * 16;
        const bp = n.bp;
        const quarter = (k) => {
            const dx = k & 1 ? hsz : 0, dy = k & 2 ? hsz : 0;
            this.bx += dx;
            this.by += dy;
            this.writeSb(bl + 1, node.split[k], n.kids[k]);
            this.bx -= dx;
            this.by -= dy;
        };
        if (haveH && haveV) {
            w.symbol(cdf, pc, PARTITION_TYPE_COUNT[bl], bp);
            if (bp === PARTITION_NONE)
                this.writeB(BLOCK_SIZES[(bl * 10 + bp) * 2], node.o, n.b);
            else if (bp === PARTITION_H || bp === PARTITION_V) {
                const bs = BLOCK_SIZES[(bl * 10 + bp) * 2], edges = bp === PARTITION_H ? node.h : node.v;
                const dx = bp === PARTITION_V ? hsz : 0, dy = bp === PARTITION_H ? hsz : 0;
                this.writeB(bs, edges[0], n.kids[0].b);
                this.bx += dx;
                this.by += dy;
                this.writeB(bs, edges[1], n.kids[1].b);
                this.bx -= dx;
                this.by -= dy;
            }
            else
                for (let k = 0; k < 4; k++)
                    quarter(k);
        }
        else if (haveH) {
            let prob = cdf[pc + PARTITION_V - 1] - cdf[pc + PARTITION_T_TOP_SPLIT];
            prob += cdf[pc + PARTITION_T_LEFT_SPLIT - 1];
            prob += cdf[pc + PARTITION_V4 - 1] - cdf[pc + PARTITION_T_RIGHT_SPLIT];
            w.boolProb(prob, 1);
            quarter(0);
            quarter(1);
        }
        else {
            let prob = cdf[pc + PARTITION_H - 1] - cdf[pc + PARTITION_H];
            prob += cdf[pc + PARTITION_SPLIT - 1] - cdf[pc + PARTITION_T_LEFT_SPLIT];
            prob += cdf[pc + PARTITION_H4 - 1] - cdf[pc + PARTITION_H4];
            w.boolProb(prob, 1);
            quarter(0);
            quarter(2);
        }
        const p = haveH && haveV ? bp : PARTITION_SPLIT;
        if (p !== PARTITION_SPLIT || bl === BL_8X8) {
            this.aPartition.fill(AL_PART_CTX[bl * 10 + p], bx8, bx8 + hsz);
            this.lPartition.fill(AL_PART_CTX[50 + bl * 10 + p], by8, by8 + hsz);
        }
    }
    writeB(bs, edgeFlags, b) {
        const f = this.f, w = this.w, cdf = this.cdf;
        const bx = this.bx, by = this.by, bx4 = bx, by4 = by & 31;
        const ssx = this.ssx, ssy = this.ssy;
        const cbx4 = bx4 >> ssx, cby4 = by4 >> ssy;
        const bw4 = bdim(bs, 0), bh4 = bdim(bs, 1), lw4 = bdim(bs, 2), lh4 = bdim(bs, 3);
        const cbw4 = bw4 + ssx >> ssx, cbh4 = bh4 + ssy >> ssy;
        const hasChroma = f.layout !== 0;
        w.boolAdapt(cdf, CDF.skip + (this.aSkip[bx4] + this.lSkip[by4]) * 2, b.skip);
        if (!b.skip) {
            const idx = (by >> 4) * (f.b4Stride >> 4) + (bx >> 4);
            if (f.cdefIdx[idx] === -1) {
                f.cdefIdx[idx] = this.cdefChoice[idx];
                w.bools(this.hdr.cdef.bits, this.cdefChoice[idx]);
            }
        }
        w.symbol(cdf, CDF.kfYMode + (INTRA_MODE_CONTEXT[this.aMode[bx4]] * 5 + INTRA_MODE_CONTEXT[this.lMode[by4]]) * 16, 12, b.yMode);
        if (lw4 + lh4 >= 2 && isDirectional(b.yMode))
            w.symbol(cdf, CDF.angleDelta + (b.yMode - VERT_PRED) * 8, 6, b.yAngle + 3);
        if (hasChroma) {
            const cflAllowed = this.cflAllowed(bs);
            w.symbol(cdf, CDF.uvMode + ((cflAllowed ? 1 : 0) * 13 + b.yMode) * 16, cflAllowed ? 13 : 12, b.uvMode);
            if (b.uvMode === CFL_PRED) {
                const signU = b.cflAlpha[0] ? b.cflAlpha[0] < 0 ? 1 : 2 : 0, signV = b.cflAlpha[1] ? b.cflAlpha[1] < 0 ? 1 : 2 : 0;
                w.symbol(cdf, CDF.cflSign, 7, signU * 3 + signV - 1);
                if (signU)
                    w.symbol(cdf, CDF.cflAlpha + ((signU === 2 ? 3 : 0) + signV) * 16, 15, Math.abs(b.cflAlpha[0]) - 1);
                if (signV)
                    w.symbol(cdf, CDF.cflAlpha + ((signV === 2 ? 3 : 0) + signU) * 16, 15, Math.abs(b.cflAlpha[1]) - 1);
            }
            else if (lw4 + lh4 >= 2 && isDirectional(b.uvMode)) {
                w.symbol(cdf, CDF.angleDelta + (b.uvMode - VERT_PRED) * 8, 6, b.uvAngle + 3);
            }
        }
        if (this.hdr.allowScreenContentTools && Math.max(bw4, bh4) <= 16 && bw4 + bh4 >= 4) {
            const szCtx = lw4 + lh4 - 2;
            if (b.yMode === DC_PRED) {
                const palCtx = (this.aPalSz[bx4] > 0 ? 1 : 0) + (this.lPalSz[by4] > 0 ? 1 : 0);
                w.boolAdapt(cdf, CDF.palY + (szCtx * 3 + palCtx) * 2, b.palSz[0] ? 1 : 0);
                if (b.palSz[0])
                    this.writePalPlane(b, 0, szCtx, bx4, by4);
            }
            if (hasChroma && b.uvMode === DC_PRED) {
                w.boolAdapt(cdf, CDF.palUv + (b.palSz[0] > 0 ? 2 : 0), b.palSz[1] ? 1 : 0);
                if (b.palSz[1])
                    this.writePalUv(b, szCtx, bx4, by4);
            }
        }
        const w4 = Math.min(bw4, f.bw - bx), h4 = Math.min(bh4, f.bh - by);
        if (b.palSz[0])
            this.writeColorIndices(b.palIdx, b.palSz[0], 0, w4 * 4, h4 * 4, bw4 * 4);
        if (hasChroma && b.palSz[1])
            this.writeColorIndices(b.palIdxUv, b.palSz[1], 1, (w4 + ssx >> ssx) * 4, (h4 + ssy >> ssy) * 4, cbw4 * 4);
        const maxTx = MAX_TXFM_SIZE_FOR_BS[bs * 4];
        if (this.hdr.txMode === 2 && tdim(maxTx, MAX) > TX_4X4) {
            const tctx = (this.lTxIntra[by4] >= tdim(maxTx, LH) ? 1 : 0) + (this.aTxIntra[bx4] >= tdim(maxTx, LW) ? 1 : 0);
            let depth = 0;
            for (let tx = maxTx; tx !== b.tx; tx = tdim(tx, SUB))
                depth++;
            w.symbol(cdf, CDF.txSize + ((tdim(maxTx, MAX) - 1) * 3 + tctx) * 4, Math.min(tdim(maxTx, MAX), 2), depth);
        }
        this.codeLuma(bs, edgeFlags, b);
        if (hasChroma)
            this.codeChroma(bs, edgeFlags, b);
        this.storeBlock(bs, b);
        const aw = 1 << lw4, lh = 1 << lh4;
        this.aMode.fill(b.yMode, bx4, bx4 + aw);
        this.lMode.fill(b.yMode, by4, by4 + lh);
        this.aSkip.fill(b.skip, bx4, bx4 + aw);
        this.lSkip.fill(b.skip, by4, by4 + lh);
        this.aPalSz.fill(b.palSz[0], bx4, bx4 + aw);
        this.lPalSz.fill(b.palSz[0], by4, by4 + lh);
        this.aTxIntra.fill(tdim(b.tx, LW), bx4, bx4 + aw);
        this.lTxIntra.fill(tdim(b.tx, LH), by4, by4 + lh);
        this.aPalSzUv.fill(hasChroma ? b.palSz[1] : 0, bx4, bx4 + aw);
        this.lPalSzUv.fill(hasChroma ? b.palSz[1] : 0, by4, by4 + lh);
        for (let pl = 0; pl < 3; pl++) {
            if (!b.palSz[pl ? 1 : 0] || pl && !hasChroma)
                continue;
            const colors = b.pal.subarray(pl * 8, pl * 8 + 8);
            for (let x = 0; x < bw4; x++)
                this.aPal.set(colors, (bx4 + x) * 24 + pl * 8);
            for (let y = 0; y < bh4; y++)
                this.lPal.set(colors, (by4 + y) * 24 + pl * 8);
        }
        if (hasChroma) {
            this.aUvmode.fill(b.uvMode, cbx4, cbx4 + cbw4);
            this.lUvmode.fill(b.uvMode, cby4, cby4 + cbh4);
        }
    }
    writePalPlane(b, pl, szCtx, bx4, by4) {
        const w = this.w, palSz = b.palSz[pl];
        w.symbol(this.cdf, CDF.palSize + (pl * 7 + szCtx) * 8, 6, palSz - 2);
        const cache = [];
        let lCache = pl ? this.lPalSzUv[by4] : this.lPalSz[by4];
        let aCache = by4 & 15 ? pl ? this.aPalSzUv[bx4] : this.aPalSz[bx4] : 0;
        let l = by4 * 24 + pl * 8, a = bx4 * 24 + pl * 8;
        const L = this.lPal, A = this.aPal;
        const push = (v) => {
            if (!cache.length || cache[cache.length - 1] !== v)
                cache.push(v);
        };
        while (lCache && aCache) {
            if (L[l] < A[a]) {
                push(L[l++]);
                lCache--;
            }
            else {
                if (A[a] === L[l]) {
                    l++;
                    lCache--;
                }
                push(A[a++]);
                aCache--;
            }
        }
        while (lCache-- > 0)
            push(L[l++]);
        while (aCache-- > 0)
            push(A[a++]);
        const rest = Array.from(b.pal.subarray(pl * 8, pl * 8 + palSz));
        for (let n = 0, used = 0; n < cache.length && used < palSz; n++) {
            const i = rest.indexOf(cache[n]);
            w.bool(i >= 0 ? 1 : 0);
            if (i >= 0) {
                rest.splice(i, 1);
                used++;
            }
        }
        if (!rest.length)
            return;
        const max = 255, minus = pl ? 0 : 1;
        w.bools(8, rest[0]);
        if (rest.length === 1)
            return;
        let maxDelta = 0;
        for (let i = 1; i < rest.length; i++)
            maxDelta = Math.max(maxDelta, rest[i] - rest[i - 1] - minus);
        const extra = Math.max(0, 32 - Math.clz32(maxDelta) - 5);
        w.bools(2, extra);
        let bits = 5 + extra, prev = rest[0];
        for (let i = 1; i < rest.length; i++) {
            w.bools(bits, rest[i] - prev - minus);
            prev = rest[i];
            if (prev + minus >= max)
                break;
            bits = Math.min(bits, 1 + (31 - Math.clz32(max - prev - minus)));
        }
    }
    writePalUv(b, szCtx, bx4, by4) {
        this.writePalPlane(b, 1, szCtx, bx4, by4);
        const w = this.w, palSz = b.palSz[1], v = b.pal.subarray(16, 16 + palSz);
        const deltas = [];
        let maxMag = 0;
        for (let i = 1; i < palSz; i++) {
            const d = (v[i] - v[i - 1] + 128 & 255) - 128;
            deltas.push(d);
            maxMag = Math.max(maxMag, Math.abs(d));
        }
        const bits = Math.max(4, 32 - Math.clz32(maxMag));
        const deltaBits = bits <= 7 ? 2 + 8 + deltas.reduce((s, d) => s + bits + (d ? 1 : 0), 0) : Infinity;
        if (deltaBits < 8 * palSz) {
            w.bool(1);
            w.bools(2, bits - 4);
            w.bools(8, v[0]);
            for (const d of deltas) {
                w.bools(bits, Math.abs(d));
                if (d)
                    w.bool(d < 0 ? 1 : 0);
            }
        }
        else {
            w.bool(0);
            for (let i = 0; i < palSz; i++)
                w.bools(8, v[i]);
        }
    }
    writeColorIndices(t, palSz, pl, w, h, bw) {
        const enc = this.w, cdf = this.cdf, o = CDF.colorMap + (pl * 7 + palSz - 2) * 5 * 8;
        enc.uniform(palSz, t[0]);
        colorRanks(t, bw, w, h, (ctx, rank) => enc.symbol(cdf, o + ctx * 8, palSz - 1, rank));
    }
    storeBlock(bs, b) {
        const f = this.f, bx = this.bx, by = this.by, ssx = this.ssx, ssy = this.ssy;
        const bw4 = bdim(bs, 0), bh4 = bdim(bs, 1);
        const w4 = Math.min(bw4, f.bw - bx), h4 = Math.min(bh4, f.bh - by);
        const lf = this.hdr.loopFilter, lvl = [lf.levelY[0], lf.levelY[1], lf.levelU, lf.levelV];
        const s4 = f.b4Stride;
        for (let y = 0; y < h4; y++) {
            for (let x = 0; x < w4; x++) {
                const o = (by + y) * s4 + bx + x;
                f.lfLevels.set(lvl, o * 4);
                f.txW[o] = tdim(b.tx, LW);
                f.txH[o] = tdim(b.tx, LH);
                f.skip[o] = b.skip;
            }
        }
        if (f.layout) {
            const cx = bx >> ssx, cy = by >> ssy, cw4 = w4 + ssx >> ssx, ch4 = h4 + ssy >> ssy;
            for (let y = 0; y < ch4; y++) {
                for (let x = 0; x < cw4; x++) {
                    const o = (cy + y) * s4 + cx + x;
                    f.uvTxW[o] = tdim(b.uvtx, LW);
                    f.uvTxH[o] = tdim(b.uvtx, LH);
                }
            }
        }
    }
    writeCoefs(aArr, a, lArr, l, tx, txtp, bs, b, plane, eob, ctw, cth) {
        const w = this.w, cdf = this.cdf, f = this.f, q = this.q;
        const chroma = plane ? 1 : 0;
        const tlw = tdim(tx, LW), tlh = tdim(tx, LH), tctx = tdim(tx, CTX), tmin = tdim(tx, MIN), tmax = tdim(tx, MAX);
        let sctx;
        const aw = 1 << tlw, lh = 1 << tlh;
        if (chroma) {
            const bl2 = bdim(bs, 2), bl3 = bdim(bs, 3);
            const notOneBlk = bl2 - (bl2 && f.ssx ? 1 : 0) > tlw || bl3 - (bl3 && f.ssy ? 1 : 0) > tlh;
            let ca = 0, cl = 0;
            for (let i = 0; i < aw; i++)
                if (aArr[a + i] !== 0x40) {
                    ca = 1;
                    break;
                }
            for (let i = 0; i < lh; i++)
                if (lArr[l + i] !== 0x40) {
                    cl = 1;
                    break;
                }
            sctx = 7 + (notOneBlk ? 3 : 0) + ca + cl;
        }
        else if (bdim(bs, 2) === tlw && bdim(bs, 3) === tlh) {
            sctx = 0;
        }
        else {
            let la = 0, ll = 0;
            for (let i = 0; i < aw; i++)
                la |= aArr[a + i];
            for (let i = 0; i < lh; i++)
                ll |= lArr[l + i];
            sctx = SKIP_CTX[Math.min(la & 0x3f, 4) * 5 + Math.min(ll & 0x3f, 4)];
        }
        w.boolAdapt(cdf, CDF.coefSkip + (tctx * 13 + sctx) * 2, eob < 0 ? 1 : 0);
        if (eob < 0) {
            aArr.fill(0x40, a, a + ctw);
            lArr.fill(0x40, l, l + cth);
            return;
        }
        if (!chroma && tmax + 1 < TX_64X64 && !this.lossless) {
            if (tmin === TX_16X16)
                w.symbol(cdf, CDF.txtpIntra2 + (tmin * 13 + b.yMode) * 8, 4, TX_TYPES_PER_SET.indexOf(txtp));
            else
                w.symbol(cdf, CDF.txtpIntra1 + (tmin * 13 + b.yMode) * 8, 6, TX_TYPES_PER_SET.indexOf(txtp, 5) - 5);
        }
        const slw = Math.min(tlw, 3), slh = Math.min(tlh, 3), tx2d = slw + slh;
        const eobBin = eob < 2 ? eob : 32 - Math.clz32(eob);
        const binCdf = [CDF.eobBin16, CDF.eobBin32, CDF.eobBin64, CDF.eobBin128, CDF.eobBin256, CDF.eobBin512, CDF.eobBin1024][tx2d];
        const binCtx = tx2d < 4 ? chroma * 2 * 8 : tx2d === 4 ? chroma * 2 * 16 : chroma * 16;
        w.symbol(cdf, binCdf + binCtx, 4 + tx2d, eobBin);
        if (eobBin > 1) {
            w.boolAdapt(cdf, CDF.eobHiBit + ((tctx * 2 + chroma) * 11 + eobBin) * 2, eob >> (eobBin - 2) & 1);
            w.bools(eobBin - 2, eob & ((1 << (eobBin - 2)) - 1));
        }
        const levels = this.levels, order = scan(tx);
        const eobCdf = CDF.eobBaseTok + (tctx * 2 + chroma) * 16;
        const hiCdf = CDF.brTok + (Math.min(tctx, 3) * 2 + chroma) * 84;
        const tokOf = (v) => Math.min(Math.abs(v), 15);
        if (eob) {
            const loCdf = CDF.baseTok + (tctx * 2 + chroma) * 164;
            const nonsquare = tx >= RTX_4X8 ? 1 : 0, offsets = (nonsquare + (tx & nonsquare)) * 25;
            const stride = 4 << slh, shift = slh + 2, mask = (4 << slh) - 1;
            levels.fill(0, 0, stride * ((4 << slw) + 2));
            let hiMag = 0;
            const loCtx = (lv, x, y) => {
                let mg = levels[lv + 1] + levels[lv + stride];
                mg += levels[lv + stride + 1];
                hiMag = mg;
                mg += levels[lv + 2] + levels[lv + 2 * stride];
                const off = LO_CTX_OFFSETS[offsets + Math.min(y, 4) * 5 + Math.min(x, 4)];
                return off + (mg > 512 ? 4 : mg + 64 >> 7);
            };
            let rc = order[eob], x = rc >> shift, y = rc & mask;
            let tok = tokOf(q[rc]);
            const ctx = 1 + (eob > 2 << tx2d ? 1 : 0) + (eob > 4 << tx2d ? 1 : 0);
            w.symbol(cdf, eobCdf + ctx * 4, 2, Math.min(tok, 3) - 1);
            if (tok >= 3)
                w.hiTok(cdf, hiCdf + ((x | y) > 1 ? 14 : 7) * 4, tok);
            levels[x * stride + y] = tok >= 3 ? tok + (3 << 6) : tok * 0x41;
            for (let i = eob - 1; i > 0; i--) {
                rc = order[i];
                x = rc >> shift;
                y = rc & mask;
                const lv = x * stride + y;
                const c = loCtx(lv, x, y);
                tok = tokOf(q[rc]);
                w.symbol(cdf, loCdf + c * 4, 3, Math.min(tok, 3));
                if (tok >= 3) {
                    const mag = hiMag & 63;
                    w.hiTok(cdf, hiCdf + (((y | x) > 1 ? 14 : 7) + (mag > 12 ? 6 : mag + 1 >> 1)) * 4, tok);
                    levels[lv] = tok + (3 << 6);
                }
                else
                    levels[lv] = tok * 0x41;
            }
            tok = tokOf(q[0]);
            w.symbol(cdf, loCdf, 3, Math.min(tok, 3));
            if (tok >= 3) {
                const mag = levels[1] + levels[stride] + levels[stride + 1] & 63;
                w.hiTok(cdf, hiCdf + (mag > 12 ? 6 : mag + 1 >> 1) * 4, tok);
            }
        }
        else {
            const tok = tokOf(q[0]);
            w.symbol(cdf, eobCdf, 2, Math.min(tok, 3) - 1);
            if (tok >= 3)
                w.hiTok(cdf, hiCdf, tok);
        }
        let culLevel = 0, dcSignLevel = 1 << 6;
        if (q[0]) {
            let sctx2 = 0;
            for (let i = 0; i < aw; i++)
                sctx2 += aArr[a + i] >> 6;
            for (let i = 0; i < lh; i++)
                sctx2 += lArr[l + i] >> 6;
            sctx2 -= aw + lh;
            const dcSignCtx = (sctx2 !== 0 ? 1 : 0) + (sctx2 > 0 ? 1 : 0);
            const sign = q[0] < 0 ? 1 : 0;
            w.boolAdapt(cdf, CDF.dcSign + (chroma * 3 + dcSignCtx) * 2, sign);
            dcSignLevel = sign ? 0 : 2 << 6;
            if (Math.abs(q[0]) >= 15)
                w.golomb(Math.abs(q[0]) - 15);
            culLevel = Math.abs(q[0]);
        }
        for (let i = 1; i <= eob; i++) {
            const v = q[order[i]];
            if (!v)
                continue;
            w.bool(v < 0 ? 1 : 0);
            if (Math.abs(v) >= 15)
                w.golomb(Math.abs(v) - 15);
            culLevel += Math.abs(v);
        }
        const resCtx = Math.min(culLevel, 63) | dcSignLevel;
        aArr.fill(resCtx, a, a + ctw);
        lArr.fill(resCtx, l, l + cth);
    }
}
function level(width, height) {
    const area = width * height;
    if (area <= 2228224 && width <= 4096 && height <= 2176)
        return 8;
    if (area <= 8912896 && width <= 8192 && height <= 4352)
        return 12;
    if (area <= 35651584 && width <= 16384 && height <= 8704)
        return 16;
    return 31;
}
function setup(image, params, shared) {
    const { width, height, layout } = image;
    const bitsFor = (v) => Math.max(1, 32 - Math.clz32(v - 1));
    const seq = {
        profile: layout === 3 ? 1 : 0, reducedStillPicture: true, maxWidth: width, maxHeight: height,
        widthBits: bitsFor(width), heightBits: bitsFor(height), frameIdBits: 0, deltaFrameIdBits: 0,
        decoderModelInfo: false, equalPictureInterval: false, bufferRemovalDelayLength: 0, framePresentationDelayLength: 0,
        operatingPoints: [{ idc: 0, decoderModel: false }], sb128: false, filterIntra: false, intraEdgeFilter: true,
        screenContentTools: 2, forceIntegerMv: 2, orderHintBits: 0, superres: false, cdef: true, restoration: false,
        bitDepth: 8, monochrome: layout === 0, colorPrimaries: image.cicp[0], transferCharacteristics: image.cicp[1],
        matrixCoefficients: image.cicp[2], fullRange: true, ssx: layout === 1 ? 1 : 0, ssy: layout === 1 ? 1 : 0,
        separateUvDeltaQ: false, filmGrain: false
    };
    const sbw = width + 63 >> 6, sbh = height + 63 >> 6;
    const tileLog2 = (size, target) => {
        let k = 0;
        while (size << k < target)
            k++;
        return k;
    };
    const log2Cols = tileLog2(64, sbw), log2Rows = Math.max(tileLog2(2304, sbw * sbh) - log2Cols, 0);
    const colStarts = [], rowStarts = [];
    for (let x = 0; x < sbw; x += 1 + (sbw - 1 >> log2Cols))
        colStarts.push(x);
    for (let y = 0; y < sbh; y += 1 + (sbh - 1 >> log2Rows))
        rowStarts.push(y);
    const cols = colStarts.length, rows = rowStarts.length;
    colStarts.push(sbw);
    rowStarts.push(sbh);
    const qidx = params.qidx;
    const hdr = {
        showExistingFrame: false, existingFrameIdx: 0, frameType: 0, showFrame: true, refreshFrameFlags: 0xff,
        disableCdfUpdate: false, allowScreenContentTools: true, allowIntrabc: false, width, upscaledWidth: width, height,
        superresDenominator: 8,
        tiles: { cols, rows, log2Cols, log2Rows, colStarts, rowStarts, contextUpdateId: 0, sizeBytes: 4 },
        quant: { yac: qidx, ydcDelta: 0, udcDelta: 0, uacDelta: 0, vdcDelta: 0, vacDelta: 0, qm: false, qmY: 15, qmU: 15, qmV: 15 },
        segmentation: { enabled: false, updateMap: false, data: [], preskip: false, lastActiveSegId: -1, qidx: new Array(8).fill(qidx), lossless: new Array(8).fill(!qidx) },
        allLossless: !qidx,
        deltaQ: { present: false, resLog2: 0 },
        deltaLf: { present: false, resLog2: 0, multi: false },
        loopFilter: { levelY: [0, 0], levelU: 0, levelV: 0, sharpness: 0, modeRefDeltaEnabled: false, refDeltas: [1, 0, 0, 0, -1, 0, -1, -1], modeDeltas: [0, 0] },
        cdef: { damping: 3, bits: 0, yStrengths: [0], uvStrengths: [0] },
        restoration: { types: [RESTORATION_NONE, RESTORATION_NONE, RESTORATION_NONE], unitSizeLog2: [8, 8] },
        txMode: qidx ? params.effort > 1 ? 2 : 1 : 0, reducedTxSet: false, filmGrain: null
    };
    const f = new Frame(seq, hdr);
    const src = f.planes.map((plane, p) => {
        const sx = p && layout === 1 ? 1 : 0, w = width + sx >> sx, h = height + sx >> sx, stride = f.strides[p];
        const pw = f.bw * 4 >> sx, ph = f.bh * 4 >> sx, inp = image.planes[p];
        const out = shared ? new Uint16Array(new SharedArrayBuffer(plane.length * 2)) : new Uint16Array(plane.length);
        for (let y = 0; y < ph; y++)
            for (let x = 0; x < pw; x++)
                out[y * stride + x] = inp[Math.min(y, h - 1) * w + Math.min(x, w - 1)];
        return out;
    });
    if (shared)
        f.planes = f.planes.map(plane => new Uint16Array(new SharedArrayBuffer(plane.length * 2)));
    return { seq, hdr, f, src, rows, cols };
}
export function encodeAV1(image, params) {
    const { seq, hdr, f, src, rows, cols } = setup(image, params, false);
    const encoder = new TileEncoder(f, src, params);
    const nodes = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            nodes.push(encoder.searchTile(r, c));
    const g = finish(encoder, seq, hdr, f, params, nodes, rows, cols), dirs = new Int32Array(f.b4Stride * (f.bh + 1)).fill(-1);
    for (let step = g.next();; step = g.next(runFilterTrials(f, src, step.value, dirs)))
        if (step.done)
            return step.value;
}
export function searchRows(task, post) {
    const f = new Frame(task.seq, task.hdr);
    f.planes = task.planes;
    const encoder = new TileEncoder(f, task.src, task.params, task.above.buffer);
    for (let row; (row = Atomics.add(task.counter, 0, 1)) < task.progress.length;)
        post({ row, nodes: encoder.searchRow(task.tileRow, task.tileCol, row, task.progress) });
}
const BLOCK_ARRAYS = ['lfLevels', 'txW', 'txH', 'uvTxW', 'uvTxH', 'skip', 'segMap', 'cdefIdx'];
export function filterTrials(task) {
    const f = new Frame(task.seq, task.hdr);
    for (const name of BLOCK_ARRAYS)
        f[name] = task.blocks[name];
    return runFilterTrials(f, task.src, task, new Int32Array(f.b4Stride * (f.bh + 1)).fill(-1));
}
async function threadTrials(threads, f, src, t) {
    const planes = t.planes.map(p => {
        const s = new Uint16Array(new SharedArrayBuffer(p.length * 2));
        s.set(p);
        return s;
    });
    const blocks = {};
    for (const name of BLOCK_ARRAYS)
        blocks[name] = f[name];
    const out = new Array(t.values.length), used = threads.slice(0, t.values.length);
    await Promise.all(used.map(async (thread, k) => {
        const values = t.values.filter((_, i) => i % used.length === k);
        const errors = await thread.run({ task: 'av1-filter', kind: t.kind, values, planes, seq: f.seq, hdr: f.hdr, src, blocks });
        errors.forEach((e, j) => out[k + j * used.length] = e);
    }));
    return out;
}
export async function encodeAV1Threaded(image, params, threads) {
    const { seq, hdr, f, src, rows, cols } = setup(image, params, true);
    const above = new Uint8Array(new SharedArrayBuffer(TileEncoder.aboveBytes(f)));
    const encoder = new TileEncoder(f, src, params, above.buffer);
    const nodes = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const sbRows = encoder.startTile(r, c), rowNodes = new Array(sbRows);
            const counter = new Int32Array(new SharedArrayBuffer(4)), progress = new Int32Array(new SharedArrayBuffer(4 * sbRows));
            const task = { task: 'av1-search', seq, hdr, params, planes: f.planes, src, above, counter, progress, tileRow: r, tileCol: c };
            await Promise.all(threads.map(t => t.run(task, m => {
                const { row, nodes } = m;
                rowNodes[row] = nodes;
            })));
            nodes.push(rowNodes.flat());
        }
    }
    const g = finish(encoder, seq, hdr, f, params, nodes, rows, cols);
    for (let step = g.next();; step = g.next(await threadTrials(threads, f, src, step.value)))
        if (step.done)
            return step.value;
}
function* finish(encoder, seq, hdr, f, params, nodes, rows, cols) {
    const { width, height } = f, qidx = hdr.quant.yac;
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            encoder.storeTile(r, c, nodes[r * cols + c]);
    if (qidx)
        yield* chooseFilters(f, qidx, params.effort, encoder.cdefChoice);
    f.cdefIdx.fill(-1);
    const tiles = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            tiles.push(encoder.writeTile(r, c, nodes[r * cols + c]));
    const w = new HeaderWriter();
    writeFrameHeader(w, seq, hdr);
    w.align();
    if (cols * rows > 1)
        w.bit(0);
    w.align();
    const head = w.data();
    let size = head.length;
    for (let i = 0; i < tiles.length; i++)
        size += tiles[i].length + (i < tiles.length - 1 ? 4 : 0);
    const payload = new Uint8Array(size);
    payload.set(head);
    let o = head.length;
    for (let i = 0; i < tiles.length; i++) {
        if (i < tiles.length - 1) {
            const n = tiles[i].length - 1;
            payload.set([n & 0xff, n >> 8 & 0xff, n >> 16 & 0xff, n >>> 24], o);
            o += 4;
        }
        payload.set(tiles[i], o);
        o += tiles[i].length;
    }
    const seqObu = writeSequenceHeader(seq, level(width, height)), frameObu = obu(OBU_FRAME, payload);
    const out = new Uint8Array(seqObu.length + frameObu.length);
    out.set(seqObu);
    out.set(frameObu, seqObu.length);
    return out;
}
function blockErrors(f, planes, src, ey, euv) {
    const s64 = f.b4Stride >> 4;
    ey.fill(0);
    euv.fill(0);
    planes.forEach((plane, p) => {
        const sx = p ? f.ssx : 0, sy = p ? f.ssy : 0, w = f.width + sx >> sx, h = f.height + sy >> sy, stride = f.strides[p];
        const out = p ? euv : ey;
        for (let y = 0; y < h; y++) {
            const row = (y << sy >> 6) * s64;
            for (let x = 0; x < w; x++) {
                const d = plane[y * stride + x] - src[p][y * stride + x];
                out[row + (x << sx >> 6)] += d * d;
            }
        }
    });
}
const sum = (a) => a.reduce((s, v) => s + v, 0);
function setLevel(f, level) {
    f.hdr.loopFilter.levelY = [level, level];
    f.hdr.loopFilter.levelU = f.hdr.loopFilter.levelV = level;
    for (let i = 0; i < f.lfLevels.length; i += 4)
        f.lfLevels.set([level, level, level, level], i);
}
export function runFilterTrials(f, src, t, dirs) {
    const n = f.cdefIdx.length, planes = f.planes, coded = Int8Array.from(f.cdefIdx, i => i >= 0 ? 0 : -1);
    const out = t.values.map(value => {
        const e = [new Float64Array(n), new Float64Array(n)];
        f.planes = t.planes.map(p => p.slice());
        if (t.kind === 'deblock') {
            setLevel(f, value);
            deblock(f);
        }
        else {
            f.hdr.cdef.yStrengths = [value];
            f.hdr.cdef.uvStrengths = [value];
            f.cdefIdx.set(coded);
            if (value)
                cdef(f, t.planes, dirs);
        }
        blockErrors(f, f.planes, src, e[0], e[1]);
        return e;
    });
    f.planes = planes;
    return out;
}
function* chooseFilters(f, qidx, effort, choice) {
    const hdr = f.hdr, q = dequant(0, qidx, 1), n = f.cdefIdx.length;
    const recon = f.planes.map(p => p.slice());
    const guess = Math.max(0, Math.min(63, (q * 20723 + 1015158 + (1 << 17) >> 18) - 4));
    const levels = [[guess], [guess - 4, guess, guess + 4], [guess - 6, guess - 3, guess, guess + 3, guess + 6]][effort].filter(l => l >= 0 && l <= 63);
    const levelErrors = yield { kind: 'deblock', values: levels, planes: recon };
    let bestLevel = guess, bestError = Infinity;
    levels.forEach((level, k) => {
        const e = sum(levelErrors[k][0]) + sum(levelErrors[k][1]);
        if (e < bestError) {
            bestError = e;
            bestLevel = level;
        }
    });
    setLevel(f, bestLevel);
    f.planes = recon.map(p => p.slice());
    deblock(f);
    const deblocked = f.planes;
    const strengths = [[0, 5, 9, 17, 33], [0, 1, 4, 5, 9, 17, 33, 61], [0, 1, 4, 5, 8, 9, 13, 17, 25, 33, 41, 61]][effort];
    const coded = Array.from(f.cdefIdx, i => i >= 0);
    const strengthErrors = yield { kind: 'cdef', values: strengths, planes: deblocked };
    const errY = strengthErrors.map(e => e[0]), errUv = strengthErrors.map(e => e[1]);
    const lambda = 0.08 * (q / 8) ** 2, blocks = coded.filter(c => c).length;
    const pairs = [];
    for (let y = 0; y < strengths.length; y++)
        for (let u = 0; u < strengths.length; u++)
            pairs.push([y, u]);
    const costOf = (set) => {
        let e = 0;
        for (let i = 0; i < n; i++) {
            if (!coded[i])
                continue;
            let m = Infinity;
            for (const [y, u] of set)
                m = Math.min(m, errY[y][i] + errUv[u][i]);
            e += m;
        }
        return e;
    };
    let set = [], best = [[0, 0]], bestCost = Infinity;
    for (let bits = 0; bits <= (effort ? 3 : 1); bits++) {
        while (set.length < 1 << bits) {
            let add = pairs[0], addCost = Infinity;
            for (const pair of pairs) {
                const c = costOf([...set, pair]);
                if (c < addCost) {
                    addCost = c;
                    add = pair;
                }
            }
            set = [...set, add];
        }
        const cost = costOf(set) + lambda * (bits * blocks + 12 * set.length);
        if (cost < bestCost) {
            bestCost = cost;
            best = set.slice();
        }
    }
    hdr.cdef.bits = Math.log2(best.length);
    hdr.cdef.yStrengths = best.map(([y]) => strengths[y]);
    hdr.cdef.uvStrengths = best.map(([, u]) => strengths[u]);
    for (let i = 0; i < n; i++) {
        let m = Infinity;
        best.forEach(([y, u], k) => {
            const e = errY[y][i] + errUv[u][i];
            if (e < m) {
                m = e;
                choice[i] = k;
            }
        });
    }
    f.planes = recon;
}
