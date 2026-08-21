// PostgREST answers with at most 1000 rows and says nothing about the ones
// it left out. The first real 5-round shift has 2930 comparisons, so a
// plain .select() was quietly returning the first 1000 of them — and every
// ranking, count and verdict on the page was built on that third of the
// record without anything on screen admitting it. Page until a short page
// comes back.
const PAGE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  max = 12000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}
