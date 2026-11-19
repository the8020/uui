const globals = globalThis;
function builtin(id) {
    try {
        return globals.process?.getBuiltinModule?.(id) ?? null;
    }
    catch {
        return null;
    }
}
function thread(post, listen, terminate) {
    let current = null;
    listen(m => {
        if (!current)
            return;
        if ('message' in m)
            current.onMessage?.(m.message);
        else {
            const c = current;
            current = null;
            if (m.error !== undefined)
                c.reject(new Error(m.error));
            else
                c.resolve(m.result);
        }
    }, e => {
        const c = current;
        current = null;
        c?.reject(e);
    });
    return {
        run: (task, onMessage) => new Promise((resolve, reject) => {
            current = { resolve, reject, onMessage };
            post(task);
        }),
        terminate,
    };
}
export function availableThreads() {
    if (typeof SharedArrayBuffer === 'undefined' || typeof Atomics === 'undefined' || globals.crossOriginIsolated === false)
        return 0;
    if (!globals.Worker && !builtin('node:worker_threads'))
        return 0;
    const os = builtin('node:os');
    const n = os ? os.availableParallelism ? os.availableParallelism() : os.cpus().length : globals.navigator?.hardwareConcurrency ?? 1;
    return Math.max(1, n | 0);
}
export function startThreads(n) {
    if (n < 1 || !availableThreads())
        return null;
    const threads = [];
    try {
        for (let i = 0; i < n; i++) {
            if (globals.Worker) {
                const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
                threads.push(thread(m => w.postMessage(m), (message, error) => {
                    w.onmessage = e => message(e.data);
                    w.onerror = e => {
                        e.preventDefault?.();
                        error(new Error(e.message ?? 'worker failed'));
                    };
                }, () => w.terminate()));
            }
            else {
                const { Worker } = builtin('node:worker_threads');
                const url = import.meta.url;
                const w = new Worker(new URL(url.endsWith('.ts') ? './worker.ts' : './worker.js', url));
                w.unref();
                threads.push(thread(m => w.postMessage(m), (message, error) => {
                    w.on('message', m => message(m));
                    w.on('error', e => error(e));
                }, () => void w.terminate()));
            }
        }
        return threads;
    }
    catch {
        for (const t of threads)
            t.terminate();
        return null;
    }
}
export async function runChunks(threads, task, count, local) {
    const results = new Array(count);
    if (!threads || count < 2) {
        for (let i = 0; i < count; i++)
            results[i] = local(i);
        return results;
    }
    const counter = new Int32Array(new SharedArrayBuffer(4));
    await Promise.all(threads.slice(0, count).map(t => t.run({ ...task, counter, chunks: count }, m => {
        const { chunk, result } = m;
        results[chunk] = result;
    })));
    return results;
}
export const sharedOf = (array) => array.buffer instanceof SharedArrayBuffer ? array : shared(array);
export function shared(array) {
    const Type = array.constructor;
    const copy = new Type(new SharedArrayBuffer(array.byteLength));
    copy.set(array);
    return copy;
}
