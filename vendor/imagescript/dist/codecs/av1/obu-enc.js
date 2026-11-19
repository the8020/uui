export class HeaderWriter {
    bytes = [];
    bitCount = 0;
    bit(v) {
        if (!(this.bitCount & 7))
            this.bytes.push(0);
        if (v)
            this.bytes[this.bytes.length - 1] |= 0x80 >> (this.bitCount & 7);
        this.bitCount++;
    }
    bits(n, v) {
        for (let i = n - 1; i >= 0; i--)
            this.bit(Math.floor(v / 2 ** i) & 1);
    }
    sbits(n, v) {
        this.bits(n + 1, v < 0 ? v + 2 ** (n + 1) : v);
    }
    trailing() {
        this.bit(1);
        while (this.bitCount & 7)
            this.bit(0);
    }
    align() {
        while (this.bitCount & 7)
            this.bit(0);
    }
    data() {
        return Uint8Array.from(this.bytes);
    }
}
export const OBU_SEQUENCE_HEADER = 1, OBU_FRAME = 6;
export function obu(type, payload) {
    const size = [];
    let n = payload.length;
    do {
        size.push(n & 0x7f | (n >= 0x80 ? 0x80 : 0));
        n = Math.floor(n / 128);
    } while (n);
    const out = new Uint8Array(1 + size.length + payload.length);
    out[0] = type << 3 | 2;
    out.set(size, 1);
    out.set(payload, 1 + size.length);
    return out;
}
export function writeSequenceHeader(seq, level) {
    const w = new HeaderWriter();
    w.bits(3, seq.profile);
    w.bit(1);
    w.bit(1);
    w.bits(5, level);
    w.bits(4, seq.widthBits - 1);
    w.bits(4, seq.heightBits - 1);
    w.bits(seq.widthBits, seq.maxWidth - 1);
    w.bits(seq.heightBits, seq.maxHeight - 1);
    w.bit(+seq.sb128);
    w.bit(+seq.filterIntra);
    w.bit(+seq.intraEdgeFilter);
    w.bit(+seq.superres);
    w.bit(+seq.cdef);
    w.bit(+seq.restoration);
    w.bit(0);
    if (seq.profile !== 1)
        w.bit(+seq.monochrome);
    w.bit(1);
    w.bits(8, seq.colorPrimaries);
    w.bits(8, seq.transferCharacteristics);
    w.bits(8, seq.matrixCoefficients);
    const srgb = !seq.monochrome && seq.colorPrimaries === 1 && seq.transferCharacteristics === 13 && !seq.matrixCoefficients;
    if (!srgb)
        w.bit(+seq.fullRange);
    if (!seq.monochrome && seq.ssx && seq.ssy)
        w.bits(2, 0);
    if (!seq.monochrome)
        w.bit(+seq.separateUvDeltaQ);
    w.bit(+seq.filmGrain);
    w.trailing();
    return obu(OBU_SEQUENCE_HEADER, w.data());
}
export function writeFrameHeader(w, seq, hdr) {
    w.bit(+hdr.disableCdfUpdate);
    w.bit(+hdr.allowScreenContentTools);
    if (hdr.allowScreenContentTools)
        w.bit(0);
    w.bit(0);
    if (hdr.allowScreenContentTools)
        w.bit(+hdr.allowIntrabc);
    const t = hdr.tiles;
    w.bit(1);
    const sbw = hdr.width + 63 >> 6, sbh = hdr.height + 63 >> 6;
    const tileLog2 = (size, target) => {
        let k = 0;
        while (size << k < target)
            k++;
        return k;
    };
    const minLog2Cols = tileLog2(64, sbw), maxLog2Cols = tileLog2(1, Math.min(sbw, 64)), maxLog2Rows = tileLog2(1, Math.min(sbh, 64));
    const minLog2Tiles = Math.max(tileLog2(4096 * 2304 >> 12, sbw * sbh), minLog2Cols);
    for (let i = minLog2Cols; i < maxLog2Cols; i++) {
        w.bit(i < t.log2Cols ? 1 : 0);
        if (i >= t.log2Cols)
            break;
    }
    for (let i = Math.max(minLog2Tiles - t.log2Cols, 0); i < maxLog2Rows; i++) {
        w.bit(i < t.log2Rows ? 1 : 0);
        if (i >= t.log2Rows)
            break;
    }
    if (t.log2Cols || t.log2Rows) {
        w.bits(t.log2Cols + t.log2Rows, t.contextUpdateId);
        w.bits(2, t.sizeBytes - 1);
    }
    const q = hdr.quant;
    const delta = (v) => {
        w.bit(v ? 1 : 0);
        if (v)
            w.sbits(6, v);
    };
    w.bits(8, q.yac);
    delta(q.ydcDelta);
    if (!seq.monochrome) {
        if (seq.separateUvDeltaQ)
            w.bit(0);
        delta(q.udcDelta);
        delta(q.uacDelta);
    }
    w.bit(0);
    w.bit(0);
    if (q.yac)
        w.bit(0);
    if (!hdr.allLossless) {
        const lf = hdr.loopFilter;
        w.bits(6, lf.levelY[0]);
        w.bits(6, lf.levelY[1]);
        if (!seq.monochrome && (lf.levelY[0] || lf.levelY[1])) {
            w.bits(6, lf.levelU);
            w.bits(6, lf.levelV);
        }
        w.bits(3, lf.sharpness);
        w.bit(0);
        if (seq.cdef) {
            const c = hdr.cdef;
            w.bits(2, c.damping - 3);
            w.bits(2, c.bits);
            for (let i = 0; i < 1 << c.bits; i++) {
                w.bits(6, c.yStrengths[i]);
                if (!seq.monochrome)
                    w.bits(6, c.uvStrengths[i]);
            }
        }
        w.bit(hdr.txMode === 2 ? 1 : 0);
    }
    w.bit(+hdr.reducedTxSet);
}
