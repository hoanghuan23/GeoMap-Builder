import { mapDefinitions } from '../src/maps/registry.js';
import { sharedInstructions } from '../src/shared/analysis-instructions.js';

// Preserve instruction ordering and wording while each map owns its specific rules.
export const MAP_ANALYSIS_INSTRUCTIONS = [...sharedInstructions, ...mapDefinitions.flatMap(definition => definition.instructions)]
  .sort((left, right) => left.order - right.order).map(instruction => instruction.text).join('\n');
