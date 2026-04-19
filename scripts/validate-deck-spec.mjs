import { collectDeckAssetErrors, formatValidationErrors, loadDeckSpec, validateDeckSpec } from "./deck-spec.mjs";

function parseArgs(argv) {
  const args = {};
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === "--input") {
      args.input = argv[idx + 1];
      idx += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { spec, path } = loadDeckSpec(args.input);
  const { valid, errors } = validateDeckSpec(spec);
  const assetErrors = collectDeckAssetErrors(spec);

  if (!valid || assetErrors.length > 0) {
    const details = [];
    if (errors.length > 0) {
      details.push(formatValidationErrors(errors));
    }
    details.push(...assetErrors);
    console.error(`Deck spec is invalid: ${path}`);
    console.error(details.join("\n"));
    process.exit(1);
  }

  console.log(`Deck spec is valid: ${path}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
