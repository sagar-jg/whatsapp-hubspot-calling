const twilio = require('twilio');
const config = require('../config/config');
const logger = require('../utils/logger');
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

class TwilioService {
  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    this.accountSid = config.twilio.accountSid;
    this.whatsappNumber = config.twilio.whatsappNumber;
    this.twimlAppSid = config.twilio.twimlAppSid;
  }

  // Generate access token for WebRTC
  generateAccessToken(identity) {
    const accessToken = new AccessToken(
      config.twilio.accountSid,
      config.twilio.apiKeySid,
      config.twilio.apiKeySecret,
      { identity }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: this.twimlAppSid,
      incomingAllow: true
    });

    accessToken.addGrant(voiceGrant);
    return accessToken.toJwt();
  }

  // Make outbound call to WhatsApp
  async makeOutboundCall(toWhatsAppNumber, fromWhatsAppNumber, callbackUrl) {
    try {
      const call = await this.client.calls.create({
        to: toWhatsAppNumber,
        from: fromWhatsAppNumber || this.whatsappNumber,
        url: callbackUrl,
        statusCallback: `${callbackUrl}/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        record: true,
        recordingStatusCallback: `${callbackUrl}/recording`
      });

      logger.info('Outbound WhatsApp call created:', {
        callSid: call.sid,
        to: toWhatsAppNumber,
        from: fromWhatsAppNumber || this.whatsappNumber
      });

      return call;
    } catch (error) {
      logger.error('Failed to create outbound call:', error);
      throw error;
    }
  }

  // Send call permission request
  async sendCallPermissionRequest(toWhatsAppNumber, templateSid) {
    try {
      const message = await this.client.messages.create({
        contentSid: templateSid,
        from: this.whatsappNumber,
        to: toWhatsAppNumber
      });

      logger.info('Call permission request sent:', {
        messageSid: message.sid,
        to: toWhatsAppNumber
      });

      return message;
    } catch (error) {
      logger.error('Failed to send call permission request:', error);
      throw error;
    }
  }

  // Send voice call template message
  async sendVoiceCallTemplate(toWhatsAppNumber, templateSid, variables = {}) {
    try {
      const message = await this.client.messages.create({
        contentSid: templateSid,
        from: this.whatsappNumber,
        to: toWhatsAppNumber,
        contentVariables: JSON.stringify(variables)
      });

      logger.info('Voice call template sent:', {
        messageSid: message.sid,
        to: toWhatsAppNumber,
        template: templateSid
      });

      return message;
    } catch (error) {
      logger.error('Failed to send voice call template:', error);
      throw error;
    }
  }

  // Get call details
  async getCall(callSid) {
    try {
      const call = await this.client.calls(callSid).fetch();
      return call;
    } catch (error) {
      logger.error(`Failed to fetch call ${callSid}:`, error);
      throw error;
    }
  }

  // Update call (e.g., to hang up)
  async updateCall(callSid, options) {
    try {
      const call = await this.client.calls(callSid).update(options);
      logger.info('Call updated:', { callSid, options });
      return call;
    } catch (error) {
      logger.error(`Failed to update call ${callSid}:`, error);
      throw error;
    }
  }

  // Hang up call
  async hangupCall(callSid) {
    return this.updateCall(callSid, { status: 'completed' });
  }

  // Create conference call
  async createConference(friendlyName, options = {}) {
    try {
      const conference = await this.client.conferences.create({
        friendlyName,
        statusCallback: options.statusCallback,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['start', 'end', 'join', 'leave'],
        record: options.record || 'record-from-start',
        ...options
      });

      logger.info('Conference created:', {
        conferenceSid: conference.sid,
        friendlyName
      });

      return conference;
    } catch (error) {
      logger.error('Failed to create conference:', error);
      throw error;
    }
  }

  // Join participant to conference
  async addParticipantToConference(conferenceSid, phoneNumber, options = {}) {
    try {
      const participant = await this.client.conferences(conferenceSid)
        .participants
        .create({
          from: this.whatsappNumber,
          to: phoneNumber,
          earlyMedia: true,
          statusCallback: options.statusCallback,
          statusCallbackMethod: 'POST',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          ...options
        });

      logger.info('Participant added to conference:', {
        conferenceSid,
        participantSid: participant.callSid,
        phoneNumber
      });

      return participant;
    } catch (error) {
      logger.error('Failed to add participant to conference:', error);
      throw error;
    }
  }

  // Generate TwiML for different scenarios
  generateTwiML(scenario, options = {}) {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    switch (scenario) {
      case 'inbound_to_hubspot':
        // Route inbound call to HubSpot agent
        twiml.dial({ callerId: this.whatsappNumber }, (dial) => {
          dial.client(options.agentIdentity || 'hubspot-agent');
        });
        break;

      case 'conference_bridge':
        // Create conference bridge
        twiml.dial((dial) => {
          dial.conference(options.conferenceName, {
            startConferenceOnEnter: true,
            endConferenceOnExit: false,
            waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.ambient',
            statusCallback: options.statusCallback,
            statusCallbackEvent: 'start end join leave mute hold',
            statusCallbackMethod: 'POST'
          });
        });
        break;

      case 'voicemail':
        // Handle voicemail
        twiml.say('Please leave a message after the beep.');
        twiml.record({
          timeout: 30,
          transcribe: true,
          recordingStatusCallback: options.recordingCallback
        });
        break;

      case 'busy':
        // Busy signal
        twiml.reject({ reason: 'busy' });
        break;

      default:
        twiml.say('This call cannot be completed as dialed.');
        break;
    }

    return twiml.toString();
  }

  // Create content template for call permissions
  async createCallPermissionTemplate(templateName, language = 'en') {
    try {
      const content = await this.client.content.v1.contents.create({
        friendlyName: templateName,
        language: language,
        types: {
          'twilio/call-to-action': {
            body: 'We would like to call you. Do you approve?',
            actions: [{
              type: 'VOICE_CALL_REQUEST',
              title: 'Call Request'
            }]
          }
        }
      });

      logger.info('Call permission template created:', {
        contentSid: content.sid,
        templateName
      });

      return content;
    } catch (error) {
      logger.error('Failed to create call permission template:', error);
      throw error;
    }
  }

  // Create voice call button template
  async createVoiceCallTemplate(templateName, title, language = 'en', variables = {}) {
    try {
      const content = await this.client.content.v1.contents.create({
        friendlyName: templateName,
        language: language,
        variables: variables,
        types: {
          'twilio/card': {
            title: title,
            actions: [{
              title: 'Call now',
              type: 'VOICE_CALL'
            }]
          }
        }
      });

      logger.info('Voice call template created:', {
        contentSid: content.sid,
        templateName
      });

      return content;
    } catch (error) {
      logger.error('Failed to create voice call template:', error);
      throw error;
    }
  }
}

module.exports = new TwilioService();