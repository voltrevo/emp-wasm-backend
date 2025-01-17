import { runSuite, setSuiteAutorun } from "./helpers/suite";

setSuiteAutorun(false);

const modules = import.meta.glob('./**/*.test.ts');

for (const path in modules) {
  await modules[path]();
}

runSuite();
