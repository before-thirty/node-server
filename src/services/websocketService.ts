import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer | null = null;

export const initializeWebSocket = (server: HttpServer): SocketIOServer => {
  io = new SocketIOServer(server, {
    cors: {
      origin: "*", // In production, replace with your actual frontend domain
      methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    
    // Handle client joining trip rooms
    socket.on('join-trip', (tripId: string) => {
      socket.join(`trip-${tripId}`);
      console.log(`👥 Client ${socket.id} joined trip room: trip-${tripId}`);
    });

    // Handle client leaving trip rooms
    socket.on('leave-trip', (tripId: string) => {
      socket.leave(`trip-${tripId}`);
      console.log(`👋 Client ${socket.id} left trip room: trip-${tripId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

  return io;
};

export const getSocketIO = (): SocketIOServer | null => {
  return io;
};

// Emit content processing status to specific trip room
export const emitContentProcessingStatus = (
  tripId: string, 
  contentId: string, 
  status: 'processing' | 'completed' | 'failed',
  data?: any
) => {
  if (!io) {
    console.warn('⚠️ WebSocket not initialized');
    return;
  }

  const event = `content-${status}`;
  const payload = {
    contentId,
    status,
    timestamp: new Date().toISOString(),
    ...data
  };

  io.to(`trip-${tripId}`).emit(event, payload);
  console.log(`📡 Emitted ${event} to trip-${tripId}:`, payload);
};