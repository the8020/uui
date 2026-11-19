export function mirror(i, len) {
    for (;;) {
        if (i < 0)
            i = -i - 1;
        else if (i >= len)
            i = 2 * len - i - 1;
        else
            return i;
    }
}
export function upsample(src, w, h, factor, image, outW, outH) {
    const weights = factor === 2 ? image.up2 : factor === 4 ? image.up4 : image.up8;
    const half = factor / 2;
    const kernels = new Float32Array(half * half * 25);
    let k = 0;
    for (let y = 0; y < 5 * half; y++) {
        for (let x = y; x < 5 * half; x++) {
            const v = weights[k++];
            kernels[(Math.floor(y / 5) * half + Math.floor(x / 5)) * 25 + (y % 5) * 5 + x % 5] = v;
            kernels[(Math.floor(x / 5) * half + Math.floor(y / 5)) * 25 + (x % 5) * 5 + y % 5] = v;
        }
    }
    const pw = w + 4, padded = new Float32Array(pw * (h + 4));
    for (let y = 0; y < h + 4; y++) {
        const sy = mirror(y - 2, h);
        for (let x = 0; x < pw; x++)
            padded[y * pw + x] = src[sy * w + mirror(x - 2, w)];
    }
    const out = new Float32Array(outW * outH), window = new Float32Array(25);
    for (let y = 0; y < outH; y++) {
        const ry = Math.floor(y / factor), fy = y % factor, my = Math.min(fy, factor - fy - 1), flipV = fy >= half;
        for (let x = 0; x < outW; x++) {
            const rx = Math.floor(x / factor), fx = x % factor, mx = Math.min(fx, factor - fx - 1), flipH = fx >= half;
            const kernel = (my * half + mx) * 25;
            let sum = 0, min = Infinity, max = -Infinity;
            for (let iy = 0; iy < 5; iy++) {
                const ky = flipV ? 4 - iy : iy, row = (ry + iy) * pw + rx;
                for (let ix = 0; ix < 5; ix++) {
                    const kx = flipH ? 4 - ix : ix, v = padded[row + ix];
                    sum += kernels[kernel + ky * 5 + kx] * v;
                    if (v < min)
                        min = v;
                    if (v > max)
                        max = v;
                }
            }
            out[y * outW + x] = min > max ? NaN : sum < min ? min : sum > max ? max : sum;
        }
    }
    void window;
    return out;
}
