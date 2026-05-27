import fs from 'fs/promises';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp, attachWebSocket, getConfig, listen, ROOT, loadEnv } from './app.js';

loadEnv();
const { port, geminiApiKey } = getConfig();
const app = createApp({ serveDist: false });
const server = attachWebSocket(app, geminiApiKey);

const vite = await createViteServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  server: {
    middlewareMode: true,
    hmr: { server },
  },
  appType: 'custom',
});

function isBackendRoute(pathname) {
  return pathname.startsWith('/api')
    || pathname.startsWith('/ws')
    || pathname.startsWith('/audio-processors');
}

app.use(vite.middlewares);

app.use('*', async (req, res, next) => {
  if (isBackendRoute(req.path)) {
    return next();
  }
  try {
    const template = await fs.readFile(path.join(ROOT, 'index.html'), 'utf-8');
    const html = await vite.transformIndexHtml(req.originalUrl, template);
    res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
  } catch (err) {
    vite.ssrFixStacktrace(err);
    next(err);
  }
});

listen(server, port, { label: 'Discharge Summary dev' });
