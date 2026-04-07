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

import { type ManualPreset, ManualMode } from './ManualMode';

import { TARIFF_BODY } from './tariffCorpus';

import './App.css';

const FONT_FAMILY = '"Favorit Mono", ui-monospace, Consolas, monospace';

type AppMode = 'follow' | 'manual';
type ShapeKind = 'star' | 'ring' | 'logo';

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flow-slider">
      <span className="flow-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="flow-slider-value">{value}</span>
    </label>
  );
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const [mode, setMode] = useState<AppMode>('manual');
  const [showBorder, setShowBorder] = useState(false);
  const [hyphenate, setHyphenate] = useState(true);
  const [shape, setShape] = useState<ShapeKind>('logo');

  const [fontSize, setFontSize] = useState(12);
  const [lineHeight, setLineHeight] = useState(12);
  const [stagePad, setStagePad] = useState(20);
  const [smoothFactor, setSmoothFactor] = useState(5);

  const [starOuterR, setStarOuterR] = useState(160);
  const [starInnerR, setStarInnerR] = useState(70);
  const [starTips, setStarTips] = useState(5);
  const [starPad, setStarPad] = useState(6);

  const [ringOuterR, setRingOuterR] = useState(140);
  const [ringBorder, setRingBorder] = useState(20);
  const [ringPad, setRingPad] = useState(4);

  const [logoScale, setLogoScale] = useState(2.5);
  const [logoPad, setLogoPad] = useState(4);

  const [manualPad, setManualPad] = useState(10);
  const [preview, setPreview] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<ManualPreset | null>(null);

  const [smoothCursor, setSmoothCursor] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const smoothRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const snapNextRef = useRef(true);
  const rafTimeRef = useRef<number | null>(null);
  const smoothFactorRef = useRef(smoothFactor);
  useEffect(() => {
    smoothFactorRef.current = smoothFactor;
  }, [smoothFactor]);

  const font = `${fontSize}px ${FONT_FAMILY}`;
  const prepared = useMemo(
    () => prepareWithSegments(TARIFF_BODY, font),
    [font],
  );

  useLayoutEffect(() => {
    if (mode !== 'follow') {
      return;
    }
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
  }, [mode]);

  useEffect(() => {
    if (mode !== 'follow') {
      return;
    }
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

      const t = 1 - Math.exp(-smoothFactorRef.current * dt);
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
  }, [mode]);

  const currentObstacle = useMemo((): {
    obstacles: Obstacle[];
    starPts: ReturnType<typeof starPolygon> | null;
  } => {
    if (smoothCursor === null) {
      return { obstacles: [], starPts: null };
    }
    const { x, y } = smoothCursor;

    if (shape === 'star') {
      const pts = starPolygon(x, y, starOuterR, starInnerR, starTips);
      return {
        obstacles: [{ kind: 'polygon', points: pts, pad: starPad }],
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
            outerR: ringOuterR,
            borderWidth: ringBorder,
            pad: ringPad,
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
          scale: logoScale,
          pad: logoPad,
        },
      ],
      starPts: null,
    };
  }, [
    smoothCursor,
    shape,
    starOuterR,
    starInnerR,
    starTips,
    starPad,
    ringOuterR,
    ringBorder,
    ringPad,
    logoScale,
    logoPad,
  ]);

  const lines = useMemo((): PositionedLine[] => {
    if (mode !== 'follow') {
      return [];
    }
    const { w, h } = stageSize;
    if (w < 40 || h < 40) {
      return [];
    }
    const region = {
      x: stagePad,
      y: stagePad,
      w: w - 2 * stagePad,
      h: h - 2 * stagePad,
    };
    return layoutTextAroundObstacles(
      prepared,
      region,
      lineHeight,
      currentObstacle.obstacles,
      undefined,
      hyphenate,
    ).lines;
  }, [
    mode,
    prepared,
    stageSize,
    currentObstacle,
    hyphenate,
    lineHeight,
    stagePad,
  ]);

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
            stroke="var(--accent)"
            strokeWidth="1.5"
            opacity="0.5"
          />
        </svg>
      );
    }

    if (shape === 'ring') {
      const innerR = ringOuterR - ringBorder;
      return (
        <svg className="flow-shape-svg">
          <circle
            cx={x}
            cy={y}
            r={ringOuterR}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            opacity="0.5"
          />
          <circle
            cx={x}
            cy={y}
            r={innerR}
            fill="none"
            stroke="var(--accent)"
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
            transform={`translate(${x},${y}) scale(${logoScale}) translate(${LOGO_SVG_CENTER_TX},${LOGO_SVG_CENTER_TY})`}
          >
            <path
              d={LOGO_SVG_D}
              fill="var(--accent)"
              fillRule="evenodd"
              fillOpacity="0.1"
              stroke="var(--accent)"
              strokeWidth={1 / logoScale}
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

        <div className="flow-controls">
          <fieldset className="flow-shape-picker">
            <legend>Mode</legend>
            <label>
              <input
                type="radio"
                name="mode"
                value="follow"
                checked={mode === 'follow'}
                onChange={() => setMode('follow')}
              />
              Follow
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="manual"
                checked={mode === 'manual'}
                onChange={() => setMode('manual')}
              />
              Manual
            </label>
          </fieldset>

          {mode === 'follow' && (
            <>
              <label className="flow-toggle">
                <input
                  type="checkbox"
                  checked={showBorder}
                  onChange={() => setShowBorder((v) => !v)}
                />
                Show border
              </label>
              <label className="flow-toggle">
                <input
                  type="checkbox"
                  checked={hyphenate}
                  onChange={() => setHyphenate((v) => !v)}
                />
                Hyphenate
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
            </>
          )}

          {mode === 'manual' && (
            <>
              <label className="flow-toggle">
                <input
                  type="checkbox"
                  checked={hyphenate}
                  onChange={() => setHyphenate((v) => !v)}
                />
                Hyphenate
              </label>
              <label className="flow-toggle">
                <input
                  type="checkbox"
                  checked={preview}
                  onChange={() => {
                    setPreview((v) => !v);
                    setPendingPreset(null);
                  }}
                />
                Preview
              </label>
              <fieldset className="flow-shape-picker">
                <legend>Add shape</legend>
                {(['triangle', 'circle', 'square'] as ManualPreset[]).map((p) => (
                  <button
                    key={p}
                    className={`flow-preset-btn ${pendingPreset === p ? 'flow-preset-btn--active' : ''}`}
                    onClick={() => setPendingPreset((cur) => (cur === p ? null : p))}
                  >
                    {p[0]!.toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </fieldset>
            </>
          )}
        </div>

        <div className="flow-sliders">
          <div className="flow-slider-group">
            <span className="flow-slider-group-title">Global</span>
            <Slider
              label="Font size"
              value={fontSize}
              min={8}
              max={28}
              onChange={setFontSize}
            />
            <Slider
              label="Line height"
              value={lineHeight}
              min={8}
              max={48}
              onChange={setLineHeight}
            />
            <Slider
              label="Padding"
              value={stagePad}
              min={0}
              max={60}
              onChange={setStagePad}
            />
            {mode === 'follow' && (
              <Slider
                label="Smoothing"
                value={smoothFactor}
                min={1}
                max={30}
                onChange={setSmoothFactor}
              />
            )}
            {mode === 'manual' && (
              <Slider
                label="Shape pad"
                value={manualPad}
                min={0}
                max={40}
                onChange={setManualPad}
              />
            )}
          </div>

          {mode === 'follow' && shape === 'star' && (
            <div className="flow-slider-group">
              <span className="flow-slider-group-title">Star</span>
              <Slider
                label="Outer radius"
                value={starOuterR}
                min={40}
                max={300}
                onChange={setStarOuterR}
              />
              <Slider
                label="Inner radius"
                value={starInnerR}
                min={10}
                max={200}
                onChange={setStarInnerR}
              />
              <Slider
                label="Tips"
                value={starTips}
                min={3}
                max={12}
                onChange={setStarTips}
              />
              <Slider
                label="Gap pad"
                value={starPad}
                min={0}
                max={24}
                onChange={setStarPad}
              />
            </div>
          )}

          {mode === 'follow' && shape === 'ring' && (
            <div className="flow-slider-group">
              <span className="flow-slider-group-title">Ring</span>
              <Slider
                label="Outer radius"
                value={ringOuterR}
                min={40}
                max={300}
                onChange={setRingOuterR}
              />
              <Slider
                label="Border width"
                value={ringBorder}
                min={5}
                max={100}
                onChange={setRingBorder}
              />
              <Slider
                label="Gap pad"
                value={ringPad}
                min={0}
                max={24}
                onChange={setRingPad}
              />
            </div>
          )}

          {mode === 'follow' && shape === 'logo' && (
            <div className="flow-slider-group">
              <span className="flow-slider-group-title">Logo</span>
              <Slider
                label="Scale"
                value={logoScale}
                min={0.5}
                max={5}
                step={0.1}
                onChange={setLogoScale}
              />
              <Slider
                label="Gap pad"
                value={logoPad}
                min={0}
                max={24}
                onChange={setLogoPad}
              />
            </div>
          )}
        </div>
      </header>

      {mode === 'follow' ? (
        <div
          ref={stageRef}
          className="flow-stage flow-stage--follow"
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
                  font,
                  lineHeight: `${lineHeight}px`,
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
      ) : (
        <ManualMode
          prepared={prepared}
          font={font}
          lineHeight={lineHeight}
          stagePad={stagePad}
          shapePad={manualPad}
          hyphenate={hyphenate}
          editing={!preview}
          pendingPreset={pendingPreset}
          onPresetPlaced={() => setPendingPreset(null)}
        />
      )}
    </div>
  );
}
