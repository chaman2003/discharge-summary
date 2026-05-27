import { createApp, loadEnv } from '../server/app.js';

loadEnv();
const app = createApp({ serveDist: false });

export default app;

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};
