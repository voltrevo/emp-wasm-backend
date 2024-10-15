import * as summon from 'summon-ts';
import { expect } from 'chai';
import EmpCircuit from '../src/EmpCircuit';

describe('EmpCircuit', () => {
  beforeEach(async () => {
    await summon.init();
  });

  it('converts OR into INV INV AND INV', () => {
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

    expect(ec.getSimplifiedBristol()).to.equal([
      '4 6',
      '1 1 1',
      '',
      '1 1 0 2 INV',
      '1 1 1 3 INV',
      '2 1 2 3 4 AND',
      '1 1 4 5 INV',
    ].join('\n'));
  });

  it('correctly evals circuit', () => {
    const circuit = summon.compileBoolean('/src/main.ts', 2, {
      '/src/main.ts': `
        export default function main(a: number, b: number) {
          return a + b;
        }
      `,
    });

    console.log(circuit.bristol);

    const ec = new EmpCircuit(
      circuit,
      [
        {
          inputs: ['a'],
          outputs: ['main'],
        },
        {
          inputs: ['b'],
          outputs: ['main'],
        },
      ],
    );

    const outputs = ec.eval(
      { a: 1 },
      { b: 1 },
    );

    expect(outputs).to.deep.equal({ main: 2 });
  });
});
