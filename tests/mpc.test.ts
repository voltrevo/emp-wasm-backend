import { expect } from 'chai';

import * as mpcf from 'mpc-framework';
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

  const protocol = new mpcf.Protocol(
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

async function runSide(
  protocol: mpcf.Protocol,
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
