/*!
 * The AV1 symbol decoder (a multi-symbol arithmetic decoder with adapting CDFs), ported from dav1d (src/msac.c).
 * Copyright (c) 2018-2021, VideoLAN and dav1d authors, Copyright (c) 2018, Two Orioles, LLC, BSD-2-Clause License
 * (see THIRD_PARTY_NOTICES.md)
 */
const PROB_SHIFT = 6, MIN_PROB = 4;
const WIN = 32;
export class SymbolDecoder {
    data;
    end;
    allowUpdate;
    pos;
    dif = 0;
    rng = 0x8000;
    cnt = -15;
    constructor(data, start, end, allowUpdate) {
        this.data = data;
        this.end = end;
        this.allowUpdate = allowUpdate;
        this.pos = start;
        this.refill();
    }
    refill() {
        let c = WIN - this.cnt - 24;
        let dif = this.dif;
        do {
            if (this.pos >= this.end) {
                dif = (dif | ~(~0xff << c)) >>> 0;
                break;
            }
            dif = (dif | (this.data[this.pos++] ^ 0xff) << c) >>> 0;
            c -= 8;
        } while (c >= 0);
        this.dif = dif;
        this.cnt = WIN - c - 24;
    }
    norm(dif, rng) {
        const d = 15 ^ (31 ^ Math.clz32(rng));
        const cnt = this.cnt;
        this.dif = (dif << d) >>> 0;
        this.rng = rng << d;
        this.cnt = cnt - d;
        if (cnt >= 0 && cnt < d)
            this.refill();
    }
    bool() {
        const r = this.rng;
        let dif = this.dif;
        let v = (r >> 8 << 7) + MIN_PROB;
        const vw = v * 65536;
        const ret = dif >= vw ? 1 : 0;
        if (ret) {
            dif -= vw;
            v = r - v;
        }
        this.norm(dif, v);
        return ret ^ 1;
    }
    boolProb(f) {
        const r = this.rng;
        let dif = this.dif;
        let v = ((r >> 8) * (f >> PROB_SHIFT) >> (7 - PROB_SHIFT)) + MIN_PROB;
        const vw = v * 65536;
        const ret = dif >= vw ? 1 : 0;
        if (ret) {
            dif -= vw;
            v = r - v;
        }
        this.norm(dif, v);
        return ret ^ 1;
    }
    bools(n) {
        let v = 0;
        while (n--)
            v = v << 1 | this.bool();
        return v;
    }
    uniform(n) {
        const l = 32 - Math.clz32(n);
        const m = (1 << l) - n;
        const v = this.bools(l - 1);
        return v < m ? v : (v << 1) - m + this.bool();
    }
    symbol(cdf, o, n) {
        const c = this.dif >>> 16, r = this.rng >> 8;
        let u, v = this.rng, val = -1;
        do {
            val++;
            u = v;
            v = r * (cdf[o + val] >> PROB_SHIFT) >> (7 - PROB_SHIFT);
            v += MIN_PROB * (n - val);
        } while (c < v);
        this.norm(this.dif - v * 65536, u - v);
        if (this.allowUpdate) {
            const count = cdf[o + n];
            const rate = 4 + (count >> 4) + (n > 2 ? 1 : 0);
            let i = 0;
            for (; i < val; i++)
                cdf[o + i] += 32768 - cdf[o + i] >> rate;
            for (; i < n; i++)
                cdf[o + i] -= cdf[o + i] >> rate;
            cdf[o + n] = count + (count < 32 ? 1 : 0);
        }
        return val;
    }
    boolAdapt(cdf, o) {
        const bit = this.boolProb(cdf[o]);
        if (this.allowUpdate) {
            const count = cdf[o + 1];
            const rate = 4 + (count >> 4);
            if (bit)
                cdf[o] += 32768 - cdf[o] >> rate;
            else
                cdf[o] -= cdf[o] >> rate;
            cdf[o + 1] = count + (count < 32 ? 1 : 0);
        }
        return bit;
    }
    hiTok(cdf, o) {
        let br = this.symbol(cdf, o, 3);
        let tok = 3 + br;
        if (br === 3) {
            br = this.symbol(cdf, o, 3);
            tok = 6 + br;
            if (br === 3) {
                br = this.symbol(cdf, o, 3);
                tok = 9 + br;
                if (br === 3)
                    tok = 12 + this.symbol(cdf, o, 3);
            }
        }
        return tok;
    }
    golomb() {
        let len = 0;
        while (!this.bool() && len < 32)
            len++;
        let v = 1;
        while (len--)
            v = v * 2 + this.bool();
        return v - 1;
    }
    subexp(ref, n, k) {
        let a = 0;
        if (this.bool()) {
            if (this.bool())
                k += this.bool() + 1;
            a = 1 << k;
        }
        const v = this.bools(k) + a;
        return ref * 2 <= n ? inverseRecenter(ref, v) : n - 1 - inverseRecenter(n - 1 - ref, v);
    }
    get overread() {
        return this.cnt <= -15;
    }
}
function inverseRecenter(r, v) {
    if (v > r << 1)
        return v;
    return v & 1 ? r - (v + 1 >> 1) : r + (v >> 1);
}
