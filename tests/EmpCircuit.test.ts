import { expect } from 'chai';

import * as summon from 'summon-ts';
import EmpCircuit from '../src/EmpCircuit';
import { test } from './helpers/suite';

test('correctly evals circuit', async () => {
  await summon.init();

  const { circuit } = summon.compileBoolean('/src/main.ts', 4, {
    '/src/main.ts': `
      export default function main(a: number, b: number) {
        return a * b;
      }
    `,
  });

  const ec = new EmpCircuit(
    circuit,
    [
      {
        name: 'alice',
        inputs: ['a'],
        outputs: ['main'],
      },
      {
        name: 'bob',
        inputs: ['b'],
        outputs: ['main'],
      },
    ],
  );

  const outputs = ec.eval({
    alice: { a: 3 },
    bob: { b: 5 },
  });

  expect(outputs).to.deep.equal({ main: 15 });
});
