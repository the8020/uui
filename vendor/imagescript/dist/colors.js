import { finite, color as checkColor } from "./util/options.js";
export function channel(value) {
    return value > 255 ? 255 : value > 0 ? Math.round(value) : 0;
}
export function wrapHue(h) {
    const t = h - Math.trunc(h) + 1;
    return t < 1 ? t : t < 2 ? t - 1 : 0;
}
export function hue2rgb(p, q, t) {
    if (t < 0)
        t += 1;
    if (t > 1)
        t -= 1;
    if (t < 1 / 6)
        return p + (q - p) * 6 * t;
    if (t < 1 / 2)
        return q;
    if (t < 2 / 3)
        return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
export function rgbaToHSLA(r, g, b, a) {
    r = finite(r, 'red') / 255;
    g = finite(g, 'green') / 255;
    b = finite(b, 'blue') / 255;
    a = finite(a, 'alpha');
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s;
    const l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }
    return [h, s, l, a / 255];
}
function gradientBetween(startColor, endColor) {
    const sr = startColor >>> 24;
    const sg = startColor >> 16 & 0xff;
    const sb = startColor >> 8 & 0xff;
    const sa = startColor & 0xff;
    const er = (endColor >>> 24) - sr;
    const eg = (endColor >> 16 & 0xff) - sg;
    const eb = (endColor >> 8 & 0xff) - sb;
    const ea = (endColor & 0xff) - sa;
    return position => {
        const r = sr + position * er;
        const g = sg + position * eg;
        const b = sb + position * eb;
        const a = sa + position * ea;
        return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
    };
}
export class Colors {
    constructor() { }
    static fromRGBA(r, g, b, a) {
        r = finite(r, 'red');
        g = finite(g, 'green');
        b = finite(b, 'blue');
        a = finite(a, 'alpha');
        return (channel(r) << 24 | channel(g) << 16 | channel(b) << 8 | channel(a)) >>> 0;
    }
    static fromRGB(r, g, b) {
        return Colors.fromRGBA(r, g, b, 0xff);
    }
    static fromHSLA(h, s, l, a) {
        h = wrapHue(finite(h, 'hue'));
        s = finite(s, 'saturation');
        l = finite(l, 'lightness');
        a = finite(a, 'alpha');
        s = Math.min(1, Math.max(0, s));
        l = Math.min(1, Math.max(0, l));
        a = Math.min(1, Math.max(0, a));
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        }
        else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return Colors.fromRGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255));
    }
    static fromHSL(h, s, l) {
        return Colors.fromHSLA(h, s, l, 1);
    }
    static toRGBA(color) {
        color = checkColor(color);
        return [(color >> 24) & 0xff, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
    }
    static toRGB(color) {
        const [r, g, b] = Colors.toRGBA(color);
        return [r, g, b];
    }
    static toHSLA(color) {
        const [r, g, b, a] = Colors.toRGBA(color);
        return rgbaToHSLA(r, g, b, a);
    }
    static gradient(colors) {
        const entries = Object.entries(colors).sort((a, b) => Number(a[0]) - Number(b[0]));
        const positions = entries.map(e => finite(parseFloat(e[0]), 'gradient position'));
        const values = entries.map(e => checkColor(e[1]));
        if (positions.length === 0)
            throw new RangeError('Invalid gradient point count');
        else if (positions.length === 1) {
            return () => values[0];
        }
        else if (positions.length === 2) {
            const gradient = gradientBetween(values[0], values[1]);
            return position => {
                if (position <= positions[0])
                    return values[0];
                if (position >= positions[1])
                    return values[1];
                return gradient((position - positions[0]) / (positions[1] - positions[0]));
            };
        }
        const minDef = Math.min(...positions);
        const maxDef = Math.max(...positions);
        const gradients = [];
        for (let i = 0; i < positions.length; i++) {
            const minPos = positions[i - 1];
            if (minPos === undefined)
                continue;
            const maxPos = positions[i];
            let minVal = values[i - 1];
            if (minVal === undefined)
                minVal = values[i];
            const maxVal = values[i];
            const gradient = gradientBetween(minVal, maxVal);
            gradients.push({ min: minPos, max: maxPos, gradient });
        }
        return position => {
            if (position <= minDef)
                return gradients[0].gradient(0);
            if (position >= maxDef)
                return gradients[gradients.length - 1].gradient(1);
            for (const gradient of gradients)
                if (position >= gradient.min && position <= gradient.max)
                    return gradient.gradient((position - gradient.min) / (gradient.max - gradient.min));
            throw new RangeError(`Invalid gradient position: ${position}`);
        };
    }
}
