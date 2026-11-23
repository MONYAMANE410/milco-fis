// Starts the API server and the Vite dev server together (Windows, Mac and Linux).
import { spawn } from 'node:child_process';

const node = process.execPath;
const procs = [
  spawn(node, ['server/index.js'], { stdio: 'inherit' }),
  spawn(node, ['node_modules/vite/bin/vite.js', '--open'], { stdio: 'inherit' }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
