import { createElement, createStarterDocument, analyzeLayout, findElement, getBoundingBox, normalizeRotation } from './domain';
import type { LayoutRepository } from './repository';
import type { Analysis, ElementKind, LayoutDocument, LayoutMode, MoveTrial, Notice, RenderElement, TrialOrigin, ViewPhase } from './types';

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
  trial: MoveTrial | null;
  trialOrigin: TrialOrigin | null;
}

const roundToTenth = (value: number) => Number(value.toFixed(1));

const applyMoveTrial = (document: LayoutDocument, trial: MoveTrial | null): LayoutDocument => {
  if (!trial) return document;
  return { ...document, elements: document.elements.map((element) => element.id === trial.elementId ? { ...element, x: trial.x, y: trial.y } : element) };
};

const toRenderElements = (document: LayoutDocument): RenderElement[] => document.elements.map((element) => {
  const box = getBoundingBox(element);
  return { ...element, displayWidth: box.width, displayHeight: box.height, occupiedArea: Number((box.width * box.height).toFixed(1)) };
});

const starter = createStarterDocument();
const starterRenderElements = toRenderElements(starter);

type Listener = () => void;

export class ExpoSketchViewModel {
  private listeners = new Set<Listener>();
  private pendingReplacementId: string | null = null;
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
    trial: null,
    trialOrigin: null,
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

  selectElement(id: string, fromDrag = false) {
    if (id === this.stateValue.selectedId && !this.stateValue.trial) return;
    const previousTrial = this.stateValue.trial;
    if (previousTrial && previousTrial.elementId !== id) {
      // 拖动手势起始时先静默切换，若本次手势真的产生试算，由 previewMove 补上替换提示；
      // 只是点按没有拖动，则由 notifyDragEnd 补发放弃提示
      const patch: Partial<ExpoSketchState> = { selectedId: id, trial: null, trialOrigin: null };
      if (!fromDrag) patch.notice = { tone: 'warning', message: '已放弃未确认的试算，并选中新的元素' };
      this.pendingReplacementId = fromDrag ? previousTrial.elementId : null;
      this.commit(patch);
      return;
    }
    this.pendingReplacementId = null;
    this.commit({ selectedId: id });
  }

  /** FieldCanvas 在指针抬起时调用：为"只点按未拖动"的情况补发试算放弃提示 */
  notifyDragEnd() {
    if (!this.pendingReplacementId) return;
    const replacedName = findElement(this.stateValue.document, this.pendingReplacementId)?.name ?? '元素';
    this.pendingReplacementId = null;
    if (!this.stateValue.trial) {
      this.commit({ notice: { tone: 'warning', message: `已放弃 ${replacedName} 未确认的试算，原布局未改动` } });
    }
  }

  setMode(mode: LayoutMode) {
    if (mode === this.stateValue.mode) return;
    const abandonedTrial = this.stateValue.trial;
    this.pendingReplacementId = null;
    this.commit({
      mode,
      trial: null,
      trialOrigin: null,
      notice: {
        tone: abandonedTrial ? 'warning' : 'info',
        message: abandonedTrial
          ? '已放弃未确认的试算：原布局未改动'
          : mode === 'inspect'
            ? '检查模式已开启：拖动元素可试算挪动后的风险，确认后才会写回布局'
            : mode === 'path'
              ? '路径模式已开启：入口到重点区域的访问路线已生成'
              : '编辑模式已开启',
      },
    });
  }

  addElement(kind: ElementKind) {
    const abandoned = this.abandonTrialNotice();
    const element = createElement(kind, this.stateValue.document.elements.length, this.stateValue.document.field);
    const document = { ...this.stateValue.document, elements: [...this.stateValue.document.elements, element] };
    this.commitAndPersist({ document, selectedId: element.id, notice: { tone: 'success', message: `${abandoned ? '已放弃未确认的试算。' : ''}${element.name} 已加入场地` } });
  }

  removeSelected() {
    if (!this.stateValue.selectedId) return;
    const removed = findElement(this.stateValue.document, this.stateValue.selectedId);
    const abandoned = this.abandonTrialNotice();
    const elements = this.stateValue.document.elements.filter((element) => element.id !== this.stateValue.selectedId);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, selectedId: elements[0]?.id ?? null, notice: { tone: 'info', message: `${abandoned ? '已放弃未确认的试算。' : ''}${removed?.name ?? '元素'} 已移除` } });
  }

  moveElement(id: string, x: number, y: number) {
    // 检查模式的拖动一律走试算，避免直接改写布局
    if (this.stateValue.mode === 'inspect') {
      this.previewMove(id, x, y);
      return;
    }
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, x: roundToTenth(x), y: roundToTenth(y) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  /** 检查模式专用：仅更新试算位置与派生分析，不触碰已保存的布局 */
  previewMove(id: string, x: number, y: number) {
    const current = this.stateValue.trial;
    const replacingAnother = this.pendingReplacementId && (!current || current.elementId === id);
    const replacementName = replacingAnother ? findElement(this.stateValue.document, this.pendingReplacementId as string)?.name ?? '元素' : null;
    this.pendingReplacementId = null;
    const origin = current?.elementId === id
      ? this.stateValue.trialOrigin
      : (() => { const base = findElement(this.stateValue.document, id); return base ? { x: base.x, y: base.y, width: getBoundingBox(base).width, height: getBoundingBox(base).height } : null; })();
    this.commit({
      trial: { elementId: id, x: roundToTenth(x), y: roundToTenth(y) },
      trialOrigin: origin,
      notice: replacementName
        ? { tone: 'warning', message: `已放弃 ${replacementName} 未确认的试算，原布局未改动；当前正在试算新元素` }
        : { tone: 'info', message: '试算中：结论基于挪动后的布局计算，确认后才会写回，放弃可恢复原位' },
    });
  }

  /** 确认试算：把试算坐标写入布局并持久化，与试算结论由同一份数据算出 */
  confirmTrial() {
    const trial = this.stateValue.trial;
    if (!trial) return;
    const element = findElement(this.stateValue.document, trial.elementId);
    const document = applyMoveTrial(this.stateValue.document, trial);
    this.pendingReplacementId = null;
    this.commitAndPersist({ document, trial: null, trialOrigin: null, notice: { tone: 'success', message: `${element?.name ?? '元素'} 的试算位置已确认并保存` } });
  }

  /** 放弃试算：恢复到文档中的原位置，分析随之复原 */
  discardTrial() {
    if (!this.stateValue.trial) return;
    const element = findElement(this.stateValue.document, this.stateValue.trial.elementId);
    this.pendingReplacementId = null;
    this.commit({ trial: null, trialOrigin: null, notice: { tone: 'warning', message: `已放弃试算，${element?.name ?? '元素'} 已恢复到原位置` } });
  }

  resizeSelected(width: number, height: number) {
    const id = this.stateValue.selectedId;
    if (!id || width <= 0 || height <= 0) return;
    const abandoned = this.abandonTrialNotice();
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, width: roundToTenth(width), height: roundToTenth(height) } : element);
    const patch: Partial<ExpoSketchState> = { document: { ...this.stateValue.document, elements } };
    if (abandoned) patch.notice = { tone: 'warning', message: '尺寸修改已保存，未确认的试算已放弃' };
    this.commitAndPersist(patch);
  }

  rotateSelected() {
    const id = this.stateValue.selectedId;
    if (!id) return;
    const abandoned = this.abandonTrialNotice();
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, rotation: normalizeRotation(element.rotation + 90) } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements }, notice: { tone: abandoned ? 'warning' : 'info', message: abandoned ? '已旋转并保存，未确认的试算已放弃' : '方向已旋转 90°' } });
  }

  renameSelected(name: string) {
    const id = this.stateValue.selectedId;
    if (!id || !name.trim()) return;
    const elements = this.stateValue.document.elements.map((element) => element.id === id ? { ...element, name: name.trim() } : element);
    this.commitAndPersist({ document: { ...this.stateValue.document, elements } });
  }

  resizeField(width: number, height: number) {
    if (width < 12 || height < 10) return;
    const abandoned = this.abandonTrialNotice();
    this.commitAndPersist({ document: { ...this.stateValue.document, field: { width: roundToTenth(width), height: roundToTenth(height) } }, notice: { tone: 'success', message: `${abandoned ? '已放弃未确认的试算。' : ''}场地尺寸已更新` } });
  }

  renameProject(title: string) {
    if (!title.trim()) return;
    this.commitAndPersist({ document: { ...this.stateValue.document, title: title.trim() } });
  }

  resetExample() {
    const document = createStarterDocument();
    this.commitAndPersist({ document, selectedId: 'stage-1', mode: 'edit', trial: null, trialOrigin: null, notice: { tone: 'success', message: '已恢复示例布局' } });
  }

  private abandonTrialNotice(): boolean {
    const hadTrial = !!this.stateValue.trial;
    if (hadTrial) this.commit({ trial: null, trialOrigin: null });
    return hadTrial;
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
    // 试算时，画布与检查结论均基于"试算后的布局"派生；document 保持原样不写回
    const viewDocument = applyMoveTrial(next.document, next.trial);
    const renderElements = toRenderElements(viewDocument);
    this.stateValue = { ...next, renderElements, selectedElement: renderElements.find((element) => element.id === next.selectedId) ?? null, analysis: analyzeLayout(viewDocument) };
    this.listeners.forEach((listener) => listener());
  }
}
