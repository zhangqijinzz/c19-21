import { describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import type { LayoutRepository } from '../src/repository';
import type { LayoutDocument } from '../src/types';
import { ExpoSketchViewModel } from '../src/viewModel';

const fakeRepository = (initial: LayoutDocument | null = null): LayoutRepository => ({
  load: vi.fn(async () => initial ?? createStarterDocument()),
  save: vi.fn(async (_document) => {}),
});

describe('ExpoSketchViewModel', () => {
  it('initializes and updates the selected layout', async () => {
    const repository = fakeRepository();
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('ready');
    const count = vm.state.document.elements.length;
    vm.addElement('booth');
    expect(vm.state.document.elements).toHaveLength(count + 1);
    expect(vm.state.selectedId).toContain('booth-');
  });

  it('updates analysis immediately after moving an element into an overlap', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.moveElement('stage-1', 4.5, 2.5);
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('recovers the example if repository loading fails', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => { throw new Error('bad storage'); }), save: vi.fn(async () => {}) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    expect(vm.state.phase).toBe('error');
    expect(vm.state.document.title).toContain('春日创意市集');
  });

  it('shows a save error without dropping the working document', async () => {
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save: vi.fn(async () => { throw new Error('quota'); }) };
    const vm = new ExpoSketchViewModel(repository);
    await vm.initialize();
    vm.addElement('stage');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.state.document.elements.some((element) => element.kind === 'stage' && element.id.startsWith('stage-'))).toBe(true);
    expect(vm.state.notice.tone).toBe('error');
  });

  it('ignores invalid dimensions instead of corrupting the working selection', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    const before = vm.state.document.elements[0].width;
    vm.resizeSelected(0, 0);
    expect(vm.state.document.elements[0].width).toBe(before);
  });

  describe('inspect-mode move trial', () => {
    it('keeps the document unchanged and unsaved while previewing a move', () => {
      const repository = fakeRepository();
      const save = repository.save as ReturnType<typeof vi.fn>;
      const vm = new ExpoSketchViewModel(repository);
      const before = vm.state.document.elements.find((element) => element.id === 'stage-1');
      vm.setMode('inspect');
      vm.moveElement('stage-1', 4.5, 2.5);
      const after = vm.state.document.elements.find((element) => element.id === 'stage-1');
      expect(after?.x).toBe(before?.x);
      expect(after?.y).toBe(before?.y);
      expect(vm.state.trial).toEqual({ elementId: 'stage-1', x: 4.5, y: 2.5 });
      // 画布渲染跟随试算位置
      expect(vm.state.selectedElement?.x).toBe(4.5);
      expect(save).not.toHaveBeenCalled();
    });

    it('derives overlaps, bounds and channels for the trial position', () => {
      const vm = new ExpoSketchViewModel(fakeRepository());
      vm.setMode('inspect');
      expect(vm.state.analysis.overlaps.length).toBe(0);
      vm.previewMove('stage-1', 4.5, 2.5);
      expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
    });

    it('commits and persists only after confirming the trial', () => {
      const repository = fakeRepository();
      const save = repository.save as ReturnType<typeof vi.fn>;
      const vm = new ExpoSketchViewModel(repository);
      vm.setMode('inspect');
      vm.previewMove('stage-1', 3, 3);
      vm.confirmTrial();
      const placed = vm.state.document.elements.find((element) => element.id === 'stage-1');
      expect(placed?.x).toBe(3);
      expect(placed?.y).toBe(3);
      expect(vm.state.trial).toBeNull();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('restores the original layout when the trial is discarded', () => {
      const repository = fakeRepository();
      const save = repository.save as ReturnType<typeof vi.fn>;
      const vm = new ExpoSketchViewModel(repository);
      const origin = vm.state.document.elements.find((element) => element.id === 'stage-1');
      vm.setMode('inspect');
      vm.previewMove('stage-1', -2, -2);
      expect(vm.state.analysis.bounds.length).toBeGreaterThan(0);
      vm.discardTrial();
      const restored = vm.state.document.elements.find((element) => element.id === 'stage-1');
      expect(restored?.x).toBe(origin?.x);
      expect(vm.state.trial).toBeNull();
      expect(vm.state.analysis.bounds.length).toBe(0);
      expect(save).not.toHaveBeenCalled();
      expect(vm.state.notice.tone).toBe('warning');
    });

    it('shows identical analysis for the trial and the confirmed placement', () => {
      const vm = new ExpoSketchViewModel(fakeRepository());
      vm.setMode('inspect');
      vm.previewMove('stage-1', 2.4, 1.1);
      const trialAnalysis = vm.state.analysis;
      vm.confirmTrial();
      expect(vm.state.analysis).toEqual(trialAnalysis);
    });

    it('auto-discards the trial with a clear notice when switching modes', () => {
      const vm = new ExpoSketchViewModel(fakeRepository());
      vm.setMode('inspect');
      vm.previewMove('stage-1', -2, -2);
      vm.setMode('edit');
      expect(vm.state.trial).toBeNull();
      expect(vm.state.notice.tone).toBe('warning');
      expect(vm.state.notice.message).toContain('放弃');
      // 布局确实没有被试算改动
      expect(vm.state.document.elements.find((element) => element.id === 'stage-1')?.x).toBe(10);
    });

    it('auto-discards the trial with a clear notice when selecting another element', () => {
      const vm = new ExpoSketchViewModel(fakeRepository());
      vm.setMode('inspect');
      vm.previewMove('stage-1', -2, -2);
      vm.selectElement('booth-1');
      expect(vm.state.trial).toBeNull();
      expect(vm.state.selectedId).toBe('booth-1');
      expect(vm.state.notice.tone).toBe('warning');
      expect(vm.state.notice.message).toContain('放弃');
    });

    it('explains the abandoned trial when a drag switches to another element', () => {
      const vm = new ExpoSketchViewModel(fakeRepository());
      vm.setMode('inspect');
      vm.previewMove('stage-1', -2, -2);
      // 在另一元素上按下并拖动：原试算被放弃，新试算建立
      vm.selectElement('booth-1', true);
      vm.previewMove('booth-1', 20, 10);
      expect(vm.state.trial?.elementId).toBe('booth-1');
      expect(vm.state.notice.message).toContain('已放弃');
      // 若只点按没拖动，抬手时也要补发放弃提示
      vm.discardTrial();
      vm.previewMove('stage-1', -2, -2);
      vm.selectElement('booth-1', true);
      vm.notifyDragEnd();
      expect(vm.state.trial).toBeNull();
      expect(vm.state.notice.message).toContain('已放弃');
    });

    it('still moves directly and persists in edit mode', () => {
      const repository = fakeRepository();
      const save = repository.save as ReturnType<typeof vi.fn>;
      const vm = new ExpoSketchViewModel(repository);
      vm.moveElement('stage-1', 5, 5);
      expect(vm.state.document.elements.find((element) => element.id === 'stage-1')?.x).toBe(5);
      expect(vm.state.trial).toBeNull();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
