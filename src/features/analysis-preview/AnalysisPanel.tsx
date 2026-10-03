import type { Analysis, LayoutMode } from '../../types';

interface AnalysisPanelProps { analysis: Analysis; mode: LayoutMode; elementCount: number; draftActive: boolean; }

export function AnalysisPanel({ analysis, mode, elementCount, draftActive }: AnalysisPanelProps) {
  const issueCount = analysis.overlaps.length + analysis.bounds.length + analysis.channels.length;
  const pathMessage = analysis.path ? `${analysis.path.fromName} → ${analysis.path.toName} · ${analysis.path.distance} m` : '需要入口和重点区域才能生成路径';
  const title = draftActive ? '试算结果预览' : mode === 'path' ? '访问路径预览' : mode === 'inspect' ? '空间检查结果' : '布局概览';
  return <section className={`analysis-panel analysis-${mode}${draftActive ? ' analysis-draft' : ''}`}>
    <div className="analysis-title"><span className="analysis-pulse" /><div><span className="section-kicker">LIVE ANALYSIS</span><strong>{title}</strong></div></div>
    <div className="analysis-metrics"><span><b>{elementCount}</b>元素</span><span className={analysis.overlaps.length ? 'metric-warning' : ''}><b>{analysis.overlaps.length}</b>重叠</span><span className={analysis.bounds.length ? 'metric-warning' : ''}><b>{analysis.bounds.length}</b>越界</span><span className={analysis.channels.length ? 'metric-warning' : ''}><b>{analysis.channels.length}</b>窄通道</span></div>
    <div className="analysis-result"><strong>{issueCount ? `${issueCount} 项需要关注` : '当前布局通行顺畅'}</strong><small>{draftActive ? '试算结论与落位后检查一致 · 确认后写回布局' : pathMessage}</small></div>
  </section>;
}
