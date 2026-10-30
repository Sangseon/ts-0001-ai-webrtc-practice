// Test-owned process: diagnostics travel only over Node IPC, never HTTP/WebSocket.
(async () => {
  const { createApplication } = await import('../server/dist/application.js');
  const app = createApplication({ inspectMedia: true, heartbeatIntervalMs: 500 });
  app.server.listen(3000, '127.0.0.1');
  process.on('message', async message => {
    try {
      let result;
      if (message.action === 'snapshot') result = await app.diagnostics.snapshot();
      else if (message.action === 'closeRouter') app.diagnostics.closeRouter(message.roomId);
      else if (message.action === 'closeTransport') app.diagnostics.closeTransport(message.participantId);
      else if (message.action === 'shutdown') { await app.close(); result = await app.diagnostics.snapshot(); }
      else throw Error('Unknown test action');
      process.send({ id: message.id, result });
    } catch (error) { process.send({ id: message.id, error: String(error) }); }
  });
  process.on('disconnect', () => { void app.close().finally(() => process.exit()); });
})().catch(error => { console.error(error); process.exitCode=1; });
