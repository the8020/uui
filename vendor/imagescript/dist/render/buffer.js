/*!
 * The shaping buffer, ported from HarfBuzz (hb-buffer.hh, hb-buffer.cc)
 * Copyright © 1998-2004 David Turner and Werner Lemberg, © 2004-2007,2009,2010 Red Hat, Inc., © 2011,2012 Google, Inc.
 * Old MIT license (see THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
export const CATEGORY_NAMES = ['Cc', 'Cf', 'Cn', 'Co', 'Cs', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu', 'Mc', 'Me', 'Mn', 'Nd', 'Nl', 'No', 'Pc', 'Pd', 'Pe', 'Pf',
    'Pi', 'Po', 'Ps', 'Sc', 'Sk', 'Sm', 'So', 'Zl', 'Zp', 'Zs'];
export const isMark = (category) => category === 10 || category === 11 || category === 12;
export class GlyphInfo {
    codepoint = 0;
    mask = 0;
    cluster = 0;
    unicodeProps = 0;
    glyphProps = 0;
    ligProps = 0;
    syllable = 0;
    category = 0;
    position = 0;
    glyphIndex = 0;
    xAdvance = 0;
    yAdvance = 0;
    xOffset = 0;
    yOffset = 0;
    attachChain = 0;
    attachType = 0;
    clone() {
        return Object.assign(new GlyphInfo(), this);
    }
}
const MAX_OPS_FACTOR = 64;
const MAX_OPS_MIN = 16384;
const MAX_LEN_FACTOR = 32;
const MAX_LEN_MIN = 8192;
export class Buffer {
    info = [];
    outInfo = [];
    idx = 0;
    outLen = 0;
    haveOutput = false;
    successful = true;
    direction = 4;
    script = '';
    serial = 0;
    maxOps = 0;
    maxLen = 0;
    hasIgnorables = false;
    hasContinuations = false;
    hasCGJ = false;
    hasSpaceFallback = false;
    hasAttachment = false;
    beginning = true;
    context = [[], []];
    hasStch = false;
    hasBrokenSyllable = false;
    get len() {
        return this.info.length;
    }
    limit() {
        this.maxOps = Math.max(this.len * MAX_OPS_FACTOR, MAX_OPS_MIN);
        this.maxLen = Math.max(this.len * MAX_LEN_FACTOR, MAX_LEN_MIN);
    }
    cur(offset = 0) {
        return this.info[this.idx + offset];
    }
    prev() {
        return this.outInfo[this.outLen - 1];
    }
    backtrackLen() {
        return this.haveOutput ? this.outLen : this.idx;
    }
    lookaheadLen() {
        return this.len - this.idx;
    }
    nextSerial() {
        this.serial = this.serial + 1 & 255;
        if (!this.serial)
            this.serial = 1;
        return this.serial;
    }
    clearOutput() {
        this.haveOutput = true;
        this.idx = 0;
        this.outLen = 0;
        this.outInfo = [];
    }
    sync() {
        if (this.successful)
            this.nextGlyphs(this.len - this.idx);
        if (this.successful) {
            this.outInfo.length = this.outLen;
            this.info = this.outInfo;
        }
        this.haveOutput = false;
        this.outLen = 0;
        this.outInfo = [];
        this.idx = 0;
    }
    grow(count) {
        if (this.outLen + count > this.maxLen) {
            this.successful = false;
            return false;
        }
        return true;
    }
    nextGlyph() {
        if (this.haveOutput)
            this.outInfo[this.outLen++] = this.info[this.idx];
        this.idx++;
    }
    nextGlyphs(n) {
        if (this.haveOutput)
            for (let i = 0; i < n; i++)
                this.outInfo[this.outLen++] = this.info[this.idx + i];
        this.idx += n;
    }
    skipGlyph() {
        this.idx++;
    }
    replaceGlyphs(numIn, numOut, glyphs) {
        if (!this.grow(numOut))
            return;
        this.mergeClusters(this.idx, this.idx + numIn);
        const orig = this.idx < this.len ? this.cur() : this.prev();
        for (let i = 0; i < numOut; i++) {
            const info = orig.clone();
            info.codepoint = glyphs[i];
            this.outInfo[this.outLen++] = info;
        }
        this.idx += numIn;
    }
    replaceGlyph(glyph) {
        this.replaceGlyphs(1, 1, [glyph]);
    }
    outputGlyph(glyph) {
        this.replaceGlyphs(0, 1, [glyph]);
        return this.prev();
    }
    outputInfo(info) {
        if (!this.grow(1))
            return;
        this.outInfo[this.outLen++] = info;
    }
    copyGlyph() {
        this.outputInfo(this.cur().clone());
    }
    moveTo(i) {
        if (!this.haveOutput) {
            this.idx = i;
            return true;
        }
        if (!this.successful)
            return false;
        if (this.outLen < i) {
            const count = i - this.outLen;
            if ((this.maxOps -= count) < 0)
                return this.successful = false;
            for (let k = 0; k < count; k++)
                this.outInfo[this.outLen++] = this.info[this.idx++];
        }
        else if (this.outLen > i) {
            const count = this.outLen - i;
            if ((this.maxOps -= count) < 0)
                return this.successful = false;
            if (this.idx < count) {
                const shift = count - this.idx;
                this.info.splice(this.idx, 0, ...Array.from({ length: shift }, () => new GlyphInfo()));
                this.idx += shift;
            }
            this.idx -= count;
            this.outLen -= count;
            for (let k = 0; k < count; k++)
                this.info[this.idx + k] = this.outInfo[this.outLen + k];
        }
        return true;
    }
    mergeClusters(start, end) {
        if (end - start < 2)
            return;
        if ((this.maxOps -= end - start) < 0)
            this.successful = false;
        const info = this.info;
        let cluster = info[start].cluster;
        for (let i = start + 1; i < end; i++)
            cluster = Math.min(cluster, info[i].cluster);
        if (cluster !== info[end - 1].cluster)
            while (end < this.len && info[end - 1].cluster === info[end].cluster)
                end++;
        if (cluster !== info[start].cluster)
            while (this.idx < start && info[start - 1].cluster === info[start].cluster)
                start--;
        if (this.idx === start && info[start].cluster !== cluster)
            for (let i = this.outLen; i && this.outInfo[i - 1].cluster === info[start].cluster; i--)
                this.outInfo[i - 1].cluster = cluster;
        for (let i = start; i < end; i++)
            info[i].cluster = cluster;
    }
    mergeOutClusters(start, end) {
        if (end - start < 2)
            return;
        if ((this.maxOps -= end - start) < 0)
            this.successful = false;
        const out = this.outInfo;
        let cluster = out[start].cluster;
        for (let i = start + 1; i < end; i++)
            cluster = Math.min(cluster, out[i].cluster);
        while (start && out[start - 1].cluster === out[start].cluster)
            start--;
        while (end < this.outLen && out[end - 1].cluster === out[end].cluster)
            end++;
        if (end === this.outLen)
            for (let i = this.idx; i < this.len && this.info[i].cluster === out[end - 1].cluster; i++)
                this.info[i].cluster = cluster;
        for (let i = start; i < end; i++)
            out[i].cluster = cluster;
    }
    deleteGlyph() {
        const cluster = this.info[this.idx].cluster;
        if (!(this.idx + 1 < this.len && cluster === this.info[this.idx + 1].cluster || this.outLen && cluster === this.outInfo[this.outLen - 1].cluster)) {
            if (this.outLen) {
                if (cluster < this.outInfo[this.outLen - 1].cluster) {
                    const old = this.outInfo[this.outLen - 1].cluster;
                    for (let i = this.outLen; i && this.outInfo[i - 1].cluster === old; i--)
                        this.outInfo[i - 1].cluster = cluster;
                }
            }
            else if (this.idx + 1 < this.len)
                this.mergeClusters(this.idx, this.idx + 2);
        }
        this.skipGlyph();
    }
    deleteGlyphsInplace(filter) {
        const info = this.info;
        let j = 0;
        const count = info.length;
        for (let i = 0; i < count; i++) {
            if (filter(info[i])) {
                const cluster = info[i].cluster;
                if (i + 1 < count && cluster === info[i + 1].cluster)
                    continue;
                if (j) {
                    if (cluster < info[j - 1].cluster) {
                        const old = info[j - 1].cluster;
                        for (let k = j; k && info[k - 1].cluster === old; k--)
                            info[k - 1].cluster = cluster;
                    }
                    continue;
                }
                if (i + 1 < count)
                    this.mergeClusters(i, i + 2);
                continue;
            }
            info[j++] = info[i];
        }
        info.length = j;
    }
    sort(start, end, compare) {
        const info = this.info;
        for (let i = start + 1; i < end; i++) {
            let j = i;
            while (j > start && compare(info[j - 1], info[i]) > 0)
                j--;
            if (i === j)
                continue;
            this.mergeClusters(j, i + 1);
            const t = info[i];
            for (let k = i; k > j; k--)
                info[k] = info[k - 1];
            info[j] = t;
        }
    }
    reverseRange(start, end) {
        const info = this.info;
        for (let i = start, j = end - 1; i < j; i++, j--) {
            const t = info[i];
            info[i] = info[j];
            info[j] = t;
        }
    }
    reverse() {
        this.reverseRange(0, this.len);
    }
    reverseGroups(group) {
        if (!this.len)
            return;
        let start = 0, i = 1;
        for (; i < this.len; i++) {
            if (!group(this.info[i - 1], this.info[i])) {
                this.reverseRange(start, i);
                start = i;
            }
        }
        this.reverseRange(start, i);
        this.reverse();
    }
    groupEnd(start, group) {
        while (++start < this.len && group(this.info[start - 1], this.info[start]))
            ;
        return start;
    }
    setMasks(value, mask, clusterStart, clusterEnd) {
        if (!mask)
            return;
        value &= mask;
        for (const info of this.info)
            if (clusterStart <= info.cluster && info.cluster < clusterEnd)
                info.mask = info.mask & ~mask | value;
    }
    resetMasks(mask) {
        for (const info of this.info)
            info.mask = mask;
    }
    addMasks(mask) {
        for (const info of this.info)
            info.mask |= mask;
    }
}
export const generalCategory = (info) => info.unicodeProps & 31;
export const setGeneralCategory = (info, category) => {
    info.unicodeProps = category | info.unicodeProps & (0xff & ~31);
};
export const isUnicodeMark = (info) => isMark(generalCategory(info));
export const combiningClass = (info) => isUnicodeMark(info) ? info.unicodeProps >> 8 : 0;
export const setCombiningClass = (info, cc) => {
    if (isUnicodeMark(info))
        info.unicodeProps = cc << 8 | info.unicodeProps & 0xff;
};
export const isUnicodeSpace = (info) => generalCategory(info) === 29;
export const spaceFallback = (info) => isUnicodeSpace(info) ? info.unicodeProps >> 8 : 0;
export const setSpaceFallback = (info, type) => {
    if (isUnicodeSpace(info))
        info.unicodeProps = type << 8 | info.unicodeProps & 0xff;
};
export const isDefaultIgnorable = (info) => (info.unicodeProps & 32) !== 0 && !(info.glyphProps & 16);
export const isHidden = (info) => (info.unicodeProps & 64) !== 0;
export const isContinuation = (info) => (info.unicodeProps & 128) !== 0;
const isFormat = (info) => generalCategory(info) === 1;
export const isZWNJ = (info) => isFormat(info) && (info.unicodeProps & 512) !== 0;
export const isZWJ = (info) => isFormat(info) && (info.unicodeProps & 256) !== 0;
export const IS_LIG_BASE = 0x10;
export const ligId = (info) => info.ligProps >> 5;
const ligatedInternal = (info) => (info.ligProps & IS_LIG_BASE) !== 0;
export const ligComp = (info) => ligatedInternal(info) ? 0 : info.ligProps & 0x0f;
export const ligNumComps = (info) => info.glyphProps & 4 && ligatedInternal(info) ? info.ligProps & 0x0f : 1;
export const setLigPropsForLigature = (info, id, count) => {
    info.ligProps = id << 5 | IS_LIG_BASE | count & 0x0f;
};
export const setLigPropsForMark = (info, id, comp) => {
    info.ligProps = id << 5 | comp & 0x0f;
};
export const isBaseGlyph = (info) => (info.glyphProps & 2) !== 0;
export const isLigature = (info) => (info.glyphProps & 4) !== 0;
export const isMarkGlyph = (info) => (info.glyphProps & 8) !== 0;
export const isSubstituted = (info) => (info.glyphProps & 16) !== 0;
export const isLigated = (info) => (info.glyphProps & 32) !== 0;
export const isMultiplied = (info) => (info.glyphProps & 64) !== 0;
export const ligNumCompsInLigation = (info) => isMultiplied(info) && ligComp(info) ? 0 : ligNumComps(info);
export const allocateLigId = (buffer) => {
    let id = buffer.nextSerial() & 7;
    while (!id)
        id = buffer.nextSerial() & 7;
    return id;
};
