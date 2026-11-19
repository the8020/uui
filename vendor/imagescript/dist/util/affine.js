function cubic(t, out) {
    const t2 = t * t, t3 = t2 * t;
    out[0] = -0.5 * t3 + t2 - 0.5 * t;
    out[1] = 1.5 * t3 - 2.5 * t2 + 1;
    out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
    out[3] = 0.5 * t3 - 0.5 * t2;
}
export function sampleAffine(src, width, height, out, outWidth, outHeight, inverse, left, top, mode) {
    const [a, b, c, d, e, f] = inverse;
    const wx = new Float64Array(4), wy = new Float64Array(4);
    for (let oy = 0; oy < outHeight; oy++) {
        const y = oy + top + 0.5;
        const sx0 = a * (left + 0.5) + c * y + e, sy0 = b * (left + 0.5) + d * y + f;
        for (let ox = 0; ox < outWidth; ox++) {
            const sx = sx0 + a * ox, sy = sy0 + b * ox;
            const o = 4 * (oy * outWidth + ox);
            if (mode === 'nearest-neighbor') {
                const ix = Math.floor(sx), iy = Math.floor(sy);
                if (ix < 0 || iy < 0 || ix >= width || iy >= height)
                    continue;
                const i = 4 * (iy * width + ix);
                out[o] = src[i];
                out[o + 1] = src[i + 1];
                out[o + 2] = src[i + 2];
                out[o + 3] = src[i + 3];
                continue;
            }
            const u = sx - 0.5, v = sy - 0.5;
            const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
            let r = 0, g = 0, bl = 0, alpha = 0;
            if (mode === 'bilinear') {
                if (x0 < -1 || y0 < -1 || x0 >= width || y0 >= height)
                    continue;
                for (let j = 0; j < 2; j++) {
                    const yy = y0 + j;
                    if (yy < 0 || yy >= height)
                        continue;
                    const weightY = j ? fy : 1 - fy;
                    for (let i = 0; i < 2; i++) {
                        const xx = x0 + i;
                        if (xx < 0 || xx >= width)
                            continue;
                        const p = 4 * (yy * width + xx), weight = (i ? fx : 1 - fx) * weightY * src[p + 3];
                        r += weight * src[p];
                        g += weight * src[p + 1];
                        bl += weight * src[p + 2];
                        alpha += weight;
                    }
                }
            }
            else {
                if (x0 < -2 || y0 < -2 || x0 > width || y0 > height)
                    continue;
                cubic(fx, wx);
                cubic(fy, wy);
                for (let j = 0; j < 4; j++) {
                    const yy = y0 - 1 + j;
                    if (yy < 0 || yy >= height)
                        continue;
                    for (let i = 0; i < 4; i++) {
                        const xx = x0 - 1 + i;
                        if (xx < 0 || xx >= width)
                            continue;
                        const p = 4 * (yy * width + xx), weight = wx[i] * wy[j] * src[p + 3];
                        r += weight * src[p];
                        g += weight * src[p + 1];
                        bl += weight * src[p + 2];
                        alpha += weight;
                    }
                }
            }
            if (alpha <= 0)
                continue;
            out[o] = r / alpha;
            out[o + 1] = g / alpha;
            out[o + 2] = bl / alpha;
            out[o + 3] = alpha;
        }
    }
}
