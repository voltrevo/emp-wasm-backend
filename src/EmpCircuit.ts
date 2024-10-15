import { Circuit, MpcSettings } from "mpc-framework-common";
import parseBristol, { Bristol } from "./parseBristol";
import assert from "./assert";
import never from "./never";

export default class EmpCircuit {
  private bristol: Bristol;
  private info: Circuit['info'];
  private lines: string[] = [];
  private aliceInputs: string[];
  private bobInputs: string[];
  private allInputs: string[];
  private outputs: string[];

  // old wire id -> new wire id
  private wireIdMap = new Map<number, number>();
  private firstOutputWireId: number;

  private nextWireId = 0;

  constructor(
    circuit: Circuit,
    mpcSettings: MpcSettings,
  ) {
    this.bristol = parseBristol(circuit.bristol);
    this.info = circuit.info;
    this.lines.push(`${this.bristol.gates.length} ${this.bristol.wireCount}`);

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
        const newWireId = this.assignWireId();
        this.wireIdMap.set(oldWireId + i, newWireId);
      }
    }

    const oldFirstOutputWireId = this.info.output_name_to_wire_index[this.outputs[0]];
    let circuitOutputPhase = false;

    let firstOutputWireId: number | undefined = undefined;

    for (const g of this.bristol.gates) {
      let outputWireId: number;

      const isCircuitOutput = g.output >= oldFirstOutputWireId;

      if (circuitOutputPhase && !isCircuitOutput) {
        throw new Error([
          'Encountered non-output wire after output wire ',
          '(this edge case is not currently implemented)'
        ].join(''));
      }

      switch (g.type) {
        case 'AND':
        case 'XOR': {
          outputWireId = this.assignWireId();

          this.lines.push([
            '2 1',
            this.getWireId(g.left),
            this.getWireId(g.right),
            outputWireId,
            g.type,
          ].join(' '));

          break;
        }

        case 'NOT': {
          outputWireId = this.assignWireId();
          this.lines.push(`1 1 ${this.getWireId(g.input)} ${outputWireId} INV`);

          break;
        }

        case 'OR': {
          // or(a,b) == not(and(not(a), not(b)))

          const notA = this.assignWireId();
          const notB = this.assignWireId();
          const notAAndNotB = this.assignWireId();
          outputWireId = this.assignWireId();

          this.lines.push(`1 1 ${this.getWireId(g.left)} ${notA} INV`);
          this.lines.push(`1 1 ${this.getWireId(g.right)} ${notB} INV`);
          this.lines.push(`2 1 ${notA} ${notB} ${notAAndNotB} AND`);
          this.lines.push(`1 1 ${notAAndNotB} ${outputWireId} INV`);

          break;
        }

        case 'COPY': {
          outputWireId = this.getWireId(g.input);

          break;
        }

        default:
          never(g);
      }

      this.wireIdMap.set(g.output, outputWireId);

      if (isCircuitOutput && !circuitOutputPhase) {
        firstOutputWireId = outputWireId;
        circuitOutputPhase = true;
      }
    }

    assert(firstOutputWireId !== undefined, 'No output wires found');
    this.firstOutputWireId = firstOutputWireId;
  }

  private getWireId(oldWireId: number): number {
    const wireId = this.wireIdMap.get(oldWireId);
    assert(wireId !== undefined, `Wire ID ${oldWireId} not found`);

    return wireId;
  }

  private assignWireId(): number {
    return this.nextWireId++;
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
    return this.lines.join('\n');
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
}
