import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createStudioRouter } from './server/routes/studio.ts';

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '16mb' }));
  app.use('/api', createStudioRouter());

  // Ensure Multer / body-parser errors always return structured JSON
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!err) {
        next();
        return;
      }
      const message = err instanceof Error ? err.message : 'Request failed on server.';
      if (!res.headersSent) {
        res.status(400).json({ error: message });
      }
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`SceneSync Studio listening on http://localhost:${port}`);
  });
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 65_000;
}

void startServer();
