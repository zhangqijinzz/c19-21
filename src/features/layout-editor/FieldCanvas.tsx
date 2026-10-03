import { useEffect, useRef, useState } from 'react';
import { ELEMENT_SPECS } from '../../domain';
import type { LayoutMode, MoveTrial, PathPreview, RenderElement, TrialOrigin } from '../../types';

interface FieldCanvasProps {
  field: { width: number; height: number };
  elements: RenderElement[];
  selectedId: string | null;
  mode: LayoutMode;
  overlaps: Array<{ firstId: string; secondId: string }>;
  bounds: Array<{ elementId: string }>;
  channels: Array<{ firstId: string; secondId: string }>;
  path: PathPreview | null;
  trial: MoveTrial | null;
  trialOrigin: TrialOrigin | null;
  trialIssues: number;
  onSelect: (id: string, fromDrag?: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConfirmTrial: () => void;
  onDiscardTrial: () => void;
  onDragEnd: () => void;
}

export function FieldCanvas({ field, elements, selectedId, mode, overlaps, bounds, channels, path, trial, trialOrigin, trialIssues, onSelect, onMove, onConfirmTrial, onDiscardTrial, onDragEnd }: FieldCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const issueIds = new Set(overlaps.flatMap((item) => [item.firstId, item.secondId]));
  const channelIds = new Set(channels.flatMap((item) => [item.firstId, item.secondId]));
  const boundsIds = new Set(bounds.map((item) => item.elementId));
  const canvasWidth = 100 / Math.max(1, field.width / (field.height * 1.35));

  const pointFromEvent = (event: React.PointerEvent) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) * field.width / box.width, y: (event.clientY - box.top) * field.height / box.height };
  };

  useEffect(() => {
    if (!trial) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onDiscardTrial(); }
      if (event.key === 'Enter') { event.preventDefault(); onConfirmTrial(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [trial, onConfirmTrial, onDiscardTrial]);

  const axisHint = mode === 'inspect'
    ? (trial ? '试算中：Enter 确认落位 · Esc 放弃恢复' : '检查模式：拖动元素试算挪动后的风险，不会自动保存')
    : '拖动元素 · 点击选中';

  return <div className="canvas-wrap">
    <div className="canvas-ruler top-ruler"><span>0 m</span><span>{Math.round(field.width / 2)} m</span><span>{field.width} m</span></div>
    <div className="canvas-ruler side-ruler"><span>0</span><span>{Math.round(field.height / 2)} m</span><span>{field.height} m</span></div>
    {trial && trialOrigin ? <div className="trial-ghost" style={{ left: `${trialOrigin.x / field.width * 100}%`, top: `${trialOrigin.y / field.height * 100}%`, width: `${trialOrigin.width / field.width * 100}%`, height: `${trialOrigin.height / field.height * 100}%` }} title="原位置" /> : null}
    <div className={`field-canvas mode-${mode}`} ref={canvasRef} style={{ width: `${Math.min(100, canvasWidth)}%`, aspectRatio: `${field.width} / ${field.height}` }}>
      <div className="grid-overlay" />
      <div className="field-label"><span>EXPO HALL A</span><strong>{field.width} × {field.height} m</strong></div>
      {path && mode === 'path' ? <svg className="path-layer" viewBox={`0 0 ${field.width} ${field.height}`} preserveAspectRatio="none"><polyline points={path.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ef795f" strokeWidth="0.3" strokeDasharray="0.75 0.55" /><circle cx={path.points[0].x} cy={path.points[0].y} r="0.45" fill="#ef795f" /><circle cx={path.points[path.points.length - 1].x} cy={path.points[path.points.length - 1].y} r="0.45" fill="#ef795f" /></svg> : null}
      {elements.map((element) => {
        const spec = ELEMENT_SPECS[element.kind];
        const isTrialElement = trial?.elementId === element.id;
        const classes = ['canvas-element', selectedId === element.id ? 'is-selected' : '', issueIds.has(element.id) && mode !== 'edit' ? 'is-overlap' : '', channelIds.has(element.id) && mode !== 'edit' ? 'is-channel' : '', boundsIds.has(element.id) ? 'is-out' : '', isTrialElement ? 'is-trial' : ''].filter(Boolean).join(' ');
        return <button key={element.id} type="button" className={classes} style={{ left: `${element.x / field.width * 100}%`, top: `${element.y / field.height * 100}%`, width: `${element.displayWidth / field.width * 100}%`, height: `${element.displayHeight / field.height * 100}%`, background: spec.color, transform: `rotate(${element.rotation}deg)` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const point = pointFromEvent(event); setDrag({ id: element.id, dx: point.x - element.x, dy: point.y - element.y }); onSelect(element.id, true); }} onPointerMove={(event) => { if (!drag || drag.id !== element.id) return; const point = pointFromEvent(event); onMove(element.id, point.x - drag.dx, point.y - drag.dy); }} onPointerUp={() => { setDrag(null); onDragEnd(); }} onPointerCancel={() => { setDrag(null); onDragEnd(); }}>
          <span className="element-icon">{spec.icon}</span><span className="element-name">{element.name}</span><small>{element.displayWidth.toFixed(1)} × {element.displayHeight.toFixed(1)} m</small>
          {issueIds.has(element.id) && mode !== 'edit' ? <span className="issue-dot">!</span> : null}
          {isTrialElement ? <span className="trial-tag">试算</span> : null}
        </button>;
      })}
      <div className="axis-hint">{axisHint}</div>
    </div>
    {trial && mode === 'inspect' ? <div className="trial-bar">
      <span className="trial-bar-icon">试</span>
      <div className="trial-bar-copy">
        <strong>试算结果{trialIssues ? `：${trialIssues} 项需要关注` : '：挪动后通行顺畅'}</strong>
        <small>此结论按确认落位后的布局计算 · 布局尚未改动、未保存</small>
      </div>
      <button type="button" className="trial-confirm" onClick={onConfirmTrial}>确认落位</button>
      <button type="button" className="trial-discard" onClick={onDiscardTrial}>放弃恢复</button>
    </div> : null}
    <div className="canvas-legend"><span><i className="legend-dot green" />可通行</span><span><i className="legend-dot coral" />需关注</span><span><i className="legend-line" />访问路径</span></div>
  </div>;
}
