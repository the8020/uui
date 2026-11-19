/*!
 * The post filters of AV1 frames: deblocking, CDEF, superres upscaling and loop restoration, in the order
 * of the AV1 specification. Copyright (c) 2018-2021, VideoLAN and dav1d authors, BSD-2-Clause License (see
 * THIRD_PARTY_NOTICES.md)
 */
import { deblock } from "./loopfilter.js";
import { cdef, cdefActive } from "./cdef.js";
import { superres, loopRestoration } from "./restoration.js";
import { RESTORATION_NONE } from "./obu.js";
export function postFilter(f) {
    deblock(f);
    const usesLr = f.hdr.restoration.types.some(t => t !== RESTORATION_NONE);
    const doCdef = cdefActive(f);
    let pre = doCdef || usesLr ? f.planes.map(p => p.slice()) : f.planes;
    if (doCdef)
        cdef(f, pre);
    if (f.hdr.upscaledWidth !== f.width) {
        const up = superres(f, f.planes);
        pre = usesLr ? superres(f, pre).planes : up.planes;
        f.planes = up.planes;
        f.strides = up.strides;
    }
    if (usesLr) {
        const out = f.planes.map(p => p.slice());
        loopRestoration(f, pre, f.planes, out, f.strides);
        f.planes = out;
    }
}
