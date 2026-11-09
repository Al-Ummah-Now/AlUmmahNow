/**
 * In-place editing primitives: InlineEditField, EditableImage,
 * UnsavedChangesBar and EditModeToggle.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { InlineEditField } from '../InlineEditField';
import { EditableImage } from '../EditableImage';
import { UnsavedChangesBar } from '../UnsavedChangesBar';
import { EditModeToggle } from '../EditModeToggle';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, isRTL: false, lang: 'en', locale: 'en', dir: 'ltr' }),
}));

// The crop dialog needs canvas; stand in with a button that "applies" the crop
jest.mock('@/components/ImageCropDialog', () => ({
  __esModule: true,
  default: ({ file, onApply, onCancel }: { file: File | null; onApply: (f: File) => void; onCancel: () => void }) =>
    file ? (
      <div role="dialog">
        <button onClick={() => onApply(new File(['cropped'], 'cropped.jpg', { type: 'image/jpeg' }))}>Apply crop</button>
        <button onClick={onCancel}>Cancel crop</button>
      </div>
    ) : null,
}));

function Field(props: Partial<React.ComponentProps<typeof InlineEditField>> & { initial?: string; onCommitSpy?: jest.Mock }) {
  const { initial = 'Noor Recitations', onCommitSpy, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <InlineEditField
      as="h1"
      label="Channel name"
      editable
      value={value}
      onCommit={(v) => {
        onCommitSpy?.(v);
        setValue(v);
      }}
      testId="name"
      inputTestId="name-input"
      {...rest}
    />
  );
}

describe('InlineEditField', () => {
  it('shows plain text, without a pencil, when edit mode is off', () => {
    render(<Field editable={false} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Recitations' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Channel name' })).not.toBeInTheDocument();
  });

  it('opens an input in place from the pencil, keeps the change with Enter and returns focus', () => {
    const spy = jest.fn();
    render(<Field onCommitSpy={spy} />);
    const pencil = screen.getByRole('button', { name: 'Edit Channel name' });
    fireEvent.click(pencil);
    const input = screen.getByRole('textbox', { name: 'Channel name' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Noor Academy' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('Noor Academy');
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Academy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Channel name' })).toHaveFocus();
  });

  it('opens when the text itself is clicked', () => {
    render(<Field />);
    fireEvent.click(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByRole('textbox', { name: 'Channel name' })).toBeInTheDocument();
  });

  it('restores the value with Escape and with Cancel', () => {
    const spy = jest.fn();
    render(<Field onCommitSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel name' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Recitations' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel name' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Noor Recitations' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks an empty required value with an inline error', () => {
    const spy = jest.fn();
    render(<Field required onCommitSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel name' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('alert')).toHaveTextContent("Channel name can't be empty");
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs custom validation and an outside invalid flag', () => {
    const spy = jest.fn();
    const { rerender } = render(<Field validate={(v) => (v.includes('!') ? 'No exclamation marks' : null)} onCommitSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel name' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hi!' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('No exclamation marks');

    rerender(<Field invalid status={<span>This handle is taken</span>} onCommitSpy={spy} />);
    expect(screen.getByText('This handle is taken')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports typing live, applies transform and shows a prefix', () => {
    const live = jest.fn();
    render(<Field initial="noor" as="p" prefix="@" label="Handle" transform={(v) => v.replace(/\s/g, '')} onDraftChange={live} />);
    expect(screen.getByTestId('name')).toHaveTextContent('@noor');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Handle' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Handle' }), { target: { value: 'noor academy' } });
    expect(live).toHaveBeenLastCalledWith('nooracademy');
    expect(screen.getByRole('textbox', { name: 'Handle' })).toHaveValue('nooracademy');
  });

  it('uses a textarea for multiline values; Enter adds a line, Ctrl+Enter finishes', () => {
    const spy = jest.fn();
    render(<Field as="p" multiline label="Description" initial="Line one" maxLength={500} onCommitSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }));
    const area = screen.getByRole('textbox', { name: 'Description' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(screen.getByText('8/500')).toBeInTheDocument();
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: 'Line one\nLine two' } });
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    expect(spy).toHaveBeenCalledWith('Line one\nLine two');
  });

  it('shows the empty prompt in edit mode and hides empty values otherwise', () => {
    const { rerender } = render(<Field initial="" as="p" label="Description" emptyText="Add a description" />);
    expect(screen.getByText('Add a description')).toBeInTheDocument();
    rerender(<Field initial="" as="p" label="Description" editable={false} />);
    expect(screen.queryByTestId('name')).not.toBeInTheDocument();
  });

  it('marks a changed value as edited', () => {
    render(<Field dirty />);
    expect(screen.getByTestId('name')).toHaveAttribute('data-dirty', 'true');
    expect(screen.getByText('Edited')).toBeInTheDocument();
  });

  it('closes an open field when edit mode is turned off', () => {
    const { rerender } = render(<Field />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel name' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    rerender(<Field editable={false} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('EditableImage', () => {
  it('renders only the image when not editable', () => {
    render(
      <EditableImage kind="cover" editable={false} label="Change banner" onUpload={jest.fn()} testId="banner">
        <img alt="cover" src="/c.jpg" />
      </EditableImage>
    );
    expect(screen.queryByRole('button', { name: 'Change banner' })).not.toBeInTheDocument();
  });

  it('picks a file, opens the crop step and uploads the cropped image', () => {
    const onUpload = jest.fn();
    render(
      <EditableImage kind="cover" editable label="Change banner" onUpload={onUpload} testId="banner">
        <img alt="cover" src="/c.jpg" />
      </EditableImage>
    );
    expect(screen.getByRole('button', { name: 'Change banner' })).toBeInTheDocument();
    const file = new File(['x'], 'banner.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('banner-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect((onUpload.mock.calls[0][0] as File).name).toBe('cropped.jpg');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not upload when the crop is cancelled, and is busy while uploading', () => {
    const onUpload = jest.fn();
    const { rerender } = render(
      <EditableImage kind="avatar" editable label="Change channel picture" onUpload={onUpload} testId="avatar">
        <span />
      </EditableImage>
    );
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel crop' }));
    expect(onUpload).not.toHaveBeenCalled();

    rerender(
      <EditableImage kind="avatar" editable uploading label="Change channel picture" onUpload={onUpload} testId="avatar">
        <span />
      </EditableImage>
    );
    const button = screen.getByRole('button', { name: 'Change channel picture' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('UnsavedChangesBar', () => {
  it('is hidden with nothing to save', () => {
    render(<UnsavedChangesBar count={0} onSave={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.queryByTestId('unsaved-changes-bar')).not.toBeInTheDocument();
  });

  it('counts changes and saves or discards them', () => {
    const onSave = jest.fn();
    const onDiscard = jest.fn();
    const { rerender } = render(<UnsavedChangesBar count={1} onSave={onSave} onDiscard={onDiscard} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 unsaved change');
    rerender(<UnsavedChangesBar count={3} onSave={onSave} onDiscard={onDiscard} />);
    expect(screen.getByRole('status')).toHaveTextContent('3 unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onSave).toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalled();
  });

  it('explains why Save is off, shows saving, saved and error states', () => {
    const { rerender } = render(<UnsavedChangesBar count={2} canSave={false} onSave={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Fix the highlighted fields to save');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    rerender(<UnsavedChangesBar count={2} saving onSave={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    rerender(<UnsavedChangesBar count={0} saved onSave={jest.fn()} onDiscard={jest.fn()} savedAction={<button type="button">View channel</button>} />);
    expect(screen.getByRole('status')).toHaveTextContent('Changes saved');
    expect(screen.getByRole("button", { name: "View channel" })).toBeInTheDocument();

    rerender(<UnsavedChangesBar count={1} error="Your changes were not saved. Try again." onSave={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByTestId('unsaved-changes-bar')).toHaveAttribute('data-state', 'error');
  });

  it('asks before leaving the page while there are changes', () => {
    const { unmount } = render(<UnsavedChangesBar count={1} onSave={jest.fn()} onDiscard={jest.fn()} />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    unmount();
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe('EditModeToggle', () => {
  it('is a switch that reports its state', () => {
    const onChange = jest.fn();
    render(<EditModeToggle on onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: /Edit mode/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
