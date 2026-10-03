import type { Analysis, LayoutMode, Notice } from '../../types';

interface StatusBarProps { mode: LayoutMode; analysis: Analysis; notice: Notice; elementCount: number; lastSavedAt: number | null; draftActive: boolean; onModeChange: (mode: LayoutMode) => void; }

export function StatusBar({ mode, analysis, notice, elementCount, lastSavedAt, draftActive, onModeChange }: StatusBarProps) {
  const issues = analysis.overlaps.length + analysis.bounds.length + analysis.channels.length;
  const issueLabel = draftActive ? (issues ? `试算中 · ${issues} 项待确认` : '试算中 · 通行顺畅') : issues ? `${issues} 项待检查` : '布局状态良好';
  return <div className="bottom-bar">
    <div className="status-message"><span className={`status-dot ${notice.tone}`} />{notice.message}<small>{lastSavedAt ? `· 已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}</small></div>
    <div className="bottom-meta"><span>{elementCount} 个元素</span><span className={issues ? 'has-issues' : 'is-clear'}>{issueLabel}</span><span>{draftActive ? '试算未写回' : '自动保存'}</span></div>
    <div className="mode-tabs"><button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => onModeChange('edit')}>编辑</button><button type="button" className={mode === 'inspect' ? 'active' : ''} onClick={() => onModeChange('inspect')}>检查 {issues ? <b>{issues}</b> : null}</button><button type="button" className={mode === 'path' ? 'active' : ''} onClick={() => onModeChange('path')}>路径预览</button></div>
  </div>;
}
