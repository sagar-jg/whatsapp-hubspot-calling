const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { Call, CallPermission, HubSpotContact, CallLog } = require('../models');
const twilioService = require('../services/twilio');
const hubspotService = require('../services/hubspot');
const logger = require('../utils/logger');
const config = require('../config/config');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get access token for WebRTC
router.get('/token/:identity', [
  param('identity').notEmpty().withMessage('Identity is required')
], handleValidationErrors, (req, res) => {
  try {
    const { identity } = req.params;
    const token = twilioService.generateAccessToken(identity);
    
    res.json({ token, identity });
  } catch (error) {
    logger.error('Failed to generate access token:', error);
    res.status(500).json({ error: 'Failed to generate access token' });
  }
});

// Initiate outbound call
router.post('/outbound', [
  body('contactId').isUUID().withMessage('Valid contact ID is required'),
  body('toNumber').notEmpty().withMessage('To number is required'),
  body('agentIdentity').notEmpty().withMessage('Agent identity is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { contactId, toNumber, agentIdentity, notes } = req.body;
    
    // Get contact information
    const contact = await HubSpotContact.findByPk(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Format WhatsApp number
    const whatsappNumber = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;
    
    // Check call permission
    const permission = await CallPermission.findOne({
      where: {
        contactId,
        whatsappNumber: whatsappNumber.replace('whatsapp:', ''),
        status: 'approved'
      },
      order: [['createdAt', 'DESC']]
    });

    if (!permission || !permission.canMakeCall()) {
      return res.status(403).json({ 
        error: 'Call permission required',
        requiresPermission: true,
        canRequest: !permission || permission.status !== 'pending'
      });
    }

    // Create call record
    const call = await Call.create({
      contactId,
      direction: 'outbound',
      fromNumber: twilioService.whatsappNumber,
      toNumber: whatsappNumber,
      status: 'initiated',
      startTime: new Date(),
      notes,
      twilioCallSid: '', // Will be updated after Twilio call creation
      metadata: { agentIdentity }
    });

    // Create callback URL
    const callbackUrl = `${req.protocol}://${req.get('host')}/webhook/voice/outbound/${call.id}`;
    
    try {
      // Make the call via Twilio
      const twilioCall = await twilioService.makeOutboundCall(
        whatsappNumber,
        twilioService.whatsappNumber,
        callbackUrl
      );

      // Update call with Twilio SID
      await call.update({ twilioCallSid: twilioCall.sid });

      // Log call initiation
      await CallLog.create({
        callId: call.id,
        event: 'call_initiated',
        status: 'initiated',
        source: 'system',
        message: 'Outbound WhatsApp call initiated',
        data: { twilioCallSid: twilioCall.sid, agentIdentity }
      });

      // Increment permission usage
      await permission.incrementCallsUsed();

      // Send event to frontend
      const wss = req.app.get('wss');
      wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(JSON.stringify({
            type: 'call_initiated',
            callId: call.id,
            twilioCallSid: twilioCall.sid,
            status: 'initiated'
          }));
        }
      });

      res.json({
        callId: call.id,
        twilioCallSid: twilioCall.sid,
        status: 'initiated',
        contact: {
          name: contact.getFullName(),
          number: whatsappNumber
        }
      });
    } catch (twilioError) {
      // Update call status to failed
      await call.update({ status: 'failed' });
      
      await CallLog.create({
        callId: call.id,
        event: 'call_failed',
        status: 'failed',
        source: 'twilio',
        message: 'Failed to initiate call via Twilio',
        data: { error: twilioError.message }
      });

      throw twilioError;
    }
  } catch (error) {
    logger.error('Failed to initiate outbound call:', error);
    res.status(500).json({ error: 'Failed to initiate call' });
  }
});

// Request call permission
router.post('/permission/request', [
  body('contactId').isUUID().withMessage('Valid contact ID is required'),
  body('whatsappNumber').notEmpty().withMessage('WhatsApp number is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { contactId, whatsappNumber } = req.body;
    
    const contact = await HubSpotContact.findByPk(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const cleanNumber = whatsappNumber.replace('whatsapp:', '');
    
    // Check if permission request can be sent (rate limiting)
    const recentPermissions = await CallPermission.findAll({
      where: {
        contactId,
        whatsappNumber: cleanNumber,
        requestedAt: {
          [require('sequelize').Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      }
    });

    if (recentPermissions.length >= config.callPermissions.maxRequestsPerDay) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: 'Maximum permission requests per day reached'
      });
    }

    // Check 7-day limit
    const weeklyPermissions = await CallPermission.findAll({
      where: {
        contactId,
        whatsappNumber: cleanNumber,
        requestedAt: {
          [require('sequelize').Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }
    });

    if (weeklyPermissions.length >= config.callPermissions.maxRequestsPer7Days) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: 'Maximum permission requests per week reached'
      });
    }

    // Create permission request
    const permission = await CallPermission.create({
      contactId,
      whatsappNumber: cleanNumber,
      status: 'pending',
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    try {
      // Send permission request via Twilio
      const templateSid = 'HX_YOUR_PERMISSION_TEMPLATE_SID'; // Configure this
      const message = await twilioService.sendCallPermissionRequest(
        `whatsapp:${cleanNumber}`,
        templateSid
      );

      await permission.update({ twilioMessageSid: message.sid });

      logger.info('Call permission request sent:', {
        permissionId: permission.id,
        contactId,
        whatsappNumber: cleanNumber,
        messageSid: message.sid
      });

      res.json({
        permissionId: permission.id,
        status: 'pending',
        messageSid: message.sid,
        expiresAt: permission.expiresAt
      });
    } catch (twilioError) {
      // Update permission status
      await permission.update({ status: 'failed' });
      throw twilioError;
    }
  } catch (error) {
    logger.error('Failed to request call permission:', error);
    res.status(500).json({ error: 'Failed to send permission request' });
  }
});

// Get call status
router.get('/status/:callSid', [
  param('callSid').notEmpty().withMessage('Call SID is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { callSid } = req.params;
    
    const call = await Call.findOne({
      where: { twilioCallSid: callSid },
      include: [
        { model: HubSpotContact, as: 'contact' },
        { model: CallLog, as: 'logs' }
      ]
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    // Get latest status from Twilio
    try {
      const twilioCall = await twilioService.getCall(callSid);
      
      // Update local status if different
      if (call.status !== twilioCall.status) {
        await call.update({ 
          status: twilioCall.status,
          duration: twilioCall.duration || call.duration,
          endTime: twilioCall.endTime ? new Date(twilioCall.endTime) : call.endTime
        });
      }
    } catch (twilioError) {
      logger.warn('Failed to fetch Twilio call status:', twilioError);
    }

    res.json({
      callId: call.id,
      twilioCallSid: call.twilioCallSid,
      status: call.status,
      direction: call.direction,
      duration: call.duration,
      startTime: call.startTime,
      endTime: call.endTime,
      contact: {
        id: call.contact.id,
        name: call.contact.getFullName(),
        whatsappNumber: call.contact.whatsappNumber
      },
      logs: call.logs
    });
  } catch (error) {
    logger.error('Failed to get call status:', error);
    res.status(500).json({ error: 'Failed to get call status' });
  }
});

// Hang up call
router.post('/:callSid/hangup', [
  param('callSid').notEmpty().withMessage('Call SID is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { callSid } = req.params;
    
    const call = await Call.findOne({
      where: { twilioCallSid: callSid }
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    // Hang up via Twilio
    await twilioService.hangupCall(callSid);
    
    // Update local status
    await call.update({ 
      status: 'completed',
      endTime: new Date()
    });

    // Log the hangup
    await CallLog.create({
      callId: call.id,
      event: 'call_hangup',
      status: 'completed',
      source: 'system',
      message: 'Call hung up by user'
    });

    res.json({ status: 'completed' });
  } catch (error) {
    logger.error('Failed to hang up call:', error);
    res.status(500).json({ error: 'Failed to hang up call' });
  }
});

// Get call history for a contact
router.get('/history/:contactId', [
  param('contactId').isUUID().withMessage('Valid contact ID is required'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
], handleValidationErrors, async (req, res) => {
  try {
    const { contactId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const calls = await Call.findAll({
      where: { contactId },
      include: [
        { model: CallLog, as: 'logs' }
      ],
      order: [['startTime', 'DESC']],
      limit,
      offset
    });

    const total = await Call.count({ where: { contactId } });

    res.json({
      calls,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    logger.error('Failed to get call history:', error);
    res.status(500).json({ error: 'Failed to get call history' });
  }
});

module.exports = router;