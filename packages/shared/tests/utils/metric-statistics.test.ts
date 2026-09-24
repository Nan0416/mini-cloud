import { METRIC_STATISTICS } from '../../src/models/metric';
import { unitForStatistic } from '../../src/utils/metric-statistics';

describe('unitForStatistic', () => {
  it('counts observations in counts, whatever the series measures', () => {
    // 1500 samples of a Seconds metric are 1500 samples, not 25 minutes.
    expect(unitForStatistic('count', 'Seconds')).toBe('Count');
    expect(unitForStatistic('count', 'Bytes')).toBe('Count');
  });

  it('leaves every other statistic in the metric’s own unit', () => {
    for (const statistic of METRIC_STATISTICS.filter((candidate) => candidate !== 'count')) {
      expect(unitForStatistic(statistic, 'Bytes')).toBe('Bytes');
    }
  });
});
