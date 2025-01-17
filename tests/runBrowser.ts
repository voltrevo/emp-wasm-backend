import { createServer } from 'vite';
import launchBrowser from './helpers/launchBrowser';

const port = 6173;
const url = `http://localhost:${port}`;

const server = await createServer({
  configFile: import.meta.resolve('./vite.config.ts').replace('file://', ''),
  server: { port },
});

await server.listen();
console.log('Dev server running at:', url);

const browser = await launchBrowser();

const page = await browser.newPage();
await page.goto(url);

page.on('console', (message) => {
  console.log('Page log:', message.text());
});

await new Promise<void>((resolve, reject) => {
  page.exposeFunction('reportToPuppeteer', (result?: { pass: number, fail: number }) => {
    if (result === undefined || result.fail > 0) {
      reject(new Error('Test run failed.'));
    } else {
      resolve();
    }
  }).catch(reject);
});

await browser.close();
await server.close();
