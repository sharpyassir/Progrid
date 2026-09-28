import { describe, expect, it } from 'vitest';
import { unionLength, uptime } from './report-data';

const t = (min: number) => new Date(Date.UTC(2026, 7, 1) + min * 60_000);

describe('report uptime', () => {
  it('merges overlapping spans', () => {
    expect(unionLength([{ from: 0, to: 10 }, { from: 5, to: 15 }, { from: 20, to: 30 }])).toBe(25);
    expect(unionLength([])).toBe(0);
  });

  it('computes uptime from critical alerts clipped to the window', () => {
    const window = { from: t(0).getTime(), to: t(1000).getTime() };
    const r = uptime(window, [{ startsAt: t(-50), endsAt: t(10) }, { startsAt: t(5), endsAt: t(20) }, { startsAt: t(990), endsAt: null }]);
    expect(r.observedMinutes).toBe(1000);
    expect(r.downtimeMinutes).toBe(30);
    expect(r.uptimePercent).toBe(97);
  });

  it('reports no uptime for an asset without observed time', () => {
    expect(uptime({ from: 5, to: 5 }, []).uptimePercent).toBeNull();
  });
});
