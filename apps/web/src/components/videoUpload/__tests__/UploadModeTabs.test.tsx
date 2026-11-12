import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { UploadModeTabs, type UploadMode } from '../UploadModeTabs';

const labels = {
  group: 'How many videos',
  single: 'Single video',
  singleHint: 'One video with full details',
  batch: 'Batch upload',
  batchHint: 'Up to 15 videos at once',
};

function setup(mode: UploadMode = 'single', dir: 'ltr' | 'rtl' = 'ltr') {
  const onChange = jest.fn();
  const utils = render(
    <div dir={dir}>
      <UploadModeTabs mode={mode} onChange={onChange} labels={labels} />
    </div>,
  );
  return {
    ...utils,
    onChange,
    single: screen.getByRole('tab', { name: /^Single video/ }),
    batch: screen.getByRole('tab', { name: /^Batch upload/ }),
  };
}

describe('UploadModeTabs', () => {
  it('is a labelled tab list whose selected tab controls the panel', () => {
    const { single, batch } = setup('single');
    expect(screen.getByRole('tablist', { name: 'How many videos' })).toBeInTheDocument();
    expect(single).toHaveAttribute('aria-selected', 'true');
    expect(batch).toHaveAttribute('aria-selected', 'false');
    expect(single).toHaveAttribute('aria-controls', 'upload-mode-panel-single');
    expect(batch).not.toHaveAttribute('aria-controls');
    // Named by all its visible text, label first (WCAG 2.5.3 label in name; axe label-content-name-mismatch)
    expect(single).toHaveAccessibleName(/^Single video\s*, One video with full details$/);
    expect(batch).toHaveAccessibleName(/^Batch upload\s*, Up to 15 videos at once$/);
    expect(single).not.toHaveAttribute('aria-labelledby');
    expect(single).not.toHaveAttribute('aria-pressed');
  });

  it('gives each mode a label element the upload page names its panel with', () => {
    render(
      <>
        <UploadModeTabs mode="single" onChange={jest.fn()} labels={labels} />
        <div role="tabpanel" id="upload-mode-panel-single" aria-labelledby="upload-mode-tab-single-label" />
      </>,
    );
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Single video');
    expect(document.getElementById('upload-mode-tab-batch-label')).toHaveTextContent('Batch upload');
  });

  it('keeps only the selected tab in the tab order', () => {
    const { single, batch } = setup('batch');
    expect(batch).toHaveAttribute('tabindex', '0');
    expect(single).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click and ignores clicks on the selected tab', () => {
    const { single, batch, onChange } = setup('single');
    fireEvent.click(single);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(batch);
    expect(onChange).toHaveBeenCalledWith('batch');
  });

  it('moves focus with arrows, Home and End without selecting (manual activation)', () => {
    const { single, batch, onChange } = setup('single');
    single.focus();
    fireEvent.keyDown(single, { key: 'ArrowRight' });
    expect(batch).toHaveFocus();
    fireEvent.keyDown(batch, { key: 'ArrowRight' });
    expect(single).toHaveFocus();
    fireEvent.keyDown(single, { key: 'End' });
    expect(batch).toHaveFocus();
    fireEvent.keyDown(batch, { key: 'Home' });
    expect(single).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows reading direction in RTL: ArrowLeft goes to the next tab', () => {
    const { single, batch } = setup('single', 'rtl');
    single.focus();
    fireEvent.keyDown(single, { key: 'ArrowLeft' });
    expect(batch).toHaveFocus();
    fireEvent.keyDown(batch, { key: 'ArrowRight' });
    expect(single).toHaveFocus();
  });
});
