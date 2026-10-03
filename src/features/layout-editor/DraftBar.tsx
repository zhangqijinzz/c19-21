import type { MoveDraft } from '../../types';

interface DraftBarProps {
  draft: MoveDraft;
  elementName: string;
  issueCount: number;
  onConfirm: () => void;
  onDiscard: () => void;
}

export function DraftBar({ draft, elementName, issueCount, onConfirm, onDiscard }: DraftBarProps) {
  return <div className="draft-bar">
    <span className="draft-badge">试算中</span>
    <span className="draft-copy">{elementName} → ({draft.x.toFixed(1)}, {draft.y.toFixed(1)}) · {issueCount ? `落位后将有 ${issueCount} 项需关注` : '落位后通行顺畅'} · 布局尚未写回</span>
    <div className="draft-actions">
      <button type="button" className="draft-confirm" onClick={onConfirm}>✓ 确认落位</button>
      <button type="button" className="draft-discard" onClick={onDiscard}>✕ 放弃试算</button>
    </div>
  </div>;
}
