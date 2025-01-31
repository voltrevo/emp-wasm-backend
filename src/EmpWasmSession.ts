import { Keccak } from "sha3";

import { BackendSession, Circuit, MpcSettings } from "mpc-framework-common";
import { BufferQueue, secure2PC } from "emp-wasm";

import defer from "./defer.js";
import buffersEqual from "./buffersEqual.js";
import EmpCircuit from "./EmpCircuit.js";
import packBuffer from "./packBuffer.js";
import sortKeys from 'sort-keys';

export default class EmpWasmSession implements BackendSession {
  peerName: string;
  bq = new BufferQueue();
  result = defer<Record<string, unknown>>();

  constructor(
    public circuit: Circuit,
    public mpcSettings: MpcSettings,
    public input: Record<string, unknown>,
    public send: (to: string, msg: Uint8Array) => void,
    public isAlice: boolean,
  ) {
    this.peerName = mpcSettings[isAlice ? 1 : 0].name ?? (isAlice ? "1" : "0");

    this.run().catch(err => {
      this.result.reject(err);
    });
  }

  handleMessage(from: string, msg: Uint8Array): void {
    if (from !== this.peerName) {
      console.error("Received message from unknown peer", from);
      return;
    }

    this.bq.push(msg);
  }

  async run() {
    const setupHash = Uint8Array.from(new Keccak(256).update(
      packBuffer([sortKeys(this.circuit, { deep: true }), sortKeys(this.mpcSettings, { deep: true })])
    ).digest());

    this.send(this.peerName, setupHash);

    const msg = await this.bq.pop(32);

    if (!buffersEqual(msg, setupHash)) {
      throw new Error("Setup hash mismatch: check peer settings match");
    }

    const empCircuit = new EmpCircuit(this.circuit, this.mpcSettings);

    const outputBits = await secure2PC(
      this.isAlice ? 'alice' : 'bob',
      empCircuit.getSimplifiedBristol(),
      empCircuit.encodeInput(this.isAlice ? 'alice' : 'bob', this.input),
      {
        send: data => this.send(this.peerName, data),
        recv: len => this.bq.pop(len),
      },
    );

    this.result.resolve(empCircuit.decodeOutput(outputBits));
  }

  output(): Promise<Record<string, unknown>> {
    return this.result.promise;
  }
}
