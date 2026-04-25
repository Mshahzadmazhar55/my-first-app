const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  plan: {
    type: String,
    enum: ['free', 'pro'],
    default: 'free'
  },
  generationsToday: {
    type: Number,
    default: 0
  },
  lastGenerationReset: {
    type: Date,
    default: Date.now
  },
  xenditCustomerId: String,
  xenditSubscriptionId: String,
  subscriptionStatus: {
    type: String,
    enum: ['active', 'inactive', 'past_due', 'canceled'],
    default: 'inactive'
  },
  subscriptionCurrentPeriodEnd: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Reset daily generation count if needed
userSchema.methods.resetGenerationsIfNeeded = function() {
  const now = new Date();
  const lastReset = new Date(this.lastGenerationReset);
  
  if (now.getDate() !== lastReset.getDate() || 
      now.getMonth() !== lastReset.getMonth() || 
      now.getFullYear() !== lastReset.getFullYear()) {
    this.generationsToday = 0;
    this.lastGenerationReset = now;
  }
};

// Check if user can generate
userSchema.methods.canGenerate = function() {
  this.resetGenerationsIfNeeded();
  
  if (this.plan === 'pro') return true;
  return this.generationsToday < 3;
};

// Increment usage
userSchema.methods.incrementUsage = async function() {
  this.resetGenerationsIfNeeded();
  this.generationsToday += 1;
  await this.save();
};

// Get remaining generations
userSchema.methods.getRemainingGenerations = function() {
  this.resetGenerationsIfNeeded();
  
  if (this.plan === 'pro') return Infinity;
  return Math.max(0, 3 - this.generationsToday);
};

module.exports = mongoose.model('User', userSchema);
