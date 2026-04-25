require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const generateRoutes = require('./routes/generate');
const paymentRoutes = require('./routes/payments');
const userRoutes = require('./routes/users');

const app = express();

// ── Security headers
app.use(helmet());

// ── CORS
app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Xendit webhook needs raw body — mount BEFORE json parser
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ── Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', globalLimiter);

// ── Auth rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many auth attempts, please try again later.' }
});
app.use('/api/auth/', authLimiter);

// ── Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/users', userRoutes);

// ── Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── 404
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ── Connect DB and start
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('[DB] MongoDB connected');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));
  })
  .catch(err => {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  });

module.exports = app;
