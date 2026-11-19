/*!
 * Decodes the first shown frame of an AV1 bitstream (intra frames only), following dav1d's handling of the OBUs
 * (src/obu.c). Copyright (c) 2018-2021, VideoLAN and dav1d authors, BSD-2-Clause License (see THIRD_PARTY_NOTICES.md)
 */
import { MAX_PIXELS, checkPixels } from "../../util/limits.js";
import { BitReader, InterFrameError, parseSequenceHeader, parseFrameHeader, obus, OBU_SEQUENCE_HEADER, OBU_TEMPORAL_DELIMITER, OBU_FRAME_HEADER, OBU_REDUNDANT_FRAME_HEADER, OBU_FRAME, OBU_TILE_GROUP } from "./obu.js";
import { Frame, TileDecoder, decodeTileGroup } from "./decode.js";
import { postFilter } from "./postfilter.js";
import { applyFilmGrain } from "./filmgrain.js";
export { Frame };
export function decodeAV1(data, start = 0, end = data.length, { maxPixels = MAX_PIXELS, filmGrain = true, operatingPoint = 0, layer = -1 } = {}) {
    let seq = null;
    let hdr = null;
    let frame = null;
    let decoder = null;
    let tilesDone = 0;
    let opIdc = 0, target = 0;
    let best = null;
    const refs = new Array(8).fill(null);
    for (const obu of obus(data, start, end)) {
        if (obu.type !== OBU_SEQUENCE_HEADER && obu.type !== OBU_TEMPORAL_DELIMITER && opIdc &&
            (!(opIdc >> obu.temporalId & 1) || !(opIdc >> obu.spatialId + 8 & 1)))
            continue;
        if (obu.type === OBU_REDUNDANT_FRAME_HEADER && hdr)
            continue;
        const r = new BitReader(data, obu.start, obu.end);
        switch (obu.type === OBU_REDUNDANT_FRAME_HEADER ? OBU_FRAME_HEADER : obu.type) {
            case OBU_SEQUENCE_HEADER:
                seq = parseSequenceHeader(r);
                opIdc = seq.operatingPoints[Math.min(operatingPoint, seq.operatingPoints.length - 1)].idc;
                target = opIdc >> 8 ? 31 - Math.clz32(opIdc >> 8) : 0;
                if (layer >= 0 && layer < target)
                    target = layer;
                break;
            case OBU_FRAME_HEADER:
            case OBU_FRAME: {
                if (!seq)
                    throw new Error('AV1: frame before the sequence header');
                try {
                    hdr = parseFrameHeader(r, seq, obu.temporalId, obu.spatialId);
                }
                catch (err) {
                    const lower = best;
                    if (!(err instanceof InterFrameError) || !lower)
                        throw err;
                    lower.incomplete = true;
                    return lower;
                }
                if (hdr.showExistingFrame) {
                    const shown = refs[hdr.existingFrameIdx];
                    if (!shown)
                        throw new Error('AV1: shows a frame that doesn\'t exist');
                    return output(shown);
                }
                checkPixels(hdr.upscaledWidth, hdr.height, maxPixels);
                frame = new Frame(seq, hdr);
                decoder = new TileDecoder(frame);
                tilesDone = 0;
                if (obu.type !== OBU_FRAME)
                    break;
                r.align();
                const shown = tileGroup(r, obu.end, obu.spatialId);
                if (shown)
                    return shown;
                break;
            }
            case OBU_TILE_GROUP: {
                if (!hdr || !frame)
                    throw new Error('AV1: tile group without a frame header');
                const shown = tileGroup(r, obu.end, obu.spatialId);
                if (shown)
                    return shown;
                break;
            }
        }
    }
    const lower = best;
    if (lower)
        return lower;
    throw new Error('AV1: no frame');
    function tileGroup(r, end, spatialId) {
        const h = hdr, f = frame;
        const count = h.tiles.cols * h.tiles.rows;
        let first = 0, last = count - 1;
        if (count > 1 && r.bit()) {
            const bits = h.tiles.log2Cols + h.tiles.log2Rows;
            first = r.bits(bits);
            last = r.bits(bits);
        }
        r.align();
        if (first !== tilesDone || last < first || last >= count)
            throw new Error('AV1: invalid tile group');
        decodeTileGroup(decoder, data, r.byte, end, first, last);
        tilesDone = last + 1;
        if (tilesDone < count)
            return null;
        postFilter(f);
        for (let i = 0; i < 8; i++)
            if (h.refreshFrameFlags >> i & 1)
                refs[i] = f;
        if (!h.showFrame)
            return null;
        if (opIdc && spatialId < target) {
            best = output(f);
            return null;
        }
        return output(f);
    }
    function output(f) {
        if (filmGrain && f.hdr.filmGrain)
            f.planes = applyFilmGrain(f, f.hdr.filmGrain);
        return f;
    }
}
