export const cat = (...categories) => ({ kind: 'set', categories: new Set(categories), negated: false });
export const any = { kind: 'set', categories: null, negated: false };
export const seq = (...items) => ({ kind: 'seq', items });
export const alt = (...items) => ({ kind: 'alt', items });
export const opt = (...items) => ({ kind: 'repeat', item: seq(...items), min: 0, max: 1 });
export const star = (...items) => ({ kind: 'repeat', item: seq(...items), min: 0, max: Infinity });
export const plus = (...items) => ({ kind: 'repeat', item: seq(...items), min: 1, max: Infinity });
export function scanner(patterns) {
    const states = [];
    const add = () => states.push({ test: null, next: [], accept: -1 }) - 1;
    const build = (e, start) => {
        switch (e.kind) {
            case 'set': {
                const end = add(), { categories, negated } = e;
                const s = add();
                states[start].next.push(s);
                states[s].test = categories === null ? () => true : negated ? c => !categories.has(c) : c => categories.has(c);
                states[s].next.push(end);
                return end;
            }
            case 'seq': {
                let s = start;
                for (const item of e.items)
                    s = build(item, s);
                return s;
            }
            case 'alt': {
                const end = add();
                for (const item of e.items) {
                    const s = add();
                    states[start].next.push(s);
                    states[build(item, s)].next.push(end);
                }
                return end;
            }
            case 'repeat': {
                if (e.min === 1)
                    return build({ ...e, min: 0 }, build(e.item, start));
                const end = add();
                if (e.max === 1) {
                    states[start].next.push(end);
                    states[build(e.item, start)].next.push(end);
                    return end;
                }
                const loop = add();
                states[start].next.push(loop);
                states[loop].next.push(end);
                states[build(e.item, loop)].next.push(loop);
                return end;
            }
        }
    };
    const root = add();
    for (const [i, [pattern]] of patterns.entries()) {
        const s = add();
        states[root].next.push(s);
        states[build(pattern, s)].accept = i;
    }
    const closure = (set) => {
        const seen = new Uint8Array(states.length), out = [];
        const stack = set.slice();
        while (stack.length) {
            const s = stack.pop();
            if (seen[s])
                continue;
            seen[s] = 1;
            out.push(s);
            if (states[s].test === null)
                for (const n of states[s].next)
                    stack.push(n);
        }
        return out;
    };
    const dfaStates = new Map();
    const dfa = (set) => {
        set.sort((a, b) => a - b);
        const key = set.join(',');
        let state = dfaStates.get(key);
        if (!state) {
            let accept = -1;
            for (const s of set)
                if (states[s].accept >= 0 && (accept < 0 || states[s].accept < accept))
                    accept = states[s].accept;
            dfaStates.set(key, state = { next: new Map(), accept, states: set });
        }
        return state;
    };
    const step = (state, category) => {
        let next = state.next.get(category);
        if (next === undefined) {
            const targets = [];
            for (const s of state.states) {
                const test = states[s].test;
                if (test && test(category))
                    targets.push(...states[s].next);
            }
            next = targets.length ? dfa(closure(targets)) : null;
            if (next && !next.states.length)
                next = null;
            state.next.set(category, next);
        }
        return next;
    };
    const start = dfa(closure([root]));
    return categories => {
        const syllables = [];
        for (let p = 0; p < categories.length;) {
            let state = start, bestLength = 0, bestPattern = -1;
            for (let q = p; q < categories.length && state; q++) {
                state = step(state, categories[q]);
                if (state && state.accept >= 0) {
                    bestLength = q - p + 1;
                    bestPattern = state.accept;
                }
            }
            if (bestLength === 0) {
                bestLength = 1;
                bestPattern = patterns.length - 1;
            }
            syllables.push([p, p + bestLength, patterns[bestPattern][1]]);
            p += bestLength;
        }
        return syllables;
    };
}
export function lazyScanner(patterns) {
    let scan = null;
    return categories => (scan ??= scanner(patterns()))(categories);
}
