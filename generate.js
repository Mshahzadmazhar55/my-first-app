const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const Document = require('../models/Document');
const User = require('../models/User');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Strict rate limit for generation endpoint
const genLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Generation rate limit exceeded. Please wait.' }
});

// ── PROPOSAL GENERATION
router.post('/proposal', protect, genLimiter, [
  body('yourName').trim().notEmpty().isLength({ max: 100 }),
  body('profession').trim().notEmpty().isLength({ max: 100 }),
  body('client').trim().notEmpty().isLength({ max: 100 }),
  body('project').trim().notEmpty().isLength({ max: 1000 }),
  body('budget').trim().notEmpty().isLength({ max: 50 }),
  body('timeline').trim().notEmpty().isLength({ max: 50 }),
  body('deliverables').optional().trim().isLength({ max: 500 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('years').optional().isNumeric()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Check usage limit
    const user = await User.findById(req.user._id);
    if (!user.canGenerate()) {
      return res.status(429).json({
        success: false,
        message: 'Daily limit reached (3/day on free plan). Upgrade to Pro for unlimited.',
        upgrade: true,
        limit: true
      });
    }

    const { yourName, profession, client, project, budget, timeline, deliverables, email, years } = req.body;
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const validUntil = new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const systemPrompt = `You are a world-class freelance business writer who writes proposals that win contracts. 
Your proposals are professional, confident, persuasive, and specific. 
You always write in clean structured text with clearly labeled sections.
NEVER use markdown formatting (no **, no #, no backticks). 
ALWAYS use exactly the section labels provided.`;

    const userPrompt = `Write a winning freelance project proposal with these exact details:

FREELANCER: ${yourName} — ${profession} with ${years || '3'} years of experience
CLIENT: ${client}
PROJECT: ${project}
BUDGET: ${budget}
TIMELINE: ${timeline}
DELIVERABLES: ${deliverables || 'Based on project scope'}
TODAY: ${today}
VALID UNTIL: ${validUntil}

Output ONLY these 7 labeled sections, in this exact format:

EXECUTIVE_SUMMARY: [2-3 compelling sentences showing deep understanding of the client's problem and your solution]

PROPOSED_SOLUTION: [3-4 sentences on your methodology and approach tailored to this client]

DELIVERABLES:
- [specific deliverable 1]
- [specific deliverable 2]
- [specific deliverable 3]
- [specific deliverable 4]
- [specific deliverable 5]

TIMELINE:
- [Phase 1: specific work — timeframe]
- [Phase 2: specific work — timeframe]
- [Phase 3: specific work — timeframe]

INVESTMENT: [2 sentences presenting the investment confidently with payment terms — 50% upfront is standard]

WHY_CHOOSE_ME: [2-3 sentences specific to this freelancer's strengths and relevant experience for this project]

NEXT_STEPS: [2 sentences — clear, confident call to action for the client to proceed]`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = message.content[0].text;

    // Build rendered HTML
    const renderedHtml = buildProposalHtml({ yourName, profession, client, budget, timeline, email, years, today, validUntil }, content);

    // Save document
    const doc = await Document.create({
      user: user._id,
      type: 'proposal',
      title: `Proposal for ${client}`,
      inputData: req.body,
      content,
      renderedHtml
    });

    // Increment usage
    await user.incrementUsage();

    res.json({
      success: true,
      document: {
        id: doc._id,
        title: doc.title,
        type: doc.type,
        content,
        renderedHtml,
        createdAt: doc.createdAt
      },
      remainingGenerations: user.getRemainingGenerations() === Infinity ? 'unlimited' : user.getRemainingGenerations()
    });
  } catch (err) {
    next(err);
  }
});

// ── INVOICE GENERATION
router.post('/invoice', protect, genLimiter, [
  body('yourName').trim().notEmpty().isLength({ max: 100 }),
  body('client').trim().notEmpty().isLength({ max: 100 }),
  body('lineItems').isArray({ min: 1, max: 20 }),
  body('lineItems.*.description').trim().notEmpty().isLength({ max: 200 }),
  body('lineItems.*.amount').isNumeric(),
  body('currency').trim().notEmpty().isIn(['USD','EUR','GBP','IDR','SGD','AUD','INR','CAD']),
  body('invoiceNumber').optional().trim().isLength({ max: 50 }),
  body('dueDate').optional().isISO8601(),
  body('paymentDetails').optional().trim().isLength({ max: 300 }),
  body('notes').optional().trim().isLength({ max: 300 })
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const user = await User.findById(req.user._id);
    if (!user.canGenerate()) {
      return res.status(429).json({
        success: false,
        message: 'Daily limit reached (3/day on free plan). Upgrade to Pro for unlimited.',
        upgrade: true,
        limit: true
      });
    }

    const { yourName, email, client, clientEmail, lineItems, currency, invoiceNumber, dueDate, paymentDetails, notes } = req.body;

    const invNum = invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
    const symbols = { USD:'$', EUR:'€', GBP:'£', IDR:'Rp', SGD:'S$', AUD:'A$', INR:'₹', CAD:'C$' };
    const sym = symbols[currency] || '$';
    const total = lineItems.reduce((s, li) => s + parseFloat(li.amount || 0), 0);
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const dueDateFormatted = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Upon Receipt';

    // AI thank-you note
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `Write ONE professional, warm thank-you sentence for a freelance invoice from "${yourName}" to "${client}". Under 25 words. Just the sentence, no quotes, no punctuation at end.`
      }]
    });

    const thankYou = message.content[0].text.trim();
    const finalNotes = notes || thankYou;
    const renderedHtml = buildInvoiceHtml({ yourName, email, client, clientEmail, invNum, today, dueDateFormatted, lineItems, sym, currency, total, paymentDetails, finalNotes });

    const doc = await Document.create({
      user: user._id,
      type: 'invoice',
      title: `Invoice ${invNum} — ${client}`,
      inputData: req.body,
      content: `Invoice ${invNum} for ${client}. Total: ${sym}${total.toFixed(2)} ${currency}`,
      renderedHtml,
      totalAmount: total,
      currency
    });

    await user.incrementUsage();

    res.json({
      success: true,
      document: {
        id: doc._id,
        title: doc.title,
        type: doc.type,
        content: doc.content,
        renderedHtml,
        totalAmount: total,
        currency,
        createdAt: doc.createdAt
      },
      remainingGenerations: user.getRemainingGenerations() === Infinity ? 'unlimited' : user.getRemainingGenerations()
    });
  } catch (err) {
    next(err);
  }
});

// ── HTML BUILDERS ──────────────────────────────────────────────────
function buildProposalHtml(data, aiText) {
  const parse = (label) => {
    const regex = new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`);
    const match = aiText.match(regex);
    return match ? match[1].trim() : '';
  };
  const toList = (raw) => raw.split('\n').filter(l => l.trim().startsWith('-')).map(l => `<li>${l.replace(/^-\s*/, '')}</li>`).join('');

  const execSummary = parse('EXECUTIVE_SUMMARY');
  const solution = parse('PROPOSED_SOLUTION');
  const deliverablesRaw = parse('DELIVERABLES');
  const timelineRaw = parse('TIMELINE');
  const investment = parse('INVESTMENT');
  const whyMe = parse('WHY_CHOOSE_ME');
  const nextSteps = parse('NEXT_STEPS');

  return `
<div class="pf-doc">
  <div class="pf-header">
    <div class="pf-from">
      <div class="pf-name">${data.yourName}</div>
      <div class="pf-meta">${data.profession}${data.email ? ' · ' + data.email : ''}</div>
    </div>
    <div class="pf-header-right">
      <div class="pf-doc-label">Project Proposal</div>
      <div class="pf-date">${data.today}</div>
    </div>
  </div>
  <div class="pf-to-block">
    <div class="pf-to-label">Prepared For</div>
    <div class="pf-to-name">${data.client}</div>
  </div>
  <div class="pf-meta-grid">
    <div class="pf-meta-item"><div class="pf-ml">Budget</div><div class="pf-mv">${data.budget}</div></div>
    <div class="pf-meta-item"><div class="pf-ml">Timeline</div><div class="pf-mv">${data.timeline}</div></div>
    <div class="pf-meta-item"><div class="pf-ml">Valid Until</div><div class="pf-mv">${data.validUntil}</div></div>
  </div>
  <div class="pf-section"><div class="pf-section-title">Overview</div><p>${execSummary}</p></div>
  <div class="pf-section"><div class="pf-section-title">Proposed Solution</div><p>${solution}</p></div>
  <div class="pf-section"><div class="pf-section-title">Deliverables</div><ul>${toList(deliverablesRaw)}</ul></div>
  <div class="pf-section"><div class="pf-section-title">Timeline</div><ul>${toList(timelineRaw)}</ul></div>
  <div class="pf-section"><div class="pf-section-title">Investment</div><p>${investment}</p></div>
  <div class="pf-section"><div class="pf-section-title">Why Choose Me</div><p>${whyMe}</p></div>
  <div class="pf-section"><div class="pf-section-title">Next Steps</div><p>${nextSteps}</p></div>
  <div class="pf-footer">${data.yourName} · ${data.profession}</div>
</div>`;
}

function buildInvoiceHtml(data) {
  const rows = data.lineItems.map(li =>
    `<tr><td>${li.description}</td><td class="pf-amount">${data.sym}${parseFloat(li.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`
  ).join('');

  return `
<div class="pf-doc">
  <div class="pf-header">
    <div class="pf-from">
      <div class="pf-name">${data.yourName}</div>
      ${data.email ? `<div class="pf-meta">${data.email}</div>` : ''}
    </div>
    <div class="pf-header-right">
      <div class="pf-invoice-label">INVOICE</div>
      <div class="pf-inv-num">${data.invNum}</div>
    </div>
  </div>
  <div class="pf-meta-grid">
    <div class="pf-meta-item">
      <div class="pf-ml">Bill To</div>
      <div class="pf-mv">${data.client}</div>
      ${data.clientEmail ? `<div class="pf-meta-sub">${data.clientEmail}</div>` : ''}
    </div>
    <div class="pf-meta-item"><div class="pf-ml">Issue Date</div><div class="pf-mv">${data.today}</div></div>
    <div class="pf-meta-item"><div class="pf-ml">Due Date</div><div class="pf-mv pf-due">${data.dueDateFormatted}</div></div>
  </div>
  <div class="pf-section">
    <div class="pf-section-title">Services Rendered</div>
    <table class="pf-table">
      <thead><tr><th>Description</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="pf-total-row"><td>Total (${data.currency})</td><td>${data.sym}${data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr></tfoot>
    </table>
    <div class="pf-total-box">
      <div class="pf-total-label">Amount Due</div>
      <div class="pf-total-amount">${data.sym}${data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div class="pf-total-currency">${data.currency}</div>
    </div>
  </div>
  ${data.paymentDetails ? `<div class="pf-payment"><strong>Payment Details:</strong> ${data.paymentDetails}</div>` : ''}
  ${data.finalNotes ? `<div class="pf-section"><div class="pf-section-title">Notes</div><p>${data.finalNotes}</p></div>` : ''}
  <div class="pf-footer">${data.yourName}${data.email ? ' · ' + data.email : ''}</div>
</div>`;
}

module.exports = router;
