import * as mpcf from 'mpc-framework';
import * as summon from 'summon-ts';

import { Protocol } from 'mpc-framework';
import { EmpWasmBackend } from './src';
import assert from './src/assert';
import { LocalComms, makeLocalCommsPair } from './tests/helpers/LocalComms';

async function main() {
  await summon.init();

  const [aliceComms, bobComms] = makeLocalCommsPair();

  const circuit = summon.compileBoolean('/src/main.ts', 4, {
    '/src/main.ts': `
      export default function main(a: number, b: number) {
        return [a + b, a * b];
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
  ];

  const protocol = new mpcf.Protocol(
    circuit,
    mpcSettings,
    new EmpWasmBackend(),
  );

  const startTime = Date.now();

  const outputs = await Promise.all([
    runAlice(protocol, aliceComms),
    runBob(protocol, bobComms),
  ]);

  const endTime = Date.now();

  console.log(endTime - startTime, outputs);
}

async function runAlice(protocol: Protocol, comms: LocalComms) {
  const session = protocol.join(
    'alice',
    { a: 3 },
    (to, msg) => {
      assert(to === 'bob');
      comms.send(msg);
    },
  );

  const buffered = comms.recv();

  if (buffered.length > 0) {
    session.handleMessage('bob', buffered);
  }

  comms.recvBuf.on('data', data => session.handleMessage('bob', data));

  const output = await session.output();

  return output;
}

async function runBob(protocol: Protocol, comms: LocalComms) {
  const session = protocol.join(
    'bob',
    { b: 5 },
    (to, msg) => {
      assert(to === 'alice');
      comms.send(msg);
    },
  );

  const buffered = comms.recv();

  if (buffered.length > 0) {
    session.handleMessage('alice', buffered);
  }

  comms.recvBuf.on('data', data => session.handleMessage('alice', data));

  const output = await session.output();

  return output;
}

main().catch(console.error);
