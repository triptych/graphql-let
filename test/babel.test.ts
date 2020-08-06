import { deepStrictEqual } from 'assert';
import globby from 'globby';
import { join } from 'path';
import runner from '@babel/helper-transform-fixture-test-runner';
import { cleanup, readFile } from './__tools/file';

const cwd = join(__dirname, '__fixtures/babel');
const rel = (path: string) => join(cwd, path);

beforeAll(() => cleanup(cwd));

runner(cwd, 'gql', {}, { sourceType: 'unambiguous' });

test(`Generated files are okay`, async () => {
  const expectedFiles = [
    'fixtures/basic/node_modules/@types/graphql-let/index.d.ts',
    'fixtures/basic/node_modules/@types/graphql-let/input-3daf5b4311465bd8566d77d548e135871cc11646.d.ts',
    'fixtures/basic/node_modules/@types/graphql-let/store.json',
    'fixtures/basic/node_modules/graphql-let/__generated__/input-3daf5b4311465bd8566d77d548e135871cc11646.tsx',
    'fixtures/tagged-template-call/node_modules/@types/graphql-let/index.d.ts',
    'fixtures/tagged-template-call/node_modules/@types/graphql-let/input-3daf5b4311465bd8566d77d548e135871cc11646.d.ts',
    'fixtures/tagged-template-call/node_modules/@types/graphql-let/store.json',
    'fixtures/tagged-template-call/node_modules/graphql-let/__generated__/input-3daf5b4311465bd8566d77d548e135871cc11646.tsx',
  ];
  const files = await globby('fixtures/*/node_modules/**', { cwd });

  deepStrictEqual(files.sort(), expectedFiles);

  const contents = await Promise.all(
    files.map((file) => {
      return readFile(rel(file)).then((content) => [file, content]);
    }),
  );

  for (const [file, content] of contents) expect(content).toMatchSnapshot(file);
});