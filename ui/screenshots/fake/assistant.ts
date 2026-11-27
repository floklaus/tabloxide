import type { AskRequest_Serialize, AssistantEvent } from '../../src/bindings'

/** The answers of the assistant. The words follow Simplified Technical English. */

const SHARE_ANSWER = `The query below adds the column \`share\`. It shows the revenue of each item as a percentage of the total revenue.

\`\`\`sql
SELECT i.sku,
       i.name,
       sum(ol.quantity * ol.unit_price) AS revenue,
       round(100 * sum(ol.quantity * ol.unit_price)
             / sum(sum(ol.quantity * ol.unit_price)) OVER (), 1) AS share
FROM item AS i
JOIN order_line AS ol ON ol.item_id = i.id
JOIN orders AS o ON o.id = ol.order_id
WHERE o.ordered_at >= now() - interval '30 days'
  AND o.status <> 'cancelled'
GROUP BY i.sku, i.name
ORDER BY revenue DESC
LIMIT 15;
\`\`\`

The window function \`sum(...) OVER ()\` adds the revenue of all groups. Thus the total also includes the items after row 15.`

const FIX_ANSWER = `The table \`orders\` has no column \`created_at\`. The time of the order is in the column \`ordered_at\`.

Use \`o.ordered_at\` in the SELECT list and in ORDER BY:

\`\`\`sql
-- Orders that are paid but not shipped
SELECT o.id,
       c.name AS customer,
       o.ordered_at,
       o.total
FROM orders AS o
JOIN customer AS c ON c.id = o.customer_id
WHERE o.status = 'paid'
  AND o.shipped_at IS NULL
ORDER BY o.ordered_at;
\`\`\`

The index \`orders_ordered_at_idx\` can also help the sort.`

const GENERIC_ANSWER = `I can help with this query. Tell me which result you expect.`

function answerFor(request: AskRequest_Serialize): {
  text: string
  summary: string
} {
  const last = request.messages.at(-1)
  if (request.task === 'query-error' || last?.context?.type === 'query-error') {
    return {
      text: FIX_ANSWER,
      summary:
        'Sent: your request, the statement, the error message, and the structure of 7 tables and views.',
    }
  }
  if (last?.text.toLowerCase().includes('share')) {
    return {
      text: SHARE_ANSWER,
      summary: 'Sent: your request and the structure of 7 tables and views.',
    }
  }
  return { text: GENERIC_ANSWER, summary: 'Sent: your request.' }
}

/** Sends the events of one answer and returns the result of the request. */
export async function ask(
  request: AskRequest_Serialize,
  send: (event: AssistantEvent) => void,
) {
  const { text, summary } = answerFor(request)
  send({ type: 'reading-schema' })
  send({ type: 'schema', relations: 7, detailed: 7 })
  send({ type: 'sent', summary })
  for (const part of text.match(/[\s\S]{1,120}/g) ?? []) {
    send({ type: 'text', text: part })
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return {
    status: 'done',
    text,
    outcome: {
      stop: 'complete',
      model: 'claude-opus-5-5',
      input_tokens: 2140,
      output_tokens: 236,
    },
  }
}
