import { createApplication } from './application.js';

const host = '127.0.0.1';
const port = 3000;

const { server, close } = createApplication();

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`Server failed to start: ${error.code ?? error.message}`);
  process.exitCode = 1;
  shutdown();
});

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

function shutdown() {
  void close().catch(() => { console.error('Server failed to close.'); process.exitCode = 1; });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
