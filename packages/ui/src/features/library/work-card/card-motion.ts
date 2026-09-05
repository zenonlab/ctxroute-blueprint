export interface CardPoint {
  x: number;
  y: number;
}

interface CardRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function pointInRect(clientX: number, clientY: number, rect: CardRect): CardPoint {
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height)),
  };
}

export function tiltAt(point: CardPoint) {
  return {
    glareX: point.x * 100,
    glareY: point.y * 100,
    shadowX: (0.5 - point.x) * 20,
    x: (0.5 - point.y) * 14,
    y: (point.x - 0.5) * 17,
  };
}
