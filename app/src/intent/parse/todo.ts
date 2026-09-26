import { capitalize, collapse } from './common';

export type TodoData = {
  items: string[];
  verb: string | null;
  title: string;
  /** A list keyword or a shopping verb was present. */
  explicit: boolean;
  /**
   * Where `explicit` came from: a LEAD keyword ("todo:", "checklist:", …)
   * is unambiguous; a bare leading VERB ("order the results by date") is
   * common in ordinary sentences and is only strong evidence of a list
   * when paired with a separator — see keywords.ts.
   */
  explicitVia: 'keyword' | 'verb' | null;
};

const LEAD = /^(?:to ?do|to-do|todo list|checklist|list|shopping list|groceries)\s*:?\s*/i;
const VERB = /^(buy|get|pick up|grab|order)\s+/i;

export function parseTodo(text: string): TodoData {
  let rest = collapse(text.replace(/\n/g, ', '));
  let title = 'Checklist';
  let explicit = false;
  let explicitVia: 'keyword' | 'verb' | null = null;

  const lead = rest.match(LEAD);
  if (lead) {
    explicit = true;
    explicitVia = 'keyword';
    if (/shopping|groceries/i.test(lead[0])) title = 'Shopping list';
    rest = rest.slice(lead[0].length);
  }

  let verb: string | null = null;
  const vm = rest.match(VERB);
  if (vm) {
    verb = vm[1].toLowerCase();
    rest = rest.slice(vm[0].length);
    explicit = true;
    if (explicitVia === null) explicitVia = 'verb';
    if (title === 'Checklist') title = 'Shopping list';
  }

  const items = rest
    .split(/\s*(?:,|;|\s&\s|\band\b)\s*/i)
    .map((s) =>
      s.trim().replace(/^(?:buy|get|also)\s+/i, '').replace(/[.!]+$/, ''),
    )
    .filter(Boolean)
    .map((s) => (/^[a-z]/i.test(s) ? capitalize(s) : s));

  return { items, verb, title, explicit, explicitVia };
}
