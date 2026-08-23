/**
 * Post-processes drizzle-kit output for Aurora DSQL compatibility:
 * 1. Inlines every FK constraint into its parent CREATE TABLE (DSQL rejects
 *    standalone ALTER TABLE ADD CONSTRAINT).
 * 2. Strips `USING btree` from CREATE INDEX (DSQL rejects it; btree is the
 *    default on vanilla Postgres too, so semantics are identical everywhere).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

const ALTER_FK_RE =
  /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" (FOREIGN KEY[^;]+);\s*$/;

for (const file of readdirSync(drizzleDir)) {
  if (!file.endsWith('.sql')) continue;
  const filePath = path.join(drizzleDir, file);
  let content = readFileSync(filePath, 'utf8');
  const usingCount = (content.match(/USING btree/g) ?? []).length;
  content = content.replaceAll(' USING btree', '');
  const parts = content.split('--> statement-breakpoint');
  const foreignKeysByTable = new Map();
  const kept = [];

  for (const part of parts) {
    const trimmed = part.trim();
    const match = ALTER_FK_RE.exec(trimmed);
    if (match) {
      const [, table, name, definition] = match;
      const list = foreignKeysByTable.get(table) ?? [];
      list.push(`CONSTRAINT "${name}" ${definition.trim()}`);
      foreignKeysByTable.set(table, list);
      continue;
    }
    kept.push(part);
  }

  let inlined = 0;
  const transformed = kept.map((part) => {
    let statement = part;
    const createMatch = /^\s*CREATE TABLE "([^"]+)"/.exec(statement);
    if (!createMatch) return statement;
    const fks = foreignKeysByTable.get(createMatch[1]);
    if (!fks) return statement;
    const closing = statement.lastIndexOf('\n)');
    if (closing === -1) {
      throw new Error(`${file}: could not find closing paren for CREATE TABLE "${createMatch[1]}"`);
    }
    statement =
      statement.slice(0, closing) +
      ',\n\t' +
      fks.join(',\n\t') +
      statement.slice(closing);
    inlined += fks.length;
    return statement;
  });

  const missing = [...foreignKeysByTable.keys()].filter(
    (table) => !transformed.some((s) => s.includes(`CREATE TABLE "${table}"`)),
  );
  if (missing.length > 0) {
    throw new Error(`${file}: FK target CREATE TABLE not found for: ${missing.join(', ')}`);
  }

  const output = transformed.join('--> statement-breakpoint');
  if (output !== readFileSync(filePath, 'utf8')) {
    writeFileSync(filePath, output);
  }
  console.log(
    `${file}: inlined ${inlined} foreign key(s), stripped ${usingCount} USING btree`,
  );
}
