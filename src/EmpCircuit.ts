import { Circuit, MpcSettings } from "mpc-framework-common";
import parseBristol, { Bristol } from "./parseBristol.js";
import assert from "./assert.js";
import never from "./never.js";

type EmpGate = (
  | { type: 'AND'; left: number; right: number; output: number }
  | { type: 'XOR'; left: number; right: number; output: number }
  | { type: 'INV'; input: number; output: number }
);

export default class EmpCircuit {
  private bristol: Bristol;
  private info: Circuit['info'];

  private metadata: {
    wireCount: number;
    inputBits0: number;
    inputBits1: number;
    outputBits: number;
  };
  private gates: EmpGate[] = [];

  private partyNames: string[] = [];
  private partyInputs: Record<string, string[]> = {};
  private allInputs: string[];
  private outputs: string[];

  // old wire id -> new wire id
  private wireIdMap = new Map<number, number>();
  private firstOutputWireId: number;

  private nextWireId = 0;
  private nextOutputWireId = -1;

  private zeroWireId?: number;

  constructor(
    circuit: Circuit,
    mpcSettings: MpcSettings,
  ) {
    this.bristol = parseBristol(circuit.bristol);
    this.info = circuit.info;

    const partyNamesSet = new Set<string>();

    for (let i = 0; i < mpcSettings.length; i++) {
      const partyName = mpcSettings[i].name ?? `party${i}`;
      this.partyNames.push(partyName);

      assert(!partyNamesSet.has(partyName), `Duplicate party name ${partyName}`);
      partyNamesSet.add(partyName);
    }

    this.allInputs = [];

    for (const [i, partyName] of this.partyNames.entries()) {
      this.partyInputs[partyName] = mpcSettings[i].inputs.slice();
      this.partyInputs[partyName].sort((a, b) =>
        circuit.info.input_name_to_wire_index[a] -
        circuit.info.input_name_to_wire_index[b],
      );

      this.allInputs.push(...this.partyInputs[partyName]);
    }

    this.allInputs.sort((a, b) =>
      circuit.info.input_name_to_wire_index[a] -
      circuit.info.input_name_to_wire_index[b],
    );

    const outputNames = new Set<string>();

    for (const mpcSetting of mpcSettings) {
      for (const output of mpcSetting.outputs) {
        outputNames.add(output);
      }
    }

    this.outputs = [...outputNames];
    this.outputs.sort((a, b) =>
      circuit.info.output_name_to_wire_index[a] -
      circuit.info.output_name_to_wire_index[b],
    );

    // The emp-wasm backend requires each party's input bits to be contiguous.
    const allInputsInPartyOrder: string[] = [];

    for (const partyName of this.partyNames) {
      allInputsInPartyOrder.push(...this.partyInputs[partyName]);
    }

    for (const inputName of allInputsInPartyOrder) {
      const width = this.getInputWidth(inputName);
      const oldWireId = this.info.input_name_to_wire_index[inputName];
      assert(oldWireId !== undefined, `Input ${inputName} not found`);

      for (let i = 0; i < width; i++) {
        const newWireId = this.assignWireId('normal');
        this.wireIdMap.set(oldWireId + i, newWireId);
      }
    }

    const oldFirstOutputWireId = this.info.output_name_to_wire_index[this.outputs[0]];

    for (const g of this.bristol.gates) {
      let outputWireId: number;
      const wireType = g.output < oldFirstOutputWireId ? 'normal' : 'output';

      // Note wireType:output means an output of the *circuit*, not just an
      // output of the gate

      switch (g.type) {
        case 'AND':
        case 'XOR': {
          outputWireId = this.assignWireId(wireType);

          this.gates.push({
            type: g.type,
            left: this.getWireId(g.left),
            right: this.getWireId(g.right),
            output: outputWireId,
          });

          if (g.type === 'XOR' && g.left === g.right) {
            // If the underlying circuit creates a zero wire we can also make
            // use of it
            this.zeroWireId ??= outputWireId;
          }

          break;
        }

        case 'NOT': {
          outputWireId = this.assignWireId(wireType);

          this.gates.push({
            type: 'INV',
            input: this.getWireId(g.input),
            output: outputWireId,
          });

          break;
        }

        case 'OR': {
          // or(a,b) == not(and(not(a), not(b)))

          const notA = this.assignWireId('normal');
          const notB = this.assignWireId('normal');
          const notAAndNotB = this.assignWireId('normal');
          outputWireId = this.assignWireId(wireType);

          this.gates.push(
            { type: 'INV', input: this.getWireId(g.left), output: notA },
            { type: 'INV', input: this.getWireId(g.right), output: notB },
            { type: 'AND', left: notA, right: notB, output: notAAndNotB },
            { type: 'INV', input: notAAndNotB, output: outputWireId },
          );

          break;
        }

        case 'COPY': {
          outputWireId = this.getWireId(g.input);

          const type = outputWireId >= 0 ? 'normal' : 'output';

          if (type === 'normal' && wireType === 'output') {
            // We can't just map this wire because it's a normal wire and we
            // need an output wire. Therefore we need to implement actual
            // copying, and emp-wasm doesn't provide a copy instruction.
            // Instead, we can use XOR with a zero wire to copy the value.

            const fixedOutputWireId = this.assignWireId('output');

            this.gates.push({
              type: 'XOR',
              left: outputWireId,
              right: this.getZeroWireId(),
              output: fixedOutputWireId,
            });

            outputWireId = fixedOutputWireId;
          }

          break;
        }

        default:
          never(g);
      }

      this.wireIdMap.set(g.output, outputWireId);
    }

    const outputWireCount = -this.nextOutputWireId - 1;
    this.firstOutputWireId = this.nextWireId;
    this.nextWireId += outputWireCount;

    const reassignOutputWireId = (wireId: number) => {
      assert(wireId < 0);
      return this.firstOutputWireId - wireId - 1;
    };

    for (const g of this.gates) {
      if (g.output < 0) {
        g.output = reassignOutputWireId(g.output);
      }

      if (g.type === 'AND' || g.type === 'XOR') {
        if (g.left < 0) {
          g.left = reassignOutputWireId(g.left);
        }

        if (g.right < 0) {
          g.right = reassignOutputWireId(g.right);
        }
      } else if (g.type === 'INV') {
        if (g.input < 0) {
          g.input = reassignOutputWireId(g.input);
        }
      } else {
        never(g);
      }
    }

    for (const [oldId, newId] of this.wireIdMap.entries()) {
      if (newId < 0) {
        this.wireIdMap.set(oldId, reassignOutputWireId(newId));
      }
    }

    // For 2PC, these correspond to the number of bits from each party.
    // For 3+PC, the only thing that matters is the total number of input bits
    // is correct.
    let inputBits0: number;
    let inputBits1: number;

    if (this.partyNames.length === 2) {
      inputBits0 = sum(
        this.partyInputs[this.partyNames[0]].map((n) => this.getInputWidth(n)),
      );

      inputBits1 = sum(
        this.partyInputs[this.partyNames[1]].map((n) => this.getInputWidth(n)),
      );
    } else {
      inputBits0 = sum(this.allInputs.map((n) => this.getInputWidth(n)));
      inputBits1 = 0;
    }

    this.metadata = {
      wireCount: this.nextWireId,
      inputBits0,
      inputBits1,
      outputBits: sum(this.outputs.map((n) => this.getOutputWidth(n))),
    };
  }

  private getWireId(oldWireId: number): number {
    const wireId = this.wireIdMap.get(oldWireId);
    assert(wireId !== undefined, `Wire ID ${oldWireId} not found`);

    return wireId;
  }

  private assignWireId(type: 'normal' | 'output'): number {
    if (type === 'normal') {
      return this.nextWireId++;
    }

    if (type === 'output') {
      return this.nextOutputWireId--;
    }

    never(type);
  }

  private getZeroWireId(): number {
    if (this.zeroWireId !== undefined) {
      return this.zeroWireId;
    }

    const inputWireId = this.nextWireId > 0 ? 0 : this.assignWireId('normal');
    this.zeroWireId = this.assignWireId('normal');

    this.gates.push({
      type: 'XOR',
      left: inputWireId,
      right: inputWireId,
      output: this.zeroWireId,
    });

    return this.zeroWireId;
  }

  private getInputWidth(inputName: string): number {
    const inputIndex = this.allInputs.indexOf(inputName);
    assert(inputIndex !== -1, `Input ${inputName} not found`);

    return this.bristol.inputWidths[inputIndex];
  }

  private getOutputWidth(outputName: string): number {
    const outputIndex = this.outputs.indexOf(outputName);
    assert(outputIndex !== -1, `Output ${outputName} not found`);

    return this.bristol.outputWidths[outputIndex];
  }

  getInputBitsPerParty(): number[] {
    return this.partyNames.map((partyName) =>
      sum(this.partyInputs[partyName].map((n) => this.getInputWidth(n))),
    );
  }

  getSimplifiedBristol(): string {
    const lines = [
      `${this.gates.length} ${this.metadata.wireCount}`,
      `${this.metadata.inputBits0} ${this.metadata.inputBits1} ${this.metadata.outputBits}`,
      '',
    ];

    for (const g of this.gates) {
      switch (g.type) {
        case 'AND':
        case 'XOR':
          lines.push(`2 1 ${g.left} ${g.right} ${g.output} ${g.type}`);
          break;

        case 'INV':
          lines.push(`1 1 ${g.input} ${g.output} INV`);
          break;

        default:
          never(g);
      }
    }

    return lines.join('\n');
  }

  encodeInput(
    party: string,
    input: Record<string, unknown>,
  ): Uint8Array {
    const inputNames = this.partyInputs[party];
    assert(inputNames !== undefined, `Party ${party} not found`);

    const bits: boolean[] = [];

    for (const inputName of inputNames) {
      const value = input[inputName];
      const width = this.getInputWidth(inputName);

      assert(
        typeof value === 'number',
        `Expected input ${inputName} to be a number`,
      );

      for (let i = width - 1; i >= 0; i--) {
        bits.push((value >> i) & 1 ? true : false);
      }
    }

    return Uint8Array.from(bits.map((bit) => (bit ? 1 : 0)));
  }

  decodeOutput(outputBits: Uint8Array): Record<string, unknown> {
    const output: Record<string, unknown> = {};

    for (const outputName of this.outputs) {
      const width = this.getOutputWidth(outputName);
      const oldWireId = this.info.output_name_to_wire_index[outputName];

      let value = 0;

      for (let i = 0; i < width; i++) {
        const wireId = this.wireIdMap.get(oldWireId + i);
        assert(wireId !== undefined, `Wire ID ${oldWireId + i} not found`);
        value |= outputBits[wireId - this.firstOutputWireId] << (width - 1 - i);
      }

      output[outputName] = value;
    }

    return output;
  }

  eval(
    inputs: Record<string, Record<string, unknown>>,
    //              ^ party name  ^ input name
    // eg: {
    //   alice: { a: 3 },
    //   bob: { b: 5 },
    // }
  ): Record<string, unknown> {
    const wires = new Uint8Array(this.metadata.wireCount);
    let wireId = 0;

    for (const party of this.partyNames) {
      assert(inputs[party] !== undefined, `Inputs for party ${party} not found`);
      for (const bit of this.encodeInput(party, inputs[party])) {
        wires[wireId++] = bit;
      }
    }

    for (const party of Object.keys(inputs)) {
      assert(this.partyNames.includes(party), `Unknown party ${party}`);
    }

    for (const g of this.gates) {
      switch (g.type) {
        case 'AND':
          wires[g.output] = wires[g.left] & wires[g.right];
          break;

        case 'XOR':
          wires[g.output] = wires[g.left] ^ wires[g.right];
          break;

        case 'INV':
          wires[g.output] = Number(!wires[g.input]);
          break;

        default:
          never(g);
      }
    }

    return this.decodeOutput(wires.subarray(this.firstOutputWireId));
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
