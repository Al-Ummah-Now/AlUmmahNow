import { fireEvent, render, screen } from '@testing-library/react';
import { compactNumber, formatDuration, formatInUnit, labelIndices, niceScale } from '@al-ummah/shared-types';
import { LineChart } from '../LineChart';

const base = {
  title: 'Views',
  format: (value: number) => new Intl.NumberFormat('en').format(value),
  summaryTemplate: '{title} from {from} to {to}. Highest: {peak} on {peakLabel}.',
  tableLabel: 'table',
  xHeading: 'Date',
  showTable: 'show',
  hideTable: 'hide',
};
const days = (values: number[]) => values.map((value, index) => ({ label: `Nov ${index + 1}`, value }));
/** ICU puts no-break spaces and marks between number and word; compare plain spaces. */
const plain = (text: string | null) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/[\u200e\u200f\u061c]/g, '');
const ticks = () => screen.getAllByTestId('chart-y-tick').map((tick) => plain(tick.textContent));

describe('chart scale', () => {
  it('starts at 0 with round, whole-number steps above the largest count', () => {
    expect(niceScale([6075], { integer: true }).ticks).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(niceScale([3], { integer: true }).ticks).toEqual([0, 1, 2, 3]);
    expect(niceScale([0], { integer: true }).ticks).toEqual([0, 1]);
  });

  it('uses the fixed top for shares', () => {
    expect(niceScale([0.4], { max: 1 }).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('formats compact numbers, durations and units in English and Arabic', () => {
    expect(compactNumber('en')(1234)).toBe('1.2K');
    expect(plain(compactNumber('ar')(1200))).toBe('١٫٢ ألف');
    expect(formatDuration('ar')(75)).toBe('١:١٥');
    expect(plain(formatInUnit('en', 'minute')(3.05))).toBe('3.1 min');
  });

  it('labels the first and last days and evenly spaced ones between', () => {
    expect(labelIndices(28)).toEqual([0, 7, 14, 20, 27]);
    expect(labelIndices(2)).toEqual([0, 1]);
  });
});

describe('LineChart', () => {
  it('draws a 0-based value axis with gridlines and compact ticks', () => {
    render(<LineChart {...base} locale="en" points={days([1200, 16490])} />);
    expect(ticks()).toEqual(['0', '5K', '10K', '15K', '20K']);
    expect(screen.getAllByTestId('chart-gridline')).toHaveLength(5);
    expect(screen.getAllByTestId('chart-x-tick').map((tick) => tick.textContent)).toEqual(['Nov 1', 'Nov 2']);
  });

  it('shows the date and the value in a tooltip under the pointer', () => {
    render(<LineChart {...base} locale="en" points={days([1, 2000])} />);
    const hit = screen.getByTestId('chart-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.mouseMove(hit, { clientX: 95 });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Nov 2');
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2,000');
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 2: 2,000');
    expect(screen.getByTestId('chart-crosshair')).toBeInTheDocument();
    fireEvent.mouseLeave(hit);
    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument();
  });

  it('keeps the point that was tapped until the next tap', () => {
    render(<LineChart {...base} locale="en" points={days([1, 2])} />);
    const hit = screen.getByTestId('chart-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.click(hit, { clientX: 90 });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 2: 2');
    fireEvent.click(hit, { clientX: 5 });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 1: 1');
  });

  it('reads the points with the arrow keys', () => {
    render(<LineChart {...base} locale="en" points={days([1, 2, 3])} />);
    const hit = screen.getByTestId('chart-hit');
    fireEvent.keyDown(hit, { key: 'Home' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 1: 1');
    fireEvent.keyDown(hit, { key: 'ArrowRight' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 2: 2');
    fireEvent.keyDown(hit, { key: 'End' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 3: 3');
  });

  it('describes the series for screen readers', () => {
    render(<LineChart {...base} locale="en" points={days([1, 7, 3])} />);
    expect(screen.getByRole('group', { name: 'Views from Nov 1 to Nov 3. Highest: 7 on Nov 2.' })).toBeInTheDocument();
  });

  it('keeps the axes and shows the empty text when every value is 0', () => {
    render(<LineChart {...base} locale="en" points={days([0, 0])} emptyText="No views in this period." />);
    expect(screen.getByTestId('chart-empty')).toHaveTextContent('No views in this period.');
    expect(ticks()).toEqual(['0', '1']);
    expect(screen.queryByTestId('chart-line')).not.toBeInTheDocument();
  });

  it('puts the value axis on the right, Arabic digits on the ticks, and runs time from the right in Arabic', () => {
    render(<LineChart {...base} locale="ar" points={days([1200, 3400])} />);
    expect(screen.getByTestId('chart-y-axis').parentElement).toHaveAttribute('dir', 'rtl');
    expect(ticks()).toContain('٢ ألف');
    const [first, last] = screen.getAllByTestId('chart-x-tick');
    expect(first.style.left).toBe('100%');
    expect(last.style.left).toBe('0%');
    const hit = screen.getByTestId('chart-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.mouseMove(hit, { clientX: 2 });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('Nov 2');
  });

  it('uses the given axis format, e.g. percent for retention', () => {
    const percent = new Intl.NumberFormat('en', { style: 'percent' });
    render(<LineChart {...base} locale="en" max={1} integer={false} axisFormat={(v) => percent.format(v)} points={days([1, 0.5])} />);
    expect(ticks()).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });
});
