import { exec } from 'child_process';
import { globIterate } from 'glob';
import { runSuite, setSuiteAutorun } from './helpers/suite';

const projectRoot = (
  await shell('git', ['rev-parse', '--show-toplevel'])
).trim();

const pattern = `${projectRoot}/tests/**/*.test.ts`;

setSuiteAutorun(false);

for await (const filePath of globIterate(pattern)) {
  await import(filePath);
}

const result = await runSuite();

if (result === undefined || result.fail > 0) {
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
