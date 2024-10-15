export type Gate =
  | { type: 'AND'; left: number; right: number; output: number }
  | { type: 'XOR'; left: number; right: number; output: number }
  | { type: 'OR'; left: number; right: number; output: number }
  | { type: 'NOT'; input: number; output: number }
  | { type: 'COPY'; input: number; output: number };

export type Bristol = {
  wireCount: number;
  inputWidths: number[];  // Bits per input
  outputWidths: number[]; // Bits per output
  gates: Gate[];
}

export default function parseBristol(input: string): Bristol {
  const lines = input
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 3) {
    throw new Error('Input is too short to contain necessary headers.');
  }

  // Parse the first line: number of gates and number of wires
  const [numGatesStr, numWiresStr] = lines[0].split(/\s+/);
  const numGates = parseInt(numGatesStr, 10);
  const wireCount = parseInt(numWiresStr, 10);

  if (isNaN(numGates) || isNaN(wireCount)) {
    throw new Error('Invalid number of gates or wires.');
  }

  // Parse the second line: number of inputs followed by bits per input
  const inputLineTokens = lines[1].split(/\s+/);
  const numInputs = parseInt(inputLineTokens[0], 10);
  if (isNaN(numInputs)) {
    throw new Error('Invalid number of inputs.');
  }
  if (inputLineTokens.length !== 1 + numInputs) {
    throw new Error(`Expected ${numInputs} bits per input, but found ${inputLineTokens.length - 1}.`);
  }
  const inputWidths: number[] = [];
  for (let i = 0; i < numInputs; i++) {
    const bits = parseInt(inputLineTokens[1 + i], 10);
    if (isNaN(bits) || bits < 0) {
      throw new Error(`Invalid bits per input at position ${i + 1}.`);
    }
    inputWidths.push(bits);
  }

  // Parse the third line: number of outputs followed by bits per output
  const outputLineTokens = lines[2].split(/\s+/);
  const numOutputs = parseInt(outputLineTokens[0], 10);
  if (isNaN(numOutputs)) {
    throw new Error('Invalid number of outputs.');
  }
  if (outputLineTokens.length !== 1 + numOutputs) {
    throw new Error(`Expected ${numOutputs} bits per output, but found ${outputLineTokens.length - 1}.`);
  }
  const outputWidths: number[] = [];
  for (let i = 0; i < numOutputs; i++) {
    const bits = parseInt(outputLineTokens[1 + i], 10);
    if (isNaN(bits) || bits < 0) {
      throw new Error(`Invalid bits per output at position ${i + 1}.`);
    }
    outputWidths.push(bits);
  }

  const gates: Gate[] = [];

  // Validate that there are enough lines for the gates
  if (lines.length !== 3 + numGates) {
    throw new Error(
      `Expected ${numGates} gates, but found ${lines.length - 3}.`
    );
  }

  // Parse the gate definitions
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    const tokens = line.split(/\s+/);

    if (tokens.length < 4) {
      throw new Error(`Invalid gate line at line ${i + 1}: "${line}"`);
    }

    const numGateInputs = parseInt(tokens[0], 10);
    const numGateOutputs = parseInt(tokens[1], 10);

    if (isNaN(numGateInputs) || isNaN(numGateOutputs)) {
      throw new Error(
        `Invalid number of inputs or outputs at line ${i + 1}: "${line}"`
      );
    }

    const expectedTokens = 2 + numGateInputs + numGateOutputs + 1;
    if (tokens.length !== expectedTokens) {
      throw new Error(
        `Expected ${expectedTokens} tokens but found ${tokens.length} at line ${i + 1
        }: "${line}"`
      );
    }

    const inputWires = tokens
      .slice(2, 2 + numGateInputs)
      .map((s) => parseInt(s, 10));
    const outputWires = tokens
      .slice(2 + numGateInputs, 2 + numGateInputs + numGateOutputs)
      .map((s) => parseInt(s, 10));
    const gateType = tokens[tokens.length - 1];

    if (
      inputWires.some((w) => isNaN(w) || w < 0 || w >= wireCount) ||
      outputWires.some((w) => isNaN(w) || w < 0 || w >= wireCount)
    ) {
      throw new Error(
        `Invalid wire indices at line ${i + 1}: "${line}"`
      );
    }

    switch (gateType) {
      case 'AND':
      case 'XOR':
      case 'OR':
        if (numGateInputs !== 2 || numGateOutputs !== 1) {
          throw new Error(
            `Invalid inputs/outputs for ${gateType} at line ${i + 1
            }: "${line}"`
          );
        }
        gates.push({
          type: gateType,
          left: inputWires[0],
          right: inputWires[1],
          output: outputWires[0],
        });
        break;

      case 'NOT':
      case 'COPY':
        if (numGateInputs !== 1 || numGateOutputs !== 1) {
          throw new Error(
            `Invalid inputs/outputs for ${gateType} at line ${i + 1
            }: "${line}"`
          );
        }
        gates.push({
          type: gateType,
          input: inputWires[0],
          output: outputWires[0],
        });
        break;

      default:
        throw new Error(
          `Unknown gate type '${gateType}' at line ${i + 1}: "${line}"`
        );
    }
  }

  return {
    wireCount,
    inputWidths,
    outputWidths,
    gates,
  };
}
