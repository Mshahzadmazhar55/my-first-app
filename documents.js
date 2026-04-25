const express = require('express');
const { protect } = require('../middleware/auth');
const Document = require('../models/Document');

const router = express.Router();

// GET /api/documents — get all user's documents
router.get('/', protect, async (req, res, next) => {
  try {
    const documents = await Document.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .select('-renderedHtml -content')
      .limit(100);

    res.json({ success: true, documents });
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id — get single document
router.get('/:id', protect, async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.json({ success: true, document });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id — delete document
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const document = await Document.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.json({ success: true, message: 'Document deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
