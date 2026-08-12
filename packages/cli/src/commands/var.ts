import { ParsedArgs, boolFlag, parseKeyValues } from '../args';
import { createClient } from '../client-factory';
import { printJson, printTable } from '../output';

export async function varCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[1] ?? 'list';

  switch (subcommand) {
    case 'list':
      return listVariables(args);
    case 'set':
      return setVariables(args);
    default:
      throw new Error(`Unknown var subcommand "${subcommand}". Try: list, set.`);
  }
}

async function listVariables(args: ParsedArgs): Promise<void> {
  const { variables } = await createClient(args).listReplacementVariables();
  if (boolFlag(args, 'json')) {
    printJson(variables);
    return;
  }
  const rows = Object.entries(variables).map(([name, value]) => ({ name, value }));
  printTable(
    rows,
    [
      { header: 'NAME', value: (row) => row.name },
      { header: 'VALUE', value: (row) => row.value },
    ],
    'No replacement variables are set.',
  );
}

/**
 * `mini-cloud var set A=1 B=2` replaces the whole set, so omitting a name deletes it.
 * Whole-set semantics keep the stored variables identical to what you just typed,
 * rather than accumulating entries nobody remembers adding.
 */
async function setVariables(args: ParsedArgs): Promise<void> {
  const pairs = args.positionals.slice(2);
  const variables = parseKeyValues(pairs, 'var');
  const { variables: stored } = await createClient(args).setReplacementVariables({ variables });
  console.log(`Replacement variables are now: ${Object.keys(stored).join(', ') || '(none)'}`);
}
