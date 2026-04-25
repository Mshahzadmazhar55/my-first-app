const express = require('express');
const Xendit = require('xendit-node');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// Initialize Xendit
const xenditClient = new Xendit({
  secretKey: process.env.XENDIT_SECRET_KEY
});

const { Invoice } = xenditClient;
const invoiceSpecificOptions = {};
const i = new Invoice(invoiceSpecificOptions);

// POST /api/payments/create-checkout — create Xendit invoice for subscription
router.post('/create-checkout', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    // Create Xendit invoice for monthly subscription
    const invoice = await i.createInvoice({
      externalID: `propflow-pro-${user._id}-${Date.now()}`,
      amount: 29, // $29/month for Pro plan
      payerEmail: user.email,
      description: 'PropFlow Pro Monthly Subscription',
      currency: 'USD',
      successRedirectURL: `${process.env.FRONTEND_URL}/dashboard?upgraded=true`,
      failureRedirectURL: `${process.env.FRONTEND_URL}/pricing?failed=true`,
      customer: {
        givenNames: user.name,
        email: user.email
      },
      customerNotificationPreference: {
        invoiceCreated: ['email'],
        invoicePaid: ['email']
      },
      items: [{
        name: 'PropFlow Pro Plan',
        quantity: 1,
        price: 29,
        category: 'Subscription'
      }]
    });

    // Save Xendit customer ID
    if (!user.xenditCustomerId) {
      user.xenditCustomerId = invoice.id;
      await user.save();
    }

    res.json({ 
      success: true, 
      url: invoice.invoiceUrl 
    });
  } catch (err) { 
    console.error('[XENDIT ERROR]', err);
    next(err); 
  }
});

// POST /api/payments/portal — Simple billing management
router.post('/portal', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user.xenditCustomerId) {
      return res.status(400).json({ 
        success: false, 
        message: 'No billing account found.' 
      });
    }

    // For now, redirect to dashboard with billing info
    // Xendit doesn't have a built-in billing portal like Stripe
    res.json({ 
      success: true, 
      url: `${process.env.FRONTEND_URL}/dashboard?billing=true` 
    });
  } catch (err) { 
    next(err); 
  }
});

// GET /api/payments/status — get current subscription status
router.get('/status', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      success: true,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd
    });
  } catch (err) { 
    next(err); 
  }
});

// POST /api/payments/webhook — Xendit webhook handler
router.post('/webhook', async (req, res) => {
  try {
    const callbackToken = req.headers['x-callback-token'];
    
    // Verify webhook authenticity
    if (callbackToken !== process.env.XENDIT_WEBHOOK_SECRET) {
      console.error('[WEBHOOK] Invalid callback token');
      return res.status(401).send('Unauthorized');
    }

    const event = req.body;
    console.log('[XENDIT WEBHOOK]', event.status, event.external_id);

    // Handle invoice paid event
    if (event.status === 'PAID') {
      // Extract user ID from external_id (format: propflow-pro-{userId}-{timestamp})
      const externalId = event.external_id;
      const userIdMatch = externalId.match(/propflow-pro-([a-f0-9]+)-/);
      
      if (userIdMatch && userIdMatch[1]) {
        const userId = userIdMatch[1];
        const user = await User.findById(userId);
        
        if (user) {
          user.plan = 'pro';
          user.subscriptionStatus = 'active';
          user.xenditSubscriptionId = event.id;
          // Set subscription end to 30 days from now
          user.subscriptionCurrentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await user.save();
          
          console.log(`[WEBHOOK] User ${user.email} upgraded to Pro`);
        }
      }
    }

    // Handle invoice expired/failed
    if (event.status === 'EXPIRED' || event.status === 'FAILED') {
      const externalId = event.external_id;
      const userIdMatch = externalId.match(/propflow-pro-([a-f0-9]+)-/);
      
      if (userIdMatch && userIdMatch[1]) {
        const userId = userIdMatch[1];
        const user = await User.findById(userId);
        
        if (user && user.plan === 'pro') {
          user.subscriptionStatus = 'past_due';
          await user.save();
          console.log(`[WEBHOOK] Payment failed for ${user.email}`);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
