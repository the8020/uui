import { EntropyCode, Tokens, packSigned } from "./entropy-enc.js";
import { WeightedPredictor, DEFAULT_WP } from "./modular.js";
export const PRED_ZERO = 0, PRED_LEFT = 1, PRED_GRADIENT = 5, PRED_WEIGHTED = 6;
export const PROP_CHANNEL = 0, PROP_STREAM = 1, PROP_GRADIENT = 9, PROP_WP_ERROR = 15;
export class MATree {
    root;
    leaves = new Map();
    nodes = [];
    constructor(root) {
        this.root = root;
        for (let queue = [root]; queue.length;) {
            const next = [];
            for (const n of queue) {
                this.nodes.push(n);
                if ('predictor' in n)
                    this.leaves.set(n, this.leaves.size);
                else
                    next.push(n.above, n.below);
            }
            queue = next;
        }
    }
    get numLeaves() {
        return this.leaves.size;
    }
    context(leaf) {
        return this.leaves.get(leaf);
    }
    write(w) {
        const t = new Tokens();
        for (const n of this.nodes) {
            if ('predictor' in n) {
                t.push(1, 0);
                t.push(2, n.predictor);
                t.push(3, 0);
                t.push(4, 0);
                t.push(5, 0);
            }
            else {
                t.push(1, n.property + 1);
                t.push(0, packSigned(n.split));
            }
        }
        const code = new EntropyCode([t], 6);
        code.writeHeader(w);
        code.writeTokens(w, t);
    }
}
export function fixedTree(property, cutoffs, predictor, numPixels) {
    const logPx = numPixels <= 1 ? 0 : 32 - Math.clz32(numPixels - 1), minGap = logPx < 14 ? 8 * (14 - logPx) : 0;
    const build = (begin, end) => {
        if (begin + minGap >= end)
            return { predictor };
        const split = (begin + end) >> 1;
        return { property, split: cutoffs[split], above: build(split + 1, end), below: build(begin, split) };
    };
    return build(0, cutoffs.length);
}
const clampedGradient = (n, w, nw) => {
    const lo = Math.min(n, w), hi = Math.max(n, w), g = n + w - nw;
    return g < lo ? lo : g > hi ? hi : g;
};
function specialize(n, channel, stream) {
    while (!('predictor' in n) && (n.property === PROP_CHANNEL || n.property === PROP_STREAM))
        n = (n.property === PROP_CHANNEL ? channel : stream) > n.split ? n.above : n.below;
    return n;
}
const usesWP = (n) => 'predictor' in n ? n.predictor === PRED_WEIGHTED : n.property === PROP_WP_ERROR || usesWP(n.above) || usesWP(n.below);
export function channelTokens(t, tree, data, w, h, channel, stream) {
    const root = specialize(tree.root, channel, stream);
    if ('predictor' in root && root.predictor === PRED_ZERO) {
        const ctx = tree.context(root);
        for (let i = 0; i < w * h; i++)
            t.push(ctx, packSigned(data[i]));
        return;
    }
    const wp = usesWP(root) ? new WeightedPredictor(DEFAULT_WP, w) : null;
    for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
            const left = x ? data[i - 1] : y ? data[i - w] : 0, top = y ? data[i - w] : left;
            const topleft = x && y ? data[i - w - 1] : left, topright = x + 1 < w && y ? data[i - w + 1] : top;
            const toptop = y > 1 ? data[i - 2 * w] : top;
            const wpPred = wp ? wp.predict(x, y, top, left, topright, topleft, toptop) : 0;
            let n = root;
            while (!('predictor' in n)) {
                const v = n.property === PROP_GRADIENT ? left + top - topleft : n.property === PROP_WP_ERROR ? wp.maxError : 0;
                n = v > n.split ? n.above : n.below;
            }
            const p = n.predictor;
            const guess = p === PRED_ZERO ? 0 : p === PRED_LEFT ? left : p === PRED_GRADIENT ? clampedGradient(top, left, topleft) : wpPred;
            t.push(tree.context(n), packSigned(data[i] - guess));
            wp?.update(data[i], x, y);
        }
    }
}
export function streamHeader(w) {
    w.write(1, 1);
    w.write(1, 1);
    w.write(2, 0);
}
