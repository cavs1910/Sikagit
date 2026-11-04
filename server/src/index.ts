import editorRoutes from './routes/editor';
import aiRoutes from './routes/ai';
import { requestGuard } from './security';
import { accessGuard, authRouter, hasBasic, sessionMiddleware, sessionEvents, sessionStore } from './auth';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import reposRouter from './routes/repos';
import projectsRouter from './routes/projects';
import gitRouter from './routes/git';
import browseRouter from './routes/browse';
import { errorHandler } from './middleware/errorHandler';

const PORT = process.env.PORT || 3001;

const app = express();
const httpServer = createServer(app);
app.use(requestGuard);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(s => s.trim());

const io = new SocketServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: ALLOWED_ORIGINS,
}));

// API replies describe live git state - never let the browser (or a proxy)
// reuse an earlier reply for the same URL. Express still adds an ETag, so a
// revalidation can 304, but the body is always recomputed server-side.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api', sessionMiddleware);
app.use('/api/v1/auth', authRouter);
app.use('/api', accessGuard);
app.use(express.json({ limit: '5mb' }));

io.engine.use(requestGuard as any);
io.engine.use(sessionMiddleware as any);
io.engine.use(accessGuard as any);

// Routes
app.use('/api/v1/repos', reposRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/git', gitRouter);
app.use('/api/v1/browse', browseRouter);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/editor', editorRoutes);

// Health check
app.get('/api/v1/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Serve built client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve('/app/client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use(errorHandler);

// Revoke existing connections as well as subsequent HTTP/handshake requests.
sessionEvents.on('revoked', (id: string) => {
  for (const socket of io.sockets.sockets.values()) {
    if ((socket.request as express.Request).sessionID === id) socket.disconnect(true);
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  const request = socket.request as express.Request;
  socket.use((_packet, next) => {
    if (hasBasic(request)) { next(); return; }
    sessionStore.get(request.sessionID, (err, value) => {
      if (err || !value?.authenticated || Number(value.expiresAt) <= Date.now()) { socket.disconnect(true); return; }
      next();
    });
  });

  socket.on('watch:repo', (repoPath: string) => {
    console.log(`[Socket] Watching repo: ${repoPath}`);
    socket.join(`repo:${repoPath}`);
  });

  socket.on('unwatch:repo', (repoPath: string) => {
    socket.leave(`repo:${repoPath}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[SikaGit] Server running on http://localhost:${PORT}`);
});

export { io };
