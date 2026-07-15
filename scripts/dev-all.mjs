import { spawn, spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

// Clear ports before starting services to avoid EADDRINUSE errors
spawnSync(npmCommand, ['run', 'clear-port-5001'], { stdio: 'inherit', shell: true });
spawnSync(npmCommand, ['run', 'clear-port-3000'], { stdio: 'inherit', shell: true });

const childProcesses = [];

// Start the API server first so it has time to connect to MongoDB before
// Vite begins proxying requests. Without this delay, the first browser
// requests arrive before port 5001 is listening, producing ECONNREFUSED.
const apiProcess = spawn(npmCommand, ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit', shell: true });
childProcesses.push(apiProcess);

// Give the API server ~2.5 s to bind before Vite starts
await new Promise((resolve) => setTimeout(resolve, 2500));

const viteProcess = spawn('vite', ['--port=3000', '--host=0.0.0.0'], { stdio: 'inherit', shell: true });
childProcesses.push(viteProcess);

const shutdown = (signal) => {
  for (const childProcess of childProcesses) {
    if (!childProcess.killed) {
      childProcess.kill(signal);
    }
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const childProcess of childProcesses) {
  childProcess.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exitCode = code;
    }
  });
}