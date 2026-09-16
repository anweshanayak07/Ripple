const io = require('socket.io-client');
const socket = io('http://127.0.0.1:3001');

socket.on('connect', () => {
  console.log('Connected to socket!');
  socket.emit('join-room', { eventCode: '8C875H', role: 'audience', name: 'Tester' });
});

socket.on('poll-launched', (poll) => {
  console.log('--- POLL LAUNCHED ---');
  console.log(poll);
  if (poll.launchedAt) {
    console.log('launchedAt type:', typeof poll.launchedAt);
    console.log('launchedAt value:', poll.launchedAt);
    const elapsed = Math.floor((Date.now() - new Date(poll.launchedAt).getTime()) / 1000);
    console.log('Elapsed:', elapsed);
    console.log('Timer:', poll.timer);
    console.log('Time left:', Math.max(0, poll.timer - elapsed));
  } else {
    console.log('NO LAUNCHED AT');
  }
});
