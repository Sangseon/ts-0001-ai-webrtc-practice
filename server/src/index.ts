import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 3000;

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`Server failed to start: ${error.code ?? error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error('Server failed to close.');
      process.exitCode = 1;
    }
  });
  server.closeIdleConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
