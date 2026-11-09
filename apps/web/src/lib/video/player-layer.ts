/**
 * Where the player's dialogs, menus and tooltips mount (docs/specs/VIDEO-PLAYER.md section 5,
 * Layers). They are portalled out of the player: the frame clips (`overflow: hidden`) and opens its
 * own stacking context (`isolation`, backdrop filters), so anything drawn inside it can be covered
 * by the page around it, and a `position: fixed` child is confined to it. Outside the player they
 * stack on `--fanous-player-layer`, above the site header.
 *
 * In fullscreen only the fullscreen element and its descendants are drawn, so there the layer
 * mounts inside the fullscreen element instead of the body.
 */

/** Marks a layer root, so focus and clicks inside it count as the player's own */
export const PLAYER_LAYER_ATTR = 'data-player-layer';

type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null };

export function currentFullscreenElement(doc: Document = document): Element | null {
  return doc.fullscreenElement ?? (doc as FullscreenDocument).webkitFullscreenElement ?? null;
}

/** The element a player's overlays mount into: its fullscreen element while it is fullscreen, the body otherwise */
export function layerHostFor(playerEl: Element | null | undefined, doc: Document = document): HTMLElement {
  const fullscreen = currentFullscreenElement(doc);
  if (fullscreen instanceof HTMLElement && playerEl && (fullscreen === playerEl || fullscreen.contains(playerEl))) return fullscreen;
  return doc.body;
}

/** Whether a node sits inside one of the player's layers (a portalled menu, dialog or tooltip) */
export function isInPlayerLayer(node: EventTarget | Node | null | undefined): boolean {
  return node instanceof Element && !!node.closest(`[${PLAYER_LAYER_ATTR}]`);
}

export const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;
