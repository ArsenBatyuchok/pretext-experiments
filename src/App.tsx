import type { PointerEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { prepareWithSegments } from '@chenglou/pretext';

import {
  type Obstacle,
  type PositionedLine,
  layoutTextAroundObstacles,
  starPolygon,
  svgPointsAttr,
} from './flowAroundObstacles';

import {
  LOGO_SUB_PATHS,
  LOGO_SVG_CENTER_TX,
  LOGO_SVG_CENTER_TY,
  LOGO_SVG_D,
} from './logoShape';

import { TARIFF_BODY } from './tariffCorpus';

import './App.css';

const STAGE_PAD = 20;
const LINE_HEIGHT = 12;
const FONT_SIZE = 12;
const FONT_FAMILY = '"Favorit Mono", ui-monospace, Consolas, monospace';
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`;

const SMOOTH = 5;

type ShapeKind = 'star' | 'ring' | 'logo';

const STAR_OUTER_R = 160;
const STAR_INNER_R = 70;
const STAR_TIPS = 5;
const STAR_PAD = 6;

const RING_OUTER_R = 140;
const RING_BORDER = 20;
const RING_PAD = 4;

const LOGO_SCALE = 2.5;
const LOGO_PAD = 4;

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [showBorder, setShowBorder] = useState(true);
  const [shape, setShape] = useState<ShapeKind>('logo');
  const [smoothCursor, setSmoothCursor] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const smoothRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const snapNextRef = useRef(true);
  const rafTimeRef = useRef<number | null>(null);

  const prepared = useMemo(() => prepareWithSegments(TARIFF_BODY, FONT), []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const sync = () => {
      const r = el.getBoundingClientRect();
      setStageSize({ w: r.width, h: r.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let id = 0;
    let alive = true;

    const tick = (now: number) => {
      if (!alive) {
        return;
      }
      const prev = rafTimeRef.current;
      const dt =
        prev === null ? 1 / 60 : Math.min((now - prev) / 1000, 0.05);
      rafTimeRef.current = now;

      const target = targetRef.current;
      if (target === null) {
        setSmoothCursor((c) => (c === null ? c : null));
        id = requestAnimationFrame(tick);
        return;
      }

      const t = 1 - Math.exp(-SMOOTH * dt);
      const s = smoothRef.current;
      if (snapNextRef.current) {
        smoothRef.current = { x: target.x, y: target.y };
        snapNextRef.current = false;
        setSmoothCursor({ x: target.x, y: target.y });
      } else {
        const nx = s.x + (target.x - s.x) * t;
        const ny = s.y + (target.y - s.y) * t;
        smoothRef.current = { x: nx, y: ny };
        setSmoothCursor({ x: nx, y: ny });
      }

      id = requestAnimationFrame(tick);
    };

    id = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, []);

  const currentObstacle = useMemo((): {
    obstacles: Obstacle[];
    starPts: ReturnType<typeof starPolygon> | null;
  } => {
    if (smoothCursor === null) {
      return { obstacles: [], starPts: null };
    }
    const { x, y } = smoothCursor;

    if (shape === 'star') {
      const pts = starPolygon(x, y, STAR_OUTER_R, STAR_INNER_R, STAR_TIPS);
      return {
        obstacles: [{ kind: 'polygon', points: pts, pad: STAR_PAD }],
        starPts: pts,
      };
    }

    if (shape === 'ring') {
      return {
        obstacles: [
          {
            kind: 'ring',
            cx: x,
            cy: y,
            outerR: RING_OUTER_R,
            borderWidth: RING_BORDER,
            pad: RING_PAD,
          },
        ],
        starPts: null,
      };
    }

    return {
      obstacles: [
        {
          kind: 'svgPath',
          subPaths: LOGO_SUB_PATHS,
          cx: x,
          cy: y,
          scale: LOGO_SCALE,
          pad: LOGO_PAD,
        },
      ],
      starPts: null,
    };
  }, [smoothCursor, shape]);

  const lines = useMemo((): PositionedLine[] => {
    const { w, h } = stageSize;
    if (w < 40 || h < 40) {
      return [];
    }
    const region = {
      x: STAGE_PAD,
      y: STAGE_PAD,
      w: w - 2 * STAGE_PAD,
      h: h - 2 * STAGE_PAD,
    };
    return layoutTextAroundObstacles(
      prepared,
      region,
      LINE_HEIGHT,
      currentObstacle.obstacles,
    ).lines;
  }, [prepared, stageSize, currentObstacle]);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    targetRef.current = {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    };
  };

  const onPointerLeave = () => {
    targetRef.current = null;
    snapNextRef.current = true;
  };

  const renderShapeSVG = () => {
    if (smoothCursor === null || !showBorder) {
      return null;
    }
    const { x, y } = smoothCursor;

    if (shape === 'star' && currentObstacle.starPts !== null) {
      return (
        <svg className="flow-shape-svg">
          <polygon
            points={svgPointsAttr(currentObstacle.starPts)}
            fill="none"
            stroke="var(--accent, #aa3bff)"
            strokeWidth="1.5"
            opacity="0.5"
          />
        </svg>
      );
    }

    if (shape === 'ring') {
      const innerR = RING_OUTER_R - RING_BORDER;
      return (
        <svg className="flow-shape-svg">
          <circle
            cx={x}
            cy={y}
            r={RING_OUTER_R}
            fill="none"
            stroke="var(--accent, #aa3bff)"
            strokeWidth="1.5"
            opacity="0.5"
          />
          <circle
            cx={x}
            cy={y}
            r={innerR}
            fill="none"
            stroke="var(--accent, #aa3bff)"
            strokeWidth="1.5"
            opacity="0.3"
          />
        </svg>
      );
    }

    if (shape === 'logo') {
      return (
        <svg className="flow-shape-svg">
          <g
            transform={`translate(${x},${y}) scale(${LOGO_SCALE}) translate(${LOGO_SVG_CENTER_TX},${LOGO_SVG_CENTER_TY})`}
          >
            <path
              d={LOGO_SVG_D}
              fill="var(--accent, #aa3bff)"
              fillRule="evenodd"
              fillOpacity="0.1"
              stroke="var(--accent, #aa3bff)"
              strokeWidth={1 / LOGO_SCALE}
              strokeOpacity="0.45"
            />
          </g>
        </svg>
      );
    }

    return null;
  };

  return (
    <div className="flow-page">
      <header className="flow-header">
        <h1>Flow around shapes</h1>
        <p className="flow-lede">
          Text reflows around a{' '}
          {shape === 'logo'
            ? 'logo (filled pixels block text)'
            : shape === 'ring'
              ? 'ring (border blocked, interior filled)'
              : 'star polygon'}{' '}
          following the pointer via <code>layoutNextLine</code>.
        </p>
        <div className="flow-controls">
          <label className="flow-toggle">
            <input
              type="checkbox"
              checked={showBorder}
              onChange={() => setShowBorder((v) => !v)}
            />
            Show border
          </label>
          <fieldset className="flow-shape-picker">
            <legend>Shape</legend>
            <label>
              <input
                type="radio"
                name="shape"
                value="logo"
                checked={shape === 'logo'}
                onChange={() => setShape('logo')}
              />
              Logo
            </label>
            <label>
              <input
                type="radio"
                name="shape"
                value="ring"
                checked={shape === 'ring'}
                onChange={() => setShape('ring')}
              />
              Ring
            </label>
            <label>
              <input
                type="radio"
                name="shape"
                value="star"
                checked={shape === 'star'}
                onChange={() => setShape('star')}
              />
              Star
            </label>
          </fieldset>
        </div>
      </header>

      <div
        ref={stageRef}
        className="flow-stage"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {renderShapeSVG()}

        {lines.map((line, i) => {
          const slack = line.slotWidth - line.width;
          const spaceCount = line.text.split(' ').length - 1;
          const justify =
            spaceCount > 0 && slack > 0 && slack / spaceCount < 14;
          return (
            <div
              key={i}
              className="flow-line"
              style={{
                left: line.x,
                top: line.y,
                font: FONT,
                lineHeight: `${LINE_HEIGHT}px`,
                wordSpacing: justify
                  ? `${slack / spaceCount}px`
                  : undefined,
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
