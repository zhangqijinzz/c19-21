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
});

describe('inspect mode move trials', () => {
  const setup = () => {
    const save = vi.fn(async (_document: LayoutDocument) => {});
    const repository: LayoutRepository = { load: vi.fn(async () => createStarterDocument()), save };
    const vm = new ExpoSketchViewModel(repository);
    vm.setMode('inspect');
    return { vm, save };
  };

  it('previews a move without touching or saving the layout', () => {
    const { vm, save } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    expect(vm.state.draft).toEqual({ elementId: 'stage-1', x: 4.5, y: 2.5 });
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 10, y: 1.5 });
    expect(save).not.toHaveBeenCalled();
    expect(vm.state.analysis.overlaps.length).toBeGreaterThan(0);
  });

  it('renders the trial position while keeping the original spot as draft source', () => {
    const { vm } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    expect(vm.state.renderElements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 4.5, y: 2.5 });
    expect(vm.state.draftSource).toMatchObject({ x: 10, y: 1.5 });
  });

  it('produces exactly the trial analysis once the move is confirmed', () => {
    const { vm, save } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    const trial = vm.state.analysis;
    vm.confirmDraft();
    expect(vm.state.draft).toBeNull();
    expect(vm.state.analysis).toEqual(trial);
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 4.5, y: 2.5 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 4.5, y: 2.5 });
  });

  it('restores the original view when the trial is discarded', () => {
    const { vm, save } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    vm.discardDraft();
    expect(vm.state.draft).toBeNull();
    expect(vm.state.analysis.overlaps).toHaveLength(0);
    expect(vm.state.renderElements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 10, y: 1.5 });
    expect(save).not.toHaveBeenCalled();
    expect(vm.state.notice.message).toContain('已放弃试算');
  });

  it('auto-discards an unconfirmed trial with a clear notice when switching modes', () => {
    const { vm, save } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    vm.setMode('edit');
    expect(vm.state.draft).toBeNull();
    expect(vm.state.notice.tone).toBe('warning');
    expect(vm.state.notice.message).toContain('试算');
    expect(vm.state.document.elements.find((element) => element.id === 'stage-1')).toMatchObject({ x: 10, y: 1.5 });
    expect(save).not.toHaveBeenCalled();
  });

  it('auto-discards an unconfirmed trial when selecting another element', () => {
    const { vm } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    vm.selectElement('booth-1');
    expect(vm.state.draft).toBeNull();
    expect(vm.state.selectedId).toBe('booth-1');
    expect(vm.state.notice.tone).toBe('warning');
    expect(vm.state.notice.message).toContain('试算');
  });

  it('keeps the trial alive when reselecting the same element', () => {
    const { vm } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    vm.selectElement('stage-1');
    expect(vm.state.draft).toEqual({ elementId: 'stage-1', x: 4.5, y: 2.5 });
  });

  it('ignores preview moves outside inspect mode', () => {
    const vm = new ExpoSketchViewModel(fakeRepository());
    vm.previewMove('stage-1', 4.5, 2.5);
    expect(vm.state.draft).toBeNull();
  });

  it('drops the trial when another geometry change is committed', () => {
    const { vm } = setup();
    vm.previewMove('stage-1', 4.5, 2.5);
    vm.rotateSelected();
    expect(vm.state.draft).toBeNull();
    expect(vm.state.notice.message).toContain('试算');
  });
});
