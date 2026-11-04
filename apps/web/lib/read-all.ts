/** Read a complete ordered PostgREST result, without the server's row cap truncating it. */
export async function readAll<T, E>(query: { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: E | null }> } & PromiseLike<{ data: T[] | null; error: E | null }>): Promise<{ data: T[] | null; error: E | null }> {
  const rows: T[] = []
  for (;;) {
    const { data, error } = await query.range(rows.length, rows.length + 499)
    if (error) return { data: null, error }
    if (!data?.length) return { data: rows, error: null }
    rows.push(...data)
  }
}
