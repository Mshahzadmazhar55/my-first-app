const express = require('express');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// GET /api/users/stats — get user stats
router.get('/stats', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    
    res.json({
      success: true,
      stats: {
        plan: user.plan,
        generationsToday: user.generationsToday,
        remainingGenerations: user.getRemainingGenerations() === Infinity ? 'unlimited' : user.getRemainingGenerations(),
        subscriptionStatus: user.subscriptionStatus
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
