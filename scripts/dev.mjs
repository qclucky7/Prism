import { createServer } from 'vite';
import { backendOrigin, cargo, startNative, stopNative, waitForExit } from './native.mjs';

await cargo('build');
const backend = startNative();
const exited = waitForExit(backend, 'Prism');
// Observe early failures while Vite is starting; await the same result below.
void exited.catch(() => {});
backend.stdout.pipe(process.stdout);
backend.stderr.pipe(process.stderr);
let frontend;
let closing;
const close = () => closing ??= (async () => {
  await frontend?.close();
  await stopNative(backend);
})();
process.once('SIGINT', close);
process.once('SIGTERM', close);
try {
  process.env.PRISM_API_ORIGIN = await backendOrigin(backend);
  frontend = await createServer();
  await frontend.listen();
  frontend.printUrls();
  await exited;
} finally {
  await close();
  process.off('SIGINT', close);
  process.off('SIGTERM', close);
}
