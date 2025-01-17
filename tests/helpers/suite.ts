type TestDefinition = { name: string, fn: () => unknown };

let suite: TestDefinition[] = [];
let failures = 0;
let autorun = true;

export async function test(name: string, fn: () => unknown) {
  suite.push({ name, fn });

  if (autorun) {
    queueMicrotask(runSuite);
  }
}

export function setSuiteAutorun(value: boolean) {
  autorun = value;
}

export async function runSuite() {
  if (suite.length === 0) {
    return;
  }

  const capturedSuite = suite;
  suite = [];

  console.log(`Running ${capturedSuite.length} tests...`);

  const puppeteerDetected = (globalThis as any).reportToPuppeteer !== undefined;

  for (const { name, fn } of capturedSuite) {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (e) {
      failures++;
      console.error(`❌ ${name}`);

      if (!puppeteerDetected) {
        console.error(e);
      } else {
        try {
          console.error((e as Error).stack);
        } catch {
          console.error(`${e}`);
        }
      }
    }
  }

  console.log(`Done running tests. ${failures} failure(s).`);

  return { pass: suite.length - failures, fail: failures };
}
