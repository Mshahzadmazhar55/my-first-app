const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['proposal', 'invoice'],
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  inputData: {
    type: Object,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  renderedHtml: {
    type: String,
    required: true
  },
  totalAmount: Number,
  currency: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
documentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
