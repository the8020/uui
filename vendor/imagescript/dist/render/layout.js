/*!
 * OpenType layout (GDEF, GSUB, GPOS and their feature map), ported from HarfBuzz (hb-ot-layout*, hb-ot-map*,
 * OT/Layout/GSUB/*, OT/Layout/GPOS/*)
 * Copyright © 2007,2008,2009,2010 Red Hat, Inc., © 2010,2012,2013 Google, Inc., Old MIT license (see
 * THIRD_PARTY_NOTICES.md and licenses/HarfBuzz.txt)
 */
import { parseCoverage, parseClassDef } from "./font.js";
import { GlyphInfo, allocateLigId, generalCategory, setGeneralCategory, isDefaultIgnorable, isHidden, isZWJ, isZWNJ, isMarkGlyph, isBaseGlyph, isLigature, ligId, ligComp, ligNumComps, ligNumCompsInLigation, setLigPropsForLigature, setLigPropsForMark, isMultiplied, } from "./buffer.js";
const MAX_NESTING_LEVEL = 64;
const MAX_CONTEXT_LENGTH = 64;
const tagAt = (font, offset) => String.fromCharCode(font.u8(offset), font.u8(offset + 1), font.u8(offset + 2), font.u8(offset + 3));
const covered = (font, offset) => {
    const coverage = parseCoverage(font, offset);
    return glyph => coverage(glyph) >= 0;
};
export class GDEF {
    hasGlyphClasses;
    glyphClass = () => 0;
    markAttachClass = () => 0;
    markSets = [];
    cache = new Map();
    constructor(font) {
        const gdef = font.tables.GDEF?.offset;
        this.hasGlyphClasses = gdef !== undefined && font.u16(gdef + 4) !== 0;
        if (gdef === undefined)
            return;
        if (font.u16(gdef + 4))
            this.glyphClass = parseClassDef(font, gdef + font.u16(gdef + 4));
        if (font.u16(gdef + 10))
            this.markAttachClass = parseClassDef(font, gdef + font.u16(gdef + 10));
        const version = font.u32(gdef);
        if (version >= 0x00010002 && font.u16(gdef + 12)) {
            const sets = gdef + font.u16(gdef + 12);
            for (let i = 0, count = font.u16(sets + 2); i < count; i++)
                this.markSets.push(covered(font, sets + font.u32(sets + 4 + i * 4)));
        }
    }
    glyphProps(glyph) {
        let props = this.cache.get(glyph);
        if (props !== undefined)
            return props;
        switch (this.glyphClass(glyph)) {
            case 1:
                props = 2;
                break;
            case 2:
                props = 4;
                break;
            case 3:
                props = 8 | this.markAttachClass(glyph) << 8;
                break;
            default: props = 0;
        }
        this.cache.set(glyph, props);
        return props;
    }
    markSetCovers(set, glyph) {
        return this.markSets[set](glyph);
    }
    sanitizeLookupProps(props) {
        if (props & 16 && props >>> 16 >= this.markSets.length)
            props &= ~16;
        return props;
    }
}
class SkippingIterator {
    c;
    contextMatch;
    idx = 0;
    end = 0;
    lookupProps = 0;
    mask = -1;
    ignoreZWNJ = false;
    ignoreZWJ = false;
    ignoreHidden = false;
    perSyllable = false;
    syllable = 0;
    matchFunc = null;
    data = null;
    dataIndex = 0;
    constructor(c, contextMatch) {
        this.c = c;
        this.contextMatch = contextMatch;
    }
    init() {
        const c = this.c;
        this.end = c.buffer.len;
        this.matchFunc = null;
        this.data = null;
        this.lookupProps = c.lookupProps;
        this.ignoreZWNJ = c.tableIndex === 1 || this.contextMatch && c.autoZWNJ;
        this.ignoreZWJ = this.contextMatch || c.autoZWJ;
        this.ignoreHidden = c.tableIndex === 1;
        this.mask = this.contextMatch ? -1 : c.lookupMask;
        this.perSyllable = c.tableIndex === 0 && c.perSyllable;
        this.syllable = 0;
    }
    setMatchFunc(func, data) {
        this.matchFunc = func;
        this.data = data;
        this.dataIndex = 0;
    }
    reset(start) {
        this.idx = start;
        this.end = this.c.buffer.len;
        this.syllable = this.c.buffer.cur().syllable;
    }
    resetBack(start) {
        this.idx = start;
        this.syllable = this.c.buffer.cur().syllable;
    }
    resetFast(start) {
        this.idx = start;
    }
    maySkip(info) {
        if (!this.c.checkGlyphProperty(info, this.lookupProps))
            return 1;
        if (isDefaultIgnorable(info) && (this.ignoreZWNJ || !isZWNJ(info)) && (this.ignoreZWJ || !isZWJ(info)) && (this.ignoreHidden || !isHidden(info)))
            return 2;
        return 0;
    }
    mayMatch(info) {
        if (!(info.mask & this.mask) || this.perSyllable && this.syllable && this.syllable !== info.syllable)
            return 0;
        if (this.matchFunc)
            return this.matchFunc(info, this.data ? this.data[this.dataIndex] : 0) ? 1 : 0;
        return 2;
    }
    match(info) {
        const skip = this.maySkip(info);
        if (skip === 1)
            return 2;
        const match = this.mayMatch(info);
        if (match === 1 || match === 2 && skip === 0)
            return 0;
        if (skip === 0)
            return 1;
        return 2;
    }
    next() {
        const info = this.c.buffer.info;
        const stop = this.end - 1;
        while (this.idx < stop) {
            this.idx++;
            const m = this.match(info[this.idx]);
            if (m === 0) {
                this.dataIndex++;
                return true;
            }
            if (m === 1)
                return false;
        }
        return false;
    }
    prev() {
        const buffer = this.c.buffer, info = buffer.haveOutput ? buffer.outInfo : buffer.info;
        while (this.idx > 0) {
            this.idx--;
            const m = this.match(info[this.idx]);
            if (m === 0) {
                this.dataIndex++;
                return true;
            }
            if (m === 1)
                return false;
        }
        return false;
    }
}
export class ApplyContext {
    tableIndex;
    table;
    buffer;
    gdef;
    lookupMask = 1;
    lookupIndex = -1;
    lookupProps = 0;
    nestingLevelLeft = MAX_NESTING_LEVEL;
    autoZWNJ = true;
    autoZWJ = true;
    perSyllable = false;
    random = false;
    newSyllables = -1;
    lastBase = -1;
    lastBaseUntil = 0;
    matchPositions = [];
    iterInput;
    iterContext;
    direction;
    randomState = 1;
    constructor(tableIndex, table, buffer, gdef) {
        this.tableIndex = tableIndex;
        this.table = table;
        this.buffer = buffer;
        this.gdef = gdef;
        this.direction = buffer.direction;
        this.iterInput = new SkippingIterator(this, false);
        this.iterContext = new SkippingIterator(this, true);
        this.initIters();
    }
    initIters() {
        this.iterInput.init();
        this.iterContext.init();
    }
    setLookupProps(props) {
        this.lookupProps = this.gdef.sanitizeLookupProps(props);
        this.initIters();
    }
    randomNumber() {
        this.randomState = (Math.imul(this.randomState, 48271) >>> 0) % 2147483647;
        return this.randomState;
    }
    recurse(lookupIndex) {
        if (!this.nestingLevelLeft) {
            this.buffer.successful = false;
            return false;
        }
        if (--this.buffer.maxOps < 0) {
            this.buffer.successful = false;
            return false;
        }
        const l = this.table && this.table.lookup(lookupIndex);
        if (!l)
            return false;
        this.nestingLevelLeft--;
        const savedProps = this.lookupProps, savedIndex = this.lookupIndex, savedPositions = this.matchPositions;
        this.lookupIndex = lookupIndex;
        this.setLookupProps(l.props);
        this.matchPositions = [];
        let applied = false;
        for (const subtable of l.subtables)
            if (subtable(this)) {
                applied = true;
                break;
            }
        this.lookupIndex = savedIndex;
        this.setLookupProps(savedProps);
        this.matchPositions = savedPositions;
        this.nestingLevelLeft++;
        return applied;
    }
    matchPropertiesMark(info, glyphProps, matchProps) {
        if (matchProps & 16)
            return this.gdef.markSetCovers(matchProps >>> 16, info.codepoint);
        if (matchProps & 65280)
            return (matchProps & 65280) === (glyphProps & 65280);
        return true;
    }
    checkGlyphProperty(info, matchProps) {
        const glyphProps = info.glyphProps;
        if (glyphProps & matchProps & 14)
            return false;
        if (glyphProps & 8)
            return this.matchPropertiesMark(info, glyphProps, matchProps);
        return true;
    }
    setGlyphClass(glyph, classGuess = 0, ligature = false, component = false) {
        const cur = this.buffer.cur();
        if (this.newSyllables !== -1)
            cur.syllable = this.newSyllables;
        let props = cur.glyphProps | 16;
        if (ligature)
            props = (props | 32) & ~64;
        if (component)
            props |= 64;
        if (this.gdef.hasGlyphClasses)
            cur.glyphProps = props & 112 | this.gdef.glyphProps(glyph);
        else if (classGuess)
            cur.glyphProps = props & 112 | classGuess;
        else
            cur.glyphProps = props;
    }
    replaceGlyph(glyph) {
        this.setGlyphClass(glyph);
        this.buffer.replaceGlyph(glyph);
    }
    replaceGlyphInplace(glyph) {
        this.setGlyphClass(glyph);
        this.buffer.cur().codepoint = glyph;
    }
    replaceGlyphWithLigature(glyph, classGuess) {
        this.setGlyphClass(glyph, classGuess, true);
        this.buffer.replaceGlyph(glyph);
    }
    outputGlyphForComponent(glyph, classGuess) {
        this.setGlyphClass(glyph, classGuess, false, true);
        this.buffer.outputGlyph(glyph);
    }
}
function matchInput(c, count, input, match, end, totalComponents) {
    const buffer = c.buffer;
    if (count === 1) {
        end[0] = buffer.idx + 1;
        c.matchPositions[0] = buffer.idx;
        if (totalComponents)
            totalComponents[0] = ligNumComps(buffer.cur());
        return true;
    }
    if (count > MAX_CONTEXT_LENGTH)
        return false;
    const it = c.iterInput;
    it.reset(buffer.idx);
    it.setMatchFunc(match, input);
    let total = 0;
    const firstLigId = ligId(buffer.cur()), firstLigComp = ligComp(buffer.cur());
    let ligbase = 0;
    for (let i = 1; i < count; i++) {
        if (!it.next()) {
            end[0] = it.idx + 1;
            return false;
        }
        c.matchPositions[i] = it.idx;
        const info = buffer.info[it.idx];
        const thisLigId = ligId(info), thisLigComp = ligComp(info);
        if (firstLigId && firstLigComp) {
            if (firstLigId !== thisLigId || firstLigComp !== thisLigComp) {
                if (!ligbase) {
                    let found = false, j = buffer.outLen;
                    const out = buffer.outInfo;
                    while (j && ligId(out[j - 1]) === firstLigId) {
                        if (ligComp(out[j - 1]) === 0) {
                            j--;
                            found = true;
                            break;
                        }
                        j--;
                    }
                    ligbase = found && it.maySkip(out[j]) === 1 ? 2 : 1;
                }
                if (ligbase === 1)
                    return false;
            }
        }
        else if (thisLigId && thisLigComp && thisLigId !== firstLigId)
            return false;
        total += ligNumCompsInLigation(info);
    }
    end[0] = it.idx + 1;
    if (totalComponents)
        totalComponents[0] = total + ligNumComps(buffer.cur());
    c.matchPositions[0] = buffer.idx;
    return true;
}
function ligateInput(c, count, matchEnd, ligGlyph, totalComponents) {
    const buffer = c.buffer, positions = c.matchPositions;
    buffer.mergeClusters(buffer.idx, matchEnd);
    let isBaseLigature = isBaseGlyph(buffer.info[positions[0]]), isMarkLigature = isMarkGlyph(buffer.info[positions[0]]);
    for (let i = 1; i < count; i++)
        if (!isMarkGlyph(buffer.info[positions[i]])) {
            isBaseLigature = isMarkLigature = false;
            break;
        }
    const ligature = !isBaseLigature && !isMarkLigature;
    const klass = ligature ? 4 : 0;
    const id = ligature ? allocateLigId(buffer) : 0;
    let lastLigId = ligId(buffer.cur());
    let lastNumComponents = ligNumComps(buffer.cur());
    let componentsSoFar = lastNumComponents;
    if (ligature) {
        setLigPropsForLigature(buffer.cur(), id, totalComponents);
        if (generalCategory(buffer.cur()) === 12)
            setGeneralCategory(buffer.cur(), 7);
    }
    c.replaceGlyphWithLigature(ligGlyph, klass);
    for (let i = 1; i < count; i++) {
        while (buffer.idx < positions[i] && buffer.successful) {
            if (ligature) {
                let thisComp = ligComp(buffer.cur());
                if (!thisComp)
                    thisComp = lastNumComponents;
                setLigPropsForMark(buffer.cur(), id, componentsSoFar - lastNumComponents + Math.min(thisComp, lastNumComponents));
            }
            buffer.nextGlyph();
        }
        lastLigId = ligId(buffer.cur());
        lastNumComponents = ligNumCompsInLigation(buffer.cur());
        componentsSoFar += lastNumComponents;
        buffer.skipGlyph();
    }
    if (!isMarkLigature && lastLigId) {
        for (let i = buffer.idx; i < buffer.len; i++) {
            const info = buffer.info[i];
            if (lastLigId !== ligId(info))
                break;
            const thisComp = ligComp(info);
            if (!thisComp)
                break;
            setLigPropsForMark(info, id, componentsSoFar - lastNumComponents + Math.min(thisComp, lastNumComponents));
        }
    }
}
function matchBacktrack(c, count, backtrack, match) {
    if (!count)
        return true;
    const it = c.iterContext;
    it.resetBack(c.buffer.backtrackLen());
    it.setMatchFunc(match, backtrack);
    for (let i = 0; i < count; i++)
        if (!it.prev())
            return false;
    return true;
}
function matchLookahead(c, count, lookahead, match, start) {
    if (!count)
        return true;
    const it = c.iterContext;
    it.reset(start - 1);
    it.setMatchFunc(match, lookahead);
    for (let i = 0; i < count; i++)
        if (!it.next())
            return false;
    return true;
}
function applyLookup(c, count, records, matchEnd) {
    const buffer = c.buffer, positions = c.matchPositions;
    const bl = buffer.backtrackLen();
    let end = bl + matchEnd - buffer.idx;
    const delta0 = bl - buffer.idx;
    for (let j = 0; j < count; j++)
        positions[j] += delta0;
    for (let i = 0; i < records.length && buffer.successful; i += 2) {
        const idx = records[i];
        if (idx >= count)
            continue;
        const origLen = buffer.backtrackLen() + buffer.lookaheadLen();
        if (positions[idx] >= origLen)
            continue;
        if (!buffer.moveTo(positions[idx]))
            break;
        if (buffer.maxOps <= 0)
            break;
        if (!c.recurse(records[i + 1]))
            continue;
        const newLen = buffer.backtrackLen() + buffer.lookaheadLen();
        let delta = newLen - origLen;
        if (!delta)
            continue;
        end += delta;
        if (end < positions[idx]) {
            delta += positions[idx] - end;
            end = positions[idx];
        }
        let next = idx + 1;
        if (delta > 0) {
            if (delta + count > MAX_CONTEXT_LENGTH)
                break;
        }
        else {
            delta = Math.max(delta, next - count);
            next -= delta;
        }
        positions.copyWithin(next + delta, next, count);
        if (positions.length > count + delta)
            positions.length = Math.max(count + delta, 0);
        next += delta;
        count += delta;
        for (let j = idx + 1; j < next; j++)
            positions[j] = positions[j - 1] + 1;
        for (; next < count; next++)
            positions[next] += delta;
    }
    buffer.moveTo(end);
}
const matchGlyph = (info, value) => info.codepoint === value;
export class LayoutTable {
    font;
    tag;
    offset;
    scriptList = 0;
    featureList = 0;
    lookupList = 0;
    lookupCount = 0;
    lookups = new Map();
    substitutions = new Map();
    constructor(font, tag, offset) {
        this.font = font;
        this.tag = tag;
        this.offset = offset;
        const f = font;
        this.scriptList = offset + f.u16(offset + 4);
        this.featureList = offset + f.u16(offset + 6);
        this.lookupList = offset + f.u16(offset + 8);
        this.lookupCount = f.u16(this.lookupList);
        if (f.u16(offset + 2) >= 1 && f.u16(offset) === 1 && f.u32(offset + 10))
            this.featureVariations(offset + f.u32(offset + 10));
    }
    featureVariations(table) {
        const f = this.font;
        for (let i = 0, count = f.u32(table + 4); i < count; i++) {
            const record = table + 8 + i * 8;
            const conditions = f.u32(record), substitution = f.u32(record + 4);
            let matches = true;
            if (conditions) {
                const set = table + conditions;
                for (let j = 0, n = f.u16(set); j < n && matches; j++) {
                    const condition = set + f.u32(set + 2 + j * 4);
                    if (f.u16(condition) !== 1)
                        matches = false;
                    else {
                        const v = f.coords[f.u16(condition + 2)] ?? 0;
                        matches = f.i16(condition + 4) / 16384 <= v && v <= f.i16(condition + 6) / 16384;
                    }
                }
            }
            if (!matches)
                continue;
            if (substitution) {
                const s = table + substitution;
                for (let j = 0, n = f.u16(s + 4); j < n; j++)
                    this.substitutions.set(f.u16(s + 6 + j * 6), s + f.u32(s + 8 + j * 6));
            }
            return;
        }
    }
    findScript(tag) {
        const f = this.font;
        for (let i = 0, count = f.u16(this.scriptList); i < count; i++)
            if (tagAt(f, this.scriptList + 2 + i * 6) === tag)
                return i;
        return -1;
    }
    langSys(script) {
        if (script < 0)
            return 0;
        const f = this.font;
        const s = this.scriptList + f.u16(this.scriptList + 2 + script * 6 + 4);
        for (let i = 0, count = f.u16(s + 2); i < count; i++)
            if (tagAt(f, s + 4 + i * 6) === 'dflt')
                return s + f.u16(s + 4 + i * 6 + 4);
        return f.u16(s) ? s + f.u16(s) : 0;
    }
    langSysFeatures(langSys) {
        const features = new Map();
        if (!langSys)
            return { required: -1, features };
        const f = this.font;
        const required = f.u16(langSys + 2);
        const count = f.u16(langSys + 4);
        for (let i = count; i; i--) {
            const index = f.u16(langSys + 6 + (i - 1) * 2);
            features.set(this.featureTag(index), index);
        }
        return { required: required === 0xffff ? -1 : required, features };
    }
    featureTag(index) {
        return tagAt(this.font, this.featureList + 2 + index * 6);
    }
    findFeature(tag) {
        const f = this.font;
        for (let i = 0, count = f.u16(this.featureList); i < count; i++)
            if (this.featureTag(i) === tag)
                return i;
        return -1;
    }
    featureLookups(index) {
        const f = this.font;
        if (index < 0 || index >= f.u16(this.featureList))
            return [];
        const feature = this.substitutions.get(index) ?? this.featureList + f.u16(this.featureList + 2 + index * 6 + 4);
        return Array.from({ length: f.u16(feature + 2) }, (_, j) => f.u16(feature + 4 + j * 2));
    }
    lookup(index) {
        if (index >= this.lookupCount)
            return null;
        let l = this.lookups.get(index);
        if (l !== undefined)
            return l;
        const f = this.font;
        const offset = this.lookupList + f.u16(this.lookupList + 2 + index * 2);
        const lookupType = f.u16(offset), flag = f.u16(offset + 2), count = f.u16(offset + 4);
        const props = flag & 16 ? flag + (f.u16(offset + 6 + count * 2) << 16) : flag;
        const subtables = [], coverages = [], woulds = [];
        const extension = this.tag === 'GSUB' ? 7 : 9;
        let type = lookupType;
        for (let i = 0; i < count; i++) {
            let subtable = offset + f.u16(offset + 6 + i * 2);
            if (lookupType === extension) {
                type = f.u16(subtable + 2);
                subtable += f.u32(subtable + 4);
            }
            const parsed = this.tag === 'GSUB' ? this.gsubSubtable(type, subtable) : this.gposSubtable(type, subtable);
            if (!parsed)
                continue;
            subtables.push(parsed.apply);
            coverages.push(parsed.coverage);
            woulds.push(parsed.would);
        }
        const memo = new Uint8Array(f.numGlyphs);
        const covers = (glyph) => {
            if (glyph >= memo.length)
                return coverages.some(c => c(glyph));
            if (!memo[glyph])
                memo[glyph] = coverages.some(c => c(glyph)) ? 2 : 1;
            return memo[glyph] === 2;
        };
        const would = (glyphs, zeroContext) => glyphs.length > 0 && covers(glyphs[0]) && woulds.some(w => w !== undefined && w(glyphs, zeroContext));
        l = { type, props, subtables, covers, would, reverse: this.tag === 'GSUB' && type === 8 };
        this.lookups.set(index, l);
        return l;
    }
    context(offset, chained) {
        const f = this.font, format = f.u16(offset);
        const records = (o, count) => Array.from({ length: count * 2 }, (_, j) => f.u16(o + j * 2));
        const values = (o, count) => Array.from({ length: count }, (_, j) => f.u16(o + j * 2));
        const rule = (o) => {
            if (!chained) {
                const inputCount = f.u16(o), recordCount = f.u16(o + 2);
                return { backtrack: [], input: values(o + 4, inputCount ? inputCount - 1 : 0), lookahead: [], records: records(o + 4 + Math.max(0, inputCount - 1) * 2, recordCount) };
            }
            const backtrackCount = f.u16(o);
            const backtrack = values(o + 2, backtrackCount);
            let p = o + 2 + backtrackCount * 2;
            const inputCount = f.u16(p);
            const input = values(p + 2, inputCount ? inputCount - 1 : 0);
            p += 2 + Math.max(0, inputCount - 1) * 2;
            const lookaheadCount = f.u16(p);
            const lookahead = values(p + 2, lookaheadCount);
            p += 2 + lookaheadCount * 2;
            return { backtrack, input, lookahead, records: records(p + 2, f.u16(p)) };
        };
        const wouldRule = (glyphs, zeroContext, r, match) => {
            if (zeroContext && (r.backtrack.length || r.lookahead.length))
                return false;
            if (glyphs.length !== r.input.length + 1)
                return false;
            for (let i = 1; i < glyphs.length; i++) {
                const info = new GlyphInfo();
                info.codepoint = glyphs[i];
                if (!match(info, r.input[i - 1]))
                    return false;
            }
            return true;
        };
        const applyRule = (c, r, match) => {
            const inputCount = r.input.length + 1, end = [0];
            if (inputCount > MAX_CONTEXT_LENGTH)
                return false;
            if (!chained) {
                if (!matchInput(c, inputCount, r.input, match[1], end))
                    return false;
                applyLookup(c, inputCount, r.records, end[0]);
                return true;
            }
            if (!(matchInput(c, inputCount, r.input, match[1], end) && matchLookahead(c, r.lookahead.length, r.lookahead, match[2], end[0])))
                return false;
            if (!matchBacktrack(c, r.backtrack.length, r.backtrack, match[0]))
                return false;
            applyLookup(c, inputCount, r.records, end[0]);
            return true;
        };
        if (format === 1 || format === 2) {
            const coverage = parseCoverage(f, offset + f.u16(offset + 2));
            let classes, setCount, sets;
            if (format === 1) {
                classes = [];
                setCount = f.u16(offset + 4);
                sets = offset + 6;
            }
            else if (!chained) {
                const classDef = parseClassDef(f, offset + f.u16(offset + 4));
                classes = [classDef, classDef, classDef];
                setCount = f.u16(offset + 6);
                sets = offset + 8;
            }
            else {
                classes = [0, 1, 2].map(k => f.u16(offset + 4 + k * 2) ? parseClassDef(f, offset + f.u16(offset + 4 + k * 2)) : () => 0);
                setCount = f.u16(offset + 10);
                sets = offset + 12;
            }
            const match = format === 1 ? [matchGlyph, matchGlyph, matchGlyph]
                : [0, 1, 2].map(k => (info, value) => classes[k](info.codepoint) === value);
            const cache = new Map();
            const rulesOf = (k) => {
                if (k >= setCount || !f.u16(sets + k * 2))
                    return [];
                let rules = cache.get(k);
                if (!rules) {
                    const set = offset + f.u16(sets + k * 2);
                    cache.set(k, rules = Array.from({ length: f.u16(set) }, (_, j) => rule(set + f.u16(set + 2 + j * 2))));
                }
                return rules;
            };
            return {
                coverage: glyph => coverage(glyph) >= 0,
                apply: c => {
                    const glyph = c.buffer.cur().codepoint, index = coverage(glyph);
                    if (index < 0)
                        return false;
                    for (const r of rulesOf(format === 1 ? index : classes[1](glyph)))
                        if (applyRule(c, r, match))
                            return true;
                    return false;
                },
                would: (glyphs, zeroContext) => {
                    const index = coverage(glyphs[0]);
                    if (format === 1 && index < 0)
                        return false;
                    return rulesOf(format === 1 ? index : classes[1](glyphs[0])).some(r => wouldRule(glyphs, zeroContext, r, match[1]));
                },
            };
        }
        if (format === 3) {
            const { coverages, matchCoverage, tests } = coverageList(f, offset);
            let r, first;
            if (!chained) {
                const inputCount = f.u16(offset + 2), recordCount = f.u16(offset + 4);
                const input = coverages(offset + 6, inputCount);
                if (!input.length)
                    return null;
                first = input[0];
                r = { backtrack: [], input: input.slice(1), lookahead: [], records: records(offset + 6 + inputCount * 2, recordCount) };
            }
            else {
                const backtrackCount = f.u16(offset + 2);
                const backtrack = coverages(offset + 4, backtrackCount);
                let p = offset + 4 + backtrackCount * 2;
                const inputCount = f.u16(p);
                const input = coverages(p + 2, inputCount);
                if (!input.length)
                    return null;
                p += 2 + inputCount * 2;
                const lookaheadCount = f.u16(p);
                const lookahead = coverages(p + 2, lookaheadCount);
                p += 2 + lookaheadCount * 2;
                first = input[0];
                r = { backtrack, input: input.slice(1), lookahead, records: records(p + 2, f.u16(p)) };
            }
            const firstTest = tests[first];
            return {
                coverage: firstTest,
                apply: c => firstTest(c.buffer.cur().codepoint) && applyRule(c, r, [matchCoverage, matchCoverage, matchCoverage]),
                would: (glyphs, zeroContext) => firstTest(glyphs[0]) && wouldRule(glyphs, zeroContext, r, matchCoverage),
            };
        }
        return null;
    }
    gsubSubtable(type, offset) {
        const f = this.font, format = f.u16(offset);
        if (type >= 1 && type <= 4 || type === 8) {
            const coverage = parseCoverage(f, offset + f.u16(offset + 2));
            const has = (glyph) => coverage(glyph) >= 0;
            const single = (glyphs) => glyphs.length === 1 && has(glyphs[0]);
            switch (type) {
                case 1:
                    if (format === 1) {
                        const delta = f.u16(offset + 4);
                        return { coverage: has, would: single, apply: c => {
                                const glyph = c.buffer.cur().codepoint;
                                if (coverage(glyph) < 0)
                                    return false;
                                c.replaceGlyph(glyph + delta & 0xffff);
                                return true;
                            } };
                    }
                    if (format !== 2)
                        return null;
                    return { coverage: has, would: single, apply: c => {
                            const index = coverage(c.buffer.cur().codepoint);
                            if (index < 0 || index >= f.u16(offset + 4))
                                return false;
                            c.replaceGlyph(f.u16(offset + 6 + index * 2));
                            return true;
                        } };
                case 2:
                    return { coverage: has, would: single, apply: c => {
                            const index = coverage(c.buffer.cur().codepoint);
                            if (index < 0 || index >= f.u16(offset + 4))
                                return false;
                            const sequence = offset + f.u16(offset + 6 + index * 2), count = f.u16(sequence);
                            const buffer = c.buffer;
                            if (count === 1) {
                                c.replaceGlyph(f.u16(sequence + 2));
                                return true;
                            }
                            if (count === 0) {
                                buffer.deleteGlyph();
                                return true;
                            }
                            const klass = isLigature(buffer.cur()) ? 2 : 0;
                            const id = ligId(buffer.cur());
                            for (let i = 0; i < count; i++) {
                                if (!id)
                                    setLigPropsForMark(buffer.cur(), 0, i);
                                c.outputGlyphForComponent(f.u16(sequence + 2 + i * 2), klass);
                            }
                            buffer.skipGlyph();
                            return true;
                        } };
                case 3:
                    return { coverage: has, would: single, apply: c => {
                            const index = coverage(c.buffer.cur().codepoint);
                            if (index < 0 || index >= f.u16(offset + 4))
                                return false;
                            const set = offset + f.u16(offset + 6 + index * 2), count = f.u16(set);
                            if (!count)
                                return false;
                            const mask = c.lookupMask;
                            const shift = 31 - Math.clz32(mask & -mask);
                            let alternate = (mask & c.buffer.cur().mask) >>> shift;
                            if (alternate === MAX_VALUE && c.random)
                                alternate = c.randomNumber() % count + 1;
                            if (alternate > count || alternate === 0)
                                return false;
                            c.replaceGlyph(f.u16(set + 2 + (alternate - 1) * 2));
                            return true;
                        } };
                case 4: {
                    const sets = new Map();
                    const ligatures = (index) => {
                        let list = sets.get(index);
                        if (!list) {
                            const set = offset + f.u16(offset + 6 + index * 2);
                            list = Array.from({ length: f.u16(set) }, (_, i) => {
                                const ligature = set + f.u16(set + 2 + i * 2), components = f.u16(ligature + 2);
                                return [f.u16(ligature), components, values16(f, ligature + 4, Math.max(0, components - 1))];
                            });
                            sets.set(index, list);
                        }
                        return list;
                    };
                    return { coverage: has, would: glyphs => {
                            const index = coverage(glyphs[0]);
                            if (index < 0 || index >= f.u16(offset + 4))
                                return false;
                            return ligatures(index).some(([, components, input]) => components === glyphs.length && input.every((g, k) => glyphs[k + 1] === g));
                        }, apply: c => {
                            const index = coverage(c.buffer.cur().codepoint);
                            if (index < 0 || index >= f.u16(offset + 4))
                                return false;
                            for (const [glyph, components, input] of ligatures(index)) {
                                if (!components || components > MAX_CONTEXT_LENGTH)
                                    continue;
                                if (components === 1) {
                                    c.replaceGlyph(glyph);
                                    return true;
                                }
                                const end = [0], total = [0];
                                if (!matchInput(c, components, input, matchGlyph, end, total))
                                    continue;
                                ligateInput(c, components, end[0], glyph, total[0]);
                                return true;
                            }
                            return false;
                        } };
                }
                case 8: {
                    const backtrackCount = f.u16(offset + 4);
                    const { coverages: list, matchCoverage } = coverageList(f, offset);
                    const backtrack = list(offset + 6, backtrackCount);
                    let p = offset + 6 + backtrackCount * 2;
                    const lookaheadCount = f.u16(p);
                    const lookahead = list(p + 2, lookaheadCount);
                    p += 2 + lookaheadCount * 2;
                    const substituteCount = f.u16(p), substitutes = p + 2;
                    return { coverage: has, would: single, apply: c => {
                            const index = coverage(c.buffer.cur().codepoint);
                            if (index < 0)
                                return false;
                            if (c.nestingLevelLeft !== MAX_NESTING_LEVEL)
                                return false;
                            if (index >= substituteCount)
                                return false;
                            if (matchBacktrack(c, backtrack.length, backtrack, matchCoverage) && matchLookahead(c, lookahead.length, lookahead, matchCoverage, c.buffer.idx + 1)) {
                                c.replaceGlyphInplace(f.u16(substitutes + index * 2));
                                return true;
                            }
                            return false;
                        } };
                }
            }
        }
        if (type === 5 || type === 6)
            return this.context(offset, type === 6);
        return null;
    }
    gposSubtable(type, offset) {
        const f = this.font, format = f.u16(offset);
        if (type === 7 || type === 8)
            return this.context(offset, type === 8);
        if (type < 1 || type > 6)
            return null;
        const coverage = parseCoverage(f, offset + f.u16(offset + 2));
        const has = (glyph) => coverage(glyph) >= 0;
        switch (type) {
            case 1: {
                const valueFormat = f.u16(offset + 4), size = valueSize(valueFormat);
                if (format === 1)
                    return { coverage: has, apply: c => {
                            if (coverage(c.buffer.cur().codepoint) < 0)
                                return false;
                            applyValue(f, valueFormat, offset + 6, c.buffer.cur(), offset);
                            c.buffer.idx++;
                            return true;
                        } };
                if (format !== 2)
                    return null;
                return { coverage: has, apply: c => {
                        const index = coverage(c.buffer.cur().codepoint);
                        if (index < 0 || index >= f.u16(offset + 6))
                            return false;
                        applyValue(f, valueFormat, offset + 8 + index * size, c.buffer.cur(), offset);
                        c.buffer.idx++;
                        return true;
                    } };
            }
            case 2: {
                const format1 = f.u16(offset + 4), format2 = f.u16(offset + 6);
                const len1 = valueSize(format1), len2 = valueSize(format2);
                if (format === 1) {
                    const recordSize = 2 + len1 + len2;
                    return { coverage: has, apply: c => {
                            const buffer = c.buffer;
                            const index = coverage(buffer.cur().codepoint);
                            if (index < 0 || index >= f.u16(offset + 8))
                                return false;
                            const it = c.iterInput;
                            it.resetFast(buffer.idx);
                            it.setMatchFunc(null, null);
                            if (!it.next())
                                return false;
                            const pos = it.idx;
                            const set = offset + f.u16(offset + 10 + index * 2), count = f.u16(set);
                            const second = buffer.info[pos].codepoint;
                            let lo = 0, hi = count - 1, record = -1;
                            while (lo <= hi) {
                                const mid = lo + hi >> 1, g = f.u16(set + 2 + mid * recordSize);
                                if (g < second)
                                    lo = mid + 1;
                                else if (g > second)
                                    hi = mid - 1;
                                else {
                                    record = set + 2 + mid * recordSize;
                                    break;
                                }
                            }
                            if (record < 0)
                                return false;
                            if (len1)
                                applyValue(f, format1, record + 2, buffer.cur(), offset);
                            if (len2)
                                applyValue(f, format2, record + 2 + len1, buffer.info[pos], offset);
                            buffer.idx = len2 ? pos + 1 : pos;
                            return true;
                        } };
                }
                if (format !== 2)
                    return null;
                const class1 = parseClassDef(f, offset + f.u16(offset + 8)), class2 = parseClassDef(f, offset + f.u16(offset + 10));
                const class1Count = f.u16(offset + 12), class2Count = f.u16(offset + 14), records = offset + 16;
                return { coverage: has, apply: c => {
                        const buffer = c.buffer;
                        if (coverage(buffer.cur().codepoint) < 0)
                            return false;
                        const it = c.iterInput;
                        it.resetFast(buffer.idx);
                        it.setMatchFunc(null, null);
                        if (!it.next())
                            return false;
                        const pos = it.idx;
                        const k1 = class1(buffer.cur().codepoint), k2 = class2(buffer.info[pos].codepoint);
                        if (k1 >= class1Count || k2 >= class2Count)
                            return false;
                        const v = records + (k1 * class2Count + k2) * (len1 + len2);
                        if (len1)
                            applyValue(f, format1, v, buffer.cur(), offset);
                        if (len2)
                            applyValue(f, format2, v + len1, buffer.info[pos], offset);
                        buffer.idx = len2 ? pos + 1 : pos;
                        return true;
                    } };
            }
            case 3: {
                const count = f.u16(offset + 4);
                const anchorOf = (index, entry) => {
                    if (index < 0 || index >= count)
                        return 0;
                    const o = f.u16(offset + 6 + index * 4 + (entry ? 0 : 2));
                    return o ? offset + o : 0;
                };
                return { coverage: has, apply: c => {
                        const buffer = c.buffer, info = buffer.info;
                        const entry = anchorOf(coverage(buffer.cur().codepoint), true);
                        if (!entry)
                            return false;
                        const it = c.iterInput;
                        it.resetFast(buffer.idx);
                        it.setMatchFunc(null, null);
                        if (!it.prev())
                            return false;
                        const exit = anchorOf(coverage(info[it.idx].codepoint), false);
                        if (!exit)
                            return false;
                        const i = it.idx, j = buffer.idx;
                        const [exitX, exitY] = anchor(f, exit), [entryX, entryY] = anchor(f, entry);
                        if (c.direction === 4) {
                            info[i].xAdvance = exitX + info[i].xOffset;
                            const d = entryX + info[j].xOffset;
                            info[j].xAdvance -= d;
                            info[j].xOffset -= d;
                        }
                        else {
                            const d = exitX + info[i].xOffset;
                            info[i].xAdvance -= d;
                            info[i].xOffset -= d;
                            info[j].xAdvance = entryX + info[j].xOffset;
                        }
                        let child = i, parent = j, yOffset = entryY - exitY;
                        if (!(c.lookupProps & 1)) {
                            child = j;
                            parent = i;
                            yOffset = -yOffset;
                        }
                        reverseCursiveMinorOffset(info, child, parent, 0);
                        info[child].attachChain = parent - child;
                        info[child].attachType = 2;
                        buffer.hasAttachment = true;
                        info[child].yOffset = yOffset;
                        if (info[parent].attachChain === -info[child].attachChain) {
                            info[parent].attachChain = 0;
                            info[parent].yOffset = 0;
                        }
                        buffer.idx++;
                        return true;
                    } };
            }
            case 4:
            case 5: {
                const baseCoverage = parseCoverage(f, offset + f.u16(offset + 4));
                const classCount = f.u16(offset + 6);
                const markArray = offset + f.u16(offset + 8), baseArray = offset + f.u16(offset + 10);
                const ligature = type === 5;
                const accept = (info, i) => {
                    if (!isMultiplied(info[i]) || ligComp(info[i]) === 0)
                        return true;
                    if (ligature)
                        return false;
                    return i === 0 || isMarkGlyph(info[i - 1]) || !isMultiplied(info[i - 1]) || ligId(info[i]) !== ligId(info[i - 1])
                        || ligComp(info[i]) !== ligComp(info[i - 1]) + 1;
                };
                return { coverage: has, apply: c => {
                        const buffer = c.buffer, info = buffer.info;
                        const markIndex = coverage(buffer.cur().codepoint);
                        if (markIndex < 0)
                            return false;
                        const it = c.iterInput;
                        it.lookupProps = 8;
                        it.setMatchFunc(null, null);
                        if (c.lastBaseUntil > buffer.idx) {
                            c.lastBaseUntil = 0;
                            c.lastBase = -1;
                        }
                        for (let j = buffer.idx; j > c.lastBaseUntil; j--) {
                            let m = it.match(info[j - 1]);
                            if (m === 0 && !accept(info, j - 1) && baseCoverage(info[j - 1].codepoint) < 0)
                                m = 2;
                            if (m === 0) {
                                c.lastBase = j - 1;
                                break;
                            }
                        }
                        c.lastBaseUntil = buffer.idx;
                        if (c.lastBase === -1)
                            return false;
                        const idx = c.lastBase;
                        const baseIndex = baseCoverage(info[idx].codepoint);
                        if (baseIndex < 0)
                            return false;
                        if (!ligature)
                            return markAttach(f, c, markArray, markIndex, baseArray, baseIndex, classCount, idx);
                        if (baseIndex >= f.u16(baseArray))
                            return false;
                        const attach = baseArray + f.u16(baseArray + 2 + baseIndex * 2), components = f.u16(attach);
                        if (!components)
                            return false;
                        const id = ligId(info[idx]), markId = ligId(buffer.cur()), markComp = ligComp(buffer.cur());
                        const component = id && id === markId && markComp > 0 ? Math.min(components, markComp) - 1 : components - 1;
                        return markAttach(f, c, markArray, markIndex, attach, component, classCount, idx);
                    } };
            }
            case 6: {
                const mark2Coverage = parseCoverage(f, offset + f.u16(offset + 4));
                const classCount = f.u16(offset + 6);
                const mark1Array = offset + f.u16(offset + 8), mark2Array = offset + f.u16(offset + 10);
                return { coverage: has, apply: c => {
                        const buffer = c.buffer, info = buffer.info;
                        const mark1Index = coverage(buffer.cur().codepoint);
                        if (mark1Index < 0)
                            return false;
                        const it = c.iterInput;
                        it.resetFast(buffer.idx);
                        it.lookupProps = c.lookupProps & ~14;
                        it.setMatchFunc(null, null);
                        if (!it.prev())
                            return false;
                        if (!isMarkGlyph(info[it.idx]))
                            return false;
                        const j = it.idx;
                        const id1 = ligId(buffer.cur()), id2 = ligId(info[j]), comp1 = ligComp(buffer.cur()), comp2 = ligComp(info[j]);
                        let good = false;
                        if (id1 === id2)
                            good = id1 === 0 || comp1 === comp2;
                        else
                            good = id1 > 0 && !comp1 || id2 > 0 && !comp2;
                        if (!good)
                            return false;
                        const mark2Index = mark2Coverage(info[j].codepoint);
                        if (mark2Index < 0)
                            return false;
                        return markAttach(f, c, mark1Array, mark1Index, mark2Array, mark2Index, classCount, j);
                    } };
            }
        }
        return null;
    }
}
export function syntheticLookup(props, single, ligatures) {
    const covers = (glyph) => !!(single && single.has(glyph) || ligatures && ligatures.has(glyph));
    const apply = c => {
        const glyph = c.buffer.cur().codepoint;
        if (single) {
            const s = single.get(glyph);
            if (s === undefined)
                return false;
            c.replaceGlyph(s);
            return true;
        }
        for (const [components, ligature] of ligatures?.get(glyph) ?? []) {
            const count = components.length + 1, end = [0], total = [0];
            if (!matchInput(c, count, components, matchGlyph, end, total))
                continue;
            ligateInput(c, count, end[0], ligature, total[0]);
            return true;
        }
        return false;
    };
    return { type: single ? 1 : 4, props, subtables: [apply], covers, would: () => false, reverse: false };
}
export function applySynthetic(buffer, gdef, l, mask) {
    const c = new ApplyContext(0, null, buffer, gdef);
    c.lookupMask = mask;
    c.setLookupProps(l.props);
    applyString(c, l, 0);
}
function coverageList(f, subtable) {
    const tests = [];
    const coverages = (o, count) => Array.from({ length: count }, (_, j) => {
        tests.push(covered(f, subtable + f.u16(o + j * 2)));
        return tests.length - 1;
    });
    return { coverages, matchCoverage: (info, value) => tests[value](info.codepoint), tests };
}
const values16 = (f, o, count) => Array.from({ length: count }, (_, j) => f.u16(o + j * 2));
const MAX_BITS = 8;
const MAX_VALUE = (1 << MAX_BITS) - 1;
const valueSize = (format) => {
    let n = 0;
    for (let v = format & 0xff; v; v >>= 1)
        n += v & 1;
    return n * 2;
};
function deviceDelta(f, device) {
    if (!f.coords.length || f.u16(device + 4) !== 0x8000)
        return 0;
    return f.variationDelta(f.u16(device), f.u16(device + 2));
}
function applyValue(f, format, offset, info, base) {
    const fields = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++)
        if (format & 1 << k) {
            fields[k] = f.i16(offset);
            offset += 2;
        }
    if (format & 0xf0 && f.coords.length)
        for (let k = 0; k < 4; k++)
            if (format & 0x10 << k) {
                const device = f.u16(offset);
                offset += 2;
                if (device)
                    fields[k] += deviceDelta(f, base + device);
            }
    info.xOffset += fields[0];
    info.yOffset += fields[1];
    info.xAdvance += fields[2];
}
function anchor(f, offset) {
    let x = f.i16(offset + 2), y = f.i16(offset + 4);
    if (f.u16(offset) === 3 && f.coords.length) {
        const dx = f.u16(offset + 6), dy = f.u16(offset + 8);
        if (dx)
            x += deviceDelta(f, offset + dx);
        if (dy)
            y += deviceDelta(f, offset + dy);
    }
    return [x, y];
}
function markAttach(f, c, markArray, markIndex, anchors, row, classCount, glyphPos) {
    const buffer = c.buffer, info = buffer.info;
    if (markIndex >= f.u16(markArray))
        return false;
    const record = markArray + 2 + markIndex * 4;
    const markClass = f.u16(record), markAnchor = markArray + f.u16(record + 2);
    if (row >= f.u16(anchors) || markClass >= classCount)
        return false;
    const o = f.u16(anchors + 2 + (row * classCount + markClass) * 2);
    if (!o)
        return false;
    const [markX, markY] = anchor(f, markAnchor), [baseX, baseY] = anchor(f, anchors + o);
    const baseOffset = resolveCrossOffset(info, glyphPos);
    const mark = buffer.cur();
    mark.attachChain = glyphPos - buffer.idx;
    mark.attachType = 1;
    mark.xOffset = baseX - markX;
    mark.yOffset = baseY - markY + baseOffset;
    buffer.hasAttachment = true;
    buffer.idx++;
    return true;
}
function resolveCrossOffset(info, glyphPos) {
    let offset = info[glyphPos].yOffset;
    while (info[glyphPos].attachType & 2) {
        const chain = info[glyphPos].attachChain;
        if (!chain)
            break;
        const parent = glyphPos + chain;
        if (parent < 0 || parent >= info.length)
            break;
        glyphPos = parent;
        offset += info[glyphPos].yOffset;
    }
    return offset;
}
function reverseCursiveMinorOffset(info, i, newParent, level) {
    if (level > MAX_NESTING_LEVEL)
        return;
    const chain = info[i].attachChain, type = info[i].attachType;
    if (!chain || !(type & 2))
        return;
    info[i].attachChain = 0;
    const j = i + chain;
    if (j < 0 || j >= info.length || j === newParent)
        return;
    reverseCursiveMinorOffset(info, j, newParent, level + 1);
    info[j].yOffset = -info[i].yOffset;
    info[j].attachChain = -chain;
    info[j].attachType = type;
}
export function propagateAttachmentOffsets(buffer) {
    if (!buffer.hasAttachment)
        return;
    const info = buffer.info, len = info.length, forward = buffer.direction === 4;
    const propagate = (i, level) => {
        const chain = info[i].attachChain, type = info[i].attachType;
        info[i].attachChain = 0;
        const j = i + chain;
        if (j < 0 || j >= len || !level)
            return;
        if (info[j].attachChain)
            propagate(j, level - 1);
        if (type & 2)
            info[i].yOffset += info[j].yOffset;
        else {
            info[i].xOffset += info[j].xOffset;
            if (j < i) {
                if (forward)
                    for (let k = j; k < i; k++) {
                        info[i].xOffset -= info[k].xAdvance;
                        info[i].yOffset -= info[k].yAdvance;
                    }
                else
                    for (let k = j + 1; k < i + 1; k++) {
                        info[i].xOffset += info[k].xAdvance;
                        info[i].yOffset += info[k].yAdvance;
                    }
            }
            else {
                if (forward)
                    for (let k = i; k < j; k++) {
                        info[i].xOffset += info[k].xAdvance;
                        info[i].yOffset += info[k].yAdvance;
                    }
                else
                    for (let k = i + 1; k < j + 1; k++) {
                        info[i].xOffset -= info[k].xAdvance;
                        info[i].yOffset -= info[k].yAdvance;
                    }
            }
        }
    };
    if (forward) {
        for (let i = 0; i < len; i++)
            if (info[i].attachChain)
                propagate(i, MAX_NESTING_LEVEL);
    }
    else
        for (let i = len; i-- > 0;)
            if (info[i].attachChain)
                propagate(i, MAX_NESTING_LEVEL);
}
const GLOBAL_BIT_SHIFT = 31;
const GLOBAL_BIT_MASK = 1 << GLOBAL_BIT_SHIFT;
const FIRST_BIT = 4;
export class OTMap {
    globalMask = GLOBAL_BIT_MASK;
    features = [];
    lookups = [[], []];
    stages = [[], []];
    chosenScript = ['', ''];
    foundScript = [false, false];
    feature(tag) {
        return this.features.find(f => f.tag === tag);
    }
    getMask(tag) {
        const f = this.feature(tag);
        return f ? [f.mask, f.shift] : [0, 0];
    }
    get1Mask(tag) {
        return this.feature(tag)?.oneMask ?? 0;
    }
    needsFallback(tag) {
        return this.feature(tag)?.needsFallback ?? false;
    }
    featureIndex(table, tag) {
        return this.feature(tag)?.index[table] ?? -1;
    }
    stageLookups(table, tag) {
        const f = this.feature(tag);
        if (!f)
            return [];
        const stage = f.stage[table], stages = this.stages[table];
        if (stage > stages.length)
            return [];
        const start = stage ? stages[stage - 1].lastLookup : 0;
        const end = stage < stages.length ? stages[stage].lastLookup : this.lookups[table].length;
        return this.lookups[table].slice(start, end);
    }
    apply(table, layout, buffer, gdef, plan, font) {
        const c = layout ? new ApplyContext(table, layout, buffer, gdef) : null;
        let i = 0;
        for (const stage of this.stages[table]) {
            for (; i < stage.lastLookup; i++) {
                const lookup = this.lookups[table][i];
                const l = layout && layout.lookup(lookup.index);
                if (!l || !c || !buffer.len || !lookup.mask)
                    continue;
                c.lookupIndex = lookup.index;
                c.lookupMask = lookup.mask;
                c.lastBase = -1;
                c.lastBaseUntil = 0;
                c.autoZWJ = lookup.autoZWJ;
                c.autoZWNJ = lookup.autoZWNJ;
                c.random = lookup.random;
                c.perSyllable = lookup.perSyllable;
                c.setLookupProps(l.props);
                applyString(c, l, table);
            }
            if (stage.pause)
                stage.pause(plan, font, buffer);
        }
    }
}
function applyString(c, l, table) {
    const buffer = c.buffer;
    if (!l.reverse) {
        if (table === 0)
            buffer.clearOutput();
        buffer.idx = 0;
        while (buffer.successful) {
            const info = buffer.info;
            let j = buffer.idx;
            while (j < buffer.len && !(l.covers(info[j].codepoint) && info[j].mask & c.lookupMask && c.checkGlyphProperty(info[j], c.lookupProps)))
                j++;
            if (j > buffer.idx)
                buffer.nextGlyphs(j - buffer.idx);
            if (buffer.idx >= buffer.len)
                break;
            let applied = false;
            for (const subtable of l.subtables)
                if (subtable(c)) {
                    applied = true;
                    break;
                }
            if (!applied)
                buffer.nextGlyph();
        }
        if (table === 0)
            buffer.sync();
    }
    else {
        buffer.idx = buffer.len - 1;
        do {
            const cur = buffer.cur();
            if (l.covers(cur.codepoint) && cur.mask & c.lookupMask && c.checkGlyphProperty(cur, c.lookupProps))
                for (const subtable of l.subtables)
                    if (subtable(c))
                        break;
            buffer.idx--;
        } while (buffer.idx >= 0);
    }
}
export class MapBuilder {
    tables;
    featureInfos = [];
    currentStage = [0, 0];
    stages = [[], []];
    scriptIndex = [-1, -1];
    chosenScript = ['', ''];
    foundScript = [false, false];
    langSys = [0, 0];
    isSimple = true;
    constructor(tables, scriptTags) {
        this.tables = tables;
        for (const t of [0, 1]) {
            const table = tables[t];
            if (!table)
                continue;
            let index = -1;
            for (const tag of scriptTags)
                if ((index = table.findScript(tag)) >= 0) {
                    this.chosenScript[t] = tag;
                    this.foundScript[t] = true;
                    break;
                }
            if (index < 0)
                for (const tag of ['DFLT', 'dflt', 'latn'])
                    if ((index = table.findScript(tag)) >= 0) {
                        this.chosenScript[t] = tag;
                        break;
                    }
            this.scriptIndex[t] = index;
            this.langSys[t] = table.langSys(index);
        }
    }
    addFeature(tag, flags = 0, value = 1) {
        this.featureInfos.push({ tag, seq: this.featureInfos.length + 1, maxValue: value, flags, defaultValue: flags & 1 ? value : 0, stage: [...this.currentStage] });
    }
    enableFeature(tag, flags = 0, value = 1) {
        this.addFeature(tag, flags | 1, value);
    }
    disableFeature(tag) {
        this.addFeature(tag, 1, 0);
    }
    addGsubPause(pause) {
        this.stages[0].push({ index: this.currentStage[0]++, pause });
    }
    addGposPause(pause) {
        this.stages[1].push({ index: this.currentStage[1]++, pause });
    }
    hasFeature(tag) {
        return [0, 1].some(t => this.tables[t]?.langSysFeatures(this.langSys[t]).features.has(tag));
    }
    compile() {
        const m = new OTMap();
        m.chosenScript = [...this.chosenScript];
        m.foundScript = [...this.foundScript];
        const langSys = [0, 1].map(t => this.tables[t]?.langSysFeatures(this.langSys[t]) ?? { required: -1, features: new Map() });
        const requiredTag = [0, 1].map(t => langSys[t].required >= 0 ? this.tables[t]?.featureTag(langSys[t].required) ?? '' : '');
        const requiredStage = [0, 0];
        let infos = this.featureInfos;
        if (infos.length) {
            if (!this.isSimple)
                infos = infos.slice().sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : a.seq - b.seq);
            const merged = [{ ...infos[0], stage: [...infos[0].stage] }];
            for (let i = 1; i < infos.length; i++) {
                const f = infos[i], j = merged[merged.length - 1];
                if (f.tag !== j.tag) {
                    merged.push({ ...f, stage: [...f.stage] });
                    continue;
                }
                if (f.flags & 1) {
                    j.flags |= 1;
                    j.maxValue = f.maxValue;
                    j.defaultValue = f.defaultValue;
                }
                else {
                    if (j.flags & 1)
                        j.flags ^= 1;
                    j.maxValue = Math.max(j.maxValue, f.maxValue);
                }
                j.flags |= f.flags & 2;
                j.stage[0] = Math.min(j.stage[0], f.stage[0]);
                j.stage[1] = Math.min(j.stage[1], f.stage[1]);
            }
            infos = merged;
        }
        let nextBit = FIRST_BIT;
        for (const info of infos) {
            const global = info.flags & 1 && info.maxValue === 1;
            const bitsNeeded = global ? 0 : Math.min(MAX_BITS, 32 - Math.clz32(info.maxValue));
            if (!info.maxValue || nextBit + bitsNeeded >= GLOBAL_BIT_SHIFT)
                continue;
            let found = false;
            const index = [-1, -1];
            for (const t of [0, 1]) {
                if (requiredTag[t] === info.tag)
                    requiredStage[t] = info.stage[t];
                const i = langSys[t].features.get(info.tag);
                if (i !== undefined) {
                    index[t] = i;
                    found = true;
                }
            }
            if (!found && info.flags & 16)
                for (const t of [0, 1]) {
                    const i = this.tables[t]?.findFeature(info.tag) ?? -1;
                    if (i >= 0) {
                        index[t] = i;
                        found = true;
                    }
                }
            if (!found && !(info.flags & 2))
                continue;
            const map = {
                tag: info.tag, index, stage: [...info.stage], shift: 0, mask: 0, oneMask: 0, needsFallback: !found,
                autoZWNJ: !(info.flags & 4), autoZWJ: !(info.flags & 8),
                random: !!(info.flags & 32), perSyllable: !!(info.flags & 64),
            };
            if (global) {
                map.shift = GLOBAL_BIT_SHIFT;
                map.mask = GLOBAL_BIT_MASK;
            }
            else {
                map.shift = nextBit;
                map.mask = (1 << nextBit + bitsNeeded) - (1 << nextBit);
                nextBit += bitsNeeded;
                m.globalMask |= info.defaultValue << map.shift & map.mask;
            }
            map.oneMask = 1 << map.shift & map.mask;
            m.features.push(map);
        }
        if (this.isSimple)
            m.features.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
        this.addGsubPause(null);
        this.addGposPause(null);
        for (const t of [0, 1]) {
            const table = this.tables[t];
            const lookups = m.lookups[t];
            let stageIndex = 0, lastNumLookups = 0;
            const add = (featureIndex, mask, autoZWNJ = true, autoZWJ = true, random = false, perSyllable = false, tag = '') => {
                if (!table || featureIndex < 0)
                    return;
                for (const index of table.featureLookups(featureIndex)) {
                    if (index >= table.lookupCount)
                        continue;
                    lookups.push({ index, mask, autoZWNJ, autoZWJ, random, perSyllable, tag });
                }
            };
            for (let stage = 0; stage < this.currentStage[t]; stage++) {
                if (langSys[t].required >= 0 && requiredStage[t] === stage)
                    add(langSys[t].required, GLOBAL_BIT_MASK);
                for (const feature of m.features)
                    if (feature.stage[t] === stage)
                        add(feature.index[t], feature.mask, feature.autoZWNJ, feature.autoZWJ, feature.random, feature.perSyllable, feature.tag);
                if (lastNumLookups + 1 < lookups.length) {
                    const stageLookups = lookups.splice(lastNumLookups).sort((a, b) => a.index - b.index);
                    for (const l of stageLookups) {
                        const last = lookups.length > lastNumLookups ? lookups[lookups.length - 1] : null;
                        if (last && last.index === l.index) {
                            last.mask |= l.mask;
                            last.autoZWNJ &&= l.autoZWNJ;
                            last.autoZWJ &&= l.autoZWJ;
                        }
                        else
                            lookups.push({ ...l });
                    }
                }
                lastNumLookups = lookups.length;
                if (stageIndex < this.stages[t].length && this.stages[t][stageIndex].index === stage) {
                    m.stages[t].push({ lastLookup: lastNumLookups, pause: this.stages[t][stageIndex].pause });
                    stageIndex++;
                }
            }
        }
        return m;
    }
}
