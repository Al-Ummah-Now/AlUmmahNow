'use client';

import React from 'react';
import AnalyticsCardRTL from '../../AnalyticsCard/rtl';
import AnalyticsDashboard, { AnalyticsDashboardProps } from '..';

/**
 * RTL dashboard: same content and translations as the LTR dashboard, rendered
 * with the RTL card layout.
 */
const AnalyticsDashboardRTL: React.FC<Omit<AnalyticsDashboardProps, 'CardComponent'>> = (props) => (
  <AnalyticsDashboard {...props} CardComponent={AnalyticsCardRTL} />
);

export default AnalyticsDashboardRTL;
