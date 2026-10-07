const VIEWPORT_MARGIN = 8;
const DRAG_THRESHOLD = 6;
const PANEL_GAP = 10;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function buttonBounds(button, viewport) {
    const maxLeft = Math.max(0, viewport.innerWidth - button.offsetWidth - VIEWPORT_MARGIN);
    const maxTop = Math.max(0, viewport.innerHeight - button.offsetHeight - VIEWPORT_MARGIN);
    return {
        minLeft: Math.min(VIEWPORT_MARGIN, maxLeft),
        minTop: Math.min(VIEWPORT_MARGIN, maxTop),
        maxLeft,
        maxTop,
    };
}

/**
 * Attach mouse/touch/pen dragging, restoring a position relative to the viewport.
 * Returns a cleanup function for when the button is replaced.
 */
export function makeFloatingButtonDraggable(button, {
    getPosition,
    savePosition,
    onClick,
    onPositioned = () => {},
}, viewport = window) {
    let drag = null;
    let suppressClick = false;

    const applyPosition = (left, top) => {
        const bounds = buttonBounds(button, viewport);
        button.style.left = `${clamp(left, bounds.minLeft, bounds.maxLeft)}px`;
        button.style.top = `${clamp(top, bounds.minTop, bounds.maxTop)}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        onPositioned();
    };

    const restorePosition = () => {
        const bounds = buttonBounds(button, viewport);
        const position = getPosition();
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
            applyPosition(
                bounds.minLeft + clamp(position.x, 0, 1) * (bounds.maxLeft - bounds.minLeft),
                bounds.minTop + clamp(position.y, 0, 1) * (bounds.maxTop - bounds.minTop),
            );
        } else {
            // Keep the original bottom-right placement until the user moves it.
            applyPosition(bounds.maxLeft, viewport.innerHeight - 140);
        }
    };

    const pointerDown = (event) => {
        if (drag || !event.isPrimary || event.button !== 0) return;
        suppressClick = false;
        drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: parseFloat(button.style.left),
            top: parseFloat(button.style.top),
            moved: false,
        };
        button.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        suppressClick = true;
        button.classList.add('is-dragging');
        event.preventDefault();
        applyPosition(drag.left + dx, drag.top + dy);
    };

    const finishDrag = (cancelled) => {
        if (!drag) return;
        const finished = drag;
        drag = null;
        button.classList.remove('is-dragging');
        if (button.hasPointerCapture(finished.pointerId)) {
            button.releasePointerCapture(finished.pointerId);
        }
        if (cancelled) {
            applyPosition(finished.left, finished.top);
        } else if (finished.moved) {
            const bounds = buttonBounds(button, viewport);
            // Ratios preserve the chosen area across resizing and screen rotation.
            savePosition({
                x: (parseFloat(button.style.left) - bounds.minLeft) / (bounds.maxLeft - bounds.minLeft || 1),
                y: (parseFloat(button.style.top) - bounds.minTop) / (bounds.maxTop - bounds.minTop || 1),
            });
        }
    };

    const pointerUp = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        pointerMove(event);
        finishDrag(false);
    };
    const pointerCancel = (event) => {
        if (drag && event.pointerId === drag.pointerId) finishDrag(true);
    };
    const cancelDrag = () => finishDrag(true);
    const resize = () => {
        cancelDrag();
        restorePosition();
    };
    const click = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Native keyboard activation has detail=0 and should still work after a drag.
        if (suppressClick && event.detail !== 0) {
            suppressClick = false;
            return;
        }
        onClick();
    };

    const listeners = {
        pointerdown: pointerDown,
        pointermove: pointerMove,
        pointerup: pointerUp,
        pointercancel: pointerCancel,
        lostpointercapture: pointerCancel,
        click,
    };
    for (const [type, listener] of Object.entries(listeners)) {
        button.addEventListener(type, listener);
    }
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('blur', cancelDrag);
    restorePosition();

    return () => {
        cancelDrag();
        for (const [type, listener] of Object.entries(listeners)) {
            button.removeEventListener(type, listener);
        }
        viewport.removeEventListener('resize', resize);
        viewport.removeEventListener('blur', cancelDrag);
    };
}

/** Keep the quick-send panel beside the button and fully inside the viewport. */
export function positionFloatingPanel(panel, button, viewport = window) {
    panel.style.maxWidth = `${Math.max(0, viewport.innerWidth - 2 * VIEWPORT_MARGIN)}px`;
    panel.style.maxHeight = `${Math.min(350, Math.max(0, viewport.innerHeight - 2 * VIEWPORT_MARGIN))}px`;
    const anchor = button.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const maxLeft = Math.max(0, viewport.innerWidth - width - VIEWPORT_MARGIN);
    const maxTop = Math.max(0, viewport.innerHeight - height - VIEWPORT_MARGIN);
    const minLeft = Math.min(VIEWPORT_MARGIN, maxLeft);
    const minTop = Math.min(VIEWPORT_MARGIN, maxTop);
    const above = anchor.top - height - PANEL_GAP;
    const below = anchor.bottom + PANEL_GAP;
    const top = above >= minTop ? above : below <= maxTop ? below : above;
    panel.style.left = `${clamp(anchor.right - width, minLeft, maxLeft)}px`;
    panel.style.top = `${clamp(top, minTop, maxTop)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}
