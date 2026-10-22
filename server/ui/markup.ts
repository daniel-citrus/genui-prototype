import { sanitizeMarkup } from "shared/markup";

/**
 * Every problem with a Markup `root` against the shared allowlist, one
 * message per problem with its path below `path`
 * ("tree.children.0.props.root.children.2.attrs.onclick is not allowed").
 */
export function validateMarkup(root: unknown, path: string): string[] {
  const problems: string[] = [];
  sanitizeMarkup(root, path, (problem) => problems.push(problem));
  return problems;
}
