import { render } from '@testing-library/react';
import { RowEventWrapper } from '../EventWrapper';

describe('RowEventWrapper', () => {
  it('makes a month/all-day event box a gridcell, so the row only owns cells', () => {
    const { container } = render(
      <div role="row">
        <RowEventWrapper type="date"><div className="rbc-event"><div role="button">Talk</div></div></RowEventWrapper>
      </div>,
    );
    expect(container.querySelector('.rbc-event')).toHaveAttribute('role', 'gridcell');
  });

  it('leaves time-grid events alone', () => {
    const { container } = render(<RowEventWrapper type="time"><div className="rbc-event" /></RowEventWrapper>);
    expect(container.querySelector('.rbc-event')).not.toHaveAttribute('role');
  });
});
