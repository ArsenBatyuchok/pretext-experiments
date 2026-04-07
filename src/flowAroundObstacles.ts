import {
  layoutNextLine,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';

import { type BezierShape, bezierScanlineXs } from './bezierMath';

export type Interval = { left: number; right: number };

export type Point = { x: number; y: number };

export type CircleObstacle = {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
  pad: number;
};

export type PolygonObstacle = {
  kind: 'polygon';
  /** Closed polygon vertices in stage coordinates. */
  points: Point[];
  pad: number;
};

export type RingObstacle = {
  kind: 'ring';
  cx: number;
  cy: number;
  outerR: number;
  borderWidth: number;
  pad: number;
};

export type SvgPathObstacle = {
  kind: 'svgPath';
  /** Sub-paths in local coords, centered at origin. */
  subPaths: Point[][];
  cx: number;
  cy: number;
  scale: number;
  pad: number;
};

export type BezierPathObstacle = {
  kind: 'bezierPath';
  shapes: BezierShape[];
  pad: number;
};

export type Obstacle =
  | CircleObstacle
  | PolygonObstacle
  | RingObstacle
  | SvgPathObstacle
  | BezierPathObstacle;

export type PositionedLine = {
  x: number;
  y: number;
  width: number;
  slotWidth: number;
  text: string;
};

const MIN_SLOT_WIDTH = 24;
const HYPHEN_MIN_SLACK = 8;
const HYPHEN_MIN_GRAPHEMES = 2;

export function carveTextLineSlots(
  base: Interval,
  blocked: Interval[],
): Interval[] {
  let slots: Interval[] = [base];
  for (let bi = 0; bi < blocked.length; bi++) {
    const iv = blocked[bi]!;
    const next: Interval[] = [];
    for (let si = 0; si < slots.length; si++) {
      const s = slots[si]!;
      if (iv.right <= s.left || iv.left >= s.right) {
        next.push(s);
        continue;
      }
      if (iv.left > s.left) {
        next.push({ left: s.left, right: iv.left });
      }
      if (iv.right < s.right) {
        next.push({ left: iv.right, right: s.right });
      }
    }
    slots = next;
  }
  return slots.filter((s) => s.right - s.left >= MIN_SLOT_WIDTH);
}

function circleIntervalForBand(
  o: CircleObstacle,
  bandTop: number,
  bandBottom: number,
): Interval | null {
  const top = bandTop - o.pad;
  const bottom = bandBottom + o.pad;
  if (top >= o.cy + o.r || bottom <= o.cy - o.r) {
    return null;
  }
  const minDy =
    o.cy >= top && o.cy <= bottom
      ? 0
      : o.cy < top
        ? top - o.cy
        : o.cy - bottom;
  if (minDy >= o.r) {
    return null;
  }
  const maxDx = Math.sqrt(o.r * o.r - minDy * minDy);
  return { left: o.cx - maxDx - o.pad, right: o.cx + maxDx + o.pad };
}

/**
 * Scanline fill at a single y: find all x where edges cross y,
 * sort, pair into interior intervals (even-odd rule).
 */
function scanlineAtY(pts: Point[], y: number): Interval[] {
  const n = pts.length;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (y < minY || y >= maxY) {
      continue;
    }
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-12) {
      continue;
    }
    xs.push(a.x + ((y - a.y) / dy) * (b.x - a.x));
  }
  xs.sort((a, b) => a - b);
  const intervals: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    intervals.push({ left: xs[i]!, right: xs[i + 1]! });
  }
  return intervals;
}

/**
 * Merge overlapping intervals (sorted by left) into a minimal set.
 */
function mergeIntervals(ivs: Interval[]): Interval[] {
  if (ivs.length === 0) {
    return [];
  }
  const sorted = [...ivs].sort((a, b) => a.left - b.left);
  const out: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.left <= last.right) {
      last.right = Math.max(last.right, cur.right);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

const BAND_SAMPLES = 5;

/**
 * Proper scanline fill for a polygon band. Samples multiple y-values
 * within the band, unions all interior intervals, and applies padding.
 * Returns multiple disjoint intervals so concave gaps (e.g. between
 * star tips) are left free for text.
 */
function polygonIntervalsForBand(
  o: PolygonObstacle,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  const pad = o.pad;
  const top = bandTop - pad;
  const bottom = bandBottom + pad;
  const pts = o.points;
  if (pts.length < 3) {
    return [];
  }

  const all: Interval[] = [];
  for (let s = 0; s < BAND_SAMPLES; s++) {
    const y = top + ((bottom - top) * (s + 0.5)) / BAND_SAMPLES;
    const row = scanlineAtY(pts, y);
    for (let i = 0; i < row.length; i++) {
      all.push({ left: row[i]!.left - pad, right: row[i]!.right + pad });
    }
  }

  return mergeIntervals(all);
}

/**
 * A ring blocks the annular region between innerR and outerR.
 * For a horizontal band, that produces up to two blocked intervals:
 * the left arc of the ring and the right arc, leaving the inner
 * circle's chord free in between.
 */
function ringIntervalsForBand(
  o: RingObstacle,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  const innerR = o.outerR - o.borderWidth;
  const outerCircle: CircleObstacle = {
    kind: 'circle',
    cx: o.cx,
    cy: o.cy,
    r: o.outerR,
    pad: o.pad,
  };
  const outerIv = circleIntervalForBand(outerCircle, bandTop, bandBottom);
  if (outerIv === null) {
    return [];
  }

  if (innerR <= 0) {
    return [outerIv];
  }

  const innerCircle: CircleObstacle = {
    kind: 'circle',
    cx: o.cx,
    cy: o.cy,
    r: innerR,
    pad: 0,
  };
  const innerIv = circleIntervalForBand(innerCircle, bandTop, bandBottom);
  if (innerIv === null) {
    return [outerIv];
  }

  const intervals: Interval[] = [];
  if (outerIv.left < innerIv.left) {
    intervals.push({ left: outerIv.left, right: innerIv.left });
  }
  if (innerIv.right < outerIv.right) {
    intervals.push({ left: innerIv.right, right: outerIv.right });
  }
  return intervals;
}

/**
 * Multi-sub-path scanline (even-odd fill): collects all edge
 * intersections across every sub-path, sorts, pairs to get
 * interior intervals, then maps back to stage coordinates.
 */
function svgPathIntervalsForBand(
  o: SvgPathObstacle,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  const pad = o.pad;
  const top = bandTop - pad;
  const bottom = bandBottom + pad;

  const all: Interval[] = [];
  for (let s = 0; s < BAND_SAMPLES; s++) {
    const stageY = top + ((bottom - top) * (s + 0.5)) / BAND_SAMPLES;
    const localY = (stageY - o.cy) / o.scale;

    const xs: number[] = [];
    for (let pi = 0; pi < o.subPaths.length; pi++) {
      const sp = o.subPaths[pi]!;
      const n = sp.length;
      for (let i = 0; i < n; i++) {
        const a = sp[i]!;
        const b = sp[(i + 1) % n]!;
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        if (localY < minY || localY >= maxY) {
          continue;
        }
        const dy = b.y - a.y;
        if (Math.abs(dy) < 1e-12) {
          continue;
        }
        xs.push(a.x + ((localY - a.y) / dy) * (b.x - a.x));
      }
    }

    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      all.push({
        left: o.cx + xs[i]! * o.scale - pad,
        right: o.cx + xs[i + 1]! * o.scale + pad,
      });
    }
  }

  return mergeIntervals(all);
}

function bezierPathIntervalsForBand(
  o: BezierPathObstacle,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  const pad = o.pad;
  const top = bandTop - pad;
  const bottom = bandBottom + pad;
  if (o.shapes.length === 0) {
    return [];
  }

  const all: Interval[] = [];
  for (let s = 0; s < BAND_SAMPLES; s++) {
    const y = top + ((bottom - top) * (s + 0.5)) / BAND_SAMPLES;
    const xs = bezierScanlineXs(o.shapes, y);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      all.push({ left: xs[i]! - pad, right: xs[i + 1]! + pad });
    }
  }

  return mergeIntervals(all);
}

function obstacleIntervalsForBand(
  o: Obstacle,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  if (o.kind === 'circle') {
    const iv = circleIntervalForBand(o, bandTop, bandBottom);
    return iv !== null ? [iv] : [];
  }
  if (o.kind === 'ring') {
    return ringIntervalsForBand(o, bandTop, bandBottom);
  }
  if (o.kind === 'svgPath') {
    return svgPathIntervalsForBand(o, bandTop, bandBottom);
  }
  if (o.kind === 'bezierPath') {
    return bezierPathIntervalsForBand(o, bandTop, bandBottom);
  }
  return polygonIntervalsForBand(o, bandTop, bandBottom);
}

function tryHyphenate(
  prepared: PreparedTextWithSegments,
  lineText: string,
  lineWidth: number,
  cursor: LayoutCursor,
  slotWidth: number,
): { text: string; width: number; cursor: LayoutCursor } | null {
  const slack = slotWidth - lineWidth;
  if (slack < HYPHEN_MIN_SLACK) {
    return null;
  }

  const {
    segments,
    kinds,
    widths,
    breakableWidths,
    discretionaryHyphenWidth,
  } = prepared;
  const segCount = segments.length;

  let nextSeg = cursor.segmentIndex;
  let nextGr = cursor.graphemeIndex;
  while (nextSeg < segCount) {
    if (kinds[nextSeg] === 'text') {
      break;
    }
    nextSeg++;
    nextGr = 0;
  }
  if (nextSeg >= segCount) {
    return null;
  }

  const gWidths = breakableWidths[nextSeg];
  if (gWidths === null || gWidths === undefined) {
    return null;
  }

  const hyphenW = discretionaryHyphenWidth;

  let spaceW = 0;
  for (let si = cursor.segmentIndex; si < nextSeg; si++) {
    const k = kinds[si];
    if (k === 'space' || k === 'glue') {
      spaceW += widths[si]!;
    }
  }

  const budget = slack - hyphenW - spaceW;
  if (budget <= 0) {
    return null;
  }

  let consumed = 0;
  let usedWidth = 0;
  for (let gi = nextGr; gi < gWidths.length; gi++) {
    const gw = gWidths[gi]!;
    if (usedWidth + gw > budget) {
      break;
    }
    usedWidth += gw;
    consumed++;
  }

  if (consumed < HYPHEN_MIN_GRAPHEMES) {
    return null;
  }

  const segText = segments[nextSeg]!;
  const graphemes = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
      segText,
    ),
  ].map((s) => s.segment);
  const fragment = graphemes.slice(nextGr, nextGr + consumed).join('');

  let spacePart = '';
  for (let si = cursor.segmentIndex; si < nextSeg; si++) {
    const k = kinds[si];
    if (k === 'space' || k === 'glue') {
      spacePart += segments[si];
    }
  }

  return {
    text: lineText + spacePart + fragment + '-',
    width: lineWidth + spaceW + usedWidth + hyphenW,
    cursor: {
      segmentIndex: nextSeg,
      graphemeIndex: nextGr + consumed,
    },
  };
}

export function layoutTextAroundObstacles(
  prepared: PreparedTextWithSegments,
  region: { x: number; y: number; w: number; h: number },
  lineHeight: number,
  obstacles: Obstacle[],
  startCursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 },
  hyphenate = true,
): { lines: PositionedLine[]; cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor;
  let lineTop = region.y;
  const lines: PositionedLine[] = [];
  let textExhausted = false;

  while (lineTop + lineHeight <= region.y + region.h && !textExhausted) {
    const bandTop = lineTop;
    const bandBottom = lineTop + lineHeight;
    const blocked: Interval[] = [];

    for (let oi = 0; oi < obstacles.length; oi++) {
      const intervals = obstacleIntervalsForBand(
        obstacles[oi]!,
        bandTop,
        bandBottom,
      );
      for (let ii = 0; ii < intervals.length; ii++) {
        blocked.push(intervals[ii]!);
      }
    }

    const slots = carveTextLineSlots(
      { left: region.x, right: region.x + region.w },
      blocked,
    );
    if (slots.length === 0) {
      lineTop += lineHeight;
      continue;
    }

    const orderedSlots = [...slots].sort((a, b) => a.left - b.left);

    for (let si = 0; si < orderedSlots.length; si++) {
      const slot = orderedSlots[si]!;
      const sw = slot.right - slot.left;
      const line = layoutNextLine(prepared, cursor, sw);
      if (line === null) {
        textExhausted = true;
        break;
      }

      let finalText = line.text;
      let finalWidth = line.width;
      let nextCursor = line.end;

      if (hyphenate) {
        const hyph = tryHyphenate(
          prepared,
          finalText,
          finalWidth,
          nextCursor,
          sw,
        );
        if (hyph !== null) {
          finalText = hyph.text;
          finalWidth = hyph.width;
          nextCursor = hyph.cursor;
        }
      }

      lines.push({
        x: Math.round(slot.left),
        y: Math.round(lineTop),
        text: finalText,
        width: finalWidth,
        slotWidth: sw,
      });
      cursor = nextCursor;
    }

    lineTop += lineHeight;
  }

  return { lines, cursor };
}

/** Generate a star polygon centered at (cx, cy). */
export function starPolygon(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  tips: number,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < tips * 2; i++) {
    const angle = (Math.PI * i) / tips - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

/** Convert polygon points to an SVG `points` attribute string. */
export function svgPointsAttr(pts: Point[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}
