const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Twilio webhook validation errors
  if (err.name === 'TwilioValidationError') {
    return res.status(403).json({
      error: 'Webhook validation failed',
      message: 'Invalid Twilio signature'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors
    });
  }

  // Sequelize errors
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Database validation failed',
      details: err.errors.map(e => ({ field: e.path, message: e.message }))
    });
  }

  // HubSpot API errors
  if (err.name === 'HubSpotError') {
    return res.status(err.statusCode || 500).json({
      error: 'HubSpot API error',
      message: err.message
    });
  }

  // Twilio API errors
  if (err.code && err.code.toString().startsWith('2')) {
    return res.status(400).json({
      error: 'Twilio API error',
      message: err.message,
      code: err.code
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
};

module.exports = errorHandler;