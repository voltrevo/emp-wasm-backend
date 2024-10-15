import { Circuit, MpcSettings } from "mpc-framework-common";

export default class EmpCircuit {
  constructor(
    circuit: Circuit,
    mpcSettings: MpcSettings,
  ) {
    throw new Error("Not implemented");
  }

  getBristol(): string {
    throw new Error("Not implemented");
  }

  encodeInput(
    party: 'alice' | 'bob',
    input: Record<string, unknown>,
  ): Uint8Array {
    throw new Error("Not implemented");
  }

  decodeOutput(outputBits: Uint8Array): Record<string, unknown> {
    throw new Error("Not implemented");
  }
}
