const hubspot = require('@hubspot/api-client');
const config = require('../config/config');
const logger = require('../utils/logger');
const { HubSpotContact, Call } = require('../models');

class HubSpotService {
  constructor() {
    this.hubspotClient = new hubspot.Client({
      accessToken: config.hubspot.privateAppToken
    });
    this.portalId = config.hubspot.portalId;
  }

  // Get portal information
  async getPortalInfo() {
    try {
      const response = await this.hubspotClient.settings.users.usersApi.getById('me');
      return response;
    } catch (error) {
      logger.error('Failed to get portal info:', error);
      throw error;
    }
  }

  // Get contact by ID
  async getContact(contactId, properties = []) {
    try {
      const defaultProperties = [
        'email', 'firstname', 'lastname', 'phone', 'mobilephone', 
        'whatsapp_number', 'company', 'hs_object_id'
      ];
      
      const allProperties = [...defaultProperties, ...properties];
      
      const contact = await this.hubspotClient.crm.contacts.basicApi.getById(
        contactId, 
        allProperties
      );
      
      logger.info('Contact fetched from HubSpot:', { contactId });
      return contact;
    } catch (error) {
      logger.error(`Failed to get contact ${contactId}:`, error);
      throw error;
    }
  }

  // Search contacts by phone number
  async searchContactsByPhone(phoneNumber) {
    try {
      const filter = {
        propertyName: 'phone',
        operator: 'EQ',
        value: phoneNumber
      };

      const searchRequest = {
        filterGroups: [{ filters: [filter] }],
        properties: ['email', 'firstname', 'lastname', 'phone', 'mobilephone', 'whatsapp_number', 'company']
      };

      const results = await this.hubspotClient.crm.contacts.searchApi.doSearch(searchRequest);
      return results.results;
    } catch (error) {
      logger.error(`Failed to search contacts by phone ${phoneNumber}:`, error);
      throw error;
    }
  }

  // Search contacts by WhatsApp number
  async searchContactsByWhatsApp(whatsappNumber) {
    try {
      // Clean the WhatsApp number
      const cleanNumber = whatsappNumber.replace('whatsapp:', '');
      
      const filters = [
        {
          propertyName: 'whatsapp_number',
          operator: 'EQ',
          value: cleanNumber
        },
        {
          propertyName: 'mobilephone',
          operator: 'EQ',
          value: cleanNumber
        }
      ];

      const searchRequest = {
        filterGroups: filters.map(filter => ({ filters: [filter] })),
        properties: ['email', 'firstname', 'lastname', 'phone', 'mobilephone', 'whatsapp_number', 'company']
      };

      const results = await this.hubspotClient.crm.contacts.searchApi.doSearch(searchRequest);
      return results.results;
    } catch (error) {
      logger.error(`Failed to search contacts by WhatsApp ${whatsappNumber}:`, error);
      throw error;
    }
  }

  // Create or update contact
  async upsertContact(contactData) {
    try {
      let contact;
      
      // Try to find existing contact
      if (contactData.email) {
        const existingContacts = await this.searchContactsByEmail(contactData.email);
        if (existingContacts.length > 0) {
          contact = await this.updateContact(existingContacts[0].id, contactData);
        }
      }
      
      if (!contact) {
        contact = await this.createContact(contactData);
      }
      
      return contact;
    } catch (error) {
      logger.error('Failed to upsert contact:', error);
      throw error;
    }
  }

  // Create new contact
  async createContact(contactData) {
    try {
      const contact = await this.hubspotClient.crm.contacts.basicApi.create({
        properties: contactData
      });
      
      logger.info('Contact created in HubSpot:', { contactId: contact.id });
      return contact;
    } catch (error) {
      logger.error('Failed to create contact:', error);
      throw error;
    }
  }

  // Update existing contact
  async updateContact(contactId, updates) {
    try {
      const contact = await this.hubspotClient.crm.contacts.basicApi.update(
        contactId,
        { properties: updates }
      );
      
      logger.info('Contact updated in HubSpot:', { contactId });
      return contact;
    } catch (error) {
      logger.error(`Failed to update contact ${contactId}:`, error);
      throw error;
    }
  }

  // Search contacts by email
  async searchContactsByEmail(email) {
    try {
      const filter = {
        propertyName: 'email',
        operator: 'EQ',
        value: email
      };

      const searchRequest = {
        filterGroups: [{ filters: [filter] }],
        properties: ['email', 'firstname', 'lastname', 'phone', 'mobilephone', 'whatsapp_number', 'company']
      };

      const results = await this.hubspotClient.crm.contacts.searchApi.doSearch(searchRequest);
      return results.results;
    } catch (error) {
      logger.error(`Failed to search contacts by email ${email}:`, error);
      throw error;
    }
  }

  // Log call activity to HubSpot
  async logCallActivity(contactId, callData) {
    try {
      const activity = {
        objectId: contactId,
        objectType: 'CONTACT',
        activityType: 'CALL',
        timestamp: callData.startTime || new Date().toISOString(),
        properties: {
          hs_call_direction: callData.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND',
          hs_call_status: this.mapCallStatus(callData.status),
          hs_call_duration: callData.duration || 0,
          hs_call_from_number: callData.fromNumber,
          hs_call_to_number: callData.toNumber,
          hs_call_recording_url: callData.recordingUrl,
          hs_call_notes: callData.notes,
          hs_call_source: 'WhatsApp Business Calling'
        }
      };

      const result = await this.hubspotClient.crm.timeline.eventsApi.create(activity);
      
      logger.info('Call activity logged to HubSpot:', {
        contactId,
        activityId: result.id
      });
      
      return result;
    } catch (error) {
      logger.error('Failed to log call activity:', error);
      throw error;
    }
  }

  // Create call engagement
  async createCallEngagement(contactId, callData) {
    try {
      const engagement = {
        engagement: {
          active: true,
          type: 'CALL',
          timestamp: new Date(callData.startTime || Date.now()).getTime()
        },
        associations: {
          contactIds: [contactId]
        },
        metadata: {
          toNumber: callData.toNumber,
          fromNumber: callData.fromNumber,
          status: this.mapCallStatus(callData.status),
          durationMilliseconds: (callData.duration || 0) * 1000,
          recordingUrl: callData.recordingUrl,
          body: callData.notes || 'WhatsApp Business Call'
        }
      };

      const result = await this.hubspotClient.crm.engagements.engagementsApi.create(engagement);
      
      logger.info('Call engagement created in HubSpot:', {
        contactId,
        engagementId: result.engagement.id
      });
      
      return result;
    } catch (error) {
      logger.error('Failed to create call engagement:', error);
      throw error;
    }
  }

  // Get calling settings for a portal
  async getCallingSettings() {
    try {
      // This would be implemented when HubSpot provides the calling settings API
      // For now, return default settings
      return {
        enabled: true,
        provider: 'whatsapp-business-calling',
        settings: {
          supportsInbound: true,
          supportsOutbound: true,
          supportsRecording: true,
          supportsTransfer: false
        }
      };
    } catch (error) {
      logger.error('Failed to get calling settings:', error);
      throw error;
    }
  }

  // Update calling settings
  async updateCallingSettings(settings) {
    try {
      // This would be implemented when HubSpot provides the calling settings API
      logger.info('Calling settings would be updated:', settings);
      return settings;
    } catch (error) {
      logger.error('Failed to update calling settings:', error);
      throw error;
    }
  }

  // Sync contact data between local DB and HubSpot
  async syncContact(hubspotContactId) {
    try {
      const hubspotContact = await this.getContact(hubspotContactId);
      
      let localContact = await HubSpotContact.findOne({
        where: { hubspotContactId }
      });

      if (localContact) {
        await localContact.syncFromHubSpot(hubspotContact);
      } else {
        localContact = await HubSpotContact.create({
          hubspotContactId,
          email: hubspotContact.properties.email,
          phone: hubspotContact.properties.phone,
          whatsappNumber: hubspotContact.properties.whatsapp_number || 
                         hubspotContact.properties.mobilephone,
          firstName: hubspotContact.properties.firstname,
          lastName: hubspotContact.properties.lastname,
          company: hubspotContact.properties.company,
          hubspotProperties: hubspotContact.properties
        });
      }

      return localContact;
    } catch (error) {
      logger.error(`Failed to sync contact ${hubspotContactId}:`, error);
      throw error;
    }
  }

  // Map internal call status to HubSpot status
  mapCallStatus(status) {
    const statusMap = {
      'initiated': 'CALLING',
      'ringing': 'CALLING',
      'in-progress': 'ANSWERED',
      'completed': 'COMPLETED',
      'failed': 'FAILED',
      'busy': 'BUSY',
      'no-answer': 'NO_ANSWER',
      'canceled': 'CANCELED'
    };

    return statusMap[status] || 'COMPLETED';
  }

  // Create webhook subscription
  async createWebhookSubscription(callbackUrl, eventTypes) {
    try {
      const subscription = {
        eventType: 'contact.propertyChange',
        propertyName: 'whatsapp_number',
        active: true,
        webhookUrl: callbackUrl
      };

      // This would use HubSpot's webhook API when available
      logger.info('Webhook subscription would be created:', subscription);
      return subscription;
    } catch (error) {
      logger.error('Failed to create webhook subscription:', error);
      throw error;
    }
  }

  // Send calling extension events
  async sendCallingEvent(eventType, eventData) {
    try {
      // This integrates with the HubSpot Calling Extensions SDK
      logger.info('Calling event sent:', { eventType, eventData });
      
      // In a real implementation, this would send events to the frontend
      // via WebSocket or Server-Sent Events to update the HubSpot iframe
      
      return { success: true, eventType, timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error('Failed to send calling event:', error);
      throw error;
    }
  }
}

module.exports = new HubSpotService();