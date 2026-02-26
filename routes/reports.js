const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const ctrl = require('../controllers/reportController');

// All report routes are Director-only
router.get('/daily-revenue', auth, authorize('director'), ctrl.dailyRevenue);
router.get('/daily-profit', auth, authorize('director'), ctrl.dailyProfit);
router.get('/low-stock', auth, authorize('director'), ctrl.lowStock);
router.get('/top-services', auth, authorize('director'), ctrl.topServices);
router.get('/production-status', auth, authorize('director'), ctrl.productionStatus);
router.get('/service-vs-retail', auth, authorize('director'), ctrl.serviceVsRetail);
router.get('/summary', auth, authorize('director'), ctrl.salesSummary);
router.get('/sales', auth, authorize('director', 'manager'), ctrl.getSalesReports);
router.get('/stock', auth, authorize('director', 'manager'), ctrl.getStockReports);
router.get('/financials', auth, authorize('director'), ctrl.getFinancials);
router.get('/tax', auth, authorize('director'), ctrl.getTaxReport);

// Advanced Insights
router.get('/staff-performance', auth, authorize('director'), ctrl.staffPerformance);
router.get('/customer-insights', auth, authorize('director'), ctrl.customerInsights);
router.get('/category-margin', auth, authorize('director'), ctrl.categoryMargin);
router.get('/hourly-trend', auth, authorize('director'), ctrl.hourlyTrend);
router.get('/aggregated', auth, authorize('director'), ctrl.getAggregatedSales);

module.exports = router;
