// Bounds are physical workspace pixels; scale keeps the scene's logical UI size.
export function clampPosition(bounds, area) {
  return {
    ...bounds,
    x: Math.max(0, Math.min(bounds.x, area.width - bounds.width)),
    y: Math.max(0, Math.min(bounds.y, area.height - bounds.height)),
  };
}

export function fitNormalBounds(bounds, app, area, scale) {
  return clampPosition({ ...bounds, width: app.width * scale, height: app.height * scale, scale }, area);
}

export function zoomBounds(normalBounds, area) {
  return { x: 0, y: 0, width: area.width, height: area.height, scale: normalBounds.scale };
}
