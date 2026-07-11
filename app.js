const canvas = document.getElementById("plotCanvas");
const ctx = canvas.getContext("2d");

const inputs = {
  distance: document.getElementById("distance"),
  latticeA: document.getElementById("latticeA"),
  latticeB: document.getElementById("latticeB"),
  latticeC: document.getElementById("latticeC"),
  latticeAlpha: document.getElementById("latticeAlpha"),
  latticeBeta: document.getElementById("latticeBeta"),
  latticeGamma: document.getElementById("latticeGamma"),
  dirU: document.getElementById("dirU"),
  dirV: document.getElementById("dirV"),
  dirW: document.getElementById("dirW"),
  rotA: document.getElementById("rotA"),
  rotB: document.getElementById("rotB"),
  rotC: document.getElementById("rotC"),
  lambdaMin: document.getElementById("lambdaMin"),
  lambdaMax: document.getElementById("lambdaMax"),
  hklLimit: document.getElementById("hklLimit"),
};

const form = document.getElementById("simForm");
const autoScaleButton = document.getElementById("autoScale");
const toggleControlsButton = document.getElementById("toggleControls");
const parameterPanel = document.getElementById("parameterPanel");
const zoomOutButton = document.getElementById("zoomOut");
const zoomInButton = document.getElementById("zoomIn");
const spotCount = document.getElementById("spotCount");
const zoomLevel = document.getElementById("zoomLevel");
const cursorPosition = document.getElementById("cursorPosition");
const mobileControlsQuery = window.matchMedia("(max-width: 860px)");

let spots = [];
const defaultScale = 3.2;
let view = {
  scale: defaultScale,
  offsetX: 0,
  offsetY: 0,
};
let pointer = {
  dragging: false,
  lastX: 0,
  lastY: 0,
};
const activePointers = new Map();
let pinch = {
  active: false,
  distance: 0,
  centerX: 0,
  centerY: 0,
};

function vectorLength(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
  const length = vectorLength(v);
  if (!Number.isFinite(length) || length === 0) {
    return null;
  }
  return {
    x: v.x / length,
    y: v.y / length,
    z: v.z / length,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function multiply(v, scalar) {
  return {
    x: v.x * scalar,
    y: v.y * scalar,
    z: v.z * scalar,
  };
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function combine(v1, s1, v2, s2, v3, s3) {
  return add(add(multiply(v1, s1), multiply(v2, s2)), multiply(v3, s3));
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function rotateAroundAxis(v, axis, angle) {
  const unitAxis = normalize(axis);
  if (!unitAxis) {
    return null;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(
    add(multiply(v, cos), multiply(cross(unitAxis, v), sin)),
    multiply(unitAxis, dot(unitAxis, v) * (1 - cos)),
  );
}

function rotateVector(v, rotations, axes) {
  const aroundA = rotateAroundAxis(v, axes.a, degreesToRadians(rotations.a));
  const aroundB = aroundA ? rotateAroundAxis(aroundA, axes.b, degreesToRadians(rotations.b)) : null;
  return aroundB ? rotateAroundAxis(aroundB, axes.c, degreesToRadians(rotations.c)) : null;
}

function getDetectorBasis(beam) {
  const reference = Math.abs(beam.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const e1 = normalize(cross(reference, beam));
  const e2 = normalize(cross(beam, e1));
  return { e1, e2 };
}

function readNumber(input) {
  return Number.parseFloat(input.value);
}

function areCellAnglesValid(lattice) {
  return Number.isFinite(lattice.alpha) &&
    Number.isFinite(lattice.beta) &&
    Number.isFinite(lattice.gamma) &&
    lattice.alpha > 0 &&
    lattice.alpha < 180 &&
    lattice.beta > 0 &&
    lattice.beta < 180 &&
    lattice.gamma > 0 &&
    lattice.gamma < 180;
}

function buildLatticeGeometry(lattice) {
  if (!areCellAnglesValid(lattice)) {
    return null;
  }

  const alpha = degreesToRadians(lattice.alpha);
  const beta = degreesToRadians(lattice.beta);
  const gamma = degreesToRadians(lattice.gamma);
  const cosAlpha = Math.cos(alpha);
  const cosBeta = Math.cos(beta);
  const cosGamma = Math.cos(gamma);
  const sinGamma = Math.sin(gamma);

  if (Math.abs(sinGamma) < 1e-8) {
    return null;
  }

  const directA = { x: lattice.a, y: 0, z: 0 };
  const directB = { x: lattice.b * cosGamma, y: lattice.b * sinGamma, z: 0 };
  const directCX = lattice.c * cosBeta;
  const directCY = lattice.c * (cosAlpha - cosBeta * cosGamma) / sinGamma;
  const directCZSquared = lattice.c ** 2 - directCX ** 2 - directCY ** 2;

  if (directCZSquared < -1e-8) {
    return null;
  }

  const directC = {
    x: directCX,
    y: directCY,
    z: Math.sqrt(Math.max(0, directCZSquared)),
  };
  const volume = dot(directA, cross(directB, directC));

  if (!Number.isFinite(volume) || Math.abs(volume) < 1e-8) {
    return null;
  }

  return {
    direct: {
      a: directA,
      b: directB,
      c: directC,
    },
    reciprocal: {
      a: multiply(cross(directB, directC), 1 / volume),
      b: multiply(cross(directC, directA), 1 / volume),
      c: multiply(cross(directA, directB), 1 / volume),
    },
  };
}

function getParameters() {
  const lattice = {
    a: readNumber(inputs.latticeA),
    b: readNumber(inputs.latticeB),
    c: readNumber(inputs.latticeC),
    alpha: readNumber(inputs.latticeAlpha),
    beta: readNumber(inputs.latticeBeta),
    gamma: readNumber(inputs.latticeGamma),
  };
  const rotations = {
    a: readNumber(inputs.rotA),
    b: readNumber(inputs.rotB),
    c: readNumber(inputs.rotC),
  };
  const lambdaMin = readNumber(inputs.lambdaMin);
  const lambdaMax = readNumber(inputs.lambdaMax);
  const geometry = buildLatticeGeometry(lattice);
  const baseIncident = geometry ? combine(
    geometry.direct.a,
    readNumber(inputs.dirU),
    geometry.direct.b,
    readNumber(inputs.dirV),
    geometry.direct.c,
    readNumber(inputs.dirW),
  ) : null;
  const normalizedBaseIncident = baseIncident ? normalize(baseIncident) : null;
  const baseDetectorBasis = normalizedBaseIncident ? getDetectorBasis(normalizedBaseIncident) : null;
  return {
    distance: readNumber(inputs.distance),
    lattice,
    geometry,
    rotations,
    incident: normalizedBaseIncident ? normalize(rotateVector(normalizedBaseIncident, rotations, geometry.direct)) : null,
    detectorBasis: baseDetectorBasis ? {
      e1: normalize(rotateVector(baseDetectorBasis.e1, rotations, geometry.direct)),
      e2: normalize(rotateVector(baseDetectorBasis.e2, rotations, geometry.direct)),
    } : null,
    lambdaMin: Math.min(lambdaMin, lambdaMax),
    lambdaMax: Math.max(lambdaMin, lambdaMax),
    hklLimit: Math.min(30, Math.max(1, Math.round(readNumber(inputs.hklLimit)))),
  };
}

function validateParameters(params) {
  return Number.isFinite(params.distance) &&
    params.distance > 0 &&
    Number.isFinite(params.lattice.a) &&
    Number.isFinite(params.lattice.b) &&
    Number.isFinite(params.lattice.c) &&
    Number.isFinite(params.lattice.alpha) &&
    Number.isFinite(params.lattice.beta) &&
    Number.isFinite(params.lattice.gamma) &&
    params.lattice.a > 0 &&
    params.lattice.b > 0 &&
    params.lattice.c > 0 &&
    areCellAnglesValid(params.lattice) &&
    params.geometry &&
    params.geometry.reciprocal &&
    Number.isFinite(params.rotations.a) &&
    Number.isFinite(params.rotations.b) &&
    Number.isFinite(params.rotations.c) &&
    params.incident &&
    params.detectorBasis &&
    params.detectorBasis.e1 &&
    params.detectorBasis.e2 &&
    Number.isFinite(params.lambdaMin) &&
    Number.isFinite(params.lambdaMax) &&
    params.lambdaMin > 0 &&
    params.lambdaMax > 0 &&
    Number.isFinite(params.hklLimit) &&
    params.hklLimit > 0;
}

function simulate() {
  const params = getParameters();
  if (!validateParameters(params)) {
    spots = [];
    spotCount.textContent = "0";
    draw();
    return;
  }

  const { distance, geometry, incident, detectorBasis, lambdaMin, lambdaMax, hklLimit } = params;
  const { e1, e2 } = detectorBasis;
  const reciprocalBasis = geometry.reciprocal;
  const nextSpots = [];

  for (let h = -hklLimit; h <= hklLimit; h += 1) {
    for (let k = -hklLimit; k <= hklLimit; k += 1) {
      for (let l = -hklLimit; l <= hklLimit; l += 1) {
        if (h === 0 && k === 0 && l === 0) {
          continue;
        }

        const reciprocal = combine(reciprocalBasis.a, h, reciprocalBasis.b, k, reciprocalBasis.c, l);
        const q2 = dot(reciprocal, reciprocal);
        const projection = dot(incident, reciprocal);
        const lambda = -2 * projection / q2;

        if (lambda < lambdaMin || lambda > lambdaMax) {
          continue;
        }

        const diffracted = add(incident, multiply(reciprocal, lambda));
        const diffractedLength = vectorLength(diffracted);
        if (Math.abs(diffractedLength - 1) > 0.001) {
          continue;
        }

        const backward = dot(diffracted, incident);
        if (backward >= -0.02) {
          continue;
        }

        const t = -distance / backward;
        const hit = multiply(diffracted, t);
        const x = dot(hit, e1);
        const y = dot(hit, e2);
        const hklMagnitude = Math.hypot(h, k, l);
        const radius = Math.max(2.1, 5.8 - hklMagnitude * 0.3);
        const strength = Math.max(0.2, 1 - (lambda - lambdaMin) / (lambdaMax - lambdaMin || 1) * 0.55);

        if (Number.isFinite(x) && Number.isFinite(y)) {
          nextSpots.push({ x, y, h, k, l, lambda, radius, strength });
        }
      }
    }
  }

  nextSpots.sort((a, b) => b.radius - a.radius);
  spots = nextSpots;
  spotCount.textContent = String(spots.length);
  autoScaleView();
  draw();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function canvasCenter() {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width / 2,
    y: rect.height / 2,
  };
}

function worldToScreen(x, y) {
  const center = canvasCenter();
  return {
    x: center.x + view.offsetX + x * view.scale,
    y: center.y + view.offsetY - y * view.scale,
  };
}

function screenToWorld(x, y) {
  const rect = canvas.getBoundingClientRect();
  const center = canvasCenter();
  return {
    x: (x - rect.left - center.x - view.offsetX) / view.scale,
    y: -(y - rect.top - center.y - view.offsetY) / view.scale,
  };
}

function resetView() {
  view.scale = defaultScale;
  view.offsetX = 0;
  view.offsetY = 0;
  zoomLevel.textContent = "100%";
}

function clampScale(scale) {
  return Math.max(0.05, Math.min(80, scale));
}

function zoomAtClientPoint(clientX, clientY, factor) {
  const before = screenToWorld(clientX, clientY);
  view.scale = clampScale(view.scale * factor);
  const after = screenToWorld(clientX, clientY);
  view.offsetX += (after.x - before.x) * view.scale;
  view.offsetY -= (after.y - before.y) * view.scale;
}

function autoScaleView() {
  const rect = canvas.getBoundingClientRect();
  if (!spots.length || rect.width <= 0 || rect.height <= 0) {
    resetView();
    return;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const spot of spots) {
    minX = Math.min(minX, spot.x);
    maxX = Math.max(maxX, spot.x);
    minY = Math.min(minY, spot.y);
    maxY = Math.max(maxY, spot.y);
  }

  const padding = Math.min(56, Math.max(24, Math.min(rect.width, rect.height) * 0.12));
  const usableWidth = Math.max(1, rect.width - padding * 2);
  const usableHeight = Math.max(1, rect.height - padding * 2);
  const dataWidth = Math.max(1, maxX - minX);
  const dataHeight = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  view.scale = clampScale(Math.min(usableWidth / dataWidth, usableHeight / dataHeight));
  view.offsetX = -centerX * view.scale;
  view.offsetY = centerY * view.scale;
  zoomLevel.textContent = `${Math.round(view.scale / defaultScale * 100)}%`;
}

function getPinchState() {
  const points = [...activePointers.values()];
  if (points.length < 2) {
    return null;
  }
  const first = points[0];
  const second = points[1];
  return {
    centerX: (first.clientX + second.clientX) / 2,
    centerY: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
  };
}

function stopPointerInteraction() {
  pointer.dragging = false;
  pinch.active = false;
  canvas.classList.remove("is-panning");
}

function setControlsCollapsed(collapsed) {
  const shouldCollapse = collapsed && mobileControlsQuery.matches;
  parameterPanel.hidden = shouldCollapse;
  document.body.classList.toggle("controls-collapsed", shouldCollapse);
  toggleControlsButton.setAttribute("aria-expanded", String(!shouldCollapse));
  toggleControlsButton.textContent = shouldCollapse ? "パラメーターを表示" : "パラメーターを隠す";
  requestAnimationFrame(resizeCanvas);
}

function drawGrid(rect) {
  const worldTopLeft = screenToWorld(rect.left, rect.top);
  const worldBottomRight = screenToWorld(rect.left + rect.width, rect.top + rect.height);
  const minX = Math.min(worldTopLeft.x, worldBottomRight.x);
  const maxX = Math.max(worldTopLeft.x, worldBottomRight.x);
  const minY = Math.min(worldTopLeft.y, worldBottomRight.y);
  const maxY = Math.max(worldTopLeft.y, worldBottomRight.y);
  const targetSpacingPx = 78;
  const rawStep = targetSpacingPx / view.scale;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = rawStep / 10 ** exponent;
  const factor = base < 2 ? 1 : base < 5 ? 2 : 5;
  const step = factor * 10 ** exponent;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e5ebe9";
  ctx.fillStyle = "#71807d";
  ctx.font = "12px Inter, sans-serif";

  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
    const screen = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, rect.height);
    ctx.stroke();
    if (Math.abs(x) > step * 0.25) {
      ctx.fillText(`${Math.round(x)}`, screen.x + 4, rect.height - 10);
    }
  }

  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
    const screen = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, screen.y);
    ctx.lineTo(rect.width, screen.y);
    ctx.stroke();
    if (Math.abs(y) > step * 0.25) {
      ctx.fillText(`${Math.round(y)}`, 8, screen.y - 4);
    }
  }

  const origin = worldToScreen(0, 0);
  ctx.strokeStyle = "#aebbb8";
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, rect.height);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(rect.width, origin.y);
  ctx.stroke();
}

function drawSpots() {
  for (const spot of spots) {
    const screen = worldToScreen(spot.x, spot.y);
    const radius = Math.max(1.8, spot.radius * Math.sqrt(view.scale / defaultScale));
    const alpha = Math.min(0.95, spot.strength);

    ctx.beginPath();
    ctx.fillStyle = `rgba(214, 139, 23, ${alpha * 0.24})`;
    ctx.arc(screen.x, screen.y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = `rgba(180, 82, 18, ${alpha})`;
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLabels() {
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = "#16211f";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText("x / mm", rect.width - 52, rect.height - 12);
  ctx.save();
  ctx.translate(15, 52);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("y / mm", 0, 0);
  ctx.restore();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#fbfcfc";
  ctx.fillRect(0, 0, rect.width, rect.height);
  drawGrid(rect);
  drawSpots();
  drawLabels();
  zoomLevel.textContent = `${Math.round(view.scale / defaultScale * 100)}%`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  simulate();
});

for (const input of Object.values(inputs)) {
  input.addEventListener("change", simulate);
}

autoScaleButton.addEventListener("click", () => {
  resetView();
  draw();
});

toggleControlsButton.addEventListener("click", () => {
  setControlsCollapsed(!parameterPanel.hidden);
});

canvas.addEventListener("pointerdown", (event) => {
  activePointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
  });
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  pointer.dragging = activePointers.size === 1;
  canvas.classList.add("is-panning");
  canvas.setPointerCapture(event.pointerId);

  const pinchState = getPinchState();
  if (pinchState) {
    pinch = {
      active: true,
      distance: pinchState.distance,
      centerX: pinchState.centerX,
      centerY: pinchState.centerY,
    };
    pointer.dragging = false;
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  const world = screenToWorld(event.clientX, event.clientY);
  cursorPosition.textContent = `${world.x.toFixed(1)}, ${world.y.toFixed(1)} mm`;

  const pinchState = getPinchState();
  if (pinchState) {
    if (pinch.active && pinch.distance > 0 && pinchState.distance > 0) {
      zoomAtClientPoint(pinchState.centerX, pinchState.centerY, pinchState.distance / pinch.distance);
      view.offsetX += pinchState.centerX - pinch.centerX;
      view.offsetY += pinchState.centerY - pinch.centerY;
      draw();
    }
    pinch = {
      active: true,
      distance: pinchState.distance,
      centerX: pinchState.centerX,
      centerY: pinchState.centerY,
    };
    return;
  }

  if (!pointer.dragging) {
    return;
  }

  view.offsetX += event.clientX - pointer.lastX;
  view.offsetY += event.clientY - pointer.lastY;
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  activePointers.delete(event.pointerId);
  if (activePointers.size === 0) {
    stopPointerInteraction();
  } else if (activePointers.size === 1) {
    const remaining = [...activePointers.values()][0];
    pointer.dragging = true;
    pointer.lastX = remaining.clientX;
    pointer.lastY = remaining.clientY;
    pinch.active = false;
  }
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", (event) => {
  activePointers.delete(event.pointerId);
  if (activePointers.size === 0) {
    stopPointerInteraction();
  }
});

canvas.addEventListener("pointerleave", () => {
  if (!pointer.dragging) {
    cursorPosition.textContent = "--";
  }
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 0.89;
  zoomAtClientPoint(event.clientX, event.clientY, factor);
  draw();
}, { passive: false });

zoomOutButton.addEventListener("click", () => {
  const center = canvasCenter();
  const rect = canvas.getBoundingClientRect();
  zoomAtClientPoint(rect.left + center.x, rect.top + center.y, 0.82);
  draw();
});

zoomInButton.addEventListener("click", () => {
  const center = canvasCenter();
  const rect = canvas.getBoundingClientRect();
  zoomAtClientPoint(rect.left + center.x, rect.top + center.y, 1.22);
  draw();
});

window.addEventListener("resize", resizeCanvas);
mobileControlsQuery.addEventListener("change", () => {
  if (!mobileControlsQuery.matches) {
    setControlsCollapsed(false);
  }
});

resizeCanvas();
simulate();
