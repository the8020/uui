/*!
 * The AV1 symbol encoder (a multi-symbol arithmetic coder with adapting CDFs), ported from libaom
 * (aom_dsp/entenc.c: od_ec_encode_q15, od_ec_enc_normalize, od_ec_enc_done). Copyright (c) 2001-2016, Alliance for Open
 * Media, BSD-2-Clause License (see THIRD_PARTY_NOTICES.md)
 */
const PROB_SHIFT = 6, MIN_PROB = 4;
export class SymbolEncoder {
    allowUpdate;
    buf = [];
    low = 0;
    rng = 0x8000;
    cnt = -9;
    constructor(allowUpdate = true) {
        this.allowUpdate = allowUpdate;
    }
    encode(fl, fh, s, n) {
        let l = this.low, r = this.rng;
        const v = ((r >> 8) * (fh >> PROB_SHIFT) >> (7 - PROB_SHIFT)) + MIN_PROB * (n - s);
        if (fl < 32768) {
            const u = ((r >> 8) * (fl >> PROB_SHIFT) >> (7 - PROB_SHIFT)) + MIN_PROB * (n - s + 1);
            l += r - u;
            r = u - v;
        }
        else
            r -= v;
        this.normalize(l, r);
    }
    normalize(low, rng) {
        let c = this.cnt;
        const d = 16 - (32 - Math.clz32(rng));
        let s = c + d;
        if (s >= 0) {
            c += 16;
            let m = 2 ** c - 1;
            if (s >= 8) {
                this.buf.push(Math.floor(low / 2 ** c));
                low %= m + 1;
                c -= 8;
                m = (m + 1) / 256 - 1;
            }
            this.buf.push(Math.floor(low / 2 ** c));
            s = c + d - 24;
            low %= m + 1;
        }
        this.low = low * 2 ** d;
        this.rng = rng << d;
        this.cnt = s;
    }
    symbol(cdf, o, n, val) {
        this.encode(val ? cdf[o + val - 1] : 32768, val === n ? 0 : cdf[o + val], val, n);
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
    }
    boolAdapt(cdf, o, bit) {
        this.symbol(cdf, o, 1, bit);
    }
    boolProb(f, bit) {
        this.encode(bit ? f : 32768, bit ? 0 : f, bit, 1);
    }
    bool(bit) {
        this.boolProb(16384, bit);
    }
    bools(n, v) {
        while (n--)
            this.bool(v >> n & 1);
    }
    uniform(n, v) {
        const l = 32 - Math.clz32(n), m = (1 << l) - n;
        if (v < m)
            this.bools(l - 1, v);
        else {
            this.bools(l - 1, v + m >> 1);
            this.bool(v + m & 1);
        }
    }
    hiTok(cdf, o, tok) {
        for (let base = 3;; base += 3) {
            const br = Math.min(tok - base, 3);
            this.symbol(cdf, o, 3, br);
            if (br < 3 || base === 12)
                return;
        }
    }
    golomb(v) {
        const x = v + 1, len = 31 - Math.clz32(x);
        for (let i = 0; i < len; i++)
            this.bool(0);
        this.bool(1);
        for (let i = len - 1; i >= 0; i--)
            this.bool(x >> i & 1);
    }
    finish() {
        const buf = this.buf.slice();
        let c = this.cnt, s = c + 10;
        const m = 0x3fff;
        let e = Math.floor((this.low + m) / (m + 1)) * (m + 1);
        if (Math.floor(e / (m + 1)) % 2 === 0)
            e += m + 1;
        if (s > 0) {
            let n = 2 ** (c + 16);
            do {
                buf.push(Math.floor(e / 2 ** (c + 16)));
                e %= n;
                s -= 8;
                c -= 8;
                n /= 256;
            } while (s > 0);
        }
        const out = new Uint8Array(buf.length);
        let carry = 0;
        for (let i = buf.length - 1; i >= 0; i--) {
            carry += buf[i];
            out[i] = carry & 0xff;
            carry >>= 8;
        }
        return out;
    }
}
