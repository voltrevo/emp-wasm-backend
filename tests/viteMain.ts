import { runSuite, setSuiteAutorun } from "./helpers/suite";

setSuiteAutorun(false);

const modules = import.meta.glob('./**/*.test.ts');

for (const path in modules) {
  await modules[path]();
}

const runResult = await runSuite();

let attempts = 0;

while (true) {
  const reportFn = (window as any).reportToPuppeteer;

  if (typeof reportFn === 'function') {
    reportFn(runResult);
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  attempts++;
}
