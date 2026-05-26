const { spawn } = require('child_process');
const path = require('path');

const services = [
  { name: 'backend', cwd: 'mdoctor-backend', command: 'npm', args: ['run', 'dev'] },
  { name: 'panel', cwd: 'mdoctor-panel', command: 'npm', args: ['run', 'dev'] },
  { name: 'automation', cwd: 'mdoctor-automation', command: 'npm', args: ['run', 'dev'] }
];

const isWindows = process.platform === 'win32';
const children = [];

function prefix(name, data, stream) {
  String(data)
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => stream.write(`[${name}] ${line}\n`));
}

for (const service of services) {
  const child = spawn(isWindows ? `${service.command}.cmd` : service.command, service.args, {
    cwd: path.join(__dirname, '..', service.cwd),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isWindows
  });

  children.push(child);
  child.stdout.on('data', (data) => prefix(service.name, data, process.stdout));
  child.stderr.on('data', (data) => prefix(service.name, data, process.stderr));
  child.on('exit', (code) => {
    console.log(`[${service.name}] exited with code ${code}`);
  });
}

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
