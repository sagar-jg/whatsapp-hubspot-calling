# WhatsApp Business Calling + HubSpot Integration

A comprehensive solution for integrating WhatsApp Business Calling with HubSpot CRM using Twilio's Voice API and WebRTC for 2-legged conference calls.

## Features

- ✅ **Inbound WhatsApp Calls**: Customers call via WhatsApp, rings in HubSpot
- ✅ **Outbound WhatsApp Calls**: Agents call prospects from HubSpot CRM
- ✅ **Call Permission Management**: Compliant with Twilio's WhatsApp calling rules
- ✅ **WebRTC Integration**: 2-legged conference calls with virtual numbers
- ✅ **HubSpot SDK**: Full integration with Calling Extensions SDK
- ✅ **Call Logging**: Automatic call recording and CRM integration
- ✅ **Real-time Events**: Call status updates and notifications

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   HubSpot CRM   │◄──►│   Frontend App   │◄──►│  Backend Server │
│  (Calling SDK)  │    │   (React + SDK)  │    │ (Node.js + API) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                        ▲
                                                        │
                                                ┌───────▼────────┐
                                                │  Twilio Voice  │
                                                │   WhatsApp     │
                                                │   WebRTC       │
                                                └────────────────┘
```

## Setup

### Prerequisites

- Node.js 18+
- Twilio Account with WhatsApp Business API
- HubSpot Developer Account
- ngrok for local development

### Environment Variables

Create `.env` files in both frontend and backend directories:

**Backend (.env)**:
```bash
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+1234567890
TWILIO_TWIML_APP_SID=your_twiml_app_sid
HUBSPOT_PRIVATE_APP_TOKEN=your_hubspot_token
DATABASE_URL=your_database_url
PORT=3001
```

**Frontend (.env)**:
```bash
REACT_APP_BACKEND_URL=http://localhost:3001
REACT_APP_HUBSPOT_PORTAL_ID=your_portal_id
```

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sagar-jg/whatsapp-hubspot-calling.git
   cd whatsapp-hubspot-calling
   ```

2. **Install backend dependencies**:
   ```bash
   cd backend
   npm install
   ```

3. **Install frontend dependencies**:
   ```bash
   cd ../frontend
   npm install
   ```

4. **Start the development servers**:
   ```bash
   # Terminal 1 - Backend
   cd backend
   npm run dev
   
   # Terminal 2 - Frontend
   cd frontend
   npm start
   ```

5. **Setup ngrok for webhooks**:
   ```bash
   ngrok http 3001
   ```

## Configuration

### Twilio Setup

1. **WhatsApp Sender**: Configure your WhatsApp Business number in Twilio Console
2. **TwiML Application**: Create a TwiML app pointing to your webhook URL
3. **Voice Configuration**: Set the TwiML app in your WhatsApp sender settings

### HubSpot Setup

1. **Create HubSpot App**: In your developer account
2. **Install Calling Extensions**: Add the calling extension to your app
3. **Configure Webhooks**: Point to your backend API endpoints

## API Endpoints

### Backend API

- `POST /api/calls/inbound` - Handle inbound WhatsApp calls
- `POST /api/calls/outbound` - Initiate outbound calls
- `POST /api/calls/permission` - Request call permissions
- `GET /api/calls/status/:callSid` - Get call status
- `POST /api/hubspot/webhook` - HubSpot event webhooks

### Twilio Webhooks

- `POST /webhook/voice` - Voice call webhooks
- `POST /webhook/messaging` - WhatsApp message webhooks
- `POST /webhook/call-status` - Call status updates

## Testing

Run the test suites:

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# Integration tests
npm run test:integration
```

## Deployment

### Production Setup

1. **Backend**: Deploy to Heroku, AWS, or similar
2. **Frontend**: Deploy to Netlify, Vercel, or serve from backend
3. **Database**: Configure production database (PostgreSQL recommended)
4. **Environment**: Update all environment variables for production

### Security Considerations

- All webhook endpoints are validated with Twilio signatures
- HubSpot webhooks use token authentication
- CORS properly configured for production domains
- Rate limiting implemented for API endpoints

## Usage

### Making Outbound Calls

1. Open a contact in HubSpot
2. Click the call button
3. Select "WhatsApp Calling" provider
4. System automatically requests permission if needed
5. Once approved, call is initiated

### Receiving Inbound Calls

1. Customer calls your WhatsApp Business number
2. Call automatically appears in HubSpot
3. Agent can answer within the CRM interface
4. Call details are logged to the contact record

## Compliance

- **Call Permissions**: Automatic compliance with Twilio's permission rules
- **Rate Limits**: Built-in rate limiting for call permission requests
- **Call Logs**: Complete audit trail of all calls
- **GDPR Ready**: Data handling compliant with privacy regulations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/sagar-jg/whatsapp-hubspot-calling/issues)
- Documentation: [Wiki](https://github.com/sagar-jg/whatsapp-hubspot-calling/wiki)

---

**Built with ❤️ using Twilio, HubSpot, and modern web technologies**