// Bounds are physical workspace pixels; scale keeps the scene's logical UI size.
function windowScale(app, area) {
  const sideSpace = area.width <= 520 ? 24 : area.width <= 760 ? 108 : area.width <= 900 ? 150 : 44;
  const width = Math.min(area.width, Math.max(1, area.width - sideSpace));
  const height = Math.min(area.height, Math.max(1, area.height - 24));
  return Math.min(0.75, width / app.width, height / app.height);
}

export function clampPosition(bounds, area) {
  return {
    ...bounds,
    x: Math.max(0, Math.min(bounds.x, area.width - bounds.width)),
    y: Math.max(0, Math.min(bounds.y, area.height - bounds.height)),
  };
}

export function fitNormalBounds(bounds, app, area) {
  const scale = windowScale(app, area);
  return clampPosition({ ...bounds, width: app.width * scale, height: app.height * scale, scale }, area);
}

export function initialBounds(app, area, offset = 0, viewportHeight = area.height + 22) {
  const x = area.width > 1100 ? area.width * 0.15 : area.width > 900 ? area.width * 0.1 : area.width > 760 ? 22 : 12;
  const y = area.width <= 520 ? 290 : area.width <= 760 ? 95 : viewportHeight <= 720 ? 42 : viewportHeight * 0.16 - 22;
  return fitNormalBounds({ x: x + offset, y: y + offset }, app, area);
}

export function zoomBounds(normalBounds, area) {
  return { x: 0, y: 0, width: area.width, height: area.height, scale: normalBounds.scale };
}
