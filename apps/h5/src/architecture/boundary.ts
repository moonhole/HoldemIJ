// DOM ownership boundaries between React (business UI) and Pixi (table renderer).
// React must mount into REACT_UI_ROOT_ID. Pixi must mount into PIXI_CANVAS_ID.

export const APP_ROOT_ID = 'app';
export const PIXI_CANVAS_ID = 'game-canvas';
export const REACT_UI_ROOT_ID = 'ui-layer';

export function requireCanvas(canvasId: string = PIXI_CANVAS_ID): HTMLCanvasElement {
    const canvas = document.getElementById(canvasId);
    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error(`Pixi canvas not found: #${canvasId}`);
    }
    return canvas;
}

export function requireUiRoot(uiRootId: string = REACT_UI_ROOT_ID): HTMLElement {
    const uiRoot = document.getElementById(uiRootId);
    if (!(uiRoot instanceof HTMLElement)) {
        throw new Error(`React UI root not found: #${uiRootId}`);
    }
    return uiRoot;
}
