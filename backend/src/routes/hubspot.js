const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { HubSpotContact, Call, CallPermission } = require('../models');
const hubspotService = require('../services/hubspot');
const twilioService = require('../services/twilio');
const logger = require('../utils/logger');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get calling settings for HubSpot portal
router.get('/calling/settings', async (req, res) => {
  try {
    const settings = await hubspotService.getCallingSettings();
    
    res.json({
      enabled: true,
      provider: {
        name: 'WhatsApp Business Calling',
        version: '1.0.0',
        supportsInbound: true,
        supportsOutbound: true,
        supportsRecording: true,
        supportsTransfer: false,
        supportsConference: true
      },
      settings
    });
  } catch (error) {
    logger.error('Failed to get calling settings:', error);
    res.status(500).json({ error: 'Failed to get calling settings' });
  }
});

// Update calling settings
router.post('/calling/settings', [
  body('enabled').isBoolean().withMessage('Enabled must be a boolean'),
  body('settings').optional().isObject().withMessage('Settings must be an object')
], handleValidationErrors, async (req, res) => {
  try {
    const { enabled, settings } = req.body;
    
    const updatedSettings = await hubspotService.updateCallingSettings({
      enabled,
      ...settings
    });
    
    res.json(updatedSettings);
  } catch (error) {
    logger.error('Failed to update calling settings:', error);
    res.status(500).json({ error: 'Failed to update calling settings' });
  }
});

// Sync contact from HubSpot
router.post('/contacts/:hubspotContactId/sync', [
  param('hubspotContactId').notEmpty().withMessage('HubSpot contact ID is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { hubspotContactId } = req.params;
    
    const contact = await hubspotService.syncContact(hubspotContactId);
    
    res.json({
      id: contact.id,
      hubspotContactId: contact.hubspotContactId,
      name: contact.getFullName(),
      email: contact.email,
      phone: contact.phone,
      whatsappNumber: contact.whatsappNumber,
      lastSyncedAt: contact.lastSyncedAt
    });
  } catch (error) {
    logger.error('Failed to sync contact:', error);
    res.status(500).json({ error: 'Failed to sync contact' });
  }
});

// Get contact calling permissions
router.get('/contacts/:contactId/permissions', [
  param('contactId').isUUID().withMessage('Valid contact ID is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { contactId } = req.params;
    
    const permissions = await CallPermission.findAll({
      where: { contactId },
      order: [['createdAt', 'DESC']]
    });
    
    const activePermission = permissions.find(p => 
      p.status === 'approved' && p.canMakeCall()
    );
    
    res.json({
      hasPermission: !!activePermission,
      canMakeCall: activePermission ? activePermission.canMakeCall() : false,
      activePermission: activePermission ? {
        id: activePermission.id,
        status: activePermission.status,
        callsUsed: activePermission.callsUsed,
        maxCalls: activePermission.maxCalls,
        expiresAt: activePermission.expiresAt,
        consecutiveMissedCalls: activePermission.consecutiveMissedCalls
      } : null,
      recentPermissions: permissions.slice(0, 5).map(p => ({
        id: p.id,
        status: p.status,
        requestedAt: p.requestedAt,
        respondedAt: p.respondedAt,
        expiresAt: p.expiresAt
      }))
    });
  } catch (error) {
    logger.error('Failed to get contact permissions:', error);
    res.status(500).json({ error: 'Failed to get permissions' });
  }
});

// Handle HubSpot Calling Extension SDK events
router.post('/calling/events', [
  body('eventType').notEmpty().withMessage('Event type is required'),
  body('payload').optional().isObject().withMessage('Payload must be an object')
], handleValidationErrors, async (req, res) => {
  try {
    const { eventType, payload } = req.body;
    
    logger.info('HubSpot calling event received:', { eventType, payload });
    
    switch (eventType) {
      case 'onReady':
        // SDK is ready to receive calls
        res.json({ status: 'ready', timestamp: new Date().toISOString() });
        break;
        
      case 'onDialNumber':
        // User clicked dial in HubSpot
        const { phoneNumber, calleeInfo } = payload;
        
        // Find or create contact
        let contact = await HubSpotContact.findOne({
          where: { hubspotContactId: calleeInfo.objectId }
        });
        
        if (!contact) {
          contact = await hubspotService.syncContact(calleeInfo.objectId);
        }
        
        // Check if it's a WhatsApp number
        const isWhatsApp = phoneNumber.includes('whatsapp') || 
                          contact.whatsappNumber === phoneNumber.replace(/\D/g, '');
        
        if (isWhatsApp) {
          const whatsappNumber = phoneNumber.startsWith('whatsapp:') 
            ? phoneNumber 
            : `whatsapp:${phoneNumber.replace(/\D/g, '')}`;
          
          // Check permission
          const permission = await CallPermission.findOne({
            where: {
              contactId: contact.id,
              whatsappNumber: whatsappNumber.replace('whatsapp:', ''),
              status: 'approved'
            },
            order: [['createdAt', 'DESC']]
          });
          
          if (!permission || !permission.canMakeCall()) {
            res.json({
              action: 'requestPermission',
              contactId: contact.id,
              whatsappNumber: whatsappNumber,
              message: 'Call permission required for WhatsApp calling'
            });
          } else {
            res.json({
              action: 'initiateCall',
              contactId: contact.id,
              whatsappNumber: whatsappNumber,
              contact: {
                name: contact.getFullName(),
                id: contact.id
              }
            });
          }
        } else {
          res.json({
            action: 'unsupported',
            message: 'Only WhatsApp numbers are supported'
          });
        }
        break;
        
      case 'onCallAnswered':
        // Call was answered in HubSpot
        const { callId } = payload;
        
        // Send to WebSocket clients
        const wss = req.app.get('wss');
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'hubspot_call_answered',
              callId,
              timestamp: new Date().toISOString()
            }));
          }
        });
        
        res.json({ status: 'acknowledged' });
        break;
        
      case 'onCallEnded':
        // Call ended in HubSpot
        const { callId: endedCallId, engagementId } = payload;
        
        // Update call record
        const call = await Call.findByPk(endedCallId);
        if (call) {
          await call.update({ 
            hubspotCallId: engagementId,
            endTime: new Date()
          });
        }
        
        res.json({ status: 'acknowledged' });
        break;
        
      case 'onCallCompleted':
        // Call completed with notes
        const { callId: completedCallId, notes, outcome } = payload;
        
        const completedCall = await Call.findByPk(completedCallId);
        if (completedCall) {
          await completedCall.update({ 
            notes,
            metadata: { ...completedCall.metadata, outcome }
          });
        }
        
        res.json({ status: 'acknowledged' });
        break;
        
      default:
        logger.warn('Unknown event type received:', eventType);
        res.json({ status: 'unknown_event' });
    }
  } catch (error) {
    logger.error('Failed to handle HubSpot calling event:', error);
    res.status(500).json({ error: 'Failed to process event' });
  }
});

// Get contact info for calling widget
router.get('/contacts/lookup', [
  query('phone').optional().notEmpty().withMessage('Phone number cannot be empty if provided'),
  query('email').optional().isEmail().withMessage('Must be a valid email'),
  query('hubspotId').optional().notEmpty().withMessage('HubSpot ID cannot be empty if provided')
], handleValidationErrors, async (req, res) => {
  try {
    const { phone, email, hubspotId } = req.query;
    
    let contact = null;
    
    if (hubspotId) {
      contact = await HubSpotContact.findOne({
        where: { hubspotContactId: hubspotId }
      });
      
      if (!contact) {
        contact = await hubspotService.syncContact(hubspotId);
      }
    } else if (phone) {
      contact = await HubSpotContact.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { phone },
            { whatsappNumber: phone.replace(/\D/g, '') }
          ]
        }
      });
    } else if (email) {
      contact = await HubSpotContact.findOne({
        where: { email }
      });
    }
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    // Get call permissions
    const permissions = await CallPermission.findAll({
      where: { contactId: contact.id },
      order: [['createdAt', 'DESC']],
      limit: 1
    });
    
    const activePermission = permissions.find(p => 
      p.status === 'approved' && p.canMakeCall()
    );
    
    res.json({
      contact: {
        id: contact.id,
        hubspotContactId: contact.hubspotContactId,
        name: contact.getFullName(),
        email: contact.email,
        phone: contact.phone,
        whatsappNumber: contact.whatsappNumber,
        company: contact.company
      },
      calling: {
        canCall: !!activePermission,
        hasWhatsApp: !!contact.whatsappNumber,
        permission: activePermission ? {
          callsUsed: activePermission.callsUsed,
          maxCalls: activePermission.maxCalls,
          expiresAt: activePermission.expiresAt
        } : null
      }
    });
  } catch (error) {
    logger.error('Failed to lookup contact:', error);
    res.status(500).json({ error: 'Failed to lookup contact' });
  }
});

// HubSpot webhook endpoint
router.post('/webhooks', [
  body('objectId').optional().notEmpty().withMessage('Object ID cannot be empty'),
  body('eventType').notEmpty().withMessage('Event type is required'),
  body('subscriptionType').notEmpty().withMessage('Subscription type is required')
], handleValidationErrors, async (req, res) => {
  try {
    const { objectId, eventType, subscriptionType, propertyName, propertyValue } = req.body;
    
    logger.info('HubSpot webhook received:', {
      objectId,
      eventType,
      subscriptionType,
      propertyName
    });
    
    switch (subscriptionType) {
      case 'contact.propertyChange':
        if (propertyName === 'whatsapp_number') {
          // WhatsApp number updated, sync contact
          await hubspotService.syncContact(objectId);
          
          logger.info('Contact WhatsApp number updated:', {
            contactId: objectId,
            newValue: propertyValue
          });
        }
        break;
        
      case 'contact.creation':
        // New contact created, sync if it has WhatsApp number
        await hubspotService.syncContact(objectId);
        break;
        
      case 'contact.deletion':
        // Contact deleted, clean up local data
        const deletedContact = await HubSpotContact.findOne({
          where: { hubspotContactId: objectId }
        });
        
        if (deletedContact) {
          // Cancel any pending permissions
          await CallPermission.update(
            { status: 'expired' },
            { where: { contactId: deletedContact.id, status: 'pending' } }
          );
          
          // Keep call history but mark contact as deleted
          await deletedContact.update({ 
            metadata: { ...deletedContact.metadata, deleted: true }
          });
        }
        break;
    }
    
    res.status(200).json({ status: 'processed' });
  } catch (error) {
    logger.error('Failed to process HubSpot webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Get calling analytics for dashboard
router.get('/analytics/calls', [
  query('startDate').optional().isISO8601().withMessage('Start date must be valid ISO8601'),
  query('endDate').optional().isISO8601().withMessage('End date must be valid ISO8601'),
  query('contactId').optional().isUUID().withMessage('Contact ID must be valid UUID')
], handleValidationErrors, async (req, res) => {
  try {
    const { startDate, endDate, contactId } = req.query;
    
    const whereClause = {};
    
    if (contactId) {
      whereClause.contactId = contactId;
    }
    
    if (startDate || endDate) {
      whereClause.startTime = {};
      if (startDate) whereClause.startTime[require('sequelize').Op.gte] = new Date(startDate);
      if (endDate) whereClause.startTime[require('sequelize').Op.lte] = new Date(endDate);
    }
    
    const calls = await Call.findAll({
      where: whereClause,
      include: [{ model: HubSpotContact, as: 'contact' }],
      order: [['startTime', 'DESC']]
    });
    
    // Calculate analytics
    const analytics = {
      totalCalls: calls.length,
      inboundCalls: calls.filter(c => c.direction === 'inbound').length,
      outboundCalls: calls.filter(c => c.direction === 'outbound').length,
      completedCalls: calls.filter(c => c.status === 'completed').length,
      failedCalls: calls.filter(c => ['failed', 'busy', 'no-answer'].includes(c.status)).length,
      totalDuration: calls.reduce((sum, c) => sum + (c.duration || 0), 0),
      averageDuration: calls.length > 0 
        ? calls.reduce((sum, c) => sum + (c.duration || 0), 0) / calls.length 
        : 0,
      callsByStatus: {
        completed: calls.filter(c => c.status === 'completed').length,
        failed: calls.filter(c => c.status === 'failed').length,
        busy: calls.filter(c => c.status === 'busy').length,
        'no-answer': calls.filter(c => c.status === 'no-answer').length,
        canceled: calls.filter(c => c.status === 'canceled').length
      },
      recentCalls: calls.slice(0, 10).map(call => ({
        id: call.id,
        direction: call.direction,
        status: call.status,
        duration: call.duration,
        startTime: call.startTime,
        contact: {
          name: call.contact.getFullName(),
          whatsappNumber: call.contact.whatsappNumber
        }
      }))
    };
    
    res.json(analytics);
  } catch (error) {
    logger.error('Failed to get call analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

module.exports = router;