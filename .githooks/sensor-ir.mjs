const TYPES = Object.freeze(['import', 'call', 'argument', 'assignment', 'literal', 'interpolation', 'error-block', 'html-element', 'html-attribute']);

export const SENSOR_IR_TYPES = TYPES;

export function normalizeTree(root, source) {
  const nodes = [];
  visit(root, node => {
    const type = normalizedType(node.type);
    if (!type) return;
    nodes.push(Object.freeze({
      type,
      nativeType: node.type,
      text: source.slice(node.startIndex, node.endIndex),
      range: Object.freeze({ start: node.startIndex, end: node.endIndex, line: node.startPosition.row + 1, column: node.startPosition.column + 1 }),
      name: node.childForFieldName?.('name')?.text ?? node.childForFieldName?.('function')?.text ?? null,
    }));
  });
  return Object.freeze(nodes);
}

export function normalizedType(type) {
  if (/^(?:import|import_statement|import_declaration)$/u.test(type)) return 'import';
  if (/^(?:call|call_expression|method_invocation)$/u.test(type)) return 'call';
  if (/^(?:arguments|argument_list|argument)$/u.test(type)) return 'argument';
  if (/^(?:assignment|assignment_expression|variable_declarator)$/u.test(type)) return 'assignment';
  if (/^(?:string|string_literal|template_string|integer|float|number)$/u.test(type)) return 'literal';
  if (/^(?:interpolation|template_substitution)$/u.test(type)) return 'interpolation';
  if (/^(?:catch_clause|rescue|except_clause)$/u.test(type)) return 'error-block';
  if (/^(?:element|jsx_element|self_closing_element)$/u.test(type)) return 'html-element';
  if (/^(?:attribute|jsx_attribute)$/u.test(type)) return 'html-attribute';
  return null;
}

function visit(node, callback) {
  callback(node);
  for (const child of node.namedChildren ?? []) visit(child, callback);
}
