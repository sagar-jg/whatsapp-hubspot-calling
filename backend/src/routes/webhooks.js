const express = require('express');
const { body, param } = require('express-validator');
const twilio = require('twilio');
const { Call, CallPermission, HubSpotContact, CallLog } = require('../models');
const twilioService = require('../services/twilio');
const hubspotService = require('../services/hubspot');
const { validateTwilioSignature } = require('../middleware/twilioValidator');
const logger = require('../utils/logger');

const router = express.Router();
const VoiceResponse = twilio.twiml.VoiceResponse;

// Handle inbound WhatsApp calls
router.post('/voice/inbound', validateTwilioSignature, async (req, res) => {
  try {
    const { CallSid, From, To, CallStatus } = req.body;
    
    logger.info('Inbound WhatsApp call received:', {
      callSid: CallSid,
      from: From,
      to: To,
      status: CallStatus
    });

    // Find or create contact
    let contact = await HubSpotContact.findOne({
      where: { whatsappNumber: From.replace('whatsapp:', '') }
    });

    if (!contact) {
      // Search in HubSpot
      const hubspotContacts = await hubspotService.searchContactsByWhatsApp(From);
      
      if (hubspotContacts.length > 0) {
        // Sync contact from HubSpot
        contact = await hubspotService.syncContact(hubspotContacts[0].id);
      } else {
        // Create new contact
        const hubspotContact = await hubspotService.createContact({
          whatsapp_number: From.replace('whatsapp:', ''),
          firstname: 'WhatsApp',
          lastname: 'Caller'
        });
        
        contact = await HubSpotContact.create({
          hubspotContactId: hubspotContact.id,
          whatsappNumber: From.replace('whatsapp:', ''),
          firstName: 'WhatsApp',
          lastName: 'Caller'
        });
      }
    }

    // Create call record
    const call = await Call.create({
      twilioCallSid: CallSid,
      contactId: contact.id,
      direction: 'inbound',
      fromNumber: From,
      toNumber: To,
      status: 'ringing',
      startTime: new Date()
    });

    // Log call initiation
    await CallLog.create({
      callId: call.id,
      event: 'inbound_call_received',
      status: 'ringing',
      source: 'twilio',
      data: req.body
    });

    // Send real-time notification to HubSpot agents
    const wss = req.app.get('wss');
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'incoming_call',
          callId: call.id,
          twilioCallSid: CallSid,
          contact: {
            id: contact.id,
            name: contact.getFullName(),
            whatsappNumber: contact.whatsappNumber
          },
          from: From,
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Generate TwiML to route call to HubSpot agent
    const twiml = new VoiceResponse();
    
    // Create conference for the call
    const conferenceName = `whatsapp-call-${CallSid}`;
    
    twiml.dial((dial) => {
      dial.conference(conferenceName, {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient',
        statusCallback: `${req.protocol}://${req.get('host')}/webhook/conference/${call.id}`,
        statusCallbackEvent: 'start end join leave',
        statusCallbackMethod: 'POST'
      });
    });

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    logger.error('Failed to handle inbound call:', error);
    
    const twiml = new VoiceResponse();
    twiml.say('We are currently unable to take your call. Please try again later.');
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Handle outbound call webhooks
router.post('/voice/outbound/:callId', validateTwilioSignature, async (req, res) => {
  try {
    const { callId } = req.params;
    const { CallSid, CallStatus, DialCallStatus } = req.body;
    
    const call = await Call.findByPk(callId);
    if (!call) {
      return res.status(404).send('Call not found');
    }

    logger.info('Outbound call webhook:', {
      callId,
      callSid: CallSid,
      status: CallStatus,
      dialStatus: DialCallStatus
    });

    // Generate TwiML based on call status
    const twiml = new VoiceResponse();
    
    if (CallStatus === 'answered' || DialCallStatus === 'answered') {
      // Create conference bridge for agent and customer
      const conferenceName = `outbound-call-${callId}`;
      const agentIdentity = call.metadata?.agentIdentity || 'hubspot-agent';
      
      // Add customer to conference
      twiml.dial((dial) => {
        dial.conference(conferenceName, {
          startConferenceOnEnter: false,
          endConferenceOnExit: true,
          statusCallback: `${req.protocol}://${req.get('host')}/webhook/conference/${callId}`,
          statusCallbackEvent: 'start end join leave',
          statusCallbackMethod: 'POST'
        });
      });

      // Notify frontend to connect agent
      const wss = req.app.get('wss');
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'call_answered',
            callId,
            twilioCallSid: CallSid,
            conferenceName,
            agentIdentity
          }));
        }
      });
    } else if (CallStatus === 'busy' || DialCallStatus === 'busy') {
      twiml.say('The number you are calling is busy. Please try again later.');
    } else if (CallStatus === 'no-answer' || DialCallStatus === 'no-answer') {
      twiml.say('There was no answer. Please try again later.');
    } else if (CallStatus === 'failed' || DialCallStatus === 'failed') {
      twiml.say('The call could not be completed. Please check the number and try again.');
    }

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    logger.error('Failed to handle outbound call webhook:', error);
    
    const twiml = new VoiceResponse();
    twiml.say('An error occurred. Please try again.');
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Handle call status updates
router.post('/call-status', validateTwilioSignature, async (req, res) => {
  try {
    const { CallSid, CallStatus, CallDuration, RecordingUrl } = req.body;
    
    const call = await Call.findOne({
      where: { twilioCallSid: CallSid },
      include: [{ model: HubSpotContact, as: 'contact' }]
    });

    if (call) {
      // Update call status
      const updates = { status: CallStatus };
      
      if (CallDuration) {
        updates.duration = parseInt(CallDuration);
      }
      
      if (RecordingUrl) {
        updates.recordingUrl = RecordingUrl;
      }
      
      if (CallStatus === 'completed' && !call.endTime) {
        updates.endTime = new Date();
      }
      
      await call.update(updates);

      // Log status change
      await CallLog.create({
        callId: call.id,
        event: 'status_update',
        status: CallStatus,
        source: 'twilio',
        data: req.body,
        message: `Call status updated to ${CallStatus}`
      });

      // Update call permission if call was missed
      if (CallStatus === 'no-answer' && call.direction === 'outbound') {
        const permission = await CallPermission.findOne({
          where: {
            contactId: call.contactId,
            status: 'approved'
          },
          order: [['createdAt', 'DESC']]
        });

        if (permission) {
          await permission.incrementMissedCalls();
          
          // Revoke permission after 4 consecutive missed calls
          if (permission.consecutiveMissedCalls >= 4) {
            await permission.update({ status: 'expired' });
          }
        }
      } else if (CallStatus === 'answered' && call.direction === 'outbound') {
        // Reset missed calls counter on successful call
        const permission = await CallPermission.findOne({
          where: {
            contactId: call.contactId,
            status: 'approved'
          },
          order: [['createdAt', 'DESC']]
        });

        if (permission) {
          await permission.resetMissedCalls();
        }
      }

      // Log call activity to HubSpot
      if (CallStatus === 'completed') {
        try {
          await hubspotService.logCallActivity(call.contact.hubspotContactId, {
            direction: call.direction,
            status: call.status,
            duration: call.duration,
            fromNumber: call.fromNumber,
            toNumber: call.toNumber,
            recordingUrl: call.recordingUrl,
            notes: call.notes,
            startTime: call.startTime
          });
        } catch (hubspotError) {
          logger.error('Failed to log call to HubSpot:', hubspotError);
        }
      }

      // Send real-time update
      const wss = req.app.get('wss');
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'call_status_update',
            callId: call.id,
            twilioCallSid: CallSid,
            status: CallStatus,
            duration: call.duration,
            recordingUrl: call.recordingUrl
          }));
        }
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to handle call status update:', error);
    res.status(500).send('Error');
  }
});

// Handle WhatsApp message webhooks (for call permission responses)
router.post('/messaging', validateTwilioSignature, async (req, res) => {
  try {
    const { 
      MessageSid, 
      From, 
      To, 
      Body, 
      ButtonPayload, 
      MessageType 
    } = req.body;

    logger.info('WhatsApp message received:', {
      messageSid: MessageSid,
      from: From,
      messageType: MessageType,
      body: Body,
      buttonPayload: ButtonPayload
    });

    // Handle call permission responses
    if (Body === 'VOICE_CALL_REQUEST' && ButtonPayload) {
      const cleanNumber = From.replace('whatsapp:', '');
      
      const permission = await CallPermission.findOne({
        where: {
          whatsappNumber: cleanNumber,
          status: 'pending'
        },
        order: [['createdAt', 'DESC']]
      });

      if (permission) {
        const newStatus = ButtonPayload === 'ACCEPTED' ? 'approved' : 'rejected';
        
        await permission.update({
          status: newStatus,
          respondedAt: new Date()
        });

        logger.info('Call permission response processed:', {
          permissionId: permission.id,
          response: ButtonPayload,
          status: newStatus
        });

        // Send real-time update
        const wss = req.app.get('wss');
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'permission_response',
              permissionId: permission.id,
              contactId: permission.contactId,
              status: newStatus,
              whatsappNumber: cleanNumber
            }));
          }
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to handle WhatsApp message:', error);
    res.status(500).send('Error');
  }
});

// Handle conference status updates
router.post('/conference/:callId', validateTwilioSignature, async (req, res) => {
  try {
    const { callId } = req.params;
    const { StatusCallbackEvent, ConferenceSid, FriendlyName } = req.body;

    const call = await Call.findByPk(callId);
    if (call) {
      await CallLog.create({
        callId: call.id,
        event: `conference_${StatusCallbackEvent}`,
        source: 'twilio',
        data: req.body,
        message: `Conference ${StatusCallbackEvent}`
      });

      logger.info('Conference event:', {
        callId,
        event: StatusCallbackEvent,
        conferenceSid: ConferenceSid
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to handle conference webhook:', error);
    res.status(500).send('Error');
  }
});

// Handle recording status updates
router.post('/recording/:callId', validateTwilioSignature, async (req, res) => {
  try {
    const { callId } = req.params;
    const { RecordingSid, RecordingUrl, RecordingStatus } = req.body;

    const call = await Call.findByPk(callId);
    if (call && RecordingUrl) {
      await call.update({ recordingUrl: RecordingUrl });
      
      await CallLog.create({
        callId: call.id,
        event: 'recording_available',
        source: 'twilio',
        data: req.body,
        message: `Recording ${RecordingStatus}`
      });

      logger.info('Recording updated:', {
        callId,
        recordingSid: RecordingSid,
        recordingUrl: RecordingUrl,
        status: RecordingStatus
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Failed to handle recording webhook:', error);
    res.status(500).send('Error');
  }
});

module.exports = router;