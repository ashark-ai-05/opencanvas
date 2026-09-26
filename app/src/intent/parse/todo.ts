import { capitalize, collapse } from './common';

export type TodoData = {
  items: string[];
  verb: string | null;
  title: string;
  /** A list keyword or a shopping verb was present. */
  explicit: boolean;
};

const LEAD = /^(?:to ?do|to-do|todo list|checklist|list|shopping list|groceries)\s*:?\s*/i;
const VERB = /^(buy|get|pick up|grab|order)\s+/i;

export function parseTodo(text: string): TodoData {
  let rest = collapse(text.replace(/\n/g, ', '));
  let title = 'Checklist';
  let explicit = false;

  const lead = rest.match(LEAD);
  if (lead) {
    explicit = true;
    if (/shopping|groceries/i.test(lead[0])) title = 'Shopping list';
    rest = rest.slice(lead[0].length);
  }

  let verb: string | null = null;
  const vm = rest.match(VERB);
  if (vm) {
    verb = vm[1].toLowerCase();
    rest = rest.slice(vm[0].length);
    explicit = true;
    if (title === 'Checklist') title = 'Shopping list';
  }

  const items = rest
    .split(/\s*(?:,|;|\s&\s|\band\b)\s*/i)
    .map((s) =>
      s.trim().replace(/^(?:buy|get|also)\s+/i, '').replace(/[.!]+$/, ''),
    )
    .filter(Boolean)
    .map((s) => (/^[a-z]/i.test(s) ? capitalize(s) : s));

  return { items, verb, title, explicit };
}
