import express from 'express';
import { createStudioRouter } from '../../server/routes/studio.ts';
const app = express();
app.use(express.json());
app.use('/api', createStudioRouter());
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.send?.(address.port);
});
process.on('message', () => server.close(() => process.exit(0)));
