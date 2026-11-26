import type {
  QueryLanguage_Serialize as QueryLanguage,
  Risk,
} from '../bindings'

const SQL_LABELS: Record<Risk, string> = {
  drop: 'DROP removes an object',
  truncate: 'TRUNCATE removes all rows',
  alter: 'ALTER changes the structure',
  'delete-without-where': 'DELETE without WHERE removes all rows',
  'update-without-where': 'UPDATE without WHERE changes all rows',
  'write-file': 'The statement writes files on the disk',
  'load-extension': 'The statement adds program code to the database engine',
  overwrite: 'The statement replaces or changes the documents of a collection',
  unchecked: 'The application cannot check this statement',
}

/** The words of MongoDB, where they are different from SQL. */
const MONGODB_LABELS: Partial<Record<Risk, string>> = {
  drop: 'The statement drops a collection, an index, or a database',
  alter: 'The statement renames or changes a collection',
  'delete-without-where':
    'The statement deletes all documents of the collection',
  'update-without-where':
    'The statement changes all documents of the collection',
}

/** The text of a risk for the user, in the words of the query language. */
export function riskLabel(risk: Risk, language: QueryLanguage): string {
  return (
    (language === 'mongodb-shell' ? MONGODB_LABELS[risk] : undefined) ??
    SQL_LABELS[risk]
  )
}
