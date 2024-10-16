import { Circuit, MpcSettings } from "mpc-framework-common";
import parseBristol, { Bristol } from "./parseBristol";
import assert from "./assert";
import never from "./never";

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
    aliceBits: number;
    bobBits: number;
    outputBits: number;
  };
  private gates: EmpGate[] = [];

  private aliceInputs: string[];
  private bobInputs: string[];
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

    assert(
      mpcSettings.length === 2,
      'Expected exactly two participants',
    );

    this.aliceInputs = mpcSettings[0].inputs;
    this.aliceInputs.sort((a, b) =>
      circuit.info.input_name_to_wire_index[a] -
      circuit.info.input_name_to_wire_index[b],
    );

    this.bobInputs = mpcSettings[1].inputs;
    this.bobInputs.sort((a, b) =>
      circuit.info.input_name_to_wire_index[a] -
      circuit.info.input_name_to_wire_index[b],
    );

    this.allInputs = [...this.aliceInputs, ...this.bobInputs];
    this.allInputs.sort((a, b) =>
      circuit.info.input_name_to_wire_index[a] -
      circuit.info.input_name_to_wire_index[b],
    );

    this.outputs = mpcSettings[0].outputs;
    this.outputs.sort((a, b) =>
      circuit.info.output_name_to_wire_index[a] -
      circuit.info.output_name_to_wire_index[b],
    );

    for (const inputName of [...this.aliceInputs, ...this.bobInputs]) {
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

    this.metadata = {
      wireCount: this.nextWireId,
      aliceBits: sum(this.aliceInputs.map((n) => this.getInputWidth(n))),
      bobBits: sum(this.bobInputs.map((n) => this.getInputWidth(n))),
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

  getSimplifiedBristol(): string {
    const lines = [
      `${this.gates.length} ${this.metadata.wireCount}`,
      `${this.metadata.aliceBits} ${this.metadata.bobBits} ${this.metadata.outputBits}`,
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
    party: 'alice' | 'bob',
    input: Record<string, unknown>,
  ): Uint8Array {
    const inputNames = party === 'alice' ? this.aliceInputs : this.bobInputs;

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
    aliceInput: Record<string, unknown>,
    bobInput: Record<string, unknown>,
  ): Record<string, unknown> {
    const wires = new Uint8Array(this.metadata.wireCount);
    let wireId = 0;

    for (const bit of this.encodeInput('alice', aliceInput)) {
      wires[wireId++] = bit;
    }

    for (const bit of this.encodeInput('bob', bobInput)) {
      wires[wireId++] = bit;
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
