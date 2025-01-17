import { spawn, exec } from 'child_process';
import { globIterate } from 'glob';

const projectRoot = (await shell('git', ['rev-parse', '--show-toplevel'])).trim();

const pattern = `${projectRoot}/tests/**/*.test.ts`;

const summary = [''];
let allPassed = true;

for await (const filePath of globIterate(pattern)) {
  let pass = true;

  try {
    await shellTerminal(`${projectRoot}/node_modules/.bin/tsx`, [filePath]);
  } catch {
    pass = false;
    allPassed = false;
  }

  summary.push(`${pass ? '✅' : '❌'} ${filePath.replace(projectRoot + '/', '')}`);
}

console.log(summary.join('\n'));

console.log();
console.log(allPassed ? 'All tests passed' : 'Some tests failed');

if (!allPassed) {
  process.exit(1);
}

// uses exec to get stdout of a command as a promise<string>
async function shell(program: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    exec(`${program} ${args.join(' ')}`, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function shellTerminal(program: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'inherit' });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}
