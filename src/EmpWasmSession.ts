import { BackendSession, Circuit, MpcSettings } from "mpc-framework-common";
import defer from "./defer";
import { pack } from "msgpackr";
import buffersEqual from "./buffersEqual";
import { Buffer } from 'buffer';

export default class EmpWasmSession implements BackendSession {
  peerName: string;
  result = defer<Record<string, unknown>>();

  constructor(
    public circuit: Circuit,
    public mpcSettings: MpcSettings,
    public input: Record<string, unknown>,
    public send: (to: string, msg: Uint8Array) => void,
    public isLeader: boolean,
  ) {
    this.peerName = mpcSettings[isLeader ? 1 : 0].name ?? (isLeader ? "1" : "0");

    this.run().catch(err => {
      this.result.reject(err);
    });
  }

  handleMessage(from: string, msg: Uint8Array): void {
    if (from !== this.peerName) {
      console.error("Received message from unknown peer", from);
      return;
    }

    this.msgQueue.push(msg);
  }

  async run() {
    const initPromise = init(2);

    const setupHash = new Keccak().update(
      Buffer.from(pack([this.circuit, this.mpcSettings]))
    ).digest();

    this.send(this.peerName, setupHash);

    const msg = await this.msgQueue.pop();

    if (!buffersEqual(msg, setupHash)) {
      throw new Error("Setup hash mismatch: check peer settings match");
    }

    await initPromise;

    const res = await runSemiHonest(
      this.circuit,
      this.input,
      this.isLeader,
      (msg: Uint8Array) => this.send(this.peerName, msg),
      () => this.msgQueue.tryPop()?.value ?? new Uint8Array(),
    );

    this.result.resolve(res);
  }

  output(): Promise<Record<string, unknown>> {
    return this.result.promise;
  }
}
