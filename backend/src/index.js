require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const { createServer } = require('http');
const WebSocket = require('ws');

const logger = require('./utils/logger');
const db = require('./models');
const errorHandler = require('./middleware/errorHandler');
const twilioValidator = require('./middleware/twilioValidator');

// Import routes
const callRoutes = require('./routes/calls');
const hubspotRoutes = require('./routes/hubspot');
const webhookRoutes = require('./routes/webhooks');
const healthRoutes = require('./routes/health');

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Body parsing
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store WebSocket connection for real-time updates
app.set('wss', wss);

// WebSocket connection handling
wss.on('connection', (ws) => {
  logger.info('New WebSocket connection established');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      logger.info('WebSocket message received:', data);
    } catch (error) {
      logger.error('Invalid WebSocket message format:', error);
    }
  });
  
  ws.on('close', () => {
    logger.info('WebSocket connection closed');
  });
});

// Routes
app.use('/health', healthRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/hubspot', hubspotRoutes);
app.use('/webhook', webhookRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3001;

// Initialize database and start server
db.sequelize.sync({ force: false }).then(() => {
  logger.info('Database synchronized');
  
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(error => {
  logger.error('Failed to sync database:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
  });
});

module.exports = app;