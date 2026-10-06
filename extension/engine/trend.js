/**
 * Hidden Winner Finder - Trend Analysis Engine
 * Evaluates momentum, seasonality, and multi-period trajectory.
 *
 * Status:
 *  🔥 Rising
 *  ➡️ Stable
 *  📉 Declining
 */

const TrendAnalyzer = {
  /**
   * Analyzes trend signals.
   * @param {Object} options
   */
  analyze(options = {}) {
    const {
      status = 'rising', // 'rising' | 'stable' | 'declining'
      change30d = 24,    // percentage change (+24%)
      change90d = 68,    // percentage change (+68%)
      seasonality = 'Evergreen with Q4 Spike',
      historyPoints = [42, 51, 58, 67, 82, 94]
    } = options;

    let symbol = '🔥';
    let label = 'Rising';
    let badgeClass = 'trend-rising';
    let color = '#ef4444';

    if (status === 'stable' || (change30d >= -5 && change30d <= 10 && status !== 'rising')) {
      symbol = '➡️';
      label = 'Stable';
      badgeClass = 'trend-stable';
      color = '#38bdf8';
    } else if (status === 'declining' || change30d < -5) {
      symbol = '📉';
      label = 'Declining';
      badgeClass = 'trend-declining';
      color = '#94a3b8';
    }

    const t30Formatted = change30d >= 0
      ? `↑ Increasing (+${change30d}%)`
      : `↓ Decreasing (${change30d}%)`;

    const t90Formatted = change90d >= 50
      ? `↑ Strong Growth (+${change90d}%)`
      : change90d >= 0
        ? `↑ Steady Growth (+${change90d}%)`
        : `↓ Contracting (${change90d}%)`;

    return {
      status: label,
      symbol,
      fullLabel: `${symbol} ${label}`,
      color,
      badgeClass,
      score: status === 'rising' ? 92 : status === 'stable' ? 68 : 34,
      days30: {
        raw: change30d,
        label: '30 Days',
        trajectory: t30Formatted
      },
      days90: {
        raw: change90d,
        label: '90 Days',
        trajectory: t90Formatted
      },
      seasonality,
      historyPoints, // 6 data points for mini sparkline
      summary: `${symbol} ${label}: ${t30Formatted} over last 30 days and ${t90Formatted} over 90 days.`
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = TrendAnalyzer;
}
