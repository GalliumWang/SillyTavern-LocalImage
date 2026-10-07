import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFloatingButtonDraggable, positionFloatingPanel } from '../src/FloatingControls.mjs';

class Button extends EventTarget {
    style = {};
    offsetWidth = 44;
    offsetHeight = 44;
    classes = new Set();
    classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    captured = null;
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
    getBoundingClientRect() {
        const left = parseFloat(this.style.left);
        const top = parseFloat(this.style.top);
        return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight };
    }
}

function dispatch(target, type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, detail: 1, ...properties });
    target.dispatchEvent(event);
}

function setup(position = null) {
    const button = new Button();
    const viewport = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 800 });
    const state = { position, saves: 0, clicks: 0, layouts: 0 };
    const cleanup = makeFloatingButtonDraggable(button, {
        getPosition: () => state.position,
        savePosition: value => { state.position = value; state.saves++; },
        onClick: () => state.clicks++,
        onPositioned: () => state.layouts++,
    }, viewport);
    const down = (properties = {}) => dispatch(button, 'pointerdown', { clientX: 960, clientY: 680, ...properties });
    const move = (x, y, properties = {}) => dispatch(button, 'pointermove', { clientX: x, clientY: y, ...properties });
    const up = (x, y) => dispatch(button, 'pointerup', { clientX: x, clientY: y });
    return { button, viewport, state, cleanup, down, move, up };
}

test('a tap with small movement opens the panel without saving or moving the button', () => {
    const s = setup();
    const initial = { ...s.button.style };
    s.down();
    s.move(962, 682);
    s.up(962, 682);
    dispatch(s.button, 'click');
    assert.deepEqual(s.button.style, initial);
    assert.equal(s.state.clicks, 1);
    assert.equal(s.state.saves, 0);
    assert.equal(s.button.captured, null);
    s.cleanup();
});

test('dragging saves once on release, suppresses the resulting click, and allows the next tap', () => {
    const s = setup();
    s.down();
    s.move(360, 180);
    assert.equal(s.button.style.left, '348px');
    assert.equal(s.button.style.top, '160px');
    assert.equal(s.state.saves, 0);
    assert.ok(s.button.classes.has('is-dragging'));
    s.up(360, 180);
    dispatch(s.button, 'click');
    assert.equal(s.state.saves, 1);
    assert.equal(s.state.clicks, 0);
    assert.ok(!s.button.classes.has('is-dragging'));
    s.down({ clientX: 360, clientY: 180 });
    s.up(360, 180);
    dispatch(s.button, 'click');
    assert.equal(s.state.clicks, 1);
    s.cleanup();
});

test('a saved drag restores after recreation and scales into a smaller viewport', () => {
    const s = setup();
    s.down();
    s.move(360, 180);
    s.up(360, 180);
    const saved = s.state.position;
    s.cleanup();
    const restored = setup(saved);
    assert.equal(restored.button.style.left, '348px');
    assert.equal(restored.button.style.top, '160px');
    restored.viewport.innerWidth = 320;
    restored.viewport.innerHeight = 480;
    dispatch(restored.viewport, 'resize');
    const rect = restored.button.getBoundingClientRect();
    assert.ok(rect.left >= 8 && rect.right <= 312);
    assert.ok(rect.top >= 8 && rect.bottom <= 472);
    assert.deepEqual(restored.state.position, saved);
    assert.equal(restored.state.saves, 0);
    restored.cleanup();
});

test('mouse, touch, and pen drags are clamped to every screen edge', () => {
    for (const pointerType of ['mouse', 'touch', 'pen']) {
        const s = setup();
        s.down({ pointerType });
        s.move(-500, -500, { pointerType });
        assert.equal(s.button.style.left, '8px');
        assert.equal(s.button.style.top, '8px');
        s.move(2000, 2000, { pointerType });
        assert.equal(s.button.style.left, '948px');
        assert.equal(s.button.style.top, '748px');
        s.up(2000, 2000);
        assert.deepEqual(s.state.position, { x: 1, y: 1 });
        s.cleanup();
    }
});

test('secondary pointers and right mouse clicks cannot initiate or hijack a drag', () => {
    const s = setup();
    s.down({ button: 2 });
    s.move(200, 200);
    assert.equal(s.button.style.left, '948px');
    s.down({ isPrimary: false });
    s.move(200, 200);
    assert.equal(s.button.style.left, '948px');
    s.down();
    s.move(200, 200, { pointerId: 2 });
    assert.equal(s.button.style.left, '948px');
    s.cleanup();
});

test('cancellation, capture loss, blur, and resize revert unfinished drags without saving', () => {
    for (const type of ['pointercancel', 'lostpointercapture', 'blur', 'resize']) {
        const s = setup();
        s.down();
        s.move(200, 200);
        dispatch(type === 'blur' || type === 'resize' ? s.viewport : s.button, type);
        assert.equal(s.button.style.left, '948px');
        assert.equal(s.button.style.top, '660px');
        assert.equal(s.state.saves, 0);
        assert.equal(s.button.captured, null);
        s.cleanup();
    }
});

test('keyboard activation remains available after a drag and cleanup removes listeners', () => {
    const s = setup();
    s.down();
    s.move(200, 200);
    s.up(200, 200);
    dispatch(s.button, 'click', { detail: 0 });
    assert.equal(s.state.clicks, 1);
    s.cleanup();
    dispatch(s.button, 'click');
    dispatch(s.viewport, 'resize');
    assert.equal(s.state.clicks, 1);
    assert.equal(s.state.saves, 1);
});

test('invalid settings and extremely small viewports never produce negative coordinates', () => {
    for (const value of [null, { x: NaN, y: 0 }, { x: '0.5', y: 0.5 }, { x: -5, y: 20 }]) {
        const s = setup(value);
        s.viewport.innerWidth = 50;
        s.viewport.innerHeight = 50;
        dispatch(s.viewport, 'resize');
        assert.equal(s.button.style.left, '0px');
        assert.equal(s.button.style.top, '0px');
        s.cleanup();
    }
});

test('the panel follows the button, flips below near the top, and fits narrow screens', () => {
    const s = setup();
    const panel = {
        style: {},
        get offsetWidth() { return Math.min(280, parseFloat(this.style.maxWidth)); },
        get offsetHeight() { return Math.min(350, parseFloat(this.style.maxHeight)); },
    };
    positionFloatingPanel(panel, s.button, s.viewport);
    assert.equal(panel.style.left, '712px');
    assert.equal(panel.style.top, '300px');
    s.button.style.left = '8px';
    s.button.style.top = '8px';
    positionFloatingPanel(panel, s.button, s.viewport);
    assert.equal(panel.style.left, '8px');
    assert.equal(panel.style.top, '62px');
    s.viewport.innerWidth = 240;
    s.viewport.innerHeight = 300;
    positionFloatingPanel(panel, s.button, s.viewport);
    assert.equal(panel.offsetWidth, 224);
    assert.equal(panel.offsetHeight, 284);
    assert.equal(panel.style.left, '8px');
    assert.equal(panel.style.top, '8px');
    s.cleanup();
});
