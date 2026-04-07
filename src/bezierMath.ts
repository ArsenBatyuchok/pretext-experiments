export type Point = { x: number; y: number };

export type AnchorPoint = {
  pos: Point;
  handleIn: Point;
  handleOut: Point;
};

export type BezierShape = {
  id: string;
  anchors: AnchorPoint[];
  closed: boolean;
};

const EPS = 1e-10;

function cbrt(x: number): number {
  return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3);
}

function solveCubic(
  a: number,
  b: number,
  c: number,
  d: number,
): number[] {
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) {
      if (Math.abs(c) < EPS) {
        return [];
      }
      return [-d / c];
    }
    const disc = c * c - 4 * b * d;
    if (disc < 0) {
      return [];
    }
    const sq = Math.sqrt(Math.max(0, disc));
    return [(-c + sq) / (2 * b), (-c - sq) / (2 * b)];
  }

  const A = b / a;
  const B = c / a;
  const C = d / a;

  const p = B - (A * A) / 3;
  const q = C - (A * B) / 3 + (2 * A * A * A) / 27;
  const shift = -A / 3;
  const D = (q * q) / 4 + (p * p * p) / 27;

  if (D > EPS) {
    const sqD = Math.sqrt(D);
    return [cbrt(-q / 2 + sqD) + cbrt(-q / 2 - sqD) + shift];
  }

  if (D < -EPS) {
    const r = Math.sqrt((-p * p * p) / 27);
    const cosArg = Math.max(-1, Math.min(1, -q / (2 * r)));
    const phi = Math.acos(cosArg);
    const m = 2 * cbrt(r);
    return [
      m * Math.cos(phi / 3) + shift,
      m * Math.cos((phi + 2 * Math.PI) / 3) + shift,
      m * Math.cos((phi + 4 * Math.PI) / 3) + shift,
    ];
  }

  if (Math.abs(q) < EPS) {
    return [shift];
  }
  const u = cbrt(-q / 2);
  return [2 * u + shift, -u + shift];
}

function cubicBezierXHits(
  y0: number,
  y1: number,
  y2: number,
  y3: number,
  x0: number,
  x1: number,
  x2: number,
  x3: number,
  Y: number,
): number[] {
  const a = -y0 + 3 * y1 - 3 * y2 + y3;
  const b = 3 * y0 - 6 * y1 + 3 * y2;
  const c = -3 * y0 + 3 * y1;
  const d = y0 - Y;

  const roots = solveCubic(a, b, c, d);
  const xs: number[] = [];
  for (let i = 0; i < roots.length; i++) {
    let t = roots[i]!;
    if (t < -EPS || t > 1 + EPS) {
      continue;
    }
    t = Math.max(0, Math.min(1, t));
    const mt = 1 - t;
    xs.push(
      mt * mt * mt * x0 +
        3 * mt * mt * t * x1 +
        3 * mt * t * t * x2 +
        t * t * t * x3,
    );
  }
  return xs;
}

/**
 * Returns sorted x-intersections for all closed bezier shapes at a given y.
 * Pair with even-odd rule to get interior intervals.
 */
export function bezierScanlineXs(
  shapes: BezierShape[],
  y: number,
): number[] {
  const xs: number[] = [];
  for (let si = 0; si < shapes.length; si++) {
    const shape = shapes[si]!;
    if (!shape.closed || shape.anchors.length < 2) {
      continue;
    }
    const n = shape.anchors.length;
    for (let i = 0; i < n; i++) {
      const a0 = shape.anchors[i]!;
      const a1 = shape.anchors[(i + 1) % n]!;
      const hits = cubicBezierXHits(
        a0.pos.y,
        a0.handleOut.y,
        a1.handleIn.y,
        a1.pos.y,
        a0.pos.x,
        a0.handleOut.x,
        a1.handleIn.x,
        a1.pos.x,
        y,
      );
      for (let j = 0; j < hits.length; j++) {
        xs.push(hits[j]!);
      }
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

export function isPointInBezierShape(
  shape: BezierShape,
  x: number,
  y: number,
): boolean {
  const xs = bezierScanlineXs([shape], y);
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (x >= xs[i]! && x <= xs[i + 1]!) {
      return true;
    }
  }
  return false;
}

export function bezierShapeToSvgPath(shape: BezierShape): string {
  const { anchors, closed } = shape;
  if (anchors.length === 0) {
    return '';
  }
  const first = anchors[0]!;
  let d = `M${first.pos.x},${first.pos.y}`;
  const segCount = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a0 = anchors[i]!;
    const a1 = anchors[(i + 1) % anchors.length]!;
    d += ` C${a0.handleOut.x},${a0.handleOut.y} ${a1.handleIn.x},${a1.handleIn.y} ${a1.pos.x},${a1.pos.y}`;
  }
  if (closed) {
    d += ' Z';
  }
  return d;
}
