import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { dragHasFiles, firstDroppedFile, useFileDropZone } from '../useFileDropZone';

const png = new File(['x'], 'a.png', { type: 'image/png' });
/** jsdom has no DataTransfer: the shape the handlers read */
const files = (...f: File[]) => ({ types: ['Files'], files: f });
const dragging = { types: ['Files'], files: [] as File[] }; // dragover: files hidden until drop
const text = { types: ['text/plain'], files: [] as File[] };

function Zone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const { isDragOver, dropZoneProps } = useFileDropZone({ onFile, disabled });
  return (
    <div data-testid="zone" data-over={String(isDragOver)} {...dropZoneProps}>
      <span data-testid="child">child</span>
    </div>
  );
}

describe('dragHasFiles / firstDroppedFile', () => {
  it('reads files from the drag types (dragover) or the file list (drop)', () => {
    expect(dragHasFiles(dragging as unknown as DataTransfer)).toBe(true);
    expect(dragHasFiles({ types: [], files: [png] } as unknown as DataTransfer)).toBe(true);
    expect(dragHasFiles(text as unknown as DataTransfer)).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
    expect(firstDroppedFile(files(png, new File(['y'], 'b.jpg')) as unknown as DataTransfer)).toBe(png);
    expect(firstDroppedFile(dragging as unknown as DataTransfer)).toBeNull();
  });
});

describe('useFileDropZone', () => {
  it('a dropped file goes to onFile, from e.dataTransfer (not e.target.files)', () => {
    const onFile = jest.fn();
    render(<Zone onFile={onFile} />);
    const zone = screen.getByTestId('zone');
    const over = fireEvent.dragOver(zone, { dataTransfer: dragging });
    expect(over).toBe(false); // dragover cancelled: the zone is a drop target
    const drop = fireEvent.drop(zone, { dataTransfer: files(png) });
    expect(drop).toBe(false); // the browser does not open the image
    expect(onFile).toHaveBeenCalledWith(png);
  });

  it('shows a drag-over state that survives crossing children and clears on leave and drop', () => {
    render(<Zone onFile={() => {}} />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragEnter(zone, { dataTransfer: dragging });
    expect(zone).toHaveAttribute('data-over', 'true');
    fireEvent.dragEnter(screen.getByTestId('child'), { dataTransfer: dragging });
    fireEvent.dragLeave(zone, { dataTransfer: dragging }); // left the zone for its child
    expect(zone).toHaveAttribute('data-over', 'true');
    fireEvent.dragLeave(screen.getByTestId('child'), { dataTransfer: dragging });
    expect(zone).toHaveAttribute('data-over', 'false');
    fireEvent.dragEnter(zone, { dataTransfer: dragging });
    fireEvent.drop(zone, { dataTransfer: files(png) });
    expect(zone).toHaveAttribute('data-over', 'false');
  });

  it('ignores drags of text or links (left to the page)', () => {
    const onFile = jest.fn();
    render(<Zone onFile={onFile} />);
    const zone = screen.getByTestId('zone');
    expect(fireEvent.dragOver(zone, { dataTransfer: text })).toBe(true);
    fireEvent.dragEnter(zone, { dataTransfer: text });
    expect(zone).toHaveAttribute('data-over', 'false');
    fireEvent.drop(zone, { dataTransfer: text });
    expect(onFile).not.toHaveBeenCalled();
  });

  it('while disabled a drop is cancelled but nothing is used', () => {
    const onFile = jest.fn();
    render(<Zone onFile={onFile} disabled />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragEnter(zone, { dataTransfer: dragging });
    expect(zone).toHaveAttribute('data-over', 'false');
    expect(fireEvent.drop(zone, { dataTransfer: files(png) })).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('a file dropped outside the zone is cancelled (no navigation to the image) while mounted', () => {
    const { unmount } = render(<Zone onFile={() => {}} />);
    const dropOutside = () => {
      const e = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      e.dataTransfer = files(png);
      act(() => { document.body.dispatchEvent(e); });
      return e.defaultPrevented;
    };
    expect(dropOutside()).toBe(true);
    unmount();
    expect(dropOutside()).toBe(false);
  });
});
