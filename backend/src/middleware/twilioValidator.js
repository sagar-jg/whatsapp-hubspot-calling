const twilio = require('twilio');
const config = require('../config/config');
const logger = require('../utils/logger');

const validateTwilioSignature = (req, res, next) => {
  // Skip validation in development if TWILIO_AUTH_TOKEN is not set
  if (!config.twilio.authToken) {
    logger.warn('Twilio signature validation skipped - no auth token configured');
    return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  
  if (!twilioSignature) {
    logger.error('Missing Twilio signature header');
    const error = new Error('Missing Twilio signature');
    error.name = 'TwilioValidationError';
    return next(error);
  }

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = req.body;

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    twilioSignature,
    url,
    params
  );

  if (!isValid) {
    logger.error('Invalid Twilio signature', {
      url,
      signature: twilioSignature,
      params
    });
    const error = new Error('Invalid Twilio signature');
    error.name = 'TwilioValidationError';
    return next(error);
  }

  next();
};

module.exports = { validateTwilioSignature };