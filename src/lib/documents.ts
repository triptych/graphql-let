import { CodegenContext as CodegenConfig } from '@graphql-codegen/cli';
import { Types } from '@graphql-codegen/plugin-helpers';
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader';
import glob from 'globby';
import * as graphql from 'graphql';
import { join as pathJoin } from 'path';
import { doc } from 'prettier';
// import {
//   ConfigTypes,
//   GraphQLLetAdditionalOptions,
//   PartialGraphqlCodegenOptions,
// } from './config';
// import { PartialCodegenOpts } from './create-codegen-opts';
import { ExecContext } from './exec-context';
import { readFile, readHash } from './file';
import { processGraphQLCodegen } from './graphql-codegen';
import { createHash } from './hash';
import { createPaths, isTypeScriptPath } from './paths';
import {
  CodegenContext,
  FileCodegenContext,
  isLiteralContext,
  LiteralCodegenContext,
} from './types';
import ConfiguredOutput = Types.ConfiguredOutput;

export async function findTargetDocuments({
  cwd,
  config,
}: ExecContext): Promise<{
  graphqlRelPaths: string[];
  tsSourceRelPaths: string[];
}> {
  const documentPaths = await glob(config.documents, {
    cwd,
    gitignore: config.respectGitIgnore,
  });
  if (documentPaths.length === 0) {
    throw new Error(
      `No GraphQL documents are found from the path ${JSON.stringify(
        config.documents,
      )}. Check "documents" in .graphql-let.yml.`,
    );
  }
  const graphqlRelPaths: string[] = [];
  const tsSourceRelPaths: string[] = [];
  for (const p of documentPaths) {
    isTypeScriptPath(p) ? tsSourceRelPaths.push(p) : graphqlRelPaths.push(p);
  }
  return { graphqlRelPaths, tsSourceRelPaths };
}

function buildCodegenConfig(
  { cwd, config, codegenOpts }: ExecContext,
  codegenContext: CodegenContext[],
) {
  const generates: {
    [outputPath: string]: ConfiguredOutput;
  } = Object.create(null);

  for (const context of codegenContext) {
    const { tsxFullPath } = context;
    const documents = isLiteralContext(context)
      ? // XXX: We want to pass shorter `strippedGqlContent`,
        // but `# import` also disappears!
        (context as LiteralCodegenContext).gqlContent
      : (context as FileCodegenContext).gqlRelPath;
    generates[tsxFullPath] = {
      ...config.generateOptions,
      // graphql-let -controlled fields:
      documents,
      plugins: config.plugins,
    };
  }

  return {
    ...config,
    // @ts-ignore
    cwd,
    // @ts-ignore
    skipGraphQLImport: false,
    config: {
      // TODO: Quit using codegenOpts
      ...codegenOpts.config,
      ...config.config,
    },
    // In our config, "documents" should always be empty
    // since "generates" should take care of them.
    documents: undefined,
    generates,
  };
}

import { processImport } from '@graphql-tools/import';
import utils = doc.utils;

// GraphQLFileLoader only allows "# import" when passing file paths.
// But we want it even in gql(`query {}`), don't we?
// TODO: It turns out we should do Custom Loader instead of extending CodegenConfig..!
class CodegenConfigForLiteralDocuments extends CodegenConfig {
  sourceRelPath: string;
  constructor(
    execContext: ExecContext,
    codegenContext: CodegenContext[],
    sourceRelPath: string,
  ) {
    const { cwd } = execContext;

    super({
      config: buildCodegenConfig(execContext, codegenContext),
    });
    this.cwd = cwd;
    this.sourceRelPath = sourceRelPath;
  }

  // from graphql-file-loader
  static isGraphQLImportFile(rawSDL: string) {
    const trimmedRawSDL = rawSDL.trim();
    return (
      trimmedRawSDL.startsWith('# import') ||
      trimmedRawSDL.startsWith('#import')
    );
  }

  async loadDocuments(pointers: any) {
    const [pointer] = pointers;
    if (CodegenConfigForLiteralDocuments.isGraphQLImportFile(pointer)) {
      const sourceFullPath = pathJoin(this.cwd, this.sourceRelPath);
      // const resolved = GraphQLFileLoader.prototype.handleFileContent(
      //   pointer,
      //   this.sourceRelPath,
      //   { cwd: this.cwd },
      // );
      // return [resolved];

      // if (!options.skipGraphQLImport && isGraphQLImportFile(rawSDL)) {
      const document = processImport(sourceFullPath, this.cwd, {
        [sourceFullPath]: pointer,
      });
      return [{ document }];
      // const typeSystemDefinitions = document.definitions
      //   .filter(d => !graphql.isExecutableDefinitionNode(d))
      //   .map(definition => ({
      //     kind: graphql.Kind.DOCUMENT,
      //     definitions: [definition],
      //   }));
      // const mergedTypeDefs = mergeTypeDefs(typeSystemDefinitions, { useSchemaDefinition: false });
      // const executableDefinitions = document.definitions.filter(graphql.isExecutableDefinitionNode);
      // return {
      //   location: pointer,
      //   document: {
      //     ...mergedTypeDefs,
      //     definitions: [...mergedTypeDefs.definitions, ...executableDefinitions],
      //   },
      // };
      // }
      // return utils.parseGraphQLSDL(pointer, rawSDL.trim(), options);
    }
    return super.loadDocuments(pointers);
  }
}

export function processGraphQLCodegenForFiles(
  execContext: ExecContext,
  codegenContext: FileCodegenContext[],
) {
  return processGraphQLCodegen(
    execContext,
    codegenContext,
    buildCodegenConfig(execContext, codegenContext),
  );
}

export function processGraphQLCodegenForLiterals(
  execContext: ExecContext,
  codegenContext: LiteralCodegenContext[],
  sourceRelPath: string,
) {
  return processGraphQLCodegen(
    execContext,
    codegenContext,
    new CodegenConfigForLiteralDocuments(
      execContext,
      codegenContext,
      sourceRelPath,
    ),
  );
}

export async function processDocumentsForContext(
  execContext: ExecContext,
  schemaHash: string,
  codegenContext: CodegenContext[],
  gqlRelPaths: string[],
  gqlContents?: string[],
): Promise<Types.FileOutput[]> {
  if (!gqlRelPaths.length) return [];

  const { cwd } = execContext;
  const documentCodegenContext: FileCodegenContext[] = [];

  for (const [i, gqlRelPath] of gqlRelPaths.entries()) {
    // Loader passes gqlContent directly
    const gqlContent = gqlContents
      ? gqlContents[i]
      : await readFile(pathJoin(cwd, gqlRelPath), 'utf-8');
    if (!gqlContent) throw new Error('never');

    const createdPaths = createPaths(execContext, gqlRelPath);
    const { tsxFullPath, dtsFullPath } = createdPaths;

    // Here I add "schemaHash" as a hash seed. Types of GraphQL documents
    // basically depends on schema, which change should effect to document results.
    const gqlHash = createHash(schemaHash + gqlContent);

    const shouldUpdate =
      gqlHash !== (await readHash(tsxFullPath)) ||
      gqlHash !== (await readHash(dtsFullPath));

    const context: FileCodegenContext = {
      ...createdPaths,
      gqlHash,
      dtsContentDecorator: (s) => s,
      skip: !shouldUpdate,
    };
    codegenContext.push(context);
    documentCodegenContext.push(context);
  }

  if (documentCodegenContext.every(({ skip }) => skip)) return [];

  return await processGraphQLCodegenForFiles(
    execContext,
    documentCodegenContext,
  );
}
