import { Command } from 'commander';
import { parseKeyValues } from '../args';
import { GlobalOptions, createClient } from '../client-factory';
import { printJson, printTable } from '../output';

export function buildVarCommand(): Command {
  const variable = new Command('var').description('fleet-wide ${NAME} substitutions applied before a task is dispatched');

  variable
    .command('list')
    .description('show the current substitutions')
    .action(async function (this: Command) {
      const global: GlobalOptions = this.optsWithGlobals();
      const { variables } = await createClient(global).listReplacementVariables();
      if (global.json === true) {
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
    });

  variable
    .command('set')
    .description('replace the whole set; omitting a name deletes it')
    .argument('<pairs...>', 'NAME=value')
    .action(async function (this: Command, pairs: string[]) {
      // Whole-set semantics keep the stored variables identical to what you just
      // typed, rather than accumulating entries nobody remembers adding.
      const variables = parseKeyValues(pairs, 'var');
      const { variables: stored } = await createClient(this.optsWithGlobals()).setReplacementVariables({ variables });
      console.log(`Replacement variables are now: ${Object.keys(stored).join(', ') || '(none)'}`);
    });

  return variable;
}
