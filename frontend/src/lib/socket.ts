import { io, Socket } from 'socket.io-client';

const URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

export const socket: Socket = io(URL, {
  autoConnect: false,
});
