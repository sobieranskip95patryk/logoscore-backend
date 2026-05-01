import { Server as HttpServer } from 'http';
import { Server as IoServer, Socket } from 'socket.io';
import type { EventBus } from '../../core/events/event-bus';
import { appConfig } from '../../core/config/app.config';
import { analyzeQueryUseCase } from '../../modules/logos/application/analyze-query.usecase';
import { eventBus as bus } from '../../core/events/event-bus';
import { socketAuthMiddleware, canJoinRoom, SocketUser } from '../../shared/middleware/socket-auth.middleware';

interface AnalyzePayload {
  sessionId: string;
  query: string;
  imageData?: string;
  imageMimeType?: string;
  uid?: string;
}

/**
 * Socket gateway — most realtime między rdzeniem (EventBus) a klientami WS.
 * Każde zdarzenie z EventBus jest broadcastowane jako "logos.event".
 *
 * Sprint VIII fortyfikacja:
 *   - `io.use(socketAuthMiddleware)` — handshake Firebase ID token (lub anonim gdy ALLOW_ANONYMOUS)
 *   - `canJoinRoom()` — guard pokoi `session:<id>` przeciw eskalacji horyzontalnej
 *   - broadcast EventBus → io filtruje po canJoinRoom (admin słyszy wszystko)
 */
export function createSocketGateway(server: HttpServer, _bus: EventBus): IoServer {
  const io = new IoServer(server, {
    cors: { origin: appConfig.corsOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 12 * 1024 * 1024
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser | undefined;
    console.log(`[ws] client connected: ${socket.id} uid=${user?.uid ?? '-'} role=${user?.role ?? '-'}`);
    socket.emit('logos.welcome', {
      id: socket.id,
      uid: user?.uid ?? null,
      role: user?.role ?? null,
      ts: new Date().toISOString()
    });

    socket.on('subscribe', (sessionId: string) => {
      if (!sessionId) return;
      if (!canJoinRoom(user, sessionId)) {
        socket.emit('logos.subscribe.error', { sessionId, error: 'forbidden_room' });
        return;
      }
      socket.join(`session:${sessionId}`);
    });

    socket.on('logos.stream', async (payload: AnalyzePayload) => {
      try {
        if (!payload?.sessionId || !payload?.query) {
          socket.emit('logos.stream.error', { message: 'sessionId_and_query_required' });
          return;
        }
        if (!canJoinRoom(user, payload.sessionId)) {
          socket.emit('logos.stream.error', { message: 'forbidden_room' });
          return;
        }
        socket.join(`session:${payload.sessionId}`);
        for await (const chunk of analyzeQueryUseCase.runStream(payload.sessionId, {
          query: payload.query,
          imageData: payload.imageData,
          imageMimeType: payload.imageMimeType,
          uid: user?.uid ?? payload.uid
        })) {
          socket.emit('logos.stream.chunk', chunk);
          bus.publish('logos.analyze.chunk', { delta: chunk.delta, done: chunk.done }, payload.sessionId);
        }
      } catch (err) {
        socket.emit('logos.stream.error', { message: (err as Error).message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });

  _bus.subscribe('*', (envelope) => {
    if (envelope.sessionId) {
      io.to(`session:${envelope.sessionId}`).emit('logos.event', envelope);
    } else {
      io.emit('logos.event', envelope);
    }
  });

  return io;
}
