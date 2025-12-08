import readline from 'node:readline';
import { spawn } from 'node:child_process';

const choices = ['patch', 'minor', 'major'];

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

(async () => {
  const answer = (await prompt(`Bump type (${choices.join('/')})? `)).trim().toLowerCase();
  if (!choices.includes(answer)) {
    console.error('Invalid choice. Use patch, minor, or major.');
    process.exit(1);
  }
  await run('npm', ['version', answer]);
})();
