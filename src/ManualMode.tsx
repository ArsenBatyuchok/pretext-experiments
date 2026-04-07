import type { PointerEvent as RPointerEvent } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { PreparedTextWithSegments } from '@chenglou/pretext';

import {
  type AnchorPoint,
  type BezierShape,
  type Point,
  bezierShapeToSvgPath,
  isPointInBezierShape,
} from './bezierMath';

import {
  type Obstacle,
  type PositionedLine,
  layoutTextAroundObstacles,
} from './flowAroundObstacles';

import './ManualMode.css';

const HIT_R = 8;
const CLOSE_R = 12;

type DragInfo =
  | {
      kind: 'newAnchor';
      origin: Point;
      moved: boolean;
    }
  | {
      kind: 'anchor';
      shapeId: string;
      idx: number;
      anchorStart: Point;
      handleInStart: Point;
      handleOutStart: Point;
      origin: Point;
    }
  | {
      kind: 'handleIn' | 'handleOut';
      shapeId: string;
      idx: number;
    };

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export type ManualPreset = 'triangle' | 'circle' | 'square';

function makePresetShape(
  preset: ManualPreset,
  cx: number,
  cy: number,
  id: string,
): BezierShape {
  const R = 100;
  const sharp = (x: number, y: number): AnchorPoint => ({
    pos: { x, y },
    handleIn: { x, y },
    handleOut: { x, y },
  });
  const K = 0.5522847498;

  if (preset === 'triangle') {
    return {
      id,
      closed: true,
      anchors: [
        sharp(cx, cy - R),
        sharp(cx + R * Math.cos(Math.PI / 6), cy + R * Math.sin(Math.PI / 6)),
        sharp(cx - R * Math.cos(Math.PI / 6), cy + R * Math.sin(Math.PI / 6)),
      ],
    };
  }

  if (preset === 'circle') {
    return {
      id,
      closed: true,
      anchors: [
        { pos: { x: cx, y: cy - R }, handleIn: { x: cx + R * K, y: cy - R }, handleOut: { x: cx - R * K, y: cy - R } },
        { pos: { x: cx - R, y: cy }, handleIn: { x: cx - R, y: cy - R * K }, handleOut: { x: cx - R, y: cy + R * K } },
        { pos: { x: cx, y: cy + R }, handleIn: { x: cx - R * K, y: cy + R }, handleOut: { x: cx + R * K, y: cy + R } },
        { pos: { x: cx + R, y: cy }, handleIn: { x: cx + R, y: cy + R * K }, handleOut: { x: cx + R, y: cy - R * K } },
      ],
    };
  }

  return {
    id,
    closed: true,
    anchors: [
      sharp(cx - R, cy - R),
      sharp(cx + R, cy - R),
      sharp(cx + R, cy + R),
      sharp(cx - R, cy + R),
    ],
  };
}

export function ManualMode({
  prepared,
  font,
  lineHeight,
  stagePad,
  shapePad,
  hyphenate,
  editing,
  pendingPreset,
  onPresetPlaced,
}: {
  prepared: PreparedTextWithSegments;
  font: string;
  lineHeight: number;
  stagePad: number;
  shapePad: number;
  hyphenate: boolean;
  editing: boolean;
  pendingPreset: ManualPreset | null;
  onPresetPlaced: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const [shapes, setShapes] = useState<BezierShape[]>([]);
  const [drawAnchors, setDrawAnchors] = useState<AnchorPoint[]>([]);
  const [pending, setPending] = useState<AnchorPoint | null>(null);
  const [selShapeId, setSelShapeId] = useState<string | null>(null);
  const [selAnchorIdx, setSelAnchorIdx] = useState<number | null>(null);
  const [mouse, setMouse] = useState<Point | null>(null);

  const nextId = useRef(0);
  const dragRef = useRef<DragInfo | null>(null);

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

  const obstacles = useMemo((): Obstacle[] => {
    const closed = shapes.filter((s) => s.closed);
    if (closed.length === 0) {
      return [];
    }
    return [{ kind: 'bezierPath', shapes: closed, pad: shapePad }];
  }, [shapes, shapePad]);

  const lines = useMemo((): PositionedLine[] => {
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
      obstacles,
      undefined,
      hyphenate,
    ).lines;
  }, [prepared, stageSize, obstacles, lineHeight, stagePad, hyphenate]);

  const closePath = useCallback(() => {
    const prev = drawAnchors;
    if (prev.length < 3) {
      return;
    }
    const id = `shape-${++nextId.current}`;
    const newShape: BezierShape = { id, anchors: prev, closed: true };
    setShapes((s) => [...s, newShape]);
    setSelShapeId(id);
    setSelAnchorIdx(null);
    setDrawAnchors([]);
    setPending(null);
  }, [drawAnchors]);

  const getPos = (e: RPointerEvent<HTMLDivElement>): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTestEditing = (
    pos: Point,
  ): DragInfo | null => {
    if (selShapeId === null) {
      return null;
    }
    const shape = shapes.find((s) => s.id === selShapeId);
    if (!shape) {
      return null;
    }
    for (let i = 0; i < shape.anchors.length; i++) {
      const a = shape.anchors[i]!;
      if (dist(pos, a.handleIn) < HIT_R) {
        return { kind: 'handleIn', shapeId: selShapeId, idx: i };
      }
      if (dist(pos, a.handleOut) < HIT_R) {
        return { kind: 'handleOut', shapeId: selShapeId, idx: i };
      }
    }
    for (let i = 0; i < shape.anchors.length; i++) {
      const a = shape.anchors[i]!;
      if (dist(pos, a.pos) < HIT_R) {
        return {
          kind: 'anchor',
          shapeId: selShapeId,
          idx: i,
          anchorStart: { ...a.pos },
          handleInStart: { ...a.handleIn },
          handleOutStart: { ...a.handleOut },
          origin: pos,
        };
      }
    }
    return null;
  };

  const hitTestSelectShape = (pos: Point): string | null => {
    for (let i = 0; i < shapes.length; i++) {
      const a = shapes[i]!.anchors;
      for (let j = 0; j < a.length; j++) {
        if (dist(pos, a[j]!.pos) < HIT_R) {
          return shapes[i]!.id;
        }
      }
    }
    for (let i = 0; i < shapes.length; i++) {
      if (isPointInBezierShape(shapes[i]!, pos.x, pos.y)) {
        return shapes[i]!.id;
      }
    }
    return null;
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    const pos = getPos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (pendingPreset) {
      const id = `shape-${++nextId.current}`;
      const newShape = makePresetShape(pendingPreset, pos.x, pos.y, id);
      setShapes((s) => [...s, newShape]);
      setSelShapeId(id);
      setSelAnchorIdx(null);
      onPresetPlaced();
      return;
    }

    if (drawAnchors.length > 0) {
      const first = drawAnchors[0]!;
      if (drawAnchors.length >= 3 && dist(pos, first.pos) < CLOSE_R) {
        closePath();
        return;
      }
      dragRef.current = { kind: 'newAnchor', origin: pos, moved: false };
      setPending({
        pos: { ...pos },
        handleIn: { ...pos },
        handleOut: { ...pos },
      });
      return;
    }

    const editHit = hitTestEditing(pos);
    if (editHit) {
      if (editHit.kind === 'anchor') {
        setSelAnchorIdx(editHit.idx);
      }
      dragRef.current = editHit;
      return;
    }

    const shapeHit = hitTestSelectShape(pos);
    if (shapeHit) {
      setSelShapeId(shapeHit);
      setSelAnchorIdx(null);
      const shape = shapes.find((s) => s.id === shapeHit)!;
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < shape.anchors.length; i++) {
        const d = dist(pos, shape.anchors[i]!.pos);
        if (d < closestDist) {
          closestDist = d;
          closestIdx = i;
        }
      }
      const a = shape.anchors[closestIdx]!;
      dragRef.current = {
        kind: 'anchor',
        shapeId: shapeHit,
        idx: closestIdx,
        anchorStart: { ...a.pos },
        handleInStart: { ...a.handleIn },
        handleOutStart: { ...a.handleOut },
        origin: pos,
      };
      setSelAnchorIdx(closestIdx);
      return;
    }

    setSelShapeId(null);
    setSelAnchorIdx(null);

    if (!editing) {
      return;
    }

    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) {
      return;
    }

    dragRef.current = { kind: 'newAnchor', origin: pos, moved: false };
    setPending({
      pos: { ...pos },
      handleIn: { ...pos },
      handleOut: { ...pos },
    });
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const pos = getPos(e);
    setMouse(pos);

    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    if (drag.kind === 'newAnchor') {
      if (dist(pos, drag.origin) > 3) {
        drag.moved = true;
      }
      if (drag.moved) {
        const dx = pos.x - drag.origin.x;
        const dy = pos.y - drag.origin.y;
        setPending({
          pos: { ...drag.origin },
          handleOut: { x: drag.origin.x + dx, y: drag.origin.y + dy },
          handleIn: { x: drag.origin.x - dx, y: drag.origin.y - dy },
        });
      }
      return;
    }

    if (drag.kind === 'anchor') {
      const dx = pos.x - drag.origin.x;
      const dy = pos.y - drag.origin.y;
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== drag.shapeId) {
            return s;
          }
          return {
            ...s,
            anchors: s.anchors.map((a, i) => {
              if (i !== drag.idx) {
                return a;
              }
              return {
                pos: {
                  x: drag.anchorStart.x + dx,
                  y: drag.anchorStart.y + dy,
                },
                handleIn: {
                  x: drag.handleInStart.x + dx,
                  y: drag.handleInStart.y + dy,
                },
                handleOut: {
                  x: drag.handleOutStart.x + dx,
                  y: drag.handleOutStart.y + dy,
                },
              };
            }),
          };
        }),
      );
      return;
    }

    if (drag.kind === 'handleIn' || drag.kind === 'handleOut') {
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== drag.shapeId) {
            return s;
          }
          return {
            ...s,
            anchors: s.anchors.map((a, i) => {
              if (i !== drag.idx) {
                return a;
              }
              if (drag.kind === 'handleOut') {
                return { ...a, handleOut: { ...pos } };
              }
              return { ...a, handleIn: { ...pos } };
            }),
          };
        }),
      );
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag?.kind === 'newAnchor') {
      const anchor: AnchorPoint = drag.moved
        ? pending!
        : {
            pos: { ...drag.origin },
            handleIn: { ...drag.origin },
            handleOut: { ...drag.origin },
          };
      setDrawAnchors((prev) => [...prev, anchor]);
      setPending(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawAnchors([]);
        setPending(null);
        dragRef.current = null;
      } else if (e.key === 'Enter') {
        closePath();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          (e.target as HTMLElement).tagName === 'INPUT' ||
          (e.target as HTMLElement).tagName === 'TEXTAREA'
        ) {
          return;
        }
        if (selShapeId !== null && selAnchorIdx !== null) {
          setShapes((prev) => {
            const out: BezierShape[] = [];
            for (const s of prev) {
              if (s.id !== selShapeId) {
                out.push(s);
                continue;
              }
              if (s.anchors.length <= 3) {
                continue;
              }
              out.push({
                ...s,
                anchors: s.anchors.filter((_, i) => i !== selAnchorIdx),
              });
            }
            return out;
          });
          setSelAnchorIdx(null);
        } else if (selShapeId !== null) {
          setShapes((prev) => prev.filter((s) => s.id !== selShapeId));
          setSelShapeId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selShapeId, selAnchorIdx, closePath]);

  const isDrawing = drawAnchors.length > 0 || pending !== null;
  const selectedShape = selShapeId
    ? shapes.find((s) => s.id === selShapeId) ?? null
    : null;

  const allDrawAnchors = pending
    ? [...drawAnchors, pending]
    : drawAnchors;

  const drawPathD =
    allDrawAnchors.length >= 2
      ? bezierShapeToSvgPath({
          id: '',
          anchors: allDrawAnchors,
          closed: false,
        })
      : null;

  return (
    <div
      ref={stageRef}
      className={`flow-stage manual-stage ${isDrawing ? 'manual-stage--drawing' : ''} ${pendingPreset ? 'manual-stage--placing' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {editing && (
        <svg className="flow-shape-svg manual-svg manual-svg-shapes">
          {shapes.map((shape) => (
            <path
              key={shape.id}
              d={bezierShapeToSvgPath(shape)}
              className={`manual-shape ${shape.id === selShapeId ? 'manual-shape--selected' : ''}`}
            />
          ))}
        </svg>
      )}

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

      {editing && (
        <svg className="flow-shape-svg manual-svg manual-svg-controls">
          {drawPathD && (
            <path d={drawPathD} className="manual-draw-path" />
          )}

          {isDrawing && mouse && allDrawAnchors.length > 0 && (
            <line
              x1={allDrawAnchors[allDrawAnchors.length - 1]!.pos.x}
              y1={allDrawAnchors[allDrawAnchors.length - 1]!.pos.y}
              x2={mouse.x}
              y2={mouse.y}
              className="manual-ghost-line"
            />
          )}

          {pending && (
            <g className="manual-pending">
              <line
                x1={pending.handleIn.x}
                y1={pending.handleIn.y}
                x2={pending.pos.x}
                y2={pending.pos.y}
                className="manual-handle-line"
              />
              <line
                x1={pending.pos.x}
                y1={pending.pos.y}
                x2={pending.handleOut.x}
                y2={pending.handleOut.y}
                className="manual-handle-line"
              />
              <circle
                cx={pending.handleIn.x}
                cy={pending.handleIn.y}
                r={3.5}
                className="manual-handle-dot"
              />
              <circle
                cx={pending.handleOut.x}
                cy={pending.handleOut.y}
                r={3.5}
                className="manual-handle-dot"
              />
              <circle
                cx={pending.pos.x}
                cy={pending.pos.y}
                r={4.5}
                className="manual-anchor-dot"
              />
            </g>
          )}

          {drawAnchors.map((a, i) => {
            const isFirst = i === 0 && drawAnchors.length >= 3;
            return (
              <circle
                key={i}
                cx={a.pos.x}
                cy={a.pos.y}
                r={isFirst ? 6 : 4.5}
                className={`manual-anchor-dot ${isFirst ? 'manual-anchor-dot--close' : ''}`}
              />
            );
          })}

          {selectedShape &&
            selectedShape.anchors.map((a, i) => {
              const showHandles =
                dist(a.handleIn, a.pos) > 1 || dist(a.handleOut, a.pos) > 1;
              return (
                <g key={i}>
                  {showHandles && (
                    <>
                      <line
                        x1={a.handleIn.x}
                        y1={a.handleIn.y}
                        x2={a.pos.x}
                        y2={a.pos.y}
                        className="manual-handle-line"
                      />
                      <line
                        x1={a.pos.x}
                        y1={a.pos.y}
                        x2={a.handleOut.x}
                        y2={a.handleOut.y}
                        className="manual-handle-line"
                      />
                      <circle
                        cx={a.handleIn.x}
                        cy={a.handleIn.y}
                        r={3.5}
                        className="manual-handle-dot"
                      />
                      <circle
                        cx={a.handleOut.x}
                        cy={a.handleOut.y}
                        r={3.5}
                        className="manual-handle-dot"
                      />
                    </>
                  )}
                  <circle
                    cx={a.pos.x}
                    cy={a.pos.y}
                    r={4.5}
                    className={`manual-anchor-dot ${i === selAnchorIdx ? 'manual-anchor-dot--active' : ''}`}
                  />
                </g>
              );
            })}
        </svg>
      )}

    </div>
  );
}
