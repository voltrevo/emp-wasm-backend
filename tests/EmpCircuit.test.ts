import { expect } from 'chai';

import * as summon from 'summon-ts';
import EmpCircuit from '../src/EmpCircuit';
import { test } from './helpers/suite';

test('converts OR into INV INV AND INV', async () => {
  await summon.init();

  const ec = new EmpCircuit(
    {
      bristol: `
        1 3
        2 1 1
        1 1

        2 1 0 1 2 OR
      `,
      info: {
        input_name_to_wire_index: {
          a: 0,
          b: 1,
        },
        constants: {},
        output_name_to_wire_index: {
          c: 2,
        },
      },
    },
    [
      {
        inputs: ['a'],
        outputs: ['c'],
      },
      {
        inputs: ['b'],
        outputs: ['c'],
      },
    ],
  );

  expect(ec.getSimplifiedBristol()).to.deep.equal([
    '4 6',
    '1 1 1',
    '',
    '1 1 0 2 INV',
    '1 1 1 3 INV',
    '2 1 2 3 4 AND',
    '1 1 4 5 INV',
  ].join('\n'));
});

test('correctly evals circuit', async () => {
  await summon.init();

  const circuit = summon.compileBoolean('/src/main.ts', 4, {
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
