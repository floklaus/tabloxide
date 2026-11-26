import { useEffect } from 'react'
import { TableDetail } from '../schema/TableDetail'
import { useSchemaStore } from '../schema/schemaStore'
import type { Detail } from './tabsStore'

/** The detail of a table. It reads the structure and the first rows. */
function TableDetailTab({ schema, name }: { schema: string; name: string }) {
  useEffect(() => {
    const { selected, selectRelation } = useSchemaStore.getState()
    if (selected?.schema !== schema || selected.name !== name) {
      void selectRelation(schema, name)
    }
  }, [schema, name])
  return (
    <div className="detail-tab">
      <TableDetail />
    </div>
  )
}

/** The content of a detail tab of the editor area. */
export function DetailView({ detail }: { detail: Detail }) {
  switch (detail.kind) {
    case 'table':
      return <TableDetailTab schema={detail.schema} name={detail.name} />
  }
}
