import { execSync } from 'node:child_process';

const port = 5001;
const command = `netstat -ano | findstr :${port}`;

try {
  const output = execSync(command, {
    encoding: 'utf8',
    shell: 'cmd.exe',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  if (!output) {
    console.log(`Port ${port} is already free.`);
    process.exit(0);
  }

  const pids = new Set();

  for (const line of output.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const parts = trimmedLine.split(/\s+/);
    const pid = parts[parts.length - 1];

    if (/^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, {
        encoding: 'utf8',
        shell: 'cmd.exe',
        stdio: 'ignore',
      });
      console.log(`Stopped process ${pid} on port ${port}.`);
    } catch {
      console.log(`Could not stop process ${pid} on port ${port}.`);
    }
  }
} catch (error) {
  console.log(`Port ${port} is already free.`);
}
