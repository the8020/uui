import { searchRows, filterTrials } from "../codecs/av1/encode.js";
import { conversionChunks, tileChunks } from "../codecs/avif.js";
import { costChunks, predictorChunks } from "../codecs/vp8l.js";
import { varblockChunks } from "../codecs/jxl/acs-enc.js";
import { maskBlurChunks, maskingChunks } from "../codecs/jxl/aq-enc.js";
import { coefficientChunks, hfTokenChunks, xybChunks } from "../codecs/jxl/vardct-enc.js";
import { groupChunks, postChunks } from "../codecs/jxl/frame.js";
import { modularGroupChunks, modularWriteChunks } from "../codecs/jxl/modular-lossless.js";
const chunkTasks = {
    'avif-convert': conversionChunks,
    'avif-tiles': tileChunks,
    'vp8l-predictor': predictorChunks,
    'vp8l-costs': costChunks,
    'jxl-xyb': xybChunks,
    'jxl-masking': maskingChunks,
    'jxl-mask-blur': maskBlurChunks,
    'jxl-varblocks': varblockChunks,
    'jxl-coefficients': coefficientChunks,
    'jxl-hf-tokens': hfTokenChunks,
    'jxl-modular-groups': modularGroupChunks,
    'jxl-modular-write': modularWriteChunks,
    'jxl-groups': groupChunks,
    'jxl-post': postChunks,
};
const globals = globalThis;
function handle(port, task) {
    try {
        const message = (m) => port.post({ message: m });
        let result;
        if (task.task === 'av1-search')
            result = searchRows(task, message);
        else if (task.task === 'av1-filter')
            result = filterTrials(task);
        else if (task.task in chunkTasks) {
            const { counter, chunks } = task, run = chunkTasks[task.task](task);
            for (let chunk; (chunk = Atomics.add(counter, 0, 1)) < chunks;)
                message({ chunk, result: run(chunk) });
        }
        else
            throw new Error(`unknown task ${task.task}`);
        port.post({ result });
    }
    catch (e) {
        port.post({ error: String(e.stack ?? e) });
    }
}
if (typeof globals.postMessage === 'function' && 'onmessage' in globals) {
    const port = { post: (m) => globals.postMessage(m) };
    globals.onmessage = e => handle(port, e.data);
}
else {
    const { parentPort } = globals.process?.getBuiltinModule?.('node:worker_threads');
    const port = { post: (m) => parentPort.postMessage(m) };
    parentPort.on('message', m => handle(port, m));
}
