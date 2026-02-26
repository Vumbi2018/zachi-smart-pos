const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const authenticateToken = require('../middleware/auth'); // Assuming this exists

// All routes require authentication
router.use(authenticateToken);

router.get('/unread', NotificationController.getUnread);
router.put('/:id/read', NotificationController.markRead);
router.put('/read-all', NotificationController.markAllRead);

// Internal use only - usually called by other controllers, but exposing for testing if needed
// router.post('/', NotificationController.createNotification); 

module.exports = router;
