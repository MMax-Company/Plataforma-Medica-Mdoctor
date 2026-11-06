// Fake mínimo do cliente Supabase (postgrest-js) para testes offline de
// store — sem rede nem banco real. Implementa só o subconjunto de métodos
// encadeados usados pelos stores (eq/neq/is/lt/or/order/limit/select/insert/
// update/single/maybeSingle) com semântica de filtro real, inclusive unique
// constraints (parciais, "where col is not null") para exercitar os mesmos
// caminhos de corrida/idempotência do código de produção.
const { randomUUID } = require('crypto');

function matchesOrClause(row, orString) {
  // Formato Supabase: "col1.op1.val1,col2.op2.val2" — OR entre as cláusulas.
  const clauses = orString.split(',');
  return clauses.some((clause) => {
    const [col, op, rawVal] = clause.split('.');
    const val = rawVal === 'null' ? null : rawVal;
    if (op === 'is') return (row[col] ?? null) === val;
    if (op === 'lt') return row[col] != null && String(row[col]) < String(val);
    if (op === 'eq') return String(row[col]) === String(val);
    throw new Error(`operador '${op}' não suportado no fake`);
  });
}

function matchesFilters(row, filters) {
  return filters.every(({ type, col, val }) => {
    if (type === 'eq') return row[col] === val;
    if (type === 'neq') return row[col] !== val;
    if (type === 'is') return (row[col] ?? null) === val;
    if (type === 'lt') return row[col] != null && String(row[col]) < String(val);
    if (type === 'in') return Array.isArray(val) && val.includes(row[col]);
    throw new Error(`filtro '${type}' não suportado no fake`);
  });
}

class FakeQueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.orClause = null;
    this.op = null;
    this.payload = null;
    this.singleMode = null;
    this.orderCol = null;
    this.orderAscending = true;
    this.limitN = null;
  }

  insert(payload) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  select() {
    if (!this.op) this.op = 'select';
    return this;
  }

  eq(col, val) {
    this.filters.push({ type: 'eq', col, val });
    return this;
  }

  neq(col, val) {
    this.filters.push({ type: 'neq', col, val });
    return this;
  }

  is(col, val) {
    this.filters.push({ type: 'is', col, val });
    return this;
  }

  lt(col, val) {
    this.filters.push({ type: 'lt', col, val });
    return this;
  }

  in(col, vals) {
    this.filters.push({ type: 'in', col, val: vals });
    return this;
  }

  or(clause) {
    this.orClause = clause;
    return this;
  }

  order(col, { ascending = true } = {}) {
    this.orderCol = col;
    this.orderAscending = ascending;
    return this;
  }

  limit(n) {
    this.limitN = n;
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this;
  }

  then(resolve, reject) {
    try {
      resolve(this.client._execute(this));
    } catch (error) {
      reject(error);
    }
  }
}

class FakeSupabaseClient {
  constructor({ uniqueConstraints = {} } = {}) {
    this.tables = {};
    this.uniqueConstraints = uniqueConstraints;
    this._failNextInsert = {};
  }

  from(table) {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQueryBuilder(this, table);
  }

  // Permite simular uma falha de persistência pontual (ex.: tabela de
  // auditoria indisponível) sem derrubar o processo de teste.
  failNextInsert(table) {
    this._failNextInsert[table] = (this._failNextInsert[table] || 0) + 1;
  }

  rows(table) {
    return this.tables[table] || [];
  }

  _violatesUnique(table, candidate) {
    const combos = this.uniqueConstraints[table] || [];
    const existingRows = this.tables[table] || [];
    return combos.some((cols) => {
      if (cols.some((col) => candidate[col] == null)) return false;
      return existingRows.some((row) => cols.every((col) => row[col] === candidate[col]));
    });
  }

  _execute(builder) {
    const { table, op } = builder;
    const rowsRef = this.tables[table];

    if (op === 'insert') {
      if (this._failNextInsert[table]) {
        this._failNextInsert[table] -= 1;
        return { data: null, error: { code: 'XXFAIL', message: 'falha simulada de inserção' } };
      }
      const row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...builder.payload
      };
      if (this._violatesUnique(table, row)) {
        return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${table})` } };
      }
      rowsRef.push(row);
      if (builder.singleMode === 'single') return { data: row, error: null };
      return { data: [row], error: null };
    }

    if (op === 'delete') {
      let matched = rowsRef.filter((row) => matchesFilters(row, builder.filters));
      if (builder.orClause) matched = matched.filter((row) => matchesOrClause(row, builder.orClause));
      const matchedIds = new Set(matched.map((row) => row.id));
      this.tables[table] = rowsRef.filter((row) => !matchedIds.has(row.id));
      return { data: matched, error: null };
    }

    if (op === 'update') {
      let matched = rowsRef.filter((row) => matchesFilters(row, builder.filters));
      if (builder.orClause) matched = matched.filter((row) => matchesOrClause(row, builder.orClause));
      matched.forEach((row) => Object.assign(row, builder.payload));
      if (builder.singleMode === 'single') {
        if (matched.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'no rows / multiple rows' } };
        return { data: matched[0], error: null };
      }
      return { data: matched, error: null };
    }

    // select
    let matched = rowsRef.filter((row) => matchesFilters(row, builder.filters));
    if (builder.orClause) matched = matched.filter((row) => matchesOrClause(row, builder.orClause));
    if (builder.orderCol) {
      matched = [...matched].sort((a, b) => {
        const av = String(a[builder.orderCol]);
        const bv = String(b[builder.orderCol]);
        return builder.orderAscending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (builder.limitN != null) matched = matched.slice(0, builder.limitN);

    if (builder.singleMode === 'maybe') {
      return { data: matched[0] || null, error: null };
    }
    if (builder.singleMode === 'single') {
      if (matched.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'no rows / multiple rows' } };
      return { data: matched[0], error: null };
    }
    return { data: matched, error: null };
  }
}

module.exports = { FakeSupabaseClient };
