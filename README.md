# AutoScroll Backend API

Backend API server for AutoScroll Chrome Extension with UPI AutoPay mandate support.

## Features

- 🔐 User authentication and device verification
- 💳 Razorpay UPI AutoPay mandate integration
- 📊 Admin dashboard for monitoring
- 🔄 Automated recurring payment processing
- 🛡️ Security enhancements and trial abuse prevention

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB Atlas
- **Payment Gateway:** Razorpay
- **Authentication:** JWT
- **Cron Jobs:** node-cron

## Environment Variables

Required environment variables (see `.env.example`):

```env
NODE_ENV=production
PORT=10000
API_BASE_URL=https://your-app.onrender.com
MONGODB_URI=your_mongodb_connection
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_PLAN_ID=your_plan_id
JWT_SECRET=your_jwt_secret
```

## Deployment

### Render.com (Recommended)

1. Create new Web Service
2. Connect this repository
3. Configure build settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables
5. Deploy

### Local Development

```bash
npm install
npm start
```

## API Endpoints

- `POST /api/users/register` - User registration
- `POST /api/upi-autopay/create-autopay` - Create UPI AutoPay subscription
- `POST /api/upi-autopay/webhook` - Razorpay AutoPay webhooks
- `GET /api/admin/dashboard` - Admin dashboard

## Webhook URL

For Razorpay webhook configuration:
```
https://your-app.onrender.com/api/upi-autopay/webhook
```

## License

MIT
