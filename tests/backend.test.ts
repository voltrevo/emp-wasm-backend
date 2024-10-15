import { expect } from 'chai';
import EmpCircuit from '../src/EmpCircuit';

describe('EmpCircuit', () => {
  it('converts or into and,not', () => {
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
});
