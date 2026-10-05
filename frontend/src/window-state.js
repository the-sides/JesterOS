// Bounds are physical workspace pixels; scale keeps the scene's logical UI size.
export const WINDOW_RESIZE_AXES = Object.freeze({ n: 'y', s: 'y', e: 'x', w: 'x', ne: 'xy', nw: 'xy', se: 'xy', sw: 'xy' });

export function clampPosition(bounds, area) {
  return {
    ...bounds,
    x: Math.max(0, Math.min(bounds.x, area.width - bounds.width)),
    y: Math.max(0, Math.min(bounds.y, area.height - bounds.height)),
  };
}

export function fitNormalBounds(bounds, app, area, scale) {
  const width = bounds.scale ? bounds.width / bounds.scale : app.width;
  const height = bounds.scale ? bounds.height / bounds.scale : app.height;
  const fittedScale = Math.min(scale, area.width / width, area.height / height);
  return clampPosition({ ...bounds, width: width * fittedScale, height: height * fittedScale, scale: fittedScale }, area);
}

export function expandedBounds(normalBounds, area) {
  return { x: 0, y: 0, width: area.width, height: area.height, scale: normalBounds.scale };
}

// The opposite edges stay anchored; minimums are logical, coordinates physical.
export function resizeBounds(bounds, edge, coordinates, minimumSize, area) {
  let left = bounds.x, top = bounds.y;
  let right = left + bounds.width, bottom = top + bounds.height;
  const minimumWidth = minimumSize.width * bounds.scale;
  const minimumHeight = minimumSize.height * bounds.scale;
  if (edge.includes('w')) left = Math.max(0, Math.min(coordinates.x, right - minimumWidth));
  else if (edge.includes('e')) right = Math.min(area.width, Math.max(coordinates.x, left + minimumWidth));
  if (edge.includes('n')) top = Math.max(0, Math.min(coordinates.y, bottom - minimumHeight));
  else if (edge.includes('s')) bottom = Math.min(area.height, Math.max(coordinates.y, top + minimumHeight));
  return { x: left, y: top, width: right - left, height: bottom - top, scale: bounds.scale };
}
