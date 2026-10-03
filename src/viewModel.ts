import { applyMoveDraft, createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import type { LayoutRepository } from './repository';
import type { Analysis, ElementKind, ExpoElement, LayoutDocument, LayoutMode, MoveDraft, Notice, RenderElement, ViewPhase } from './types';

export interface ExpoSketchState {
  phase: ViewPhase;
  document: LayoutDocument;
  renderElements: RenderElement[];
  selectedId: string | null;
  selectedElement: RenderElement | null;
  mode: LayoutMode;
  analysis: Analysis;
  notice: Notice;
  lastSavedAt: number | null;
  draft: MoveDraft | null;
  draftSource: ExpoElement | null;
}

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private stateValue: ExpoSketchState = {
    phase: 'loading',
    document: starter,
    renderElements: starterRenderElements,
    selectedId: 'stage-1',
    selectedElement: starterRenderElements.find((element) => element.id === 'stage-1') ?? null,
    mode: 'edit',
    analysis: analyzeLayout(createStarterDocument()),
    notice: { tone: 'info', message: '正在恢复最近布局…' },
    lastSavedAt: null,
    draft: null,
    draftSource: null,
  };

  constructor(private readonly repository: LayoutRepository) {}

  get state() { return this.stateValue; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize() {
    try {
      const document = await this.repository.load();
      this.commit({ document, selectedId: document.elements[0]?.id ?? null, phase: 'ready', notice: { tone: 'success', message: '布局已就绪，可开始编辑' } });
    } catch {
      this.commit({ phase: 'error', notice: { tone: 'error', message: '布局读取失败，已载入安全示例' } });
    }
  }

  selectElement(id: string) {
    const draft = this.stateValue.draft;
    if (draft && draft.elementId !== id) {
      const name = findElement(this.stateValue.document, draft.elementId)?.name ?? '元素';
      this.commit({ selectedId: id, draft: null, notice: { tone: 'warning', message: `已改选其他元素，${name} 的未确认试算已放弃并回到原位置` } });
      return;
    }
    this.commit({ selectedId: id });
  }

  setMode(mode: LayoutMode) {
    if (mode === this.stateValue.mode) return;
    const base = mode === 'inspect'
      ? '检查模式已开启：拖动元素试算新位置，确认后才会写回布局'
      : mode === 'path'
        ? '路径模式已开启：入口到重点区域的访问路线已生成'
        : '编辑模式已开启';
    const notice: Notice = this.stateValue.draft
      ? { tone: 'warning', message: `${base} · 未确认的试算已自动放弃，布局恢复原样` }
      : { tone: 'info', message: base };
    this.commit({ mode, draft: null, notice });
  }

  previewMove(id: string, x: number, y: number) {
    if (this.stateValue.mode !== 'inspect' || !findElement(this.stateValue.document, id)) return;
    this.commit({ draft: { elementId: id, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } });
  }

  confirmDraft() {
    const draft = this.stateValue.draft;
    if (!draft) return;
    const document = applyMoveDraft(this.stateValue.document, draft);
    const name = findElement(document, draft.elementId)?.name ?? '元素';
    this.commitAndPersist({ document, draft: null, notice: { tone: 'success', message: `${name} 已落位到 (${draft.x.toFixed(1)}, ${draft.y.toFixed(1)})，检查结果与试算一致` } });
  }

  discardDraft(reason?: string) {
    const draft = this.stateValue.draft;
    if (!draft) return;
    const name = findElement(this.stateValue.document, draft.elementId)?.name ?? '元素';
    this.commit({ draft: null, notice: { tone: 'info', message: reason ?? `已放弃试算，${name} 回到原位置，布局未改动` } });
  }

  addElement(kind: ElementKind) {
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitGeometryChange({ document, selectedId: element.id, notice: { tone: 'success', message: `${element.name} 已加入场地` } });
  }

  removeSelected() {
    if (!this.stateValue.selectedId) return;
    const removed = findElement(this.stateValue.document, this.stateValue.selectedId);
    const elements = this.stateValue.document.elements.filter((element) => element.id !== this.stateValue.selectedId);
    this.commitGeometryChange({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, notice: { tone: 'info', message: `${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) } : element);
    this.commitGeometryChange({ document: { ...this.stateValue.document, elements } });
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } : element);
    this.commitGeometryChange({ document: { ...this.stateValue.document, elements } });
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    if (!id) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
    this.commitGeometryChange({ document: { ...this.stateValue.document, elements }, notice: { tone: 'info', message: '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    this.commitGeometryChange({ document: { ...this.stateValue.document, field: { width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) } }, notice: { tone: 'success', message: '场地尺寸已更新' } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitGeometryChange({ document, selectedId: 'stage-1', mode: 'edit', notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  private commitGeometryChange(patch: Partial<ExpoSketchState>) {
    const draft = this.stateValue.draft;
    if (!draft) {
      this.commitAndPersist(patch);
      return;
    }
    const notice: Notice = patch.notice
      ? { ...patch.notice, message: `${patch.notice.message} · 未确认的试算已放弃` }
      : { tone: 'info', message: '未确认的试算已放弃，布局恢复原位' };
    this.commitAndPersist({ ...patch, draft: null, notice });
  }

  private commitAndPersist(patch: Partial<ExpoSketchState>) {
    this.commit(patch);
    void this.persist();
  }

  private async persist() {
    try {
      await this.repository.save(this.stateValue.document);
      this.commit({ lastSavedAt: Date.now() });
    } catch {
      this.commit({ notice: { tone: 'error', message: '本地保存失败，当前编辑仍保留在页面中' } });
    }
  }

  private commit(patch: Partial<ExpoSketchState>) {
    const next = { ...this.stateValue, ...patch };
    const effectiveDocument = next.draft ? applyMoveDraft(next.document, next.draft) : next.document;
    const renderElements = toRenderElements(effectiveDocument);
    this.stateValue = {
      ...next,
      renderElements,
      selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null,
      analysis: analyzeLayout(effectiveDocument),
      draftSource: next.draft ? findElement(next.document, next.draft.elementId) : null,
    };
    this.listeners.forEach((listener) => listener());
  }
}
