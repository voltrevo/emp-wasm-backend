import { expect } from 'chai';

import { Protocol } from 'mpc-framework';
import * as summon from 'summon-ts';


import { EmpWasmBackend } from '../src';
import assert from '../src/assert';

import AsyncQueue from './helpers/AsyncQueue';
import { test } from './helpers/suite';

test("max(3, 5) === 5", async () => {
  await summon.init();

  const circuit = summon.compileBoolean('/src/main.ts', 16, {
    '/src/main.ts': `
      export default function main(a: number, b: number) {
        return a > b ? a : b;
      }
    `,
  });

  const mpcSettings = [
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
  ];

  const protocol = new Protocol(
    circuit,
    mpcSettings,
    new EmpWasmBackend(),
  );

  const aliceQueue = new AsyncQueue<Uint8Array>();
  const bobQueue = new AsyncQueue<Uint8Array>();

  const outputs = await Promise.all([
    runSide(protocol, 'alice', { a: 3 }, aliceQueue, bobQueue),
    runSide(protocol, 'bob', { b: 5 }, aliceQueue, bobQueue),
  ]);

  expect(outputs).to.deep.equal([{ main: 5 }, { main: 5 }]);
});

test("vickrey(8, 17, 5) == [1, 8]", async () => {
  await summon.init();

  const circuit = summon.compileBoolean('/src/main.ts', 8, {
    '/src/main.ts': `
      export default function main(
        a: number,
        b: number,
        c: number,
      ) {
        const nums = [a, b, c];

        const winner = 0;
        const highest = a;
        const secondHighest = 0;

        for (let i = 1; i < nums.length; i++) {
          if (nums[i] > highest) {
            secondHighest = highest;
            highest = nums[i];
            winner = i;
          } else if (nums[i] > secondHighest) {
            secondHighest = nums[i];
          }
        }

        return [winner, secondHighest];
      }
    `,
  });

  const mpcSettings = [
    {
      name: 'alice',
      inputs: ['a'],
      outputs: ['main[0]', 'main[1]'],
    },
    {
      name: 'bob',
      inputs: ['b', 'c'],
      outputs: ['main[0]', 'main[1]'],
    },
    // {
    //   name: 'charlie',
    //   inputs: ['c'],
    //   outputs: ['main[0]', 'main[1]'],
    // },
  ];

  const protocol = new Protocol(
    circuit,
    mpcSettings,
    new EmpWasmBackend(),
  );

  const aliceQueue = new AsyncQueue<Uint8Array>();
  const bobQueue = new AsyncQueue<Uint8Array>();

  const outputs = await Promise.all([
    runSide(protocol, 'alice', { a: 8 }, aliceQueue, bobQueue),
    runSide(protocol, 'bob', { b: 17, c: 5 }, aliceQueue, bobQueue),
    // runSide(protocol, 'charlie', { c: 5 }, aliceQueue, bobQueue),
  ]);

  expect(outputs).to.deep.equal([
    // Participant index 1 (Bob) wins the auction with the highest bid, but only
    // pays the second highest bid. His actual bid is kept secret.
    { 'main[0]': 1, 'main[1]': 8 },
    { 'main[0]': 1, 'main[1]': 8 },
    // { 'main[0]': 1, 'main[1]': 8 },
  ]);
});

async function runSide(
  protocol: Protocol,
  side: 'alice' | 'bob',
  input: Record<string, number>,
  aliceQueue: AsyncQueue<Uint8Array>,
  bobQueue: AsyncQueue<Uint8Array>,
) {
  const otherSide = side === 'alice' ? 'bob' : 'alice';
  const myQueue = side === 'alice' ? aliceQueue : bobQueue;
  const otherQueue = side === 'alice' ? bobQueue : aliceQueue;

  const session = protocol.join(
    side,
    input,
    (to, msg) => {
      assert(to === otherSide);
      otherQueue.push(msg);
    },
  );

  myQueue.stream(data => session.handleMessage(otherSide, data));

  const output = await session.output();

  return output;
}
