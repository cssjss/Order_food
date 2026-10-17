import { createApp } from './app.js';

const { app, expireOrders } = createApp();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => console.log(`Pickup API listening on http://${host}:${port}`));
expireOrders().catch(console.error);
setInterval(() => expireOrders().catch(console.error), 30 * 1000).unref();
