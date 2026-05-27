import { createApp, attachWebSocket, getConfig, listen, loadEnv } from './app.js';

loadEnv();
const { port, geminiApiKey } = getConfig();
const app = createApp({ serveDist: true });
const server = attachWebSocket(app, geminiApiKey);
listen(server, port);
