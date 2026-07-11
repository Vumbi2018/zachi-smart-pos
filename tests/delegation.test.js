/**
 * Unit tests for the delegated-event parser in
 * `public/js/utils/delegation.js`.
 *
 * The parser runs in the browser and is exposed (only when `window` is
 * present) on `window.__Delegation = { parseCall, parseArg, splitArgs }`
 * specifically so we can exercise it here. We load the file into a Node
 * `vm` context with a minimal `window`/`document` shim — no real DOM is
 * needed because we only test argument parsing.
 *
 * These are guard-rails for the data-on-X migration done in Task #5.
 * The most important regression they catch is array-literal arguments
 * (e.g. `Inventory.mergeGroup(null,[1,2],1)` from inventory.js) which an
 * earlier version of the parser silently passed through as the string
 * `"[1,2]"`, breaking the merge action at runtime.
 *
 * Note: we use loose `node:assert` (not /strict) because objects created
 * inside the vm context have a different `Array.prototype` reference than
 * the host realm — strict deep-equal would reject them on prototype check
 * even though their structure and values are identical.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'utils', 'delegation.js'),
    'utf8'
);

function loadParser() {
    const sandbox = {
        window: {},
        document: { addEventListener() {} },
        console,
    };
    sandbox.window.document = sandbox.document;
    vm.createContext(sandbox);
    vm.runInContext(SOURCE, sandbox);
    if (!sandbox.window.__Delegation) {
        throw new Error('delegation.js did not expose window.__Delegation');
    }
    return sandbox.window.__Delegation;
}

const D = loadParser();

// Minimal context object the parser uses to resolve $tokens.
function ctx({ value = '', checked = false, files = null } = {}) {
    const el = { value, checked, files };
    const event = { target: el };
    return { event, el };
}

// Cross-realm-safe deep equality: stringify both sides.
function eqJSON(actual, expected) {
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

test('parseArg: primitives', () => {
    const c = ctx();
    assert.strictEqual(D.parseArg('42', c), 42);
    assert.strictEqual(D.parseArg('-1.5', c), -1.5);
    assert.strictEqual(D.parseArg('true', c), true);
    assert.strictEqual(D.parseArg('false', c), false);
    assert.strictEqual(D.parseArg('null', c), null);
    assert.strictEqual(D.parseArg('undefined', c), undefined);
});

test('parseArg: strings (single + double quoted)', () => {
    const c = ctx();
    assert.strictEqual(D.parseArg("'hello'", c), 'hello');
    assert.strictEqual(D.parseArg('"world"', c), 'world');
    assert.strictEqual(D.parseArg("'it\\'s ok'", c), "it's ok");
});

test('parseArg: $tokens', () => {
    const c = ctx({ value: '7.5', checked: true });
    assert.strictEqual(D.parseArg('$value', c), '7.5');
    assert.strictEqual(D.parseArg('$valueNum', c), 7.5);
    assert.strictEqual(D.parseArg('$valueInt', c), 7);
    assert.strictEqual(D.parseArg('$checked', c), true);
    assert.strictEqual(D.parseArg('$el', c), c.el);
    assert.strictEqual(D.parseArg('$event', c), c.event);
});

test('parseArg: array literals (regression — Inventory.mergeGroup)', () => {
    const c = ctx();
    // The exact shape emitted by inventory.js:1344 / 1358 after template
    // substitution: numeric ids inside a JS array literal.
    eqJSON(D.parseArg('[1,2,3]', c), [1, 2, 3]);
    eqJSON(D.parseArg('[]', c), []);
    eqJSON(D.parseArg('[ 1 , 2 ]', c), [1, 2]);
    // Mixed types inside an array.
    eqJSON(D.parseArg("['a','b',3]", c), ['a', 'b', 3]);
    // Nested arrays.
    eqJSON(D.parseArg('[[1,2],[3,4]]', c), [[1, 2], [3, 4]]);
});

test('parseCall: full spec — Inventory.mergeGroup(null,[1,2],1)', () => {
    const c = ctx();
    const call = D.parseCall('Inventory.mergeGroup(null,[1,2],1)');
    assert.strictEqual(call.name, 'Inventory.mergeGroup');
    const args = call.argTokens.map(t => D.parseArg(t, c));
    eqJSON(args, [null, [1, 2], 1]);
});

test('parseCall: spec with $tokens — POS.setQty(0, $value)', () => {
    const c = ctx({ value: '3' });
    const call = D.parseCall('POS.setQty(0, $value)');
    assert.strictEqual(call.name, 'POS.setQty');
    const args = call.argTokens.map(t => D.parseArg(t, c));
    eqJSON(args, [0, '3']);
});

test('parseCall: string with embedded comma stays whole', () => {
    const c = ctx();
    const call = D.parseCall("X.y('a,b', 7)");
    const args = call.argTokens.map(t => D.parseArg(t, c));
    eqJSON(args, ['a,b', 7]);
});

test('splitArgs: respects nested brackets and quotes', () => {
    eqJSON(D.splitArgs('1,2,3'), ['1', '2', '3']);
    eqJSON(D.splitArgs('[1,2],3'), ['[1,2]', '3']);
    eqJSON(D.splitArgs("'a,b',3"), ["'a,b'", '3']);
    eqJSON(D.splitArgs('f(1,2),3'), ['f(1,2)', '3']);
});
