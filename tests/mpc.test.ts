import { expect } from 'chai';

import { Protocol } from 'mpc-framework';
import * as summon from 'summon-ts';

import { EmpWasmBackend } from '../src';

import { test } from './helpers/suite';
import AsyncQueueStore from './helpers/AsyncQueueStore';

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

  const aqs = new AsyncQueueStore<Uint8Array>();

  const outputs = await Promise.all([
    runParty(protocol, 'alice', { a: 3 }, aqs),
    runParty(protocol, 'bob', { b: 5 }, aqs),
  ]);

  expect(outputs).to.deep.equal([{ main: 5 }, { main: 5 }]);
});

test("middle(8, 17, 5) == 8", async () => {
  await summon.init();

  const circuit = summon.compileBoolean('/src/main.ts', 8, {
    '/src/main.ts': `
      export default function main(
        a: number,
        b: number,
        c: number,
      ) {
        const nums = [a, b, c];

        const highest = a;
        const secondHighest = 0;

        for (let i = 1; i < nums.length; i++) {
          if (nums[i] > highest) {
            secondHighest = highest;
            highest = nums[i];
          } else if (nums[i] > secondHighest) {
            secondHighest = nums[i];
          }
        }

        return secondHighest;
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
    {
      name: 'charlie',
      inputs: ['c'],
      outputs: ['main'],
    },
  ];

  const protocol = new Protocol(
    circuit,
    mpcSettings,
    new EmpWasmBackend(),
  );

  const aqs = new AsyncQueueStore<Uint8Array>();

  const outputs = await Promise.all([
    runParty(protocol, 'alice', { a: 8 }, aqs),
    runParty(protocol, 'bob', { b: 17 }, aqs),
    runParty(protocol, 'charlie', { c: 5 }, aqs),
  ]);

  expect(outputs).to.deep.equal([
    { main: 8 },
    { main: 8 },
    { main: 8 },
  ]);
});

// FIXME: this test is skipped
// FIXME: use 5 bidders and auction house (which doesn't bid but observes)
// NOTE:  this circuit also failed with consensus on the same bad outputs before
//        the N parties upgrade, so there's something else going on:
//        https://github.com/voltrevo/emp-wasm-backend/commit/be67477
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
      inputs: ['b'],
      outputs: ['main[0]', 'main[1]'],
    },
    {
      name: 'charlie',
      inputs: ['c'],
      outputs: ['main[0]', 'main[1]'],
    },
  ];

  const protocol = new Protocol(
    circuit,
    mpcSettings,
    new EmpWasmBackend(),
  );

  const aqs = new AsyncQueueStore<Uint8Array>();

  const outputs = await Promise.all([
    runParty(protocol, 'alice', { a: 8 }, aqs),
    runParty(protocol, 'bob', { b: 17 }, aqs),
    runParty(protocol, 'charlie', { c: 5 }, aqs),
  ]);

  expect(outputs).to.deep.equal([
    // Participant index 1 (Bob) wins the auction with the highest bid, but only
    // pays the second highest bid. His actual bid is kept secret.
    { 'main[0]': 1, 'main[1]': 8 },
    { 'main[0]': 1, 'main[1]': 8 },
    { 'main[0]': 1, 'main[1]': 8 },
  ]);
});

async function runParty(
  protocol: Protocol,
  party: string,
  input: Record<string, number>,
  aqs: AsyncQueueStore<Uint8Array>,
) {
  const session = protocol.join(
    party,
    input,
    (to, msg) => {
      aqs.get(party, to).push(msg);
    },
  );

  const partyNames = protocol.mpcSettings.map(
    ({ name }, i) => name ?? `party${i}`,
  );

  for (const otherParty of partyNames) {
    if (otherParty !== party) {
      aqs.get(otherParty, party).stream(
        data => session.handleMessage(otherParty, data),
      );
    }
  }

  const output = await session.output();

  return output;
}
